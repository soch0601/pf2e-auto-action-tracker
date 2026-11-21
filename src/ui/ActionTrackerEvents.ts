import type { CombatantPF2e } from "module-helpers";
import { ActionManager } from "../ActionManager.ts";
import { MovementManager } from "../MovementManager.ts";
import { DBManager } from "../DBManager.ts";
import { ComplexActionEngine } from "../complexActions/ComplexActionEngine.ts";
import { logWarn } from "../logger.ts";
import { ActionDialogs } from "./ActionDialogs.ts";

export class ActionTrackerEvents {
    /**
     * Activate listeners for our click targets. Will disable other click handlers
     * for our specifically added rows.
     */
    static activateListeners(html: HTMLElement) {
        if (html.dataset.pf2eAutoActionTrackerListeners === "true") return;
        html.dataset.pf2eAutoActionTrackerListeners = "true";

        // Capture phase listeners (true) to override Foundry core behavior
        html.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            // Check if the click was on the icon OR inside the icon
            const iconBtn = target.closest('.action-icon');

            if (iconBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                this.handleIconClick(iconBtn as HTMLElement); // Pass the SPAN, not the I tag
            }
        }, true);

        html.addEventListener('contextmenu', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target?.classList.contains('action-icon')) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                if (this.canUserModify(target)) {
                    this.handleIconContextMenu(target);
                }
            }
        }, true);
    }

    /**
     * Checks if the current user has permission to modify this specific combatant's tracker.
     */
    static canUserModify(target: HTMLElement): boolean {
        const combatantId = (target.closest('.pf2e-auto-action-tracker-container')?.parentElement as HTMLElement)?.closest('[data-combatant-id]')?.getAttribute('data-combatant-id');
        const combatant = (game as any).combat?.combatants.get(combatantId);

        if (!combatant) return false;

        // Permission Logic: Is GM or owns the Actor
        const isOwner = combatant.actor?.isOwner;
        const isGM = (game as any).user.isGM;

        if (!isOwner && !isGM) {
            return false;
        }

        return true;
    }

    /**
     * Handles logic for clicking on one of the icons. This will switch tabs to the chat window and find the message to show
     */
    static async handleIconClick(target: HTMLElement) {
        const btn = target.classList.contains('action-icon') ? target : target.parentElement;
        if (!btn) return;

        const combatantId = btn.dataset.combatantId;
        const combatant = (game.combat as any)?.combatants.get(combatantId);

        // Handle Finish Button
        if (btn.classList.contains('finish-button')) {
            if (btn.classList.contains('disabled')) return; // Guard for minOccurrences

            if (combatant) {
                // Trigger engine completion
                const lastAction = ActionManager.getLastAction(combatant);
                const lastSpecialAction = lastAction?.entry.ComplexActionState;
                if (!lastSpecialAction) {
                    logWarn("Couldn't find Special Action to complete... Aborting...");
                    return;
                }

                await ActionManager.completeComplexAction(combatant, lastAction.entry);
                return;
            }
        }

        // Handle Add Button
        if (btn.classList.contains('add-button')) {
            if (combatant) return ActionDialogs.showManualActionDialog(combatant);
        }

        const msgId = target.dataset.msgId;

        // Unclickable list
        if (!msgId ||
            msgId === 'System' ||
            msgId.startsWith('manual-') ||
            MovementManager.isMoveAction(msgId)) {
            return;
        }

        // --- Permission Check ---
        const message = game.messages.get(msgId);
        let canSeeMessage = true;
        if (message) {
            const userId = (game as any).user.id;
            const isGM = (game as any).user.isGM;
            const isAuthor = message.author?.id === userId;
            const isWhisperedToMe = message.whisper.includes(userId);
            const isPublic = message.whisper.length === 0 && !message.blind;

            canSeeMessage = isGM || isAuthor || isWhisperedToMe || isPublic;
        }
        if (message && !canSeeMessage) {
            ui.notifications.warn("You cannot view the source of a secret action.");
            return;
        }

        await (ui.sidebar as any).activateTab("chat");

        // Use the ChatMessage's own scroll method if it exists, or find it via the collection
        if (message) {
            const li = document.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement;

            if (li) {
                li.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Add our custom glow class
                li.classList.add('pf2e-action-highlight');

                // Remove it after 4 seconds so it doesn't pulse forever
                setTimeout(() => {
                    if (li) li.classList.remove('pf2e-action-highlight');
                }, 4000);
            }
        } else {
            // If it's not in the DOM, flush the chat log
            (ui.chat as any).scrollStep(0); // Forces a refresh of the view

            // Final attempt after a slightly longer delay for lazy loading
            setTimeout(() => {
                const retryLi = document.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement;
                if (retryLi) {
                    retryLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    retryLi.classList.add('highlight');
                    setTimeout(() => retryLi.classList.remove('highlight'), 2000);
                } else {
                    ui.notifications.info("Action source found, but too far back in history to highlight.");
                }
            }, 250);
        }
    }

    /**
     * Handles right click for the icons (removing actions). Also handles permissions.
     */
    static async handleIconContextMenu(target: HTMLElement) {
        const msgId = target.dataset.msgId;

        const index = parseInt(target.dataset.index || "-1");
        const combatantId = (target.closest('.pf2e-auto-action-tracker-container')?.parentElement as HTMLElement)?.closest('[data-combatant-id]')?.getAttribute('data-combatant-id');
        const combatant = (game.combat as any)?.combatants.get(combatantId || "") as any | undefined;

        if (!combatant) return;

        // Permissions check
        const canUndo = game.user.isGM || combatant.actor?.testUserPermission(game.user, "OWNER");
        if (!canUndo) return ui.notifications.warn("Permission denied.");

        // Determine if we are allowed to undo this specific type
        const log = DBManager.getLog(combatant);
        const entry = log[index];

        if (entry?.type === 'system' && !game.user.isGM) {
            return ui.notifications.warn("Only GMs can undo system-drains.");
        }

        if (!msgId) return;

        // Call undoAction with msgId
        await ActionManager.removeAction(combatant, msgId);
    }
}

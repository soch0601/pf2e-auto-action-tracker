import { ActionManager } from "../ActionManager.ts";
import { MovementManager } from "../MovementManager.ts";
import { DBManager } from "../DBManager.ts";
import { logWarn } from "../logger.ts";
import { ActionDialogs } from "./ActionDialogs.ts";
import { findCombatantById, isCurrentUserActiveGM } from "../foundryCompat.ts";
import { SummonManager } from "../summons/index.ts";
import { SocketSender } from "../sockets/SocketSender.ts";

export class ActionTrackerEvents {
    /**
     * Activate listeners for our click targets. Will disable other click handlers
     * for our specifically added rows.
     */
    static activateListeners(html: HTMLElement) {
        if (html.dataset.pf2eAutoActionTrackerListeners === "true") return;
        html.dataset.pf2eAutoActionTrackerListeners = "true";

        // Capture phase listeners (true) to override Foundry core behavior
        html.addEventListener('click', async (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            // Check if the click was on the icon OR inside the icon
            const iconBtn = target.closest('.action-icon');

            if (iconBtn) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                await this.handleIconClick(iconBtn as HTMLElement); // Pass the SPAN, not the I tag
            }
        }, true);

        html.addEventListener('contextmenu', async (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target?.classList.contains('action-icon')) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                if (this.canUserModify(target)) {
                    await this.handleIconContextMenu(target);
                }
            }
        }, true);
    }

    /**
     * Resolves the combatantId (or virtual minion combatantId) from a target element inside a tracker container.
     */
    static resolveCombatantIdFromTarget(target: HTMLElement): string | undefined {
        const container = target.closest('.pf2e-auto-action-tracker-container') as HTMLElement | null;
        if (container?.dataset.combatantId) {
            return container.dataset.combatantId;
        }
        return (container?.parentElement as HTMLElement)?.closest('[data-combatant-id]')?.getAttribute('data-combatant-id') ?? undefined;
    }

    /**
     * Checks if the current user has permission to modify this specific combatant's tracker.
     */
    static canUserModify(target: HTMLElement): boolean {
        const combatantId = this.resolveCombatantIdFromTarget(target);
        const combatant = findCombatantById((game as any).combat, combatantId);

        if (!combatant) return false;

        // Permission Logic: Is GM or owns the Actor (or owns the controller actor for a minion)
        const isOwner = Boolean(combatant.actor?.isOwner || combatant.controllerCombatant?.actor?.isOwner);
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

        const combatantId = btn.dataset.combatantId || this.resolveCombatantIdFromTarget(btn);
        const combatant = findCombatantById((game as any).combat, combatantId);

        if (btn.classList.contains('grant-button')) {
            if (combatant && SummonManager.isEnabled()) {
                if (isCurrentUserActiveGM()) {
                    await SummonManager.toggleManualGrant(combatant);
                } else if (combatantId) {
                    await SocketSender.sendToggleMinionGrant(combatantId);
                }
            }
            return;
        }

        if (btn.classList.contains('finish-button')) {
            await this.handleFinishButtonClick(btn, combatant);
            return;
        }

        if (btn.classList.contains('add-button')) {
            if (combatant) await ActionDialogs.showManualActionDialog(combatant);
            return;
        }

        const msgId = target.dataset.msgId;
        if (!this.isClickableMessageId(msgId)) return;

        const message = game.messages.get(msgId);
        if (message && !this.canUserSeeMessage(message)) {
            ui.notifications.warn("You cannot view the source of a secret action.");
            return;
        }

        await (ui.sidebar as any).activateTab("chat");
        this.scrollToAndHighlightMessage(msgId, !!message);
    }

    private static async handleFinishButtonClick(btn: HTMLElement, combatant: any) {
        if (btn.classList.contains('disabled') || !combatant) return;

        const lastAction = ActionManager.getLastAction(combatant);
        if (!lastAction?.entry.ComplexActionState) {
            logWarn("Couldn't find Special Action to complete... Aborting...");
            return;
        }

        await ActionManager.completeComplexAction(combatant, lastAction.entry);
    }

    private static isClickableMessageId(msgId: string | undefined): msgId is string {
        if (!msgId) return false;
        return msgId !== 'System' && !msgId.startsWith('manual-') && !MovementManager.isMoveAction(msgId);
    }

    private static canUserSeeMessage(message: any): boolean {
        const userId = (game as any).user.id;
        const isGM = (game as any).user.isGM;
        const isAuthor = message.author?.id === userId;
        const isWhisperedToMe = message.whisper.includes(userId);
        const isPublic = message.whisper.length === 0 && !message.blind;

        return isGM || isAuthor || isWhisperedToMe || isPublic;
    }

    private static scrollToAndHighlightMessage(msgId: string, hasMessageInCollection: boolean) {
        if (hasMessageInCollection) {
            const li = document.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement | null;
            if (li) {
                this.highlightChatElement(li, 'pf2e-action-highlight', 4000);
            }
            return;
        }

        // If it's not in the DOM, flush the chat log and retry after lazy loading
        (ui.chat as any).scrollStep(0);
        setTimeout(() => {
            const retryLi = document.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement | null;
            if (retryLi) {
                this.highlightChatElement(retryLi, 'highlight', 2000);
            } else {
                ui.notifications.info("Action source found, but too far back in history to highlight.");
            }
        }, 250);
    }

    private static highlightChatElement(element: HTMLElement, highlightClass: string, durationMs: number) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add(highlightClass);
        setTimeout(() => element.classList.remove(highlightClass), durationMs);
    }

    /**
     * Handles right click for the icons (removing actions). Also handles permissions.
     */
    static async handleIconContextMenu(target: HTMLElement) {
        const msgId = target.dataset.msgId;

        const index = parseInt(target.dataset.index || "-1");
        const combatantId = this.resolveCombatantIdFromTarget(target);
        const combatant = findCombatantById((game as any).combat, combatantId) as any | undefined;

        if (!combatant) return;

        // Permissions check
        const canUndo =
            game.user.isGM ||
            combatant.actor?.testUserPermission?.(game.user, "OWNER") ||
            combatant.controllerCombatant?.actor?.testUserPermission?.(game.user, "OWNER");
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

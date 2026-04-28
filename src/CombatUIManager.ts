import { ActionManager, ActionLogEntry } from "./ActionManager";
import { SCOPE } from "./globals";
import { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ActorHandler } from "./ActorHandler";
import { MovementManager } from "./MovementManager";
import { ComplexActionEngine } from "./complexActions/ComplexActionEngine";
import { logWarn } from "./logger";
import {
    canShowManualActionButton,
    getTrackerRenderKey,
    hasCompactOverspendTint,
    resolveMapMountTarget,
    resolveTrackerMount,
    shouldShowTrackerForMount
} from "./trackerAdapters";
import { getMapDisplayState } from "./mapTracker";

function canReuseTrackerRender(
    existingRenderKey: string | undefined,
    renderKey: string,
    hasMapMountTarget: boolean,
    mapVisible: boolean,
    existingMapRenderKey?: string
): boolean {
    return existingRenderKey === renderKey && (!hasMapMountTarget || !mapVisible || existingMapRenderKey === renderKey);
}

export class CombatUIManager {

    /**
     * Inject the action tracking icons into each combatant's frame.  Will allow GM to see everyone's, but players
     * can only see other players
     */
    static injectIcons(html: HTMLElement, combatant: CombatantPF2e) {
        if (!html || typeof html.querySelector !== 'function') return;

        const c = combatant as any;
        const actor: ActorPF2e = c.actor;
        if (!actor) return;

        const isGM = (game as any).user.isGM;
        const isOwner = actor.isOwner;
        const mount = resolveTrackerMount(html, c.id);
        if (!mount) return;
        const mapMountTarget = resolveMapMountTarget(html, c.id);
        const isCompact = mount.mode === "pf2e-hud";
        const isPC = actor.hasPlayerOwner || (actor as any).type === "character";

        if (!shouldShowTrackerForMount(mount.mode, isGM, isOwner, isPC)) return;

        const log = (c.getFlag(SCOPE, "log") as ActionLogEntry[]) || [];
        const flattenedLog = ActionManager.getFlattenedActions(combatant);

        const actionSlotsForRenderKey = ActorHandler.getSlots(combatant, 'action');
        const reactionSlotsForRenderKey = ActorHandler.getSlots(combatant, 'reaction');

        const actionSlotsKey = actionSlotsForRenderKey.map(s => s.definition?.slug || 'base').join(',');
        const currentMAP = ActionManager.getCurrentMAP(combatant);
        const mapDisplay = getMapDisplayState(currentMAP);
        const maxReactions = reactionSlotsForRenderKey.length;
        const renderKeyLog = flattenedLog.map(entry => {
            const message = game.messages.get(entry.msgId || "");
            const visibilityKey = message
                ? `${message.visible ? 1 : 0}:${message.blind ? 1 : 0}:${message.whisper.join(",")}:${message.author?.id ?? ""}`
                : "";
            return { ...entry, visibilityKey };
        });
        const renderKey = getTrackerRenderKey({
            mode: mount.mode,
            combatantId: c.id,
            isGM,
            isOwner,
            isPC,
            actionSlotsKey,
            mapAttackCount: currentMAP.attackCount,
            maxReactions,
            log: renderKeyLog,
        });
        const existingContainer = mount.target.querySelector(".pf2e-auto-action-tracker-container") as HTMLElement | null;
        const existingMapContainer = mapMountTarget?.querySelector(".pf2e-auto-action-tracker-map-container") as HTMLElement | null;
        if (isCompact && canReuseTrackerRender(existingContainer?.dataset.renderKey, renderKey, !!mapMountTarget, mapDisplay.visible, existingMapContainer?.dataset.renderKey)) {
            return;
        }

        const maxStandardActions = 3;
        const charMap: Record<string, string> = { "1": "A", "2": "D", "3": "T" };

        // --- 1. Allocation Logic ---
        const { slots: actionSlots, overspent: overspentActions } = ActorHandler.allocateSlots(combatant, log, 'action');

        const pipsToRender: { entry: ActionLogEntry, slot?: any, isGold: boolean, isOver: boolean, subIdx: number, totalCost: number }[] = [];

        for (const slot of actionSlots) {
            if (slot.spentBy) {
                const subIdx = pipsToRender.filter(p => p.entry === slot.spentBy).length;
                pipsToRender.push({
                    entry: slot.spentBy,
                    slot,
                    isGold: !slot.isBase,
                    isOver: false,
                    subIdx,
                    totalCost: slot.spentBy.cost
                });
            } else {
                pipsToRender.push({
                    entry: null as any,
                    slot,
                    isGold: !slot.isBase,
                    isOver: false,
                    subIdx: 0,
                    totalCost: 1
                });
            }
        }

        for (const entry of overspentActions) {
            const assignedPips = pipsToRender.filter(p => p.entry === entry).length;
            const remainingCost = entry.cost - assignedPips;
            for (let i = 0; i < remainingCost; i++) {
                pipsToRender.push({
                    entry,
                    isGold: false,
                    isOver: true,
                    subIdx: assignedPips + i,
                    totalCost: entry.cost
                });
            }
        }

        // --- 2. Rendering Setup ---
        const container = document.createElement("div");
        container.className = `pf2e-auto-action-tracker-container ${isCompact ? 'compact' : 'standard'}`;
        container.dataset.trackerMode = mount.mode;
        container.dataset.renderKey = renderKey;
        container.addEventListener('click', (e) => e.stopPropagation());

        const actionLine = document.createElement("div");
        actionLine.className = `action-line ${isCompact ? 'compact' : ''}`.trim();
        if (!isCompact) {
            actionLine.textContent = "Actions: ";
        }

        let pipsRendered = 0;
        let overflowCount = 0;
        const MAX_PIPS = 6;

        let hasRenderedOverspent = false;
        /**
         * Helper to render individual pips with correct PF2e Action Symbols
         */
        const renderPip = (pip: any) => {

            const isOver = !!pip.isOver;

            // Strictly allow only ONE overspent pip to be rendered
            if (isOver && hasRenderedOverspent) {
                overflowCount++;
                return;
            }

            // Normal MAX_PIPS capping for unspent/spent actions
            if (pipsRendered >= MAX_PIPS) {
                // If this is the FIRST overspent pip, we allow it even if over MAX_PIPS
                if (isOver && !hasRenderedOverspent) {
                    // Proceed to render
                } else {
                    if (isOver) overflowCount++;
                    return;
                }
            }

            if (isOver) {
                hasRenderedOverspent = true;
            }

            if (!pip.entry) {
                // Unspent
                const span = document.createElement("span");
                span.className = `action-icon unspent ${pip.isGold ? 'quickened' : ''} tracker-tooltip`;

                let tooltip = "Available Action";
                if (pip.slot && pip.slot.definition) {
                    tooltip = `Available Action (${pip.slot.definition.name})`;
                } else if (pip.isGold) {
                    tooltip = "Available Bonus Action";
                }

                span.dataset.tooltip = tooltip;
                span.textContent = "A";
                actionLine.appendChild(span);
                pipsRendered++;
                return;
            }

            const entry = pip.entry;
            const isGold = pip.isGold;
            const subIdx = pip.subIdx;

            const message = game.messages.get(entry.msgId || "");

            // 1. Determine Visibility
            // Use the native message.visible property if available...
            let canSeeMessage = message ? message.visible : true;

            // And then explicitly check for PF2e "Blind" or "Secret" rolls if message exists
            if (message) {
                const userId = game.user?.id;
                const isGM = game.user?.isGM;
                const isAuthor = message.author?.id === userId;
                const isWhisperedToMe = message.whisper.includes(userId || "");

                // message.visible usually covers this, but we'll be extra strict for the UI label
                canSeeMessage = isGM || isAuthor || isWhisperedToMe || (message.whisper.length === 0 && !message.blind);
            }

            const displayLabel = canSeeMessage ? entry.label : "Secret Action";
            const span = document.createElement("span");

            // 2. Logic for Icons (A, D, T)
            let iconChar = "";

            if (isGold) {
                iconChar = "A"; // Gold slots always remain entirely separate single pips
            } else {
                // Determine how many NON-GOLD pips this entry consumes, and which one this is.
                // This allows multi-actions that span Gold + Normal slots to safely isolate the Gold pip
                // and then "combine normally" across the remaining Normal pips.
                const normalPipsForEntry = pipsToRender.filter(p => p.entry === entry && !p.isGold);
                const normalTotalCost = normalPipsForEntry.length;
                const normalSubIdx = normalPipsForEntry.indexOf(pip);

                if (normalSubIdx === 0) {
                    iconChar = charMap[normalTotalCost.toString()] || "A";
                }
            }

            // 3. Security & Interaction
            span.className = `action-icon spent ${isGold ? 'quickened' : ''} ${isOver ? 'overspend-pip' : ''} tracker-tooltip`;

            if (!canSeeMessage) {
                span.style.cursor = "default";

                // We set a generic tooltip but OMIT the msgId entirely.
                span.dataset.tooltip = `Used: Secret Action${isGold ? ' (Bonus Action)' : ''}`;

                // Block the click at the source just in case a listener is on a parent
                span.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }, { capture: true });

            } else {
                // Normal behavior for those with permission
                let suffix = '';
                if (pip.slot && pip.slot.definition) suffix = ` (${pip.slot.definition.name})`;
                else if (isGold) suffix = ` (Bonus Action)`;

                span.dataset.tooltip = `Used: ${displayLabel}${suffix}${isOver ? ' (Overspent)' : ''}`;

                if (entry.type === "system" || entry.msgId === "System") {
                    span.style.cursor = "default";
                } else {
                    span.dataset.msgId = entry.msgId || '';
                    span.style.cursor = "pointer";
                }
            }

            span.dataset.icon = iconChar;
            span.textContent = iconChar;

            actionLine.appendChild(span);
            pipsRendered++;

            if (isOver) {
                const warn = document.createElement("span");
                warn.className = "overspend-exclamation";
                warn.textContent = "!";
                actionLine.appendChild(warn);
            }
        };

        // --- 3. Build the DOM ---
        for (let i = 0; i < pipsToRender.length; i++) {
            const pip = pipsToRender[i];
            renderPip(pip);

            // Add divider if transitioning from gold to non-gold
            if (pip.isGold && !isCompact && i < pipsToRender.length - 1 && !pipsToRender[i + 1].isGold) {
                const divider = document.createElement("span");
                divider.className = "divider";
                divider.textContent = "|";
                actionLine.appendChild(divider);
            }
        }

        // Render Overspend Overflow Indicator
        let compactOverspend = false;
        if (isCompact) {
            compactOverspend = hasCompactOverspendTint(overflowCount);
        }

        // Render Overflow Indicator
        if (compactOverspend) {
            actionLine.classList.add("compact-overspent");
        }

        if (isCompact && mapDisplay.visible && !mapMountTarget) {
            const mapBadge = document.createElement("span");
            mapBadge.className = "map-line compact tracker-tooltip";
            mapBadge.textContent = mapDisplay.compact.text;
            mapBadge.dataset.tooltip = mapDisplay.compact.tooltip;
            actionLine.appendChild(mapBadge);
        }

        const isOverspent = log.some(e => ActorHandler.allocateSlots(combatant, [e], 'action').overspent.length > 0);
        if (overflowCount > 0 && !isCompact) {
            const overflow = document.createElement("span");
            overflow.className = "action-overflow-count";
            overflow.style.marginLeft = "4px";
            overflow.style.fontSize = "0.8em";
            overflow.style.fontWeight = "bold";
            overflow.textContent = `+${overflowCount}`;
            overflow.dataset.tooltip = `${overflowCount} more action(s) used`;
            actionLine.appendChild(overflow);
        }

        // Render Manual override button
        if (canShowManualActionButton(isGM, isOwner)) {
            const lastAction = ActionManager.getLastAction(combatant);
            const lastSpecialAction = lastAction?.entry.ComplexActionState;
            const activeSpecialAction = !ComplexActionEngine.isComplete(lastSpecialAction)

            if (lastSpecialAction && activeSpecialAction) {
                const finishBtn = document.createElement("span");
                const canComplete = ComplexActionEngine.canComplete(lastSpecialAction);

                // Use 'finish-button' for specific logic, keep 'action-icon' for the global listener
                finishBtn.className = `action-icon finish-button tracker-tooltip ${!canComplete ? 'disabled' : ''}`;
                finishBtn.dataset.tooltip = canComplete ? `Finish ${ComplexActionEngine.getName(lastSpecialAction)}` : `Waiting for requirements...`;
                finishBtn.dataset.combatantId = c.id;

                // A "Checkmark" or "Flag" icon often represents completion well in PF2e UI
                finishBtn.innerHTML = '<i class="fas fa-check-circle"></i>';

                if (!canComplete) {
                    finishBtn.style.opacity = "0.4";
                    finishBtn.style.cursor = "not-allowed";
                }

                actionLine.appendChild(finishBtn);
            } else {
                const addBtn = document.createElement("span");
                // Use 'action-icon' so our global listener catches it, 
                // and 'add-button' for our specific logic.
                addBtn.className = "action-icon add-button tracker-tooltip";
                addBtn.dataset.tooltip = "Add Manual Action";
                addBtn.dataset.combatantId = c.id; // Crucial for the handler
                addBtn.innerHTML = '<i class="fas fa-plus-circle"></i>';
                actionLine.appendChild(addBtn);
            }
        }

        container.appendChild(actionLine);

        // --- 4. Reactions Line ---
        const { slots: reactionSlots } = ActorHandler.allocateSlots(combatant, log, 'reaction');

        const reactionLine = document.createElement("div");
        reactionLine.className = `reaction-line ${isCompact ? 'compact' : ''}`.trim();
        if (!isCompact) {
            reactionLine.textContent = "Reactions: ";
        } else {
            const divider = document.createElement("span");
            divider.className = "divider compact";
            divider.textContent = "|";
            actionLine.appendChild(divider);
        }

        reactionSlots.forEach(slot => {
            const span = document.createElement("span");
            const entry = slot.spentBy;
            span.className = `action-icon reaction ${entry ? 'spent' : 'unspent'} tracker-tooltip`;

            let tooltip = 'Reaction Available';
            if (entry) {
                let suffix = '';
                if (slot.definition) suffix = ` (${slot.definition.name})`;
                tooltip = `Used: ${entry.label}${suffix}`;
            } else if (slot.definition) {
                tooltip = `Available Reaction (${slot.definition.name})`;
            }

            span.dataset.tooltip = tooltip;
            span.textContent = "R";

            if (entry) {
                const fullLog = ActionManager.getActions(combatant);
                const originalIndex = fullLog.findIndex(e => e.msgId === entry.msgId);
                span.dataset.msgId = entry.msgId;
                span.dataset.index = originalIndex.toString();
            }

            (isCompact ? actionLine : reactionLine).appendChild(span);
        });

        if (!isCompact && mapDisplay.core.text) {
            const divider = document.createElement("span");
            divider.className = "divider";
            divider.textContent = "|";
            reactionLine.appendChild(divider);

            const mapLine = document.createElement("span");
            mapLine.className = "map-line inline tracker-tooltip";
            mapLine.textContent = mapDisplay.core.text;
            mapLine.dataset.tooltip = mapDisplay.core.tooltip;
            reactionLine.appendChild(mapLine);
        }
        if (!isCompact) {
            container.appendChild(reactionLine);
        }

        // --- 5. DOM Injection ---
        if (isCompact && existingContainer) {
            existingContainer.className = container.className;
            existingContainer.dataset.trackerMode = container.dataset.trackerMode;
            existingContainer.dataset.renderKey = renderKey;
            existingContainer.replaceChildren(...Array.from(container.childNodes));
        } else {
            existingContainer?.remove();
            mount.target.appendChild(container);
        }

        if (mapMountTarget) {
            if (mapDisplay.visible) {
                const mapContainer = document.createElement("div");
                mapContainer.className = "pf2e-auto-action-tracker-map-container";
                mapContainer.dataset.renderKey = renderKey;

                const mapBadge = document.createElement("span");
                mapBadge.className = "map-line compact tracker-tooltip";
                mapBadge.textContent = mapDisplay.compact.text;
                mapBadge.dataset.tooltip = mapDisplay.compact.tooltip;

                mapContainer.appendChild(mapBadge);
                if (existingMapContainer) {
                    existingMapContainer.className = mapContainer.className;
                    existingMapContainer.dataset.renderKey = renderKey;
                    existingMapContainer.replaceChildren(...Array.from(mapContainer.childNodes));
                } else {
                    mapMountTarget.appendChild(mapContainer);
                }
            } else {
                existingMapContainer?.remove();
            }
        }
    }

    /**
     * Activate listeners for our click targets.  Will disable the other click handlers for our specificically added rows
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
                this._handleIconClick(iconBtn as HTMLElement); // Pass the SPAN, not the I tag
            }
        }, true);

        html.addEventListener('contextmenu', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target?.classList.contains('action-icon')) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                if (this._canUserModify(target)) {
                    this._handleIconContextMenu(target);
                }
            }
        }, true);
    }

    /**
     * This is the function called when the manual add (+) button is clicked.  This will launch a form to get values
     * needed for a manual action add (in case other logic missed something - but let's be honest - this won't ever be used
     * because the logic is flawless HAHAHAHAHAHAHA help me)
     */
    private static async _showManualActionDialog(combatant: CombatantPF2e) {
        const isActiveTurn = (game as any).combat.combatant?.id === (combatant as any).id;
        const defaultType = isActiveTurn ? "1" : "reaction";

        // DialogV2.wait returns the value returned by the button callback
        const result = await (foundry.applications.api.DialogV2 as any).wait({
            window: {
                title: "Add Manual Action",
                icon: "fas fa-plus"
            },
            content: `
            <form class="pf2e-action-form">
                <div class="form-group">
                    <label>Action Name</label>
                    <div class="form-fields">
                        <input 
                          type="text" 
                          name="label" 
                          placeholder="e.g. Heroic Inspiration" 
                          maxlength="50" 
                          required 
                          autofocus 
                        />
                    </div>
                </div>
                <div class="form-group">
                    <label>Cost / Type</label>
                    <div class="form-fields">
                        <select name="costType">
                            <option value="0">Free Action</option>
                            <option value="1" ${defaultType === "1" ? 'selected' : ''}>1 Action</option>
                            <option value="2">2 Actions</option>
                            <option value="3">3 Actions</option>
                            <option value="reaction" ${defaultType === "reaction" ? 'selected' : ''}>Reaction</option>
                        </select>
                    </div>
                </div>
            </form>
        `,
            buttons: [{
                action: "ok",
                label: "Add Action",
                class: "pf2e-upgrade-btn",
                default: true,
                callback: (event: Event, button: any) => {
                    const form = button.form as HTMLFormElement;

                    if (!form.checkValidity()) {
                        form.reportValidity();
                        return; // Prevents the promise from resolving with data
                    }

                    // Correct V12 way to extract data
                    const formData = new FormDataExtended(form);
                    return formData.object;
                }
            }],
            modal: true
        }).catch(() => null);

        // Result will be null if the user closed the window or clicked a button without a return
        if (result && result.label) {
            const isReaction = result.costType === "reaction";
            const cost = isReaction ? 1 : parseInt(result.costType);

            await ActionManager.addAction(combatant, {
                cost: cost,
                msgId: `manual-${Date.now()}`,
                label: result.label,
                type: isReaction ? 'reaction' : 'action',
                isQuickenedEligible: false,
                category: 'manual',
                linkedMessages: []
            });
        }
    }

    /**
      * Checks if the current user has permission to modify this specific combatant's tracker.
      */
    private static _canUserModify(target: HTMLElement): boolean {
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
     * Handles logic for clicking on one of the icons.  This will switch tabs to the chat window and find the message to show
     * Note: This handles permissions for who can click what (can they see the associated message?) and if it is clickable
     *       (because moves and stunned things don't have an associated chat message)
     */
    private static async _handleIconClick(target: HTMLElement) {

        const btn = target.classList.contains('action-icon') ? target : target.parentElement;
        if (!btn) return;

        const combatantId = btn.dataset.combatantId;
        const combatant = (game.combat as any)?.combatants.get(combatantId);

        // Handle Finish Button
        if (btn.classList.contains('finish-button')) {
            if (btn.classList.contains('disabled')) return; // Guard for minOccurrences

            if (combatant) {
                // Trigger your engine completion
                const lastAction = ActionManager.getLastAction(combatant);
                const lastSpecialAction = lastAction?.entry.ComplexActionState;
                if (!lastSpecialAction) {
                    logWarn("Couldn't find Special Action to complete... Aborting...");
                    return
                };

                await ActionManager.completeComplexAction(combatant, lastAction.entry);
                // Note: Your complete() should likely trigger a re-render of this UI
                return;
            }
        }

        // Handle Add Button (existing logic)
        if (btn.classList.contains('add-button')) {
            if (combatant) return this._showManualActionDialog(combatant);
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

        // 2. Use the ChatMessage's own scroll method if it exists, or find it via the collection
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
            // If it's not in the DOM, we can try to "force" it by flushing the chat log
            // or just use the highlight logic provided by some modules.
            // For standard Foundry:
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
     * this handles right click for the icons (removing actions).  Also handles permissions for who can do what
     */
    private static async _handleIconContextMenu(target: HTMLElement) {
        const msgId = target.dataset.msgId;

        const index = parseInt(target.dataset.index || "-1");
        const combatantId = (target.closest('.pf2e-auto-action-tracker-container')?.parentElement as HTMLElement)?.closest('[data-combatant-id]')?.getAttribute('data-combatant-id');
        const combatant = (game.combat as any)?.combatants.get(combatantId || "") as any | undefined;

        if (!combatant) return;

        // Permissions check
        const canUndo = game.user.isGM || combatant.actor?.testUserPermission(game.user, "OWNER");
        if (!canUndo) return ui.notifications.warn("Permission denied.");

        // Determine if we are allowed to undo this specific type
        const log = ((combatant as any).getFlag(SCOPE, "log") as ActionLogEntry[]) || [];
        const entry = log[index];

        if (entry?.type === 'system' && !game.user.isGM) {
            return ui.notifications.warn("Only GMs can undo system-drains.");
        }

        if (!msgId) return;

        // Call restored undoAction with BOTH msgId and index fallbacks
        await ActionManager.removeAction(combatant, msgId);
    }
}

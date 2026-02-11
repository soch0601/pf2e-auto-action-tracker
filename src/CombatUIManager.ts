import { ActionManager, ActionLogEntry } from "./ActionManager";
import { SCOPE } from "./globals";
import { ActorPF2e, CombatantPF2e } from "module-helpers";
import { ActorHandler } from "./ActorHandler";
import { MovementManager } from "./MovementManager";

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
        const isPC = actor.hasPlayerOwner || (actor as any).type === "character";

        // Block visibility only if it's an NPC that the current player doesn't own
        if (!isGM && !isOwner && !isPC) return;

        const log = (c.getFlag(SCOPE, "log") as ActionLogEntry[]) || [];

        const isQuickened = ActorHandler.hasQuickenedSnapshot(actor);
        const maxStandardActions = 3;
        const charMap: Record<string, string> = { "1": "A", "2": "D", "3": "T" };

        // --- 1. Allocation Logic ---
        const actions = log.filter(e => e.type !== 'reaction');
        let quickenedSlot: { entry: ActionLogEntry, index: number } | null = null;
        const standardSlots: { entry: ActionLogEntry, index: number, subIndex: number }[] = [];
        const overspendSlots: { entry: ActionLogEntry, index: number, subIndex: number }[] = [];

        for (const [index, entry] of actions.entries()) {
            let costRemaining = entry.cost;
            const canUseQuickened = entry.isQuickenedEligible;

            // A: Fill Quickened Slot first if eligible
            if (isQuickened && !quickenedSlot && canUseQuickened) {
                quickenedSlot = { entry, index };
                costRemaining -= 1;
            }

            // B: Distribute the REST of the cost to standard or overspend
            for (let i = 0; i < costRemaining; i++) {
                const subIdx = entry.cost - costRemaining + i;
                if (standardSlots.length < maxStandardActions) {
                    standardSlots.push({ entry, index, subIndex: subIdx });
                } else {
                    overspendSlots.push({ entry, index, subIndex: subIdx });
                }
            }
        }

        // --- 2. Rendering Setup ---
        const container = document.createElement("div");
        container.className = "pf2e-auto-action-tracker-container";
        container.addEventListener('click', (e) => e.stopPropagation());

        const actionLine = document.createElement("div");
        actionLine.className = "action-line";
        actionLine.textContent = "Actions: ";

        /**
         * Helper to render individual pips with correct PF2e Action Symbols
         */
        const renderPip = (entry: ActionLogEntry, idx: number, subIdx: number, isGold: boolean, isOver: boolean) => {
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
                iconChar = "A";
            } else {
                const siblingPips = [...standardSlots, ...overspendSlots].filter(s => s.index === idx);
                const firstSubIdxInGroup = siblingPips[0]?.subIndex ?? -1;
                if (subIdx === firstSubIdxInGroup) {
                    iconChar = charMap[siblingPips.length.toString()] || "A";
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
                span.dataset.tooltip = `Used: ${displayLabel}${isGold ? ' (Bonus Action)' : ''}${isOver ? ' (Overspent)' : ''}`;
                span.dataset.msgId = entry.msgId || '';
                span.style.cursor = "pointer";
            }

            span.dataset.icon = iconChar;
            span.textContent = iconChar;

            actionLine.appendChild(span);

            if (isOver && subIdx === entry.cost - 1) {
                const warn = document.createElement("span");
                warn.className = "overspend-exclamation";
                warn.textContent = "!";
                actionLine.appendChild(warn);
            }
        };

        // --- 3. Build the DOM ---

        // Render Quickened Slot
        if (isQuickened) {
            if (quickenedSlot) {
                renderPip(quickenedSlot.entry, quickenedSlot.index, 0, true, false);
            } else {
                const span = document.createElement("span");
                span.className = "action-icon unspent quickened tracker-tooltip";
                span.dataset.tooltip = "Quickened Action (Available)";
                span.textContent = "A";
                actionLine.appendChild(span);
            }
            const divider = document.createElement("span");
            divider.className = "divider";
            divider.textContent = "|";
            actionLine.appendChild(divider);
        }

        // Render Standard (Spent)
        standardSlots.forEach(s => renderPip(s.entry, s.index, s.subIndex, false, false));

        // Render Standard (Unspent)
        const unspentCount = maxStandardActions - standardSlots.length;
        for (let i = 0; i < unspentCount; i++) {
            const span = document.createElement("span");
            span.className = "action-icon unspent tracker-tooltip";
            span.dataset.tooltip = "Available Action";
            span.textContent = "A";
            actionLine.appendChild(span);
        }

        // Render Overspend
        overspendSlots.forEach(s => renderPip(s.entry, s.index, s.subIndex, false, true));

        // --- 3.5 Manual Override Button ---
        if (isGM || isOwner) {
            const addBtn = document.createElement("span");
            // Use 'action-icon' so our global listener catches it, 
            // and 'add-button' for our specific logic.
            addBtn.className = "action-icon add-button tracker-tooltip";
            addBtn.dataset.tooltip = "Add Manual Action";
            addBtn.dataset.combatantId = c.id; // Crucial for the handler
            addBtn.innerHTML = '<i class="fas fa-plus-circle"></i>';
            actionLine.appendChild(addBtn);
        }

        container.appendChild(actionLine);

        // --- 4. Reactions Line ---
        const fullLog = ActionManager.getActions(combatant); // Get the original full log
        const reactionLog = fullLog.filter(e => e.type === 'reaction');
        const maxReactions = (actor.system as any).resources?.reactions?.max || 1;

        const reactionLine = document.createElement("div");
        reactionLine.className = "reaction-line";
        reactionLine.textContent = "Reactions: ";

        for (let i = 0; i < maxReactions; i++) {
            const entry = reactionLog[i];
            const span = document.createElement("span");
            span.className = `action-icon reaction ${entry ? 'spent' : 'unspent'} tracker-tooltip`;
            span.dataset.tooltip = entry?.label || 'Reaction Available';
            span.textContent = "R";

            if (entry) {
                // Find the index of this entry in the ORIGINAL log for the context menu handler
                const originalIndex = fullLog.findIndex(e => e.msgId === entry.msgId);
                span.dataset.msgId = entry.msgId;
                span.dataset.index = originalIndex.toString();
            }

            reactionLine.appendChild(span);
        }
        container.appendChild(reactionLine);

        // --- 5. DOM Injection ---
        const combatantRow = html.querySelector(`[data-combatant-id="${c.id}"]`);
        if (!combatantRow) return;

        const target = combatantRow.querySelector(".token-name, .name-controls");
        if (target) {
            target.querySelector(".pf2e-auto-action-tracker-container")?.remove();
            target.appendChild(container);
        }
    }

    /**
     * Activate listeners for our click targets.  Will disable the other click handlers for our specificically added rows
     */
    static activateListeners(html: HTMLElement) {
        // Capture phase listeners (true) to override Foundry core behavior
        html.addEventListener('click', (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (target?.classList.contains('action-icon')) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                this._handleIconClick(target);
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
                isQuickenedEligible: false
            });
        }
    }

    /**
      * Checks if the current user has permission to modify this specific combatant's tracker.
      */
    private static _canUserModify(target: HTMLElement): boolean {
        const combatantId = target.closest('[data-combatant-id]')?.getAttribute('data-combatant-id');
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

        if (target.classList.contains('add-button') || target.parentElement?.classList.contains('add-button')) {
            const btn = target.classList.contains('add-button') ? target : target.parentElement!;
            const combatantId = btn.dataset.combatantId;
            const combatant = (game.combat as any)?.combatants.get(combatantId);
            if (combatant) return this._showManualActionDialog(combatant);
        }

        const msgId = target.dataset.msgId;

        // Unclickable list
        if (!msgId || msgId === 'System' || MovementManager.isMoveAction(msgId)) return;
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
        const combatantId = target.closest('.combatant')?.getAttribute('data-combatant-id');
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

        // Call restored undoAction with BOTH msgId and index fallbacks
        await ActionManager.removeAction(combatant, msgId || "", index);
    }
}
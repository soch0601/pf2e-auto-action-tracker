import type { ActionLogEntry } from "../ActionLogTypes.ts";
import { getForceBarrageInfo } from "../ActionLogTypes.ts";
import { ActionManager } from "../ActionManager.ts";
import { ComplexActionEngine } from "../complexActions/ComplexActionEngine.ts";
import type { CombatantPF2e } from "module-helpers";

export interface PipRenderModel {
    entry: ActionLogEntry | null;
    slot?: any;
    isGold: boolean;
    isOver: boolean;
    subIdx: number;
    totalCost: number;
}

export class TrackerPipRenderer {
    private static readonly MAX_PIPS = 6;
    private static readonly CHAR_MAP: Record<string, string> = { "1": "A", "2": "D", "3": "T" };

    /**
     * Builds the ordered pip models for all action slots and overspent actions.
     */
    static buildActionPipModels(actionSlots: any[], overspentActions: ActionLogEntry[]): PipRenderModel[] {
        const pipsToRender: PipRenderModel[] = [];

        for (const slot of actionSlots) {
            if (slot.spentBy) {
                const subIdx = pipsToRender.filter(p => p.entry === slot.spentBy).length;
                pipsToRender.push({
                    entry: slot.spentBy,
                    slot,
                    isGold: !slot.isBase,
                    isOver: false,
                    subIdx,
                    totalCost: ActionManager.getEntryCost(slot.spentBy)
                });
            } else {
                pipsToRender.push({
                    entry: null,
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
            const totalCost = ActionManager.getEntryCost(entry);
            const remainingCost = totalCost - assignedPips;
            for (let i = 0; i < remainingCost; i++) {
                pipsToRender.push({
                    entry,
                    isGold: false,
                    isOver: true,
                    subIdx: assignedPips + i,
                    totalCost: totalCost
                });
            }
        }

        return pipsToRender;
    }

    /**
     * Renders an individual action pip into the actionLine container.
     */
    static renderActionPip(
        pip: PipRenderModel,
        pipsToRender: PipRenderModel[],
        flattenedLog: ActionLogEntry[],
        state: { pipsRendered: number; overflowCount: number; hasRenderedOverspent: boolean },
        actionLine: HTMLElement
    ) {
        const isOver = !!pip.isOver;

        // Strictly allow only ONE overspent pip to be rendered
        if (isOver && state.hasRenderedOverspent) {
            state.overflowCount++;
            return;
        }

        // Normal MAX_PIPS capping for unspent/spent actions
        if (state.pipsRendered >= this.MAX_PIPS) {
            if (isOver && !state.hasRenderedOverspent) {
                // First overspent pip is permitted
            } else {
                if (isOver) state.overflowCount++;
                return;
            }
        }

        if (isOver) {
            state.hasRenderedOverspent = true;
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
            state.pipsRendered++;
            return;
        }

        const entry = pip.entry;
        const isGold = pip.isGold;

        const message = game.messages.get(entry.msgId || "");

        // 1. Determine Visibility
        let canSeeMessage = message ? message.visible : true;
        if (message) {
            const userId = game.user?.id;
            const isGM = game.user?.isGM;
            const isAuthor = message.author?.id === userId;
            const isWhisperedToMe = message.whisper.includes(userId || "");

            canSeeMessage = isGM || isAuthor || isWhisperedToMe || (message.whisper.length === 0 && !message.blind);
        }

        const displayLabel = canSeeMessage ? entry.label : "Secret Action";
        const span = document.createElement("span");

        // 2. Logic for Icons (A, D, T)
        let iconChar = "";
        if (isGold) {
            iconChar = "A";
        } else {
            const normalPipsForEntry = pipsToRender.filter(p => p.entry === entry && !p.isGold);
            const normalTotalCost = normalPipsForEntry.length;
            const normalSubIdx = normalPipsForEntry.indexOf(pip);

            if (normalSubIdx === 0) {
                iconChar = this.CHAR_MAP[normalTotalCost.toString()] || "A";
            }
        }

        // 3. Security & Interaction
        span.className = `action-icon spent ${isGold ? 'quickened' : ''} ${isOver ? 'overspend-pip' : ''} tracker-tooltip`;

        if (!canSeeMessage) {
            span.style.cursor = "default";
            span.dataset.tooltip = `Used: Secret Action${isGold ? ' (Bonus Action)' : ''}`;
            span.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
            }, { capture: true });
        } else {
            let suffix = '';
            if (pip.slot && pip.slot.definition) suffix = ` (${pip.slot.definition.name})`;
            else if (isGold) suffix = ` (Bonus Action)`;

            const fbInfo = getForceBarrageInfo(entry, flattenedLog);
            const fullTooltip = `Used: ${displayLabel}${suffix}${isOver ? ' (Overspent)' : ''}${fbInfo ? ` - ${fbInfo}` : ''}`;
            span.dataset.tooltip = fullTooltip.replace(/\n/g, "<br>");

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
        state.pipsRendered++;

        if (isOver) {
            const warn = document.createElement("span");
            warn.className = "overspend-exclamation";
            warn.textContent = "!";
            actionLine.appendChild(warn);
        }
    }

    /**
     * Renders the action control button (either finish complex action or add manual action).
     */
    static renderActionButton(combatant: CombatantPF2e, actionLine: HTMLElement) {
        const c = combatant as any;
        const lastAction = ActionManager.getLastAction(combatant);
        const lastSpecialAction = lastAction?.entry.ComplexActionState;
        const activeSpecialAction = !ComplexActionEngine.isComplete(lastSpecialAction);

        if (lastSpecialAction && activeSpecialAction) {
            const finishBtn = document.createElement("span");
            const canComplete = ComplexActionEngine.canComplete(lastSpecialAction);

            finishBtn.className = `action-icon finish-button tracker-tooltip ${!canComplete ? 'disabled' : ''}`;
            finishBtn.dataset.tooltip = canComplete ? `Finish ${ComplexActionEngine.getName(lastSpecialAction)}` : `Waiting for requirements...`;
            finishBtn.dataset.combatantId = c.id;
            finishBtn.innerHTML = '<i class="fas fa-check-circle"></i>';

            if (!canComplete) {
                finishBtn.style.opacity = "0.4";
                finishBtn.style.cursor = "not-allowed";
            }

            actionLine.appendChild(finishBtn);
        } else {
            const addBtn = document.createElement("span");
            addBtn.className = "action-icon add-button tracker-tooltip";
            addBtn.dataset.tooltip = "Add Manual Action";
            addBtn.dataset.combatantId = c.id;
            addBtn.innerHTML = '<i class="fas fa-plus-circle"></i>';
            actionLine.appendChild(addBtn);
        }
    }

    /**
     * Renders reaction slots into the appropriate container.
     */
    static renderReactionSlots(
        combatant: CombatantPF2e,
        reactionSlots: any[],
        targetContainer: HTMLElement
    ) {
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

            span.dataset.tooltip = tooltip.replace(/\n/g, "<br>");
            span.textContent = "R";

            if (entry) {
                const fullLog = ActionManager.getActions(combatant);
                const originalIndex = fullLog.findIndex(e => e.msgId === entry.msgId);
                span.dataset.msgId = entry.msgId;
                span.dataset.index = originalIndex.toString();
            }

            targetContainer.appendChild(span);
        });
    }
}

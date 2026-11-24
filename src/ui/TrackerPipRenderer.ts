import type { ActionLogEntry } from "../ActionLogTypes.ts";
import { getForceBarrageInfo } from "../ActionLogTypes.ts";
import { ActionManager } from "../ActionManager.ts";
import { ComplexActionEngine } from "../complexActions/ComplexActionEngine.ts";
import { SummonManager } from "../summons/index.ts";
import type { CombatantPF2e } from "module-helpers";

export interface PipRenderModel {
    entry: ActionLogEntry | null;
    slot?: any;
    isGold: boolean;
    isOver: boolean;
    isLocked?: boolean;
    subIdx: number;
    totalCost: number;
}

export class TrackerPipRenderer {
    private static readonly MAX_PIPS = 6;
    private static readonly MINION_DEFAULT_PIPS = 2;
    private static readonly CHAR_MAP: Record<string, string> = { "1": "A", "2": "D", "3": "T" };

    /**
     * Builds the ordered pip models for all action slots and overspent actions.
     * For uncommanded minions (0 slots), pads up to 2 locked pips (plus 1 locked gold Quickened pip if quickened)
     * so the tracker row height/width never jumps when commanded.
     */
    static buildActionPipModels(
        actionSlots: any[],
        overspentActions: ActionLogEntry[],
        isMinion: boolean = false,
        hasQuickenedSnapshot: boolean = false
    ): PipRenderModel[] {
        const pipsToRender: PipRenderModel[] = [];

        for (const slot of actionSlots) {
            if (slot.spentBy) {
                const subIdx = pipsToRender.filter(p => p.entry === slot.spentBy).length;
                pipsToRender.push({
                    entry: slot.spentBy,
                    slot,
                    isGold: !slot.isBase,
                    isOver: false,
                    isLocked: false,
                    subIdx,
                    totalCost: ActionManager.getEntryCost(slot.spentBy)
                });
            } else {
                pipsToRender.push({
                    entry: null,
                    slot,
                    isGold: !slot.isBase,
                    isOver: false,
                    isLocked: false,
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
                    isLocked: false,
                    subIdx: assignedPips + i,
                    totalCost: totalCost
                });
            }
        }

        // Pad uncommanded minions with locked pips so the UI never jumps when commanded
        if (isMinion && actionSlots.length === 0) {
            if (hasQuickenedSnapshot) {
                pipsToRender.unshift({
                    entry: null,
                    isGold: true,
                    isOver: false,
                    isLocked: true,
                    subIdx: 0,
                    totalCost: 1
                });
            }
            const nonGoldCount = pipsToRender.filter(p => !p.isGold).length;
            if (nonGoldCount < this.MINION_DEFAULT_PIPS) {
                const needed = this.MINION_DEFAULT_PIPS - nonGoldCount;
                for (let i = 0; i < needed; i++) {
                    pipsToRender.push({
                        entry: null,
                        isGold: false,
                        isOver: false,
                        isLocked: true,
                        subIdx: 0,
                        totalCost: 1
                    });
                }
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
        if (!this.shouldRenderPip(isOver, state)) return;

        if (!pip.entry) {
            if (pip.isLocked) {
                this.renderLockedPip(pip, actionLine);
            } else {
                this.renderUnspentPip(pip, actionLine);
            }
            state.pipsRendered++;
            return;
        }

        const entry = pip.entry;
        const message = game.messages.get(entry.msgId || "");
        const canSeeMessage = this.canCurrentUserSeeMessage(message);
        const iconChar = this.getSpentPipIconChar(pip, entry, pipsToRender);

        const span = document.createElement("span");
        span.className = `action-icon spent ${pip.isGold ? 'quickened' : ''} ${isOver ? 'overspend-pip' : ''} tracker-tooltip`;
        span.dataset.icon = iconChar;
        span.textContent = iconChar;

        if (!canSeeMessage) {
            this.configureSecretPip(span, pip.isGold);
        } else {
            this.configureVisiblePip(span, pip, entry, flattenedLog);
        }

        actionLine.appendChild(span);
        state.pipsRendered++;

        if (isOver) {
            const warn = document.createElement("span");
            warn.className = "overspend-exclamation";
            warn.textContent = "!";
            actionLine.appendChild(warn);
        }
    }

    private static shouldRenderPip(
        isOver: boolean,
        state: { pipsRendered: number; overflowCount: number; hasRenderedOverspent: boolean }
    ): boolean {
        // Strictly allow only ONE overspent pip to be rendered
        if (isOver && state.hasRenderedOverspent) {
            state.overflowCount++;
            return false;
        }

        // Normal MAX_PIPS capping for unspent/spent actions (first overspent pip is still permitted)
        if (state.pipsRendered >= this.MAX_PIPS && !(isOver && !state.hasRenderedOverspent)) {
            if (isOver) state.overflowCount++;
            return false;
        }

        if (isOver) {
            state.hasRenderedOverspent = true;
        }

        return true;
    }

    private static renderLockedPip(pip: PipRenderModel, actionLine: HTMLElement) {
        const span = document.createElement("span");
        span.className = `action-icon locked ${pip.isGold ? 'quickened' : ''} tracker-tooltip`.trim();
        span.dataset.tooltip = pip.isGold
            ? "Uncommanded Quickened Action — Sustain or Command to unlock"
            : "Uncommanded (0 Actions) — Sustain or Command to unlock";
        span.textContent = "A";
        actionLine.appendChild(span);
    }

    private static renderUnspentPip(pip: PipRenderModel, actionLine: HTMLElement) {
        const span = document.createElement("span");
        span.className = `action-icon unspent ${pip.isGold ? 'quickened' : ''} tracker-tooltip`;

        let tooltip = "Available Action";
        if (pip.slot?.definition) {
            tooltip = `Available Action (${pip.slot.definition.name})`;
        } else if (pip.isGold) {
            tooltip = "Available Bonus Action";
        }

        span.dataset.tooltip = tooltip;
        span.textContent = "A";
        actionLine.appendChild(span);
    }

    private static canCurrentUserSeeMessage(message: any): boolean {
        if (!message) return true;

        const userId = game.user?.id;
        const isGM = !!game.user?.isGM;
        const isAuthor = message.author?.id === userId;
        const isWhisperedToMe = message.whisper.includes(userId || "");

        return isGM || isAuthor || isWhisperedToMe || (message.whisper.length === 0 && !message.blind);
    }

    private static getSpentPipIconChar(pip: PipRenderModel, entry: ActionLogEntry, pipsToRender: PipRenderModel[]): string {
        if (pip.isGold) return "A";

        const normalPipsForEntry = pipsToRender.filter(p => p.entry === entry && !p.isGold);
        const normalSubIdx = normalPipsForEntry.indexOf(pip);
        if (normalSubIdx !== 0) return "";

        return this.CHAR_MAP[normalPipsForEntry.length.toString()] || "A";
    }

    private static configureSecretPip(span: HTMLElement, isGold: boolean) {
        span.style.cursor = "default";
        span.dataset.tooltip = `Used: Secret Action${isGold ? ' (Bonus Action)' : ''}`;
        span.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
        }, { capture: true });
    }

    private static configureVisiblePip(
        span: HTMLElement,
        pip: PipRenderModel,
        entry: ActionLogEntry,
        flattenedLog: ActionLogEntry[]
    ) {
        let suffix = '';
        if (pip.slot?.definition) suffix = ` (${pip.slot.definition.name})`;
        else if (pip.isGold) suffix = ` (Bonus Action)`;

        const fbInfo = getForceBarrageInfo(entry, flattenedLog);
        const fullTooltip = `Used: ${entry.label}${suffix}${pip.isOver ? ' (Overspent)' : ''}${fbInfo ? ` - ${fbInfo}` : ''}`;
        span.dataset.tooltip = fullTooltip.replace(/\n/g, "<br>");

        if (entry.type === "system" || entry.msgId === "System") {
            span.style.cursor = "default";
        } else {
            span.dataset.msgId = entry.msgId || '';
            span.style.cursor = "pointer";
        }
    }

    /**
     * Renders the action control button (either finish complex action or add manual action),
     * plus a grant/command toggle button on summoned minion rows.
     */
    static renderActionButton(combatant: CombatantPF2e, actionLine: HTMLElement) {
        const c = combatant as any;

        if (SummonManager.isMinion(combatant)) {
            const granted = SummonManager.getGrantedActions(combatant);
            const grantBtn = document.createElement("span");
            grantBtn.className = `action-icon grant-button tracker-tooltip ${granted > 0 ? 'granted' : ''}`;
            grantBtn.dataset.tooltip = granted > 0
                ? "Minion Commanded (2 Actions) — Click to revoke"
                : "Grant 2 Minion Actions (Command / Free Sustain)";
            grantBtn.dataset.combatantId = c.id;
            grantBtn.innerHTML = '<i class="fas fa-bolt"></i>';
            actionLine.appendChild(grantBtn);
        }

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
     * For minions (0 reaction slots), renders a locked reaction pip so the 2-line height remains constant.
     */
    static renderReactionSlots(
        combatant: CombatantPF2e,
        reactionSlots: any[],
        targetContainer: HTMLElement
    ) {
        if (reactionSlots.length === 0 && SummonManager.isMinion(combatant)) {
            const span = document.createElement("span");
            span.className = "action-icon reaction locked tracker-tooltip";
            span.dataset.tooltip = "Minions cannot use reactions";
            span.textContent = "R";
            targetContainer.appendChild(span);
            return;
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

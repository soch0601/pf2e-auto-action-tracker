import type { CombatantPF2e } from "module-helpers";
import { ActorPF2e } from "module-helpers";
import { ActionManager } from "../ActionManager.ts";
import { ActorManager } from "../ActorManager.ts";
import { DBManager } from "../DBManager.ts";
import {
    canShowManualActionButton,
    getTrackerRenderKey,
    hasCompactOverspendTint,
    resolveMapMountTarget,
    resolveTrackerMount,
    shouldShowTrackerForMount
} from "../trackerAdapters.ts";
import { getMapDisplayState } from "../mapTracker.ts";
import { TrackerPipRenderer } from "./TrackerPipRenderer.ts";
import { ActionTrackerEvents } from "./ActionTrackerEvents.ts";

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
     * Inject the action tracking icons into each combatant's frame. Will allow GM to see everyone's, but players
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

        const log = DBManager.getLog(combatant);
        const flattenedLog = ActionManager.getFlattenedActions(combatant);

        const actionSlotsForRenderKey = ActorManager.getSlots(combatant, 'action');
        const reactionSlotsForRenderKey = ActorManager.getSlots(combatant, 'reaction');

        const actionSlotsKey = actionSlotsForRenderKey.map(s => s.definition?.slug || 'base').join(',');
        const currentMAP = ActionManager.getCurrentMAP(combatant);
        const mapDisplay = getMapDisplayState(currentMAP);
        const maxReactions = reactionSlotsForRenderKey.length;
        const renderKeyLog = flattenedLog.map(entry => {
            const message = game.messages.get(entry.msgId || "");
            const visibilityKey = message
                ? `${message.visible ? 1 : 0}:${message.blind ? 1 : 0}:${message.whisper.join(",")}:${message.author?.id ?? ""}`
                : "";
            return { ...entry, cost: ActionManager.getEntryCost(entry, flattenedLog), visibilityKey };
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

        // --- 1. Allocation Logic ---
        const { slots: actionSlots, overspent: overspentActions } = ActorManager.allocateSlots(combatant, log, 'action');
        const pipsToRender = TrackerPipRenderer.buildActionPipModels(actionSlots, overspentActions);

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

        const pipState = {
            pipsRendered: 0,
            overflowCount: 0,
            hasRenderedOverspent: false
        };
        const MAX_PIPS = 6;

        // --- 3. Build the DOM ---
        for (let i = 0; i < pipsToRender.length; i++) {
            const pip = pipsToRender[i];
            TrackerPipRenderer.renderActionPip(pip, pipsToRender, flattenedLog, pipState, actionLine);

            // Add divider if transitioning from gold to non-gold
            if (pip.isGold && i < pipsToRender.length - 1 && !pipsToRender[i + 1].isGold) {
                const divider = document.createElement("span");
                divider.className = "divider";
                divider.textContent = "|";
                actionLine.appendChild(divider);
            }
        }

        const overflowCount = pipState.overflowCount;

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

        // Render Manual override or special action finish button
        if (canShowManualActionButton(isGM, isOwner)) {
            TrackerPipRenderer.renderActionButton(combatant, actionLine);
        }

        container.appendChild(actionLine);

        // --- 4. Reactions Line ---
        const { slots: reactionSlots } = ActorManager.allocateSlots(combatant, log, 'reaction');

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

        TrackerPipRenderer.renderReactionSlots(combatant, reactionSlots, isCompact ? actionLine : reactionLine);

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
     * Activate listeners for our click targets. Will disable other click handlers for our specifically added rows.
     */
    static activateListeners(html: HTMLElement) {
        ActionTrackerEvents.activateListeners(html);
    }
}

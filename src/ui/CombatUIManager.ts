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
import { SummonManager, type VirtualMinionCombatant } from "../summons/index.ts";

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

        // If Summons Tracking is active and this top-level combatant in game.combat is actually a summoned minion
        // belonging to another combatant in the encounter, hide its duplicate top-level row so it only displays
        // indented beneath its controller.
        if (SummonManager.isEnabled() && !c.isVirtualMinion && SummonManager.isEligibleSummonedMinionActor(actor)) {
            const controller = SummonManager.findControllerCombatant((globalThis as any).game?.combat, actor);
            if (controller && controller.id !== c.id) {
                const mount = resolveTrackerMount(html, c.id);
                if (mount?.row) {
                    mount.row.style.display = "none";
                }
                return;
            }
        }

        const isGM = (game as any).user.isGM;
        const isOwner = actor.isOwner;
        const mount = resolveTrackerMount(html, c.id);
        if (!mount) return;
        const mapMountTarget = resolveMapMountTarget(html, c.id);
        const isCompact = mount.mode === "pf2e-hud";
        const isPC = actor.hasPlayerOwner || (actor as any).type === "character";

        if (!shouldShowTrackerForMount(mount.mode, isGM, isOwner, isPC)) return;

        const isMinion = SummonManager.isMinion(combatant);
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

        // Include minion summary in the controller's render key so PF2e HUD MutationObserver re-renders when minions change
        const minions = (!isMinion && SummonManager.isEnabled())
            ? SummonManager.getSummonedMinionsForCombatant(combatant)
            : [];
        const minionsKey = minions.map(m => {
            const mLog = DBManager.getLog(m as any);
            const mGranted = SummonManager.getGrantedActions(m);
            const mDefeated = m.isDefeated ? 1 : 0;
            const mLogStr = mLog.map(e => `${e.msgId}:${ActionManager.getEntryCost(e, mLog)}`).join(",");
            return `${m.id}:${mGranted}:${mDefeated}:${mLogStr}`;
        }).join(";");

        const baseRenderKey = getTrackerRenderKey({
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
        const renderKey = minionsKey ? `${baseRenderKey}|minions:${minionsKey}` : baseRenderKey;

        const existingContainer = mount.target.querySelector(":scope > .pf2e-auto-action-tracker-container") as HTMLElement | null
            ?? mount.target.querySelector(".pf2e-auto-action-tracker-container") as HTMLElement | null;
        const existingMapContainer = mapMountTarget?.querySelector(".pf2e-auto-action-tracker-map-container") as HTMLElement | null;
        if (isCompact && canReuseTrackerRender(existingContainer?.dataset.renderKey, renderKey, !!mapMountTarget, mapDisplay.visible, existingMapContainer?.dataset.renderKey)) {
            return;
        }

        // --- 1. Build Tracker Container ---
        const { container, overflowCount } = this.buildTrackerContainerDom(
            combatant,
            mount.mode,
            isCompact,
            isGM,
            isOwner,
            isMinion,
            log,
            flattenedLog,
            mapDisplay,
            !!mapMountTarget,
            renderKey
        );

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

        // --- 6. Render Summoned Minion Sub-Rows Under Controller ---
        this.renderMinionSubRows(mount, combatant, minions, isCompact, isGM, isOwner);
    }

    /**
     * Builds the `.pf2e-auto-action-tracker-container` DOM element for either a normal combatant or a summoned minion.
     */
    static buildTrackerContainerDom(
        combatant: CombatantPF2e,
        mode: "core" | "pf2e-hud",
        isCompact: boolean,
        isGM: boolean,
        isOwner: boolean,
        isMinion: boolean,
        log: readonly any[],
        flattenedLog: any[],
        mapDisplay: any,
        hasMapMountTarget: boolean,
        renderKey: string
    ): { container: HTMLElement; overflowCount: number } {
        const { slots: actionSlots, overspent: overspentActions } = ActorManager.allocateSlots(combatant, log, 'action');
        const hasQuickened = ActorManager.hasQuickenedSnapshot(combatant);
        const pipsToRender = TrackerPipRenderer.buildActionPipModels(actionSlots, overspentActions, isMinion, hasQuickened);

        const container = document.createElement("div");
        container.className = `pf2e-auto-action-tracker-container ${isCompact ? 'compact' : 'standard'} ${isMinion ? 'minion-tracker' : ''}`.trim();
        container.dataset.trackerMode = mode;
        container.dataset.renderKey = renderKey;
        container.dataset.combatantId = (combatant as any).id;
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

        let compactOverspend = false;
        if (isCompact) {
            compactOverspend = hasCompactOverspendTint(overflowCount);
        }

        if (compactOverspend) {
            actionLine.classList.add("compact-overspent");
        }

        if (isCompact && mapDisplay.visible && !hasMapMountTarget) {
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

        if (canShowManualActionButton(isGM, isOwner)) {
            TrackerPipRenderer.renderActionButton(combatant, actionLine);
        }

        container.appendChild(actionLine);

        // Reactions Line
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

        return { container, overflowCount };
    }

    /**
     * Renders indented sub-rows directly BELOW the controller's combatant row for all summoned minions belonging to that controller.
     */
    private static renderMinionSubRows(
        mount: { mode: "core" | "pf2e-hud"; row: any; target: any },
        controllerCombatant: CombatantPF2e,
        minions: VirtualMinionCombatant[],
        isCompact: boolean,
        isGM: boolean,
        isControllerOwner: boolean
    ) {
        const hostRow = mount.row as HTMLElement | null;
        if (!hostRow) return;

        const controllerId = (controllerCombatant as any).id;
        const parentList = hostRow.parentElement;

        // Remove any existing minion rows for this controller before re-inserting
        if (parentList && typeof parentList.querySelectorAll === "function") {
            const existingMinionRows = parentList.querySelectorAll(
                `.pf2e-auto-action-tracker-minion-row[data-controller-combatant-id="${controllerId}"], .pf2e-auto-action-tracker-minion-list[data-controller-combatant-id="${controllerId}"]`
            );
            existingMinionRows.forEach((el: Element) => el.remove());
        } else if (typeof hostRow.querySelector === "function") {
            const legacyInsideList = hostRow.querySelector(".pf2e-auto-action-tracker-minion-list");
            legacyInsideList?.remove();
        }

        if (!SummonManager.isEnabled() || minions.length === 0) {
            return;
        }

        let insertAfterEl: HTMLElement = hostRow;

        for (const minion of minions) {
            const isOwner = isControllerOwner || Boolean(minion.actor?.isOwner);
            const rowTag = hostRow.tagName === "LI" ? "li" : "div";
            const minionRow = document.createElement(rowTag);
            minionRow.className = `pf2e-auto-action-tracker-minion-row ${isCompact ? "compact" : "standard"} ${minion.isDefeated ? "defeated" : ""} ${minion.hidden ? "hidden-token" : ""}`.trim();
            minionRow.dataset.combatantId = minion.id;
            minionRow.dataset.controllerCombatantId = controllerId;
            minionRow.dataset.tokenId = minion.tokenId;
            minionRow.addEventListener("click", (e) => e.stopPropagation());

            // Portrait + Defeated overlay
            const portraitWrap = document.createElement("div");
            portraitWrap.className = "minion-portrait-wrap";

            const img = document.createElement("img");
            img.className = "minion-token-image";
            img.src = minion.img;
            img.alt = minion.name;
            portraitWrap.appendChild(img);

            if (minion.isDefeated) {
                const skull = document.createElement("span");
                skull.className = "minion-defeated-overlay tracker-tooltip";
                skull.dataset.tooltip = "Defeated";
                skull.innerHTML = '<i class="fas fa-skull"></i>';
                portraitWrap.appendChild(skull);
            }

            // Clicking portrait/header selects and pans to the minion token on the canvas
            const selectAndPanMinion = (event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                const tokenObj = minion.tokenDoc?.object ?? (globalThis as any).canvas?.tokens?.get?.(minion.tokenId);
                if (tokenObj) {
                    tokenObj.control?.({ releaseOthers: true });
                    (globalThis as any).canvas?.animatePan?.({ x: tokenObj.center?.x ?? tokenObj.x, y: tokenObj.center?.y ?? tokenObj.y });
                }
            };

            const hoverInMinion = (event: MouseEvent) => {
                const tokenObj = minion.tokenDoc?.object ?? (globalThis as any).canvas?.tokens?.get?.(minion.tokenId);
                tokenObj?._onHoverIn?.(event);
            };

            const hoverOutMinion = (event: MouseEvent) => {
                const tokenObj = minion.tokenDoc?.object ?? (globalThis as any).canvas?.tokens?.get?.(minion.tokenId);
                tokenObj?._onHoverOut?.(event);
            };

            portraitWrap.addEventListener("click", selectAndPanMinion);
            minionRow.addEventListener("mouseenter", hoverInMinion);
            minionRow.addEventListener("mouseleave", hoverOutMinion);

            // Details column (Name + status icons + 2-line action tracker)
            const detailsCol = document.createElement("div");
            detailsCol.className = "minion-details";

            const nameHeader = document.createElement("div");
            nameHeader.className = "minion-name-header";
            nameHeader.addEventListener("click", selectAndPanMinion);

            const nameSpan = document.createElement("span");
            nameSpan.className = "minion-name";
            nameSpan.textContent = minion.name;
            nameHeader.appendChild(nameSpan);

            if (minion.isDefeated) {
                const statusSkull = document.createElement("i");
                statusSkull.className = "fas fa-skull minion-status-icon defeated-icon tracker-tooltip";
                statusSkull.dataset.tooltip = "Defeated";
                nameHeader.appendChild(statusSkull);
            }

            if (minion.hidden) {
                const hiddenIcon = document.createElement("i");
                hiddenIcon.className = "fas fa-eye-slash minion-status-icon hidden-icon tracker-tooltip";
                hiddenIcon.dataset.tooltip = "Hidden";
                nameHeader.appendChild(hiddenIcon);
            }

            detailsCol.appendChild(nameHeader);

            const mLog = DBManager.getLog(minion as any);
            const mFlattenedLog = ActionManager.getFlattenedActions(minion as any);
            const mMAP = ActionManager.getCurrentMAP(minion as any);
            const mMapDisplay = getMapDisplayState(mMAP);

            const { container: minionTracker } = this.buildTrackerContainerDom(
                minion as any,
                mount.mode,
                isCompact,
                isGM,
                isOwner,
                true,
                mLog,
                mFlattenedLog,
                mMapDisplay,
                false,
                `minion-render-${minion.id}`
            );

            detailsCol.appendChild(minionTracker);
            minionRow.appendChild(portraitWrap);
            minionRow.appendChild(detailsCol);

            if (typeof insertAfterEl.after === "function") {
                insertAfterEl.after(minionRow);
                insertAfterEl = minionRow;
            } else if (parentList && typeof parentList.insertBefore === "function") {
                parentList.insertBefore(minionRow, insertAfterEl.nextSibling);
                insertAfterEl = minionRow;
            } else if (typeof hostRow.appendChild === "function") {
                hostRow.appendChild(minionRow);
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

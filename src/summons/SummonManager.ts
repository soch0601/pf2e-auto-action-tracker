import { SCOPE } from "../globals.ts";
import { getCombatants, isCurrentUserActiveGM } from "../foundryCompat.ts";
import type { ActorPF2e } from "module-helpers";
import {
    MINION_ID_PREFIX,
    getSummonerInfoFromActor,
    isActorSummonedByCombatant,
    isEidolonActor,
    isEligibleSummonedMinionActor,
    isSummonsTrackingEnabled
} from "./summonCompat.ts";
import { VirtualMinionCombatant } from "./VirtualMinionCombatant.ts";
import { MovementHistoryService } from "../MovementHistoryService.ts";

export class SummonManager {
    private static virtualCache = new Map<string, VirtualMinionCombatant>();

    /**
     * Central check for whether PF2e Summons Assistant minion tracking is active.
     */
    static isEnabled(): boolean {
        return isSummonsTrackingEnabled();
    }

    /**
     * Checks if an actor is an Eidolon (TODO: Not tested).
     */
    static isEidolonActor(actor: any): boolean {
        return isEidolonActor(actor);
    }

    /**
     * Checks if an actor is an eligible summoned minion from PF2e Summons Assistant.
     */
    static isEligibleSummonedMinionActor(actor: any, tokenDoc?: any): boolean {
        return isEligibleSummonedMinionActor(actor, tokenDoc);
    }

    /**
     * Returns the summoner info ({ id, uuid }) stored by PF2e Summons Assistant on a summoned actor.
     */
    static getSummonerInfo(actor: any, tokenDoc?: any): { id?: string; uuid?: string } | undefined {
        return getSummonerInfoFromActor(actor, tokenDoc);
    }

    /**
     * Determines if a given actor is summoned by the specified controller combatant.
     */
    static isActorSummonedByCombatant(actor: any, controllerCombatant: any, tokenDoc?: any): boolean {
        return isActorSummonedByCombatant(actor, controllerCombatant, tokenDoc);
    }

    /**
     * Retrieves all token documents on the current scene.
     */
    static getSceneTokenDocs(combat?: any): any[] {
        const scene =
            combat?.scene ??
            (globalThis as any).canvas?.scene ??
            (globalThis as any).game?.scenes?.active;

        const tokens = scene?.tokens;
        if (tokens) {
            if (Array.isArray(tokens)) return tokens;
            if (Array.isArray(tokens.contents)) return tokens.contents;
            if (typeof tokens.values === "function") return Array.from(tokens.values());
        }

        const placeables = (globalThis as any).canvas?.tokens?.placeables;
        if (Array.isArray(placeables)) {
            return placeables.map((p: any) => p.document ?? p).filter(Boolean);
        }

        return [];
    }

    /**
     * Wraps a minion TokenDocument in a VirtualMinionCombatant (or returns cached instance).
     */
    static getOrCreateVirtualCombatant(tokenDoc: any, controllerCombatant: any): VirtualMinionCombatant {
        const existing = this.virtualCache.get(tokenDoc.id);
        if (existing && existing.tokenDoc === tokenDoc && existing.controllerCombatant === controllerCombatant) {
            return existing;
        }
        const virtual = new VirtualMinionCombatant(tokenDoc, controllerCombatant);
        this.virtualCache.set(tokenDoc.id, virtual);
        return virtual;
    }

    /**
     * Finds all active summoned minions on the scene belonging to a controller combatant.
     */
    static getSummonedMinionsForCombatant(controllerCombatant: any, combat?: any): VirtualMinionCombatant[] {
        if (!this.isEnabled() || !controllerCombatant) return [];
        // Don't nest minions under another minion
        if (this.isMinion(controllerCombatant)) return [];

        const tokenDocs = this.getSceneTokenDocs(combat);
        const minions: VirtualMinionCombatant[] = [];

        for (const tokenDoc of tokenDocs) {
            const actor = tokenDoc.actor;
            if (this.isActorSummonedByCombatant(actor, controllerCombatant, tokenDoc)) {
                minions.push(this.getOrCreateVirtualCombatant(tokenDoc, controllerCombatant));
            }
        }

        return minions;
    }

    /**
     * Returns the tokenIds of every minion this controller has summoned via the given sustained spell, based on
     * the persisted `minions` flag on the controller combatant. Unlike scene discovery, this still knows about
     * minions whose tokens were deleted (e.g. banished at 0 HP), which lets us tell "the summon is gone" apart
     * from "this sustained spell was never a summon".
     */
    static getLinkedMinionTokenIdsForSpell(controllerCombatant: any, itemId: string, itemName?: string): Set<string> {
        const result = new Set<string>();
        if (!this.isEnabled() || !controllerCombatant) return result;
        const store: Record<string, any> =
            controllerCombatant.getFlag?.(SCOPE, "minions") ??
            controllerCombatant.flags?.[SCOPE]?.minions ??
            {};
        const lowerName = (itemName || "").toLowerCase();
        for (const [tokenId, data] of Object.entries(store)) {
            const mId = data?.summonedByItemId;
            const mName = ((data?.summonedByItemName as string) || "").toLowerCase();
            if (mId && mId === itemId) {
                result.add(tokenId);
            } else if (!mId && mName && lowerName && (mName === lowerName || lowerName.includes(mName) || mName.includes(lowerName))) {
                result.add(tokenId);
            }
        }
        return result;
    }

    /**
     * Finds the controller combatant in the given combat for a summoned minion actor or token.
     */
    static findControllerCombatant(combat: any, minionActor: any, tokenDoc?: any): any | undefined {
        if (!this.isEnabled() || !combat || !this.isEligibleSummonedMinionActor(minionActor, tokenDoc)) {
            return undefined;
        }
        const combatants = getCombatants(combat);
        return combatants.find((c: any) => !this.isMinion(c) && this.isActorSummonedByCombatant(minionActor, c, tokenDoc));
    }

    /**
     * Resolves a VirtualMinionCombatant by virtual ID ("minion-<tokenId>"), tokenId, or actorId.
     */
    static resolveMinionCombatant(combat: any, idOrTokenId?: string | null, actorId?: string | null): VirtualMinionCombatant | undefined {
        if (!this.isEnabled() || !combat) return undefined;

        const rawTokenId = idOrTokenId?.startsWith(MINION_ID_PREFIX)
            ? idOrTokenId.slice(MINION_ID_PREFIX.length)
            : idOrTokenId;

        const tokenDocs = this.getSceneTokenDocs(combat);
        for (const tokenDoc of tokenDocs) {
            const matchesToken = rawTokenId && tokenDoc.id === rawTokenId;
            const matchesActor = !rawTokenId && actorId && (tokenDoc.actor?.id === actorId || tokenDoc.actorId === actorId);

            if (matchesToken || matchesActor) {
                const controller = this.findControllerCombatant(combat, tokenDoc.actor, tokenDoc);
                if (controller) {
                    return this.getOrCreateVirtualCombatant(tokenDoc, controller);
                }
            }
        }
        return undefined;
    }

    /**
     * Checks if a combatant (virtual or real) is a tracked summoned minion.
     */
    static isMinion(combatant: any): boolean {
        if (!this.isEnabled() || !combatant) return false;
        if (combatant.isVirtualMinion) return true;
        return this.isEligibleSummonedMinionActor(combatant.actor);
    }

    /**
     * Gets the controlling actor for a minion (or returns the actor itself if not a minion),
     * used for routing overspend/underspend alerts to the controlling player.
     */
    static getAlertTargetActor(combatantOrActor: any): ActorPF2e | undefined {
        if (!combatantOrActor) return undefined;
        if (!this.isEnabled()) {
            return combatantOrActor.actor ?? combatantOrActor;
        }

        if (combatantOrActor.isVirtualMinion && combatantOrActor.controllerCombatant?.actor) {
            return combatantOrActor.controllerCombatant.actor;
        }

        const actor = combatantOrActor.actor ?? combatantOrActor;
        const summonerInfo = this.getSummonerInfo(actor);
        if (summonerInfo?.id) {
            const summonerActor = (globalThis as any).game?.actors?.get?.(summonerInfo.id);
            if (summonerActor) return summonerActor;
        }

        const combat = (globalThis as any).game?.combat;
        if (combat && summonerInfo) {
            const controller = this.findControllerCombatant(combat, actor);
            if (controller?.actor) return controller.actor;
        }

        return actor;
    }

    /**
     * Checks if it is currently this combatant's (or its controller's) active turn.
     */
    static isActiveTurnForCombatant(combat: any, combatant: any): boolean {
        if (!combat?.combatant || !combatant) return false;
        const activeId = combat.combatant.id;
        if (activeId === combatant.id) return true;

        if (this.isEnabled()) {
            if (combatant.isVirtualMinion && combatant.controllerCombatant?.id === activeId) {
                return true;
            }
            const controller = this.findControllerCombatant(combat, combatant.actor);
            if (controller?.id === activeId) return true;
        }
        return false;
    }

    /**
     * Returns the number of currently granted actions for a minion (0 when uncommanded, 2 when commanded/sustained).
     */
    static getGrantedActions(minionCombatant: any): number {
        if (!this.isMinion(minionCombatant)) return 3;
        const granted = minionCombatant.getFlag?.(SCOPE, "grantedActions");
        return typeof granted === "number" ? granted : 0;
    }

    /**
     * Grants actions to a minion (defaults to 2), applies PF2e Slowed/Stunned drains when actions are gained
     * (or reverts them if actionsCount === 0), and optionally links the grant to the controller's action msgId.
     */
    static async grantActionsToMinion(
        minionCombatant: any,
        actionsCount: number = 2,
        grantedByMsgId: string | null = null
    ): Promise<void> {
        if (!this.isEnabled() || !minionCombatant) return;

        const actor = minionCombatant.actor;
        let currentLogs = [...((minionCombatant.getFlag?.(SCOPE, "log") as any[]) || [])];
        let stunnedDecrement = (minionCombatant.getFlag?.(SCOPE, "stunnedDecrement") as number) || 0;

        if (actionsCount > 0) {
            // Remove any prior system drain entry before calculating fresh drains
            currentLogs = currentLogs.filter(e => !(e.type === "system" && e.msgId === "System"));

            if (actor) {
                const isQuickened = Boolean(minionCombatant.getFlag?.(SCOPE, "isQuickenedSnapshot"));
                const maxAvailable = actionsCount + (isQuickened ? 1 : 0);

                const findCondition = (slug: string) =>
                    actor.itemTypes?.condition?.find?.((c: any) => c.slug === slug) ??
                    actor.items?.find?.((i: any) => i.slug === slug) ??
                    actor.conditions?.bySlug?.(slug)?.[0];

                const getCondVal = (cond: any, slug: string): number => {
                    if (typeof cond?.value === "number") return cond.value;
                    if (typeof cond?.system?.value?.value === "number") return cond.system.value.value;
                    if (typeof actor.getConditionValue === "function") {
                        const v = actor.getConditionValue(slug);
                        if (typeof v === "number") return v;
                    }
                    if (actor.conditions?.bySlug) {
                        const active = actor.conditions.bySlug(slug, { active: true })?.[0] ?? actor.conditions.bySlug(slug)?.[0];
                        if (typeof active?.value === "number") return active.value;
                    }
                    // Also check if an effect on the actor grants Slowed/Stunned via badge or name (e.g. "Permanently Slowed 1")
                    if (slug === "slowed" && actor.hasCondition?.("slowed")) return 1;
                    return 0;
                };

                const stunnedCondition = findCondition("stunned");
                const stunnedVal = getCondVal(stunnedCondition, "stunned");
                const slowedCondition = findCondition("slowed");
                const slowedVal = getCondVal(slowedCondition, "slowed");
                const isParalyzed = Boolean(actor.hasCondition?.("paralyzed") || findCondition("paralyzed"));

                const totalDrain = isParalyzed ? maxAvailable : Math.max(stunnedVal, slowedVal);
                if (totalDrain > 0) {
                    const drainedActions = Math.min(totalDrain, maxAvailable);
                    const label = isParalyzed
                        ? "Paralyzed"
                        : (stunnedVal > 0 && slowedVal > 0)
                            ? `Stunned ${stunnedVal} & Slowed ${slowedVal}`
                            : (stunnedVal > 0 ? `Stunned ${stunnedVal}` : `Slowed ${slowedVal}`);

                    currentLogs.unshift({
                        type: "system",
                        cost: drainedActions,
                        msgId: "System",
                        label,
                        isQuickenedEligible: true,
                        category: "system",
                        linkedMessages: []
                    });
                }

                // Per PF2e rules, Stunned ONLY decrements when the minion actually gains actions (and loses up to maxAvailable of them)
                if (stunnedCondition && stunnedVal > 0) {
                    stunnedDecrement = Math.min(stunnedVal, maxAvailable);
                    const newVal = stunnedVal - stunnedDecrement;
                    if (newVal <= 0 && typeof stunnedCondition.delete === "function") {
                        await stunnedCondition.delete({});
                    } else if (typeof stunnedCondition.update === "function") {
                        await stunnedCondition.update({ "system.value.value": newVal });
                    } else if ("value" in stunnedCondition) {
                        stunnedCondition.value = Math.max(0, newVal);
                    }
                }
            }
        } else {
            // Revoking granted actions (e.g., controller undid Sustain/Command):
            // 1. Remove the system drain entry from the minion's log
            currentLogs = currentLogs.filter(e => !(e.type === "system" && e.msgId === "System"));

            // 2. Restore any Stunned value that was decremented when the minion gained actions
            if (actor && stunnedDecrement > 0) {
                const existingStunned = actor.itemTypes?.condition?.find?.((c: any) => c.slug === "stunned")
                    ?? actor.items?.find?.((i: any) => i.slug === "stunned");
                if (existingStunned) {
                    const restoredVal = (existingStunned.value ?? 0) + stunnedDecrement;
                    if (typeof existingStunned.update === "function") {
                        await existingStunned.update({ "system.value.value": restoredVal });
                    } else {
                        existingStunned.value = restoredVal;
                    }
                } else if (typeof (actor as any).increaseCondition === "function") {
                    await (actor as any).increaseCondition("stunned", { value: stunnedDecrement });
                }
                stunnedDecrement = 0;
            }
        }

        await minionCombatant.update({
            [`flags.${SCOPE}.log`]: currentLogs,
            [`flags.${SCOPE}.grantedActions`]: actionsCount,
            [`flags.${SCOPE}.grantedByMsgId`]: grantedByMsgId,
            [`flags.${SCOPE}.stunnedDecrement`]: stunnedDecrement
        });
    }

    /**
     * Toggles manual action grant on a minion (0 <-> 2) for free-action sustains (e.g. Cackle, Effortless Concentration)
     * or manual overrides.
     */
    static async toggleManualGrant(minionCombatant: any): Promise<void> {
        if (!this.isEnabled() || !minionCombatant) return;
        const current = this.getGrantedActions(minionCombatant);
        const next = current > 0 ? 0 : 2;
        await this.grantActionsToMinion(minionCombatant, next, next > 0 ? "manual-grant" : null);
    }

    /**
     * Prompts the controlling player (or GM) to choose which uncommanded minion should receive the 2 actions
     * when multiple candidate minions exist.
     */
    static async promptSelectMinionToCommand(
        candidates: VirtualMinionCombatant[],
        controllerCombatant: any,
        actionLabel: string
    ): Promise<VirtualMinionCombatant | undefined> {
        if (candidates.length === 0) return undefined;
        if (candidates.length === 1) return candidates[0];

        const DialogV2 = (globalThis as any).foundry?.applications?.api?.DialogV2;
        if (!DialogV2 || typeof DialogV2.query !== "function" && typeof DialogV2.wait !== "function") {
            return candidates[0];
        }

        const actor = controllerCombatant.actor;
        const users = (globalThis as any).game?.users;
        const usersList = Array.isArray(users)
            ? users
            : (users?.contents ?? (typeof users?.filter === "function" ? users.filter(() => true) : []));
        const findUser = (id: string) =>
            (typeof users?.get === "function" ? users.get(id) : undefined) ??
            usersList.find((u: any) => u?.id === id);

        const playerOwnerId = Object.entries(actor?.ownership ?? {}).find(
            ([userId, level]) => level === 3 && userId !== "default" && !findUser(userId)?.isGM
        )?.[0];

        const ownerUser = playerOwnerId ? findUser(playerOwnerId) : undefined;
        const currentUser = (globalThis as any).game?.user;
        const currentUserId = currentUser?.id;
        // Only query over socket if a non-GM player owner is currently online and active; otherwise show DialogV2.wait directly on the GM client!
        const isRemotePlayerActive = Boolean(ownerUser?.active && ownerUser.id !== currentUserId);

        const radioHtml = candidates
            .map((minion, idx) => `
                <label style="display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer;" class="minion-command-choice" data-token-id="${minion.tokenId}">
                    <input type="radio" name="choice" value="${minion.id}" ${idx === 0 ? "checked" : ""} />
                    <img src="${minion.img}" style="width:28px; height:28px; border-radius:4px; object-fit:cover;" />
                    <span><strong>${minion.name}</strong></span>
                </label>
            `)
            .join("");

        try {
            let chosenId: string | undefined;
            if (isRemotePlayerActive && typeof DialogV2.query === "function") {
                const res = await DialogV2.query(ownerUser, "wait", {
                    window: { title: `Select Minion for ${actionLabel || "Command / Sustain"}` },
                    position: { width: 360 },
                    content: `<form class="pf2e-minion-select-dialog"><p>Choose which minion gains 2 actions:</p>${radioHtml}</form>`,
                    buttons: [{
                        action: "choose",
                        label: "Grant 2 Actions",
                        icon: "fa-solid fa-bolt",
                        default: true,
                        callback: (_event: any, button: any, dialog: any) => {
                            const form = button?.form || dialog?.element?.querySelector?.("form") || dialog?.querySelector?.("form");
                            const checked = form?.querySelector?.('input[name="choice"]:checked');
                            return checked?.value;
                        }
                    }]
                });
                chosenId = res?.choice ?? (typeof res === "string" ? res : undefined);
            } else if (typeof DialogV2.wait === "function") {
                chosenId = await DialogV2.wait({
                    window: { title: `Select Minion for ${actionLabel || "Command / Sustain"}` },
                    position: { width: 360 },
                    content: `<form class="pf2e-minion-select-dialog"><p>Choose which minion gains 2 actions:</p>${radioHtml}</form>`,
                    buttons: [{
                        action: "ok",
                        label: "Grant 2 Actions",
                        icon: "fa-solid fa-bolt",
                        default: true,
                        callback: (_event: any, button: any, dialog: any) => {
                            const form = button?.form || dialog?.element?.querySelector?.("form") || dialog?.querySelector?.("form");
                            const checked = form?.querySelector?.('input[name="choice"]:checked');
                            return checked?.value;
                        }
                    }]
                });
            }

            if (chosenId) {
                return candidates.find(c => c.id === chosenId) ?? candidates[0];
            }
        } catch (_e) {
            // Fallback to first candidate if dialog is dismissed or unavailable
        }
        return candidates[0];
    }

    /**
     * Called when a controller logs an action; if it is a Sustain or Command action, grants 2 actions to the appropriate summon.
     */
    static async handleControllerActionAdded(controllerCombatant: any, action: any, combat?: any): Promise<void> {
        if (!this.isEnabled() || !isCurrentUserActiveGM()) return;
        if (!controllerCombatant || this.isMinion(controllerCombatant)) return;

        const slug = (action.slug || "").toLowerCase();
        const label = (action.label || "").toLowerCase();
        const isSustainOrCommand =
            action.category === "sustain" ||
            slug === "sustain-a-spell" ||
            slug === "sustain" ||
            slug === "sustain-an-effect" ||
            slug === "command-an-animal" ||
            slug === "command-a-minion" ||
            label.startsWith("sustain") ||
            label.startsWith("command");

        if (!isSustainOrCommand) return;

        const minions = this.getSummonedMinionsForCombatant(controllerCombatant, combat);
        if (minions.length === 0) return;

        const uncommanded = minions.filter(m => this.getGrantedActions(m) === 0);
        if (uncommanded.length === 0) return;

        // 0. If the Sustain Reminder card carried a specific minionTokenId, match that minion token directly!
        const explicitMinionTokenId = action.sustainItem?.minionTokenId;
        if (explicitMinionTokenId) {
            const directMatch = uncommanded.find(m => m.tokenId === explicitMinionTokenId);
            if (directMatch) {
                await this.grantActionsToMinion(directMatch, 2, action.msgId);
                return;
            }
        }

        // 1. Try matching by sustained spell itemId or itemName stored when the minion was summoned
        const sustainItemId = action.sustainItem?.id;
        const sustainItemName = (action.sustainItem?.name || action.label || "").toLowerCase();

        let matchedCandidates = uncommanded;
        if (sustainItemId) {
            const byId = uncommanded.filter(m => m.getFlag(SCOPE, "summonedByItemId") === sustainItemId);
            if (byId.length > 0) {
                matchedCandidates = byId;
            }
        }
        if (matchedCandidates.length > 1 && sustainItemName) {
            const byName = matchedCandidates.filter(m => {
                const itemOriginName = ((m.getFlag(SCOPE, "summonedByItemName") as string) || "").toLowerCase();
                return (itemOriginName && (sustainItemName === itemOriginName || sustainItemName.includes(itemOriginName) || itemOriginName.includes(sustainItemName))) ||
                    sustainItemName.includes(m.name.toLowerCase());
            });
            // Only narrow by name if it actually distinguishes between candidates (e.g. "Summon Animal (Bear)" vs "Summon Animal (Wolf)")
            if (byName.length > 0) matchedCandidates = byName;
        }

        // 2. If only 1 candidate matches, grant immediately; otherwise prompt the controller to choose which minion
        const targetMinion = matchedCandidates.length === 1
            ? matchedCandidates[0]
            : await this.promptSelectMinionToCommand(matchedCandidates, controllerCombatant, action.label || "Sustain");

        if (targetMinion && this.getGrantedActions(targetMinion) === 0) {
            await this.grantActionsToMinion(targetMinion, 2, action.msgId);
        }
    }

    /**
     * Called when a controller removes/undoes an action; revokes any minion action grant linked to that msgId.
     */
    static async handleControllerActionRemoved(controllerCombatant: any, removedMsgId: string, combat?: any): Promise<void> {
        if (!this.isEnabled() || !isCurrentUserActiveGM()) return;
        if (!controllerCombatant || this.isMinion(controllerCombatant)) return;

        const minions = this.getSummonedMinionsForCombatant(controllerCombatant, combat);
        for (const minion of minions) {
            const grantedBy = minion.getFlag(SCOPE, "grantedByMsgId");
            if (grantedBy && grantedBy === removedMsgId) {
                await this.grantActionsToMinion(minion, 0, null);
            }
        }
    }

    /**
     * Handles postPf2eSummon hook when a creature is freshly summoned during combat.
     * Note: PF2e Summons Assistant fires postPf2eSummon on the client that placed the summon BEFORE it calls
     * summonedCreatureActor.setFlag("pf2e-summons-assistant", "summoner", ...).
     * Per PF2e rules, a creature summoned on the caster's turn immediately gains 2 actions.
     */
    static async handlePostSummon(tokenDoc: any, summonerItem: any, summonerActor: any): Promise<void> {
        if (!this.isEnabled() || !tokenDoc) return;
        const combat = (globalThis as any).game?.combat;
        if (!combat?.active) return;

        const controller = getCombatants(combat).find(
            (c: any) => c.actorId === summonerActor?.id || c.actor?.id === summonerActor?.id
        );
        if (!controller) return;

        // Ensure movement history starts clean for the newly placed summon token
        if (tokenDoc.id) {
            MovementHistoryService.broadcastReset(tokenDoc.id);
            MovementHistoryService.resetTurnCoords(tokenDoc.id);
        }

        // If the current client can update the token (Active GM or owner of the newly spawned token), initialize flags
        const canUpdateToken = isCurrentUserActiveGM() || Boolean(tokenDoc.isOwner || tokenDoc.actor?.isOwner);
        if (canUpdateToken) {
            const virtual = this.getOrCreateVirtualCombatant(tokenDoc, controller);
            const isSummonerTurn = combat.combatant?.id === controller.id;
            const isQuickened = Boolean(virtual.actor?.hasCondition?.("quickened"));

            // In PF2e, chatMessage.item for a cast spell is often a transient EmbeddedSpell where .id is undefined
            // or different from what SustainDetector extracted from flags.pf2e.origin.uuid / sustainData.
            // Fall back to the controller's most recent logged action that has a sustainItem!
            const controllerLogs = (controller.getFlag?.(SCOPE, "log") as any[]) || [];
            const latestSustainEntry = [...controllerLogs].reverse().find(e => e?.sustainItem?.id);
            const resolvedItemId =
                summonerItem?.id ||
                summonerItem?._id ||
                latestSustainEntry?.sustainItem?.id ||
                null;
            const resolvedItemName =
                summonerItem?.name ||
                latestSustainEntry?.sustainItem?.name ||
                null;

            await virtual.update({
                [`flags.${SCOPE}.summonerActorId`]: summonerActor?.id ?? null,
                [`flags.${SCOPE}.log`]: [],
                [`flags.${SCOPE}.actionsSpent`]: 0,
                [`flags.${SCOPE}.reactionsSpent`]: 0,
                [`flags.${SCOPE}.isQuickenedSnapshot`]: isQuickened,
                [`flags.${SCOPE}.summonedByItemId`]: resolvedItemId,
                [`flags.${SCOPE}.summonedByItemName`]: resolvedItemName,
                [`flags.${SCOPE}.lastOverspendAlert`]: 0
            });
            await this.grantActionsToMinion(virtual, isSummonerTurn ? 2 : 0, isSummonerTurn ? "summon-initial" : null);
        }

        (globalThis as any).ui?.combat?.render?.();
    }
}

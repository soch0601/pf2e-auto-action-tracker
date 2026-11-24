import { SettingsManager } from "../SettingsManager.ts";
import { SCOPE } from "../globals.ts";

export const SUMMONS_ASSISTANT_ID = "pf2e-summons-assistant";
export const MINION_ID_PREFIX = "minion-";

/**
 * Checks if PF2e Summons Assistant module is active and our summons tracking setting is enabled.
 */
export function isSummonsTrackingEnabled(): boolean {
    return SettingsManager.isSummonsTrackingEnabled();
}

/**
 * Checks if an actor is an Eidolon (anticipated - not chandled yet).
 */
export function isEidolonActor(actor: any): boolean {
    if (!actor) return false;
    const traits: string[] = actor.system?.traits?.value ?? [];
    if (traits.includes("eidolon")) return true;
    if (actor.class?.slug === "eidolon") return true;
    return false;
}

/**
 * Returns the summoner info ({ id, uuid }) stored by PF2e Summons Assistant on a summoned actor
 * (or our own fallback flag set during postPf2eSummon before PF2e Summons Assistant finishes its async setFlag).
 */
export function getSummonerInfoFromActor(actor: any, tokenDoc?: any): { id?: string; uuid?: string } | undefined {
    if (!actor && !tokenDoc) return undefined;
    const saInfo =
        actor?.getFlag?.(SUMMONS_ASSISTANT_ID, "summoner") ??
        actor?.flags?.[SUMMONS_ASSISTANT_ID]?.summoner ??
        tokenDoc?.actor?.flags?.[SUMMONS_ASSISTANT_ID]?.summoner;
    if (saInfo?.id || saInfo?.uuid) return saInfo;

    const fallbackId =
        tokenDoc?.getFlag?.(SCOPE, "summonerActorId") ??
        tokenDoc?.flags?.[SCOPE]?.summonerActorId ??
        actor?.getFlag?.(SCOPE, "summonerActorId") ??
        actor?.flags?.[SCOPE]?.summonerActorId;
    if (fallbackId) {
        return { id: fallbackId, uuid: `Actor.${fallbackId}` };
    }

    // Check if any combatant in active combat has already registered this tokenId in flags[SCOPE].minions
    const tokenId = tokenDoc?.id;
    const combatants = (globalThis as any).game?.combat?.combatants;
    if (tokenId && combatants) {
        const list = Array.isArray(combatants) ? combatants : (combatants.contents ?? Array.from(combatants));
        for (const c of list) {
            const minionEntry = (c.getFlag?.(SCOPE, "minions") ?? c.flags?.[SCOPE]?.minions)?.[tokenId];
            if (minionEntry) {
                const cActorId = minionEntry.summonerActorId ?? c.actorId ?? c.actor?.id;
                if (cActorId) return { id: cActorId, uuid: `Actor.${cActorId}` };
            }
        }
    }

    return undefined;
}

/**
 * Checks if an actor is an eligible summoned minion from PF2e Summons Assistant.
 * Must have the PF2e Summons Assistant summoner flag AND the 'minion' trait (and not be an Eidolon).
 */
export function isEligibleSummonedMinionActor(actor: any, tokenDoc?: any): boolean {
    if (!isSummonsTrackingEnabled() || !actor) return false;
    if (isEidolonActor(actor)) return false;

    const summonerInfo = getSummonerInfoFromActor(actor, tokenDoc);
    if (!summonerInfo?.id && !summonerInfo?.uuid) return false;

    const traits: string[] = actor.system?.traits?.value ?? [];
    return Array.isArray(traits) && traits.includes("minion");
}

/**
 * Determines if a given actor was summoned by the specified controller combatant.
 */
export function isActorSummonedByCombatant(actor: any, controllerCombatant: any, tokenDoc?: any): boolean {
    if (!isEligibleSummonedMinionActor(actor, tokenDoc) || !controllerCombatant) return false;
    const summonerInfo = getSummonerInfoFromActor(actor, tokenDoc);
    if (!summonerInfo) return false;

    const controllerActorId = controllerCombatant.actorId ?? controllerCombatant.actor?.id;
    const controllerActorUuid = controllerCombatant.actor?.uuid;

    if (controllerActorId && summonerInfo.id === controllerActorId) return true;
    if (controllerActorUuid && summonerInfo.uuid === controllerActorUuid) return true;
    if (controllerActorId && summonerInfo.uuid?.endsWith(`.${controllerActorId}`)) return true;

    return false;
}

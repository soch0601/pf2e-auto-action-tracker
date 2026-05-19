export function getActiveGM(): any | undefined {
    const users = game.users as any;
    return users?.activeGM ?? users?.find?.((u: any) => u.active && u.isGM);
}

export function isCurrentUserActiveGM(): boolean {
    const user = game.user as any;
    if (!user?.isGM) return false;
    if (typeof user.isActiveGM === "boolean") return user.isActiveGM;

    const activeGM = getActiveGM();
    return activeGM ? activeGM.id === user.id : true;
}

export function getOpenApplications(): any[] {
    const legacyWindows = Object.values((ui as any).windows ?? {});
    const ApplicationV2 = (foundry.applications as any)?.api?.ApplicationV2;
    const appV2Instances = ApplicationV2?.instances;
    const modernWindows = typeof appV2Instances === "function" ? Array.from(appV2Instances.call(ApplicationV2)) : [];

    return [...legacyWindows, ...modernWindows];
}

export function getCombatants(combat?: any): any[] {
    const combatants = combat?.combatants;
    if (!combatants) return [];
    if (Array.isArray(combatants)) return combatants;
    if (Array.isArray(combatants.contents)) return combatants.contents;
    if (typeof combatants.toObject === "function") return combatants.toObject();
    return Array.from(combatants);
}

export function loadHandlebarsTemplates(paths: string[]): Promise<unknown> | unknown {
    const appHandlebars = (foundry.applications as any)?.handlebars;
    if (typeof appHandlebars?.loadTemplates === "function") return appHandlebars.loadTemplates(paths);
    if (typeof (globalThis as any).loadTemplates === "function") return (globalThis as any).loadTemplates(paths);
}

export function renderHandlebarsTemplate(path: string, data: Record<string, unknown>): Promise<string> {
    const appHandlebars = (foundry.applications as any)?.handlebars;
    if (typeof appHandlebars?.renderTemplate === "function") return appHandlebars.renderTemplate(path, data);
    return (globalThis as any).renderTemplate(path, data);
}

/**
 * Safely find a combatant in a combat collection using a predicate.
 */
export function findCombatant(combat: any, predicate: (combatant: any) => boolean): any | undefined {
    return getCombatants(combat).find(predicate);
}

/**
 * Find a combatant by their ID.
 */
export function findCombatantById(combat: any, combatantId?: string): any | undefined {
    if (!combatantId) return;
    return findCombatant(combat, (c: any) => c.id === combatantId);
}

/**
 * Find a combatant by token ID or actor ID.
 */
export function findCombatantByTokenOrActor(combat: any, tokenId?: string | null, actorId?: string | null): any | undefined {
    if (!tokenId && !actorId) return;
    return getCombatants(combat).find((c: any) => 
        (tokenId && (c.tokenId === tokenId || c.token?.id === tokenId)) || 
        (actorId && (c.actorId === actorId || c.actor?.id === actorId))
    );
}

/**
 * Find a combatant associated with a chat message.
 */
export function findCombatantByMessage(combat: any, message: any): any | undefined {
    const speaker = message.speaker;
    return findCombatantByTokenOrActor(combat, speaker?.token ?? undefined, speaker?.actor ?? undefined);
}

/**
 * Identifies the actor and token associated with a given DOM element (usually a sheet).
 */
export function getActorAndTokenFromSheet(element: HTMLElement | null): { actor: any | null, actorId: string | null, tokenId: string | null } {
    const result = { actor: null, actorId: null, tokenId: null };
    if (!element) return result;

    const app = Object.values(ui.windows).find(w =>
        (w as any).element?.get(0) === element
    ) as any;

    if (app?.actor) {
        result.actor = app.actor;
        result.actorId = app.actor.id;
        result.tokenId = app.actor.token?.id ?? app.token?.id;
    }
    return result;
}

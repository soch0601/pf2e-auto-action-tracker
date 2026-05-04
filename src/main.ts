import { ActionManager } from "./ActionManager";
import { SettingsManager } from "./SettingsManager";
import { CombatUIManager } from "./CombatUIManager";
import { ChatManager } from "./ChatManager";
import { ActorHandler } from "./ActorHandler";
import { MovementManager } from "./MovementManager";
import { WrapperManager } from "./WrapperManager";
import { SocketsManager } from "./SocketManager";
import { ChatMessagePF2e, CombatantPF2e, EncounterPF2e } from "module-helpers"
import { logConsole, logError, logInfo, logWarn } from "./logger";
import { SCOPE, recentIntent } from "./globals";
import { runAllConflictChecks } from "./otherModConflicts";
import { findPf2eHudTracker } from "./trackerAdapters";

// string is the combatant ID.
const _queues = new Map<string, Promise<void>>();
let pf2eHudObserver: MutationObserver | undefined;
let isReady = false;

function syncPf2eHudTracker(combat: any): boolean {
    if (!SettingsManager.get("showPf2eHudTracker")) return true;

    const hudTracker = findPf2eHudTracker(document);
    if (!hudTracker) return false;

    combat.combatants.forEach((c: any) => {
        CombatUIManager.injectIcons(hudTracker, c);
    });
    CombatUIManager.activateListeners(hudTracker);
    return true;
}

function observePf2eHudTracker(combat: any): boolean {
    const hudTracker = findPf2eHudTracker(document);
    if (!hudTracker) return false;

    if (pf2eHudObserver) pf2eHudObserver.disconnect();
    pf2eHudObserver = new MutationObserver(() => {
        if (game.combat === combat || game.combat?.id === combat.id) {
            syncPf2eHudTracker(combat);
        }
    });
    pf2eHudObserver.observe(hudTracker, { childList: true, subtree: true });
    return true;
}

// Initialization
Hooks.once("init", () => {
    SettingsManager.registerSettings();
    (foundry.applications as any).handlebars.loadTemplates([
        `modules/${SCOPE}/templates/sustain-reminder.hbs`
    ]);
    ChatManager.registerOverrideListeners();
});

Hooks.once("socketlib.ready", () => {
    SocketsManager.initSockets();
})

// Once it is ready, now we can wrap functions
Hooks.once("ready", () => {
    isReady = true;
    runAllConflictChecks();
    WrapperManager.wrapFunctions();
});

Hooks.on("closeDamageModifierDialog", async (app: any) => {
    if (!isReady) return;
    // 1. Cleanup the actor-level temporary ID regardless of how it closed
    if (app.actor) {
        delete (app.actor as any)._lastDamageOriginId;
    }

    // 2. If the dialog closed because they rolled, the message creation 
    // logic already handled the queue/flags.
    if (app.element?.[0]?._wasRolled) return;

    // 3. Find the combatant
    const tokenId = app.token?.id;
    const actorId = app.actor?.id;

    const combatant = game.combat?.combatants.find((c: any) =>
        tokenId ? c.tokenId === tokenId : c.actorId === actorId
    );

    const c = combatant as any;
    if (!c?.id || !combatant) return;

    // 4. Safety cleanup is a write operation, enqueue it
    enqueueAction(c.id, async () => await ChatManager.handleDamageModifierDialogRender(combatant, app));
});

// Create Chat Hook
Hooks.on("createChatMessage", async (message: ChatMessagePF2e) => {
    if (!isReady) return;
    if (game.user?.id !== game.users?.activeGM?.id) return;

    const combatant = ChatManager.getCombatantFromMsg(message);
    const c = combatant as unknown as Combatant
    if (!c?.id) return;

    // Enqueue the chat payload
    enqueueAction(c.id, async () => await ChatManager.handleChatPayload(message));
});

// Delete Chat hook
Hooks.on("deleteChatMessage", async (message: ChatMessagePF2e) => {
    if (!isReady) return;
    if (!(game as any).combat?.active || !message.id) return;

    const speaker = message.speaker;
    const combatant = game.combat?.combatants.find((c: any) =>
        speaker.token ? c.tokenId === speaker.token : c.actorId === speaker.actor
    );
    const c = combatant as any as Combatant

    if (!combatant || !c.id) return;

    const context = message.flags?.pf2e;
    if (context && "isReroll" in context && context.isReroll) return;

    if (game.user?.id !== game.users?.activeGM?.id) return;

    // Enqueue deleting the action
    enqueueAction(c.id, async () => await ChatManager.handleDeletedMessage(combatant, message.id!));
});

// End of Combat hook
Hooks.on("deleteCombat", async (combat: EncounterPF2e) => {
    const g = game as unknown as Game;

    if (game.user?.id !== game.users?.activeGM?.id) return;

    for (const combatant of (combat.combatants as any)) {
        const actor = combatant.actor;
        if (actor) {
            await ActorHandler.cleanup(actor);
        }
    }

    ChatManager.clearRerollQueue();
    recentIntent.clear();

    logConsole("Action Tracker: Cleanup complete for all actors in ended combat.");
});

// Hook before the message is created -used to store flags for recent intent
Hooks.on("preCreateChatMessage", (message: any) => {
    const speaker = message.speaker;
    const uniqueKey = speaker.token || speaker.actor;
    const intentItemId = recentIntent.get(uniqueKey);

    // PF2e uses origin.uuid for item links in chat
    const messageItemId = message.flags?.pf2e?.origin?.uuid?.split('.').pop();

    if (intentItemId && intentItemId === messageItemId) {
        message.updateSource({
            [`flags.${SCOPE}.isExplicitUse`]: true
        });
        recentIntent.delete(uniqueKey);
    }
});

// Rendering the chat message
Hooks.on("renderChatMessage", (message: ChatMessagePF2e, html: any) => {
    // Does not need enqueuing - This only create messages and click handlers -> which creates more messages.  So no
    // modifications of actions here
    ChatManager.onRenderChatMessage(message, html);
});

// UI Hooks for rendering combat tracker
Hooks.on("renderCombatTracker", (app: any, html: any, data: any) => {
    if (!isReady) return;
    const htmlElement = html instanceof HTMLElement ? html : html[0] || (html.element instanceof HTMLElement ? html.element : null);
    if (!htmlElement || !data.combat) return;

    if (SettingsManager.get("showCoreTracker")) {
        data.combat.combatants.forEach((c: any) => {
            CombatUIManager.injectIcons(htmlElement, c);
        });
        CombatUIManager.activateListeners(htmlElement);
    }

    if (!syncPf2eHudTracker(data.combat)) {
        window.setTimeout(() => {
            if (syncPf2eHudTracker(data.combat)) observePf2eHudTracker(data.combat);
        }, 0);
    } else {
        observePf2eHudTracker(data.combat);
    }
});

Hooks.on("renderDamageModifierDialog", async (app: any, html: JQuery) => {
    if (!isReady) return;
    // 1. Find the combatant associated with this dialog
    const tokenId = app.token?.id;
    const actorId = app.actor?.id;

    const combatant = game.combat?.combatants.find((c: any) =>
        tokenId ? c.tokenId === tokenId : c.actorId === actorId
    );

    if (!combatant) return;
    const c = combatant as unknown as Combatant
    if (!c?.id || !combatant) return;

    enqueueAction(c.id, async () => await ChatManager.handleDamageModifierDialogRender(combatant, app));
});

// Chat card changed (like Heal selecting a cost or visibility)
Hooks.on("updateChatMessage", (message: ChatMessagePF2e, updateData: any) => {
    if (!isReady) return;
    const combat = game.combat;
    if (!combat?.active) return;
    // Find the combatant associated with this message
    const speaker = message.speaker;
    const combatant = combat.combatants.find((c: any) =>
        speaker.token ? c.tokenId === speaker.token : c.actorId === speaker.actor
    );
    const c = combatant as unknown as Combatant
    if (!c?.id) return;

    if (updateData.flags?.pf2e || updateData.whisper) {
        if (game.user?.id === game.users?.activeGM?.id) {
            enqueueAction(c.id, async () => await ChatManager.handleChatPayload(message));
        }
    }

    // Check for any visibility-related changes
    const visibilityChanged =
        updateData.whisper !== undefined ||
        updateData.blind !== undefined ||
        "flags" in updateData; // Catching system-specific visibility flags if any

    if (visibilityChanged) {
        if (combatant) {
            // Trigger a re-render. 
            // renderPip will now see the new message.visible status 
            // and swap between the real label and "Secret Action".
            (ui as any).combat.render();
        }
    }
});

// Update Combat Hooks
Hooks.on("updateCombat", async (combat: EncounterPF2e, updateData: any, options: any, userId: string) => {
    if (!isReady) return;
    const g = game as unknown as Game;

    if (game.user?.id !== game.users?.activeGM?.id) return;

    const isTurnChange = "turn" in updateData || "round" in updateData;
    if (!isTurnChange || !combat.started) return;

    const prev = combat.previous;
    const curr = { round: combat.round, turn: combat.turn ?? 0 };
    const isForward = !prev || !prev.round || (curr.round > prev.round) || (curr.round === prev.round && curr.turn > (prev.turn ?? -1));

    if (isForward) {
        if (prev?.combatantId) {
            const previousCombatant = combat.combatants.get(prev.combatantId);
            if (previousCombatant) await ActionManager.handleEndOfTurn(previousCombatant);
        }

        const currentCombatant = combat.combatant as unknown as CombatantPF2e;
        if (currentCombatant) await ActionManager.handleStartOfTurn(currentCombatant);
    }
});

// Movement Hooks
Hooks.on("preUpdateToken", (tokenDoc: any, update: any, options: any, userId: string) => {
    if (!isReady) return;
    if (game.user?.id !== userId) return;
    MovementManager.handlePreUpdateToken(tokenDoc, update, options);
});

Hooks.on("updateToken", (tokenDoc: any, update: any, options: any, userId: string) => {
    if (!isReady) return;
    if (game.user?.id !== userId) return;
    if (!("x" in update || "y" in update || update.movementAction)) return;

    const combatant: Combatant = tokenDoc.combatant;
    if (!combatant?.id) return;

    enqueueAction(combatant.id, async () => await MovementManager.handleTokenUpdate(tokenDoc, update, options));
});

// Condition Hooks for dynamic Reaction Loss
Hooks.on("createItem", async (item: any) => {
    if (game.user?.id !== game.users?.activeGM?.id) return;
    if (item.type !== "condition" && item.type !== "effect") return;

    if (item.slug === "stunned" || item.slug === "paralyzed") {
        const actor = item.parent;
        if (!actor) return;

        const combatant = game.combat?.combatants.find((c: any) => c.actorId === actor.id);
        const c = combatant as unknown as Combatant
        if (!c?.id || !combatant) return;

        enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
    }
});

Hooks.on("updateItem", async (item: any, updateData: any) => {
    if (game.user?.id !== game.users?.activeGM?.id) return;
    if (item.type !== "condition" && item.type !== "effect") return;

    if (item.slug === "stunned" || item.slug === "paralyzed") {
        if (updateData.system?.value !== undefined) {
            const actor = item.parent;
            if (!actor) return;

            const combatant = game.combat?.combatants.find((c: any) => c.actorId === actor.id);
            const c = combatant as unknown as Combatant
            if (!c?.id || !combatant) return;

            enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
        }
    }
});

Hooks.on("deleteItem", async (item: any) => {
    if (game.user?.id !== game.users?.activeGM?.id) return;
    if (item.type !== "condition" && item.type !== "effect") return;

    if (item.slug === "stunned" || item.slug === "paralyzed") {
        const actor = item.parent;
        if (!actor) return;

        const combatant = game.combat?.combatants.find((c: any) => c.actorId === actor.id);
        const c = combatant as unknown as Combatant
        if (!c?.id || !combatant) return;

        enqueueAction(c.id, async () => await ActionManager.handleConditionChange(combatant));
    }
});

export async function enqueueAction(combatantId: string, actionFn: () => Promise<void>) {
    const existingPromise = _queues.get(combatantId);

    const startPromise = existingPromise || Promise.resolve();

    const newPromise = startPromise.then(async () => {
        try {
            const start = performance.now();
            await actionFn();
            const end = performance.now();

            // LOGGING: Performance check - also useful stat to know if people still have trouble with this
            if ((end - start) > 100) {
                logInfo(`Action Tracker | Slow Operation: ${combatantId} took ${Math.round(end - start)}ms`);
            }
        } catch (err) {
            logError("Action Tracker | Queue Error:", err);
        }
    });

    _queues.set(combatantId, newPromise);
    return newPromise;
}

export async function waitForQueue(combatantId: string) {
    const existingPromise = _queues.get(combatantId);
    if (existingPromise) await existingPromise;
}

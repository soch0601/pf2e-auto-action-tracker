import { ActionManager } from "./ActionManager";
import { SettingsManager } from "./SettingsManager";
import { CombatUIManager } from "./CombatUIManager";
import { ItemManager } from "./ItemManager";
import { ChatManager } from "./ChatManager";
import { ActorManager } from "./ActorManager";
import { ChatCardRenderer } from "./ChatCardRenderer";
import { MovementManager } from "./MovementManager";
import { WrapperManager } from "./WrapperManager";
import { SocketsManager } from "./SocketManager";
import { ChatMessagePF2e, CombatantPF2e, EncounterPF2e } from "module-helpers"
import { logError, logInfo } from "./logger";
import { SCOPE, recentIntent } from "./globals";
import { runAllConflictChecks } from "./otherModConflicts";
import { findPf2eHudTracker } from "./trackerAdapters";
import { findCombatantByMessage, findCombatantByTokenOrActor, findCombatantById, getCombatants, isCurrentUserActiveGM } from "./foundryCompat";

// string is the combatant ID.
const _queues = new Map<string, Promise<void>>();
let pf2eHudObserver: MutationObserver | undefined;
let pf2eHudObservedCombatId: string | undefined;
let isReady = false;

function syncPf2eHudTracker(combat: any): boolean {
    if (!SettingsManager.get("showPf2eHudTracker")) return true;

    const hudTracker = findPf2eHudTracker(document);
    if (!hudTracker) return false;

    getCombatants(combat).forEach((c: any) => {
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
    pf2eHudObservedCombatId = combat.id;
    return true;
}

// Initialization
Hooks.once("init", () => {
    SettingsManager.registerSettings();
    ChatCardRenderer.registerOverrideListeners();
});

// Style the settings menu
Hooks.on("renderSettingsConfig", (app: any, html: any) => {
    SettingsManager.onRenderSettingsConfig(app, html);
});

Hooks.once("socketlib.ready", () => {
    SocketsManager.initSockets();
})

// Once it is ready, now we can wrap functions
Hooks.once("ready", () => {
    isReady = true;
    SettingsManager.migrateSettings();
    runAllConflictChecks();
    WrapperManager.wrapFunctions();
});

Hooks.on("closeDamageModifierDialog", async (app: any) => {
    if (!isReady) return;
    // 1. Cleanup the actor-level temporary ID regardless of how it closed
    if (app.actor) {
        delete (app.actor as any)._lastDamageOriginId;
    }

    // 2. Find the combatant
    const tokenId = app.token?.id;
    const actorId = app.actor?.id;
    const combatant = findCombatantByTokenOrActor(game.combat, tokenId, actorId);
    const c = combatant as any;
    if (!c?.id || !combatant) return;

    // 3. Safety cleanup is a write operation, enqueue it
    enqueueAction(c.id, async () => await ChatManager.handleDamageModifierDialogRender(combatant, app));
});

// Create Chat Hook
Hooks.on("createChatMessage", async (message: ChatMessagePF2e) => {
    if (!isReady) return;
    if (!isCurrentUserActiveGM()) return;

    const pf2eContext = (message.flags?.pf2e as any)?.context;
    if (pf2eContext?.type === "damage-taken") {
        const foundC = findCombatantByMessage(game.combat, message);
        const directOrigin = (message.flags as any)?.[SCOPE]?.damageOrigin;
        const flagOrigin = (message as any).getFlag(SCOPE, "damageOrigin");
    }

    let cId = findCombatantByMessage(game.combat, message)?.id;

    if (!cId) {
        // Fallback for out-of-combat targets: check if there's an active damage origin combatant
        const origin = ((message as any).getFlag(SCOPE, "damageOrigin") || (message.flags as any)?.[SCOPE]?.damageOrigin) as { originMsgId: string, combatantId: string } | undefined;
        if (origin?.combatantId) {
            cId = origin.combatantId;
        }
    }

    if (!cId) return;

    // Enqueue the chat payload
    enqueueAction(cId, async () => await ChatManager.handleChatPayload(message));
});

// Delete Chat hook
Hooks.on("deleteChatMessage", async (message: ChatMessagePF2e) => {
    if (!isReady) return;
    if (!(game as any).combat?.active || !message.id) return;

    const speaker = message.speaker;
    const combatant = findCombatantByMessage((game as any).combat, message);
    const c = combatant as any as Combatant

    if (!combatant || !c.id) return;

    const context = message.flags?.pf2e;
    if (context && "isReroll" in context && context.isReroll) return;

    if (!isCurrentUserActiveGM()) return;

    // Enqueue deleting the action
    enqueueAction(c.id, async () => await ChatManager.handleDeletedMessage(combatant, message.id!));
});

// End of Combat hook
Hooks.on("deleteCombat", async (combat: EncounterPF2e) => {
    const g = game as unknown as Game;

    // Per-client cleanup runs on every client (not just the GM): the MutationObserver holds a
    // closure reference to the ended combat and would otherwise keep observing the HUD tracker
    // DOM until the next renderCombatTracker fires. Match the observed combat id so we don't
    // tear down a newer observer that has already moved on.
    if (pf2eHudObserver && pf2eHudObservedCombatId === combat.id) {
        pf2eHudObserver.disconnect();
        pf2eHudObserver = undefined;
        pf2eHudObservedCombatId = undefined;
    }

    if (!isCurrentUserActiveGM()) return;

    for (const combatant of getCombatants(combat)) {
        const actor = combatant.actor;
        if (actor) {
            await ActorManager.cleanup(actor);
        }
    }

    ChatManager.clearRerollQueue();
    recentIntent.clear();

    logInfo("Action Tracker: Cleanup complete for all actors in ended combat.");
});

// Pre-Create Chat Hook (Runs on the client that originated the message)
Hooks.on("preCreateChatMessage", (message: ChatMessagePF2e) => {
    if (!isReady) return;
    ChatManager.handlePreCreateChatMessage(message);
});

// Rendering the chat message — v13+ uses renderChatMessageHTML (HTMLElement); legacy renderChatMessage hook
// is deprecated since v13 and removed in v15.
Hooks.on("renderChatMessageHTML", (message: ChatMessagePF2e, html: HTMLElement) => {
    // Does not need enqueuing - This only create messages and click handlers -> which creates more messages.  So no
    // modifications of actions here
    ChatCardRenderer.onRenderChatMessage(message, html);
});

// UI Hooks for rendering combat tracker
Hooks.on("renderCombatTracker", (app: any, html: any, data: any) => {
    if (!isReady) return;
    const htmlElement = html instanceof HTMLElement ? html : html[0] || (html.element instanceof HTMLElement ? html.element : null);
    if (!htmlElement || !data.combat) return;

    if (SettingsManager.get("showCoreTracker")) {
        getCombatants(data.combat).forEach((c: any) => {
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

    const combatant = findCombatantByTokenOrActor(game.combat, tokenId, actorId);

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

    let cId = findCombatantByMessage(combat, message)?.id;

    if (!cId) {
        const origin = (message as any).getFlag(SCOPE, "damageOrigin") as { originMsgId: string, combatantId: string } | undefined;
        if (origin?.combatantId) {
            cId = origin.combatantId;
        }
    }

    if (!cId) return;

    if (updateData.flags?.pf2e || updateData.whisper) {
        if (isCurrentUserActiveGM()) {
            enqueueAction(cId, async () => await ChatManager.handleChatPayload(message));
        }
    }

    // Check for any visibility-related changes
    const visibilityChanged =
        updateData.whisper !== undefined ||
        updateData.blind !== undefined ||
        "flags" in updateData; // Catching system-specific visibility flags if any

    if (visibilityChanged) {
        if (combat) {
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

    if (!isCurrentUserActiveGM()) return;

    const isTurnChange = "turn" in updateData || "round" in updateData;
    if (!isTurnChange || !combat.started) return;

    const prev = combat.previous;
    const curr = { round: combat.round, turn: combat.turn ?? 0 };
    const isForward = !prev || !prev.round || (curr.round > prev.round) || (curr.round === prev.round && curr.turn > (prev.turn ?? -1));

    if (isForward) {
        if (prev?.combatantId) {
            const previousCombatant = findCombatantById(combat, prev.combatantId);
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

// Drop captured movement state for tokens that leave the scene. The MovementManager keeps
// per-token Maps (_capturedHistory, _historyLengths, _lastCoords, _lastInteractionDistance)
// that are never otherwise pruned for deleted tokens, so without this hook those Maps grow
// across long campaigns as tokens come and go.
Hooks.on("deleteToken", (tokenDoc: any) => {
    if (tokenDoc?.id) MovementManager.resetCapturedHistory(tokenDoc.id);
});


// Item (Condition/Feat/Spell) Hooks
Hooks.on("createItem", (item: any) => ItemManager.handleCreateItem(item));
Hooks.on("updateItem", (item: any, update: any) => ItemManager.handleUpdateItem(item, update));
Hooks.on("deleteItem", (item: any) => ItemManager.handleDeleteItem(item));

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

    // Drop the entry once it settles, but only if no later enqueueAction has replaced the head.
    // Without this, the map accumulates one resolved Promise per combatant ever queued, growing
    // unboundedly across long sessions.
    newPromise.finally(() => {
        if (_queues.get(combatantId) === newPromise) {
            _queues.delete(combatantId);
        }
    });

    return newPromise;
}

export async function waitForQueue(combatantId: string) {
    const existingPromise = _queues.get(combatantId);
    if (existingPromise) await existingPromise;
}

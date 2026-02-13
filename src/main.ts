import { ActionManager } from "./ActionManager";
import { SettingsManager } from "./SettingsManager";
import { CombatUIManager } from "./CombatUIManager";
import { ChatManager } from "./ChatManager";
import { ActorHandler } from "./ActorHandler";
import { MovementManager } from "./MovementManager";
import { WrapperManager } from "./WrapperManager";
import { SocketsManager } from "./SocketManager";
import { ChatMessagePF2e, CombatantPF2e, EncounterPF2e } from "module-helpers"
import { logConsole } from "./logger";
import { SCOPE, recentIntent } from "./globals";

// Initialization
Hooks.once("init", () => {
    SettingsManager.registerSettings();
    loadTemplates([
        `modules/${SCOPE}/templates/sustain-reminder.hbs`
    ]);
});

// Any setup related stuff
Hooks.once("setup", () => {
    SocketsManager.initSockets();
})

// Once it is ready, now we can wrap functions
Hooks.once("ready", () => {
    WrapperManager.wrapFunctions();
});

// Create Chat Hook
Hooks.on("createChatMessage", async (message: ChatMessagePF2e) => {
    if (game.user?.id !== game.users?.activeGM?.id) return;
    await ChatManager.handleChatPayload(message);
});

// Delete Chat hook
Hooks.on("deleteChatMessage", (message: ChatMessagePF2e) => {
    // Only care about this if a combat is active
    if (!(game as any).combat?.active) return;
    if (!message.id) return;

    const actorId = (message.speaker as any).id || message.token?.actor?.id || message.actor?.id;
    if (!actorId) return;

    const combatant = game.combat?.combatants.find((c) => (c as any).actorId === actorId);
    if (!combatant) return;

    const context = message.flags?.pf2e;
    if (context && "isReroll" in context && context.isReroll) return;

    // Remove the action from your tracker history
    ChatManager.handleDeletedMessage(combatant, message.id);
});

// End of Combat hook
Hooks.on("deleteCombat", async (combat: EncounterPF2e) => {
    const g = game as unknown as Game;

    // Ensure only the primary GM clears the Quickened snapshot flags
    if (game.user?.id !== game.users?.activeGM?.id) return;

    for (const combatant of (combat.combatants as any)) {
        const actor = combatant.actor;
        if (actor) {
            // Passing 'any' here satisfies the ActorPF2e requirement of the handler
            await ActorHandler.cleanup(actor);
        }
    }

    ChatManager.clearRerollQueue();
    recentIntent.clear();

    logConsole("Action Tracker: Cleanup complete for all actors in ended combat.");
});

// Hook before the message is created -used to store flags for recent intent
Hooks.on("preCreateChatMessage", (message: any) => {
    const actorId = message.speaker.actor;
    const intentItemId = recentIntent.get(actorId);
    const messageItemId = message.flags?.pf2e?.origin?.uuid?.split('.').pop();

    if (intentItemId && intentItemId === messageItemId) {
        // Inject the flag BEFORE the message is created
        // This bypasses the PF2e sanitization because it's part of the initial creation
        message.updateSource({
            [`flags.${SCOPE}.isExplicitUse`]: true
        });
        recentIntent.delete(actorId);
    }
});

// Rendering the chat message
Hooks.on("renderChatMessage", (message: ChatMessagePF2e, html: any) => {

    ChatManager.onRenderChatMessage(message, html);
});

// UI Hooks for rendering combat tracker
Hooks.on("renderCombatTracker", (app: any, html: any, data: any) => {
    const htmlElement = html instanceof HTMLElement ? html : html[0] || (html.element instanceof HTMLElement ? html.element : null);
    if (!htmlElement || !data.combat) return;

    data.combat.combatants.forEach((c: any) => {
        CombatUIManager.injectIcons(htmlElement, c);
    });
    CombatUIManager.activateListeners(htmlElement);
});

// Chat card changed (like Heal selecting a cost or visibility)
Hooks.on("updateChatMessage", (message: ChatMessagePF2e, updateData: any) => {
    if (updateData.flags?.pf2e) {
        ChatManager.handleChatPayload(message);
    }

    // Check for any visibility-related changes
    const visibilityChanged =
        updateData.whisper !== undefined ||
        updateData.blind !== undefined ||
        "flags" in updateData; // Catching system-specific visibility flags if any

    if (visibilityChanged) {
        const combat = game.combat;
        if (!combat?.active) return;

        // Find the combatant associated with this message
        const actorId = message.actor?.id;
        const combatant = combat.combatants.find((c: CombatantPF2e) => (c as any).actorId === actorId);

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
    const g = game as unknown as Game;

    // Use Active GM check to ensure only one client processes the turn transition
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

// Movement Hook
Hooks.on("updateToken", (tokenDoc: any, update: any) => {
    if (game.user?.id !== game.users?.activeGM?.id) return;

    // Only care if x or y changed
    if (!("x" in update || "y" in update)) return;

    // Delegate everything to MovementManager
    MovementManager.handleTokenUpdate(tokenDoc, update);
});
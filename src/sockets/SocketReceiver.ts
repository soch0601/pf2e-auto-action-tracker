import { notifyWarn } from "../logger.ts";
import { SCOPE } from "../globals.ts";
import { SettingsManager } from "../SettingsManager.ts";
import { ActionManager } from "../ActionManager.ts";
import { MovementManager } from "../MovementManager.ts";
import { MovementHistoryService } from "../MovementHistoryService.ts";
import { ChatCardRenderer } from "../chat/ChatCardRenderer.ts";
import { ChatManager } from "../chat/ChatManager.ts";
import { findCombatantById } from "../foundryCompat.ts";
import { SummonManager } from "../summons/index.ts";

export class SocketReceiver {
    static initHandlers(socket: any) {
        if (!socket) return;

        // Register Sustain (Player -> GM)
        socket.register("processSustain", this.handleSustainRequest.bind(this));
        // Register Reset Sustain Choice (Player -> GM)
        socket.register("resetSustainChoice", this.handleResetSustainChoiceRequest.bind(this));
        // Register Whisper (GM -> Everyone)
        socket.register("attemptWhisper", this.handleSocketWhisper.bind(this));
        // Register Movement (Player -> GM)
        socket.register("processMovement", this.handleMovementRequest.bind(this));
        // Register Remove Action (Player -> GM)
        socket.register("removeAction", this.handleRemoveActionRequest.bind(this));
        // Register Reset History (Any -> Everyone)
        socket.register("resetMovementHistory", this.handleResetHistoryRequest.bind(this));
        // Register Add Action (Player -> GM)
        socket.register("addAction", this.handleAddActionRequest.bind(this));
        // Register Edit Action (Player -> GM)
        socket.register("editAction", this.handleEditActionRequest.bind(this));
        // Register Complete Complex Action (Player -> GM)
        socket.register("completeComplexAction", this.handleCompleteComplexActionRequest.bind(this));
        // Register Queue Reroll (Player -> GM)
        socket.register("queueReroll", this.handleQueueRerollRequest.bind(this));
        // Register Toggle Minion Grant (Player -> GM)
        socket.register("toggleMinionGrant", this.handleToggleMinionGrantRequest.bind(this));
    }

    private static async handleSustainRequest(data: any) {
        const msg = game.messages.get(data.messageId);
        if (msg) {
            await (msg as any).setFlag(SCOPE, "sustainChoice", {
                choice: data.choice,
                itemName: data.itemName,
                combatantId: data.combatantId,
                itemId: data.itemId,
                minionTokenId: data.minionTokenId
            });
        }

        const actor = (game.actors as any).get(data.actorId);
        if (actor) {
            if (data.choice === "yes") {
                await ChatCardRenderer.processSustainYes(actor, data.itemId, data.itemName, data.combatantId, data.messageId, data.minionTokenId);
            } else {
                const combatant = findCombatantById(game.combat, data.combatantId);
                await ChatCardRenderer.processSustainNo(actor, data.itemId, combatant, data.minionTokenId);
            }
        }
    }

    private static async handleMovementRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        const tokenDoc = game.scenes.active?.tokens.get(data.tokenId);
        if (!combatant || !tokenDoc) return;

        await MovementManager.processMovementFromData(combatant as any, tokenDoc, data);
    }

    private static async handleRemoveActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        if (!combatant) return;

        await ActionManager.removeAction(combatant as any, data.msgId, data.isRecursive);
    }

    private static async handleAddActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        if (!combatant) return;

        await ActionManager.addAction(combatant as any, data.action);
    }

    private static async handleEditActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        if (!combatant) return;

        await ActionManager.editAction(combatant as any, data.msgId, data.updates);
    }

    private static async handleCompleteComplexActionRequest(data: any) {
        if (!(game as any).user.isGM) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        if (!combatant) return;

        await ActionManager.completeComplexAction(combatant as any, data.action);
    }

    private static async handleToggleMinionGrantRequest(data: any) {
        if (!(game as any).user.isGM) return;
        if (!SummonManager.isEnabled()) return;
        const combatant = findCombatantById(game.combat, data.combatantId);
        if (!combatant) return;

        await SummonManager.toggleManualGrant(combatant);
    }

    private static handleQueueRerollRequest(data: any) {
        if (!(game as any).user.isGM) return;
        ChatManager.addToRerollQueue(data.combatantId, data.msgId);
    }

    private static handleResetHistoryRequest(data: any) {
        MovementHistoryService.resetCapturedHistory(data.tokenId);
    }

    private static async handleResetSustainChoiceRequest(data: any) {
        if (!(game as any).user.isGM) return;

        const message = game.messages.get(data.messageId);
        if (!message) return;

        if (data.choice === "yes" && data.combatantId) {
            const combatant = game.combat?.combatants.get(data.combatantId);
            if (combatant) {
                const logs = ActionManager.getFlattenedActions(combatant as any);
                const sustainAction = logs.find(log =>
                    log.slug === "sustain-a-spell" &&
                    log.sustainItem?.id === data.itemId &&
                    (!data.minionTokenId || log.sustainItem?.minionTokenId === data.minionTokenId)
                );
                if (sustainAction) {
                    await ActionManager.removeAction(combatant as any, sustainAction.msgId);
                }
            }
        }
        await (message as any).unsetFlag(SCOPE, "sustainChoice");
    }

    static async handleSocketWhisper(data: { targetPlayerIds: string[], header: string, message: string, setting: string }) {
        const { targetPlayerIds, header, message, setting } = data;
        const user = (game as any).user;

        const isTarget = targetPlayerIds.includes(user.id);
        const isGM = user.isGM;

        if (!isTarget && !isGM) return; // Ignore if current client is not a GM or not the target

        const isEnabled = SettingsManager.get(setting);
        if (setting && !isEnabled) return; // Setting is turned off, ignore

        // Trigger the UI notification popup
        notifyWarn(`${header}: ${message}`);

        // Create a LOCAL-ONLY chat message. 
        // Because this runs on the recipient's machine, only they see it.
        await ChatMessage.create({
            content: `<div class="pf2e-auto-action-tracker-alert"><strong>${header}:</strong> ${message}</div>`,
            whisper: [user.id],
            speaker: { alias: "PF2E Action Tracker" },
            flags: {
                [SCOPE]: { isAutoAlert: true }
            } as any
        });
    }
}

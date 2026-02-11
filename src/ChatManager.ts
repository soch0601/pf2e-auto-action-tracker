import { ActionManager, ActionLogEntry } from "./ActionManager";
import { SCOPE } from "./globals";
import { ActorPF2e, ChatMessagePF2e, CombatantPF2e } from "module-helpers";
import { SettingsManager } from "./SettingsManager";
import { PF2eChatParser } from "./PF2eChatParser";
import { ActorHandler } from "./ActorHandler";
import { SocketsManager } from "./SocketManager";
import { logConsole } from "./logger"

// Use a Template Literal Type for clarity, or just string
type CombatantId = string;

export class ChatManager {

    private static rerollQueue: Record<CombatantId, string[]> = {};

    /*
     * Handle a chat message payload.  Handles re-rolls, sustains, and any actions taken from chat messages...
     * This will ensure that if the message is modified, we edit the proper log entry, otherwise we create a new one
     */
    static async handleChatPayload(message: any) {
        const actor = message.actor;
        if (!actor || !(game as any).combat?.active) return;
        const combatant = (game as any).combat.combatants.find((c: any) => c.actorId === actor.id);
        if (!combatant) return;
        const pf2eFlags = message.flags?.pf2e;
        if (pf2eFlags?.context?.isReroll) {
            const oldMsgId = this.popFromRerollQueue(combatant.id);

            if (!oldMsgId) {
                logConsole("Reroll detected but the queue was empty.");
                return;
            }

            const action = ActionManager.getActionById(combatant, oldMsgId);
            if (!action) {
                logConsole(`Reroll detected for ${oldMsgId}, but no matching action was found in history.`);
                return;
            }

            await ActionManager.editAction(combatant, oldMsgId, { msgId: message.id });
            logConsole(`Reroll processed: ${oldMsgId} -> ${message.id}`);
            return;
        }

        // Delegate detection and metadata extraction to Parser
        if (PF2eChatParser.isSustainMessage(message)) {
            this.processSustainMessage(message, actor);
        }

        const data = PF2eChatParser.parse(message);
        if (!data) return;

        const isQuickenedEligible = ActorHandler.isActionQuickenedEligible(actor, data.slug);

        // Check if we are updating an existing message or logging a new one
        const log = ActionManager.getActionById(combatant, message.id);

        if (log) {
            const update: Partial<ActionLogEntry> = {
                cost: data.cost,
                label: data.label,
                isQuickenedEligible
            };
            await ActionManager.editAction(combatant, message.id, update);
        } else {
            // 1. Determine if it is a reaction based on the parser OR the turn state
            const isActiveTurn = (game as any).combat.combatant?.id === combatant.id;
            const type = (data.isReaction || !isActiveTurn) ? 'reaction' : 'action';

            // 2. Add the action
            await ActionManager.addAction(combatant, {
                cost: data.cost,
                msgId: message.id,
                label: data.label,
                type: type,
                isQuickenedEligible
            });
        }
    }

    /**
     * Handles rendering of the chat messages for our custom sustain spells - and adds the onClick logic for the buttons in it
     */
    static onRenderChatMessage(message: any, html: JQuery) {
        const sustainButtons = html.find("button[data-action^='sustain-']");
        if (sustainButtons.length === 0) return;

        const choiceData = message.getFlag(SCOPE, "sustainChoice") as { choice: string, itemName: string };

        if (choiceData) {
            const card = html.find('.pf2e-auto-action-tracker-sustain-card');
            if (choiceData.choice === 'yes') {
                card.find("button[data-action='sustain-yes']").html('<i class="fas fa-check"></i> Sustained').prop('disabled', true);
                card.find("button[data-action='sustain-no']").hide();
            } else {
                card.find("button[data-action='sustain-no']").html('<i class="fas fa-times"></i> Lapsed').prop('disabled', true);
                card.find("button[data-action='sustain-yes']").hide();
            }
            return;
        }

        sustainButtons.on("click", async (event) => {
            event.preventDefault();
            const button = event.currentTarget;
            const { action, actorId, itemId, itemName } = button.dataset;

            const card = $(button).closest('.pf2e-auto-action-tracker-sustain-card');
            card.find('button').prop('disabled', true).css({ 'opacity': '0.5' });

            const actor = (game.actors as any).get(actorId ?? "");
            if (!actor || (!actor.isOwner && !game.user.isGM)) return;

            const choice = action === "sustain-yes" ? "yes" : "no";
            const payload = {
                messageId: message.id,
                actorId: actor.id,
                itemId: itemId || "",
                itemName: itemName || "",
                choice: choice
            };

            if (game.user.isGM) {
                // GM just runs it locally
                if (choice === "yes") {
                    await this.processSustainYes(actor, itemId || "", itemName || "");
                } else {
                    await this.processSustainNo(actor, itemId || "");
                }
                await (message as any).setFlag(SCOPE, "sustainChoice", { choice, itemName });
            } else {
                // Player hands it to the GM via Socketlib
                SocketsManager.emitSustainChoice(payload);
            }
        });
    }

    /**
     * Checks for items that needs to be sustained and sends out messages for them
     */
    static async checkSustainReminder(actor: ActorPF2e) {
        if (!SettingsManager.get("whisperSustain")) return;

        // Get the combatant for this actor
        // Look for the combatant where the actor property matches the actor we have
        const combatant = game.combat?.combatants.contents.find(c => (c as any).actorId === actor.id);
        if (!combatant) return;
        const c = combatant as any;
        const sustainData = (c.getFlag(SCOPE, "sustainData") as unknown as Record<string, string>) || {};

        // Check if they sustained anything last round
        if (Object.keys(sustainData).length > 0) {
            for (const [itemId, itemName] of Object.entries(sustainData)) {
                const content = await renderTemplate(`modules/${SCOPE}/public/templates/sustain-reminder.hbs`, {
                    actorId: actor.id,
                    itemId: itemId,
                    itemName: itemName
                });

                await ChatMessage.create({
                    content: content,
                    whisper: ChatMessage.getWhisperRecipients(actor.name).map((u: any) => u.id),
                    speaker: ChatMessage.getSpeaker({ actor: actor as any })
                });
            }
        }
    }

    /**
     * Sends out a whispered alert to the given actor AND GMs...
     */
    static async whisperAlert(actor: ActorPF2e, header: string, message: string) {
        const recipients = [...new Set([
            ...ChatMessage.getWhisperRecipients(actor.name).map((u: any) => u.id),
            ...(game as any).users.filter((u: any) => u.isGM).map((u: any) => u.id)
        ])];

        await ChatMessage.create({
            content: `<div class="pf2e-auto-action-tracker-alert"><strong>${header}:</strong> ${message}</div>`,
            whisper: recipients,
            speaker: { alias: "PF2E Action Tracker" }
        });
    }

    /**
     * Adds an old message ID to our reroll queue tracker
     */
    static addToRerollQueue(combatantId: string, msgId: string) {
        if (!this.rerollQueue[combatantId]) this.rerollQueue[combatantId] = [];
        if (!this.rerollQueue[combatantId].includes(msgId)) {
            this.rerollQueue[combatantId].push(msgId);
        }
    }

    /**
      * Clean up the reroll queue
      */
    static clearRerollQueue(combatantId?: string) {
        if (combatantId) {
            delete this.rerollQueue[combatantId];
        } else {
            this.rerollQueue = {};
        }
    }

    /**
     * If we delete a message, delete the associated action (unless it is part of the reroll queue)
     */
    static handleDeletedMessage(combatant: CombatantPF2e, msgId: string) {
        if (this.rerollQueueIncludes(combatant, msgId)) return;
        ActionManager.removeAction(combatant, msgId);
    }

    /**
 * Handles if the sustain yes button was clicked on a message
 */
    static async processSustainYes(actor: any, itemId: string, itemName: string) {
        const item = actor.items.get(itemId);
        const displayName = itemName || item?.name || "Action";

        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<h4 class="action"><strong>Sustain</strong> <span class="action-glyph">1</span></h4>`,
            content: `<div class="pf2e">Sustaining <strong>${displayName}</strong></div>`,
            flags: {
                pf2e: {
                    origin: {
                        uuid: item?.uuid,
                        name: displayName, // Added this for the tracker
                        type: item?.type || "item",
                        slug: "sustain-a-spell"
                    },
                    context: {
                        type: "action",
                        title: `Sustain: ${displayName}`, // The tracker often looks here
                        options: ["num-actions:1", "action:sustain-a-spell"]
                    }
                },
                [SCOPE]: {
                    isSustainAutomation: true,
                    sustainedItemId: itemId,
                    sustainedItemName: displayName
                }
            } as any
        });
    }

    /**
     * Handles if the systain button no was pressed.  Attempts to do a small amount of cleanup
     */
    static async processSustainNo(actor: any, itemId: string) {

        const item = actor.items.get(itemId);
        // Even if item is null, we proceed to cleanup flags and effects

        const combatant = game.combat?.combatants.contents.find(c => (c as any).actorId === actor.id);
        if (combatant) {
            await ActionManager.stopSustaining(combatant as any, itemId);
        }

        // If the item is missing (like a Wand spell), we search for effects 
        // that claim this itemId as their origin.
        const relatedEffects = actor.itemTypes.effect.filter((e: any) => {
            const originUuid = e.flags?.pf2e?.origin?.uuid;
            // Check UUID match OR if the effect was tracked by this specific ID
            return (item && originUuid === item.uuid) || originUuid?.includes(itemId);
        });

        for (const effect of relatedEffects) {
            await effect.delete();
            logConsole('Deleted effect from sustain no: ', effect);
        }

        if (item) {
            // Only delete the item if it's an actual 'effect' type and not protected
            const protectedTypes = ["spell", "weapon", "equipment", "consumable", "backpack", "treasure"];
            if (!protectedTypes.includes(item.type)) {
                await item.delete();
                logConsole('Deleted item from sustain no: ', item);
            }
        }
    }

    /**
     * Determine if a reroll queue for a combatant includes a message ID
     */
    private static rerollQueueIncludes(combatant: CombatantPF2e, msgId: string): boolean {
        const combatantId = (combatant as unknown as Combatant).id;
        if (!combatantId) return false;
        // Returns true if the id is in the array, false otherwise (even if queue is missing)
        return this.rerollQueue[combatantId]?.includes(msgId) ?? false;
    }

    /**
     * Pop and item from the reroll queue and return it
     */
    private static popFromRerollQueue(combatantId: string): string | undefined {
        return this.rerollQueue[combatantId]?.shift();
    }

    /**
     * Moves the sustain-specific flag parsing out of the main loop
     */
    private static processSustainMessage(message: ChatMessagePF2e, actor: ActorPF2e) {
        const { itemId, itemName } = PF2eChatParser.getSustainMetadata(message);

        if (itemId && message.id) {
            ActionManager.trackSustain(actor, message.id, itemId, itemName);
        }
    }
}
import { ActionManager, ActionLogEntry } from "./ActionManager";
import { SCOPE } from "./globals";
import { ActorPF2e, ChatMessagePF2e, CombatantPF2e } from "module-helpers";
import { SettingsManager } from "./SettingsManager";
import { ActorHandler } from "./ActorHandler";
import { SocketsManager } from "./SocketManager";
import { logConsole } from "./logger"
import * as Detectors from "./chatTypeDetectors";
import type { IActionDetails } from "./chatTypeDetectors/IActionDetector";

// Use a Template Literal Type for clarity, or just string
type CombatantId = string;

export class ChatManager {

    private static rerollQueue: Record<CombatantId, string[]> = {};

    // Keyed by Combatant ID to allow multiple combatants to process in parallel
    private static _queueSemaphore = new Map<string, Promise<void>>();

    public static registerOverrideListeners() {
        document.addEventListener('click', async (event) => {
            const target = event.target as HTMLElement;
            const btn = target.closest<HTMLButtonElement>('button');
            if (!btn) return;

            if (btn.matches('[data-action="strike-damage"], [data-action="strike-critical"], [data-action="spell-damage"], [data-action="damage"]')) {
                const chatMessage = btn.closest('.chat-message');
                const originMsgId = chatMessage?.getAttribute('data-message-id');
                if (!originMsgId) return;

                const message = game.messages.get(originMsgId);
                const combatant = this.getCombatantFromMsg(message);
                if (!combatant) return;

                const c = combatant as any;
                const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];
                queue.push(originMsgId);
                await c.setFlag(SCOPE, 'pendingDamageQueue', queue);

                // Note: If the dialog opens, the render hook (Step 2) will 
                // handle moving this ID from the queue to the Dialog instance.
            }
        }, { capture: true });
    }

    public static async handleDamageModifierDialogRender(combatant: CombatantPF2e, app: any) {
        const c = combatant as any;
        const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];
        if (queue.length === 0) return;

        const originMsgId = queue.pop();
        if (!originMsgId) return;

        await c.setFlag(SCOPE, 'pendingDamageQueue', queue);

        // Attach to the app instance AFTER the flag is safely updated
        app.options.originatingMessageId = originMsgId;
    }

    public static getCombatantFromMsg(message: any): CombatantPF2e | undefined {
        const actor = message.actor;
        if (!actor || !(game as any).combat?.active) return;
        const speaker = message.speaker;
        const combatant = (game as any).combat.combatants.find((c: any) =>
            speaker.token ? c.tokenId === speaker.token : c.actorId === actor.id
        );

        return combatant;
    }

    public static async maybeGetOriginMsgId(message: any) {
        const isDamageRoll = message.flags?.pf2e?.context?.type === "damage-roll";
        if (!isDamageRoll) return;

        const combatant = this.getCombatantFromMsg(message);
        if (!combatant) return;

        let originatingMsgId: string | undefined;

        // A. Check if there's an active Dialog for this actor
        const activeDialog = Object.values(ui.windows).find(
            (w: any) => w.constructor.name === "DamageModifierDialog" && w.actor?.id === (combatant as any).actorId
        ) as any;

        if (activeDialog?.options?.originatingMessageId) {
            originatingMsgId = activeDialog.options.originatingMessageId;
            // Clean up the dialog so it doesn't double-trigger
            delete activeDialog.options.originatingMessageId;
        } else {
            // B. Fallback to Queue (The Shift+Click scenario)
            const c = combatant as any;
            const queue = (c.getFlag(SCOPE, 'pendingDamageQueue') as string[]) || [];

            originatingMsgId = queue.shift(); // FIFO for rolls

            if (queue.length > 0) {
                await c.setFlag(SCOPE, 'pendingDamageQueue', queue);
            } else {
                await c.unsetFlag(SCOPE, 'pendingDamageQueue');
            }
        }

        if (!originatingMsgId) {
            // A. Check if there's an active Dialog for this actor
            // We look for the dialog that is currently being "submitted"
            const activeDialog = Object.values(ui.windows).find((w: any) =>
                w.constructor.name === "DamageModifierDialog" &&
                w.actor?.id === (combatant as any).actorId &&
                w.options?.originatingMessageId // Ensure it has our custom flag
            ) as any;

            if (activeDialog?.options?.originatingMessageId) {
                originatingMsgId = activeDialog.options.originatingMessageId;
                // IMPORTANT: Mark it so other hooks don't grab it
                delete activeDialog.options.originatingMessageId;
            }
        }

        return originatingMsgId;

    }

    /*
     * Handle a chat message payload.  Handles re-rolls, sustains, and any actions taken from chat messages...
     * This will ensure that if the message is modified, we edit the proper log entry, otherwise we create a new one
     */
    static async handleChatPayload(message: any) {
        const combatant = this.getCombatantFromMsg(message);
        const c = combatant as any;

        if (!combatant) return;

        const originId = await this.maybeGetOriginMsgId(message);
        if (originId) {
            ActionManager.linkDamageToAttack(combatant, originId, message.id);
            return;
        }

        const pf2eFlags = message.flags?.pf2e;
        if (pf2eFlags?.context?.isReroll) {
            const oldMsgId = this.popFromRerollQueue(c.id);

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
        if (Detectors.SustainDetector.isSustainMessage(message)) {
            this.processSustainMessage(message, combatant);
        }

        const data = this.runMessageDetectors(message);
        if (!data) return;

        const isQuickenedEligible = ActorHandler.isActionQuickenedEligible(combatant, data.slug);

        // Check if we are updating an existing message or logging a new one
        const log = ActionManager.getActionById(combatant, message.id);

        const mapMetadata: Pick<ActionLogEntry, "isMapRelevant" | "mapProfile"> =
            data.isMapRelevant
                ? {
                    isMapRelevant: true,
                    mapProfile: data.mapProfile ?? "standard"
                }
                : {
                    isMapRelevant: false,
                    mapProfile: undefined
                };

        if (log) {
            const update: Partial<ActionLogEntry> = {
                cost: data.cost,
                label: data.label,
                isQuickenedEligible,
                ...mapMetadata
            };
            await ActionManager.editAction(combatant, message.id, update);
        } else {
            // 1. Determine if it is a reaction based on the parser OR the turn state
            const isActiveTurn = (game as any).combat.combatant?.id === c.id;
            const type = (data.isReaction || !isActiveTurn) ? 'reaction' : 'action';

            // 2. Add the action
            await ActionManager.addAction(combatant, {
                cost: data.cost,
                msgId: message.id,
                label: data.label,
                type: type,
                slug: data.slug,
                isQuickenedEligible,
                ...mapMetadata,
                category: data.category,
                linkedMessages: []
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
            const { action, actorId, itemId, itemName, combatantId } = button.dataset;

            const actor = (game.actors as any).get(actorId ?? "");
            if (!actor || (!actor.isOwner && !game.user.isGM)) return;

            // Resolve the combatant directly by ID (Identity Crisis Solved)
            const combatant = game.combat?.combatants.get(combatantId || "");

            const choice = action === "sustain-yes" ? "yes" : "no";
            const payload = {
                messageId: message.id,
                actorId: actor.id,
                combatantId: combatantId, // Pass this to the socket
                itemId: itemId || "",
                itemName: itemName || "",
                choice: choice
            };

            if (game.user.isGM) {
                if (choice === "yes") {
                    await this.processSustainYes(actor, itemId || "", itemName || "", combatantId);
                } else {
                    // Pass the specific combatant found via ID
                    await this.processSustainNo(actor, itemId || "", combatant);
                }
                await (message as any).setFlag(SCOPE, "sustainChoice", { choice, itemName });
            } else {
                SocketsManager.emitSustainChoice(payload);
            }
        });
    }

    /**
     * Checks for items that needs to be sustained and sends out messages for them
     */
    static async checkSustainReminder(combatant: CombatantPF2e) {
        if (!SettingsManager.get("whisperSustain")) return;

        const c = combatant as any;
        const actor = c.actor;

        // Safety check: ensure actor exists and has a name
        if (!actor?.name) return;

        const sustainData = (c.getFlag(SCOPE, "sustainData") as Record<string, string>) || {};

        if (Object.keys(sustainData).length > 0) {
            for (const [itemId, itemName] of Object.entries(sustainData)) {
                const content = await renderTemplate(`modules/${SCOPE}/templates/sustain-reminder.hbs`, {
                    combatantId: c.id,
                    actorId: actor.id,
                    itemId: itemId,
                    itemName: itemName
                });

                const recipients = ChatMessage.getWhisperRecipients(actor.name);

                await ChatMessage.create({
                    content: content,
                    // Map the user objects to IDs
                    whisper: recipients.map((u: any) => u.id),
                    // Pass the actual actor document here
                    speaker: ChatMessage.getSpeaker({ actor: actor })
                });
            }
        }
    }

    /**
     * Sends out a whispered alert to the given actor AND GMs...
     */
    static async triggerAlert(actor: ActorPF2e, header: string, message: string, settingKey: string) {
        const playerIds = Object.entries(actor.ownership)
            .filter(([id, level]) => level === 3 && id !== "default")
            .map(([id]) => id);

        const payload = {
            targetPlayerIds: playerIds,
            header,
            message,
            setting: settingKey
        };

        // Execute for everyone so each client checks their own local settings
        SocketsManager.socket.executeForEveryone("ATTEMPT_WHISPER", payload);
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
    static async handleDeletedMessage(combatant: CombatantPF2e, msgId: string) {
        if (this.rerollQueueIncludes(combatant, msgId)) return;
        await ActionManager.removeAction(combatant, msgId);
    }

    /**
      * Handles if the sustain yes button was clicked on a message
      */
    static async processSustainYes(actor: any, itemId: string, itemName: string, combatantId?: string) {
        const item = actor.items.get(itemId);
        const displayName = itemName || item?.name || "Action";
        const combatant = game.combat?.combatants.get(combatantId || "");
        const token = (combatant as any)?.token;

        await ChatMessage.create({
            // Force the speaker to be the proper token, since this is what we process on...
            speaker: {
                actor: actor.id,
                token: token?.id,
                scene: token?.parent?.id,
                alias: actor.name
            },
            flavor: `<h4 class="action"><strong>Sustain</strong> <span class="action-glyph">1</span></h4>`,
            content: `<div class="pf2e">Sustaining <strong>${displayName}</strong></div>`,
            flags: {
                pf2e: {
                    origin: {
                        uuid: item?.uuid,
                        name: displayName,
                        type: item?.type || "item",
                        slug: "sustain-a-spell"
                    },
                    context: {
                        type: "action",
                        title: `Sustain: ${displayName}`,
                        options: ["num-actions:1", "action:sustain-a-spell"]
                    }
                },
                [SCOPE]: {
                    isSustainAutomation: true,
                    sustainedItemId: itemId,
                    sustainedItemName: displayName
                }
            }
        } as any);
    }

    /**
     * Handles if the systain button no was pressed.  Attempts to do a small amount of cleanup
     */
    static async processSustainNo(actor: any, itemId: string, combatant?: any) {
        // 1. Precise Cleanup of flags
        // If we don't have a combatant passed in, try to find one (fallback)
        const targetCombatant = combatant || game.combat?.combatants.contents.find(c => (c as any).actorId === actor.id);

        if (targetCombatant) {
            await ActionManager.stopSustaining(targetCombatant, itemId);
        }

        // 2. Effect Cleanup
        const item = actor.items.get(itemId);
        const relatedEffects = actor.itemTypes.effect.filter((e: any) => {
            const originUuid = e.flags?.pf2e?.origin?.uuid;
            return (item && originUuid === item.uuid) || originUuid?.includes(itemId);
        });

        for (const effect of relatedEffects) {
            await effect.delete();
        }

        // 3. Item Cleanup (e.g. temporary spell effects)
        if (item) {
            const protectedTypes = ["spell", "weapon", "equipment", "consumable", "backpack", "treasure"];
            if (!protectedTypes.includes(item.type)) {
                await item.delete();
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
    private static processSustainMessage(message: ChatMessagePF2e, combatant: CombatantPF2e) {
        const { itemId, itemName } = Detectors.SustainDetector.getSustainMetadata(message);

        if (itemId && message.id) {
            ActionManager.trackSustain(combatant, message.id, itemId, itemName);
        }
    }

    private static runMessageDetectors(message: any): {
        cost: number,
        slug: string,
        label: string,
        isReaction: boolean,
        category: string,
        isMapRelevant?: boolean,
        mapProfile?: "standard" | "agile"
    } | undefined {
        const activeDetectors = [
            Detectors.HardIgnoreDetector,
            Detectors.SustainDetector,
            Detectors.SpellDetector,
            Detectors.ConsumableDetector,
            Detectors.AttackDetector,
            Detectors.SkillDetector,
            Detectors.GenericActionDetector
        ];

        for (const Detector of activeDetectors) {
            // 1. Kill the loop if a detector identifies this as "noise" (e.g. Damage Rolls)
            if (Detector.shouldBreak(message)) {
                return undefined;
            };

            // 2. If this detector recognizes the message, parse it and stop
            if (Detector.isType(message)) {
                const details: IActionDetails = Detector.getDetails(message);

                // Handle Whisper/Secret logic here globally
                const isPublic = message.whisper.length === 0 || message.whisper.includes(game.user.id);
                const finalLabel = isPublic ? details.label : "Secret Action";

                return {
                    cost: details.cost ?? 0,
                    slug: details.slug ?? "",
                    label: finalLabel ?? "",
                    isReaction: details.isReaction,
                    category: Detector.type,
                    isMapRelevant: details.isMapRelevant,
                    mapProfile: details.mapProfile
                };
            }
        }

        return undefined;
    }
}

import { ChatManager } from "./ChatManager";
import { logConsole } from "./logger";
import { recentIntent } from "./globals";

declare const libWrapper: any;

export class WrapperManager {

    static wrapFunctions() {
        // Ensure libWrapper is active before trying to register
        if (typeof libWrapper === 'undefined') {
            logConsole('libWrapper not found! Reroll tracking will be disabled.');
            return;
        }

        // Wrap the Check.rerollFromMessage to log the old message ID from a message being rerolled.  Used to track which action to update once the reroll happens
        libWrapper.register("pf2e-auto-action-tracker", "game.pf2e.Check.rerollFromMessage", function (this: any, wrapped: Function, ...args: any[]) {
            const message = args[0]; // The original ChatMessage being rerolled

            if (message?.id) {
                // Find the combatant via the speaker info
                const actorId = message.speaker?.actor;
                const combatant = game.combat?.combatants.find((c: any) => c.actorId === actorId);
                const c = combatant as unknown as Combatant

                if (c?.id) {
                    ChatManager.addToRerollQueue(c.id, message.id);
                } else {
                    // Fallback: if not in combat, maybe just log by actor ID or skip
                    logConsole("No combatant found for reroll message.");
                }
            }

            return wrapped.apply(this, args);
        }, "WRAPPER");

        // Wrapper for tracking spell casting (as opposed to spell linking)
        libWrapper.register(
            "pf2e-auto-action-tracker",
            "CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast",
            async function (this: any, wrapped: Function, spell: any, options: any = {}) {
                const actorId = this.actor?.id;
                if (actorId) {
                    recentIntent.set(actorId, spell.id);
                }
                return wrapped(spell, options);
            },
            "WRAPPER"
        );

        // Wrapper for tracking consumable using (as opposed to consumable linking)
        libWrapper.register(
            "pf2e-auto-action-tracker",
            "CONFIG.PF2E.Item.documentClasses.consumable.prototype.consume",
            async function (this: any, wrapped: Function, ...args: any[]) {
                const actorId = this.actor?.id;
                if (actorId) {
                    // Use the item ID to mark intent 
                    recentIntent.set(actorId, this.id);
                }
                return wrapped(...args);
            },
            "WRAPPER"
        );
    }
}
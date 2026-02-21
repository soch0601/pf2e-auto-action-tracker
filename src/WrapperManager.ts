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
            const message = args[0];
            if (message?.id) {
                const speaker = message.speaker;
                const combatant: any = game.combat?.combatants.find((c: any) =>
                    speaker.token ? c.tokenId === speaker.token : c.actorId === speaker.actor
                );

                if (combatant?.id) {
                    ChatManager.addToRerollQueue(combatant.id, message.id);
                }
            }
            return wrapped.apply(this, args);
        }, "WRAPPER");

        // Wrapper for tracking spell casting (as opposed to spell linking)
        libWrapper.register(
            "pf2e-auto-action-tracker",
            "CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast",
            async function (this: any, wrapped: Function, spell: any, options: any = {}) {
                const actor = this.actor;
                const token = actor.token ?? actor.getActiveTokens()[0];
                const uniqueKey = token?.id ?? actor.id;

                if (uniqueKey && spell) {
                    recentIntent.set(uniqueKey, spell.id);
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
                const actor = this.actor;
                const token = actor.token ?? actor.getActiveTokens()[0]; // Grab the specific token if possible
                const uniqueKey = token?.id ?? actor.id;

                if (uniqueKey) {
                    recentIntent.set(uniqueKey, this.id);
                }
                return wrapped(...args);
            },
            "WRAPPER"
        );
    }
}
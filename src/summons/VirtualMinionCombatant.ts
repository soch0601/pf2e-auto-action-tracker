import { SCOPE } from "../globals.ts";
import type { ActorPF2e } from "module-helpers";
import { MINION_ID_PREFIX } from "./summonCompat.ts";

/**
 * Virtual Combatant adapter for a summoned minion token.
 * Stores all action tracker flags on the controller's Combatant document under:
 *   `controllerCombatant.flags[SCOPE].minions[tokenId]`
 * so that updating a minion's action log never pollutes Foundry's `canvas.tokens.undoHistory` (Ctrl+Z) stack
 * and automatically triggers standard Combatant update renders across all connected clients.
 */
export class VirtualMinionCombatant {
    public readonly isVirtualMinion = true;
    public readonly tokenDoc: any;
    public readonly controllerCombatant: any;

    constructor(tokenDocOrPlaceable: any, controllerCombatant: any) {
        this.tokenDoc = tokenDocOrPlaceable?.document ?? tokenDocOrPlaceable;
        this.controllerCombatant = controllerCombatant;
    }

    private getMinionFlagStore(): Record<string, any> {
        const controller = this.controllerCombatant;
        if (!controller) return {};
        const minionsMap =
            controller.getFlag?.(SCOPE, "minions") ??
            controller.flags?.[SCOPE]?.minions;
        return minionsMap?.[this.tokenId] ?? {};
    }

    get flags(): any {
        return {
            [SCOPE]: this.getMinionFlagStore()
        };
    }

    get id(): string {
        return `${MINION_ID_PREFIX}${this.tokenDoc.id}`;
    }

    get tokenId(): string {
        return this.tokenDoc.id;
    }

    get token(): any {
        return this.tokenDoc;
    }

    get actorId(): string | undefined {
        return this.tokenDoc.actor?.id ?? this.tokenDoc.actorId;
    }

    get actor(): ActorPF2e | undefined {
        return this.tokenDoc.actor;
    }

    get name(): string {
        return this.tokenDoc.name || this.tokenDoc.actor?.name || "Summoned Minion";
    }

    get img(): string {
        return (
            this.tokenDoc.texture?.src ||
            this.tokenDoc.actor?.prototypeToken?.texture?.src ||
            this.tokenDoc.actor?.img ||
            "icons/svg/mystery-man.svg"
        );
    }

    get isDefeated(): boolean {
        const realCombatant = this.tokenDoc.combatant;
        if (realCombatant?.defeated || realCombatant?.isDefeated) return true;
        const actor = this.actor as any;
        const hp = actor?.system?.attributes?.hp;
        if (hp && typeof hp.value === "number" && hp.value <= 0 && (hp.max ?? 1) > 0) {
            return true;
        }
        return Boolean(actor?.hasCondition?.("dead"));
    }

    get hidden(): boolean {
        return Boolean(this.tokenDoc.hidden || this.tokenDoc.combatant?.hidden);
    }

    getFlag(scope: string, key: string): any {
        if (scope === SCOPE) {
            const store = this.getMinionFlagStore();
            if (key in store) return store[key];
        }
        if (typeof this.tokenDoc.getFlag === "function") {
            const val = this.tokenDoc.getFlag(scope, key);
            if (val !== undefined) return val;
        }
        return this.tokenDoc.flags?.[scope]?.[key];
    }

    async setFlag(scope: string, key: string, value: any): Promise<any> {
        if (scope === SCOPE) {
            return await this.update({ [`flags.${SCOPE}.${key}`]: value });
        }
        if (typeof this.tokenDoc.setFlag === "function") {
            return await this.tokenDoc.setFlag(scope, key, value);
        }
        if (!this.tokenDoc.flags) this.tokenDoc.flags = {};
        if (!this.tokenDoc.flags[scope]) this.tokenDoc.flags[scope] = {};
        this.tokenDoc.flags[scope][key] = value;
        return this.tokenDoc;
    }

    async unsetFlag(scope: string, key: string): Promise<any> {
        if (scope === SCOPE) {
            return await this.update({ [`flags.${SCOPE}.${key}`]: null });
        }
        if (typeof this.tokenDoc.unsetFlag === "function") {
            return await this.tokenDoc.unsetFlag(scope, key);
        }
        if (this.tokenDoc.flags?.[scope]) {
            delete this.tokenDoc.flags[scope][key];
        }
        return this.tokenDoc;
    }

    async update(updateData: Record<string, any>, _options?: any): Promise<any> {
        const controller = this.controllerCombatant;
        if (!controller) return;

        const existingMinions = {
            ...(controller.getFlag?.(SCOPE, "minions") ?? controller.flags?.[SCOPE]?.minions ?? {})
        };
        const currentStore = { ...(existingMinions[this.tokenId] ?? {}) };

        for (const [k, v] of Object.entries(updateData)) {
            if (k.startsWith(`flags.${SCOPE}.`)) {
                const flagKey = k.slice(`flags.${SCOPE}.`.length);
                currentStore[flagKey] = v;
            }
        }

        existingMinions[this.tokenId] = currentStore;

        // Also keep in-memory flags synced on controller for unit tests and immediate synchronous reads
        if (!controller.flags) controller.flags = {};
        if (!controller.flags[SCOPE]) controller.flags[SCOPE] = {};
        controller.flags[SCOPE].minions = existingMinions;

        if (typeof controller.update === "function") {
            return await controller.update({
                [`flags.${SCOPE}.minions`]: existingMinions
            });
        } else if (typeof controller.setFlag === "function") {
            return await controller.setFlag(SCOPE, "minions", existingMinions);
        }
        return controller;
    }
}

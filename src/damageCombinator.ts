import { SCOPE } from "./globals.ts";
import type { CombatantPF2e } from "module-helpers";
import { ActionManager } from "./ActionManager.ts";
import { ComplexActionEngine } from "./complexActions/ComplexActionEngine.ts";
import type { ActionLogEntry } from "./ActionLogTypes.ts";
import { logInfo } from "./logger.ts";

export class DamageCombinator {
    public static async processDamageCombination(combatant: CombatantPF2e, parentEntry: ActionLogEntry, triggeringMsgId?: string, isCritImmuneOverride?: boolean) {
        if (!parentEntry.ComplexActionState) return;

        const state = parentEntry.ComplexActionState;
        const damageMessagePairs = this.getDamageMessagePairs(state);

        if (!damageMessagePairs || damageMessagePairs.length < 2) {
            return;
        }

        const { chatMessages, targetUuid } = this.extractMessagesAndTarget(damageMessagePairs);
        if (chatMessages.length !== damageMessagePairs.length) {
            return;
        }

        const { isCritImmune, targetName } = await this.detectCritImmunity(targetUuid, isCritImmuneOverride);
        const { aggregatedDamage, persistentFormulas } = this.extractDamageInstances(chatMessages, isCritImmune);

        const formula = this.buildFinalFormula(aggregatedDamage, persistentFormulas);
        if (!formula) return;

        const finalRolls = await this.evaluateDamageRoll(formula);
        if (!finalRolls) return;

        await this.waitFor3DDice(triggeringMsgId);

        const mergedFlavorHtml = this.mergeHTMLFlavors(chatMessages);
        const flavorText = this.generateCombinedFlavorText(mergedFlavorHtml, targetName, isCritImmune);
        const pf2eFlags = this.extractPf2eFlags(chatMessages);

        await this.createOrUpdateMessage(combatant, parentEntry, state, finalRolls, flavorText, pf2eFlags, isCritImmune);
    }

    private static getDamageMessagePairs(state: any): { damageMsgId: string, attackMsgId: string }[] | null {
        const childActions = ComplexActionEngine.getAllChildActions(state);
        const damageMessagePairs: { damageMsgId: string, attackMsgId: string }[] = [];
        let combineDamageFound = false;

        for (const action of childActions) {
            const leaf = ComplexActionEngine.findLeafByMessageId(state, action.msgId);
            if (leaf && leaf.modifiers.includes('combineDamage')) {
                combineDamageFound = true;
                const activeDamage = action.linkedMessages.find(m => m.type === 'damage' && (game as any).messages.get(m.msgId));
                if (activeDamage) {
                    damageMessagePairs.push({ damageMsgId: activeDamage.msgId, attackMsgId: action.msgId });
                }
            }
        }

        if (!combineDamageFound) return null;
        return damageMessagePairs;
    }

    private static extractMessagesAndTarget(damageMessagePairs: { damageMsgId: string, attackMsgId: string }[]): { chatMessages: any[], targetUuid: string | undefined } {
        const chatMessages = damageMessagePairs.map(p => (game as any).messages.get(p.damageMsgId)).filter(m => m !== undefined);
        const attackMessages = damageMessagePairs.map(p => (game as any).messages.get(p.attackMsgId)).filter(m => m !== undefined);

        const allRelatedMessages = [...attackMessages, ...chatMessages];

        const targets = allRelatedMessages.map(m => {
            const contextTarget = m.flags?.pf2e?.context?.target?.token || m.flags?.pf2e?.context?.target?.actor;
            const targetValue = m.flags?.pf2e?.target?.value || m.flags?.pf2e?.target?.token || m.flags?.pf2e?.target?.actor;
            return contextTarget || targetValue;
        }).filter(t => t !== undefined && t !== null);

        let targetUuid: string | undefined = undefined;

        if (targets.length > 0) {
            const firstTarget = targets[0];
            const allSameTarget = targets.every(t => t === firstTarget);

            if (!allSameTarget) {
                return { chatMessages: [], targetUuid: undefined };
            }
            targetUuid = firstTarget;
        }

        return { chatMessages, targetUuid };
    }

    private static async detectCritImmunity(targetUuid: string | undefined, isCritImmuneOverride?: boolean): Promise<{ isCritImmune: boolean, targetName: string }> {
        let isCritImmune = false;
        let targetName = "Unknown Target";

        if (typeof isCritImmuneOverride === 'boolean') {
            isCritImmune = isCritImmuneOverride;
        }

        if (targetUuid) {
            const targetDoc = await (globalThis as any).fromUuid(targetUuid);
            if (targetDoc) {
                if (targetDoc.name) targetName = targetDoc.name;
                const actor = targetDoc.actor || targetDoc;
                if (actor?.system?.attributes?.immunities?.some((i: any) => i.type === 'critical-hits')) {
                    isCritImmune = true;
                }
            }
        }

        return { isCritImmune, targetName };
    }

    private static extractDamageInstances(chatMessages: any[], isCritImmune: boolean): { aggregatedDamage: Record<string, number>, persistentFormulas: string[] } {
        const aggregatedDamage: Record<string, number> = {};
        const persistentFormulas: string[] = [];

        for (const msg of chatMessages) {
            if (msg.rolls && Array.isArray(msg.rolls) && msg.rolls.length > 0) {
                const roll = msg.rolls[0];
                if (Array.isArray(roll.instances)) {
                    for (const instance of roll.instances) {
                        if (instance.persistent) {
                            const rawFormula = instance._formula || instance.formula;
                            if (rawFormula) persistentFormulas.push(rawFormula);
                            continue;
                        }

                        const type = instance.type || 'untyped';
                        const instanceTotal = isCritImmune && typeof instance.critImmuneTotal === 'number'
                            ? instance.critImmuneTotal
                            : instance.total;

                        const subFlavors = this.traverseASTForSubFlavors(instance.terms, 1, isCritImmune, type);
                        let baseAmount = instanceTotal;

                        for (const [subFlavor, amount] of Object.entries(subFlavors)) {
                            const combinedFlavor = `${subFlavor},${type}`;
                            aggregatedDamage[combinedFlavor] = (aggregatedDamage[combinedFlavor] || 0) + amount;
                            baseAmount -= amount;
                        }

                        if (baseAmount > 0) {
                            aggregatedDamage[type] = (aggregatedDamage[type] || 0) + baseAmount;
                        }
                    }
                }
            }
        }

        return { aggregatedDamage, persistentFormulas };
    }

    private static traverseASTForSubFlavors(terms: any[], initialMultiplier: number, isCritImmune: boolean, rootType: string): Record<string, number> {
        const subFlavors: Record<string, number> = {};

        const traverse = (term: any, multiplier: number) => {
            let nextMult = multiplier;
            if (term.operator === '*') {
                const num = term.operands?.find((o: any) => typeof o.number === 'number');
                if (num && !isCritImmune) {
                    nextMult *= num.number;
                }
            }

            const flavorStr = term.flavor || term.options?.flavor;
            if (flavorStr && flavorStr !== rootType && typeof flavorStr === 'string') {
                subFlavors[flavorStr] = (subFlavors[flavorStr] || 0) + (term.total * nextMult);
                return;
            }

            if (term.operands) {
                term.operands.forEach((o: any) => {
                    if (term.operator !== '*' || typeof o.number !== 'number') {
                        traverse(o, nextMult);
                    }
                });
            } else if (term.term) {
                traverse(term.term, nextMult);
            } else if (term.rolls) {
                term.rolls.forEach((r: any) => traverse(r, nextMult));
            }
        };

        if (terms) {
            terms.forEach(t => traverse(t, initialMultiplier));
        }

        return subFlavors;
    }

    private static buildFinalFormula(aggregatedDamage: Record<string, number>, persistentFormulas: string[]): string | null {
        const formulaParts: string[] = [];
        for (const [type, total] of Object.entries(aggregatedDamage)) {
            formulaParts.push(`${total}[${type}]`);
        }

        formulaParts.push(...persistentFormulas);

        if (formulaParts.length === 0) {
            return null;
        }

        const formula = `{${formulaParts.join(", ")}}`;
        return formula;
    }

    private static async evaluateDamageRoll(formula: string): Promise<any[] | null> {
        const DamageRoll = (globalThis as any).CONFIG.Dice.rolls.find((r: any) => r.name === 'DamageRoll');
        if (!DamageRoll) {
            return null;
        }

        const combinedRoll = await new DamageRoll(formula).evaluate();
        return [combinedRoll];
    }

    private static async waitFor3DDice(triggeringMsgId?: string) {
        if ((game as any).dice3d?.waitFor3DAnimationByMessageID && triggeringMsgId) {
            try {
                const timeout = new Promise(resolve => setTimeout(resolve, 6000));
                await Promise.race([
                    (game as any).dice3d.waitFor3DAnimationByMessageID(triggeringMsgId),
                    timeout
                ]);
            } catch (e) {
                logInfo(`DamageCombinator | Error waiting for 3D dice:`, e);
            }
        }
    }

    private static extractPf2eFlags(chatMessages: any[]): any {
        const baseMessage = chatMessages.length > 0 ? chatMessages[0] : null;
        return baseMessage && baseMessage.flags?.pf2e
            ? (globalThis as any).foundry.utils.deepClone(baseMessage.flags.pf2e)
            : {};
    }

    private static mergeHTMLFlavors(chatMessages: any[]): string {
        const baseMessage = chatMessages.length > 0 ? chatMessages[0] : null;
        const mergeDiv = document.createElement('div');
        if (baseMessage && baseMessage.flavor) {
            mergeDiv.innerHTML = baseMessage.flavor;

            const titleElement = mergeDiv.querySelector('h4.action strong');
            if (titleElement) {
                titleElement.textContent = "Combined Damage Roll";
            }

            for (let i = 1; i < chatMessages.length; i++) {
                if (!chatMessages[i].flavor) continue;

                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = chatMessages[i].flavor;

                const baseTagsContainer = mergeDiv.querySelector('div.tags:not(.modifiers)');
                const newTagsContainer = tempDiv.querySelector('div.tags:not(.modifiers)');
                if (baseTagsContainer && newTagsContainer) {
                    const existingTags = new Set(Array.from(baseTagsContainer.querySelectorAll('.tag')).map(t => t.textContent?.trim() || ''));
                    newTagsContainer.querySelectorAll('.tag').forEach(tag => {
                        const text = tag.textContent?.trim() || '';
                        if (!existingTags.has(text)) {
                            existingTags.add(text);
                            baseTagsContainer.appendChild(tag.cloneNode(true));
                        }
                    });
                }

                const baseModsContainer = mergeDiv.querySelector('div.tags.modifiers');
                const newModsContainer = tempDiv.querySelector('div.tags.modifiers');
                if (baseModsContainer && newModsContainer) {
                    const existingMods = new Set(Array.from(baseModsContainer.querySelectorAll('.tag')).map(t => t.textContent?.trim() || ''));
                    newModsContainer.querySelectorAll('.tag').forEach(tag => {
                        const text = tag.textContent?.trim() || '';
                        if (!existingMods.has(text)) {
                            existingMods.add(text);
                            baseModsContainer.appendChild(tag.cloneNode(true));
                        }
                    });
                }

                const baseNotesContainer = mergeDiv.querySelector('ul.notes');
                const newNotesContainer = tempDiv.querySelector('ul.notes');
                if (newNotesContainer) {
                    if (!baseNotesContainer) {
                        mergeDiv.appendChild(newNotesContainer.cloneNode(true));
                    } else {
                        const existingNotes = new Set(Array.from(baseNotesContainer.querySelectorAll('li')).map(li => li.textContent?.trim() || ''));
                        newNotesContainer.querySelectorAll('li').forEach(li => {
                            const text = li.textContent?.trim() || '';
                            if (!existingNotes.has(text)) {
                                existingNotes.add(text);
                                baseNotesContainer.appendChild(li.cloneNode(true));
                            }
                        });
                    }
                }
            }
        }

        return mergeDiv.innerHTML ? mergeDiv.innerHTML + "<hr>" : "";
    }

    private static generateCombinedFlavorText(mergedFlavorHtml: string, targetName: string, isCritImmune: boolean): string {
        let flavorText = mergedFlavorHtml;
        flavorText += `<h4 class="action"><strong>Combined Damage</strong></h4><div class="pf2e">Combined damage against <strong>${targetName}</strong></div>`;
        if (isCritImmune) {
            flavorText += `<div class="pf2e" style="color: red; font-size: 0.9em; margin-top: 2px;"><strong>[For Critical Immune Targets]</strong> Critical multipliers have been removed.</div>`;
            flavorText += `<button type="button" data-action="toggle-crit-immune" style="margin-top: 4px;">Toggle to Critical Damage</button>`;
        } else {
            flavorText += `<div class="pf2e" style="color: orange; font-size: 0.9em; margin-top: 2px;"><strong>[Critical Damage]</strong> Includes critical damage if applicable.</div>`;
            flavorText += `<button type="button" data-action="toggle-crit-immune" style="margin-top: 4px;">Toggle to Crit-Immune Damage</button>`;
        }
        return flavorText;
    }

    private static async createOrUpdateMessage(combatant: CombatantPF2e, parentEntry: ActionLogEntry, state: any, finalRolls: any[], flavorText: string, pf2eFlags: any, isCritImmune: boolean) {
        const actor = (combatant as any).actor;

        if (state.combinedDamageMessageId) {
            const existingMsg = (game as any).messages.get(state.combinedDamageMessageId);
            if (existingMsg) {
                await existingMsg.update({
                    rolls: finalRolls,
                    flavor: flavorText,
                    [`flags.pf2e`]: pf2eFlags,
                    [`flags.${SCOPE}.isCritImmune`]: isCritImmune
                });
                return;
            }
        }

        const newMsg = await (globalThis as any).ChatMessage.create({
            speaker: (globalThis as any).ChatMessage.getSpeaker({ actor }),
            whisper: (globalThis as any).ChatMessage.getWhisperRecipients("GM"),
            flavor: flavorText,
            rolls: finalRolls,
            flags: {
                pf2e: pf2eFlags,
                [SCOPE]: {
                    isCombinedDamage: true,
                    isCritImmune: isCritImmune,
                    originatingActionId: parentEntry.msgId
                }
            }
        });

        if (newMsg) {
            await ActionManager.editAction(combatant, parentEntry.msgId, {
                ComplexActionState: {
                    ...state,
                    combinedDamageMessageId: newMsg.id
                }
            });
        }
    }
}

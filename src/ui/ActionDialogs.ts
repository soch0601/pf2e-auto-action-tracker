import type { CombatantPF2e } from "module-helpers";
import { ActionManager } from "../ActionManager.ts";
import { SummonManager } from "../summons/index.ts";

export class ActionDialogs {
    /**
     * Launched when manual add (+) button is clicked to add an action/reaction manually.
     */
    static async showManualActionDialog(combatant: CombatantPF2e) {
        const isMinion = SummonManager.isMinion(combatant);
        const isActiveTurn = SummonManager.isActiveTurnForCombatant((game as any).combat, combatant);
        const defaultType = (isActiveTurn || isMinion) ? "1" : "reaction";

        // DialogV2.wait returns the value returned by the button callback
        const result = await (foundry.applications.api.DialogV2 as any).wait({
            window: {
                title: "Add Manual Action",
                icon: "fas fa-plus"
            },
            content: `
            <form class="pf2e-action-form">
                <div class="form-group">
                    <label>Action Name</label>
                    <div class="form-fields">
                        <input 
                          type="text" 
                          name="label" 
                          placeholder="e.g. Heroic Inspiration" 
                          maxlength="50" 
                          required 
                          autofocus 
                        />
                    </div>
                </div>
                <div class="form-group">
                    <label>Cost / Type</label>
                    <div class="form-fields">
                        <select name="costType">
                            <option value="0">Free Action</option>
                            <option value="1" ${defaultType === "1" ? 'selected' : ''}>1 Action</option>
                            <option value="2">2 Actions</option>
                            <option value="3">3 Actions</option>
                            ${!isMinion ? `<option value="reaction" ${defaultType === "reaction" ? 'selected' : ''}>Reaction</option>` : ''}
                        </select>
                    </div>
                </div>
            </form>
        `,
            buttons: [{
                action: "ok",
                label: "Add Action",
                class: "pf2e-upgrade-btn",
                default: true,
                callback: (event: Event, button: any) => {
                    const form = button.form as HTMLFormElement;

                    if (!form.checkValidity()) {
                        form.reportValidity();
                        return; // Prevents the promise from resolving with data
                    }

                    // Correct V12 way to extract data
                    const formData = new FormDataExtended(form);
                    return formData.object;
                }
            }],
            modal: true
        }).catch(() => null);

        // Result will be null if the user closed the window or clicked a button without a return
        if (result && result.label) {
            const isReaction = result.costType === "reaction";
            const cost = isReaction ? 1 : parseInt(result.costType);

            await ActionManager.addAction(combatant, {
                cost: cost,
                msgId: `manual-${Date.now()}`,
                label: result.label,
                type: isReaction ? 'reaction' : 'action',
                isQuickenedEligible: false,
                category: 'manual',
                linkedMessages: []
            });
        }
    }
}

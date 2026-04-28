import type { ExtraSlotDefinition } from "./types";

export const AddActionsLibrary: Record<string, ExtraSlotDefinition> = {
    "quickened": {
        name: "Quickened",
        slug: "quickened",
        type: "action",
        grants: 1,
        allowedSlugs: ["strike", "stride", "step", "interact", "sustain-a-spell"]
    },
    "tactical-reflexes": {
        name: "Tactical Reflexes",
        slug: "tactical-reflexes",
        type: "reaction",
        grants: 1,
        allowedSlugs: ["reactive-strike"]
    },
    "combat-reflexes": {
        name: "Combat Reflexes",
        slug: "combat-reflexes",
        type: "reaction",
        grants: 1,
        allowedSlugs: ["reactive-strike"]
    },
    "divine-reflexes": {
        name: "Divine Reflexes",
        slug: "divine-reflexes",
        type: "reaction",
        grants: 1,
        allowedSlugs: ["retributive-strike", "glimpse-of-redemption", "liberating-step", "iron-command", "selfish-shield", "destructive-vengeance"]
    },
    "esoteric-reflexes": {
        name: "Esoteric Reflexes",
        slug: "esoteric-reflexes",
        type: "reaction",
        grants: 1,
        allowedSlugs: ["implements-interruption", "amulets-abeyance", "bells-disruption"]
    }
};

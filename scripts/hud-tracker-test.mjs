import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getCssRule(css, selector) {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `Missing CSS selector: ${selector}`);

    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    assert.notEqual(open, -1, `Missing CSS rule body for: ${selector}`);
    assert.notEqual(close, -1, `Missing CSS rule close for: ${selector}`);

    return css.slice(open + 1, close);
}

class FakeElement {
    constructor({ id = "", classNames = [], dataset = {}, selectors = {} } = {}) {
        this.id = id;
        this.classList = { contains: className => classNames.includes(className) };
        this.dataset = { ...dataset };
        this._selectors = selectors;
    }

    querySelector(selector) {
        return this._selectors[selector] ?? null;
    }
}

const hudAltTarget = new FakeElement();
const hudVisibleTarget = new FakeElement();
const hudRow = new FakeElement({
    dataset: { combatantId: "c1" },
    selectors: {
        ".controls.alt": hudAltTarget,
        ".controls": hudVisibleTarget,
    },
});
const hudRoot = new FakeElement({
    id: "pf2e-hud-tracker",
    selectors: {
        '[data-combatant-id="c1"]': hudRow,
    },
});
const hudRootWithAlternateControls = new FakeElement({
    id: "pf2e-hud-tracker",
    classNames: ["alternate-controls"],
    selectors: {
        '[data-combatant-id="c1"]': hudRow,
    },
});

const coreTarget = new FakeElement();
const coreRow = new FakeElement({
    dataset: { combatantId: "c2" },
    selectors: {
        ".token-name, .name-controls": coreTarget,
    },
});
const coreRoot = new FakeElement({
    selectors: {
        '[data-combatant-id="c2"]': coreRow,
    },
});

const {
    canShowManualActionButton,
    findPf2eHudTracker,
    getTrackerRenderKey,
    hasCompactOverspendTint,
    isPf2eHudTracker,
    PF2E_HUD_TRACKER_ID,
    resolveMapMountTarget,
    resolveTrackerMount,
    shouldShowTrackerForMount,
} = await import("../src/trackerAdapters.ts");
const { getSkillActionMapMetadata } = await import("../src/chatTypeDetectors/skillMapMetadata.ts");
const {
    getMapProfile,
    getCurrentMapState,
    getCurrentMapStateFromLog,
    formatMapLabel,
    getMapDisplayState,
    isMapRelevantAction,
} = await import("../src/mapTracker.ts");

const hudPlayerMount = resolveTrackerMount(hudRoot, "c1", false);
assert.equal(hudPlayerMount?.mode, "pf2e-hud");
assert.equal(hudPlayerMount?.target, hudVisibleTarget);
assert.equal(PF2E_HUD_TRACKER_ID, "pf2e-hud-tracker");
assert.equal(isPf2eHudTracker(hudRoot), true);
assert.equal(isPf2eHudTracker(coreRoot), false);
assert.equal(findPf2eHudTracker({ getElementById: id => id === PF2E_HUD_TRACKER_ID ? hudRoot : null }), hudRoot);

const hudGmMount = resolveTrackerMount(hudRoot, "c1", true);
assert.equal(hudGmMount?.mode, "pf2e-hud");
assert.equal(hudGmMount?.target, hudVisibleTarget);
assert.equal(resolveMapMountTarget(hudRoot, "c1"), null);
assert.equal(resolveMapMountTarget(hudRootWithAlternateControls, "c1"), hudAltTarget);

const coreMount = resolveTrackerMount(coreRoot, "c2");
assert.equal(coreMount?.mode, "core");
assert.equal(coreMount?.target, coreTarget);
assert.equal(resolveMapMountTarget(coreRoot, "c2"), null);

assert.equal(shouldShowTrackerForMount("pf2e-hud", true, false, true), true);
assert.equal(shouldShowTrackerForMount("pf2e-hud", false, true, true), true);
assert.equal(shouldShowTrackerForMount("pf2e-hud", false, false, true), false);
assert.equal(shouldShowTrackerForMount("core", false, false, true), true);

assert.equal(canShowManualActionButton(true, false), true);
assert.equal(canShowManualActionButton(false, true), true);
assert.equal(canShowManualActionButton(false, false), false);

const renderKeyLog = [
    { msgId: "a1", type: "action", cost: 1, label: "Strike", isQuickenedEligible: true, isMapRelevant: true },
    { msgId: "r1", type: "reaction", cost: 1, label: "Reactive Strike", isQuickenedEligible: false },
];
assert.equal(
    getTrackerRenderKey({
        mode: "pf2e-hud",
        combatantId: "c1",
        isGM: true,
        isOwner: false,
        isPC: true,
        actionSlotsKey: "base,quickened",
        mapAttackCount: 1,
        maxReactions: 1,
        log: renderKeyLog,
    }),
    'pf2e-hud|c1|gm:1|owner:0|pc:1|slots:base,quickened|map:1|reactions:1|a1:action:1:Strike:1:1:::|r1:reaction:1:Reactive Strike:0:0:::'
);
assert.notEqual(
    getTrackerRenderKey({
        mode: "pf2e-hud",
        combatantId: "c1",
        isGM: true,
        isOwner: false,
        isPC: true,
        actionSlotsKey: "base,quickened",
        mapAttackCount: 2,
        maxReactions: 1,
        log: renderKeyLog,
    }),
    getTrackerRenderKey({
        mode: "pf2e-hud",
        combatantId: "c1",
        isGM: true,
        isOwner: false,
        isPC: true,
        actionSlotsKey: "base,quickened",
        mapAttackCount: 1,
        maxReactions: 1,
        log: renderKeyLog,
    })
);

assert.equal(hasCompactOverspendTint(0), false);
assert.equal(hasCompactOverspendTint(2), true);

assert.equal(isMapRelevantAction({ isMapRelevant: true }), true);
assert.equal(isMapRelevantAction({ isMapRelevant: false }), false);
assert.equal(isMapRelevantAction({ isMapRelevant: true, actionModifiers: ["deferMAP"] }), false);
assert.equal(isMapRelevantAction({ isMapRelevant: true, type: "reaction" }), false);
assert.equal(isMapRelevantAction({}), false);
assert.equal(getMapProfile({ mapProfile: "agile" }), "agile");
assert.equal(getMapProfile({}), "standard");

assert.deepEqual(getCurrentMapState([]), { attackCount: 0, penalty: 0, profile: "standard" });
assert.deepEqual(
    getCurrentMapState([{ isMapRelevant: true, mapProfile: "standard" }]),
    { attackCount: 1, penalty: 5, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapState([{ isMapRelevant: true, mapProfile: "agile" }]),
    { attackCount: 1, penalty: 4, profile: "agile" }
);
assert.deepEqual(
    getCurrentMapState([{ isMapRelevant: true, actionModifiers: ["deferMAP"] }]),
    { attackCount: 0, penalty: 0, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapState([{ isMapRelevant: true, type: "reaction" }]),
    { attackCount: 0, penalty: 0, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapState([
        { isMapRelevant: true, mapProfile: "agile" },
        { isMapRelevant: true, mapProfile: "agile" }
    ]),
    { attackCount: 2, penalty: 8, profile: "agile" }
);
assert.deepEqual(
    getCurrentMapState([
        { isMapRelevant: false },
        { isMapRelevant: true, mapProfile: "standard" },
        { isMapRelevant: true, mapProfile: "standard" }
    ]),
    { attackCount: 2, penalty: 10, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapStateFromLog([
        {
            ComplexActionState: {
                completedBy: undefined,
                orderedActivityChildActions: [
                    { isMapRelevant: true, actionModifiers: ["deferMAP"] },
                    { isMapRelevant: true, actionModifiers: ["deferMAP"] },
                ],
            },
        },
    ]),
    { attackCount: 0, penalty: 0, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapStateFromLog([
        {
            ComplexActionState: {
                completedBy: "final-strike",
                orderedActivityChildActions: [
                    { isMapRelevant: true, actionModifiers: ["deferMAP"] },
                    { isMapRelevant: true, actionModifiers: ["deferMAP"] },
                ],
            },
        },
    ]),
    { attackCount: 2, penalty: 10, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapStateFromLog([{ isMapRelevant: true }], false),
    { attackCount: 0, penalty: 0, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapStateFromLog([
        { isMapRelevant: true, mapProfile: "standard" },
        {
            ComplexActionState: {
                completedBy: undefined,
                leaves: {
                    "leaf-1": {
                        type: "attack",
                        isClosed: false,
                        modifiers: ["fixedMAP2"]
                    }
                }
            }
        }
    ]),
    { attackCount: 1, penalty: 7, profile: "standard" }
);
assert.deepEqual(
    getCurrentMapStateFromLog([
        { isMapRelevant: true, mapProfile: "agile" },
        {
            ComplexActionState: {
                completedBy: undefined,
                leaves: {
                    "leaf-1": {
                        type: "attack",
                        isClosed: false,
                        modifiers: ["fixedMAP2"]
                    }
                }
            }
        }
    ]),
    { attackCount: 1, penalty: 6, profile: "agile" }
);

assert.equal(formatMapLabel({ attackCount: 0, penalty: 0 }, false), "MAP: 0");
assert.equal(formatMapLabel({ attackCount: 1, penalty: 5 }, false), "MAP: -4 | -5");
assert.equal(formatMapLabel({ attackCount: 1, penalty: 4 }, false), "MAP: -4 | -5");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 8 }, false), "MAP: -8 | -10");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 6 }, false), "MAP: -6 | -7");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 7 }, false), "MAP: -6 | -7");
assert.equal(formatMapLabel({ attackCount: 0, penalty: 0 }, true), "");
assert.equal(formatMapLabel({ attackCount: 1, penalty: 4 }, true), "M1");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 8 }, true), "M2");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 6 }, true), "M1-2");
assert.equal(formatMapLabel({ attackCount: 2, penalty: 7 }, true), "M1-2");
assert.deepEqual(getMapDisplayState({ attackCount: 0, penalty: 0 }), {
    visible: false,
    core: { text: "MAP: 0", inline: true, tooltip: "MAP 0: no multiple attack penalty" },
    compact: { text: "", inline: true, tooltip: "" },
});
assert.deepEqual(getMapDisplayState({ attackCount: 1, penalty: 4 }), {
    visible: true,
    core: { text: "MAP: -4 | -5", inline: true, tooltip: "MAP 1: -4 | -5" },
    compact: { text: "M1", inline: true, tooltip: "MAP 1: -4 | -5" },
});
assert.deepEqual(getMapDisplayState({ attackCount: 2, penalty: 10 }), {
    visible: true,
    core: { text: "MAP: -8 | -10", inline: true, tooltip: "MAP 2: -8 | -10" },
    compact: { text: "M2", inline: true, tooltip: "MAP 2: -8 | -10" },
});
assert.deepEqual(getMapDisplayState({ attackCount: 2, penalty: 6 }), {
    visible: true,
    core: { text: "MAP: -6 | -7", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
    compact: { text: "M1-2", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
});
assert.deepEqual(getMapDisplayState({ attackCount: 2, penalty: 7 }), {
    visible: true,
    core: { text: "MAP: -6 | -7", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
    compact: { text: "M1-2", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
});

const grappleMessage = {
    flavor: '<span class="action-glyph">1</span>',
    content: "",
    item: {
        system: { time: { value: "1" } },
        traits: new Set(["attack"]),
    },
    flags: {
        pf2e: {
            context: {
                type: "skill-check",
                title: "<strong>Grapple</strong> (Athletics Check)",
                options: [
                    "check:statistic:athletics",
                    "action:grapple",
                    "trait:attack",
                ],
            },
        },
    },
};

assert.deepEqual(getSkillActionMapMetadata(grappleMessage), {
    isMapRelevant: true,
    mapProfile: "standard",
});

const tripMessageWithSystemTraits = {
    flavor: '<span class="action-glyph">1</span>',
    content: "",
    item: {
        system: {
            time: { value: "1" },
            traits: { value: ["attack"] },
        },
    },
    flags: {
        pf2e: {
            context: {
                type: "skill-check",
                title: "<strong>Trip</strong> (Athletics Check)",
                options: [
                    "check:statistic:athletics",
                    "action:trip",
                ],
            },
        },
    },
};

assert.deepEqual(getSkillActionMapMetadata(tripMessageWithSystemTraits), {
    isMapRelevant: true,
    mapProfile: "standard",
});

const grappleChatPayload = {
    flags: {
        pf2e: {
            context: {
                type: "skill-check",
                options: [
                    "action:grapple",
                    "attack",
                    "item:trait:attack",
                    "check:statistic:athletics",
                ],
                traits: ["attack"],
            },
            modifiers: [
                {
                    slug: "multiple-attack-penalty",
                    modifier: -4,
                },
            ],
        },
    },
};

assert.deepEqual(getSkillActionMapMetadata(grappleChatPayload), {
    isMapRelevant: true,
    mapProfile: "standard",
});

const systemDrainTooltip = "Used: Slowed 1";
assert.equal(systemDrainTooltip, "Used: Slowed 1");

const css = readFileSync(join(__dirname, "../public/style.css"), "utf8");
const combatUiSource = readFileSync(join(__dirname, "../src/CombatUIManager.ts"), "utf8");
const mainSource = readFileSync(join(__dirname, "../src/main.ts"), "utf8");
const hudCombatantRule = getCssRule(css, "#pf2e-hud-tracker .combatants .combatant");
const hudControlsRule = getCssRule(css, "#pf2e-hud-tracker .combatants .combatant .details .controls");
const hudContainerRule = getCssRule(css, "#pf2e-hud-tracker .details .controls .pf2e-auto-action-tracker-container");
const hudActionLineRule = getCssRule(css, "#pf2e-hud-tracker .pf2e-auto-action-tracker-container.compact .action-line");
const hudDividerRule = getCssRule(css, "#pf2e-hud-tracker .pf2e-auto-action-tracker-container.compact .divider");
assert.match(hudCombatantRule, /height:\s*auto/);
assert.match(hudCombatantRule, /min-height:\s*66px/);
assert.match(hudControlsRule, /padding-bottom:\s*0/);
assert.match(hudControlsRule, /text-align:\s*center/);
assert.match(hudContainerRule, /display:\s*flex/);
assert.match(hudContainerRule, /justify-content:\s*flex-start/);
assert.match(hudContainerRule, /float:\s*none/);
assert.match(hudContainerRule, /clear:\s*both/);
assert.match(hudContainerRule, /width:\s*100%/);
assert.match(hudContainerRule, /max-width:\s*100%/);
assert.match(hudContainerRule, /white-space:\s*nowrap/);
assert.match(hudContainerRule, /margin-top:\s*0/);
assert.match(hudContainerRule, /margin-bottom:\s*4px/);
assert.doesNotMatch(hudContainerRule, /position:\s*relative/);
assert.doesNotMatch(hudContainerRule, /top:\s*-/);
assert.match(hudActionLineRule, /flex-wrap:\s*nowrap/);
assert.match(hudActionLineRule, /white-space:\s*nowrap/);
assert.match(hudDividerRule, /margin:\s*0 3px/);
assert.match(hudDividerRule, /width:\s*3px/);
assert.match(combatUiSource, /const MAX_PIPS = 6/);
assert.match(combatUiSource, /if \(pip\.isGold && i < pipsToRender\.length - 1 && !pipsToRender\[i \+ 1\]\.isGold\)/);
assert.match(combatUiSource, /if \(overflowCount > 0 && !isCompact\)/);
assert.doesNotMatch(combatUiSource, /applyPf2eHudRowHeight/);
assert.doesNotMatch(readFileSync(join(__dirname, "../src/trackerAdapters.ts"), "utf8"), /PF2E_HUD_CENTER/);
assert.doesNotMatch(readFileSync(join(__dirname, "../src/trackerAdapters.ts"), "utf8"), /translateY/);
assert.doesNotMatch(combatUiSource, /requestAnimationFrame/);
assert.match(mainSource, /syncPf2eHudTracker/);
assert.match(mainSource, /MutationObserver/);
assert.doesNotMatch(mainSource, /window\.setTimeout\(\(\) => \{\s*if \(!SettingsManager\.get\("showPf2eHudTracker"\)\) return;/);

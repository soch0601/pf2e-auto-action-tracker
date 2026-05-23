import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 1. Import source files directly
const { ComplexActionEngine } = await import("../src/complexActions/ComplexActionEngine.ts");
const { ComplexActionFormatter } = await import("../src/complexActions/ComplexActionFormatter.ts");
const { SPECIAL_ACTIVITIES } = await import("../src/complexActions/library.ts");
const { getLabelFromMsgFlavor, getSlugFromMsgFlavor } = await import("../src/chatTypeDetectors/detectorUtilities.ts");
const { getCurrentMapStateFromLog, getMapDisplayState, formatMapLabel } = await import("../src/mapTracker.ts");

// 2. Mock global game object for Foundry internationalization lookup
globalThis.game = {
    i18n: {
        has(key) {
            const knownKeys = [
                "PF2E_ACTION_TRACKER.Actions.strike",
                "PF2E_ACTION_TRACKER.Actions.step",
                "PF2E_ACTION_TRACKER.Actions.stride",
                "PF2E_ACTION_TRACKER.Actions.interact",
                "PF2E_ACTION_TRACKER.Actions.interact:reload",
                "PF2E_ACTION_TRACKER.Actions.interact:change-grip-2h"
            ];
            return knownKeys.includes(key);
        },
        localize(key) {
            if (key === "PF2E_ACTION_TRACKER.Actions.strike") return "Strike";
            if (key === "PF2E_ACTION_TRACKER.Actions.step") return "Step";
            if (key === "PF2E_ACTION_TRACKER.Actions.stride") return "Stride";
            if (key === "PF2E_ACTION_TRACKER.Actions.interact") return "Interact";
            if (key === "PF2E_ACTION_TRACKER.Actions.interact:reload") return "Interact: Reload";
            if (key === "PF2E_ACTION_TRACKER.Actions.interact:change-grip-2h") return "Interact: Change Grip (2H)";
            return key;
        }
    }
};

// 3. Mock a lightweight DOM environment for parsing unit tests
class MockElement {
    innerHTML = "";
    tagName;
    constructor(tagName) {
        this.tagName = tagName;
    }

    querySelector(selector) {
        if (selector.includes('h4.action') || selector === 'h4.action, .card-header h3, h3') {
            if (this.innerHTML.includes('h4 class="action"') || this.innerHTML.includes('<h4 class=\\"action\\">')) {
                const el = new MockElement('h4');
                el.innerHTML = this.innerHTML;
                return el;
            }
        }
        if (selector === '.subtitle') {
            const startIdx = this.innerHTML.indexOf('class="subtitle');
            if (startIdx !== -1) {
                const subStr = this.innerHTML.substring(startIdx);
                const endSpanIdx = subStr.lastIndexOf('</span>');
                if (endSpanIdx !== -1) {
                    const content = subStr.substring(subStr.indexOf('>') + 1, endSpanIdx);
                    const el = new MockElement('span');
                    el.innerHTML = content;
                    return el;
                }
            }
        }
        if (selector === 'strong') {
            const match = this.innerHTML.match(/<strong>([\s\S]*?)<\/strong>/);
            if (match) {
                const el = new MockElement('strong');
                el.innerHTML = match[1];
                return el;
            }
        }
        if (selector === '.action-glyph, .pf2-icon') {
            if (this.innerHTML.includes('action-glyph') || this.innerHTML.includes('pf2-icon')) {
                return new MockElement('span');
            }
        }
        return null;
    }

    cloneNode() {
        const el = new MockElement(this.tagName);
        el.innerHTML = this.innerHTML;
        return el;
    }

    get textContent() {
        return this.innerHTML
            .replace(/<[^>]*>/g, '')
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .trim();
    }

    remove() {
        this.innerHTML = "";
    }
}

globalThis.document = {
    createElement(tagName) {
        return new MockElement(tagName);
    }
};

// --- SUBTITLE PARSING TESTS ---
const reloadHtml = `<h4 class="action">\n    <strong>Interact</strong>\n    <span class="action-glyph">1</span>\n        <span class="subtitle degree-of-success">\n            (<span>Reload</span>)\n        </span>\n</h4>`;
const changeGripHtml = `<h4 class="action">\n    <strong>Interact</strong>\n    <span class="action-glyph">1</span>\n        <span class="subtitle degree-of-success">\n            (<span>Change Grip (2H)</span>)\n        </span>\n</h4>`;
const genericInteractHtml = `<h4 class="action">\n    <strong>Interact</strong>\n    <span class="action-glyph">1</span>\n</h4>`;

assert.equal(getLabelFromMsgFlavor(reloadHtml), "Interact: Reload");
assert.equal(getSlugFromMsgFlavor(reloadHtml), "interact:reload");
assert.equal(getLabelFromMsgFlavor(changeGripHtml), "Interact: Change Grip (2H)");
assert.equal(getSlugFromMsgFlavor(changeGripHtml), "interact:change-grip-2h");
assert.equal(getLabelFromMsgFlavor(genericInteractHtml), "Interact");
assert.equal(getSlugFromMsgFlavor(genericInteractHtml), "interact");


// --- TEST 1: Touch and Go (Start State) ---
const touchAndGoState = ComplexActionEngine.maybeStart("touch-and-go", "msg-123", null);
assert.ok(touchAndGoState, "Failed to start touch-and-go");

const startString = ComplexActionFormatter.toString(touchAndGoState);
const expectedStart = "Touch and Go - Waiting for:\n• (Optional) Step\n&nbsp;&nbsp;&nbsp;&nbsp;<small><i>and</i></small>\n• (Optional) (Optional) Interact: Change Grip (2H), (Optional) Interact:change Grip 1h, or (Optional) Interact\n&nbsp;&nbsp;&nbsp;&nbsp;<small><i>then</i></small>\n• Interact: Reload";
assert.equal(startString, expectedStart);


// --- TEST 2: Touch and Go (After Step) ---
const updatedState1 = JSON.parse(JSON.stringify(touchAndGoState));
const stepLeaf = updatedState1.leaves["0"];
stepLeaf.childActions.push({ msgId: "msg-step", label: "Step", cost: 1 });
stepLeaf.satisfied = true;
stepLeaf.isClosed = true;
updatedState1.orderedActivityChildActions.push({ msgId: "msg-step", label: "Step", cost: 1 });

const stepString = ComplexActionFormatter.toString(updatedState1);
const expectedStep = "Touch and Go - Waiting for:\n• (Optional) (Optional) Interact: Change Grip (2H), (Optional) Interact:change Grip 1h, or (Optional) Interact\n&nbsp;&nbsp;&nbsp;&nbsp;<small><i>then</i></small>\n• Interact: Reload";
assert.equal(stepString, expectedStep);


// --- TEST 3: Touch and Go (After Step and Optional Change Grip (2H)) ---
const updatedState2 = JSON.parse(JSON.stringify(updatedState1));
const changeGripLeaf = updatedState2.leaves["2-0"];
const changeGrip1hLeaf = updatedState2.leaves["2-2"];
const genericInteractLeaf = updatedState2.leaves["2-4"];

changeGripLeaf.childActions.push({ msgId: "msg-grip", label: "Interact: Change Grip (2H)", cost: 1 });
changeGripLeaf.satisfied = true;
changeGripLeaf.isClosed = true;
changeGrip1hLeaf.isClosed = true;
genericInteractLeaf.isClosed = true;

updatedState2.orderedActivityChildActions.push({ msgId: "msg-grip", label: "Interact: Change Grip (2H)", cost: 1 });

const optInteractString = ComplexActionFormatter.toString(updatedState2);
const expectedOptInteract = "Touch and Go - Waiting for:\n• Interact: Reload";
assert.equal(optInteractString, expectedOptInteract);


// --- TEST 4: Whirlwind Maul (Start State) ---
const whirlwindState = ComplexActionEngine.maybeStart("whirlwind-maul", "msg-456", null);
assert.ok(whirlwindState);
const whirlwindStartString = ComplexActionFormatter.toString(whirlwindState);
assert.equal(whirlwindStartString, "Whirlwind Maul - Waiting for:\n• Strike");


// --- TEST 5: Whirlwind Maul (After 1 Strike) ---
const updatedWhirlwind1 = JSON.parse(JSON.stringify(whirlwindState));
const strikeLeaf = updatedWhirlwind1.leaves["0"];
strikeLeaf.childActions.push({ msgId: "msg-strike-1", label: "Strike", cost: 1 });
strikeLeaf.satisfied = true;
updatedWhirlwind1.orderedActivityChildActions.push({ msgId: "msg-strike-1", label: "Strike", cost: 1 });

const whirlwind1String = ComplexActionFormatter.toString(updatedWhirlwind1);
assert.equal(whirlwind1String, "Whirlwind Maul - Waiting for:\n• (Optional) Strike (up to 3 more)");


// --- TEST 6: Whirlwind Maul (After 4 Strikes) ---
const updatedWhirlwind4 = JSON.parse(JSON.stringify(updatedWhirlwind1));
const strikeLeaf4 = updatedWhirlwind4.leaves["0"];
strikeLeaf4.childActions.push({ msgId: "msg-strike-2", label: "Strike", cost: 1 });
strikeLeaf4.childActions.push({ msgId: "msg-strike-3", label: "Strike", cost: 1 });
strikeLeaf4.childActions.push({ msgId: "msg-strike-4", label: "Strike", cost: 1 });
strikeLeaf4.isClosed = true;
updatedWhirlwind4.orderedActivityChildActions.push({ msgId: "msg-strike-2", label: "Strike", cost: 1 });
updatedWhirlwind4.orderedActivityChildActions.push({ msgId: "msg-strike-3", label: "Strike", cost: 1 });
updatedWhirlwind4.orderedActivityChildActions.push({ msgId: "msg-strike-4", label: "Strike", cost: 1 });
updatedWhirlwind4.completedBy = "msg-strike-4";

const whirlwind4String = ComplexActionFormatter.toString(updatedWhirlwind4);
assert.equal(whirlwind4String, "Whirlwind Maul - Complete");


// --- TEST 7: Touch and Go Real Evaluation (Step -> Grip Change -> Reload) ---
const combatantMock = { name: "Warren", actor: {} };
let evalState = ComplexActionEngine.maybeStart("touch-and-go", "msg-123", null);
assert.ok(evalState);

const stepAction = { msgId: "msg-step", label: "Step", cost: 1, category: "move" };
let res = ComplexActionEngine.evaluate(evalState, { slug: "stride", action: stepAction, cost: 1, type: "move" }, combatantMock);
assert.equal(res.claimed, true);
evalState = res.newState;

const gripAction = { msgId: "msg-grip", label: "Interact: Change Grip (2H)", cost: 1, category: "action" };
res = ComplexActionEngine.evaluate(evalState, { slug: "interact:change-grip-2h", action: gripAction, cost: 1, type: "action" }, combatantMock);
assert.equal(res.claimed, true);
evalState = res.newState;

const reloadAction = { msgId: "msg-reload", label: "Interact: Reload", cost: 1, category: "action" };
res = ComplexActionEngine.evaluate(evalState, { slug: "interact:reload", action: reloadAction, cost: 1, type: "action" }, combatantMock);
assert.equal(res.claimed, true);
assert.equal(ComplexActionEngine.isComplete(res.newState), true);


// --- TEST 8: Touch and Go Real Evaluation Skipping Grip Change (Step -> Reload) ---
let evalStateSkip = ComplexActionEngine.maybeStart("touch-and-go", "msg-123", null);
assert.ok(evalStateSkip);

res = ComplexActionEngine.evaluate(evalStateSkip, { slug: "stride", action: stepAction, cost: 1, type: "move" }, combatantMock);
assert.equal(res.claimed, true);
evalStateSkip = res.newState;

res = ComplexActionEngine.evaluate(evalStateSkip, { slug: "interact:reload", action: reloadAction, cost: 1, type: "action" }, combatantMock);
assert.equal(res.claimed, true);
assert.equal(ComplexActionEngine.isComplete(res.newState), true);


// --- TEST 9: Barreling Charge Double Grouping ---
const barrelingState = ComplexActionEngine.maybeStart("barreling-charge", "msg-789", null);
assert.ok(barrelingState);
const barrelingStartString = ComplexActionFormatter.toString(barrelingState);
assert.equal(barrelingStartString, "Barreling Charge - Waiting for:\n• Stride, Burrow, Swim, Fly, or Climb; and (Optional) Shove (Repeatable)\n&nbsp;&nbsp;&nbsp;&nbsp;<small><i>then</i></small>\n• (Optional) Strike");


// --- TEST 10: Into the Fray Unnamed Group ---
const intoTheFrayState = ComplexActionEngine.maybeStart("into-the-fray", "msg-101", null);
assert.ok(intoTheFrayState);
const intoTheFrayStartString = ComplexActionFormatter.toString(intoTheFrayState);
assert.equal(intoTheFrayStartString, "Into the Fray - Waiting for:\n• Leap, Stride, or Swim\n&nbsp;&nbsp;&nbsp;&nbsp;<small><i>and</i></small>\n• Strike");


// --- TEST 11: currentAttackUsesFixedMAP2 and getCurrentMapState ---
const doubleShotState = ComplexActionEngine.maybeStart("double-shot", "msg-ds-parent", null);
assert.ok(doubleShotState);

const logWithActiveDoubleShot = [
    {
        msgId: "msg-ds-parent",
        label: "Double Shot",
        ComplexActionState: doubleShotState,
        isMapRelevant: false
    }
];

const stateActive = getCurrentMapStateFromLog(logWithActiveDoubleShot, true);
assert.equal(stateActive.penalty, 2);

const displayState = getMapDisplayState(stateActive);
const labelFull = formatMapLabel(stateActive, false);
const labelCompact = formatMapLabel(stateActive, true);

assert.equal(displayState.core.text, "MAP: -2");
assert.equal(displayState.compact.text, "M-2");
assert.equal(labelFull, "MAP: -2");
assert.equal(labelCompact, "M-2");

const completedDoubleShotState = JSON.parse(JSON.stringify(doubleShotState));
completedDoubleShotState.completedBy = "msg-strike-2";
completedDoubleShotState.leaves["0"].isClosed = true;

const logWithCompletedDoubleShot = [
    {
        msgId: "msg-ds-parent",
        label: "Double Shot",
        ComplexActionState: completedDoubleShotState,
        isMapRelevant: false
    }
];

const stateCompleted = getCurrentMapStateFromLog(logWithCompletedDoubleShot, true);
assert.equal(stateCompleted.penalty, 0);


// --- TEST 12: Sneak Move Action Conversion ---
// Under Infiltrator's Reload, we have: reload THEN (hide XOR sneak XOR take-cover)
const infiltratorState = ComplexActionEngine.maybeStart("infiltrator's-reload", "msg-inf-parent", null);
assert.ok(infiltratorState);

// 1. Claim reload
let infRes = ComplexActionEngine.evaluate(infiltratorState, { slug: "interact:reload", action: { msgId: "msg-inf-reload", label: "Interact: Reload" }, cost: 1, type: "action" }, combatantMock);
assert.equal(infRes.claimed, true);
let infState = infRes.newState;

// 2. Claim move action for the "sneak" leaf
// A drag-and-drop movement generates a 'move' type with slug 'stride'
const moveSneakAction = { msgId: "msg-inf-sneak", label: "Stride", cost: 1, category: "move" };
infRes = ComplexActionEngine.evaluate(infState, { slug: "stride", action: moveSneakAction, cost: 1, type: "move" }, combatantMock);
assert.equal(infRes.claimed, true, "Move action should be successfully converted and claimed for sneak leaf");
infState = infRes.newState;

// Verify sneak leaf was satisfied
const sneakLeaf = Object.values(infState.leaves).find(l => l.subtype === "sneak");
assert.equal(sneakLeaf.satisfied, true, "Sneak leaf should be marked satisfied");
assert.equal(sneakLeaf.childActions[0].slug, "sneak", "Child action slug should be converted to sneak");
assert.equal(sneakLeaf.childActions[0].category, "skill", "Child action category should be converted to skill");
assert.equal(ComplexActionEngine.isComplete(infState), true, "Infiltrator's Reload should be complete");

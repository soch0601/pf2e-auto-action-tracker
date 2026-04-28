import { SPECIAL_ACTIVITIES } from "./library";
import type { ActiveActivityState, LeafState, OperatorNode, ActionNode, GroupNode } from "./types";
import type { ActionLogEntry } from "../ActionManager";
import { MovementManager } from "../MovementManager";
import type { CombatantPF2e } from "module-helpers";

export class ComplexActionEngine {

    static maybeStart(slug: string, parentMessageId: string, tokenDoc: any): ActiveActivityState | null {
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === slug);
        if (!definition) return null;

        const leaves: Record<string, LeafState> = {};

        const walk = (nodes: (ActionNode | GroupNode | OperatorNode)[], path: number[] = []) => {
            nodes.forEach((node, index) => {
                const currentPath = [...path, index];
                if (node.type === 'ACTION') {
                    const id = this._generateId(...currentPath);
                    leaves[id] = {
                        id,
                        type: node.properties.type,
                        subtype: node.properties.subtype,
                        minCost: node.properties.minCost,
                        maxCost: node.properties.maxCost,
                        minOccurrences: node.properties.minOccurrences || 1,
                        maxOccurrences: node.properties.maxOccurrences || 1,
                        overrideParentCost: node.properties.overrideParentCost,
                        modifiers: node.properties.modifiers ?? [],
                        satisfied: false,
                        isClosed: false,
                        childActions: []
                    };
                } else if (node.type === 'GROUP') {
                    walk(node.value, currentPath);
                }
            });
        };

        walk(definition.childActions);

        return {
            activitySlug: slug,
            parentMessageId,
            completedBy: undefined,
            leaves,
            orderedActivityChildActions: [],
            historyAnchorIndex: ((tokenDoc as any)?._movementHistory?.length) ?? (tokenDoc?.id ? MovementManager.getCapturedHistory(tokenDoc.id)?.length : 0) ?? 0
        };
    }

    static evaluate(state: ActiveActivityState, incoming: { type: string, cost?: number, action: ActionLogEntry, slug: string }, combatant: CombatantPF2e) {
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === state.activitySlug);
        if (!definition) return { newState: state, claimed: false };

        // Work on a copy to maintain immutability until we confirm a claim
        const newState = JSON.parse(JSON.stringify(state)) as ActiveActivityState;

        // We pass the entire childActions array as a virtual "root group" to _tryClaim
        const claimed = this._tryClaimGroup(definition.childActions, newState, incoming, [], combatant);

        if (claimed) {
            if (this._isRangeClosed(definition.childActions, newState)) {
                newState.completedBy = incoming.action.msgId;
            }
            else {
                newState.completedBy = undefined;
            }
            newState.orderedActivityChildActions.push(incoming.action);
            return { newState, claimed: true };
        }

        return { newState: state, claimed: false };
    }

    /**
      * Updates a specific action of a leaf object
      */
    static edit(state: ActiveActivityState, msgId: string, updates: Partial<ActionLogEntry>, combatant?: CombatantPF2e): ActiveActivityState {
        const newState: ActiveActivityState = JSON.parse(JSON.stringify(state));
        const leaf = this.findLeafByMessageId(newState, msgId);
        if (!leaf) return newState;

        const actionIndex = leaf.childActions.findIndex(l => l.msgId === msgId);
        if (actionIndex === -1) return newState;

        const canInterrupt = leaf.type === 'move';
        // Edit an interruptable movement
        if (canInterrupt && combatant) {
            const moveData = this._getUpdatedMoveData(newState, leaf, combatant);
            if (moveData) {
                leaf.childActions[actionIndex].label = moveData.isOverflow ? `${moveData.label} (EXCEEDED)` : moveData.label;
                leaf.childActions[actionIndex].cost = 0; // Maintain the "swallow"
                (leaf.childActions[actionIndex] as any).coords = moveData.activityPath;

                // Critical: Update satisfied and isClosed based on overflow
                leaf.satisfied = !moveData.isOverflow && moveData.cost >= (leaf.minCost || 1);
                if (moveData.isOverflow) {
                    leaf.isClosed = true;
                }
            }
        } else {
            // Standard edit for strikes/rolls
            leaf.childActions[actionIndex] = { ...leaf.childActions[actionIndex], ...updates };
            const newCost = leaf.childActions[actionIndex].cost;
            leaf.satisfied = newCost >= (leaf.minCost ?? 0) && newCost <= (leaf.maxCost ?? 1000);
        }

        // Sync the ordered list
        const orderedIndex = newState.orderedActivityChildActions.findIndex(a => a.msgId === msgId);
        if (orderedIndex !== -1) {
            newState.orderedActivityChildActions[orderedIndex] = { ...leaf.childActions[actionIndex] };
        }

        return newState;
    }

    /**
     * Removes a message from whichever leaf it was claimed by.
     */
    static remove(state: ActiveActivityState, msgId: string): ActiveActivityState {
        let newState: ActiveActivityState = JSON.parse(JSON.stringify(state));

        let currentAction = newState.orderedActivityChildActions[newState.orderedActivityChildActions.length - 1];
        while (currentAction && currentAction.msgId !== msgId) {
            newState = this._removeSingleItem(newState, currentAction.msgId);
            currentAction = newState.orderedActivityChildActions[newState.orderedActivityChildActions.length - 1];
        }

        if (currentAction) newState = this._removeSingleItem(newState, currentAction.msgId);

        return newState;
    }

    static getAllChildMessageIds(state: ActiveActivityState): string[] {
        return state.orderedActivityChildActions.flatMap(a => a.msgId);
    }

    static getAllChildActions(state: ActiveActivityState): ActionLogEntry[] {
        return state.orderedActivityChildActions;
    }

    static getLeafLabel(state: ActiveActivityState, msgId: string) {
        const leaf = this.findLeafByMessageId(state, msgId);

        if (!leaf) return undefined;
        return leaf.subtype ? (leaf.type + ': ' + leaf.subtype) : leaf.type;
    }

    static findLeafByMessageId(state: ActiveActivityState, msgId: string) {
        return Object.values(state.leaves).find(l => l.childActions.find(a => a.msgId === msgId))
    }

    /**
     * Searches all satisfied leaves in the activity state. 
     * Returns the first 'overrideParentCost' found, otherwise undefined.
     */
    static getOverrideCost(state: ActiveActivityState): number | undefined {
        // We only care about satisfied leaves
        const satisfiedLeaves = Object.values(state.leaves).filter(leaf => leaf.satisfied);

        for (const leaf of satisfiedLeaves) {
            if (typeof leaf.overrideParentCost === 'number') {
                return leaf.overrideParentCost;
            }
        }

        return undefined;
    }

    static canComplete(state: ActiveActivityState | undefined): boolean {
        if (!state) return false;
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === state.activitySlug);
        if (!definition) return false;

        const checkNodes = (nodes: any[], path: number[] = []): boolean => {
            // Use your existing logic to see if this specific horizontal range 
            // (the current group or top-level) is satisfied.
            if (!this._isRangeSatisfied(nodes, state, path)) {
                return false;
            }

            // Even if the range is satisfied, we must check nested GROUPS 
            // to ensure their internal requirements are fully met.
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const currentPath = [...path, i];

                if (node.type === 'GROUP') {
                    if (!checkNodes(node.value, currentPath)) {
                        return false;
                    }
                }
            }

            return true;
        };

        return checkNodes(definition.childActions);
    }

    static isComplete(state: ActiveActivityState | undefined): boolean {
        if (!state) return false;
        return !!state.completedBy;
    }

    static complete(state: ActiveActivityState, msgId: string): ActiveActivityState {
        state.completedBy = msgId;
        return state;
    }

    /**
     * Checks if the activity has an open move action that allows interruption
     */
    static getInterruptibleMoveId(state: ActiveActivityState): string | undefined {
        const leaf = Object.values(state.leaves).find(l =>
            l.type === 'move' &&
            !l.isClosed &&
            l.modifiers.includes('allowInterruption')
        );
        // Return the msgId of the last segment added to this leaf
        return leaf?.childActions[leaf.childActions.length - 1]?.msgId;
    }

    static getName(state: ActiveActivityState): string {
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === state.activitySlug);
        if (!definition) return "Unknown Activity";
        else return definition.name;
    }

    static toString(state: ActiveActivityState): string {
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === state.activitySlug);
        if (!definition) return "Unknown Activity";

        const parts: string[] = [definition.name];

        // Find the first unsatisfied mandatory leaf to show what we are waiting for
        const getGoals = (nodes: any[], path: number[] = []): string[] => {
            let goals: string[] = [];
            let operator = 'THEN'; // Default behavior

            // Check if this level has an operator
            const opNode = nodes.find(n => n.type === 'OPERATOR');
            if (opNode) operator = opNode.value;

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (node.type === 'OPERATOR') continue;

                const currentPath = [...path, i];
                if (node.type === 'ACTION') {
                    const id = this._generateId(...currentPath);
                    const leaf = state.leaves[id];

                    if (!leaf.satisfied) {
                        const label = (leaf.subtype ? `${leaf.subtype}` : leaf.type);
                        goals.push(label);

                        // IF it's a THEN (Sequence), we stop at the first roadblock
                        if (operator === 'THEN') return goals;
                    }
                } else if (node.type === 'GROUP') {
                    // Check if the group as a whole is already satisfied based on its internal logic
                    const isGroupDone = this._nodeIsSatisfied(node, state, currentPath);

                    if (isGroupDone) {
                        // If the XOR or AND group is satisfied, skip it entirely
                        continue;
                    }

                    // Otherwise, dive in to find what we are still missing
                    const subGoals = getGoals(node.value, currentPath);
                    if (subGoals.length > 0) {
                        goals.push(...subGoals);
                        if (operator === 'THEN') return goals;
                    }
                }
            }
            return goals;
        };

        if (state.completedBy) return `${definition.name} - Complete`;

        const allGoals = getGoals(definition.childActions);

        if (allGoals.length > 0) {
            const limit = 3;
            const displayedGoals = allGoals.slice(0, limit);
            const overflowCount = allGoals.length - limit;

            let goalText = displayedGoals.join(" or ");
            if (overflowCount > 0) {
                goalText += ` or ${overflowCount} other option${overflowCount > 1 ? 's' : ''}`;
            }

            return `${definition.name} - Waiting for: ${goalText}`;
        }

        if (this.canComplete(state)) {
            return `${definition.name} - Ready to Finish (or continue)`;
        }

        return definition.name;
    }

    private static _removeSingleItem(state: ActiveActivityState, msgId: string): ActiveActivityState {
        const newState: ActiveActivityState = JSON.parse(JSON.stringify(state));
        const leaf = this.findLeafByMessageId(newState, msgId);
        const actionIndex = leaf?.childActions.findIndex(l => l.msgId === msgId)

        if (leaf && actionIndex !== undefined && actionIndex !== -1) {
            leaf.childActions = leaf.childActions.filter(a => a.msgId !== msgId);
            leaf.satisfied = leaf.childActions.length >= leaf.minOccurrences;

            if (leaf.childActions.length < (leaf.maxOccurrences ?? 1)) {
                leaf.isClosed = false;
            }

            const definition = SPECIAL_ACTIVITIES.find(a => a.slug === newState.activitySlug);
            if (definition) {
                if (this._isRangeClosed(definition.childActions, newState)) {
                    newState.completedBy = msgId;
                }
                else {
                    newState.completedBy = undefined;
                }
            }

            newState.orderedActivityChildActions = state.orderedActivityChildActions.filter(a => a.msgId !== msgId)
        }
        return newState;
    }

    /**
      * Deterministically generates an ID based on tree position.
      * e.g., "0-0-1" for first child of first group's second child.
      */
    private static _generateId(...indices: number[]): string {
        return indices.join('-');
    }

    private static _tryClaimGroup(
        nodes: (ActionNode | GroupNode | OperatorNode)[],
        state: ActiveActivityState,
        incoming: { type: string, cost?: number, action: ActionLogEntry, slug: string },
        path: number[],
        combatant: CombatantPF2e
    ): boolean {
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            // SEQUENCE CHECK: If we hit a THEN, everything before it MUST be satisfied
            if (node.type === 'OPERATOR' && node.value === 'THEN') {
                const predecessors = nodes.slice(0, i);
                if (!this._isRangeSatisfied(predecessors, state, path)) {
                    // Predecessors not done; we cannot look at anything past this point
                    return false;
                }
                continue;
            }

            // Attempt to claim the current node (Action or Group)
            if (this._tryClaim(node, state, incoming, [...path, i], combatant)) {
                this._closePredecessors(nodes, state, path, i);
                return true;
            }
        }
        return false;
    }

    /**
     * Recursive claim logic for Groups/Actions
     */
    private static _tryClaim(
        node: ActionNode | GroupNode | OperatorNode,
        state: ActiveActivityState,
        incoming: { type: string, cost?: number, action: ActionLogEntry, slug: string },
        path: number[],
        combatant: CombatantPF2e
    ): boolean {
        if (node.type === 'OPERATOR') return false;

        if (node.type === 'ACTION') {
            const id = this._generateId(...path);
            const leaf = state.leaves[id];
            if (!leaf || leaf.isClosed) return false;

            const canInterrupt = node.properties?.modifiers?.includes('allowInterruption') ?? false;
            const movementMode = leaf.subtype || 'stride';

            // --- STANDARD CLAIM LOGIC ---
            if (leaf.subtype && leaf.subtype === 'stride' && incoming.slug === 'step') {
                incoming.slug = 'stride';
            }

            // We check this FIRST to allow merging segments into a single action expenditure
            if (leaf && !leaf.isClosed && incoming.type === 'move' && canInterrupt) {
                const movementMode = leaf.subtype || 'stride';
                if (incoming.slug !== movementMode) return false;

                const actor = (combatant as unknown as Combatant).actor;
                const c = combatant as any;
                const tokenDoc = c.token || (c.tokenId ? game.scenes.active?.tokens.get(c.tokenId) : null);
                const tokenId = tokenDoc?.id;

                let fullHistory = (tokenDoc as any)?._movementHistory || [];
                if (fullHistory.length === 0 && typeof tokenId === 'string') {
                    fullHistory = MovementManager.getCapturedHistory(tokenId) || [];
                }

                // Slice history from the anchor to the current moment
                const activityPath = fullHistory.slice(state.historyAnchorIndex);

                if (activityPath.length > 0) {
                    // Ask MovementManager to measure this specific slice
                    const { cost, label } = MovementManager.measurePath(actor, tokenDoc?.object, activityPath, movementMode);

                    const maxAllowed = leaf.maxCost ?? 1;

                    if (cost <= maxAllowed) {
                        // STANDARD CLAIM: Within budget
                        if (cost >= (leaf.minCost || 1)) {
                            leaf.satisfied = true;
                        }
                        incoming.cost = 0;
                        incoming.action.label = label;
                        (incoming.action as any).coords = activityPath;

                        leaf.childActions.push(incoming.action);
                        return true;
                    } else {
                        // OVERFLOW CLAIM: We "swallow" the action but penalize the state
                        if (cost > (leaf.maxCost || 1)) {
                            leaf.satisfied = false;
                        }

                        // Return true because the ENGINE has successfully claimed this segment 
                        // and updated the state to reflect the error.
                        return false;
                    }
                }
            }

            const typeMatch = leaf.type === incoming.type;
            const subtypeMatch = !leaf.subtype || leaf.subtype === incoming.slug;

            if (typeMatch && subtypeMatch) {
                const incomingCost = incoming.cost || 1;

                if (this._actionMeetsCostReqs(leaf, incomingCost) && this._actionMeetsOccurrencesReqs(leaf)) {
                    incoming.action.actionModifiers = leaf.modifiers;
                    leaf.childActions.push(incoming.action);

                    const minOcc = leaf.minOccurrences ?? 1;
                    const maxOcc = leaf.maxOccurrences ?? 1;
                    leaf.satisfied = leaf.childActions.length >= minOcc;

                    // Auto-close if we hit the limit and cannot be interrupted further
                    if ((leaf.childActions.length === maxOcc && !canInterrupt) || (leaf.childActions.length > maxOcc)) {
                        leaf.isClosed = true;
                    }

                    return true;
                }
            }
        }

        if (node.type === 'GROUP') {
            return this._tryClaimGroup(node.value, state, incoming, path, combatant);
        }

        return false;
    }

    private static _isRangeSatisfied(nodes: (ActionNode | OperatorNode | GroupNode)[], state: ActiveActivityState, parentPath: number[] = []): boolean {
        return nodes.every((n, index) => {
            if (n.type === 'OPERATOR') return true;
            return this._nodeIsSatisfied(n, state, [...parentPath, index]);
        });
    }

    private static _nodeIsSatisfied(node: ActionNode | GroupNode, state: ActiveActivityState, path: number[]): boolean {
        if (node.type === 'ACTION') {
            const id = this._generateId(...path);
            return state.leaves[id]?.satisfied || false;
        }

        if (node.type === 'GROUP') {
            const operatorNode = node.value.find((v): v is OperatorNode => v.type === 'OPERATOR');
            const childrenWithIndices = node.value
                .map((v, i) => ({ node: v, index: i }))
                .filter((v): v is { node: ActionNode | GroupNode, index: number } => v.node.type !== 'OPERATOR');

            const results = childrenWithIndices.map(child =>
                this._nodeIsSatisfied(child.node, state, [...path, child.index])
            );

            switch (operatorNode?.value) {
                case 'OR': return results.some(r => r);
                case 'XOR': return results.filter(r => r).length === 1;
                case 'AND':
                default: return results.every(r => r);
            }
        }
        return true;
    }

    private static _isRangeClosed(nodes: (ActionNode | OperatorNode | GroupNode)[], state: ActiveActivityState, parentPath: number[] = []): boolean {
        return nodes.every((n, index) => {
            if (n.type === 'OPERATOR') return true;
            return this._nodeIsClosed(n, state, [...parentPath, index]);
        });
    }

    private static _nodeIsClosed(node: ActionNode | GroupNode, state: ActiveActivityState, path: number[]): boolean {
        if (node.type === 'ACTION') {
            const id = this._generateId(...path);
            const leaf = state.leaves[id];
            // It's closed if the leaf says it is, OR if it's satisfied and there is no manual finish
            return leaf?.isClosed || false;
        }

        if (node.type === 'GROUP') {
            const operatorNode = node.value.find((v): v is OperatorNode => v.type === 'OPERATOR');
            const childrenWithIndices = node.value
                .map((v, i) => ({ node: v, index: i }))
                .filter((v): v is { node: ActionNode | GroupNode, index: number } => v.node.type !== 'OPERATOR');

            const results = childrenWithIndices.map(child =>
                this._nodeIsClosed(child.node, state, [...path, child.index])
            );

            console.log('in _nodeIsClosed - results: ', results)

            switch (operatorNode?.value) {
                case 'OR': return results.some(r => r);
                case 'XOR': return results.filter(r => r).length === 1;
                case 'AND':
                default: return results.every(r => r);
            }
        }
        return true;
    }

    private static _closePredecessors(
        nodes: (ActionNode | GroupNode | OperatorNode)[],
        state: ActiveActivityState,
        parentPath: number[],
        currentIndex: number
    ) {
        for (let j = 0; j < currentIndex; j++) {
            const prevNode = nodes[j];
            if (prevNode.type === 'OPERATOR') continue;

            const prevPath = [...parentPath, j];
            this._recursiveClose(prevNode, state, prevPath);
        }
    }

    private static _recursiveClose(node: ActionNode | GroupNode, state: ActiveActivityState, path: number[]) {
        if (node.type === 'ACTION') {
            const id = this._generateId(...path);
            const leaf = state.leaves[id];
            const canInterrupt = node.properties?.modifiers?.includes('allowInterruption') ?? false;
            // If it was satisfied (meaning they did the minimum), close it now.
            if (leaf && leaf.satisfied && !canInterrupt) {
                leaf.isClosed = true;
            }
        } else if (node.type === 'GROUP') {
            node.value.forEach((child, idx) => {
                if (child.type !== 'OPERATOR') {
                    this._recursiveClose(child, state, [...path, idx]);
                }
            });
        }
    }

    private static _actionMeetsCostReqs(leaf: LeafState, incomingCost: number): boolean {
        const minC = leaf.minCost ?? 1;
        // Max cost set to 1,000 - if you hit force barrage damage 1,000 times and break this, kudos to you!
        const maxC = leaf.maxCost ?? 1000;
        return incomingCost >= minC && incomingCost <= maxC;
    }

    private static _actionMeetsOccurrencesReqs(leaf: LeafState): boolean {
        if (leaf.isClosed) return false;

        const maxOcc = leaf.maxOccurrences ?? 1;
        return leaf.childActions.length < maxOcc;
    }

    private static _getUpdatedMoveData(
        state: ActiveActivityState,
        leaf: LeafState,
        combatant: CombatantPF2e
    ) {
        const actor = (combatant as any).actor;
        const c = combatant as any;
        const tokenDoc = c.token || (c.tokenId ? game.scenes.active?.tokens.get(c.tokenId) : null);
        const tokenId = tokenDoc?.id;

        let fullHistory = (tokenDoc as any)?._movementHistory || [];
        if (fullHistory.length === 0 && typeof tokenId === 'string') {
            fullHistory = MovementManager.getCapturedHistory(tokenId) || [];
        }

        const activityPath = fullHistory.slice(state.historyAnchorIndex);

        if (activityPath.length === 0) return null;

        const movementMode = leaf.subtype || 'stride';
        const { cost, label } = MovementManager.measurePath(actor, tokenDoc?.object, activityPath, movementMode);
        const maxAllowed = leaf.maxCost ?? 1;

        return {
            cost,
            label,
            activityPath,
            maxAllowed,
            isOverflow: cost > maxAllowed
        };
    }
}

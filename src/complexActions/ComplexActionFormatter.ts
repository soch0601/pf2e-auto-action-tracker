import { SPECIAL_ACTIVITIES } from "./library.ts";
import type { ActiveActivityState, LeafState, GroupNode, ActionNode, OperatorNode } from "./types.d.ts";
import { ComplexActionEngine } from "./ComplexActionEngine.ts";

export class ComplexActionFormatter {

    static toString(state: ActiveActivityState): string {
        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === state.activitySlug);
        if (!definition) return "Unknown Activity";

        if (state.completedBy) return `${definition.name} - Complete`;

        // Format top-level childActions
        const topLevelActiveChildren: { index: number; lines: string[] }[] = [];
        definition.childActions.forEach((child, idx) => {
            if (child.type !== 'OPERATOR') {
                const childLines = ComplexActionFormatter._formatNode(child, [idx], state);
                if (childLines.length > 0) {
                    topLevelActiveChildren.push({ index: idx, lines: childLines });
                }
            }
        });

        if (topLevelActiveChildren.length > 0) {
            const topLevelLines: string[] = [];
            for (let i = 0; i < topLevelActiveChildren.length; i++) {
                if (i > 0) {
                    const prevIdx = topLevelActiveChildren[i - 1].index;
                    const currIdx = topLevelActiveChildren[i].index;
                    let foundOp = 'AND';
                    const opNode = definition.childActions.find((v, index) =>
                        v.type === 'OPERATOR' && index > prevIdx && index < currIdx
                    );
                    if (opNode && opNode.type === 'OPERATOR') {
                        foundOp = opNode.value;
                    } else {
                        const generalOp = definition.childActions.find(v => v.type === 'OPERATOR');
                        if (generalOp && generalOp.type === 'OPERATOR') foundOp = generalOp.value;
                    }

                    let opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>and</i></small>';
                    if (foundOp === 'THEN') opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>then</i></small>';
                    else if (foundOp === 'OR' || foundOp === 'XOR') opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>or</i></small>';

                    topLevelLines.push(opText);
                }
                topLevelLines.push(...topLevelActiveChildren[i].lines);
            }

            const goalText = topLevelLines.map(line => (line.startsWith(" ") || line.startsWith("&nbsp;")) ? `\n${line}` : `\n• ${line}`).join("");
            return `${definition.name} - Waiting for:${goalText}`;
        }

        if (ComplexActionEngine.canComplete(state)) {
            return `${definition.name} - Ready to Finish (or continue)`;
        }

        return definition.name;
    }

    private static _getGroupOptionsString(n: any, p: number[], state: ActiveActivityState): string {
        if (n.type === 'ACTION') {
            const id = ComplexActionEngine.generateId(...p);
            const leaf = state.leaves[id];
            if (leaf && !leaf.isClosed) {
                const actionName = ComplexActionFormatter._getActionName(leaf);
                const isLeafDone = ComplexActionEngine.leafIsSatisfied(leaf);
                if (isLeafDone) {
                    const remaining = leaf.maxOccurrences - leaf.childActions.length;
                    if (remaining > 0) {
                        let goalLabel = `(Optional) ${actionName}`;
                        if (leaf.maxOccurrences > 10) {
                            goalLabel += ` (Repeatable)`;
                        } else if (remaining > 1) {
                            goalLabel += ` (up to ${remaining} more)`;
                        }
                        return goalLabel;
                    }
                    return "";
                } else {
                    return actionName;
                }
            }
            return "";
        }
        if (n.type === 'GROUP') {
            if (ComplexActionEngine.nodeIsClosed(n, state, p)) {
                return "";
            }

            const activeChildrenStrings: string[] = [];
            n.value.forEach((child: any, idx: number) => {
                if (child.type !== 'OPERATOR') {
                    const str = ComplexActionFormatter._getGroupOptionsString(child, [...p, idx], state);
                    if (str) {
                        activeChildrenStrings.push(str);
                    }
                }
            });

            if (activeChildrenStrings.length === 0) return "";
            if (activeChildrenStrings.length === 1) return activeChildrenStrings[0];

            const opNode = n.value.find((v: any) => v.type === 'OPERATOR');
            const foundOp = opNode ? opNode.value : 'AND';
            const connector = (foundOp === 'AND' || foundOp === 'THEN') ? 'and' : 'or';

            const joined = ComplexActionFormatter._joinWithOxford(activeChildrenStrings, connector);
            return joined;
        }
        return "";
    }

    private static _isGroupOptional(n: any, p: number[], state: ActiveActivityState): boolean {
        if (ComplexActionEngine.nodeIsSatisfied(n, state, p)) {
            return true;
        }

        let allActiveOptional = true;
        let hasActive = false;
        n.value.forEach((child: any, idx: number) => {
            if (child.type !== 'OPERATOR') {
                const childPath = [...p, idx];
                if (child.type === 'ACTION') {
                    const id = ComplexActionEngine.generateId(...childPath);
                    const leaf = state.leaves[id];
                    if (leaf && !leaf.isClosed) {
                        hasActive = true;
                        if (!ComplexActionEngine.leafIsSatisfied(leaf)) {
                            allActiveOptional = false;
                        }
                    }
                } else if (child.type === 'GROUP') {
                    if (!ComplexActionEngine.nodeIsClosed(child, state, childPath)) {
                        hasActive = true;
                        if (!ComplexActionFormatter._isGroupOptional(child, childPath, state)) {
                            allActiveOptional = false;
                        }
                    }
                }
            }
        });

        return hasActive && allActiveOptional;
    }

    private static _formatNode(node: any, path: number[], state: ActiveActivityState): string[] {
        if (node.type === 'ACTION') {
            const id = ComplexActionEngine.generateId(...path);
            const leaf = state.leaves[id];
            if (!leaf || leaf.isClosed) return [];

            const actionName = ComplexActionFormatter._getActionName(leaf);
            const isLeafDone = ComplexActionEngine.leafIsSatisfied(leaf);

            if (isLeafDone) {
                const remaining = leaf.maxOccurrences - leaf.childActions.length;
                if (remaining > 0) {
                    let goalLabel = `(Optional) ${actionName}`;
                    if (leaf.maxOccurrences > 10) {
                        goalLabel += ` (Repeatable)`;
                    } else if (remaining > 1) {
                        goalLabel += ` (up to ${remaining} more)`;
                    }
                    return [goalLabel];
                }
                return [];
            } else {
                if (!leaf.satisfied) {
                    return [actionName];
                } else {
                    const childGoals: string[] = [];
                    for (const childAction of leaf.childActions) {
                        if (childAction.ComplexActionState && !childAction.ComplexActionState.completedBy) {
                            childGoals.push(ComplexActionFormatter.toString(childAction.ComplexActionState));
                        }
                    }
                    return childGoals;
                }
            }
        }

        if (node.type === 'GROUP') {
            if (ComplexActionEngine.nodeIsClosed(node, state, path)) {
                return [];
            }

            if (node.name) {
                const isOptional = ComplexActionFormatter._isGroupOptional(node, path, state);
                const header = isOptional ? `(Optional) ${node.name}` : node.name;

                let optionsStr = ComplexActionFormatter._getGroupOptionsString(node, path, state);
                if (!optionsStr) return [];

                const optionsLine = `&nbsp;&nbsp;${optionsStr}`;
                return [header, optionsLine];
            }

            let optionsStr = ComplexActionFormatter._getGroupOptionsString(node, path, state);
            if (optionsStr) {
                const isOptional = ComplexActionFormatter._isGroupOptional(node, path, state);
                const resultStr = isOptional ? `(Optional) ${optionsStr}` : optionsStr;
                return [resultStr];
            }

            const activeChildren: { index: number; lines: string[] }[] = [];
            node.value.forEach((child: any, idx: number) => {
                if (child.type !== 'OPERATOR') {
                    const childLines = ComplexActionFormatter._formatNode(child, [...path, idx], state);
                    if (childLines.length > 0) {
                        activeChildren.push({ index: idx, lines: childLines });
                    }
                }
            });

            if (activeChildren.length === 0) return [];
            if (activeChildren.length === 1) return activeChildren[0].lines;

            const resultLines: string[] = [];
            for (let i = 0; i < activeChildren.length; i++) {
                if (i > 0) {
                    const prevIdx = activeChildren[i - 1].index;
                    const currIdx = activeChildren[i].index;
                    let foundOp = 'AND';
                    const opNode = node.value.find((v: any, index: number) =>
                        v.type === 'OPERATOR' && index > prevIdx && index < currIdx
                    );
                    if (opNode) {
                        foundOp = opNode.value;
                    } else {
                        const generalOp = node.value.find((v: any) => v.type === 'OPERATOR');
                        if (generalOp) foundOp = generalOp.value;
                    }

                    let opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>and</i></small>';
                    if (foundOp === 'THEN') opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>then</i></small>';
                    else if (foundOp === 'OR' || foundOp === 'XOR') opText = '&nbsp;&nbsp;&nbsp;&nbsp;<small><i>or</i></small>';

                    resultLines.push(opText);
                }
                resultLines.push(...activeChildren[i].lines);
            }
            return resultLines;
        }

        return [];
    }

    private static _getActionName(leaf: LeafState): string {
        const key = leaf.subtype || leaf.type;
        const i18nKey = `PF2E_ACTION_TRACKER.Actions.${key}`;

        if (typeof game !== 'undefined' && (game as any).i18n && (game as any).i18n.has(i18nKey)) {
            return (game as any).i18n.localize(i18nKey);
        }

        const definition = SPECIAL_ACTIVITIES.find(a => a.slug === key);
        if (definition) {
            return definition.name;
        }

        return key.split(/[-_ ]+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    private static _joinWithOxford(items: string[], connector: 'or' | 'and'): string {
        if (items.length === 0) return '';
        if (items.length === 1) return items[0];

        // Detect if any item in the list contains a comma itself
        const hasCommas = items.some(item => item.includes(','));

        if (items.length === 2) {
            const separator = hasCommas ? ';' : '';
            return `${items[0]}${separator} ${connector} ${items[1]}`;
        }

        const last = items[items.length - 1];
        const separator = hasCommas ? '; ' : ', ';
        const finalSeparator = hasCommas ? ';' : ',';
        const initials = items.slice(0, -1).join(separator);
        return `${initials}${finalSeparator} ${connector} ${last}`;
    }
}

import type { ActionLogEntry } from "./ActionLogTypes";

export function isMapRelevantAction(entry: Partial<ActionLogEntry>): boolean {
    return entry.isMapRelevant === true && entry.type !== "reaction" && !entry.actionModifiers?.includes("deferMAP");
}

export function getMapProfile(entry: Partial<ActionLogEntry>): "standard" | "agile" {
    return entry.mapProfile === "agile" ? "agile" : "standard";
}

export function getCurrentMapState(
    log: Array<Partial<ActionLogEntry>>,
    originalLog?: Array<Partial<ActionLogEntry>>
): { attackCount: number, penalty: 0 | 2 | 4 | 5 | 6 | 7 | 8 | 10, profile: "standard" | "agile" } {
    const attacks = log.filter(isMapRelevantAction);
    const attackCount = attacks.length;
    const isFixedMAP2 = currentAttackUsesFixedMAP2(originalLog || log);

    if (isFixedMAP2) {
        const profile = attacks.length > 0 ? getMapProfile(attacks[attacks.length - 1]) : "standard";
        if (attackCount === 0) {
            return { attackCount, penalty: 2, profile };
        }
        if (attackCount === 1) {
            return { attackCount, penalty: profile === "agile" ? 6 : 7, profile };
        }
        return { attackCount, penalty: 10, profile };
    }

    if (attackCount === 0) return { attackCount, penalty: 0, profile: "standard" };

    const profile = getMapProfile(attacks[attacks.length - 1]);
    if (attackCount === 1) {
        return { attackCount, penalty: profile === "agile" ? 4 : 5, profile };
    }

    return { attackCount, penalty: profile === "agile" ? 8 : 10, profile };
}

export function getCurrentMapStateFromLog(
    log: Array<Partial<ActionLogEntry>>,
    isActiveTurn = true
): { attackCount: number, penalty: 0 | 2 | 4 | 5 | 6 | 7 | 8 | 10, profile: "standard" | "agile" } {
    if (!isActiveTurn) return getCurrentMapState([], log);

    const mapLog = log.flatMap(entry => {
        const complexState = entry.ComplexActionState;
        if (!complexState) return [entry];

        const isComplete = !!complexState.completedBy;
        const parent = entry.isMapRelevant ? [entry] : [];
        const children = (complexState.orderedActivityChildActions ?? []).flatMap(child => {
            if (child.actionModifiers?.includes("mapIncrease2")) {
                // Return two entries to simulate double MAP in the calculation
                const secondEntry = {
                    ...child,
                    actionModifiers: child.actionModifiers.filter((modifier: string) => modifier !== "mapIncrease2"),
                };
                return [secondEntry, child];
            }
            if (!isComplete || !child.actionModifiers?.includes("deferMAP")) return child;
            return {
                ...child,
                actionModifiers: child.actionModifiers.filter((modifier: string) => modifier !== "deferMAP"),
            };
        });

        return [...parent, ...children];
    });

    return getCurrentMapState(mapLog, log);
}

export function getMapTier(map: { attackCount: number } | { penalty: number }): 0 | 1 | 2 {
    if ("penalty" in map) {
        if (map.penalty <= 0) return 0;
        if (map.penalty === 4 || map.penalty === 5) return 1;
        return 2;
    }

    if (map.attackCount <= 0) return 0;
    if (map.attackCount === 1) return 1;
    return 2;
}

export function getMapDisplayState(map: { attackCount: number, penalty?: number }) {
    if (map.penalty !== undefined) {
        if (map.penalty <= 0) {
            return {
                visible: false,
                core: { text: "MAP: 0", inline: true, tooltip: "MAP 0: no multiple attack penalty" },
                compact: { text: "", inline: true, tooltip: "" },
            };
        }
        if (map.penalty === 2) {
            return {
                visible: true,
                core: { text: "MAP: -2", inline: true, tooltip: "MAP: -2 penalty" },
                compact: { text: "M-2", inline: true, tooltip: "MAP: -2 penalty" },
            };
        }
        if (map.penalty === 4 || map.penalty === 5) {
            return {
                visible: true,
                core: { text: "MAP: -4 | -5", inline: true, tooltip: "MAP 1: -4 | -5" },
                compact: { text: "M1", inline: true, tooltip: "MAP 1: -4 | -5" },
            };
        }
        if (map.penalty === 6 || map.penalty === 7) {
            return {
                visible: true,
                core: { text: "MAP: -6 | -7", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
                compact: { text: "M1-2", inline: true, tooltip: "MAP 1 w/-2: -6 | -7" },
            };
        }
        return {
            visible: true,
            core: { text: "MAP: -8 | -10", inline: true, tooltip: "MAP 2: -8 | -10" },
            compact: { text: "M2", inline: true, tooltip: "MAP 2: -8 | -10" },
        };
    }

    const tier = getMapTier(map);

    if (tier === 0) {
        return {
            visible: false,
            core: { text: "MAP: 0", inline: true, tooltip: "MAP 0: no multiple attack penalty" },
            compact: { text: "", inline: true, tooltip: "" },
        };
    }

    const range = tier === 1 ? "-4 | -5" : "-8 | -10";
    const coreText = `MAP: ${range}`;
    const tooltip = `MAP ${tier}: ${range}`;
    const compactText = `M${tier}`;

    return {
        visible: true,
        core: { text: coreText, inline: true, tooltip },
        compact: { text: compactText, inline: true, tooltip },
    };
}

export function formatMapLabel(
    map: { attackCount: number, penalty?: number },
    compact: boolean
): string {
    const displayState = getMapDisplayState(map);
    if (!displayState.visible) return compact ? "" : displayState.core.text;
    return compact ? displayState.compact.text : displayState.core.text;
}

function currentAttackUsesFixedMAP2(log: Array<Partial<ActionLogEntry>>): boolean {
    if (!log) return false;
    for (const entry of log) {
        if (entry?.ComplexActionState) {
            const state = entry.ComplexActionState;
            if (!state.completedBy) {
                if (state.leaves) {
                    for (const leaf of Object.values(state.leaves)) {
                        if (leaf.type === 'attack' && !leaf.isClosed && leaf.modifiers?.includes('fixedMAP2')) {
                            return true;
                        }
                    }
                }
            }
            if (state.orderedActivityChildActions && currentAttackUsesFixedMAP2(state.orderedActivityChildActions)) {
                return true;
            }
            if (state.leaves) {
                for (const leaf of Object.values(state.leaves)) {
                    if (leaf.childActions && currentAttackUsesFixedMAP2(leaf.childActions)) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}
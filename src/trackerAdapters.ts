export type TrackerMountMode = "core" | "pf2e-hud";
export const PF2E_HUD_TRACKER_ID = "pf2e-hud-tracker";

type RenderKeyEntry = {
    msgId?: string;
    type?: string;
    cost?: number;
    label?: string;
    isQuickenedEligible?: boolean;
    isMapRelevant?: boolean;
    mapProfile?: "standard" | "agile";
    actionModifiers?: string[];
    visibilityKey?: string;
};

type QueryableNode = {
    id?: string;
    classList?: { contains(className: string): boolean };
    querySelector(selector: string): any;
};

type TrackerMount = {
    mode: TrackerMountMode;
    row: any;
    target: any;
};

export function isPf2eHudTracker(root: QueryableNode): boolean {
    return root.id === PF2E_HUD_TRACKER_ID;
}

export function findPf2eHudTracker(root: Pick<Document, "getElementById">): HTMLElement | null {
    return root.getElementById(PF2E_HUD_TRACKER_ID);
}

export function resolveTrackerMount(root: QueryableNode, combatantId: string): TrackerMount | null {
    const row = root.querySelector(`[data-combatant-id="${combatantId}"]`);
    if (!row) return null;

    const mode: TrackerMountMode = isPf2eHudTracker(root) ? "pf2e-hud" : "core";
    const targetSelector = mode === "pf2e-hud"
        ? ".controls"
        : ".token-name, .name-controls";
    const target = row.querySelector(targetSelector);

    if (!target) return null;

    return { mode, row, target };
}

export function resolveMapMountTarget(root: QueryableNode, combatantId: string): any | null {
    if (!isPf2eHudTracker(root)) return null;
    if (!root.classList?.contains("alternate-controls")) return null;

    const row = root.querySelector(`[data-combatant-id="${combatantId}"]`);
    if (!row) return null;

    return row.querySelector(".controls.alt");
}

export function shouldShowTrackerForMount(
    mode: TrackerMountMode,
    isGM: boolean,
    isOwner: boolean,
    isPC: boolean,
): boolean {
    if (isGM) return true;
    if (mode === "pf2e-hud") return isOwner;
    return isOwner || isPC;
}

export function canShowManualActionButton(isGM: boolean, isOwner = false): boolean {
    return isGM || isOwner;
}

export function hasCompactOverspendTint(overflowCount: number): boolean {
    return overflowCount > 0;
}

export function getTrackerRenderKey({
    mode,
    combatantId,
    isGM,
    isOwner,
    isPC,
    actionSlotsKey,
    mapAttackCount,
    maxReactions,
    log,
}: {
    mode: TrackerMountMode;
    combatantId: string;
    isGM: boolean;
    isOwner: boolean;
    isPC: boolean;
    actionSlotsKey: string;
    mapAttackCount: number;
    maxReactions: number;
    log: RenderKeyEntry[];
}): string {
    const entries = log.map(entry => [
        entry.msgId ?? "",
        entry.type ?? "",
        entry.cost ?? 0,
        entry.label ?? "",
        entry.isQuickenedEligible ? 1 : 0,
        entry.isMapRelevant ? 1 : 0,
        entry.mapProfile ?? "",
        entry.actionModifiers?.join(",") ?? "",
        entry.visibilityKey ?? "",
    ].join(":")).join("|");

    return [
        mode,
        combatantId,
        `gm:${isGM ? 1 : 0}`,
        `owner:${isOwner ? 1 : 0}`,
        `pc:${isPC ? 1 : 0}`,
        `slots:${actionSlotsKey}`,
        `map:${mapAttackCount}`,
        `reactions:${maxReactions}`,
        entries,
    ].join("|");
}

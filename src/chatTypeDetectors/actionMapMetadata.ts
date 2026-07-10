type MapProfile = "standard" | "agile";

type ActionMapMetadata = {
    isMapRelevant: boolean;
    mapProfile?: MapProfile;
};

export function getActionMapMetadata(message: any): ActionMapMetadata {
    const context = message.flags?.pf2e?.context;
    const options = context?.options || [];
    const contextTraits = context?.traits || [];
    const itemTraits = message.item?.traits;
    const systemTraits = message.item?.system?.traits?.value;

    const hasAttackTrait =
        options.includes("attack") ||
        options.includes("trait:attack") ||
        options.includes("item:trait:attack") ||
        contextTraits.includes("attack") ||
        itemTraits?.has?.("attack") ||
        itemTraits?.includes?.("attack") ||
        itemTraits?.value?.includes?.("attack") ||
        systemTraits?.includes?.("attack") ||
        false;

    if (!hasAttackTrait) {
        return { isMapRelevant: false };
    }

    const hasAgileTrait =
        options.includes("agile") ||
        itemTraits?.has?.("agile") ||
        itemTraits?.includes?.("agile") ||
        itemTraits?.value?.includes?.("agile") ||
        systemTraits?.includes?.("agile") ||
        contextTraits.includes("agile") ||
        options.includes("item:trait:agile") ||
        options.includes("trait:agile") ||
        false;

    return {
        isMapRelevant: true,
        mapProfile: hasAgileTrait ? "agile" : "standard"
    };
}

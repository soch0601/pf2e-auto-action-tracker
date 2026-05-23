export function getCostFromMsgFlavor(htmlString: string): number | undefined {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString;

    // 1. Existing Logic: Check for text in action-glyph span
    const glyphText = tempDiv.querySelector('.action-glyph')?.textContent?.trim();
    if (glyphText && ["1", "2", "3"].includes(glyphText)) {
        return parseInt(glyphText);
    }
    if (glyphText && ["R", "F", "0"].includes(glyphText)) {
        return 0;
    }

    // 2. New Logic: Check for Action Icons (Common in monster/action cards)
    const imgAction = tempDiv.querySelector('img[src*="actions/"]');
    if (imgAction) {
        const src = imgAction.getAttribute('src') || "";
        if (src.includes('OneAction')) return 1;
        if (src.includes('TwoActions')) return 2;
        if (src.includes('ThreeActions')) return 3;
        if (src.includes('FreeAction')) return 0;
        if (src.includes('Reaction')) return 0; // Handled by isReaction flag
    }

    return undefined;
}

export function getIsReaction(item: any, pf2eFlags: any, flavor: string): boolean {
    const checks = [
        item?.system?.time?.value === "reaction",
        pf2eFlags?.context?.type === "reaction",
        pf2eFlags?.context?.options?.includes("action:reaction"),
        pf2eFlags?.context?.options?.includes("trait:reaction"),
        flavor.includes('action-glyph">R<')
    ];

    return checks.some(check => check === true);
}

export function getInteractSubtype(cleanSubtitle: string): string {
    if (!cleanSubtitle) return "";

    // Strip outer parentheses if present
    let clean = cleanSubtitle.trim();
    if (clean.startsWith('(') && clean.endsWith(')')) {
        clean = clean.slice(1, -1).trim();
    }
    clean = clean.toLowerCase();
    if (!clean) return "";

    // If game.i18n is available, check translation keys
    if (typeof game !== 'undefined' && (game as any).i18n) {
        const i18n = (game as any).i18n;
        const keys = [
            "PF2E.Actions.Interact.Subtitle.Reload",
            "PF2E.Action.Subtitle.Reload",
            "PF2E.Actions.Interact.Subtitle.Sheathe",
            "PF2E.Action.Subtitle.Sheathe",
            "PF2E.Actions.Interact.Subtitle.Draw",
            "PF2E.Action.Subtitle.Draw",
            "PF2E.Actions.Interact.Subtitle.Stow",
            "PF2E.Action.Subtitle.Stow",
            "PF2E.Actions.Interact.Subtitle.Retrieve",
            "PF2E.Action.Subtitle.Retrieve",
            "PF2E.Actions.Interact.Subtitle.Adjust",
            "PF2E.Action.Subtitle.Adjust",
            "PF2E.Actions.Interact.Subtitle.Attach",
            "PF2E.Action.Subtitle.Attach",
            "PF2E.Actions.Interact.Subtitle.Detach",
            "PF2E.Action.Subtitle.Detach",
            "PF2E.Actions.Interact.Subtitle.Wear",
            "PF2E.Action.Subtitle.Wear",
        ];

        for (const key of keys) {
            if (i18n.has(key) && i18n.localize(key).toLowerCase() === clean) {
                const parts = key.split(".");
                return parts[parts.length - 1].toLowerCase();
            }
        }
    }

    // Default fallback (useful for English or unit tests)
    return clean.replace(/[()]/g, "").replace(/\s+/g, '-').toLowerCase();
}

export function getLabelFromMsgFlavor(htmlString: string): string | undefined {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString;

    // 1. Target the header
    const header = tempDiv.querySelector('h4.action, .card-header h3, h3');
    if (!header) return undefined;

    // 2. CLONE the header so we don't mess with the original DOM if it matters
    const cleanHeader = header.cloneNode(true) as HTMLElement;

    // 3. REMOVE the glyph span entirely before grabbing text
    cleanHeader.querySelector('.action-glyph, .pf2-icon')?.remove();

    // 4. Extract subtitle element first, then remove it so baseTitle remains clean
    const subtitleEl = cleanHeader.querySelector('.subtitle');
    const rawSubtitle = subtitleEl?.textContent?.trim() || "";
    subtitleEl?.remove();

    let baseTitle = cleanHeader.querySelector('strong')?.textContent?.trim() || cleanHeader.textContent?.trim() || "";

    let title = baseTitle;
    if (rawSubtitle) {
        let cleanSubtitle = rawSubtitle.trim();
        if (cleanSubtitle.startsWith('(') && cleanSubtitle.endsWith(')')) {
            cleanSubtitle = cleanSubtitle.slice(1, -1).trim();
        }
        if (cleanSubtitle) {
            title = `${title}: ${cleanSubtitle}`;
        }
    }

    if (title) {
        return title
            .replace(/\s+/g, ' ') // Collapse whitespace
            .trim();
    }
    return undefined;
}

export function getSlugFromMsgFlavor(htmlString: string): string | undefined {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString;

    const header = tempDiv.querySelector('h4.action, .card-header h3, h3');
    if (!header) return undefined;

    const cleanHeader = header.cloneNode(true) as HTMLElement;
    // Remove the glyph so it doesn't end up in our slug
    cleanHeader.querySelector('.action-glyph, .pf2-icon')?.remove();

    const subtitleEl = cleanHeader.querySelector('.subtitle');
    const rawSubtitle = subtitleEl?.textContent?.trim() || "";
    subtitleEl?.remove();

    let baseTitle = cleanHeader.querySelector('strong')?.textContent?.trim() || cleanHeader.textContent?.trim() || "";

    const cleanBase = baseTitle
        .toLowerCase()
        .trim()
        .replace(/[()]/g, '')
        .replace(/\s+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (rawSubtitle) {
        const subtypeSuffix = getInteractSubtype(rawSubtitle);
        if (subtypeSuffix) {
            return `${cleanBase}:${subtypeSuffix}`.toLowerCase();
        }
    }

    return cleanBase ? cleanBase.toLowerCase() : undefined;
}
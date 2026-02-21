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

export function getLabelFromMsgFlavor(htmlString: string): string | undefined {
    if (!htmlString.includes('action-glyph')) return undefined;

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString;

    // 1. Find the header (Standard h4, Monster h3, or Card Header)
    const header = tempDiv.querySelector('h4.action, .card-header h3, h3');
    if (!header) return undefined;

    // 2. Priority: <strong> tag inside the header (Standard PF2e style)
    // 3. Fallback: The direct text of the header
    let title = header.querySelector('strong')?.textContent || header.textContent;

    if (title) {
        return title
            .replace(/[123FR]/g, '') // Remove action glyph characters
            .replace(/\s+/g, ' ')    // Collapse all whitespace/newlines
            .replace(/[()]/g, '')    // Remove parentheses
            .trim();
    }

    return undefined;
}

export function getSlugFromMsgFlavor(htmlString: string): string | undefined {
    // Check for action or action-glyph classes
    if (!htmlString.includes('class="action') && !htmlString.includes('action-glyph')) return undefined;

    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = htmlString;

    // Search for common PF2e header patterns
    // 1. h4.action strong (Standard)
    // 2. .card-header h3 (Monster cards)
    // 3. h3 (Simple cards)
    const header = tempDiv.querySelector('h4.action strong, .card-header h3, h3');
    const title = header?.textContent;

    if (title) {
        return title
            .toLowerCase()
            .trim()
            .split(/[123FRR]/)[0] // Remove trailing glyph text if it's inside the header
            .replace(/[()]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+$/, ''); // Clean up trailing dashes
    }

    return undefined;
}
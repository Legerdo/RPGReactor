/**
 * RRPropCatalog - what the 3D Prop Builder offers to make, in the left
 * column: categories, and in them the types a person picks.
 *
 * A category: { id, label, order }. A type: { id, category, label, icon,
 * kind, start(), matches(recipe), keywords? }: `kind` is a model kind
 * registered with RRPropModel (its normalize and build), `start` gives
 * the recipe the type starts from, `matches` says which type a recipe is.
 * A kind's page is registered once with `ui(kind, page)`: { placeholder,
 * tabs: [[id, label]], panel(tab), act?(act, button), choose?(path, value),
 * moves?(recipe), reset(recipe) }, its functions called on the builder (so
 * `this._slider`, `this._select`, `this._color`, `this._check`,
 * `this._tiles` and `this._section` are at hand).
 *
 * A new kind is a file of its own that registers its model, its types and
 * its page here; nothing else changes.
 */
(function(root) {
    'use strict';

    const CATEGORIES = [];
    const TYPES = [];
    const UI = {};

    function category(c) {
        const i = CATEGORIES.findIndex(x => x.id === c.id);
        const entry = Object.assign({ order: 100 }, c);
        if (i >= 0) CATEGORIES[i] = entry; else CATEGORIES.push(entry);
        CATEGORIES.sort((a, b) => a.order - b.order);
        return entry;
    }

    function add(type) {
        const i = TYPES.findIndex(x => x.id === type.id);
        const entry = Object.assign({ matches: () => false, keywords: '' }, type);
        if (i >= 0) TYPES[i] = entry; else TYPES.push(entry);
        return entry;
    }

    function ui(kind, page) { UI[kind] = page; return page; }

    /** The type a recipe is: the first of its kind that says so, else the first of its kind. */
    function typeOf(recipe) {
        const kind = recipe && recipe.kind;
        return TYPES.find(t => t.kind === kind && t.matches(recipe)) || TYPES.find(t => t.kind === kind) || null;
    }

    /** Types under each category, those matching `query` (by their label, keywords or category), in order. */
    function grouped(query, translate) {
        const t = translate || (s => s);
        const q = String(query || '').trim().toLowerCase();
        return CATEGORIES.map(c => {
            const types = TYPES.filter(x => x.category === c.id).filter(x => {
                if (!q) return true;
                const words = [t(x.label), x.label, x.keywords, t(c.label), c.label].join(' ').toLowerCase();
                return q.split(/\s+/).every(w => words.includes(w));
            });
            return { category: c, types };
        }).filter(g => g.types.length);
    }

    /** Small line icons (24 x 24, currentColor) the types are shown with. */
    const ICONS = {
        equipment: '<path d="M8 5l4-2 4 2 5 4-3 4-2-1v9H8v-9l-2 1-3-4z"/>',
        flag: '<path d="M5 21V3"/><path d="M5 4c3-1.5 5 1.5 8 0s4.5-.5 6 .5v8c-1.5-1-3-1.5-6 0s-5-1.5-8 0"/>',
        streamer: '<path d="M5 21V3"/><path d="M5 4c4 0 7 2 15 4-8 1-11 3-15 4"/>',
        banner: '<path d="M5 21V3"/><path d="M5 4h7v15l-3.5-3L5 19z"/>',
        hanging: '<path d="M2 5h20"/><path d="M5 5v9l2-2 2 2V5"/><path d="M11 5v12l2-2 2 2V5"/><path d="M17 5v8l2-2 2 2V5"/>',
        cutout: '<path d="M7 20l2-6-4-4 5-1 2-5 2 5 5 1-4 4 2 6-5-3z"/>',
        turned: '<path d="M9 3h6"/><path d="M10 3c0 3-4 5-4 10s3 8 6 8 6-3 6-8-4-7-4-10"/>',
        framed: '<rect x="3" y="4" width="18" height="16" rx="1"/><rect x="7" y="8" width="10" height="8"/>',
        sword: '<path d="M14 4l6-1-1 6-9 9"/><path d="M6 14l4 4"/><path d="M8 16l-4 4"/>',
        dagger: '<path d="M15 5l4-1-1 4-6 6"/><path d="M9 12l3 3"/><path d="M10.5 13.5L6 18"/>',
        curved: '<path d="M19 3c-1 6-5 10-10 12"/><path d="M7 13l4 4"/><path d="M9 15l-4 4"/>',
        pistol: '<path d="M3 8h17v4H11l-1 2H8l-1 5H4l1-7H3z"/>',
        rifle: '<path d="M2 10h14l6-1v3H12l-2 2H7l-1 3H3l1-4H2z"/>',
        shotgun: '<path d="M2 9h20v2H2z"/><path d="M8 11v2l-3 4H3l2-6"/>',
        blaster: '<path d="M3 8h14l3 2-3 2H11l-1 2H8l-1 5H4l1-7H3z"/><path d="M20 10h2"/>',
        cannon: '<rect x="3" y="8" width="14" height="6" rx="2"/><path d="M17 10h5v2h-5"/><path d="M7 14l-1 5h3l1-5"/>'
    };
    function icon(name, size) {
        const body = ICONS[name] || ICONS.flag, s = size || 16;
        return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    }

    // The categories this builder starts with; more slot in by order (furniture, containers, lights...).
    category({ id: 'banners', label: 'Banners & Flags', order: 10 });
    category({ id: 'picture', label: 'From Picture', order: 20 });
    category({ id: 'swords', label: 'Weapons › Swords & Blades', order: 40 });
    category({ id: 'firearms', label: 'Weapons › Firearms', order: 41 });
    category({ id: 'scifi', label: 'Weapons › Sci-fi', order: 42 });

    const api = { CATEGORIES, TYPES, UI, ICONS, category, add, ui, typeOf, grouped, icon };
    root.RRPropCatalog = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

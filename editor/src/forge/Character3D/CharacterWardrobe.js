/**
 * RRCharacterWardrobe - the Character Builder's garments and outfits.
 *
 * Every garment but the modeled ones is one or more pieces cut by
 * RRCharacterOutfit from the body's clothing helpers (or its skin, for gloves
 * and hoods): where along the spine, arms and legs it starts and ends, how
 * far it stands off the body, how it drapes and flares, how it is colored. An outfit is a list
 * of garments, one per slot; Fantasy, Armor and Sci-fi pieces mix freely
 * with everyday ones. Modeled garments are MakeHuman's own meshes, fitted by
 * RRCharacterClothes.
 *
 * Chain positions (see RRCharacterOutfit.CHAINS), on any body:
 *   spine  crotch -0.65, hip joint 0, top of hips 0.6, navel 1, waist 1.2,
 *          ribs 2, bust 2.8, armpit 3, neck base 3.95, chin 4.55, eyes 5.25,
 *          brow 5.5, crown 6 (even steps up to the neck, about 13 cm each)
 *   arms   collarbone 0, shoulder 1, elbow 2, wrist 3, fingertips 4
 *   legs   hip 0, knee 1, ankle 2, toes 3, toe tips 4
 *   skirt  waistband 0 .. ankle 1 (the skirt helper)
 */
(function(root) {
    'use strict';

    const front = a => Math.max(0, Math.cos(a));

    /** Necklines: the top edge of a garment on the trunk, by angle about it (0 in front). */
    const NECKLINES = {
        crew: (a) => 4.05 - 0.12 * front(a) ** 2,
        scoop: (a) => 4.0 - 0.45 * front(a) ** 2,
        v: (a) => 4.05 - 0.75 * front(a) ** 8,
        deepv: (a) => 4.05 - 1.4 * front(a) ** 10,
        boat: (a) => 3.92 + 0.04 * front(a),
        high: (a) => 4.42 - 0.08 * front(a),
        turtle: (a) => 4.6 - 0.05 * front(a),
        strapless: (a) => 3.3 - 0.05 * front(a)
    };
    const NECKLINE_CHOICES = [['crew', 'Round'], ['scoop', 'Scoop'], ['v', 'V'], ['deepv', 'Deep V'], ['boat', 'Wide'], ['high', 'High collar'], ['turtle', 'Turtleneck'], ['strapless', 'Strapless']];

    // Materials: [roughness, metalness]
    const MATERIAL = { cloth: [0.9, 0], silk: [0.45, 0], leather: [0.55, 0], metal: [0.32, 0.85], gold: [0.28, 0.95], plastic: [0.35, 0], rubber: [0.7, 0] };

    const PATTERNS = [['solid', 'Solid'], ['stripes', 'Stripes'], ['pinstripes', 'Pinstripes'], ['vstripes', 'Vertical stripes'], ['checker', 'Checks'], ['plaid', 'Plaid'], ['gradient', 'Fade'], ['halves', 'Two halves'], ['camo', 'Camouflage'], ['panels', 'Panel lines'], ['mail', 'Chain mail'], ['scales', 'Scales'], ['quilted', 'Quilted'], ['studs', 'Studded']];

    /**
     * Knobs a garment shows: `length` (0..1, garment's own reach), `sleeves`
     * (0 none .. 1 full), `neckline`, `fit` (0 tight .. 1 loose), `open`.
     */
    const top = (item, extra) => {
        const sleeves = item.sleeves ?? 1;
        const length = item.length ?? 0.5;
        // Sleeves: none (0) keeps a strap over the collarbone, short at 0.35, elbow 0.6, full at 1.
        const armHi = sleeves <= 0.02 ? 0.55 : 0.85 + sleeves * 2.12;
        const lo = 2.2 - length * 2.4;
        return Object.assign({
            surface: 'tights',
            rules: { spine: a => [lo, NECKLINES[item.neckline || 'crew'](a)], arms: [-1, armHi], open: item.open ? 0.12 + item.open * 0.5 : 0 },
            lift: 0.006 + (item.fit ?? 0.3) * 0.012,
            drape: Math.round(3 + (item.fit ?? 0.3) * 10)
        }, extra);
    };

    const skirtPiece = (item, extra) => {
        const length = item.length ?? 0.6, flare = item.flare ?? 0.3, open = item.open || 0;
        return Object.assign({
            surface: 'skirt',
            value: (an, v) => {
                let c = Math.min(1, (length - an.skirtU[v]) * 4);
                if (open) c = Math.min(c, (Math.abs(an.angle[v * 5]) - open) * 0.8);
                if (item.slits) c = Math.min(c, Math.max(an.skirtU[v] - (1 - item.slits) * length, (Math.abs(Math.abs(an.angle[v * 5]) - Math.PI / 2) - 0.12) * 2));
                return c;
            },
            lift: 0.012,
            drape: 2,
            flare: f => flare * 0.35 * Math.pow(Math.max(0, f.u), 1.4),
            collide: true
        }, extra);
    };

    const legs = (item, extra) => {
        const length = item.length ?? 1;
        return Object.assign({
            surface: 'tights',
            rules: { spine: [-3, 0.9 + (item.rise ?? 0.3) * 0.8], legs: [-1, 0.25 + length * 1.72] },
            lift: 0.008 + (item.fit ?? 0.3) * 0.012,
            drape: Math.round(2 + (item.fit ?? 0.3) * 8),
            liftAt: item.flare ? (f => (f.fam >= 3 ? Math.max(0, f.s - 1) * item.flare * 0.05 : 0)) : null
        }, extra);
    };

    /**
     * Footwear is built round the foot (RRCharacterOutfit.shoes): a style per
     * kind, its collar or shaft from the item's length, standing further off
     * the foot with its bulk.
     */
    const SHOE_KINDS = {
        dress: { collar: { front: 0.95, side: 0.62, back: 0.92 }, toe: 0.014, point: 0.35, sole: 0.011, welt: 0.004, heel: 1, spring: 0.006, gap: 0.003, wall: 0.02 },
        sneaker: { collar: { front: 1.32, side: 0.88, back: 1.08 }, toe: 0.01, point: 0, width: 0.004, sole: 0.022, welt: 0.003, heel: 0, spring: 0.01, gap: 0.005, wall: 0.028, laces: true },
        boot: { toe: 0.012, point: 0.1, sole: 0.016, welt: 0.005, heel: 1, spring: 0.007, gap: 0.004, wall: 0.026, margin: 0.012 },
        sabaton: { toe: 0.022, point: 0.6, sole: 0.012, welt: 0.003, heel: 0.6, spring: 0.012, gap: 0.009, wall: 0.03, lames: 2, margin: 0.012 },
        mag: { toe: 0.012, point: 0, width: 0.01, sole: 0.032, welt: 0.008, heel: 0, spring: 0.008, gap: 0.012, wall: 0.04, margin: 0.012 },
        sandal: { sandal: true, toe: 0.006, point: 0.15, sole: 0.014, welt: 0.002, heel: 0.4, spring: 0.004, gap: 0.002 }
    };
    const shoe = (kind, item, extra) => {
        const style = Object.assign({}, SHOE_KINDS[kind], extra);
        style.gap = Math.round(((style.gap || 0) + (item.bulk ?? 0) * 0.008) * 1e4) / 1e4;
        if (kind !== 'dress' && kind !== 'sneaker' && kind !== 'sandal') style.top = Math.round((1.98 - (item.length ?? 0.35) * 1.6) * 100) / 100;
        // Short boots lace up the front; tall ones pull on.
        if (kind === 'boot') style.laces = (item.length ?? 0.35) <= 0.6;
        return { shoe: style, kind };
    };

    const hands = (item, extra) => Object.assign({
        surface: 'body',
        hideMargin: 0.12,
        rules: { arms: [3.0 - (item.length ?? 0.15) * 1.0, 9] },
        lift: 0.003 + (item.bulk ?? 0) * 0.02,
        drape: 0,
        rim: (item.length ?? 0.15) > 0.05
    }, extra);

    /** A head covering cut from the skin: everything above `from` on the head, the face left open unless `face`. */
    const headPiece = (item, extra) => {
        const from = 5 + (1 - (item.length ?? 0.5)) * 0.9;
        const face = item.face ?? 0;
        return Object.assign({
            surface: 'body',
            value: (an, v) => {
                const sv = an.s[v * 5], a = an.angle[v * 5], m = an.member[v * 5];
                if (m < 0.5) return -1;
                let c = sv - from;
                // The face opening: in front, between the chin and the brow.
                const open = (0.95 - face * 0.6) - Math.abs(a);
                const band = Math.min(sv - (4.4 + face * 0.4), 5.62 - face * 0.25 - sv);
                if (face < 1) c = Math.min(c, -Math.min(open * 1.2, band));
                return Math.max(-1, Math.min(1, c));
            },
            lift: 0.006,
            drape: 6
        }, extra);
    };

    const plates = (base, bands) => Object.assign(base, { bands });

    // A top worn with a skirt piece of its own: its hem (spine 0.4) under the skirt's waistband (0.7 in front,
    // 0.9 behind), so no skin shows between them on any body.
    const BODICE = 0.75;

    // ── the catalog ───────────────────────────────────────────────────────
    // slot: one garment per slot. group: where the picker lists it.
    const GARMENTS = [
        // Everyday
        { id: 'tshirt', label: 'T-shirt', slot: 'top', group: 'Everyday', knobs: ['sleeves', 'length', 'neckline', 'fit'], defaults: { color: '#3d6fb6', sleeves: 0.3, length: 0.62, neckline: 'crew', fit: 0.35, material: 'cloth', trimWidth: 0.05 },
            pieces: i => [top(i)] },
        { id: 'tanktop', label: 'Tank top', slot: 'top', group: 'Everyday', knobs: ['length', 'neckline', 'fit'], defaults: { color: '#e8e2d4', sleeves: 0, length: 0.5, neckline: 'scoop', fit: 0.2, material: 'cloth' },
            pieces: i => [top(Object.assign({}, i, { sleeves: 0 }))] },
        { id: 'shirt', label: 'Button shirt', slot: 'top', group: 'Everyday', knobs: ['sleeves', 'length', 'neckline', 'fit'], defaults: { color: '#f2f0ea', color2: '#c8d4e4', sleeves: 1, length: 0.55, neckline: 'v', fit: 0.4, material: 'cloth', pattern: 'solid', trim: '#ffffff', trimWidth: 0.06 },
            pieces: i => [top(i), collar(i)] },
        { id: 'sweater', label: 'Sweater', slot: 'top', group: 'Everyday', knobs: ['sleeves', 'length', 'neckline', 'fit'], defaults: { color: '#7a3b3b', color2: '#5a2a2a', sleeves: 1, length: 0.6, neckline: 'turtle', fit: 0.6, material: 'cloth', pattern: 'stripes', scale: 0.6, trimWidth: 0.12 },
            pieces: i => [top(i, { lift: 0.014 + (i.fit ?? 0.5) * 0.012 })] },
        { id: 'hoodie', label: 'Hoodie', slot: 'top', group: 'Everyday', knobs: ['length', 'fit'], defaults: { color: '#4a4f58', sleeves: 1, length: 0.65, neckline: 'crew', fit: 0.7, material: 'cloth', trim: '#3a3e46', trimWidth: 0.1 },
            pieces: i => [top(Object.assign({}, i, { sleeves: 1 }), { lift: 0.016 }), hood(i)] },
        { id: 'jeans', label: 'Trousers', slot: 'bottom', group: 'Everyday', knobs: ['length', 'fit'], defaults: { color: '#2f4468', length: 1, fit: 0.3, material: 'cloth', trim: '#22314b', trimWidth: 0.05 },
            pieces: i => [legs(i)] },
        { id: 'shorts', label: 'Shorts', slot: 'bottom', group: 'Everyday', knobs: ['length', 'fit'], defaults: { color: '#7a6a4f', length: 0.18, fit: 0.45, material: 'cloth', trimWidth: 0.05 },
            pieces: i => [legs(i)] },
        { id: 'leggings', label: 'Leggings', slot: 'bottom', group: 'Everyday', knobs: ['length'], defaults: { color: '#1f1f24', length: 0.95, fit: 0, material: 'cloth' },
            pieces: i => [legs(Object.assign({}, i, { fit: 0 }), { lift: 0.004, drape: 1 })] },
        { id: 'skirt', label: 'Skirt', slot: 'bottom', group: 'Everyday', knobs: ['length', 'flare'], defaults: { color: '#5b3a6e', length: 0.35, flare: 0.35, material: 'cloth', trimWidth: 0.04 },
            pieces: i => [skirtPiece(i)] },
        { id: 'dress', label: 'Dress', slot: 'dress', group: 'Everyday', knobs: ['sleeves', 'length', 'flare', 'neckline'], defaults: { color: '#a8324a', sleeves: 0.25, length: 0.7, flare: 0.5, neckline: 'scoop', material: 'silk', trimWidth: 0.04 },
            pieces: i => [top(Object.assign({}, i, { length: BODICE }), { lift: 0.006, drape: 3 }), skirtPiece(i)] },
        { id: 'suitjacket', label: 'Suit jacket', slot: 'over', group: 'Everyday', knobs: ['length', 'fit'], defaults: { color: '#2b2e36', length: 0.75, fit: 0.4, material: 'cloth', open: 0.25, neckline: 'deepv', trimWidth: 0.04, trim: '#1e2026' },
            pieces: i => [top(Object.assign({}, i, { sleeves: 1, neckline: 'deepv' }), { lift: 0.022, drape: 6 }), lapels(i)] },
        { id: 'trenchcoat', label: 'Long coat', slot: 'over', group: 'Everyday', knobs: ['length', 'fit', 'flare'], defaults: { color: '#7b6345', length: 0.85, flare: 0.25, fit: 0.5, material: 'leather', open: 0.2, trimWidth: 0.05, trim: '#5e4a32' },
            pieces: i => [top(Object.assign({}, i, { sleeves: 1, length: BODICE, neckline: 'high' }), { lift: 0.024, drape: 6 }), skirtPiece(Object.assign({}, i, { open: 0.25 }), { lift: 0.03 })] },
        { id: 'sneakers', label: 'Sneakers', slot: 'feet', group: 'Everyday', knobs: ['color2'], defaults: { color: '#f4f4f4', color2: '#d03a3a', bulk: 0, material: 'rubber', trim: '#e8e8e8' },
            pieces: i => [shoe('sneaker', i)] },
        { id: 'shoes', label: 'Dress shoes', slot: 'feet', group: 'Everyday', defaults: { color: '#1b1612', bulk: 0, material: 'leather' },
            pieces: i => [shoe('dress', i)] },
        { id: 'boots', label: 'Boots', slot: 'feet', group: 'Everyday', knobs: ['length'], defaults: { color: '#4a3020', length: 0.35, bulk: 0, material: 'leather', trim: '#2c1c12' },
            pieces: i => [shoe('boot', i)] },
        { id: 'gloves', label: 'Gloves', slot: 'hands', group: 'Everyday', knobs: ['length'], defaults: { color: '#2a2420', length: 0.2, material: 'leather' },
            pieces: i => [hands(i)] },
        { id: 'beanie', label: 'Beanie', slot: 'head', group: 'Everyday', defaults: { color: '#b84a2e', length: 0.45, material: 'cloth', pattern: 'stripes', color2: '#e8d8b8', trimWidth: 0.12 },
            pieces: i => [headPiece(Object.assign({ length: 0.5 }, i), { lift: 0.012, drape: 8, value: beanieValue })] },

        // Fantasy and medieval
        { id: 'tunic', label: 'Tunic', slot: 'top', group: 'Fantasy', knobs: ['sleeves', 'length', 'neckline', 'fit'], defaults: { color: '#6b7a3a', sleeves: 0.85, length: 0.55, neckline: 'v', fit: 0.6, material: 'cloth', trim: '#c9a35a', trimWidth: 0.07 },
            pieces: i => [top(Object.assign({}, i, { length: BODICE }), { lift: 0.014 }), skirtPiece({ length: (i.length ?? 0.55) * 0.55, flare: 0.25, slits: 0.5 }, { lift: 0.018, look: 'same' })] },
        { id: 'peasant', label: 'Peasant blouse', slot: 'top', group: 'Fantasy', knobs: ['sleeves', 'length'], defaults: { color: '#ece3cf', sleeves: 0.9, length: 0.45, neckline: 'boat', fit: 0.8, material: 'cloth', bell: 0.5 },
            pieces: i => [top(Object.assign({}, i, { neckline: 'boat' }), { liftAt: bellSleeves(i.bell ?? 0.5) })] },
        { id: 'robe', label: 'Robe', slot: 'dress', group: 'Fantasy', knobs: ['length', 'flare', 'bell', 'neckline'], defaults: { color: '#2e3f8a', length: 1, flare: 0.45, bell: 0.8, neckline: 'v', material: 'cloth', trim: '#d4af37', trimWidth: 0.08 },
            pieces: i => [top(Object.assign({}, i, { sleeves: 1, length: BODICE, fit: 0.7 }), { liftAt: bellSleeves(i.bell ?? 0.8) }), skirtPiece(i, { lift: 0.02 })] },
        { id: 'gown', label: 'Gown', slot: 'dress', group: 'Fantasy', knobs: ['sleeves', 'flare', 'neckline'], defaults: { color: '#7c2a6b', color2: '#d8b4d0', sleeves: 0, length: 1, flare: 0.9, neckline: 'strapless', material: 'silk', trim: '#e8d39a', trimWidth: 0.05, pattern: 'gradient', from: 0.5, to: -3 },
            pieces: i => [top(Object.assign({}, i, { length: BODICE, fit: 0.05 }), { lift: 0.005, drape: 2 }), skirtPiece(Object.assign({}, i, { length: 1 }), { lift: 0.02 })] },
        { id: 'vest', label: 'Vest', slot: 'over', group: 'Fantasy', knobs: ['length', 'open'], defaults: { color: '#5a3d22', length: 0.45, open: 0.1, material: 'leather', neckline: 'deepv', trim: '#3a2614', trimWidth: 0.06 },
            pieces: i => [top(Object.assign({}, i, { sleeves: 0, neckline: 'deepv', fit: 0.3 }), { lift: 0.02, drape: 5 })] },
        { id: 'corset', label: 'Corset', slot: 'waist', group: 'Fantasy', defaults: { color: '#3a1e2a', color2: '#5a3040', material: 'leather', pattern: 'vstripes', scale: 1.5, trim: '#c9a35a', trimWidth: 0.08 },
            pieces: i => [{ surface: 'tights', rules: { spine: a => [0.55, 2.75 - 0.25 * front(a)] }, lift: 0.024, drape: 6 }] },
        { id: 'sash', label: 'Belt', slot: 'waist', group: 'Fantasy', knobs: [], defaults: { color: '#3a2618', material: 'leather', trim: '#2a1a10', trimWidth: 0 },
            pieces: i => [{ band: { from: 0.88, to: 1.25 } }] },
        { id: 'kilt', label: 'Kilt', slot: 'bottom', group: 'Fantasy', knobs: ['length'], defaults: { color: '#2f5a3a', color2: '#8a2a2a', length: 0.32, flare: 0.25, material: 'cloth', pattern: 'plaid', scale: 1.4 },
            pieces: i => [skirtPiece(i)] },
        { id: 'loincloth', label: 'Loincloth', slot: 'bottom', group: 'Fantasy', knobs: ['length'], defaults: { color: '#6a4a2a', length: 0.4, material: 'leather' },
            pieces: i => [skirtPiece(i, { value: loinValue(i.length ?? 0.4) }), { surface: 'tights', rules: { spine: [-3, 0.75], legs: [-1, 0.05] }, lift: 0.008, drape: 2 }] },
        { id: 'hood', label: 'Hood', slot: 'head', group: 'Fantasy', knobs: ['face'], defaults: { color: '#3b3b46', length: 0.95, face: 0, material: 'cloth' },
            pieces: i => [hood(i)] },
        { id: 'sandals', label: 'Sandals', slot: 'feet', group: 'Fantasy', defaults: { color: '#7a5636', material: 'leather' },
            pieces: i => [shoe('sandal', i), { surface: 'body', value: sandalStraps, smoothCut: 1, lift: 0.003, drape: 0, hides: false, look: 'same' }] },
        { id: 'wraps', label: 'Arm wraps', slot: 'wrists', group: 'Fantasy', knobs: ['length'], defaults: { color: '#d8ccb0', length: 0.5, material: 'cloth', pattern: 'pinstripes', color2: '#b8ac90' },
            pieces: i => [{ surface: 'tights', rules: { arms: [2.95 - (i.length ?? 0.5) * 0.9, 3.05] }, lift: 0.01, drape: 1 }] },

        // Armor
        { id: 'leatherarmor', label: 'Leather armor', slot: 'armor', group: 'Armor', defaults: { color: '#6a4426', color2: '#4e301a', material: 'leather', pattern: 'stripes', scale: 0.7, trim: '#3a2414', trimWidth: 0.06 },
            pieces: i => [{ surface: 'tights', rules: { spine: a => [0.45, NECKLINES.crew(a) - 0.05], arms: [-1, 1.05] }, lift: 0.024, drape: 8 }] },
        { id: 'chainmail', label: 'Chain mail', slot: 'armor', group: 'Armor', knobs: ['sleeves', 'length'], defaults: { color: '#8c9198', color2: '#6d7278', sleeves: 0.6, length: 0.7, material: 'metal', pattern: 'mail', neckline: 'crew' },
            pieces: i => [top(Object.assign({}, i, { length: BODICE, fit: 0.5 }), { lift: 0.018 }), skirtPiece({ length: (i.length ?? 0.7) * 0.5, flare: 0.2, slits: 0.6 }, { lift: 0.022, look: 'same' })] },
        { id: 'breastplate', label: 'Breastplate', slot: 'armor', group: 'Armor', defaults: { color: '#b6bcc4', color2: '#8e949c', material: 'metal', trim: '#d4af37', trimWidth: 0.05 },
            pieces: i => [plates({ surface: 'tights', rules: { spine: a => [0.5, 3.9 - 0.1 * front(a)] }, lift: 0.04, drape: 18, hard: true }, { spine: [0.5, 1.7, 3, 0.07] })] },
        { id: 'pauldrons', label: 'Pauldrons', slot: 'shoulders', group: 'Armor', knobs: ['bulk'], defaults: { color: '#b6bcc4', material: 'metal', bulk: 0.5, trim: '#d4af37', trimWidth: 0.08 },
            pieces: i => [plates({ surface: 'tights', rules: { arms: [0.25, 1.55] }, lift: 0.035 + (i.bulk ?? 0.5) * 0.05, drape: 14, hard: true }, { arms: [0.8, 1.55, 3, 0.08] })] },
        { id: 'vambraces', label: 'Bracers', slot: 'wrists', group: 'Armor', defaults: { color: '#9aa0a8', material: 'metal', trim: '#6a7078', trimWidth: 0.1 },
            pieces: i => [{ surface: 'tights', rules: { arms: [2.15, 2.95] }, lift: 0.022, drape: 6, hard: true }] },
        { id: 'gauntlets', label: 'Gauntlets', slot: 'hands', group: 'Armor', defaults: { color: '#9aa0a8', length: 0.25, bulk: 0.5, material: 'metal' },
            pieces: i => [hands(i, { lift: 0.008, drape: 2 })] },
        { id: 'tassets', label: 'Tassets', slot: 'hips', group: 'Armor', defaults: { color: '#a8aeb6', length: 0.3, flare: 0.3, material: 'metal', trim: '#d4af37', trimWidth: 0.06 },
            pieces: i => [plates(skirtPiece(Object.assign({}, i, { slits: 0.9 }), { lift: 0.035, drape: 3, hard: true }), { skirt: [0, i.length ?? 0.3, 3, 0.06] })] },
        { id: 'greaves', label: 'Leg armor', slot: 'legarmor', group: 'Armor', defaults: { color: '#a8aeb6', material: 'metal', trim: '#7a8088', trimWidth: 0.05 },
            pieces: i => [plates({ surface: 'tights', rules: { legs: [0.2, 1.95] }, lift: 0.03, drape: 10, hard: true }, { legs: [0.2, 1.95, 3, 0.05] })] },
        { id: 'sabatons', label: 'Armored boots', slot: 'feet', group: 'Armor', defaults: { color: '#9aa0a8', length: 0.3, bulk: 0.5, material: 'metal' },
            pieces: i => [shoe('sabaton', i)] },
        { id: 'helm', label: 'Helmet', slot: 'head', group: 'Armor', knobs: ['face'], defaults: { color: '#b0b6be', length: 0.9, face: 0.2, material: 'metal', trim: '#d4af37', trimWidth: 0.05 },
            pieces: i => [headPiece(i, { lift: 0.03, drape: 14, hard: true })] },
        { id: 'greathelm', label: 'Great helm', slot: 'head', group: 'Armor', defaults: { color: '#a0a6ae', length: 1, face: 1, material: 'metal' },
            pieces: i => [headPiece(Object.assign({}, i, { face: 1, length: 1.3 }), { lift: 0.045, drape: 24, hard: true, value: greatHelmValue })] },

        // Sci-fi
        { id: 'bodysuit', label: 'Bodysuit', slot: 'under', group: 'Sci-fi', knobs: ['color2'], defaults: { color: '#20242c', color2: '#36c2ff', material: 'rubber', pattern: 'panels', neckline: 'high' },
            pieces: i => [{ surface: 'tights', rules: { spine: a => [-3, NECKLINES[i.neckline || 'high'](a)], arms: [-1, 2.98], legs: [-1, 9] }, lift: 0.004, drape: 1 }] },
        { id: 'spacesuit', label: 'Space suit', slot: 'dress', group: 'Sci-fi', defaults: { color: '#e9ebee', color2: '#d86a2a', material: 'cloth', pattern: 'panels', trim: '#9aa0a8', trimWidth: 0.06 },
            pieces: i => [{ surface: 'tights', rules: { spine: a => [-3, 4.3], arms: [-1, 2.95], legs: [-1, 9] }, lift: 0.035, drape: 14 }] },
        { id: 'tacvest', label: 'Tactical vest', slot: 'armor', group: 'Sci-fi', defaults: { color: '#3c4436', color2: '#2c3228', material: 'cloth', pattern: 'camo', trim: '#22281e', trimWidth: 0.05 },
            pieces: i => [plates({ surface: 'tights', rules: { spine: a => [0.6, 3.85 - 0.45 * front(a) ** 4], arms: [-1, 0.5] }, lift: 0.035, drape: 10, hard: true }, { spine: [0.6, 1.9, 3, 0.06] })] },
        { id: 'powerarmor', label: 'Power armor', slot: 'armor', group: 'Sci-fi', knobs: ['bulk', 'color2'], defaults: { color: '#5d6b4a', color2: '#ffb020', bulk: 0.6, material: 'metal', pattern: 'panels', trim: '#2c3024', trimWidth: 0.06 },
            pieces: i => powerArmor(i) },
        { id: 'cyberjacket', label: 'Neon jacket', slot: 'over', group: 'Sci-fi', defaults: { color: '#16141c', color2: '#ff2bd6', length: 0.55, material: 'plastic', open: 0.15, neckline: 'high', trim: '#ff2bd6', trimWidth: 0.05 },
            pieces: i => [top(Object.assign({}, i, { sleeves: 1, neckline: 'high' }), { lift: 0.02, drape: 5 })] },
        { id: 'visorhelm', label: 'Visor helmet', slot: 'head', group: 'Sci-fi', defaults: { color: '#e4e7eb', color2: '#1a2a40', length: 1.1, face: 1, material: 'plastic', pattern: 'visor' },
            pieces: i => [headPiece(Object.assign({}, i, { face: 1, length: 1.25 }), { lift: 0.04, drape: 22, hard: true, value: greatHelmValue })] },
        { id: 'magboots', label: 'Mag boots', slot: 'feet', group: 'Sci-fi', defaults: { color: '#5a606a', color2: '#36c2ff', length: 0.45, bulk: 0.9, material: 'metal', pattern: 'panels', trim: '#2a2e34', trimWidth: 0.08 },
            pieces: i => [shoe('mag', i)] },

        // Modeled: MakeHuman's own garments (RRCharacterClothes), fitted to the body, in their own colors until one is chosen.
        modeled('mh_tee_jeans', 'T-shirt and jeans', 'dress'),
        modeled('mh_fitted_jeans', 'Fitted tee and jeans', 'dress'),
        modeled('mh_tee_shorts', 'Tee and denim shorts', 'dress'),
        modeled('mh_jacket_jeans', 'Jacket and jeans', 'dress'),
        modeled('mh_sport', 'Crop top and leggings', 'dress'),
        modeled('mh_overalls', 'Overalls', 'dress'),
        modeled('mh_suit', 'Suit and tie', 'dress'),
        modeled('mh_skirtsuit', 'Blouse and pencil skirt', 'dress'),
        modeled('mh_sundress', 'Sundress', 'dress'),
        modeled('mh_uniform', 'Star uniform', 'dress'),
        modeled('mh_sweater', 'Knit sweater', 'top'),
        modeled('mh_viking_tunic', 'Viking tunic', 'top'),
        modeled('mh_viking_trousers', 'Viking trousers', 'bottom'),
        modeled('mh_loafers', 'Loafers', 'feet', 'leather', 0),
        modeled('mh_sneakers', 'Running shoes', 'feet', 'rubber', 0),
        modeled('mh_boots', 'Tall boots', 'feet', 'leather', 2),
        modeled('mh_viking_boots', 'Viking boots', 'feet', 'leather', 2)
    ];

    /**
     * A modeled garment: no pieces to cut; `color` and `color2` recolor its own
     * picture when set. `rank`: shoes 0 (under trouser hems), clothes 1, tall
     * boots 2 (over them).
     */
    function modeled(id, label, slot, material, rank) {
        return { id, label, slot, group: 'Modeled', modeled: true, rank: rank ?? 1, knobs: [], defaults: { material: material || 'cloth' }, pieces: () => [] };
    }

    function collar(i) {
        return { surface: 'tights', rules: { spine: a => [3.92 - 0.25 * front(a) ** 6, 4.18 + 0.06 * (1 - front(a))] }, lift: 0.016, drape: 4, liftAt: f => (f.s > 4.05 ? (f.s - 4.05) * 0.18 : 0), look: 'same' };
    }
    function lapels(i) {
        return { surface: 'tights', value: (an, v) => {
            const a = Math.abs(an.angle[v * 5]), sv = an.s[v * 5];
            if (an.member[v * 5] < 0.5) return -1;
            return Math.min(sv - 2.2, 3.95 - sv, a - 0.2, 0.75 - a) * 3;
        }, lift: 0.03, drape: 4, look: 'trim' };
    }
    function hood(i) {
        return headPiece(Object.assign({ length: 1.1, face: 0 }, i), { lift: 0.04, drape: 16, value: (an, v) => {
            const sv = an.s[v * 5], a = Math.abs(an.angle[v * 5]);
            if (an.member[v * 5] < 0.4) return -1;
            // From the neck up, the face left open.
            let c = Math.min(sv - 4.1, 1);
            const faceOpen = Math.min(1.05 - a, Math.min(sv - 4.45, 5.75 - sv) * 2);
            return Math.max(-1, Math.min(c, -faceOpen));
        } });
    }
    function bellSleeves(amount) {
        return f => (f.fam === 1 || f.fam === 2 ? Math.max(0, f.s - 1.8) ** 1.6 * amount * 0.07 : 0);
    }
    function beanieValue(an, v) {
        if (an.member[v * 5] < 0.5) return -1;
        return Math.max(-1, Math.min(1, an.s[v * 5] - 5.5 + 0.3 * Math.max(0, -Math.cos(an.angle[v * 5]))));
    }
    function greatHelmValue(an, v) {
        if (an.member[v * 5] < 0.5) return -1;
        return Math.max(-1, Math.min(1, (an.s[v * 5] - 4.35) * 2));
    }
    function loinValue(length) {
        return (an, v) => {
            const a = Math.abs(an.angle[v * 5]);
            const panel = Math.max(0.55 - a, a - (Math.PI - 0.55));
            return Math.min((length - an.skirtU[v]) * 4, panel * 2);
        };
    }
    /**
     * A sandal's straps on the skin of the foot: across the toes, over the
     * instep, round the ankle and down behind the heel, in the foot's own
     * frame on the average body.
     */
    function sandalStraps(an, v) {
        const fam = an.member[v * 5 + 3] >= an.member[v * 5 + 4] ? 3 : 4;
        if (an.member[v * 5 + fam] < 0.5 || an.s[v * 5 + fam] < 1.7) return -1;
        const ch = an.chains[fam === 3 ? 'legL' : 'legR'], ankle = ch[2], tip = ch[4];
        let fx = tip[0] - ankle[0], fz = tip[2] - ankle[2];
        const l = Math.hypot(fx, fz); fx /= l; fz /= l;
        const x = an.rest[v * 3] - ankle[0], z = an.rest[v * 3 + 2] - ankle[2], y = an.rest[v * 3 + 1];
        const f = x * fx + z * fz, side = Math.abs(x * fz - z * fx);
        if (y < 0.007) return -1;
        const strip = (c, w) => (w - Math.abs(f - c)) * 150;
        const toes = strip(0.102, 0.0075), instep = strip(0.05, 0.007);
        const ankleRing = f < 0.065 ? (0.0055 - Math.abs(y - ankle[1] * 1.02)) * 150 : -1;
        const heel = Math.min((0.0065 - side) * 150, (ankle[1] * 1.02 - y) * 150, -f * 150 - 1.5);
        return Math.max(-1, Math.min(1, Math.max(toes, instep, ankleRing, heel)));
    }
    function powerArmor(i) {
        const bulk = i.bulk ?? 0.6, L = 0.05 + bulk * 0.06;
        const hard = { hard: true, collide: true };
        return [
            plates(Object.assign({ surface: 'tights', rules: { spine: a => [0.3, 4.2 - 0.1 * front(a)] }, lift: L * 1.2, drape: 24 }, hard), { spine: [0.3, 1.7, 3, 0.07] }),
            plates(Object.assign({ surface: 'tights', rules: { arms: [-0.2, 1.6] }, lift: L * 1.6, drape: 22 }, hard), { arms: [0.9, 1.6, 2, 0.08] }),
            Object.assign({ surface: 'tights', rules: { arms: [1.6, 2.98] }, lift: L * 0.8, drape: 14 }, hard),
            plates(Object.assign({ surface: 'tights', rules: { spine: [-3, 0.45], legs: [-1, 1.95] }, lift: L, drape: 16 }, hard), { legs: [0.35, 1.95, 3, 0.05] }),
            Object.assign(shoe('mag', { length: 0.4, bulk: bulk * 0.6 }, { lames: 3 }), { armorFeet: true }),
            Object.assign(hands({ length: 0.3 }), { lift: 0.012, drape: 3 }, hard)
        ];
    }

    const BY_ID = new Map(GARMENTS.map(g => [g.id, g]));
    const SLOTS = [...new Set(GARMENTS.map(g => g.slot))];
    // Outward order: a later slot is laid over an earlier one.
    // Leg armor goes over trousers and under the skirt of a tunic, a dress or a robe.
    const LAYER = { under: 0, bottom: 1, legarmor: 1.5, top: 2, dress: 2, feet: 3, hands: 2, waist: 3, wrists: 3, armor: 4, hips: 4, over: 5, shoulders: 6, head: 6 };

    /** A full outfit item: catalog defaults under what the recipe chose. */
    function normalizeItem(item) {
        const g = BY_ID.get(item && item.id);
        if (!g) return null;
        const out = Object.assign({ id: g.id }, g.defaults, item);
        for (const k of ['sleeves', 'length', 'fit', 'flare', 'bell', 'open', 'face', 'bulk']) if (out[k] != null) out[k] = Math.max(0, Math.min(k === 'length' ? 1.4 : 1.5, +out[k] || 0));
        for (const k of ['color', 'color2', 'trim']) if (out[k] && !/^#[0-9a-f]{6}$/i.test(out[k])) delete out[k];
        if (out.neckline && !NECKLINES[out.neckline]) out.neckline = 'crew';
        if (!MATERIAL[out.material]) out.material = 'cloth';
        return out;
    }

    /** One garment per slot, the later one winning; ordered from the skin outward. */
    function normalizeOutfit(list) {
        const bySlot = new Map();
        for (const raw of Array.isArray(list) ? list : []) {
            const item = normalizeItem(raw);
            if (!item) continue;
            const slot = BY_ID.get(item.id).slot;
            // A dress takes the top and bottom slots; a top or bottom replaces a dress.
            if (slot === 'dress') { bySlot.delete('top'); bySlot.delete('bottom'); }
            if (slot === 'top' || slot === 'bottom') bySlot.delete('dress');
            bySlot.set(slot, item);
        }
        return [...bySlot.values()].sort((a, b) => (LAYER[BY_ID.get(a.id).slot] ?? 3) - (LAYER[BY_ID.get(b.id).slot] ?? 3));
    }

    // ── outfits ───────────────────────────────────────────────────────────
    const PRESETS = [
        { id: 'none', label: 'Nothing', group: 'Basics', items: [] },
        { id: 'underwear', label: 'Underwear', group: 'Basics', items: [{ id: 'shorts', color: '#e6e1d8', length: 0, fit: 0 }, { id: 'tanktop', color: '#e6e1d8', length: 0.15, neckline: 'scoop' }] },
        { id: 'casual', label: 'Casual', group: 'Everyday', items: [{ id: 'tshirt' }, { id: 'jeans' }, { id: 'sneakers' }] },
        { id: 'office', label: 'Office', group: 'Everyday', items: [{ id: 'shirt' }, { id: 'jeans', color: '#2b2e36' }, { id: 'suitjacket' }, { id: 'shoes' }] },
        { id: 'winter', label: 'Winter', group: 'Everyday', items: [{ id: 'sweater' }, { id: 'jeans' }, { id: 'boots' }, { id: 'beanie' }, { id: 'gloves' }] },
        { id: 'detective', label: 'Detective', group: 'Everyday', items: [{ id: 'shirt', color: '#e8e4d8' }, { id: 'jeans', color: '#3a3530' }, { id: 'trenchcoat' }, { id: 'shoes' }] },
        { id: 'sporty', label: 'Athlete', group: 'Everyday', items: [{ id: 'tanktop', color: '#d03a3a' }, { id: 'shorts', color: '#1f1f24', length: 0.25 }, { id: 'sneakers' }] },
        { id: 'summerdress', label: 'Summer dress', group: 'Everyday', items: [{ id: 'dress', color: '#f0c040', sleeves: 0, length: 0.45, flare: 0.6 }, { id: 'sandals' }] },
        { id: 'peasantf', label: 'Villager', group: 'Fantasy', items: [{ id: 'peasant' }, { id: 'skirt', color: '#6a4a32', length: 0.95, flare: 0.5 }, { id: 'sash', color: '#8a3a2a' }, { id: 'shoes', color: '#4a3020' }] },
        { id: 'farmer', label: 'Farmer', group: 'Fantasy', items: [{ id: 'tunic', color: '#8a7a5a', sleeves: 0.7 }, { id: 'jeans', color: '#5a4a32', fit: 0.6 }, { id: 'sash' }, { id: 'boots', length: 0.2 }] },
        { id: 'ranger', label: 'Ranger', group: 'Fantasy', items: [{ id: 'tunic', color: '#3e5a32' }, { id: 'leggings', color: '#3a3024' }, { id: 'vest', color: '#4a3220' }, { id: 'sash' }, { id: 'boots', length: 0.5 }, { id: 'hood', color: '#2f4a2a' }, { id: 'wraps' }] },
        { id: 'rogue', label: 'Rogue', group: 'Fantasy', items: [{ id: 'shirt', color: '#2a2a30', neckline: 'v' }, { id: 'leggings', color: '#1a1a1e' }, { id: 'leatherarmor', color: '#2e2620', color2: '#221c18' }, { id: 'boots', color: '#1e1814', length: 0.55 }, { id: 'gloves', color: '#1e1814' }, { id: 'hood', color: '#1c1c22' }] },
        { id: 'mage', label: 'Mage', group: 'Fantasy', items: [{ id: 'robe' }, { id: 'sash', color: '#d4af37' }, { id: 'shoes', color: '#2a1e3a' }] },
        { id: 'priest', label: 'Priest', group: 'Fantasy', items: [{ id: 'robe', color: '#ece8dc', trim: '#c9a35a', bell: 0.5, neckline: 'high' }, { id: 'sash', color: '#c9a35a' }, { id: 'sandals' }] },
        { id: 'noble', label: 'Noble', group: 'Fantasy', items: [{ id: 'gown' }, { id: 'gloves', color: '#f2ede4', length: 0.8 }] },
        { id: 'prince', label: 'Prince', group: 'Fantasy', items: [{ id: 'shirt', color: '#f4f0e6', neckline: 'high' }, { id: 'leggings', color: '#ece6da' }, { id: 'trenchcoat', color: '#6a1a2a', trim: '#d4af37', length: 0.6, open: 0.25 }, { id: 'boots', color: '#1a1410', length: 0.75 }, { id: 'sash', color: '#d4af37' }] },
        { id: 'barbarian', label: 'Barbarian', group: 'Fantasy', items: [{ id: 'loincloth' }, { id: 'sash', color: '#4a3020' }, { id: 'wraps', color: '#6a4a2a' }, { id: 'boots', color: '#5a4030', length: 0.45 }] },
        { id: 'pirate', label: 'Pirate', group: 'Fantasy', items: [{ id: 'peasant', color: '#f0ebe0', neckline: 'v', bell: 0.3 }, { id: 'jeans', color: '#2e2a40', length: 0.8, fit: 0.7 }, { id: 'vest', color: '#7a1e1e', length: 0.6 }, { id: 'sash', color: '#c03030' }, { id: 'boots', color: '#1e1610', length: 0.7 }] },
        { id: 'monk', label: 'Monk', group: 'Fantasy', items: [{ id: 'robe', color: '#b8641e', trim: '#8a4a14', bell: 0.3, neckline: 'v' }, { id: 'sash', color: '#7a3e10' }, { id: 'sandals' }] },
        { id: 'knight', label: 'Knight', group: 'Armor', items: [{ id: 'chainmail' }, { id: 'jeans', color: '#5a5e66' }, { id: 'breastplate' }, { id: 'pauldrons' }, { id: 'vambraces' }, { id: 'gauntlets' }, { id: 'tassets' }, { id: 'greaves' }, { id: 'sabatons' }, { id: 'helm' }] },
        { id: 'paladin', label: 'Paladin', group: 'Armor', items: [{ id: 'tunic', color: '#ece8dc', trim: '#d4af37', length: 0.9, sleeves: 1 }, { id: 'leggings', color: '#3a3e46' }, { id: 'breastplate', color: '#e8d9a0', color2: '#c8b070', trim: '#ffffff' }, { id: 'pauldrons', color: '#e8d9a0', bulk: 0.9, trim: '#ffffff' }, { id: 'vambraces', color: '#e8d9a0' }, { id: 'greaves', color: '#e8d9a0' }, { id: 'sabatons', color: '#e8d9a0' }, { id: 'gauntlets', color: '#e8d9a0' }] },
        { id: 'gladiator', label: 'Gladiator', group: 'Armor', items: [{ id: 'loincloth', color: '#8a2a2a' }, { id: 'pauldrons', color: '#9a7a4a', material: 'gold', bulk: 0.2 }, { id: 'vambraces', color: '#8a6a3a' }, { id: 'sandals' }, { id: 'sash', color: '#5a3a1a' }] },
        { id: 'darkknight', label: 'Dark knight', group: 'Armor', items: [{ id: 'chainmail', color: '#3a3a40', length: 0.9 }, { id: 'jeans', color: '#1a1a1e' }, { id: 'breastplate', color: '#2a2a30', color2: '#1a1a20', trim: '#8a1a1a' }, { id: 'pauldrons', color: '#2a2a30', bulk: 1.2, trim: '#8a1a1a' }, { id: 'vambraces', color: '#2a2a30' }, { id: 'gauntlets', color: '#2a2a30' }, { id: 'greaves', color: '#2a2a30' }, { id: 'sabatons', color: '#2a2a30' }, { id: 'greathelm', color: '#2a2a30' }] },
        { id: 'pilot', label: 'Space pilot', group: 'Sci-fi', items: [{ id: 'bodysuit', color: '#d8dce2', color2: '#d86a2a' }, { id: 'tacvest', color: '#3a4250', color2: '#2a3240', pattern: 'solid' }, { id: 'magboots', color: '#3a4250' }, { id: 'gloves', color: '#3a4250' }] },
        { id: 'astronaut', label: 'Astronaut', group: 'Sci-fi', items: [{ id: 'spacesuit' }, { id: 'magboots', color: '#e9ebee', color2: '#d86a2a' }, { id: 'gloves', color: '#e9ebee', bulk: 0.6 }, { id: 'visorhelm', color: '#f2f4f6', color2: '#c89a2a' }] },
        { id: 'trooper', label: 'Power armor', group: 'Sci-fi', items: [{ id: 'bodysuit' }, { id: 'powerarmor' }, { id: 'visorhelm', color: '#5d6b4a', color2: '#ffb020' }] },
        { id: 'marine', label: 'Space marine', group: 'Sci-fi', items: [{ id: 'bodysuit', color: '#1a2030' }, { id: 'powerarmor', color: '#2a4a8a', color2: '#e8e8f0', bulk: 1.1, trim: '#d4af37' }, { id: 'visorhelm', color: '#2a4a8a', color2: '#ff3030' }] },
        { id: 'cyberpunk', label: 'Cyberpunk', group: 'Sci-fi', items: [{ id: 'tanktop', color: '#1a1a20' }, { id: 'leggings', color: '#16141c' }, { id: 'cyberjacket' }, { id: 'boots', color: '#16141c', length: 0.6 }, { id: 'gloves', color: '#ff2bd6', length: 0.05 }] },
        { id: 'soldier', label: 'Soldier', group: 'Sci-fi', items: [{ id: 'shirt', color: '#4a5240', pattern: 'camo', color2: '#353b2e' }, { id: 'jeans', color: '#4a5240', pattern: 'camo', color2: '#353b2e', fit: 0.5 }, { id: 'tacvest' }, { id: 'boots', color: '#2a2620', length: 0.4 }, { id: 'gloves', color: '#2a2620', length: 0.1 }] },
        { id: 'mhcasual', label: 'Jeans and tee', group: 'Modeled', items: [{ id: 'mh_tee_jeans' }, { id: 'mh_sneakers' }] },
        { id: 'mhbusiness', label: 'Business suit', group: 'Modeled', items: [{ id: 'mh_suit' }, { id: 'mh_loafers' }] },
        { id: 'mhskirtsuit', label: 'Skirt suit', group: 'Modeled', items: [{ id: 'mh_skirtsuit' }, { id: 'mh_loafers', color: '#1b1612' }] },
        { id: 'mhsundress', label: 'Sundress', group: 'Modeled', items: [{ id: 'mh_sundress' }, { id: 'mh_sneakers' }] },
        { id: 'mhviking', label: 'Viking', group: 'Modeled', items: [{ id: 'mh_viking_tunic' }, { id: 'mh_viking_trousers' }, { id: 'mh_viking_boots' }] },
        { id: 'mhstarcrew', label: 'Star crew', group: 'Modeled', items: [{ id: 'mh_uniform' }, { id: 'mh_boots' }] }
    ];

    // ── building ──────────────────────────────────────────────────────────
    /** The color look of a piece: the item's colors, or the trim for a trim piece. */
    function lookOf(item, spec) {
        const look = { color: item.color, color2: item.color2, trim: item.trim, pattern: item.pattern || 'solid', trimWidth: item.trimWidth || 0, scale: item.scale, from: item.from, to: item.to };
        if (spec.look === 'trim') return { color: item.trim || item.color2 || item.color, pattern: 'solid' };
        return look;
    }

    /**
     * Parts for an outfit on a built body (RRHumanBody.build), and the body
     * vertices its opaque pieces cover (`hidden`, a Set of pack vertex ids)
     * so the skin under them is left out.
     */
    function build(pack, built, outfit, cache) {
        const O = root.RRCharacterOutfit || require('./CharacterOutfit.js');
        cache = cache || {};
        const items = normalizeOutfit(outfit);
        const entries = [];
        // What laying needs of this body (its normals, the tights on its skin, a lookup of its vertices)
        // is worked out once per build and never kept: the next build is another body.
        const frame = {};
        const covered = new Float32Array(pack.vertexCount).fill(-1);
        const modeledItems = [], shoeParts = [], shoeTextures = [];
        const under = underLayers(), belts = [];
        const shod = items.some(i => BY_ID.get(i.id).slot === 'feet');
        // With anything on the feet, a suit's legs end at the ankle (inside a boot, over a shoe's collar).
        const anyShoes = shod || items.some(i => BY_ID.get(i.id).pieces(i).some(p => p.shoe));
        items.forEach((item, layer) => {
            const g = BY_ID.get(item.id);
            if (g.modeled) { modeledItems.push(item); return; }
            const specs = g.pieces(item);
            specs.forEach((raw, pi) => {
                if (raw.band) {
                    const made = beltFor(pack, built, O, item, g, raw, entries, cache);
                    shoeParts.push(made.part); shoeTextures.push(made.texture);
                    // A coat laid after it goes over it.
                    belts.push({ cover: made.cover, layer });
                    return;
                }
                if (raw.shoe) {
                    // Armor's own boots give way to footwear chosen for the feet.
                    if (raw.armorFeet && shod) return;
                    const made = shoesFor(pack, built, O, item, g, raw, entries, cache, shoeParts.length, frame);
                    shoeParts.push(made.part); shoeTextures.push(made.texture);
                    for (const v of made.hidden) covered[v] = 1;
                    return;
                }
                const spec = Object.assign({}, raw);
                const footed = anyShoes && spec.rules && spec.rules.legs && !spec.shoe && (typeof spec.rules.legs === 'function' || spec.rules.legs[1] > 2.05);
                if (footed) spec.rules = Object.assign({}, spec.rules, { legs: [Array.isArray(spec.rules.legs) ? spec.rules.legs[0] : -1, 2.0] });
                spec.cutKey = [item.id, pi, cutSettings(item), spec.bands || null, footed ? 'ankle' : null];
                if (spec.bands) spec.value = bandedValue(spec, O);
                // Each layer out stands a little further off the body.
                spec.lift = (spec.lift ?? 0.006) + layer * 0.0035;
                const piece = O.cutFor(pack, spec);
                if (!piece.index.length) return;
                const laid = O.lay(pack, built, piece, spec, frame);
                laid.layer = layer;
                // Over what an earlier garment already wears there: a belt over a robe at a heavy belly's fold,
                // a skirt over trouser legs, a jacket over a sweater.
                if (under.count) overlay(laid, under, O);
                for (const b of belts) if (b.layer < layer && b.cover(laid.positions)) laid.normals = O.triangleNormals(laid.positions, laid.index);
                under.add(laid, layer);
                const look = Object.assign(lookOf(item, spec), { material: item.material });
                const [roughness, metalness] = MATERIAL[item.material] || MATERIAL.cloth;
                entries.push({ laid, look, skirt: spec.surface === 'skirt', name: g.label, roughness, metalness, doubleSided: spec.surface === 'skirt' });
                // The skin a tight piece covers is not drawn (a skirt hangs free of the legs).
                if (spec.surface !== 'skirt' && spec.hides !== false) markCovered(pack, O, spec, covered);
            });
        });
        const hidden = new Set();
        for (let v = 0; v < covered.length; v++) if (covered[v] > 0.1) hidden.add(v);
        // Modeled garments: each its own part and picture, hiding the skin it covers.
        const modeledParts = [], textures = [];
        if (modeledItems.length) {
            const Clothes = root.RRCharacterClothes || require('./CharacterClothes.js');
            const wear = modeledItems.map(item => {
                const g = BY_ID.get(item.id), [roughness, metalness] = MATERIAL[item.material] || MATERIAL.cloth;
                return { item, rank: g.rank, look: { name: g.label, roughness, metalness } };
            });
            for (const made of Clothes.buildAll(pack, built, wear, frame)) {
                modeledParts.push(made.part);
                textures.push(made.texture);
                for (const v of made.hidden) hidden.add(v);
            }
        }
        modeledParts.push(...shoeParts); textures.push(...shoeTextures);
        if (!entries.length) return { parts: modeledParts, hidden, items, texture: null, textures };
        // The picture depends on the cut garments only: kept while the body changes.
        const Atlas = root.RRCharacterAtlas || require('./CharacterAtlas.js');
        const key = JSON.stringify([items.filter(i => !BY_ID.get(i.id).modeled), cache.atlasSize || 1024]);
        const store = cache.atlas || (cache.atlas = { key: null, layout: null });
        if (store.key !== key) { store.layout = Atlas.layout(pack, entries, { size: cache.atlasSize || 1024 }); store.key = key; }
        return { parts: Atlas.apply(store.layout, entries).concat(modeledParts), hidden, items, texture: store.layout.texture, textureKey: key, textures };
    }

    /**
     * The garments laid so far, for laying the next one over them: their
     * surface points and outward normals in a grid, by the layer each is in.
     */
    function underLayers() {
        const cell = 0.03, map = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
        const pts = [];
        let pieces = 0;
        return {
            count: 0,
            add(laid, layer) {
                const P = laid.positions, N = laid.normals, piece = ++pieces;
                for (let i = 0; i < laid.rimStart; i++) {
                    const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
                    let list = map.get(k); if (!list) map.set(k, list = []);
                    list.push(pts.length);
                    // Outward: the way the piece was lifted off the body (a skirt's faces may turn either way).
                    const B = laid.base, out = (P[i * 3] - B[i * 3]) * N[i * 3] + (P[i * 3 + 1] - B[i * 3 + 1]) * N[i * 3 + 1] + (P[i * 3 + 2] - B[i * 3 + 2]) * N[i * 3 + 2];
                    const s = out < 0 ? -1 : 1;
                    pts.push({ p: [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n: [N[i * 3] * s, N[i * 3 + 1] * s, N[i * 3 + 2] * s], layer, piece });
                    this.count++;
                }
            },
            /** The nearest point of each garment piece under `layer` within 4 cm. */
            near(x, y, z, layer) {
                const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
                const best = new Map();
                for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
                    for (const q of map.get(key(cx + i, cy + j, cz + k)) || []) {
                        const e = pts[q];
                        if (e.layer >= layer) continue;
                        const d = (e.p[0] - x) ** 2 + (e.p[1] - y) ** 2 + (e.p[2] - z) ** 2;
                        if (d > 0.0016) continue;
                        const b = best.get(e.piece);
                        if (!b || d < b.d) best.set(e.piece, { d, e });
                    }
                }
                return [...best.values()].map(b => b.e);
            }
        };
    }

    /** A laid piece pushed out to stand a few millimeters over the garments under it; its rim follows. */
    function overlay(laid, under, O, layer) {
        const P = laid.positions, gap = 0.003, n = laid.rimStart;
        const push = new Float32Array(n * 3);
        let moved = false;
        for (let i = 0; i < n; i++) {
            // Over each piece under it near here, by as much as the deepest one asks.
            let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
            for (const e of under.near(x, y, z, laid.layer)) {
                const d = (x - e.p[0]) * e.n[0] + (y - e.p[1]) * e.n[1] + (z - e.p[2]) * e.n[2];
                if (d >= gap || d < -0.045) continue;
                const k = gap - d;
                x += e.n[0] * k; y += e.n[1] * k; z += e.n[2] * k;
            }
            if (x === P[i * 3] && y === P[i * 3 + 1] && z === P[i * 3 + 2]) continue;
            push[i * 3] = x - P[i * 3]; push[i * 3 + 1] = y - P[i * 3 + 1]; push[i * 3 + 2] = z - P[i * 3 + 2];
            moved = true;
        }
        if (!moved) return;
        const count = P.length / 3;
        for (let i = 0; i < count; i++) {
            const o = laid.origin[i];
            P[i * 3] += push[o * 3]; P[i * 3 + 1] += push[o * 3 + 1]; P[i * 3 + 2] += push[o * 3 + 2];
        }
        laid.normals = O.triangleNormals(P, laid.index);
    }

    /**
     * A pair of shoes for a footwear item: the part (both feet, its own
     * picture, kept per look) and the skin it covers. A boot's shaft goes over
     * the trouser legs already laid.
     */
    function shoesFor(pack, built, O, item, g, raw, entries, cache, n, frame) {
        let extra = null;
        if (raw.shoe.top != null) {
            const pts = [];
            for (const e of entries) {
                if (e.skirt) continue;
                const P = e.laid.positions;
                for (let i = 0; i < P.length; i += 3) if (P[i + 1] < 0.75) pts.push(P[i], P[i + 1], P[i + 2]);
            }
            extra = Float32Array.from(pts);
        }
        const made = O.shoes(pack, built, raw.shoe, extra, frame);
        // Trouser legs that bulge between the shaft's rings are kept inside it.
        if (extra) for (const e of entries) if (!e.skirt && made.tuck(e.laid.positions)) e.laid.normals = O.triangleNormals(e.laid.positions, e.laid.index);
        const Atlas = root.RRCharacterAtlas || require('./CharacterAtlas.js');
        const look = { kind: raw.kind, color: item.color, color2: item.color2, trim: item.trim, material: item.material, laces: !!raw.shoe.laces, lames: raw.shoe.lames };
        const key = JSON.stringify([made.template.key, look]);
        const store = cache.shoes || (cache.shoes = new Map());
        const name = 'shoes' + (n ? n + 1 : '') + '.png';
        let picture = store.get(key);
        if (!picture) {
            picture = Object.assign(Atlas.shoePicture(made.template, look, 512), { name });
            if (store.size > 6) store.clear();
            store.set(key, picture);
        }
        if (picture.name !== name) picture = Object.assign({}, picture, { name });
        const [roughness, metalness] = MATERIAL[item.material] || MATERIAL.cloth;
        return {
            part: { name: g.label, positions: made.positions, normals: made.normals, uvs: made.uvs, index: made.index, joints: made.joints, weights: made.weights, source: made.source,
                texture: name, roughness, metalness, doubleSided: true },
            texture: picture, hidden: made.hidden
        };
    }

    /** A belt for a waist item: a band over what is worn under it, its own picture kept per look. */
    function beltFor(pack, built, O, item, g, raw, entries, cache) {
        const pts = [];
        for (const e of entries) {
            const P = e.laid.positions;
            for (let i = 0; i < P.length; i += 3) pts.push(P[i], P[i + 1], P[i + 2]);
        }
        const made = O.band(pack, built, raw.band, Float32Array.from(pts));
        const Atlas = root.RRCharacterAtlas || require('./CharacterAtlas.js');
        const look = { color: item.color, buckle: item.color2, material: item.material };
        const key = JSON.stringify(['belt', look]);
        const store = cache.shoes || (cache.shoes = new Map());
        let picture = store.get(key);
        if (!picture) { picture = Object.assign(Atlas.beltPicture(look, 1024), { name: 'belt.png' }); store.set(key, picture); }
        const [roughness, metalness] = MATERIAL[item.material] || MATERIAL.cloth;
        return {
            part: { name: g.label, positions: made.positions, normals: made.normals, uvs: made.uvs, index: made.index, joints: made.joints, weights: made.weights, source: made.source,
                texture: 'belt.png', roughness, metalness },
            texture: picture, cover: made.cover
        };
    }

    function cutSettings(item) {
        const out = {};
        for (const k of ['sleeves', 'length', 'fit', 'flare', 'bell', 'open', 'face', 'bulk', 'neckline', 'slits']) if (item[k] != null) out[k] = typeof item[k] === 'number' ? Math.round(item[k] * 100) / 100 : item[k];
        return out;
    }

    /** A piece split into plates: gaps across a chain at even steps. */
    function bandedValue(spec, O) {
        const inner = spec.value;
        return (an, v) => {
            let c = inner ? inner(an, v) : O.coverage(an, v, spec.rules);
            for (const key in spec.bands) {
                const [from, to, count, gap] = spec.bands[key];
                const fams = key === 'spine' ? [0] : key === 'arms' ? [1, 2] : key === 'legs' ? [3, 4] : [];
                if (key === 'skirt') {
                    const u = an.skirtU[v];
                    if (u > from && u < to) {
                        const x = (u - from) / (to - from) * count, f = x - Math.floor(x);
                        c = Math.min(c, (Math.min(f, 1 - f) - gap * count / (to - from) / 2) * 0.5);
                    }
                    continue;
                }
                for (const fi of fams) {
                    if (an.member[v * 5 + fi] < 0.5) continue;
                    const sv = an.s[v * 5 + fi];
                    if (sv <= from || sv >= to) continue;
                    const x = (sv - from) / (to - from) * count, f = x - Math.floor(x);
                    if (Math.floor(x) === 0 && f < 0.5) continue;
                    c = Math.min(c, (Math.min(f, 1 - f) * (to - from) / count - gap / 2) * 2);
                }
            }
            return c;
        };
    }

    /**
     * The skin a piece covers. A piece with an opening that is looked into (`hideMargin`) leaves the
     * skin a little way in under its edge, measured on the coverage smoothed over the skin as the
     * piece's own cut is over its surface.
     */
    function markCovered(pack, O, spec, covered) {
        const an = O.anatomy(pack);
        const ids = pack._bodyIds || (pack._bodyIds = [...new Set(pack.body.source)]);
        const raw = new Float32Array(pack.vertexCount).fill(-1);
        for (const v of ids) raw[v] = spec.value ? spec.value(an, v) : O.coverage(an, v, spec.rules);
        const eased = spec.hideMargin ? O.relaxScalar(pack.body, raw, (spec.smoothCut ?? 3) + 2) : raw;
        for (const v of ids) {
            const c = Math.min(raw[v], eased[v]) - (spec.hideMargin || 0);
            if (c > covered[v]) covered[v] = c;
        }
    }

    /**
     * A preset's garments for a body: a woman dressed in a set that leaves the
     * chest bare (a barbarian's, a gladiator's) gets a cropped leather top.
     */
    const CHEST = new Set(['top', 'dress', 'armor', 'under']);
    function dressFor(items, female) {
        if (!female || items.some(i => CHEST.has((BY_ID.get(i.id) || {}).slot))) return items;
        return items.concat([{ id: 'tanktop', color: '#5a3d22', material: 'leather', length: 0.32 }]);
    }

    const api = { GARMENTS, BY_ID, SLOTS, PRESETS, PATTERNS, NECKLINE_CHOICES, MATERIAL, normalizeItem, normalizeOutfit, dressFor, build };
    root.RRCharacterWardrobe = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

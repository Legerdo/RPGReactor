/**
 * RRCreatureGear - what a four-legged creature wears: collars, harness,
 * saddle and blanket, bridle and reins, cloth caparison or plate barding,
 * saddlebags, horseshoes or leg wraps, a cape, a crown or headdress.
 *
 * Each piece is fitted to the creature it is built on, the way its body is
 * built: rays from inside the body (from a bone's line, across the neck,
 * over the back) find the body's surface, and the piece is a shell laid a
 * little off it, so a collar closes round that neck and a caparison drapes
 * over that back and falls straight from its widest. Pieces are skinned
 * with the body's own rule (the bones whose shapes lie nearest), so they
 * follow the Idle and walk.
 *
 * A recipe holds `gear: [{ id, color, color2, material }]`, one piece a
 * slot. Parts come out grouped by material: cloth and leather are kind
 * 'cloth', metal and gold kind 'metal'.
 *
 * No DOM and no three.js: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
    const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    const DEG = Math.PI / 180;
    const HEX = /^#[0-9a-f]{6}$/i;
    const hexRgb = hex => { const n = parseInt(String(hex || '#888888').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    // ── catalog ────────────────────────────────────────────────────────────
    const MATERIALS = [
        { id: 'cloth', label: 'Cloth', kind: 'cloth', roughness: 0.85, metalness: 0 },
        { id: 'leather', label: 'Leather', kind: 'cloth', roughness: 0.6, metalness: 0 },
        { id: 'metal', label: 'Metal', kind: 'metal', roughness: 0.35, metalness: 0.9 },
        { id: 'gold', label: 'Gold', kind: 'metal', roughness: 0.3, metalness: 1 }
    ];
    const MATERIAL_BY_ID = new Map(MATERIALS.map(m => [m.id, m]));

    /**
     * The pieces: `slot` (one piece a slot), `group` (where the picker lists
     * it), `defaults` (color, color2, material), `materials` (what it may be
     * made of), `fits` (feet it suits: a hooved animal for bridle and shoes;
     * omitted, any).
     */
    const ITEMS = [
        { id: 'collar', label: 'Collar', group: 'Collars', slot: 'neck', materials: ['leather', 'cloth', 'metal', 'gold'], defaults: { color: '#8a2a22', color2: '#c8b070', material: 'leather' } },
        { id: 'collarTag', label: 'Collar with tag', group: 'Collars', slot: 'neck', materials: ['leather', 'cloth', 'metal', 'gold'], defaults: { color: '#2a5a9a', color2: '#d8c070', material: 'leather' } },
        { id: 'spikedCollar', label: 'Spiked collar', group: 'Collars', slot: 'neck', materials: ['leather', 'metal'], defaults: { color: '#1e1a18', color2: '#b8bcc4', material: 'leather' } },
        { id: 'harness', label: 'Harness', group: 'Tack', slot: 'harness', materials: ['leather', 'cloth'], defaults: { color: '#5a3a22', color2: '#b8bcc4', material: 'leather' } },
        { id: 'saddle', label: 'Saddle', group: 'Tack', slot: 'saddle', materials: ['leather', 'cloth'], defaults: { color: '#6a4026', color2: '#8a2a2a', material: 'leather' } },
        { id: 'bridle', label: 'Bridle and reins', group: 'Tack', slot: 'head', fits: ['hoof'], materials: ['leather', 'cloth'], defaults: { color: '#4a2e1c', color2: '#c0c4cc', material: 'leather' } },
        { id: 'caparison', label: 'Caparison', group: 'Barding', slot: 'barding', materials: ['cloth'], defaults: { color: '#2a3e7a', color2: '#d8b850', material: 'cloth' } },
        { id: 'plateBarding', label: 'Plate barding', group: 'Barding', slot: 'barding', materials: ['metal', 'gold'], defaults: { color: '#9aa0a8', color2: '#c8a040', material: 'metal' } },
        { id: 'saddlebags', label: 'Saddlebags', group: 'Packs', slot: 'bags', materials: ['leather', 'cloth'], defaults: { color: '#7a5a38', color2: '#4a3222', material: 'leather' } },
        { id: 'horseshoes', label: 'Horseshoes', group: 'Legs', slot: 'feet', fits: ['hoof'], materials: ['metal', 'gold'], defaults: { color: '#8a8e96', color2: '#8a8e96', material: 'metal' } },
        { id: 'legWraps', label: 'Leg wraps', group: 'Legs', slot: 'feet', materials: ['cloth', 'leather'], defaults: { color: '#e8e2d4', color2: '#b8b0a0', material: 'cloth' } },
        { id: 'cape', label: 'Cape', group: 'Regalia', slot: 'cape', materials: ['cloth'], defaults: { color: '#7a1e2a', color2: '#d8b850', material: 'cloth' } },
        { id: 'crown', label: 'Crown', group: 'Regalia', slot: 'crown', materials: ['gold', 'metal'], defaults: { color: '#d4af37', color2: '#b0202a', material: 'gold' } },
        { id: 'headdress', label: 'Headdress', group: 'Regalia', slot: 'crown', materials: ['cloth', 'metal', 'gold'], defaults: { color: '#c8282a', color2: '#d4af37', material: 'cloth' } }
    ];
    const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]));
    const GROUPS = [...new Set(ITEMS.map(i => i.group))];

    const PRESETS = [
        { id: 'pet', label: 'Pet', items: [{ id: 'collarTag' }] },
        { id: 'mount', label: 'Mount', items: [{ id: 'bridle' }, { id: 'saddle' }, { id: 'horseshoes' }] },
        { id: 'war', label: 'War beast', items: [{ id: 'plateBarding' }, { id: 'spikedCollar', material: 'metal', color: '#6a6e76' }, { id: 'saddle', color: '#3a2a20', color2: '#5a1a1a' }, { id: 'bridle', color: '#2a1e18' }, { id: 'horseshoes' }] },
        { id: 'royal', label: 'Royal', items: [{ id: 'caparison', color: '#5a1a6a', color2: '#d8b850' }, { id: 'crown' }, { id: 'bridle', color: '#5a1a6a', color2: '#d4af37' }, { id: 'collar', material: 'gold', color: '#d4af37', color2: '#b0202a' }] },
        { id: 'pack', label: 'Pack animal', items: [{ id: 'harness' }, { id: 'saddlebags' }, { id: 'legWraps', color: '#a89a80' }] }
    ];

    /** Whether a piece suits a creature (its feet); a piece without `fits` suits any. */
    function fits(id, recipe) {
        const item = ITEM_BY_ID.get(id);
        if (!item) return false;
        return !item.fits || item.fits.includes((recipe && recipe.feet) || 'paw');
    }

    /** A gear list from a partial one: known pieces, one a slot (the last wins), each color and material set. */
    function normalizeGear(list) {
        const bySlot = new Map();
        for (const g of Array.isArray(list) ? list : []) {
            const item = g && ITEM_BY_ID.get(g.id);
            if (!item) continue;
            const d = item.defaults;
            bySlot.set(item.slot, {
                id: item.id,
                color: HEX.test(g.color || '') ? g.color.toLowerCase() : d.color,
                color2: HEX.test(g.color2 || '') ? g.color2.toLowerCase() : d.color2,
                material: item.materials.includes(g.material) ? g.material : d.material
            });
        }
        // In catalog order, so a list reads the same however it was put together.
        return ITEMS.map(i => [...bySlot.values()].find(g => g.id === i.id)).filter(Boolean);
    }

    /** A preset's gear list. */
    function presetGear(id) {
        const p = PRESETS.find(x => x.id === id);
        return p ? normalizeGear(p.items) : [];
    }

    // ── fitting ────────────────────────────────────────────────────────────
    /**
     * The builder for one creature. `ctx`: { r, lay, inside(p) → field value
     * (negative inside the body), insideHead(p) (the same for the head alone), skin(p) → [joints4, weights4], loft, curve }.
     * Pieces are written into per-material buckets of positions, index,
     * colors, joints and weights, in body units.
     */
    function fitter(ctx, shared) {
        const buckets = shared || new Map();
        const bucket = material => {
            if (!buckets.has(material)) buckets.set(material, { positions: [], index: [], colors: [], joints: [], weights: [] });
            return buckets.get(material);
        };
        const g = ctx.lay.g;
        /** Where a ray from `from` along `dir` leaves the body, with the surface's normal there; null if it never does. */
        const surface = (from, dir, maxLen) => {
            const d = norm(dir), step = 0.006 * g, n = Math.ceil((maxLen || 1.2 * g) / step);
            let prev = ctx.inside(from);
            if (prev > 0) return { p: from.slice(), n: d };
            for (let i = 1; i <= n; i++) {
                const p = add(from, mul(d, i * step));
                const v = ctx.inside(p);
                if (v > 0) {
                    // Between the last step inside and this one outside.
                    let a = (i - 1) * step, b = i * step;
                    for (let k = 0; k < 6; k++) {
                        const m = (a + b) / 2;
                        if (ctx.inside(add(from, mul(d, m))) > 0) b = m; else a = m;
                    }
                    const q = add(from, mul(d, b));
                    const h = 0.004 * g;
                    const gr = [0, 1, 2].map(k => { const e = [0, 0, 0]; e[k] = h; return ctx.inside(add(q, e)) - ctx.inside(sub(q, e)); });
                    const nn = len(gr) > 1e-9 ? norm(gr) : d;
                    return { p: q, n: nn };
                }
                prev = v;
            }
            return null;
        };
        /** A thick shell over a grid of surface points (rows × cols, each { p, n }), closed round its columns if `wrap`. */
        const shell = (grid, gap, thick, material, colorAt, wrap) => {
            const B = bucket(material);
            const rows = grid.length, cols = grid[0].length;
            const base = B.positions.length / 3;
            const at = (i, j, layer) => base + ((i * cols + j) * 2 + layer);
            for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
                const s = grid[i][j];
                const outer = add(s.p, mul(s.n, gap + thick)), inner = add(s.p, mul(s.n, gap));
                const c = colorAt(i, j, s);
                const [jo, we] = ctx.skin(s.p);
                for (const q of [outer, inner]) { B.positions.push(q[0], q[1], q[2]); B.colors.push(c[0], c[1], c[2]); B.joints.push(...jo); B.weights.push(...we); }
            }
            const P = k => [B.positions[k * 3], B.positions[k * 3 + 1], B.positions[k * 3 + 2]];
            // A quad facing `want` (or away from the body for an outer face).
            const quad = (a, b, c, d, want) => {
                const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
                if (dot(n, want) >= 0) B.index.push(a, b, c, a, c, d); else B.index.push(a, c, b, a, d, c);
            };
            const outward = (i, j) => grid[i][j].n;
            const jEnd = wrap ? cols : cols - 1;
            for (let i = 0; i + 1 < rows; i++) for (let j = 0; j < jEnd; j++) {
                const j1 = (j + 1) % cols, n = outward(i, j);
                quad(at(i, j, 0), at(i + 1, j, 0), at(i + 1, j1, 0), at(i, j1, 0), n);
                quad(at(i, j, 1), at(i, j1, 1), at(i + 1, j1, 1), at(i + 1, j, 1), mul(n, -1));
            }
            // The edges: the first and last rows, and the first and last columns of an open shell.
            const edge = (a0, a1, b0, b1, want) => quad(a0, b0, b1, a1, want);
            for (let j = 0; j < jEnd; j++) {
                const j1 = (j + 1) % cols;
                const down = norm(sub(grid[0][j].p, grid[Math.min(1, rows - 1)][j].p)), up = norm(sub(grid[rows - 1][j].p, grid[Math.max(0, rows - 2)][j].p));
                edge(at(0, j, 0), at(0, j, 1), at(0, j1, 0), at(0, j1, 1), down);
                edge(at(rows - 1, j, 0), at(rows - 1, j, 1), at(rows - 1, j1, 0), at(rows - 1, j1, 1), up);
            }
            if (!wrap) for (let i = 0; i + 1 < rows; i++) {
                const left = norm(sub(grid[i][0].p, grid[i][1].p)), right = norm(sub(grid[i][cols - 1].p, grid[i][cols - 2].p));
                edge(at(i, 0, 0), at(i, 0, 1), at(i + 1, 0, 0), at(i + 1, 0, 1), left);
                edge(at(i, cols - 1, 0), at(i, cols - 1, 1), at(i + 1, cols - 1, 0), at(i + 1, cols - 1, 1), right);
            }
        };
        /** A lofted tube (reins, spikes, a plume), skinned at each ring's middle. */
        const tube = (pts, radius, sides, material, colorAt, cap) => {
            const m = ctx.loft(pts, radius, sides, null, cap);
            const B = bucket(material);
            const base = B.positions.length / 3;
            for (let i = 0; i < m.positions.length / 3; i++) {
                const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
                B.positions.push(p[0], p[1], p[2]);
                const c = colorAt(m.t[i]);
                B.colors.push(c[0], c[1], c[2]);
                const anchor = pts[Math.round(m.t[i] * (pts.length - 1))];
                const [jo, we] = ctx.skin(anchor);
                B.joints.push(...jo); B.weights.push(...we);
            }
            for (const q of m.index) B.index.push(q + base);
        };
        /** Surface points round `axis` through `center`, from angle a0 to a1 (0 along `ref`), `count` of them. */
        const ring = (center, axis, ref, a0, a1, count) => {
            const ax = norm(axis), r0 = norm(sub(ref, mul(ax, dot(ref, ax)))), r1 = cross(ax, r0);
            const out = [];
            for (let k = 0; k < count; k++) {
                const a = a0 + (a1 - a0) * k / (count - (a1 - a0 >= 2 * Math.PI - 1e-6 ? 0 : 1));
                const dir = add(mul(r0, Math.cos(a)), mul(r1, Math.sin(a)));
                out.push(surface(center, dir) || { p: add(center, mul(dir, 0.1 * g)), n: dir });
            }
            return out;
        };
        /** A band round the body: rings either side of `center` along `axis`, `width` apart. */
        const band = (center, axis, ref, width, gap, thick, material, colorAt, a0 = 0, a1 = 2 * Math.PI, count = 36) => {
            const ax = norm(axis), full = a1 - a0 >= 2 * Math.PI - 1e-6;
            const rows = [];
            for (const t of [-0.5, 0, 0.5]) rows.push(ring(add(center, mul(ax, t * width)), ax, ref, a0, a1, count));
            shell(rows, gap, thick, material, colorAt, full);
            return rows[1];
        };
        return { buckets, surface, shell, tube, ring, band };
    }

    /** The colors of a piece: its own, its second, a darker edge. */
    function paints(item) {
        const c1 = hexRgb(item.color), c2 = hexRgb(item.color2);
        return { c1, c2, dark: mul(c1, 0.65), edge: mixRgb(c1, c2, 0.5) };
    }

    /**
     * Every piece of `gear` fitted to the creature. Returns parts (body units,
     * scaled and placed by the caller): { name, material, positions, index,
     * colors (sRGB), joints, weights, kind, roughness, metalness }.
     */
    function build(gear, ctx) {
        const list = normalizeGear(gear);
        if (!list.length) return [];
        const F = fitter(ctx);
        const { lay, r } = ctx;
        const { J, H, sr, hd, hu, zS, zH, yS, yH, g, chestTop, chestBottom } = lay;
        const gap = 0.004 * g;
        const second = item => (item.material === 'gold' || item.material === 'metal') ? item.material : 'metal';
        for (const item of list) {
            const P = paints(item);
            const main = item.material;
            const neckAxis = norm(sub(J.atlas, J.neck));
            const midY = z => z > zS - 0.3 ? (chestTop + chestBottom) / 2 : z < zH + 0.2 ? yH + 0.18 * g : lerp([0, yH + 0.18 * g, 0], [0, (chestTop + chestBottom) / 2, 0], (z - zH - 0.2) / (zS - zH - 0.5))[1];
            /** A drape over the back from z0 to z1, down each side from the spine to `drop` (radians from the top), falling straight from its widest to `hem`. */
            const drape = (z0, z1, rows, drop, cols, hem, thick, colorAt, lift) => {
                const grid = [];
                for (let i = 0; i < rows; i++) {
                    const z = z0 + (z1 - z0) * i / (rows - 1);
                    const c = [0, midY(z), z];
                    const row = [];
                    let widest = null;
                    for (let j = 0; j < cols; j++) {
                        const a = -drop + 2 * drop * j / (cols - 1);
                        const side = Math.sign(a) || 1, aa = Math.abs(a);
                        let s;
                        if (aa <= Math.PI / 2 || hem == null) s = F.surface(c, [Math.sin(a), Math.cos(a), 0]);
                        if (!s && widest) s = widest;
                        if (!s) s = { p: add(c, [Math.sin(a) * 0.2 * g, Math.cos(a) * 0.2 * g, 0]), n: [Math.sin(a), Math.cos(a), 0] };
                        if (aa > Math.PI / 2 && hem != null) {
                            // Past the widest the cloth hangs: straight down to the hem, a little flared.
                            const top = F.surface(c, [side, 0, 0]) || s;
                            const f = (aa - Math.PI / 2) / (drop - Math.PI / 2 || 1);
                            const y = top.p[1] + (hem - top.p[1]) * f;
                            s = { p: [top.p[0] + side * 0.01 * g * f, y, top.p[2]], n: [side, 0, 0] };
                        } else if (aa > Math.PI / 2 - 0.2) widest = s;
                        if (lift) s = { p: add(s.p, mul(s.n, lift(i / (rows - 1), j / (cols - 1)))), n: s.n };
                        row.push(s);
                    }
                    grid.push(row);
                }
                F.shell(grid, gap, thick, main, colorAt, false);
                return grid;
            };
            const trimAt = (rows, cols, w) => (i, j) => (i < w || i >= rows - w || j < w || j >= cols - w ? P.c2 : P.c1);
            if (item.id === 'collar' || item.id === 'collarTag' || item.id === 'spikedCollar') {
                const at = lerp(J.neck, J.atlas, 0.62);
                const width = 0.045 * g * r.neckThickness;
                const mid = F.band(at, neckAxis, [0, -1, 0], width, gap, 0.011 * g, main, () => P.c1);
                // The buckle at the side, a ring at the throat.
                const side = mid[Math.round(mid.length / 4)];
                F.band(add(side.p, mul(side.n, 0.01 * g)), side.n, neckAxis, 0.012 * g, 0, 0.012 * g, second(item), () => P.c2, 0, 2 * Math.PI, 8);
                const throat = mid[0];
                const ringC = add(throat.p, add(mul(throat.n, 0.018 * g), [0, -0.012 * g, 0]));
                const circle = [];
                for (let k = 0; k <= 10; k++) { const a = k / 10 * Math.PI * 2; circle.push(add(ringC, add(mul(neckAxis, Math.cos(a) * 0.012 * g), [0, Math.sin(a) * 0.012 * g, 0]))); }
                F.tube(circle, () => [0.0025 * g, 0.0025 * g], 6, second(item), () => P.c2, false);
                if (item.id === 'collarTag') {
                    // A round tag hanging from the ring.
                    const tc = add(ringC, [0, -0.03 * g, 0]);
                    const disc = [add(tc, mul(throat.n, -0.002 * g)), add(tc, mul(throat.n, 0.002 * g))];
                    F.tube(disc, () => [0.016 * g, 0.016 * g], 14, item.material === 'gold' ? 'gold' : 'metal', () => P.c2, true);
                }
                if (item.id === 'spikedCollar') {
                    for (let k = 0; k < mid.length; k += 3) {
                        const s = mid[k];
                        const b = add(s.p, mul(s.n, gap + 0.01 * g));
                        F.tube([b, add(b, mul(s.n, 0.02 * g)), add(b, mul(s.n, 0.04 * g))], t => { const v = 0.009 * g * (1 - t) + 0.0005; return [v, v]; }, 6, second(item), () => P.c2, true);
                    }
                }
            } else if (item.id === 'harness') {
                // A girth round the chest behind the elbows, a breast strap across the chest's front, a strap along the back between them.
                const zG = zS - 0.2;
                F.band([0, (chestTop + chestBottom) / 2, zG], [0, 0, 1], [0, 1, 0], 0.05 * g, gap, 0.01 * g, main, () => P.c1);
                const bc = [0, yS - 0.02 * g, zS - 0.15];
                F.band(bc, norm([0, 1, 0.35]), [0, 0, 1], 0.045 * g, gap, 0.01 * g, main, () => P.c1, -100 * DEG, 100 * DEG, 30);
                const top = F.surface([0, (chestTop + chestBottom) / 2, zG], [0, 1, 0]);
                if (top) F.band(add(top.p, mul(top.n, 0.02 * g)), [1, 0, 0], [0, 0, 1], 0.02 * g, 0, 0.008 * g, second(item), () => P.c2, 0, 2 * Math.PI, 10);
                const rows = [];
                for (let i = 0; i < 8; i++) {
                    const z = zG - 0.02 + (zH + 0.25 - zG) * i / 7;
                    const c = [0, midY(z), z];
                    rows.push([-1, 0, 1].map(k => F.surface(c, [k * 0.08, 1, 0]) || { p: add(c, [0, 0.2 * g, 0]), n: [0, 1, 0] }));
                }
                F.shell(rows, gap, 0.009 * g, main, () => P.c1, false);
                // A crupper loop under the tail's root.
                F.band([0, yH + 0.2 * g, zH - 0.05], norm([0, 0.3, -1]), [0, -1, 0], 0.035 * g, gap, 0.009 * g, main, () => P.c1, -140 * DEG, 140 * DEG, 24);
            } else if (item.id === 'saddle') {
                const z0 = zS - 0.08, z1 = zS - 0.62;
                // The blanket under it, its edge in the second color.
                drape(z0, z1, 12, 72 * DEG, 17, null, 0.008 * g, (i, j) => (i === 0 || i === 11 || j === 0 || j === 16 ? mixRgb(P.c2, [1, 0.95, 0.8], 0.35) : P.c2));
                // The seat: a shell with the pommel raised in front and the cantle behind.
                const s0 = zS - 0.16, s1 = zS - 0.52;
                drape(s0, s1, 12, 46 * DEG, 13, null, 0.022 * g, (i, j) => (i < 1 || i > 10 ? P.dark : P.c1), (u, v) => 0.012 * g + 0.05 * g * (smooth(0.25, 0, u) * 0.8 + smooth(0.75, 1, u)) * (1 - Math.abs(v - 0.5) * 1.6));
                // The girth, stirrup leathers and stirrups.
                const zg = (s0 + s1) / 2;
                F.band([0, midY(zg), zg], [0, 0, 1], [0, 1, 0], 0.04 * g, gap * 2.5, 0.009 * g, main, () => P.dark);
                for (const side of [1, -1]) {
                    const at = F.surface([0, midY(zg), zg + 0.04], [side, 0.35, 0]);
                    if (!at) continue;
                    const top = add(at.p, mul(at.n, 0.03 * g));
                    const bottom = [top[0] + side * 0.02 * g, chestBottom - 0.04 * g, top[2]];
                    F.tube([top, lerp(top, bottom, 0.5), bottom], () => [0.012 * g, 0.003 * g], 4, main, () => P.dark, false);
                    const ringPts = [];
                    for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 2; ringPts.push(add(bottom, [0, -0.025 * g + Math.cos(a) * 0.025 * g, Math.sin(a) * 0.03 * g])); }
                    F.tube(ringPts, () => [0.004 * g, 0.004 * g], 6, 'metal', () => hexRgb('#a8adb3'), false);
                }
            } else if (item.id === 'bridle') {
                const { z0, zt } = J.mouth;
                // The crownpiece over the poll behind the ears, down to the cheeks; the throatlatch from its ends
                // under the jaw; the noseband; the cheek straps from the poll down to the bit.
                const crownC = H(0, -0.05, -0.4), noseC = H(0, -0.15, z0 + 0.35 * (zt - z0)), bitIn = H(0, -0.42, z0 + 0.2);
                // Fitted to the head: on the body only where it lies close over the head, so on a short
                // thick neck no strap lands on the hump behind.
                const near = 0.3 * sr;
                const onHead = ctx.insideHead ? p => { const h = ctx.insideHead(p); return Math.min(h, Math.max(ctx.inside(p), h - near)); } : ctx.inside;
                const FH = fitter(Object.assign({}, ctx, { inside: onHead }), F.buckets);
                const poll = norm(add(hd, neckAxis));
                const crown = FH.band(crownC, poll, [0, -1, 0], 0.03 * g, gap, 0.008 * g, main, () => P.c1, Math.PI / 2 - 0.45, 1.5 * Math.PI + 0.45, 18);
                const jaw = FH.surface(lerp(crownC, bitIn, 0.3), mul(hu, -1));
                if (jaw) {
                    const under = add(jaw.p, add(mul(jaw.n, 0.012 * g), mul(hd, -0.03 * g)));
                    const ends = [crown[0], crown[crown.length - 1]].map(e => add(e.p, mul(e.n, gap + 0.004 * g)));
                    F.tube(ctx.curve([ends[0], under, ends[1]], 16), () => [0.007 * g, 0.0025 * g], 4, main, () => P.c1, false);
                }
                FH.band(noseC, hd, mul(hu, -1), 0.03 * g, gap, 0.008 * g, main, () => P.c1);
                FH.band(H(0, -0.05, -0.16), hd, hu, 0.022 * g, gap, 0.006 * g, main, () => P.c2, -78 * DEG, 78 * DEG, 14);
                for (const side of [1, -1]) {
                    const rows = [];
                    for (let i = 0; i < 8; i++) {
                        const t = i / 7, c = lerp(crownC, bitIn, t);
                        const dir = [side, -0.1, 0];
                        rows.push([-0.012, 0.012].map(dz => FH.surface(add(c, mul(hd, dz * g)), dir) || { p: add(c, [side * 0.1 * g, 0, 0]), n: [side, 0, 0] }));
                    }
                    FH.shell(rows, gap, 0.007 * g, main, () => P.c1, false);
                    // The bit's rings at the mouth's corners, and the reins from them back to the withers.
                    const corner = FH.surface(bitIn, [side, 0, 0]);
                    const bitC = corner ? add(corner.p, [side * 0.012 * g, 0, 0]) : H(side * 0.5, -0.42, z0 + 0.2);
                    const circle = [];
                    for (let k = 0; k <= 12; k++) { const a = k / 12 * Math.PI * 2; circle.push(add(bitC, add(mul(hd, Math.cos(a) * 0.02 * g), mul(hu, Math.sin(a) * 0.02 * g)))); }
                    F.tube(circle, () => [0.003 * g, 0.003 * g], 6, 'metal', () => P.c2, false);
                    const withers = add(J.withers, [side * 0.06 * g, 0.03 * g, 0.06]);
                    const sag = add(lerp(bitC, withers, 0.5), [side * 0.03 * g, -0.12 * g, 0]);
                    F.tube(ctx.curve([bitC, sag, withers], 14), () => [0.008 * g, 0.0025 * g], 4, main, () => P.c1, false);
                }
            } else if (item.id === 'caparison') {
                // From the neck's root to the croup, down the sides to the knees, its edge trimmed.
                const hem = Math.max(J.frontKnee[1] * 0.75, 0.15);
                const rows = 16, cols = 25;
                drape(zS + 0.05, zH - 0.28, rows, 150 * DEG, cols, hem, 0.007 * g, (i, j, s) => {
                    const edge = i === 0 || i === rows - 1 || s.p[1] < hem + 0.035 * g;
                    return edge ? P.c2 : (Math.abs(j - (cols - 1) / 2) === 6 ? mixRgb(P.c1, P.c2, 0.6) : P.c1);
                });
                // Its hood over the neck.
                const nRows = [];
                for (let i = 0; i < 8; i++) {
                    const c = lerp(add(J.neck, [0, 0.05 * g, -0.02]), lerp(J.neck, J.atlas, 0.85), i / 7);
                    nRows.push(F.ring(c, neckAxis, [0, 1, 0], -110 * DEG, 110 * DEG, 17));
                }
                F.shell(nRows, gap * 2, 0.007 * g, main, (i, j) => (j === 0 || j === 16 || i === 7 ? P.c2 : P.c1), false);
            } else if (item.id === 'plateBarding') {
                const plate = (rows, cols) => (i, j) => ((i % 3 === 2) ? mul(P.c1, 0.72) : (j === 0 || j === cols - 1 || i === 0 || i === rows - 1) ? P.c2 : P.c1);
                // Crupper over the rump, flanchards down the flanks, peytral across the chest, crinet over the neck, chanfron down the face.
                drape(zH + 0.3, zH - 0.26, 10, 120 * DEG, 19, Math.max(J.rearKnee[1] * 1.05, 0.2), 0.012 * g, plate(10, 19));
                const pRows = [];
                for (let i = 0; i < 8; i++) {
                    const y = yS - 0.22 * g * r.chestDepth + 0.42 * g * i / 7;
                    pRows.push(F.ring([0, y, zS - 0.25], [0, 1, 0], [0, 0, 1], -85 * DEG, 85 * DEG, 17));
                }
                F.shell(pRows, gap * 2, 0.012 * g, main, plate(8, 17), false);
                const nRows = [];
                for (let i = 0; i < 9; i++) {
                    const c = lerp(add(J.neck, [0, 0.04 * g, -0.03]), lerp(J.neck, J.atlas, 0.95), i / 8);
                    nRows.push(F.ring(c, neckAxis, [0, 1, 0], -75 * DEG, 75 * DEG, 13));
                }
                F.shell(nRows, gap * 2, 0.012 * g, main, plate(9, 13), false);
                const { zt } = J.mouth;
                const fRows = [];
                for (let i = 0; i < 9; i++) {
                    const c = H(0, -0.1, -0.15 + (zt - 0.25 + 0.15) * i / 8);
                    fRows.push(F.ring(c, hd, hu, -58 * DEG, 58 * DEG, 11));
                }
                F.shell(fRows, gap * 2, 0.01 * g, main, plate(9, 11), false);
                // A spike on the brow.
                const brow = F.surface(H(0, 0.1, 0.4), hu);
                if (brow) F.tube([add(brow.p, mul(brow.n, 0.01 * g)), add(brow.p, add(mul(brow.n, 0.05 * g), mul(hd, 0.03 * g))), add(brow.p, add(mul(brow.n, 0.1 * g), mul(hd, 0.07 * g)))], t => { const v = 0.018 * g * (1 - t) + 0.001; return [v, v]; }, 8, main, () => P.c2, true);
            } else if (item.id === 'saddlebags') {
                // Two bags hung either side behind the saddle, on a strap over the back.
                const zb = zS - 0.66;
                drape(zb + 0.05, zb - 0.05, 3, 95 * DEG, 13, null, 0.008 * g, () => P.c2);
                for (const side of [1, -1]) {
                    const at = F.surface([0, midY(zb), zb], [side, 0.25, 0]);
                    if (!at) continue;
                    const c = add(at.p, [side * 0.07 * g, -0.12 * g, 0]);
                    const grid = [];
                    const sx = 0.06 * g, sy = 0.13 * g, sz = 0.18;
                    // A rounded box as a superellipsoid of 7 × 12.
                    for (let i = 0; i <= 6; i++) {
                        const th = -Math.PI / 2 + Math.PI * i / 6;
                        const row = [];
                        for (let j = 0; j < 12; j++) {
                            const ph = j / 12 * Math.PI * 2;
                            const sp = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
                            const ct = sp(Math.cos(th), 0.4), st = sp(Math.sin(th), 0.4), cp = sp(Math.cos(ph), 0.4), spp = sp(Math.sin(ph), 0.4);
                            const p = add(c, [sx * ct * cp, sy * st, sz * ct * spp]);
                            row.push({ p, n: norm([ct * cp / sx, st / sy, ct * spp / sz]) });
                        }
                        grid.push(row);
                    }
                    F.shell(grid, 0, 0.004 * g, main, (i) => (i === 5 ? P.c2 : P.c1), true);
                    // The flap's buckle.
                    const bk = add(c, [side * (sx + 0.004 * g), sy * 0.3, 0]);
                    F.tube([sub(bk, [side * 0.002 * g, 0, 0]), add(bk, [side * 0.004 * g, 0, 0])], () => [0.012 * g, 0.012 * g], 6, 'metal', () => hexRgb('#b8bcc4'), true);
                }
            } else if (item.id === 'horseshoes' || item.id === 'legWraps') {
                const shoes = item.id === 'horseshoes';
                for (const front of [true, false]) for (const side of [1, -1]) {
                    const ankle = front ? J.frontAnkle : J.rearAnkle;
                    const x = side * ankle[0];
                    if (shoes) {
                        const toe = front ? J.frontToe : J.rearToe;
                        const c = [x, 0.012 * g, (ankle[2] + toe[2]) / 2 + 0.035];
                        F.band(c, [0, 1, 0], [0, 0, 1], 0.014 * g, 0.002 * g, 0.008 * g, main, () => P.c1, -150 * DEG, 150 * DEG, 20);
                    } else {
                        // Wrapped up from the fetlock or paw to below the knee or hock, in overlapping turns.
                        const y0 = r.feet === 'hoof' ? ankle[1] * 0.28 : ankle[1] * 0.4, y1 = ankle[1] * (front ? 1.45 : 1.25);
                        const rows = [];
                        for (let i = 0; i < 9; i++) {
                            const y = y0 + (y1 - y0) * i / 8;
                            const c = [x, y, ankle[2] + (r.feet === 'hoof' ? 0.012 : 0)];
                            rows.push(F.ring(c, [0, 1, 0], [0, 0, 1], 0, 2 * Math.PI, 16));
                        }
                        F.shell(rows, gap, 0.008 * g, main, i => (i % 2 ? P.c1 : mixRgb(P.c1, P.c2, 0.5)), true);
                    }
                }
            } else if (item.id === 'cape') {
                // Over the withers and back, falling to mid-flank, its hem trimmed.
                const rows = 12, cols = 21;
                const hem = (chestTop + chestBottom) / 2 - 0.08 * g;
                drape(zS + 0.0, zH + 0.05, rows, 125 * DEG, cols, hem, 0.006 * g, (i, j) => (j <= 0 || j >= cols - 1 || i === rows - 1 ? P.c2 : P.c1));
                // The clasp at the front of the chest.
                const clasp = F.surface([0, yS + 0.1 * g, zS - 0.05], [0, 0.2, 1]);
                if (clasp) F.tube([clasp.p, add(clasp.p, mul(clasp.n, 0.01 * g))], () => [0.022 * g, 0.022 * g], 10, 'gold', () => hexRgb('#d4af37'), true);
            } else if (item.id === 'crown') {
                // A circlet round the top of the skull between the ears, its points up.
                const c = H(0, 0.62, -0.2);
                const mid = F.band(c, [0, 1, 0], [0, 0, 1], 0.05 * sr, gap, 0.012 * g, main, () => P.c1, 0, 2 * Math.PI, 24);
                for (let k = 0; k < mid.length; k += 3) {
                    const s = mid[k];
                    const b = add(add(s.p, mul(s.n, gap + 0.006 * g)), [0, 0.025 * sr, 0]);
                    F.tube([b, add(b, [0, 0.12 * sr, 0]), add(b, [0, 0.22 * sr, 0])], t => { const v = 0.035 * sr * (1 - t) + 0.001; return [v, v * 0.5]; }, 6, main, () => P.c1, true);
                    if (k % 6 === 0) F.tube([add(b, mul(s.n, 0.004 * g)), add(b, mul(s.n, 0.012 * g))], () => [0.018 * sr, 0.018 * sr], 8, 'cloth', () => P.c2, true);
                }
            } else if (item.id === 'headdress') {
                // A plume rising from a band behind the ears, leaning back.
                const c = H(0, 0.45, -0.25);
                F.band(c, hu, hd, 0.07 * sr, gap, 0.01 * g, second(item), () => P.c2, 0, 2 * Math.PI, 20);
                const b0 = add(H(0, 0.85, -0.2), [0, 0.01 * g, 0]);
                const path = ctx.curve([b0, add(b0, add(mul(hu, 0.6 * sr), mul(hd, -0.1 * sr))), add(b0, add(mul(hu, 1.1 * sr), mul(hd, -0.5 * sr))), add(b0, add(mul(hu, 1.3 * sr), mul(hd, -1.0 * sr)))], 16);
                F.tube(path, t => { const v = sr * (0.06 + 0.22 * Math.sin(Math.PI * clamp(t * 1.05, 0, 1)) * (1 - 0.3 * t)); return [v, v * 0.35]; }, 10, main, t => mixRgb(P.c1, P.c2, smooth(0.8, 1, t) * 0.5), true);
            }
        }
        const parts = [];
        for (const [material, b] of F.buckets) {
            if (!b.index.length) continue;
            const m = MATERIAL_BY_ID.get(material) || MATERIALS[0];
            parts.push(Object.assign({ name: 'Gear ' + m.id, material: m.id, kind: m.kind, roughness: m.roughness, metalness: m.metalness }, b));
        }
        return parts;
    }

    const api = { ITEMS, MATERIALS, GROUPS, PRESETS, fits, normalizeGear, presetGear, build };
    root.RRCreatureGear = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

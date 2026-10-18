/**
 * RRContainerProp - 3D Prop Builder › Containers: barrels and crates, old
 * and new. A wooden barrel (staves, iron hoops, a lid or an open top, upright
 * or on its side in a cradle), a steel drum (rolling ribs, bungs, dents), a
 * sci-fi canister (end caps, panel grooves, glowing bands, valves, a glowing
 * core), a wooden crate (planks, battens, braces, rope handles, stacks), a
 * chest (domed or flat lid, iron straps and corners, a lock, gold) and a
 * sci-fi cargo crate (seamed lid, panels, bumpers, latches, handles).
 *
 * Futuristic ones carry status lights, glowing strips and a display. Their
 * motion is baked into the file as the clip "Lights": each lit part sits on
 * a bone that holds it in place while it is on and moves it inside the
 * container (or shrinks it into its own axis) while it is off. A display's
 * frames are quads on two rows of bones, each frame half on one of each,
 * so only the frame whose two bones both rest stands at the screen. The
 * game plays the clip like any other; nothing runs but the clip.
 *
 * In tiles (one unit to a tile), standing on y = 0, centered on the origin,
 * the front facing +z.
 */
(function(root) {
    'use strict';

    const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
    const Paint = need('RRPropPaint', './PropPaint.js');
    const PropMesh = need('RRPropMesh', './PropMesh.js');
    const CP = need('RRContainerPaint', './ContainerPaint.js');
    const CM = need('RRContainerMesh', './ContainerMesh.js');
    const { sub, add, scale, norm, cross } = CM.vec;

    const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const text = (v, d, max) => (typeof v === 'string' ? v.slice(0, max || 40) : d);

    const FORMS = [['barrel', 'Wooden barrel'], ['drum', 'Steel drum'], ['canister', 'Sci-fi canister'], ['crate', 'Wooden crate'], ['chest', 'Chest'], ['cargo', 'Sci-fi cargo crate']];
    const FUTURE = new Set(['canister', 'cargo']);
    const ROUND = new Set(['barrel', 'drum', 'canister']);
    const PROPORTIONS = [['cube', 'Cube'], ['long', 'Long'], ['flat', 'Flat']];
    const RATIOS = { cube: [1, 1, 1], long: [1, 0.48, 0.52], flat: [1, 0.36, 0.68] };
    const TOPS = [['lid', 'Lid'], ['open', 'Open']];
    const CAPS = [['domed', 'Domed'], ['flat', 'Flat']];
    const BRACES = [['x', 'Cross'], ['diagonal', 'Diagonal'], ['none', 'None']];
    const LIDS = [['domed', 'Domed'], ['flat', 'Flat']];
    const FINISHES = [['natural', 'Bare wood'], ['painted', 'Painted']];
    const STACKS = [['one', 'One'], ['two', 'Two stacked'], ['three', 'Three stacked']];
    const MARK_STYLES = [['stencil', 'Stencil'], ['label', 'Printed label'], ['burned', 'Burned in']];
    const PATTERNS = [['steady', 'Steady'], ['blink', 'Blink'], ['pulse', 'Pulse'], ['chase', 'Chase']];
    /** The clip's length: every pattern repeats a whole number of times in it. */
    const LOOP = 8;
    const MAX_LIGHTS = 12;

    /** Size ranges per form: [height], [width]; crates and chests by their longest side. */
    const SIZES = {
        barrel: { height: [0.45, 1.5, 0.92], width: [0.3, 1.1, 0.66] },
        drum: { height: [0.4, 1.3, 0.88], width: [0.25, 0.9, 0.58] },
        canister: { height: [0.4, 1.8, 1.0], width: [0.2, 0.9, 0.44] },
        crate: { width: [0.3, 1.6, 0.8] },
        chest: { width: [0.4, 1.4, 0.86] },
        cargo: { width: [0.4, 2.0, 1.1] }
    };

    const DEFAULT = {
        kind: 'container', preset: 'barrel', form: 'barrel',
        height: 0.92, width: 0.66, proportions: 'cube',
        bulge: 0.55, hoops: 6, ribs: 2, top: 'lid', caps: 'domed', valves: true, core: false,
        brace: 'x', slats: false, handles: true, finish: 'natural',
        lid: 'domed', corners: true, lock: true, gold: false,
        bumpers: true, latches: true,
        lying: false, cradle: true, open: false, stack: 'one',
        color: '#8a5a32', trim: '#2b2a28', accent: '#c8501e',
        wear: 0.3,
        marks: { text: '', style: 'stencil', color: '#f2efe6', symbol: 'none', hazard: false, image: '' },
        lights: { count: 0, color: '#4dff7a', pattern: 'blink' },
        strips: { on: false, color: '#3ad0ff', pattern: 'steady' },
        display: { mode: 'none', text: 'CARGO 4417', style: 'led', color: '#ffb340', image: '' },
        seed: 7
    };

    /** The starting points, one per type in the Containers list. */
    const PRESETS = [
        { id: 'wine-barrel', label: 'Wine barrel', icon: 'barrel', keywords: 'cask wine oak keg cellar tavern', recipe: { form: 'barrel', height: 0.95, width: 0.72, bulge: 0.7, hoops: 6, lying: true, cradle: true, color: '#7a4428', trim: '#2a2725', wear: 0.25, marks: { text: 'VINO 1742', style: 'burned' } } },
        { id: 'barrel', label: 'Wooden barrel', icon: 'barrel', keywords: 'barrel keg oak water ale', recipe: { form: 'barrel', height: 0.92, width: 0.64, bulge: 0.5, hoops: 6, color: '#93673f', wear: 0.35 } },
        { id: 'oil-drum', label: 'Oil drum', icon: 'drum', keywords: 'drum oil steel 55 gallon fuel', recipe: { form: 'drum', color: '#1f4e8c', trim: '#7d8288', wear: 0.4, marks: { text: 'MOTOR OIL', style: 'label', color: '#1f4e8c' } } },
        { id: 'explosive-barrel', label: 'Explosive barrel', icon: 'drum', keywords: 'explosive red barrel hazard danger tnt drum', recipe: { form: 'drum', color: '#a3221b', trim: '#3a3a3a', wear: 0.45, marks: { text: 'EXPLOSIVE', style: 'stencil', color: '#f2efe6', symbol: 'explosive', hazard: true } } },
        { id: 'supply-crate', label: 'Supply crate', icon: 'crate', keywords: 'crate box wooden supplies shipping', recipe: { form: 'crate', width: 0.8, proportions: 'cube', brace: 'x', handles: true, color: '#a87c4c', trim: '#3a3632', wear: 0.3, marks: { text: 'SUPPLIES', style: 'stencil', color: '#1d1b19' } } },
        { id: 'ammo-box', label: 'Ammo crate', icon: 'crate', keywords: 'ammo ammunition military crate box army', recipe: { form: 'crate', width: 0.95, proportions: 'flat', brace: 'none', handles: true, finish: 'painted', color: '#4f5a33', trim: '#2f3324', wear: 0.4, marks: { text: '7.62MM AMMO', style: 'stencil', color: '#e8d27a' } } },
        { id: 'crate-stack', label: 'Crate stack', icon: 'crates', keywords: 'stack pile crates boxes warehouse dock', recipe: { form: 'crate', width: 0.7, proportions: 'cube', brace: 'diagonal', handles: false, stack: 'three', color: '#b08856', wear: 0.4, marks: { text: 'FRAGILE', style: 'stencil', color: '#7a1c16', symbol: 'arrows' } } },
        { id: 'treasure-chest', label: 'Treasure chest', icon: 'chest', keywords: 'chest treasure gold loot pirate trunk', recipe: { form: 'chest', width: 0.86, lid: 'domed', open: true, gold: true, corners: true, lock: true, color: '#6e4226', trim: '#b8892f', wear: 0.25 } },
        { id: 'cargo-crate', label: 'Sci-fi cargo crate', icon: 'cargo', keywords: 'cargo crate sci-fi space container future', recipe: { form: 'cargo', width: 1.1, proportions: 'long', color: '#d3d7db', trim: '#2a2e33', accent: '#f29a1f', wear: 0.25, marks: { text: 'CRG-0417', style: 'stencil', color: '#2a2e33', hazard: true }, lights: { count: 3, color: '#4dff7a', pattern: 'blink' }, strips: { on: true, color: '#3ad0ff', pattern: 'steady' } } },
        { id: 'fuel-canister', label: 'Sci-fi fuel canister', icon: 'canister', keywords: 'fuel canister tank cell sci-fi hydrogen gas', recipe: { form: 'canister', height: 1.0, width: 0.44, caps: 'domed', valves: true, color: '#d2d6da', trim: '#33373d', wear: 0.25, marks: { text: 'H2 FUEL', style: 'stencil', color: '#2a2e33', symbol: 'flammable', hazard: true }, lights: { count: 2, color: '#ffb02e', pattern: 'pulse' }, strips: { on: true, color: '#ff8a1f', pattern: 'pulse' } } },
        { id: 'coolant-cell', label: 'Reactor coolant cell', icon: 'canister', keywords: 'reactor coolant cell power core glowing energy battery', recipe: { form: 'canister', height: 1.1, width: 0.5, caps: 'flat', valves: false, core: true, color: '#2f3740', trim: '#1c2026', wear: 0.2, marks: { text: 'COOLANT', style: 'stencil', color: '#e8eef2', symbol: 'radiation' }, lights: { count: 1, color: '#4dff7a', pattern: 'steady' }, strips: { on: true, color: '#3ae0ff', pattern: 'chase' } } },
        { id: 'data-crate', label: 'Data crate', icon: 'cargo', keywords: 'data crate display screen terminal sci-fi server', recipe: { form: 'cargo', width: 0.8, proportions: 'cube', color: '#2c333b', trim: '#15181c', accent: '#3ad0ff', wear: 0.15, marks: { text: 'DC-77B', style: 'stencil', color: '#9aa6b2' }, lights: { count: 4, color: '#4dff7a', pattern: 'chase' }, strips: { on: true, color: '#2f8cff', pattern: 'steady' }, display: { mode: 'text', text: 'DATA CORE 77-B  ENCRYPTED', style: 'led', color: '#3ae0ff' } } }
    ];
    const PRESET_BY_ID = new Map(PRESETS.map(p => [p.id, p]));

    /** The recipe the page's tabs follow: the last one completed (the builder completes its own on every change). */
    let current = null;

    function normalize(input) {
        const r = input && typeof input === 'object' ? input : {}, d = DEFAULT;
        const form = pick(r.form, FORMS.map(f => f[0]), d.form), sz = SIZES[form];
        const m = r.marks || {}, l = r.lights || {}, s = r.strips || {}, dp = r.display || {};
        const out = {
            kind: 'container', preset: PRESET_BY_ID.has(r.preset) ? r.preset : null, form,
            height: sz.height ? clamp(r.height, sz.height[0], sz.height[1], sz.height[2]) : null,
            width: clamp(r.width, sz.width[0], sz.width[1], sz.width[2]),
            proportions: pick(r.proportions, PROPORTIONS.map(p => p[0]), d.proportions),
            bulge: clamp(r.bulge, 0, 1, d.bulge), hoops: Math.round(clamp(r.hoops, 2, 8, d.hoops)), ribs: Math.round(clamp(r.ribs, 0, 3, d.ribs)),
            top: pick(r.top, TOPS.map(t => t[0]), d.top), caps: pick(r.caps, CAPS.map(c => c[0]), d.caps), valves: r.valves !== false, core: !!r.core,
            brace: pick(r.brace, BRACES.map(b => b[0]), d.brace), slats: !!r.slats, handles: r.handles !== false, finish: pick(r.finish, FINISHES.map(f => f[0]), d.finish),
            lid: pick(r.lid, LIDS.map(x => x[0]), d.lid), corners: r.corners !== false, lock: r.lock !== false, gold: !!r.gold,
            bumpers: r.bumpers !== false, latches: r.latches !== false,
            lying: ROUND.has(form) && !!r.lying, cradle: r.cradle !== false, open: !!r.open, stack: pick(r.stack, STACKS.map(x => x[0]), d.stack),
            color: color(r.color, d.color), trim: color(r.trim, d.trim), accent: color(r.accent, d.accent),
            wear: clamp(r.wear, 0, 1, d.wear),
            marks: { text: text(m.text, '', 24), style: pick(m.style, MARK_STYLES.map(x => x[0]), 'stencil'), color: color(m.color, d.marks.color), symbol: pick(m.symbol, CP.SYMBOLS.map(x => x[0]), 'none'), hazard: !!m.hazard, image: text(m.image, '', 200) },
            lights: { count: Math.round(clamp(l.count, 0, MAX_LIGHTS, 0)), color: color(l.color, d.lights.color), pattern: pick(l.pattern, PATTERNS.map(p => p[0]), d.lights.pattern) },
            strips: { on: !!s.on, color: color(s.color, d.strips.color), pattern: pick(s.pattern, PATTERNS.map(p => p[0]), d.strips.pattern) },
            display: { mode: pick(dp.mode, CP.DISPLAY_MODES.map(x => x[0]), 'none'), text: text(dp.text, d.display.text, 32), style: pick(dp.style, CP.DISPLAY_STYLES.map(x => x[0]), 'led'), color: color(dp.color, d.display.color), image: text(dp.image, '', 200) },
            seed: (Number(r.seed) >>> 0) || d.seed
        };
        if (!(form === 'crate' || form === 'cargo')) out.stack = 'one';
        // A stack's lid stays shut; only one standing alone opens.
        if (out.stack !== 'one') out.open = false;
        if (!FUTURE.has(form)) { out.lights.count = 0; out.strips.on = false; out.display.mode = 'none'; }
        current = out;
        return out;
    }

    /** A type's own starting point: its preset over the defaults. */
    function fromPreset(id) {
        const p = PRESET_BY_ID.get(id) || PRESETS[0];
        const base = JSON.parse(JSON.stringify(DEFAULT));
        const r = Object.assign(base, JSON.parse(JSON.stringify(p.recipe)), { preset: p.id });
        for (const k of ['marks', 'lights', 'strips', 'display']) r[k] = Object.assign({}, DEFAULT[k], p.recipe[k] || {});
        const sz = SIZES[r.form];
        if (sz.height && p.recipe.height == null) r.height = sz.height[2];
        if (p.recipe.width == null) r.width = sz.width[2];
        return normalize(r);
    }

    // ── shared pieces of a build ───────────────────────────────────────────
    /**
     * What a build gathers: meshes by part (body, trim, glass, glow, halo),
     * the body picture's regions and the jobs that paint them, the bones and
     * what each one does through the loop.
     */
    function kit(r, size) {
        const S = size || 1024;
        return {
            r, S, atlas: CP.atlas(S, S, [120, 110, 100, 255]), jobs: [],
            body: [], trim: [], glass: [], glow: [], halo: [],
            bones: [{ name: 'Prop', head: [0, 0, 0], parent: -1 }], anim: [], boneKeys: new Map(),
            glowColors: [], glowUses: [], images: [], missing: null
        };
    }

    /** A rectangle of the body picture and how it is painted: fn(s, t, out). */
    function paintRegion(k, wPx, hPx, fn) {
        const rect = CP.region(k.atlas, wPx, hPx);
        k.jobs.push({ rect, fn });
        return rect;
    }

    /** Uv of (s, t) in a region. */
    const uvAt = (k, rect, s, t) => CP.uvIn(k.atlas, rect, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, t)));

    /**
     * A bone for a lit part: `hide` { move: [x, y, z] } (moved by that while
     * off) or { shrink: [x, y, z] } (scaled to that about its head while
     * off); `on(t)` whether it shows at time t. Keyed, so parts sharing a
     * timing and a way of hiding share one bone.
     */
    function bone(k, key, head, hide, on) {
        if (k.boneKeys.has(key)) return k.boneKeys.get(key);
        const index = k.bones.length;
        k.bones.push({ name: 'Glow_' + index, head: head.slice(), parent: 0 });
        k.anim.push({ bone: index, hide, on });
        k.boneKeys.set(key, index);
        return index;
    }

    // ── painters ───────────────────────────────────────────────────────────
    /**
     * Planked wood on a flat face w x h (meters, x right and y down from its
     * top left as seen from outside): boards `planks` across, running along
     * `along`, each its own board of `wood`, with a dark seam and softened
     * edges; painted boards keep their grain under the paint and show the
     * wood where it has chipped. `contact`: rectangles of battens over the
     * face, which shade the boards beside them. `marks` painted over.
     */
    function plankFace(o) {
        const n = Math.max(1, o.planks), across = o.along === 'x' ? o.h : o.w, pw = across / n;
        const chip = Paint.fractal((o.seed >>> 0) + 81, 16, 3), paint = o.paint ? CP.rgb(o.paint) : null, wear = o.wear || 0;
        return (s, t, out) => {
            const x = s * o.w, y = t * o.h, a = o.along === 'x' ? y : x, b = o.along === 'x' ? x : y;
            const idx = Math.min(n - 1, Math.floor(a / pw)), local = a - idx * pw;
            o.wood(local + idx * 0.31, b, out, (o.board || 0) + idx, o.low ? o.low(x, y) : 0);
            if (paint) {
                // Paint over the grain; worn through to the wood at the boards' edges and in patches.
                const lum = (out[0] + out[1] + out[2]) / 3, k = 0.86 + 0.5 * (lum - 0.42);
                const edge = Math.min(local, pw - local) < 0.012 ? 0.25 : 0;
                const through = chip(x * 0.9, y * 0.9) + edge * wear > 1 - wear * 0.5;
                if (!through) { out[0] = paint[0] * k; out[1] = paint[1] * k; out[2] = paint[2] * k; }
            }
            const d = Math.min(local, pw - local);
            const seam = d < 0.0013 ? 0.28 : d < 0.005 ? 0.62 + 0.38 * (d - 0.0013) / 0.0037 : 1;
            let shade = seam;
            for (const c of o.contact || []) {
                const dx = Math.max(c[0] - x, 0, x - c[2]), dy = Math.max(c[1] - y, 0, y - c[3]), dd = Math.hypot(dx, dy);
                if (dd < 0.02) shade *= 0.62 + 0.38 * dd / 0.02;
            }
            out[0] *= shade; out[1] *= shade; out[2] *= shade;
            if (o.marks) o.marks.apply(x, y, out);
        };
    }

    /** Painted metal on a flat face w x h: chips toward its edges and `lines` (panel seams at x fractions), rivets at the panel's corners. */
    function metalFace(o) {
        const metal = CP.paintedMetal(o.color, o.seed, o.wear || 0, o.bare);
        const e = o.edgeBand || 0.05;
        return (s, t, out) => {
            const x = s * o.w, y = t * o.h;
            const edge = Math.max(0, 1 - Math.min(x, o.w - x, y, o.h - y) / e);
            metal(x, y, out, edge, o.low ? o.low(x, y) : 0);
            let k = 1;
            for (const f of o.lines || []) { const d = Math.abs(x - f * o.w); if (d < 0.0016) k *= 0.45; else if (d < 0.0035) k *= 1.12; }
            for (const f of o.rows || []) { const d = Math.abs(y - f * o.h); if (d < 0.0016) k *= 0.45; else if (d < 0.0035) k *= 1.12; }
            if (o.rivets) for (const [rx, ry] of o.rivets) { const d = Math.hypot(x - rx, y - ry); if (d < 0.006) { const l = 0.85 + 0.4 * (1 - d / 0.006) * ((ry - y) > 0 ? 1 : 0.6); k *= l; } }
            out[0] *= k; out[1] *= k; out[2] *= k;
            if (o.marks) o.marks.apply(x, y, out);
        };
    }

    /** The picture the recipe's markings use, if it has one and it is in. */
    function marksImage(k, options) {
        const name = k.r.marks.image;
        if (!name) return null;
        const img = (options.images || {})[name] || null;
        if (!img && !k.missing) k.missing = name;
        return img;
    }

    /** Box faces mapped into their regions: each point by the face it turns to, in that face's meters. */
    function mapBoxFaces(k, mesh, box, regions) {
        const [cx, cy, cz] = box.center, [W, H, D] = box.size;
        const P = mesh.positions, N = mesh.normals;
        return CM.mapUv(mesh, (u, v, i) => {
            const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
            const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
            let face, fx, fy, fw, fh;
            if (ay >= ax && ay >= az) { face = ny > 0 ? 'top' : 'bottom'; fx = x - (cx - W / 2); fy = z - (cz - D / 2); fw = W; fh = D; }
            else if (az >= ax) { face = nz > 0 ? 'front' : 'back'; fx = nz > 0 ? x - (cx - W / 2) : (cx + W / 2) - x; fy = (cy + H / 2) - y; fw = W; fh = H; }
            else { face = nx > 0 ? 'right' : 'left'; fx = nx > 0 ? (cz + D / 2) - z : z - (cz - D / 2); fy = (cy + H / 2) - y; fw = D; fh = H; }
            const rect = regions[face] || regions.front;
            return uvAt(k, rect, fx / fw, fy / fh);
        });
    }

    /** Pixels for a face of `w` x `h` meters at the build's density (`dens` px a meter), at most `cap` on a side. */
    const px = (dens, m, cap) => Math.max(8, Math.min(cap || 1e9, Math.round(m * dens)));

    // ── barrel ─────────────────────────────────────────────────────────────
    /** The hoops' heights (fractions of the height) for a count: chimes first, then quarters, then the bilge. */
    const HOOPS = { 2: [0.04, 0.96], 3: [0.04, 0.5, 0.96], 4: [0.04, 0.22, 0.78, 0.96], 5: [0.04, 0.22, 0.5, 0.78, 0.96], 6: [0.04, 0.2, 0.37, 0.63, 0.8, 0.96], 7: [0.04, 0.14, 0.24, 0.5, 0.76, 0.86, 0.96], 8: [0.04, 0.13, 0.22, 0.38, 0.62, 0.78, 0.87, 0.96] };

    function barrel(k, options) {
        const r = k.r, H = r.height, Rb = r.width / 2, Rh = Rb * (1 - 0.05 - 0.17 * r.bulge);
        const radiusAt = y => Rh + (Rb - Rh) * (1 - Math.pow(2 * y / H - 1, 2));
        const staves = Math.max(12, Math.min(24, Math.round(Math.PI * 2 * Rb / 0.1)));
        const seg = staves * 2, t = Math.max(0.014, Math.min(0.028, Rb * 0.065)), recess = Math.max(0.018, H * 0.034);
        const rand = Paint.random(r.seed + 3), jitter = Array.from({ length: staves }, () => rand() - 0.5);
        const lying = r.lying;
        // Where the bung and the markings face: on its side the bung is on top and the markings face the front.
        const markF = lying ? 0.75 : 0.5, bungF = lying ? 0.5 : 0.25;
        const C = Math.PI * 2 * Rb, dens = Math.min(k.S / C, k.S * 0.55 / H);
        const wood = CP.wood(r.color, r.seed, r.wear);
        const iron = CP.iron(r.trim, r.seed, r.wear);
        const img = marksImage(k, options);
        // Staves: around the barrel, the front at the middle of the picture.
        const sw = C / staves;
        const marks = CP.markings(r.marks, { x: markF * C - Math.min(C * 0.2, H * 0.55) / 2, y: H * 0.5 - H * 0.09, w: Math.min(C * 0.2, H * 0.55), h: H * 0.18 }, { wear: r.wear * 0.7, seed: r.seed, image: img, pixel: 1 / dens });
        const staveRect = paintRegion(k, px(dens, C), px(dens, H), (s, tt, out) => {
            const x = s * C, y = tt * H, f = s * staves, i = Math.min(staves - 1, Math.floor(f)), local = (f - i) * sw;
            wood(local + i * 0.37, y * 1.0, out, i, CP.smooth(H * 0.82, H, y) + CP.smooth(H * 0.18, 0, y) * 0.5);
            const d = Math.min(local, sw - local);
            const seam = d < 0.0016 ? 0.3 : d < 0.006 ? 0.66 + 0.34 * (d - 0.0016) / 0.0044 : 1;
            // A cooper's chalk-free stave: darker toward its ends where the hoops bear.
            const ends = 0.9 + 0.1 * Math.sin(Math.PI * Math.max(0, Math.min(1, y / H)));
            out[0] *= seam * ends; out[1] *= seam * ends; out[2] *= seam * ends;
            marks.apply(x, y, out);
        });
        const headRect = paintRegion(k, px(dens, Rh * 2, k.S * 0.3), px(dens, Rh * 2, k.S * 0.3), plankFace({ w: Rh * 2, h: Rh * 2, planks: Math.max(3, Math.round(Rh * 2 / 0.11)), along: 'x', wood, board: 40, seed: r.seed }));
        const hoopRect = paintRegion(k, Math.min(k.S - 8, px(dens, C)), 24, (s, tt, out) => iron(s * C, tt * 0.05, out));

        // The staves: bulging, crowned (each a little proud of its seams), each a hair off its neighbors.
        const outer = [];
        const rows = 12;
        const profile = [];
        const inner = y => radiusAt(y) - t;
        // Bottom: the head's underside edge, down the chime, across the stave ends.
        profile.push([inner(recess), recess], [inner(0), 0], [radiusAt(0), 0]);
        const first = profile.length;
        for (let i = 0; i <= rows; i++) profile.push([radiusAt(H * i / rows), H * i / rows]);
        for (let i = first; i < profile.length; i++) outer.push(i);
        profile.push([inner(H), H]);
        if (r.top === 'open') { for (let i = 1; i <= 6; i++) { const y = H - (H - recess) * i / 6; profile.push([inner(y), y]); } }
        else profile.push([inner(H - recess), H - recess]);
        const outerSet = new Set(outer);
        const crowned = (f, y, r0, kk) => {
            if (!outerSet.has(kk)) return r0;
            const q = f * staves, i = Math.floor(q + 1e-7) % staves, local = q - Math.floor(q + 1e-7);
            const seamV = local < 1e-4 || local > 1 - 1e-4;
            const j = seamV ? (jitter[i] + jitter[(i + staves - 1) % staves]) / 2 : jitter[i];
            return r0 * (1 + 0.004 * j * (1 + r.wear)) - (seamV ? 0.0022 : -0.0012);
        };
        const body = CM.revolve(profile, seg, { radius: crowned, crease: 0.55 });
        const P = body.positions;
        CM.mapUv(body, (u, v, i) => uvAt(k, staveRect, u, 1 - P[i * 3 + 1] / H));
        // The inside is in shadow, darker the deeper.
        CM.occlude(body, (x, y, z, nx, ny, nz) => { const rr = Math.hypot(x, z); return rr < inner(y) + 0.0005 && ny < 0.5 ? 0.35 + 0.4 * (y / H) : y > H - 0.001 ? 0.9 : 1; });
        k.body.push(body);
        // Heads: plank discs at the recesses (the top one only when it has a lid).
        const head = (y, up) => {
            const g = new CM.Geo(), pts = [], uvs = [];
            for (let s = 0; s < seg; s++) { const a = Math.PI + s / seg * Math.PI * 2, rr = inner(y); pts.push([rr * Math.sin(a), y, rr * Math.cos(a)]); uvs.push(uvAt(k, headRect, 0.5 + rr * Math.sin(a) / (Rh * 2), 0.5 + rr * Math.cos(a) / (Rh * 2))); }
            g.poly(pts, uvs, [0, up ? 1 : -1, 0]);
            const m = g.done();
            if (up && r.top === 'open') CM.occlude(m, () => 0.32);
            return m;
        };
        k.body.push(head(recess, false));
        k.body.push(head(r.top === 'open' ? recess + 0.0005 : H - recess, true));
        // Hoops: iron bands over the staves, following the bulge.
        const thick = 0.0045 + 0.004 * Rb * (1 + r.wear);
        for (const f of HOOPS[r.hoops]) {
            const w = Math.max(0.025, H * 0.045), y0 = Math.max(0.004, f * H - w / 2), y1 = Math.min(H - 0.004, f * H + w / 2);
            const hp = [[radiusAt(y0) + 0.0012, y0], [radiusAt(y0) + thick, y0 + 0.0015], [radiusAt(y1) + thick, y1 - 0.0015], [radiusAt(y1) + 0.0012, y1]];
            const hoop = CM.revolve(hp, seg, { crease: 0.5 });
            CM.mapUv(hoop, (u, v) => uvAt(k, hoopRect, u, Math.min(1, v / (w + thick * 2))));
            k.trim.push(hoop);
        }
        // The bung: a wooden plug in the bilge stave.
        {
            const a = Math.PI + bungF * Math.PI * 2, rr = radiusAt(H / 2) + 0.001, dir = [Math.sin(a), 0, Math.cos(a)];
            const F = CM.frame([dir[0] * rr, H / 2, dir[2] * rr], cross([0, 1, 0], dir), [0, 1, 0]);
            const plug = CM.dome(F, 0, 0, Math.max(0.018, Rb * 0.07), 0.008, 10);
            CM.mapUv(plug, () => uvAt(k, headRect, 0.3, 0.5));
            k.body.push(plug);
        }
        const out = { height: H, axis: 'y', radius: Rb };
        if (lying) {
            layDown(k, H);
            if (r.cradle) cradle(k, H, Rb, radiusAt, wood, dens);
        }
        return out;
    }

    /**
     * On its side: the axis along x, what faced +z turned up, what faced +x
     * to the front; the lowest point is lifted to the floor afterward.
     */
    function layDown(k, H) {
        const point = p => [p[1] - H / 2, p[2], p[0]], turn = n => [n[1], n[2], n[0]];
        for (const list of [k.body, k.trim, k.glass, k.glow, k.halo]) for (const m of list) CM.transform(m, point, turn);
        for (const b of k.bones) b.head = point(b.head);
        for (const a of k.anim) { if (a.hide.move) a.hide.move = turn(a.hide.move); if (a.hide.shrink) { const s = a.hide.shrink; a.hide.shrink = [s[1], s[2], s[0]]; } }
        k.lyingAxis = true;
    }

    /** Two wooden chocks under a barrel on its side, its belly sitting in their saddles. */
    function cradle(k, H, Rb, radiusAt, wood, dens) {
        // The barrel's lowest point, before it is lifted: its belly at -Rb.
        const lift = Math.max(0.05, Rb * 0.22);
        for (const m of [k.body, k.trim, k.glass, k.glow, k.halo].flat()) CM.transform(m, p => [p[0], p[1] + Rb + lift, p[2]]);
        for (const b of k.bones) b.head = [b.head[0], b.head[1] + Rb + lift, b.head[2]];
        const rect = paintRegion(k, 128, 48, plankFace({ w: 0.6, h: 0.2, planks: 1, along: 'x', wood, board: 70, seed: k.r.seed }));
        const thick = Math.max(0.05, H * 0.07), half = Rb * 0.78, steps = 10;
        for (const xs of [-0.3, 0.3]) {
            const x = xs * H, R = radiusAt(H / 2 + x) + 0.003, cy = Rb + lift;
            const g = new CM.Geo();
            const col = j => { const z = -half + 2 * half * j / steps; const top = cy - Math.sqrt(Math.max(0, R * R - z * z)); return [z, Math.min(top, cy - R * 0.25)]; };
            const cols = Array.from({ length: steps + 1 }, (_, j) => col(j));
            const uv = (z, y) => uvAt(k, rect, (z + half) / (2 * half), 1 - y / (cy));
            for (const side of [-1, 1]) for (let j = 0; j < steps; j++) {
                const a = cols[j], b = cols[j + 1], xx = x + side * thick / 2;
                g.poly([[xx, 0, a[0]], [xx, 0, b[0]], [xx, b[1], b[0]], [xx, a[1], a[0]]], [uv(a[0], 0), uv(b[0], 0), uv(b[0], b[1]), uv(a[0], a[1])], [side, 0, 0]);
            }
            for (let j = 0; j < steps; j++) {
                const a = cols[j], b = cols[j + 1], n = norm([0, b[0] - a[0], -(b[1] - a[1])]);
                g.poly([[x - thick / 2, a[1], a[0]], [x + thick / 2, a[1], a[0]], [x + thick / 2, b[1], b[0]], [x - thick / 2, b[1], b[0]]], [uv(a[0], a[1]), uv(a[0], a[1] + 0.05), uv(b[0], b[1] + 0.05), uv(b[0], b[1])], n[1] < 0 ? scale(n, -1) : n);
            }
            for (const side of [-1, 1]) { const c = cols[side < 0 ? 0 : steps]; g.poly([[x - thick / 2, 0, c[0]], [x + thick / 2, 0, c[0]], [x + thick / 2, c[1], c[0]], [x - thick / 2, c[1], c[0]]], [uv(c[0], 0), uv(c[0] + 0.05, 0), uv(c[0] + 0.05, c[1]), uv(c[0], c[1])], [0, 0, side]); }
            const m = g.done();
            CM.occlude(m, (px_, y) => 0.78 + 0.22 * Math.min(1, y / 0.05));
            k.body.push(m);
        }
    }

    // ── steel drum ─────────────────────────────────────────────────────────
    /**
     * Rolled beads at both chimes, rolling ribs between, recessed heads (the
     * top with a large and a small bung, or open), dented with wear.
     */
    function drum(k, options) {
        const r = k.r, H = r.height, R = r.width / 2, seg = 34;
        const C = Math.PI * 2 * R, dens = Math.min(k.S / C, k.S * 0.55 / H);
        const img = marksImage(k, options);
        const markF = r.lying ? 0.75 : 0.5;
        const ribsY = r.ribs ? Array.from({ length: r.ribs }, (_, i) => H * (i + 1) / (r.ribs + 1)) : [];
        // Markings between the ribs about the middle; hazard stripes in a band below the top bead.
        const lo = ribsY.length >= 2 ? ribsY[Math.floor(ribsY.length / 2) - 1] : H * 0.25, hi = ribsY.length >= 2 ? ribsY[Math.floor(ribsY.length / 2)] : H * 0.75;
        const mh = Math.min((hi - lo) * 0.62, H * 0.24), mw = Math.min(C * 0.3, mh * 3.4);
        const band = r.marks.hazard ? [H - Math.min(H * 0.24, (ribsY.length ? H - ribsY[ribsY.length - 1] : H * 0.3) * 0.72) - 0.03, H - 0.035] : null;
        const marks = CP.markings(r.marks, { x: markF * C - mw / 2, y: H - (lo + hi) / 2 - mh / 2, w: mw, h: mh }, { wear: r.wear, seed: r.seed, image: img, pixel: 1 / dens, band: band ? [H - band[1], H - band[0]] : null, stripe: 0.07 });
        const metal = CP.paintedMetal(r.color, r.seed, r.wear);
        const nearEdge = y => { let d = Math.min(y, H - y); for (const ry of ribsY) d = Math.min(d, Math.abs(y - ry)); return Math.max(0, 1 - d / 0.05); };
        const sideRect = paintRegion(k, px(dens, C), px(dens, H), (s, t, out) => {
            const x = s * C, yy = t * H, y = H - yy;
            metal(x, yy, out, nearEdge(y), CP.smooth(0.18, 0, y));
            marks.apply(x, yy, out);
        });
        const headRect = paintRegion(k, px(dens, R * 2, k.S * 0.32), px(dens, R * 2, k.S * 0.32), (s, t, out) => {
            const x = (s - 0.5) * 2 * R, z = (t - 0.5) * 2 * R, rr = Math.hypot(x, z);
            metal(x + 3, z + 3, out, Math.max(0, 1 - (R - rr) / 0.04), 0);
            // A pressed ring around the head.
            const ring = Math.abs(rr - R * 0.78);
            if (ring < 0.004) { const kk = ring < 0.0015 ? 0.7 : 1.1; out[0] *= kk; out[1] *= kk; out[2] *= kk; }
        });
        // The outline: bottom head, chime bead, the wall with its ribs, top bead, top head (or down the inside).
        const prof = [[0, 0.012], [R - 0.016, 0.012], [R - 0.009, 0.001], [R + 0.002, 0.0], [R + 0.007, 0.008], [R + 0.006, 0.018], [R, 0.028]];
        const wall = (y0, y1) => { const n = Math.max(1, Math.ceil((y1 - y0) / 0.06)); for (let i = 1; i <= n; i++) prof.push([R, y0 + (y1 - y0) * i / n]); };
        let y = 0.028;
        for (const ry of ribsY) {
            wall(y, ry - 0.02);
            prof.push([R + 0.006, ry - 0.008], [R + 0.008, ry], [R + 0.006, ry + 0.008], [R, ry + 0.02]);
            y = ry + 0.02;
        }
        wall(y, H - 0.028);
        prof.push([R + 0.006, H - 0.018], [R + 0.007, H - 0.008], [R + 0.002, H], [R - 0.009, H - 0.001]);
        if (r.top === 'open') { prof.push([R - 0.012, H - 0.03]); for (let i = 1; i <= 4; i++) prof.push([R - 0.012, H - 0.03 - (H - 0.06) * i / 4]); prof.push([0, 0.03]); }
        else prof.push([R - 0.016, H - 0.012], [0, H - 0.012]);
        const body = CM.revolve(prof, seg, { crease: 0.62 });
        const P = body.positions, N = body.normals;
        // Dents: pushed in where it was struck, more and deeper with wear.
        const rand = Paint.random(r.seed + 17), dents = [];
        const count = Math.round(r.wear * 7);
        for (let i = 0; i < count; i++) dents.push({ a: rand() * Math.PI * 2, y: 0.05 + rand() * (H - 0.1), size: 0.05 + rand() * 0.09, depth: (0.006 + rand() * 0.02) * r.wear });
        if (dents.length) {
            for (let i = 0; i < P.length / 3; i++) {
                const x = P[i * 3], yy = P[i * 3 + 1], z = P[i * 3 + 2], rr = Math.hypot(x, z);
                if (rr < R - 0.02) continue;
                const a = Math.atan2(x, z);
                let push = 0;
                for (const d of dents) { let da = a - d.a; da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2; const dist2 = (da * R) ** 2 + (yy - d.y) ** 2; push += d.depth * Math.exp(-dist2 / (d.size * d.size)); }
                const k2 = (rr - push) / rr;
                P[i * 3] *= k2; P[i * 3 + 2] *= k2;
            }
            CM.smoothNormals(body, 0.62);
        }
        CM.mapUv(body, (u, v, i) => {
            const x = P[i * 3], yy = P[i * 3 + 1], z = P[i * 3 + 2];
            if (Math.abs(N[i * 3 + 1]) > 0.85 && Math.hypot(x, z) < R - 0.008) return uvAt(k, headRect, 0.5 + x / (2 * R), 0.5 + z / (2 * R));
            return uvAt(k, sideRect, u, 1 - yy / H);
        });
        CM.occlude(body, (x, yy, z, nx, ny) => (r.top === 'open' && Math.hypot(x, z) < R - 0.011 && yy < H - 0.02 ? 0.3 + 0.35 * yy / H : 1));
        k.body.push(body);
        if (r.top !== 'open') {
            // Bungs: a large and a small threaded cap in the top head.
            for (const [bx, bz, br] of [[R * 0.56, -R * 0.12, 0.034], [-R * 0.58, -R * 0.1, 0.022]]) {
                const cap = CM.revolve([[br * 1.25, 0], [br * 1.25, 0.004], [br, 0.006], [br, 0.013], [br * 0.9, 0.016], [0, 0.016]], 12, { crease: 0.5 });
                CM.transform(cap, p => [p[0] + bx, p[1] + H - 0.012, p[2] + bz]);
                CM.mapUv(cap, () => uvAt(k, headRect, 0.5 + bx / (2 * R), 0.5 + bz / (2 * R)));
                k.trim.push(cap);
            }
        }
        if (r.lying) layDown(k, H);
        return { height: H, axis: 'y', radius: R };
    }

    // ── sci-fi canister ────────────────────────────────────────────────────
    /**
     * Dark end caps over a painted sleeve with panel grooves; glowing bands
     * in the grooves; valves and a gauge on top; with a core, a cage of
     * struts around a glowing column. A control plate on the front carries
     * the lights and the display.
     */
    function canister(k, options) {
        const r = k.r, H = r.height, R = r.width / 2, Rs = R * 0.955, seg = 32;
        const capH = Math.min(H * 0.15, R * 0.55 + 0.03);
        const C = Math.PI * 2 * Rs, sleeveH = H - capH * 2 + 0.02, dens = Math.min(k.S / C, k.S * 0.5 / sleeveH);
        const img = marksImage(k, options);
        const markF = r.lying ? 0.75 : 0.5;
        const grooves = [capH + sleeveH * 0.16, H - capH - sleeveH * 0.16];
        const metal = CP.paintedMetal(r.color, r.seed, r.wear * 0.8, '#9aa0a6');
        const trimMetal = CP.paintedMetal(r.trim, r.seed + 5, r.wear * 0.9, '#7a8088');
        const plate = FUTURE.has(r.form) && (r.lights.count > 0 || r.display.mode !== 'none');
        // Markings: below the plate when there is one, else about the middle; the band of stripes above the lower groove.
        const mh = Math.min(sleeveH * 0.16, C * 0.08), mw = Math.min(C * 0.34, mh * 4);
        const markY = plate ? H - (capH + sleeveH * 0.29) : H - (capH + sleeveH * 0.5);
        const band = r.marks.hazard ? [H - grooves[0] - sleeveH * 0.08 - 0.012, H - grooves[0] - 0.012] : null;
        const marks = CP.markings(r.marks, { x: (r.core ? (markF + 0.25) % 1 : markF) * C - mw / 2, y: markY - mh / 2, w: mw, h: mh }, { wear: r.wear * 0.8, seed: r.seed, image: img, pixel: 1 / dens, band, stripe: 0.06 });
        const sleeveRect = paintRegion(k, px(dens, C), px(dens, H), (s, t, out) => {
            const x = s * C, yy = t * H, y = H - yy;
            metal(x, yy, out, Math.max(0, 1 - Math.min(Math.abs(y - grooves[0]), Math.abs(y - grooves[1])) / 0.04), 0);
            // Panel lines up the sleeve, every quarter turn, with rivets beside the grooves.
            const q = (s * 4) % 1, d = Math.min(q, 1 - q) * C / 4;
            let kk = d < 0.0016 ? 0.45 : d < 0.0035 ? 1.1 : 1;
            for (const g of grooves) for (const dy of [-0.018, 0.018]) { const rq = Math.hypot(((s * 16) % 1 - 0.5) * C / 16, y - g - dy); if (rq < 0.005) kk *= 0.8 + 0.35 * (1 - rq / 0.005); }
            out[0] *= kk; out[1] *= kk; out[2] *= kk;
            marks.apply(x, yy, out);
        });
        const capRect = paintRegion(k, px(dens, C), Math.max(24, px(dens, capH * 2 + R)), (s, t, out) => trimMetal(s * C, t * (capH * 2 + R), out, CP.smooth(0.8, 1, t) + CP.smooth(0.2, 0, t), 0));
        // End caps.
        const bottom = [[0, 0], [R * 0.9, 0], [R, 0.016], [R, capH - 0.014], [R * 0.985, capH - 0.004], [Rs * 0.97, capH], [0, capH]];
        let top;
        if (r.caps === 'domed') {
            top = [[0, H - capH], [Rs * 0.97, H - capH], [R * 0.985, H - capH + 0.004], [R, H - capH + 0.014], [R, H - capH * 0.62]];
            for (let i = 1; i <= 5; i++) { const a = i / 5 * Math.PI / 2; top.push([R * Math.cos(a) * (i === 5 ? 0 : 1), H - capH * 0.62 + capH * 0.62 * Math.sin(a)]); }
        } else top = [[0, H - capH], [Rs * 0.97, H - capH], [R * 0.985, H - capH + 0.004], [R, H - capH + 0.014], [R, H - 0.016], [R * 0.9, H], [0, H]];
        for (const prof of [bottom, top]) {
            const cap = CM.revolve(prof, seg, { crease: 0.6 });
            CM.mapUv(cap, (u, v, i) => uvAt(k, capRect, u, Math.min(1, v / (capH * 2 + R))));
            k.trim.push(cap);
        }
        // The sleeve, grooved; with a core, short collars and a cage between them.
        const collar = Math.max(0.05, sleeveH * 0.12);
        const sleeveProf = (y0, y1) => {
            const p = [[Rs, y0]];
            for (const g of grooves) if (g > y0 + 0.01 && g < y1 - 0.01) p.push([Rs, g - 0.007], [Rs - 0.004, g - 0.005], [Rs - 0.004, g + 0.005], [Rs, g + 0.007]);
            p.push([Rs, y1]);
            return p;
        };
        const sleeves = r.core ? [[capH - 0.006, grooves[0] + collar * 0.6], [grooves[1] - collar * 0.6, H - capH + 0.006]] : [[capH - 0.006, H - capH + 0.006]];
        for (const [y0, y1] of sleeves) {
            const m = CM.revolve(sleeveProf(y0, y1), seg, { crease: 0.5 });
            CM.mapUv(m, (u, v, i) => uvAt(k, sleeveRect, u, 1 - m.positions[i * 3 + 1] / H));
            k.body.push(m);
        }
        const out = { height: H, axis: 'y', radius: R };
        if (r.core) {
            const y0 = grooves[0] + collar * 0.6, y1 = grooves[1] - collar * 0.6;
            // Struts around a dark inner tube; the glowing column inside it shows between them.
            for (let i = 0; i < 6; i++) {
                const a = Math.PI + (i + 0.5) / 6 * Math.PI * 2, w = Math.max(0.03, R * 0.16);
                const strut = CM.chamferBox([0, (y0 + y1) / 2, Rs - w * 0.4], [w, y1 - y0 + 0.01, w * 0.8], 0.006);
                const turnA = CM.yaw(a);
                CM.transform(strut, turnA.point, turnA.normal);
                CM.mapUv(strut, (u, v) => uvAt(k, capRect, (u + 2) % 1, 0.2));
                k.trim.push(strut);
            }
            for (const [ya, yb] of [[y0 - 0.002, y0 + 0.012], [y1 - 0.012, y1 + 0.002]]) {
                const ring = CM.revolve([[Rs * 0.7, ya], [Rs * 1.004, ya], [Rs * 1.004, yb], [Rs * 0.7, yb]], seg, { crease: 0.5 });
                CM.mapUv(ring, u => uvAt(k, capRect, u, 0.5));
                k.trim.push(ring);
            }
            out.core = { y0, y1, r: Rs * 0.62 };
        }
        if (r.valves) {
            // A pipe up from the top, a hand wheel on it, a gauge beside.
            const yTop = r.caps === 'domed' ? H : H;
            const pipeH = Math.max(0.05, R * 0.3), pr = Math.max(0.014, R * 0.07);
            const pipe = CM.revolve([[pr * 1.6, yTop - 0.02], [pr * 1.6, yTop + 0.012], [pr, yTop + 0.016], [pr, yTop + pipeH], [pr * 1.3, yTop + pipeH], [pr * 1.3, yTop + pipeH + 0.012], [0, yTop + pipeH + 0.012]], 12, { crease: 0.5 });
            CM.mapUv(pipe, u => uvAt(k, capRect, u, 0.5));
            k.trim.push(pipe);
            const wheelR = Math.max(0.035, R * 0.22), wy = yTop + pipeH * 0.7, path = [];
            for (let i = 0; i <= 16; i++) { const a = i / 16 * Math.PI * 2; path.push([Math.cos(a) * wheelR, wy, Math.sin(a) * wheelR]); }
            const wheel = CM.sweep(path, Math.max(0.0045, wheelR * 0.11), 6, false);
            const spokes = [CM.sweep([[-wheelR, wy, 0], [wheelR, wy, 0]], wheelR * 0.07, 5, false), CM.sweep([[0, wy, -wheelR], [0, wy, wheelR]], wheelR * 0.07, 5, false)];
            const accentRect = paintRegion(k, 32, 16, (s, t, o2) => { const c = CP.rgb(r.accent); o2[0] = c[0] * (0.85 + 0.15 * t); o2[1] = c[1] * (0.85 + 0.15 * t); o2[2] = c[2] * (0.85 + 0.15 * t); });
            for (const m of [wheel, ...spokes]) { CM.mapUv(m, () => uvAt(k, accentRect, 0.5, 0.5)); k.body.push(m); }
            const gx = R * 0.5, gz = -R * 0.3, gr = Math.max(0.022, R * 0.12), gyTop = r.caps === 'domed' ? H - capH * 0.62 + capH * 0.62 * Math.sin(Math.acos(Math.min(1, Math.hypot(gx, gz) / R))) : H;
            const gauge = CM.revolve([[gr * 0.5, gyTop - 0.01], [gr * 0.5, gyTop + 0.02], [gr, gyTop + 0.022], [gr, gyTop + 0.036], [0, gyTop + 0.036]], 12, { crease: 0.5 });
            CM.transform(gauge, p => [p[0] + gx, p[1], p[2] + gz]);
            const dialRect = paintRegion(k, 48, 48, (s, t, o2) => {
                const x = s - 0.5, y = t - 0.5, d = Math.hypot(x, y);
                const v = d > 0.46 ? 0.25 : 0.92;
                o2[0] = o2[1] = o2[2] = v;
                const a = Math.atan2(y, x), needle = Math.abs(Math.sin(a - 0.6)) * d < 0.02 && d < 0.4 && Math.cos(a - 0.6) > 0;
                if (needle) { o2[0] = 0.75; o2[1] = 0.12; o2[2] = 0.08; }
                if (d > 0.34 && d < 0.4 && Math.cos(a * 10) > 0.6) { o2[0] = o2[1] = o2[2] = 0.15; }
            });
            const P = gauge.positions, N = gauge.normals;
            CM.mapUv(gauge, (u, v, i) => (N[i * 3 + 1] > 0.9 ? uvAt(k, dialRect, 0.5 + (P[i * 3] - gx) / (2 * gr), 0.5 + (P[i * 3 + 2] - gz) / (2 * gr)) : uvAt(k, capRect, u, 0.4)));
            k.trim.push(gauge);
        }
        if (plate) {
            // Tangent to the sleeve at the front, deep enough behind to meet it across its width.
            const pw = Math.min(r.width * 0.64, 0.36), ph = Math.min(sleeveH * 0.42, pw * 0.9), sag = Rs - Math.sqrt(Math.max(0, Rs * Rs - pw * pw / 4));
            const yc = capH + sleeveH * 0.62, depth = 0.014;
            const box = CM.chamferBox([0, yc, Rs + depth / 2 - (sag + 0.01) / 2], [pw, ph, depth + sag + 0.01], 0.006);
            CM.mapUv(box, (u, v) => uvAt(k, capRect, (u * 0.5 + 10) % 1, 0.3));
            k.trim.push(box);
            out.panel = { F: CM.frame([0, yc, Rs + depth], [1, 0, 0], [0, 1, 0]), w: pw - 0.02, h: ph - 0.02 };
        }
        out.bands = grooves.map(g => ({ y0: g - 0.0045, y1: g + 0.0045, r: Rs - 0.0028 }));
        return out;
    }

    // ── wooden crate ───────────────────────────────────────────────────────
    /** A convex polygon ([[u, v], ...]) cut by the half-plane n . p <= c. */
    function clipHalf(poly, n, c) {
        const out = [];
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const da = n[0] * a[0] + n[1] * a[1] - c, db = n[0] * b[0] + n[1] * b[1] - c;
            if (da <= 0) out.push(a);
            if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
        }
        return out;
    }
    const insidePoly = (poly, x, y) => { for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false; } return true; };
    const ccw = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s < 0 ? poly.slice().reverse() : poly; };
    const rectPoly = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

    /**
     * Braces across an opening (u0, v0)-(u1, v1): one diagonal board, or two
     * crossing (the second in two halves butting the first). Each { poly, dir }.
     */
    function braces(kind, u0, v0, u1, v1, w) {
        if (kind === 'none' || u1 - u0 < w * 2 || v1 - v0 < w * 2) return [];
        const box = rectPoly(u0, v0, u1, v1), out = [];
        const band = (a, b) => {
            const d = norm([b[0] - a[0], b[1] - a[1], 0]), n = [-d[1], d[0]], c = (a[0] + b[0]) / 2 * n[0] + (a[1] + b[1]) / 2 * n[1];
            return { d, n, c };
        };
        const b1 = band([u0, v0], [u1, v1]);
        let p = clipHalf(clipHalf(box, b1.n, b1.c + w / 2), [-b1.n[0], -b1.n[1]], -(b1.c - w / 2));
        if (p.length >= 3) out.push({ poly: ccw(p), dir: [b1.d[0], b1.d[1]] });
        if (kind === 'x') {
            const b2 = band([u0, v1], [u1, v0]);
            const strip = clipHalf(clipHalf(box, b2.n, b2.c + w / 2), [-b2.n[0], -b2.n[1]], -(b2.c - w / 2));
            for (const side of [1, -1]) {
                const half = side > 0 ? clipHalf(strip, [-b1.n[0], -b1.n[1]], -(b1.c + w / 2)) : clipHalf(strip, b1.n, b1.c - w / 2);
                if (half.length >= 3) out.push({ poly: ccw(half), dir: [b2.d[0], b2.d[1]] });
            }
        }
        return out;
    }

    /**
     * A face of boards and the battens and braces on it, painted as one: the
     * boards run along `along`, each batten and brace its own board with its
     * grain along it, nails at the battens' ends, and the markings over all.
     * Face meters: x = u - u0, y = v1 - v (top left as seen from outside).
     */
    function boardFace(k, o) {
        const wood = o.wood, chip = Paint.fractal((k.r.seed >>> 0) + 91, 16, 3), paint = o.paint ? CP.rgb(o.paint) : null, wear = k.r.wear;
        const pieces = o.pieces.map((p, i) => {
            const poly = p.poly.map(q => [q[0] - o.u0, o.v1 - q[1]]);
            // Face y runs down: the direction flips with it.
            const d = [p.dir[0], -p.dir[1]], c = poly.reduce((s, q) => [s[0] + q[0] / poly.length, s[1] + q[1] / poly.length], [0, 0]);
            const along = poly.map(q => (q[0] - c[0]) * d[0] + (q[1] - c[1]) * d[1]);
            return { poly: ccw(poly), d, c, min: Math.min(...along), max: Math.max(...along), board: 100 + i * 7 + (o.board || 0), batten: p.batten };
        });
        const n = Math.max(1, o.planks), across = o.along === 'x' ? o.h : o.w, pw = across / n;
        const edgeDist = (poly, x, y) => { let m = Infinity; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1; m = Math.min(m, ((x - a[0]) * ey - (y - a[1]) * ex) / -l); } return m; };
        const painted = (out, x, y, edge) => {
            if (!paint) return;
            const lum = (out[0] + out[1] + out[2]) / 3, kk = 0.86 + 0.5 * (lum - 0.42);
            if (!(chip(x * 0.9, y * 0.9) + edge * wear > 1 - wear * 0.5)) { out[0] = paint[0] * kk; out[1] = paint[1] * kk; out[2] = paint[2] * kk; }
        };
        return (s, t, out) => {
            const x = s * o.w, y = t * o.h, low = o.low ? o.low(y) : 0;
            let hit = null;
            for (const p of pieces) if (insidePoly(p.poly, x, y)) { hit = p; break; }
            if (hit) {
                const rx = x - hit.c[0], ry = y - hit.c[1], al = rx * hit.d[0] + ry * hit.d[1], ac = -rx * hit.d[1] + ry * hit.d[0];
                wood(ac + 0.5, al, out, hit.board, low);
                const e = edgeDist(hit.poly, x, y);
                painted(out, x, y, e < 0.01 ? 0.35 : 0);
                const kk = e < 0.0012 ? 0.5 : e < 0.004 ? 0.82 + 0.18 * (e - 0.0012) / 0.0028 : 1;
                out[0] *= kk; out[1] *= kk; out[2] *= kk;
                if (hit.batten) for (const end of [hit.min + 0.03, hit.max - 0.03]) for (const off of [-0.32, 0.32]) {
                    const nx = hit.c[0] + hit.d[0] * end - hit.d[1] * off * 0.06, ny = hit.c[1] + hit.d[1] * end + hit.d[0] * off * 0.06;
                    const dn = Math.hypot(x - nx, y - ny);
                    if (dn < 0.0045) { const g = 0.16 + 0.3 * (1 - dn / 0.0045) * (y < ny ? 1 : 0.4) + wear * 0.12; out[0] = g * 1.05; out[1] = g; out[2] = g * 0.92; }
                    else if (dn < 0.008) { const m = 0.75 + 0.25 * (dn - 0.0045) / 0.0035; out[0] *= m; out[1] *= m; out[2] *= m; }
                }
            } else {
                const a = o.along === 'x' ? y : x, b = o.along === 'x' ? x : y;
                const idx = Math.min(n - 1, Math.max(0, Math.floor(a / pw))), local = a - idx * pw;
                wood(local + idx * 0.31, b, out, (o.board || 0) + idx, low);
                const dd = Math.min(local, pw - local);
                painted(out, x, y, dd < 0.01 ? 0.25 : 0);
                let kk = dd < 0.0013 ? 0.28 : dd < 0.005 ? 0.62 + 0.38 * (dd - 0.0013) / 0.0037 : 1;
                if (o.gaps && dd < o.gaps) kk = 0.08;
                // Shade beside the battens and braces standing over the boards.
                let near = Infinity;
                for (const p of pieces) near = Math.min(near, -edgeDist(p.poly, x, y));
                if (near < 0.02) kk *= 0.6 + 0.4 * near / 0.02;
                out[0] *= kk; out[1] *= kk; out[2] *= kk;
            }
            if (o.marks) o.marks.apply(x, y, out);
        };
    }

    /** One crate (closed, or open with its lid pushed aside), its pieces into the lists given. */
    function crateOne(k, dims, faces, open, into) {
        const { W, H, D, tb, wt } = dims;
        const Wc = W - 2 * tb, Dc = D - 2 * tb, yT = H - tb - 0.016;
        const body = [], lid = [];
        const slat = k.r.slats;
        const shell = slat ? 0.016 : 0;
        // The boards' core (an inner dark box under slats).
        const core = CM.chamferBox([0, (tb + yT) / 2, 0], [Wc - shell * 2, yT - tb, Dc - shell * 2], 0.003, open ? ['+y'] : ['+y', '-y']);
        mapByFaces(k, core, faces);
        if (slat) CM.occlude(core, () => 0.3);
        body.push(core);
        // Each face's slabs: boards (slatted), battens and braces, painted through the face's own region.
        for (const f of [faces.front, faces.back, faces.right, faces.left]) {
            const list = f.pieces.slice();
            if (slat) for (const b of f.slats) list.push(b);
            for (const p of list) {
                const flat = []; for (const q of p.poly) flat.push(q[0], q[1]);
                const m = CM.slab(flat, p.boardSlat ? f.inner : f.F, p.boardSlat ? shell : tb, p.boardSlat ? 0.002 : 0.0035);
                mapFace(k, m, f);
                body.push(m);
            }
        }
        // The lid: boards across the top and its battens.
        const lidPanel = CM.chamferBox([0, yT + 0.008, 0], [Wc + 0.002, 0.016, Dc + 0.002], 0.003, ['-y']);
        mapFace(k, lidPanel, faces.top, true);
        lid.push(lidPanel);
        for (const p of faces.top.pieces) { const flat = []; for (const q of p.poly) flat.push(q[0], q[1]); const m = CM.slab(flat, faces.top.F, tb, 0.0035); mapFace(k, m, faces.top); lid.push(m); }
        // Skids underneath.
        for (const z of [-(Dc / 2 - dims.wb * 0.6), Dc / 2 - dims.wb * 0.6]) {
            const m = CM.chamferBox([0, tb / 2, z], [Wc, tb, dims.wb], 0.003, ['-y']);
            mapFace(k, m, faces.top);
            body.push(m);
        }
        if (open) {
            // Inside: the boards' backs in shadow, the top of the walls, straw.
            const inner = CM.chamferBox([0, (tb + yT) / 2 + 0.008, 0], [Wc - wt * 2, yT - tb - 0.016 + 0.001, Dc - wt * 2], 0, ['+y']);
            flipInside(inner);
            mapByFaces(k, inner, faces, true);
            CM.occlude(inner, (x, y) => 0.28 + 0.45 * (y - tb) / (yT - tb));
            body.push(inner);
            const g = new CM.Geo(), ow = Wc / 2, od = Dc / 2, iw = Wc / 2 - wt, id = Dc / 2 - wt;
            const ring = [[[-ow, -od], [ow, -od], [iw, -id], [-iw, -id]], [[ow, -od], [ow, od], [iw, id], [iw, -id]], [[ow, od], [-ow, od], [-iw, id], [iw, id]], [[-ow, od], [-ow, -od], [-iw, -id], [-iw, id]]];
            for (const q of ring) g.poly(q.map(p => [p[0], yT, p[1]]), q.map(p => uvAt(k, faces.top.rect, (p[0] + W / 2) / W, (p[1] + D / 2) / D)), [0, 1, 0]);
            body.push(g.done());
            const fillY = tb + (yT - tb) * 0.72, sg = new CM.Geo();
            sg.poly([[-iw, fillY, -id], [iw, fillY, -id], [iw, fillY, id], [-iw, fillY, id]], [uvAt(k, faces.straw, 0, 0), uvAt(k, faces.straw, 1, 0), uvAt(k, faces.straw, 1, 1), uvAt(k, faces.straw, 0, 1)], [0, 1, 0]);
            const straw = sg.done();
            CM.occlude(straw, () => 0.8);
            body.push(straw);
            // The lid pushed half off, turned a little, resting on the walls.
            const turn = CM.yaw(0.22, [W * 0.24, 0, D * 0.06]);
            for (const m of lid) CM.transform(m, turn.point, turn.normal);
        }
        into.body.push(...body, ...lid);
        // Rope handles through a cleat on each end.
        if (k.r.handles) for (const side of [1, -1]) {
            const x0 = side * (W / 2 - tb * 0.4), yc = faces.handleY, zh = Math.min(0.1, Dc * 0.16), drop = Math.min(0.09, H * 0.13);
            const path = [];
            path.push([x0 - side * 0.01, yc, -zh]);
            for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + Math.PI * i / 8; path.push([x0 + side * (0.016 + 0.014 * Math.cos(a)), yc - drop * Math.cos(a) * 0.9 - 0.012, zh * Math.sin(a)]); }
            path.push([x0 - side * 0.01, yc, zh]);
            const rope = CM.sweep(path, Math.max(0.0075, W * 0.011), 6, true);
            CM.mapUv(rope, (u, v) => uvAt(k, faces.rope, (u * 3) % 1, v));
            into.trim2.push(rope);
            for (const zz of [-zh, zh]) {
                const kr = Math.max(0.011, W * 0.015), knot = CM.revolve([[0, -kr], [kr, -kr * 0.6], [kr * 1.05, kr * 0.3], [0, kr * 0.5]], 7, { crease: 0.2 });
                // Its axis along x, out of the cleat; the mirror on one side is set right by the normals.
                const cx = side * (W / 2 + 0.002);
                CM.transform(knot, p => [cx + side * p[1], yc + p[0], zz + p[2]], n => [side * n[1], n[0], n[2]]);
                CM.orientOutward(knot);
                CM.mapUv(knot, () => uvAt(k, faces.rope, 0.5, 0.5));
                into.trim2.push(knot);
            }
        }
    }

    /** A box's faces turned to look inward, for an inside seen from above. */
    function flipInside(m) {
        for (let i = 0; i < m.normals.length; i++) m.normals[i] = -m.normals[i];
        for (let t = 0; t < m.index.length; t += 3) { const a = m.index[t + 1]; m.index[t + 1] = m.index[t + 2]; m.index[t + 2] = a; }
        return m;
    }

    /** A slab or box on a face, its uvs from where each point lies on that face. */
    function mapFace(k, m, f, top) {
        const P = m.positions;
        return CM.mapUv(m, (u, v, i) => {
            const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], q = sub(p, f.F.o);
            const uu = q[0] * f.F.u[0] + q[1] * f.F.u[1] + q[2] * f.F.u[2], vv = q[0] * f.F.v[0] + q[1] * f.F.v[1] + q[2] * f.F.v[2];
            return uvAt(k, f.rect, (uu - f.u0) / f.w, (f.v1 - vv) / f.h);
        });
    }

    function crate(k, options) {
        const r = k.r, ratio = RATIOS[r.proportions], W = r.width, H = Math.max(0.2, W * ratio[1]), D = Math.max(0.2, W * ratio[2]);
        const sc = Math.max(0.6, Math.min(1.5, W / 0.8));
        const tb = 0.016 + 0.006 * sc, wb = Math.min(0.075 * sc, H * 0.17, D * 0.17), wt = 0.018;
        const dims = { W, H, D, tb, wb, wt };
        const Wc = W - 2 * tb, Dc = D - 2 * tb;
        const wood = CP.wood(r.color, r.seed, r.wear);
        const paint = r.finish === 'painted' ? r.color : null;
        const woodFn = paint ? CP.wood('#8a6a46', r.seed, r.wear) : wood;
        const img = marksImage(k, options);
        const dens = Math.min(k.S * 0.42 / Math.max(W, H), k.S * 0.42 / Math.max(D, H) * 1.0, k.S * 0.3 / D);
        const handleY = H * 0.66;
        const faces = {};
        const planksOf = len => Math.max(2, Math.round(len / 0.13));
        // Front and back: battens at the edges, braces between.
        const sideFrame = (o, u, v) => CM.frame(o, u, v);
        const make = (name, F, u0, u1, hasBrace, cleat, inset) => {
            const v0 = 0, v1 = H - tb, pieces = [];
            pieces.push({ poly: rectPoly(u0, v0, u0 + wb, v1), dir: [0, 1], batten: true }, { poly: rectPoly(u1 - wb, v0, u1, v1), dir: [0, 1], batten: true });
            pieces.push({ poly: rectPoly(u0 + wb, v0, u1 - wb, v0 + wb), dir: [1, 0], batten: true }, { poly: rectPoly(u0 + wb, v1 - wb, u1 - wb, v1), dir: [1, 0], batten: true });
            if (cleat) pieces.push({ poly: rectPoly(u0 + wb, handleY - wb / 2, u1 - wb, handleY + wb / 2), dir: [1, 0], batten: true });
            else if (hasBrace) for (const b of braces(r.brace, u0 + wb, v0 + wb, u1 - wb, v1 - wb, wb * 0.92)) pieces.push(b);
            // Slats: the boards themselves, a gap between each.
            const slats = [];
            const n = planksOf(v1 - tb), ph = (v1 - tb) / n;
            for (let i = 0; i < n; i++) slats.push({ poly: rectPoly(u0 + inset, tb + i * ph + 0.006, u1 - inset, tb + (i + 1) * ph - 0.006), dir: [1, 0], boardSlat: true });
            const inner = CM.frame(sub(F.o, scale(F.n, 0.016)), F.u, F.v);
            return { name, F, inner, u0, u1, v0, v1, w: u1 - u0, h: v1 - v0, pieces, slats };
        };
        faces.front = make('front', sideFrame([0, 0, Dc / 2], [1, 0, 0], [0, 1, 0]), -W / 2, W / 2, true, false, tb);
        faces.back = make('back', sideFrame([0, 0, -Dc / 2], [-1, 0, 0], [0, 1, 0]), -W / 2, W / 2, true, false, tb);
        faces.right = make('right', sideFrame([Wc / 2, 0, 0], [0, 0, -1], [0, 1, 0]), -Dc / 2, Dc / 2, true, r.handles, 0);
        faces.left = make('left', sideFrame([-Wc / 2, 0, 0], [0, 0, 1], [0, 1, 0]), -Dc / 2, Dc / 2, true, r.handles, 0);
        // The top: battens around its edge, one across a long top.
        {
            const F = CM.frame([0, H - tb, 0], [1, 0, 0], [0, 0, -1]);
            const pieces = [
                { poly: rectPoly(-W / 2, -D / 2, W / 2, -D / 2 + wb), dir: [1, 0], batten: true }, { poly: rectPoly(-W / 2, D / 2 - wb, W / 2, D / 2), dir: [1, 0], batten: true },
                { poly: rectPoly(-W / 2, -D / 2 + wb, -W / 2 + wb, D / 2 - wb), dir: [0, 1], batten: true }, { poly: rectPoly(W / 2 - wb, -D / 2 + wb, W / 2, D / 2 - wb), dir: [0, 1], batten: true }
            ];
            if (W > D * 1.4) pieces.push({ poly: rectPoly(-wb / 2, -D / 2 + wb, wb / 2, D / 2 - wb), dir: [0, 1], batten: true });
            faces.top = { name: 'top', F, u0: -W / 2, u1: W / 2, v0: -D / 2, v1: D / 2, w: W, h: D, pieces, slats: [] };
        }
        // Pictures: each face with its boards, battens and braces; the markings on the front and the ends.
        const markBox = (fw, fh) => { const h = Math.min(fh * 0.2, fw * 0.16), w = fw * 0.72; return { x: (fw - w) / 2, y: fh * 0.42 - h / 2, w, h }; };
        const low = y => CP.smooth(H - 0.12, H, y);
        for (const f of [faces.front, faces.back, faces.right, faces.left, faces.top]) {
            const marked = f.name === 'front' || ((f.name === 'right' || f.name === 'left') && !r.handles);
            const fh = f.h;
            const marks = marked && (r.marks.text || r.marks.symbol !== 'none' || r.marks.image) ? CP.markings(r.marks, markBox(f.w, fh), { wear: r.wear, seed: r.seed + f.name.length, image: img, pixel: 1 / dens }) : null;
            const top = f.name === 'top';
            f.rect = paintRegion(k, px(dens, f.w), px(dens, fh), boardFace(k, {
                w: f.w, h: fh, u0: f.u0, v1: f.v1, pieces: f.pieces, planks: planksOf(top ? D : H), along: 'x', wood: woodFn, paint, board: { front: 0, back: 20, right: 40, left: 60, top: 80 }[f.name],
                marks, low: top ? null : low, gaps: 0
            }));
        }
        // Slat boards are drawn by their face's picture too: no battens on them, so they read as boards.
        faces.rope = paintRegion(k, 96, 24, (s, t, out) => CP.rope('#b39a6c', r.seed)(s, t, out));
        faces.straw = r.open ? paintRegion(k, px(dens, W, 256), px(dens, D, 256), (s, t, out) => CP.straw(r.seed)(s * W * 3, t * D * 3, out)) : null;
        faces.handleY = handleY;
        const into = { body: [], trim2: [] };
        const copies = r.stack === 'two' ? [[0, 0, 0, 0], [0.012, H, -0.01, 0.07]] : r.stack === 'three' ? [[-W / 2 - 0.012, 0, 0, -0.03], [W / 2 + 0.012, 0, 0.02, 0.04], [0.01, H, 0.005, 0.1]] : [[0, 0, 0, 0]];
        const one = { body: [], trim2: [] };
        crateOne(k, dims, faces, r.open, one);
        for (const [x, y, z, a] of copies) {
            const t = CM.yaw(a, [x, y, z]);
            for (const m of one.body) into.body.push(CM.transform(CM.copy(m), t.point, t.normal));
            for (const m of one.trim2) into.body.push(CM.transform(CM.copy(m), t.point, t.normal));
        }
        k.body.push(...into.body);
        return { height: H * (r.stack === 'one' ? 1 : 2) };
    }

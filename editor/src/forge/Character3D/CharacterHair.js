/**
 * RRCharacterHair - the Character Builder's hair, facial hair and brows,
 * grown on the shaped body (RRHumanBody.build) so every style follows every
 * slider, an exaggerated head or neck included.
 *
 * Everything is measured from the shaped vertices: the skull's center and
 * size, the eyes (MakeHuman's eye helpers), the ears, brows and lips (the
 * vertices MakeHuman's own ear, brow and lip targets move). A style is a
 * list of layers:
 *   cap     a shell over the scalp, cut at a hairline (a field over the
 *           head's vertices, clipped, so the edge is smooth) and tapered to
 *           nothing at the edge, so no scalp shows between clumps;
 *   strands clumps grown from scalp roots: combed from a part or crown,
 *           hugging the skull, then falling under gravity, kept outside the
 *           body (nearest body vertex and its normal) and off the face, cut
 *           at a length or height, waved or curled, meshed as tapered
 *           flattened tubes with a root-to-tip color ramp;
 *   tail / bun / braid / spikes / locks: gathered and shaped pieces.
 * Facial hair uses the same machinery on the jaw, chin and upper lip.
 *
 * Parts come out in RRCharacterGlb's part format, rigid on the Head bone;
 * hair below the shoulders blends toward Neck and Spine2.
 *
 * No DOM and no three.js: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    // ── catalogs ───────────────────────────────────────────────────────────
    const STYLES = [
        { id: 'bald', label: 'Bald', group: 'Short hair' },
        { id: 'buzz', label: 'Buzz cut', group: 'Short hair' },
        { id: 'crew', label: 'Crew cut', group: 'Short hair' },
        { id: 'sidePart', label: 'Side part', group: 'Short hair' },
        { id: 'undercut', label: 'Undercut', group: 'Short hair' },
        { id: 'quiff', label: 'Quiff', group: 'Short hair' },
        { id: 'pompadour', label: 'Pompadour', group: 'Short hair' },
        { id: 'slickBack', label: 'Slicked back', group: 'Short hair' },
        { id: 'spiky', label: 'Spiky', group: 'Short hair' },
        { id: 'messy', label: 'Messy', group: 'Short hair' },
        { id: 'pixie', label: 'Pixie', group: 'Short hair' },
        { id: 'curlyShort', label: 'Short curls', group: 'Short hair' },
        { id: 'mohawk', label: 'Mohawk', group: 'Short hair' },
        { id: 'mohawkFlat', label: 'Flat mohawk', group: 'Short hair' },
        { id: 'mullet', label: 'Mullet', group: 'Medium hair' },
        { id: 'bob', label: 'Bob cut', group: 'Medium hair' },
        { id: 'shag', label: 'Shaggy', group: 'Medium hair' },
        { id: 'shoulder', label: 'Shoulder length', group: 'Medium hair' },
        { id: 'sweptBangs', label: 'Side-swept bangs', group: 'Medium hair' },
        { id: 'afro', label: 'Afro', group: 'Medium hair' },
        { id: 'curly', label: 'Curly', group: 'Medium hair' },
        { id: 'animeSpikes', label: 'Anime spikes', group: 'Medium hair' },
        { id: 'long', label: 'Long straight', group: 'Long hair' },
        { id: 'longWavy', label: 'Long wavy', group: 'Long hair' },
        { id: 'veryLong', label: 'Very long', group: 'Long hair' },
        { id: 'hime', label: 'Hime cut', group: 'Long hair' },
        { id: 'dreadlocks', label: 'Dreadlocks', group: 'Long hair' },
        { id: 'ponytail', label: 'Ponytail', group: 'Tied hair' },
        { id: 'ponytailLow', label: 'Low ponytail', group: 'Tied hair' },
        { id: 'pigtails', label: 'Pigtails', group: 'Tied hair' },
        { id: 'bun', label: 'Top bun', group: 'Tied hair' },
        { id: 'bunLow', label: 'Low bun', group: 'Tied hair' },
        { id: 'topKnot', label: 'Top knot', group: 'Tied hair' },
        { id: 'braid', label: 'Braid', group: 'Tied hair' },
        { id: 'twinBraids', label: 'Twin braids', group: 'Tied hair' }
    ];

    const FACIAL = [
        { id: 'none', label: 'None', group: 'None' },
        { id: 'stubble', label: 'Stubble', group: 'Beard' },
        { id: 'goatee', label: 'Goatee', group: 'Beard' },
        { id: 'chinStrap', label: 'Chin strap', group: 'Beard' },
        { id: 'shortBeard', label: 'Short beard', group: 'Beard' },
        { id: 'fullBeard', label: 'Full beard', group: 'Beard' },
        { id: 'longBeard', label: 'Long beard', group: 'Beard' },
        { id: 'wizardBeard', label: 'Wizard beard', group: 'Beard' },
        { id: 'braidedBeard', label: 'Braided beard', group: 'Beard' },
        { id: 'muttonChops', label: 'Mutton chops', group: 'Beard' },
        { id: 'mustache', label: 'Mustache', group: 'Mustache' },
        { id: 'pencil', label: 'Pencil mustache', group: 'Mustache' },
        { id: 'handlebar', label: 'Handlebar', group: 'Mustache' },
        { id: 'walrus', label: 'Walrus', group: 'Mustache' },
        { id: 'horseshoe', label: 'Horseshoe', group: 'Mustache' }
    ];

    const BROWS = [
        { id: 'none', label: 'None' },
        { id: 'natural', label: 'Natural' },
        { id: 'thin', label: 'Thin' },
        { id: 'thick', label: 'Thick' },
        { id: 'arched', label: 'Arched brows' },
        { id: 'straight', label: 'Straight' },
        { id: 'angry', label: 'Angled' },
        { id: 'bushy', label: 'Bushy' }
    ];

    const PARTS = ['center', 'left', 'right', 'none'];

    const DEFAULT_HAIR = Object.freeze({
        style: 'sidePart',
        color: '#3b2a1e',
        tipColor: '',
        highlights: 0,
        length: 1,
        volume: 0.5,
        curl: 0,
        part: 'left',
        fringe: 0.5,
        hairline: 0,
        facial: Object.freeze({ style: 'none', color: '', length: 1, volume: 0.5 }),
        brows: Object.freeze({ style: 'natural', thickness: 0.5, color: '' }),
        lashes: true
    });

    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : lo));
    const hexOk = h => /^#[0-9a-f]{6}$/i.test(h || '');
    const pickId = (list, id, fallback) => (list.some(s => s.id === id) ? id : fallback);

    /** A full hair recipe from a partial one: every field present and in range. */
    function normalizeHair(input) {
        const h = input || {};
        const f = h.facial || {}, b = h.brows || {};
        return {
            style: pickId(STYLES, h.style, DEFAULT_HAIR.style),
            color: hexOk(h.color) ? h.color.toLowerCase() : DEFAULT_HAIR.color,
            tipColor: hexOk(h.tipColor) ? h.tipColor.toLowerCase() : '',
            highlights: clamp(h.highlights ?? 0, 0, 1),
            length: clamp(h.length ?? 1, 0.3, 2.5),
            volume: clamp(h.volume ?? 0.5, 0, 1),
            curl: clamp(h.curl ?? 0, 0, 1),
            part: PARTS.includes(h.part) ? h.part : DEFAULT_HAIR.part,
            fringe: clamp(h.fringe ?? 0.5, 0, 1),
            hairline: clamp(h.hairline ?? 0, 0, 1),
            facial: {
                style: pickId(FACIAL, f.style, 'none'),
                color: hexOk(f.color) ? f.color.toLowerCase() : '',
                length: clamp(f.length ?? 1, 0.3, 2.5),
                volume: clamp(f.volume ?? 0.5, 0, 1)
            },
            brows: {
                style: pickId(BROWS, b.style, 'natural'),
                thickness: clamp(b.thickness ?? 0.5, 0, 1),
                color: hexOk(b.color) ? b.color.toLowerCase() : ''
            },
            lashes: h.lashes !== false
        };
    }

    // ── small math ─────────────────────────────────────────────────────────
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => a + (b - a) * t;

    /** Seeded xorshift: the same recipe grows the same hair. */
    function rng(seed) {
        let s = (seed >>> 0) || 0x9e3779b9;
        return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    }
    const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

    const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const hexRgb = hex => { const n = parseInt(String(hex).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const linear = hex => hexRgb(hex).map(srgbToLinear);
    const shadeRgb = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const mixHex = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return '#' + [0, 1, 2].map(k => Math.round(mix(x[k], y[k], t) * 255).toString(16).padStart(2, '0')).join(''); };
    const mixRgb = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

    // ── the head, measured ─────────────────────────────────────────────────
    function boneIndex(built, name) { return built.bones.findIndex(b => b.name === name); }

    /** Vertex ids a target moves by at least `share` of its largest move. */
    function targetVerts(pack, name, share) {
        const t = pack.targets.get(name);
        if (!t) return [];
        let max = 0;
        const mags = new Float32Array(t.index.length);
        for (let i = 0; i < t.index.length; i++) { mags[i] = Math.hypot(t.delta[i * 3], t.delta[i * 3 + 1], t.delta[i * 3 + 2]); max = Math.max(max, mags[i]); }
        const out = [];
        for (let i = 0; i < t.index.length; i++) if (mags[i] >= max * share) out.push(t.index[i]);
        return out;
    }

    /** Everything about the shaped head a style needs; built once per build. */
    function measure(pack, built) {
        const S = built.shaped;
        const P = v => [S[v * 3], S[v * 3 + 1], S[v * 3 + 2]];
        const J = pack.skinJoints, W = pack.skinWeights;
        const head = boneIndex(built, 'Head'), neck = boneIndex(built, 'Neck'), chest = boneIndex(built, 'Spine2');
        const weightOn = (v, j) => { let w = 0; for (let k = 0; k < 4; k++) if (J[v * 4 + k] === j) w += W[v * 4 + k]; return w; };
        const bodySet = new Uint8Array(pack.vertexCount);
        for (const v of pack.body.source) bodySet[v] = 1;
        const normals = root.RRHumanBody ? root.RRHumanBody.vertexNormals(pack, S) : vertexNormals(pack, S);
        const meanOf = (a, z) => { let s = [0, 0, 0]; for (let v = a; v <= z; v++) s = add(s, P(v)); return mul(s, 1 / (z - a + 1)); };
        const spreadOf = (a, z, c) => { let m = 0; for (let v = a; v <= z; v++) m = Math.max(m, len(sub(P(v), c))); return m; };
        const eyeL = meanOf(14598, 14669), eyeR = meanOf(14670, 14741);
        const eyeRadius = spreadOf(14598, 14669, eyeL);
        const mouth = lerp(meanOf(15060, 15127), meanOf(14992, 15059), 0.5);
        const eyeY = (eyeL[1] + eyeR[1]) / 2;

        // Skull: head vertices above the eyes.
        let top = -Infinity, minZ = Infinity, maxZ = -Infinity, rx = 0, sumX = 0, n = 0;
        const headVerts = [];
        for (let v = 0; v < pack.vertexCount; v++) {
            if (!bodySet[v]) continue;
            const wh = weightOn(v, head), wn = weightOn(v, neck);
            if (wh + wn < 0.45) continue;
            headVerts.push(v);
            if (wh < 0.6) continue;
            const p = P(v);
            top = Math.max(top, p[1]);
            if (p[1] > eyeY + 0.25 * eyeRadius * 4) { minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); sumX += p[0]; n++; }
        }
        const ry0 = top - eyeY;
        for (const v of headVerts) {
            const p = P(v);
            if (weightOn(v, head) > 0.6 && p[1] > eyeY + ry0 * 0.35) rx = Math.max(rx, Math.abs(p[0]));
        }
        const center = [n ? sumX / n : 0, eyeY - ry0 * 0.05, (minZ + maxZ) / 2];
        const radii = [rx, top - center[1], (maxZ - minZ) / 2];

        // Features from MakeHuman's own targets.
        const ears = new Uint8Array(pack.vertexCount);
        for (const v of targetVerts(pack, 'shape/earSize-incr', 0.25)) {
            if (Math.abs(S[v * 3] - center[0]) > radii[0] * 0.8 && S[v * 3 + 2] < center[2] + radii[2] * 0.45) ears[v] = 1;
        }
        const lips = new Uint8Array(pack.vertexCount);
        for (const name of ['shape/upperLip-incr', 'shape/lowerLip-incr']) for (const v of targetVerts(pack, name, 0.1)) lips[v] = 1;
        let earBottom = Infinity, earTop = -Infinity, earBack = Infinity, earFront = -Infinity;
        for (let v = 0; v < pack.vertexCount; v++) if (ears[v]) {
            earBottom = Math.min(earBottom, S[v * 3 + 1]); earTop = Math.max(earTop, S[v * 3 + 1]);
            earBack = Math.min(earBack, S[v * 3 + 2]); earFront = Math.max(earFront, S[v * 3 + 2]);
        }
        if (!Number.isFinite(earBottom)) { earBottom = eyeY - radii[1] * 0.45; earTop = eyeY + radii[1] * 0.2; earBack = center[2] - radii[2] * 0.3; earFront = center[2] + radii[2] * 0.1; }
        let chin = mouth;
        for (const v of targetVerts(pack, 'shape/chin-incr', 0.3)) if (S[v * 3 + 1] < chin[1]) chin = P(v);
        let lipTop = -Infinity, lipBottom = Infinity, lipFront = -Infinity, lipHalf = 0;
        for (let v = 0; v < pack.vertexCount; v++) if (lips[v]) {
            lipTop = Math.max(lipTop, S[v * 3 + 1]); lipBottom = Math.min(lipBottom, S[v * 3 + 1]);
            lipFront = Math.max(lipFront, S[v * 3 + 2]); lipHalf = Math.max(lipHalf, Math.abs(S[v * 3]));
        }
        let noseTip = mouth;
        for (const v of headVerts) { const p = P(v); if (p[1] > mouth[1] && p[1] < eyeY && Math.abs(p[0]) < 0.012 && p[2] > noseTip[2]) noseTip = p; }
        const neckBone = built.bones[neck], headBone = built.bones[head], chestBone = built.bones[chest];
        // The shoulder line, for where long hair stops hugging the neck.
        let shoulderY = neckBone.head[1], shoulderHalf = 0;
        for (const name of ['LeftArm', 'RightArm']) {
            const b = built.bones[boneIndex(built, name)];
            if (b) { shoulderY = Math.min(shoulderY, b.head[1]); shoulderHalf = Math.max(shoulderHalf, Math.abs(b.head[0])); }
        }
        if (!shoulderHalf) shoulderHalf = 0.18;

        // A spatial hash of the body's vertices, for keeping hair outside it.
        const cell = Math.max(0.012, radii[1] * 0.18);
        const grid = new Map();
        const key = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);
        for (let v = 0; v < pack.vertexCount; v++) {
            if (!bodySet[v] || (normals[v * 3] === 0 && normals[v * 3 + 1] === 0 && normals[v * 3 + 2] === 0)) continue;
            const k = key(Math.floor(S[v * 3] / cell), Math.floor(S[v * 3 + 1] / cell), Math.floor(S[v * 3 + 2] / cell));
            let list = grid.get(k);
            if (!list) grid.set(k, (list = []));
            list.push(v);
        }
        const nearest = (p, reach = 1) => {
            const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell);
            let best = -1, bd = Infinity;
            for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) for (let dz = -reach; dz <= reach; dz++) {
                const list = grid.get(key(cx + dx, cy + dy, cz + dz));
                if (!list) continue;
                for (const v of list) {
                    const ex = S[v * 3] - p[0], ey = S[v * 3 + 1] - p[1], ez = S[v * 3 + 2] - p[2];
                    const d = ex * ex + ey * ey + ez * ez;
                    if (d < bd) { bd = d; best = v; }
                }
            }
            return best < 0 && reach === 1 ? nearest(p, 2) : best;
        };
        /** Signed distance off the body along the nearest vertex's normal (Infinity when nothing is near). */
        const surface = p => {
            const v = nearest(p);
            if (v < 0) return { d: Infinity, v: -1 };
            const n3 = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
            return { d: dot(sub(p, P(v)), n3), v, n: n3, p: P(v) };
        };

        return {
            pack, built, S, P, normals, weightOn, bodySet, headVerts, ears, lips,
            bones: { head, neck, chest, spine1: boneIndex(built, 'Spine1') },
            headBone, neckBone, chestBone, shoulderY, shoulderHalf,
            center, radii, eyeL, eyeR, eyeY, eyeRadius, mouth, chin, noseTip,
            earBottom, earTop, earBack, earFront, lipTop, lipBottom, lipFront, lipHalf,
            nearest, surface, cell,
            scale: radii[1] / 0.11
        };
    }

    function vertexNormals(pack, S) {
        const n = new Float32Array(pack.vertexCount * 3);
        const src = pack.body.source, index = pack.body.index;
        for (let t = 0; t < index.length; t += 3) {
            const a = src[index[t]] * 3, b = src[index[t + 1]] * 3, c = src[index[t + 2]] * 3;
            const u = [S[b] - S[a], S[b + 1] - S[a + 1], S[b + 2] - S[a + 2]], w = [S[c] - S[a], S[c + 1] - S[a + 1], S[c + 2] - S[a + 2]];
            const f = cross(u, w);
            for (const s of [a, b, c]) { n[s] += f[0]; n[s + 1] += f[1]; n[s + 2] += f[2]; }
        }
        for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]); if (l > 0) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; } }
        return n;
    }

    /** Head-relative coordinates of a point: normalized offsets, azimuth (0 front, + toward the character's left) and elevation, degrees. */
    function headCoords(H, p) {
        const q = [(p[0] - H.center[0]) / H.radii[0], (p[1] - H.center[1]) / H.radii[1], (p[2] - H.center[2]) / H.radii[2]];
        const az = Math.atan2(q[0], q[2]) * 180 / Math.PI;
        const el = Math.atan2(q[1], Math.hypot(q[0], q[2])) * 180 / Math.PI;
        return { q, az, el, x: q[0], y: q[1], z: q[2] };
    }

    // ── surfaces cut from the body ─────────────────────────────────────────
    /**
     * The body's faces over the head and neck where `field(v)` is positive,
     * cut along field = 0 (edge points shared, so the cut is watertight).
     * Returns { pos: [[x,y,z]], nrm, val, index } with `val` the field value.
     */
    function cutSurface(H, field) {
        const pack = H.pack, src = pack.body.source, index = pack.body.index;
        const values = new Map();
        const valueOf = v => { let f = values.get(v); if (f === undefined) { f = field(v); values.set(v, f); } return f; };
        const candidate = new Uint8Array(pack.vertexCount);
        for (const v of H.headVerts) candidate[v] = 1;
        const pos = [], nrm = [], val = [], out = [];
        const vmap = new Map(), emap = new Map();
        const vert = v => {
            let i = vmap.get(v);
            if (i === undefined) { i = pos.length; vmap.set(v, i); pos.push(H.P(v)); nrm.push([H.normals[v * 3], H.normals[v * 3 + 1], H.normals[v * 3 + 2]]); val.push(valueOf(v)); }
            return i;
        };
        const edge = (a, b) => {
            const k = a < b ? a * 65536 + b : b * 65536 + a;
            let i = emap.get(k);
            if (i === undefined) {
                const fa = valueOf(a), fb = valueOf(b), t = fa / (fa - fb);
                i = pos.length; emap.set(k, i);
                pos.push(lerp(H.P(a), H.P(b), t));
                nrm.push(norm(lerp([H.normals[a * 3], H.normals[a * 3 + 1], H.normals[a * 3 + 2]], [H.normals[b * 3], H.normals[b * 3 + 1], H.normals[b * 3 + 2]], t)));
                val.push(0);
            }
            return i;
        };
        for (let t = 0; t < index.length; t += 3) {
            const tri = [src[index[t]], src[index[t + 1]], src[index[t + 2]]];
            if (!candidate[tri[0]] || !candidate[tri[1]] || !candidate[tri[2]]) continue;
            const f = tri.map(valueOf);
            const inside = f.map(x => x > 0);
            const count = inside.filter(Boolean).length;
            if (count === 0) continue;
            if (count === 3) { out.push(vert(tri[0]), vert(tri[1]), vert(tri[2])); continue; }
            // Walk the triangle keeping the inside part (a triangle or a quad).
            const poly = [];
            for (let k = 0; k < 3; k++) {
                const a = tri[k], b = tri[(k + 1) % 3];
                if (inside[k]) poly.push(vert(a));
                if (inside[k] !== inside[(k + 1) % 3]) poly.push(edge(a, b));
            }
            for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0], poly[k], poly[k + 1]);
        }
        return { pos, nrm, val, index: out };
    }

    // ── mesh builder ───────────────────────────────────────────────────────
    function meshBuilder() {
        return { pos: [], nrm: [], col: [], idx: [] };
    }
    const pushVert = (m, p, n, c) => { m.pos.push(p[0], p[1], p[2]); m.nrm.push(n[0], n[1], n[2]); m.col.push(c[0], c[1], c[2]); return m.pos.length / 3 - 1; };

    /** A shell over a cut surface: each point raised by `lift(i)` along its normal, colored by `color(i)`. */
    function addShell(m, surf, lift, color) {
        const base = m.pos.length / 3;
        for (let i = 0; i < surf.pos.length; i++) pushVert(m, add(surf.pos[i], mul(surf.nrm[i], lift(i))), surf.nrm[i], color(i));
        for (let t = 0; t < surf.index.length; t += 3) m.idx.push(base + surf.index[t], base + surf.index[t + 1], base + surf.index[t + 2]);
        return base;
    }

    /**
     * A clump along `pts`: a flattened tube whose wide side lies across the
     * hair (perpendicular to `out`, the direction away from the head),
     * `width` at the root tapering to a point. Colors ramp root → tip.
     */
    function addClump(m, pts, opts) {
        const n = pts.length;
        if (n < 2) return;
        const sides = opts.sides || 4;
        const w0 = opts.width, flat = opts.flat ?? 0.35;
        const base = m.pos.length / 3;
        let prevB = null;
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const T = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
            let out = opts.outAt ? opts.outAt(pts[i], i) : norm(sub(pts[i], opts.center));
            let B = cross(T, out);
            if (len(B) < 1e-6) B = prevB || cross(T, [0, 0, 1]);
            B = norm(B);
            if (prevB && dot(B, prevB) < 0) B = mul(B, -1);
            prevB = B;
            const N = norm(cross(B, T));
            const taper = opts.taper ? opts.taper(t) : (1 - Math.pow(t, 1.6) * 0.92);
            const w = w0 * taper, h = w * flat;
            const col = opts.color(t);
            for (let s = 0; s < sides; s++) {
                const a = (s / sides) * Math.PI * 2;
                const ca = Math.cos(a), sa = Math.sin(a);
                const offset = add(mul(B, ca * w * 0.5), mul(N, sa * h * 0.5));
                const normal = norm(add(mul(B, ca / Math.max(w, 1e-5)), mul(N, sa / Math.max(h, 1e-5))));
                // The side facing the head is darker: it is in the clump's own shadow.
                const shade = 0.72 + 0.28 * (0.5 + 0.5 * sa);
                pushVert(m, add(pts[i], offset), normal, shadeRgb(col, shade));
            }
        }
        for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
            const a = base + i * sides + s, b = base + i * sides + (s + 1) % sides;
            const c = a + sides, d = b + sides;
            m.idx.push(a, c, b, b, c, d);
        }
        // Root cap.
        const rc = pushVert(m, pts[0], norm(sub(pts[0], pts[1])), opts.color(0));
        for (let s = 0; s < sides; s++) m.idx.push(rc, base + s, base + (s + 1) % sides);
    }

    /** A tube of round section `radius(t)` along `pts` (braids, locks, tails). */
    function addTube(m, pts, radius, color, sides = 6) {
        addClump(m, pts, { width: 2, flat: 1, sides, center: [0, 0, 0], outAt: (p, i) => {
            const T = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
            const up = Math.abs(T[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
            return norm(cross(T, up));
        }, taper: t => radius(t), color });
    }

    /** An ellipsoid blob (bun, knot), lumpy by `lumps`. */
    function addBlob(m, c, r, color, rand, lumps = 0.12, rows = 10, cols = 16) {
        const base = m.pos.length / 3;
        const seeds = Array.from({ length: 7 }, () => [rand() * 6.28, rand() * 6.28, 2 + Math.floor(rand() * 4)]);
        for (let i = 0; i <= rows; i++) {
            const th = (i / rows) * Math.PI;
            for (let j = 0; j < cols; j++) {
                const ph = (j / cols) * Math.PI * 2;
                const d = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
                let k = 1;
                for (const [a, b, f] of seeds) k += lumps * Math.sin(th * f + a) * Math.cos(ph * f + b) / seeds.length * 3;
                const p = add(c, [d[0] * r[0] * k, d[1] * r[1] * k, d[2] * r[2] * k]);
                pushVert(m, p, d, shadeRgb(color, 0.82 + 0.18 * d[1]));
            }
        }
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const a = base + i * cols + j, b = base + i * cols + (j + 1) % cols, c2 = a + cols, d = b + cols;
            m.idx.push(a, b, c2, b, d, c2);
        }
    }

    // ── strands ────────────────────────────────────────────────────────────
    /**
     * Grows one strand from `root` (on the scalp, normal `n`): first along
     * `dir`, hugging the head while above `release`, then falling under
     * gravity; always kept `layer` off the body and off the face.
     */
    function grow(H, root, n, dir, o) {
        const steps = o.steps || 10;
        // Simulated in short steps (a skull is only a few centimeters round), meshed at `steps`.
        const sim = Math.max(steps, Math.ceil(o.length / (0.011 * H.scale)));
        const seg = o.length / sim;
        const pts = [add(root, mul(n, o.layer * 0.4))];
        let d = norm(add(mul(dir, 1 - o.lift), mul(n, o.lift)));
        const down = [0, -1, 0];
        const depth = len(sub(root, H.center));
        for (let i = 1; i <= sim; i++) {
            const t = i / sim;
            const prev = pts[pts.length - 1];
            const g = o.gravity * smooth(0, o.stiff, t) * (seg / (o.length / steps));
            d = norm(add(mul(d, 1 - g), mul(down, g)));
            if (o.bias) d = norm(add(d, mul(o.bias, 0.25 * smooth(0, 0.6, t) * (seg / (o.length / steps)))));
            let p = add(prev, mul(d, seg));
            // Keep off the body; above the release height, also keep close to it (the hair lies on the head).
            let resting = false;
            for (let k = 0; k < 2; k++) {
                const s = H.surface(p);
                if (!Number.isFinite(s.d)) {
                    // Nothing near: above the release height, steer back toward the head.
                    if (o.hug > 0 && p[1] > o.release) p = lerp(p, add(H.center, mul(norm(sub(p, H.center)), len(sub(prev, H.center)))), 0.5 * o.hug);
                    break;
                }
                const want = o.layer;
                if (s.d < want) { p = add(p, mul(s.n, want - s.d)); if (s.n[1] > 0.35 && p[1] < H.earBottom) resting = true; }
                else if (o.hug > 0 && p[1] > o.release && s.d < want + 0.05 * H.scale) p = add(p, mul(s.n, -(s.d - want) * o.hug * (1 - t * 0.5)));
            }
            // Hair landing on a shoulder slides off it, behind (or in front, for locks that frame the face),
            // and never travels out along the shoulder toward the arm.
            if (p[1] < H.earBottom) {
                const limit = H.shoulderHalf * mix(0.62, 0.5, smooth(H.shoulderY, H.shoulderY - 0.15 * H.scale, p[1]));
                const dx = p[0] - H.center[0];
                if (Math.abs(dx) > limit) p = [H.center[0] + Math.sign(dx) * limit, p[1], p[2]];
                if (resting) p = add(p, mul(o.front ? AXIS.front : AXIS.back, seg * 0.8));
            }
            if (!o.fringe) p = keepOffFace(H, p, root);
            // Hair never dives deeper toward the head's middle than its own root: a strand caught in a
            // hollow (the mouth's inside) stops there.
            if (len(sub(p, H.center)) < depth - 0.015 * H.scale) break;
            if (o.stopY != null && p[1] < o.stopY) { pts.push(lerp(prev, p, clamp((prev[1] - o.stopY) / Math.max(1e-6, prev[1] - p[1]), 0, 1))); break; }
            pts.push(p);
            d = norm(sub(p, prev));
        }
        return resample(pts, steps);
    }

    /** `count` + 1 points spaced evenly along a polyline, ends kept. */
    function resample(pts, count) {
        if (pts.length <= count + 1) return pts;
        const acc = [0];
        for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + len(sub(pts[i], pts[i - 1])));
        const total = acc[acc.length - 1], out = [pts[0]];
        let j = 1;
        for (let k = 1; k < count; k++) {
            const want = (k / count) * total;
            while (j < acc.length - 1 && acc[j] < want) j++;
            const t = (want - acc[j - 1]) / Math.max(1e-9, acc[j] - acc[j - 1]);
            out.push(lerp(pts[j - 1], pts[j], t));
        }
        out.push(pts[pts.length - 1]);
        return out;
    }

    /** Strands that are not a fringe stay out of a box in front of the face: pushed to its sides. */
    function keepOffFace(H, p, root) {
        const halfW = (Math.abs(H.eyeL[0] - H.eyeR[0]) / 2 + H.eyeRadius * 2.4);
        const top = H.eyeY + H.eyeRadius * 2.2, bottom = H.chin[1] - H.radii[1] * 0.15;
        const front = H.center[2] + H.radii[2] * 0.35;
        if (p[1] > top || p[1] < bottom || p[2] < front) return p;
        const dx = p[0] - H.center[0];
        if (Math.abs(dx) >= halfW) return p;
        const side = Math.abs(dx) > 1e-4 ? Math.sign(dx) : (Math.sign(root[0] - H.center[0]) || 1);
        // Toward the side, a little back, so it frames the face instead of flattening onto the cheek.
        return [H.center[0] + side * halfW, p[1], Math.min(p[2], front + (halfW - Math.abs(dx)) * 0.15)];
    }

    /** Waves or curls laid over a strand: offsets across it, growing from the root. */
    function curlStrand(H, pts, amount, period, helix, phase) {
        if (amount <= 0) return pts;
        const out = [pts[0]];
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            acc += len(sub(pts[i], pts[i - 1]));
            const T = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[i - 1]));
            const away = norm(sub(pts[i], H.center));
            const B = norm(cross(T, away));
            const N = cross(B, T);
            const a = (acc / period) * Math.PI * 2 + phase;
            const grow = smooth(0, period * 0.8, acc) * amount;
            const off = helix ? add(mul(B, Math.cos(a) * grow), mul(N, Math.sin(a) * grow)) : mul(B, Math.sin(a) * grow);
            out.push(add(pts[i], off));
        }
        return out;
    }

    /** Roots scattered over a cut surface, area-weighted, each with its normal and field value. */
    function scatter(surf, count, rand) {
        const areas = [];
        let total = 0;
        for (let t = 0; t < surf.index.length; t += 3) {
            const a = surf.pos[surf.index[t]], b = surf.pos[surf.index[t + 1]], c = surf.pos[surf.index[t + 2]];
            total += len(cross(sub(b, a), sub(c, a))) / 2;
            areas.push(total);
        }
        const out = [];
        if (!total) return out;
        // Stratified: one root per equal slice of area, jittered.
        for (let i = 0; i < count; i++) {
            const target = ((i + rand()) / count) * total;
            let lo = 0, hi = areas.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid] < target) lo = mid + 1; else hi = mid; }
            const t = lo * 3;
            let u = rand(), v = rand();
            if (u + v > 1) { u = 1 - u; v = 1 - v; }
            const ia = surf.index[t], ib = surf.index[t + 1], ic = surf.index[t + 2];
            const p = add(add(mul(surf.pos[ia], 1 - u - v), mul(surf.pos[ib], u)), mul(surf.pos[ic], v));
            const n = norm(add(add(mul(surf.nrm[ia], 1 - u - v), mul(surf.nrm[ib], u)), mul(surf.nrm[ic], v)));
            out.push({ p, n, f: surf.val[ia] * (1 - u - v) + surf.val[ib] * u + surf.val[ic] * v });
        }
        return out;
    }

    /** The scalp tangent nearest `want` at a point with normal `n`. */
    const tangent = (want, n) => { const t = sub(want, mul(n, dot(want, n))); return len(t) < 1e-6 ? norm(cross(n, [1, 0, 0])) : norm(t); };


    // ── hairline and zones ─────────────────────────────────────────────────
    /** The hairline's elevation (degrees) at each azimuth; `recede` raises the front and temples. */
    function hairlineAt(az, recede) {
        const a = Math.abs(az);
        const pts = [[0, 40], [25, 37], [42, 30], [58, 18], [70, 8], [78, -16], [86, -20], [93, 4], [104, 12], [122, 6], [140, -18], [160, -34], [180, -38]];
        let el = pts[pts.length - 1][1];
        for (let i = 0; i + 1 < pts.length; i++) {
            const [a0, e0] = pts[i], [a1, e1] = pts[i + 1];
            if (a >= a0 && a <= a1) { const t = (a - a0) / (a1 - a0); el = mix(e0, e1, t * t * (3 - 2 * t)); break; }
        }
        // Receding: the front climbs, the temples most.
        el += recede * (16 * (1 - smooth(0, 70, a)) + 24 * Math.exp(-Math.pow((a - 52) / 16, 2)));
        return el;
    }

    /** A field over the head's vertices: degrees inside the hairline (positive) and inside `zone`. */
    function scalpField(H, hair, zone) {
        const noise = rng(hash('hairline'));
        const jitter = new Float32Array(64).map(() => noise() * 2 - 1);
        return v => {
            if (H.ears[v]) return -12;
            const c = headCoords(H, H.P(v));
            // A soft irregular edge: real hairlines are not ruled lines.
            const j = jitter[Math.floor(((c.az + 180) / 360) * 63)] * 1.4;
            let f = c.el - hairlineAt(c.az, hair.hairline) + j;
            if (zone) f = Math.min(f, zone(c, v));
            return f;
        };
    }

    /** A point on the scalp toward head-relative direction (az, el), raised `layer` off it. */
    function scalpPoint(H, az, el, layer) {
        const a = az * Math.PI / 180, e = el * Math.PI / 180;
        const d = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
        let p = add(H.center, [d[0] * H.radii[0], d[1] * H.radii[1], d[2] * H.radii[2]]);
        let n = norm([d[0] / H.radii[0], d[1] / H.radii[1], d[2] / H.radii[2]]);
        for (let k = 0; k < 4; k++) {
            const s = H.surface(p);
            if (!Number.isFinite(s.d)) break;
            p = add(p, mul(s.n, layer - s.d));
            n = s.n;
        }
        return { p, n };
    }

    /** Head-relative direction of a point (for gathering strands to a tie). */
    function dirOf(H, p) { return norm([(p[0] - H.center[0]) / H.radii[0], (p[1] - H.center[1]) / H.radii[1], (p[2] - H.center[2]) / H.radii[2]]); }
    function slerpDir(a, b, t) {
        const d = clamp(dot(a, b), -1, 1), w = Math.acos(d);
        if (w < 1e-4) return a;
        const s = Math.sin(w);
        return add(mul(a, Math.sin((1 - t) * w) / s), mul(b, Math.sin(t * w) / s));
    }
    /** From a scalp root over the head to `tie`, lying on the scalp. */
    function gather(H, root, tie, layer, steps) {
        const da = dirOf(H, root), db = dirOf(H, tie);
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const d = slerpDir(da, db, i / steps);
            let p = add(H.center, [d[0] * H.radii[0], d[1] * H.radii[1], d[2] * H.radii[2]]);
            for (let k = 0; k < 3; k++) { const s = H.surface(p); if (!Number.isFinite(s.d)) break; p = add(p, mul(s.n, layer - s.d)); }
            pts.push(p);
        }
        return pts;
    }

    // ── comb directions ────────────────────────────────────────────────────
    const AXIS = { up: [0, 1, 0], down: [0, -1, 0], back: [0, 0, -1], front: [0, 0, 1], left: [1, 0, 0], right: [-1, 0, 0] };
    /** Hair falls away from the part on top, away from the crown behind it. */
    function combFromPart(H, hair, p, n, c) {
        const partX = hair.part === 'left' ? 0.38 : hair.part === 'right' ? -0.38 : 0;
        if (hair.part === 'none') return tangent(add(mul(AXIS.back, 1), mul(AXIS.down, 0.6)), n);
        if (c.az > 115 || c.az < -115) {
            // Behind the crown: down the back of the head, a little outward.
            return tangent(add(mul(AXIS.down, 1), mul([c.x, 0, 0], 0.5)), n);
        }
        const side = c.x >= partX ? 1 : -1;
        const want = add(add(mul(AXIS.left, side), mul(AXIS.down, 0.55)), mul(AXIS.back, 0.15));
        return tangent(want, n);
    }
    const combBack = (n, c) => tangent(add(add(AXIS.back, mul(AXIS.down, 0.45)), mul([c.x, 0, 0], 0.25)), n);
    const combDown = (n, c) => tangent(add(AXIS.down, mul([c.x, 0, Math.max(0, c.z) * 0.3], 0.6)), n);

    // ── styles ─────────────────────────────────────────────────────────────
    /**
     * Every style as layers. Lengths are meters on an average head and scale
     * with the head (H.scale) and the recipe's length.
     */
    function styleLayers(H, hair) {
        const L = hair.length * H.scale, V = hair.volume, S = H.scale;
        const browY = H.eyeY + H.eyeRadius * 1.9;
        const chinY = H.chin[1];
        const fringeZone = c => (Math.abs(c.az) < 55 ? 1 : 0);
        const fringe = hair.fringe;
        const cap = (t, zone) => ({ type: 'cap', thickness: t * S, zone });
        const base = { layer: (0.004 + 0.008 * V) * S, lift: 0.05 + 0.25 * V, gravity: 0.35, stiff: 0.35, hug: 0.8, steps: 10 };
        const strands = o => Object.assign({ type: 'strands' }, base, o);
        const frontBangs = (len, sweep) => strands({
            count: Math.round(40 + 50 * fringe), zone: c => (fringeZone(c) ? 30 - Math.abs(c.az) * 0.5 : -1) + (c.el - 25),
            comb: (p, n, c) => tangent(add(add(AXIS.front, mul(AXIS.down, 0.9)), mul(AXIS.left, (sweep || 0) + c.x * 0.4)), n),
            length: () => len, stopY: () => browY - (sweep ? 0.012 * S : 0), fringe: true, width: 0.014 * S, hug: 0.9, gravity: 0.6, stiff: 0.2
        });
        const withFringe = layers => (fringe > 0.05 ? layers.concat([frontBangs(0.12 * S * (0.6 + fringe * 0.6))]) : layers);
        const partComb = (p, n, c) => combFromPart(H, hair, p, n, c);
        const curl = hair.curl;
        switch (hair.style) {
            case 'bald': return [];
            case 'buzz': return [cap(0.0025 + 0.002 * V)];
            case 'crew': return [cap(0.006 + 0.004 * V), strands({ count: 220, comb: (p, n, c) => (c.el > 30 ? tangent(add(AXIS.front, mul(AXIS.up, 0.6)), n) : combDown(n, c)), length: c => (c.el > 30 ? 0.03 : 0.015) * S * hair.length, width: 0.012 * S, hug: 1, gravity: 0.05, lift: 0.25, steps: 4, sides: 3 })];
            case 'sidePart': return [cap(0.006), strands({ count: 260, comb: partComb, length: c => (c.el > 20 ? 0.075 : 0.04) * L, width: 0.016 * S, hug: 1, gravity: 0.2, steps: 6 })];
            case 'undercut': return [cap(0.0018), cap(0.008, c => (c.el - 40) * 2), strands({ count: 220, zone: c => (c.el - 42) * 2, comb: (p, n, c) => tangent(add(add(mul(AXIS.left, hair.part === 'right' ? -1 : 1), mul(AXIS.back, 0.5)), mul(AXIS.up, 0.2)), n), length: () => 0.13 * L, width: 0.02 * S, hug: 0.55, lift: 0.3 + 0.35 * V, gravity: 0.25, stiff: 0.5, steps: 8 })];
            case 'quiff': return [cap(0.003), strands({ count: 130, zone: c => c.el - 30, comb: (p, n, c) => tangent(add(mul(AXIS.back, 0.6), mul(AXIS.up, 0.9)), n), length: c => (c.z > 0.2 ? 0.09 : 0.06) * L, width: 0.018 * S, hug: 0.1, lift: 0.55 + 0.3 * V, gravity: 0.05, steps: 6 }), strands({ count: 120, zone: c => 30 - c.el, comb: (p, n, c) => combBack(n, c), length: () => 0.03 * S, width: 0.012 * S, hug: 1, gravity: 0.1, steps: 3, sides: 3 })];
            case 'pompadour': return [cap(0.004), strands({ count: 120, zone: c => Math.min(c.el - 28, 70 - Math.abs(c.az)), comb: (p, n, c) => norm(add(mul(AXIS.up, 1.3), mul(AXIS.back, 0.35))), length: c => (0.07 + 0.06 * Math.max(0, c.z)) * L, width: 0.022 * S, hug: 0, lift: 0.6, gravity: 0.5, stiff: 0.5, steps: 8, fringeAll: true, bias: AXIS.back }), strands({ count: 200, comb: (p, n, c) => combBack(n, c), length: c => (c.el > 25 ? 0.1 : 0.04) * L, width: 0.018 * S, hug: 0.95, gravity: 0.2, stiff: 0.5, steps: 7 })];
            case 'slickBack': return [cap(0.004), strands({ count: 260, comb: (p, n, c) => combBack(n, c), length: () => 0.11 * L, width: 0.016 * S, hug: 1, lift: 0.02, gravity: 0.25, stiff: 0.6, steps: 8 })];
            case 'spiky': return [cap(0.006), { type: 'spikes', count: 70, length: 0.06 * L, width: 0.022 * S, up: 0.6 }];
            case 'messy': return withFringe([cap(0.007), strands({ count: 260, comb: (p, n, c, r) => tangent(norm([r() * 2 - 1, r() * 1.2 - 0.8, r() * 2 - 1]), n), length: () => (0.06 + 0.04 * V) * L, width: 0.016 * S, hug: 0.5, lift: 0.35 + 0.3 * V, gravity: 0.3, steps: 6, waves: 0.008 })]);
            case 'pixie': return [cap(0.005), strands({ count: 240, comb: (p, n, c) => (Math.abs(c.az) < 70 && c.el > 15 ? tangent(add(add(AXIS.front, AXIS.down), mul(AXIS.left, hair.part === 'right' ? -0.8 : 0.8)), n) : combDown(n, c)), length: c => (Math.abs(c.az) < 70 && c.el > 15 ? 0.1 : 0.05) * L, width: 0.016 * S, hug: 0.95, gravity: 0.4, steps: 7, fringeAll: true, stopY: () => browY - 0.004 * S })];
            case 'curlyShort': return [cap(0.01 + 0.01 * V), strands({ count: 240, comb: (p, n, c) => combDown(n, c), length: () => 0.07 * L, width: 0.013 * S, hug: 0.5, lift: 0.5, gravity: 0.2, steps: 10, curl: { amount: 0.008 * S, period: 0.022 * S, helix: true }, fringeAll: true, stopY: () => browY + 0.005 * S })];
            case 'mohawk': return [cap(0.0015), cap(0.005, c => (0.26 - Math.abs(c.x)) * 120), { type: 'spikes', count: 16, length: 0.12 * L, width: 0.035 * S, up: 1, zone: c => (0.2 - Math.abs(c.x)) * 120, row: true }];
            case 'mohawkFlat': return [cap(0.0015), cap(0.006, c => (0.27 - Math.abs(c.x)) * 120), strands({ count: 120, zone: c => (0.22 - Math.abs(c.x)) * 120, comb: (p, n, c) => tangent(add(AXIS.back, mul(AXIS.up, 0.4)), n), length: () => 0.1 * L, width: 0.02 * S, hug: 0.6, lift: 0.4 + 0.3 * V, gravity: 0.15, steps: 7 })];
            case 'mullet': return [cap(0.006), strands({ count: 160, zone: c => 125 - Math.abs(c.az), comb: partComb, length: () => 0.06 * L, width: 0.016 * S, hug: 1, gravity: 0.3, steps: 6 }), strands({ count: 110, zone: c => Math.abs(c.az) - 115, comb: (p, n, c) => combDown(n, c), length: () => 0.24 * L, width: 0.018 * S, hug: 0.6, gravity: 0.6, steps: 11, stopY: () => H.shoulderY - 0.08 * S * hair.length })];
            case 'bob': return withFringe([cap(0.007), strands({ sheet: true, count: 340, comb: partComb, length: () => 0.26 * L, width: 0.024 * S, hug: 0.85, lift: 0.1 + 0.2 * V, gravity: 0.5, steps: 11, stopY: () => chinY - 0.005 * S, inCurl: 0.35 })]);
            case 'shag': return withFringe([cap(0.008), strands({ count: 300, comb: (p, n, c, r) => tangent(add(partComb(p, n, c), mul(norm([r() - 0.5, 0, r() - 0.5]), 0.8)), n), length: (c, r) => (0.18 + 0.12 * r()) * L, width: 0.017 * S, hug: 0.55, lift: 0.25 + 0.3 * V, gravity: 0.55, steps: 11, waves: 0.012, stopY: () => H.shoulderY - 0.02 * S })]);
            case 'shoulder': return withFringe([cap(0.007), strands({ sheet: true, count: 340, comb: partComb, length: () => 0.32 * L, width: 0.024 * S, drape: 'split', hug: 0.85, gravity: 0.6, steps: 12, stopY: () => H.shoulderY - 0.03 * S * hair.length })]);
            case 'sweptBangs': return [cap(0.007), strands({ sheet: true, count: 280, comb: partComb, length: () => 0.3 * L, width: 0.022 * S, hug: 0.85, gravity: 0.6, steps: 12, stopY: () => H.shoulderY - 0.02 * S }), frontBangs(0.15 * S, hair.part === 'right' ? -1.1 : 1.1)];
            case 'afro': return [{ type: 'afro', radius: (0.05 + 0.07 * V) * hair.length * S }];
            case 'curly': return withFringe([cap(0.012 + 0.008 * V), strands({ count: 300, comb: partComb, length: () => 0.3 * L, width: 0.016 * S, hug: 0.5, lift: 0.35 + 0.3 * V, gravity: 0.55, steps: 16, curl: { amount: (0.01 + 0.008 * V) * S, period: 0.035 * S, helix: true }, stopY: () => H.shoulderY - 0.05 * S * hair.length })]);
            case 'animeSpikes': return [cap(0.01), { type: 'spikes', count: 34, length: 0.13 * L, width: 0.05 * S, up: 0.3, anime: true }, { type: 'spikes', count: 9, length: 0.11 * L, width: 0.04 * S, up: -0.8, front: true, zone: c => 50 - Math.abs(c.az) }];
            case 'long': return withFringe([cap(0.007), strands({ sheet: true, count: 320, comb: partComb, length: () => 0.5 * L, width: 0.028 * S, hug: 0.85, gravity: 0.65, steps: 12, drape: 'split' })]);
            case 'longWavy': return withFringe([cap(0.008), strands({ sheet: true, count: 320, comb: partComb, length: () => 0.52 * L, width: 0.028 * S, drape: 'split', hug: 0.8, lift: 0.15 + 0.25 * V, gravity: 0.6, steps: 16, waves: 0.012 + 0.012 * V })]);
            case 'veryLong': return withFringe([cap(0.007), strands({ sheet: true, count: 330, comb: partComb, length: () => 0.85 * L, width: 0.028 * S, drape: 'split', hug: 0.85, gravity: 0.7, steps: 16 })]);
            case 'hime': return [cap(0.007), frontBangs(0.13 * S, 0), strands({ count: 70, zone: c => (Math.abs(c.az) > 45 && Math.abs(c.az) < 100 ? 1 : -1) * 20, comb: (p, n, c) => combDown(n, c), length: () => 0.3 * L, width: 0.02 * S, hug: 0.9, gravity: 0.8, steps: 10, stopY: () => chinY - 0.01 * S, frontDrape: true }), strands({ sheet: true, count: 320, comb: partComb, length: () => 0.6 * L, width: 0.026 * S, hug: 0.85, gravity: 0.7, steps: 14 })];
            case 'dreadlocks': return [cap(0.01), { type: 'locks', count: 64, length: 0.4 * L, radius: (0.009 + 0.004 * V) * S }];
            case 'ponytail': return withFringe([cap(0.005), { type: 'tail', ties: [[180, 42]], length: 0.38 * L, radius: (0.022 + 0.015 * V) * S }]);
            case 'ponytailLow': return withFringe([cap(0.005), { type: 'tail', ties: [[180, -18]], length: 0.36 * L, radius: (0.02 + 0.012 * V) * S }]);
            case 'pigtails': return withFringe([cap(0.005), { type: 'tail', ties: [[112, 14], [-112, 14]], length: 0.3 * L, radius: (0.018 + 0.01 * V) * S }]);
            case 'bun': return withFringe([cap(0.005), { type: 'bun', tie: [178, 62], radius: (0.034 + 0.02 * V) * S }]);
            case 'bunLow': return withFringe([cap(0.005), { type: 'bun', tie: [180, -12], radius: (0.032 + 0.018 * V) * S }]);
            case 'topKnot': return [cap(0.005), { type: 'bun', tie: [175, 78], radius: 0.024 * S, knot: true }];
            case 'braid': return withFringe([cap(0.005), { type: 'braid', ties: [[180, -10]], length: 0.42 * L, radius: (0.016 + 0.008 * V) * S }]);
            case 'twinBraids': return withFringe([cap(0.005), { type: 'braid', ties: [[118, -6], [-118, -6]], length: 0.38 * L, radius: (0.013 + 0.006 * V) * S }]);
            default: return [];
        }
    }

    // ── layer builders ─────────────────────────────────────────────────────
    function colorRamp(hair) {
        const rootC = shadeRgb(linear(hair.color), 0.78);
        const tipC = hair.tipColor ? linear(hair.tipColor) : shadeRgb(linear(hair.color), 1.12);
        const hi = mixRgb(linear(hair.color), [0.9, 0.82, 0.62], 0.5);
        return (t, variance, highlight) => {
            let c = mixRgb(rootC, tipC, smooth(0, 1, t));
            if (highlight) c = mixRgb(c, hi, 0.55 * t);
            return shadeRgb(c, variance);
        };
    }

    function buildCap(H, hair, m, layer, ramp) {
        const surf = cutSurface(H, scalpField(H, hair, layer.zone));
        const soft = 7;
        addShell(m, surf, i => layer.thickness * smooth(0, soft, surf.val[i]), () => ramp(0.15, 0.92, false));
        return surf;
    }

    function buildStrands(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair, layer.zone));
        const roots = scatter(surf, layer.count, rand);
        for (const r of roots) {
            if (r.f < 1.5) continue;
            const c = headCoords(H, r.p);
            const dir = layer.comb(r.p, r.n, c, rand);
            const length = layer.length(c, rand) * (0.85 + 0.3 * rand());
            if (length < 0.004) continue;
            const lift = typeof layer.lift === 'function' ? layer.lift(c) : layer.lift;
            const fringe = layer.fringe || layer.fringeAll;
            const front = (layer.drape === 'split' && Math.abs(c.az) > 30 && Math.abs(c.az) < 100 && rand() < 0.75) || !!layer.frontDrape;
            let pts = grow(H, r.p, r.n, dir, {
                steps: layer.steps, length, layer: layer.layer * (0.6 + 0.8 * rand()), lift, gravity: layer.gravity, stiff: layer.stiff,
                hug: layer.hug, release: H.earBottom, fringe, stopY: layer.stopY ? layer.stopY(c) : null,
                front,
                bias: front ? mul(AXIS.front, 0.25) : (Math.abs(c.az) > 60 ? mul(AXIS.back, 0.6) : null)
            });
            if (layer.inCurl && pts.length > 3) {
                // Ends turned under (a bob): the last points move toward the neck.
                const k = pts.length;
                for (let i = Math.floor(k * 0.7); i < k; i++) { const t = (i - k * 0.7) / (k * 0.3); pts[i] = lerp(pts[i], [H.center[0] + (pts[i][0] - H.center[0]) * 0.85, pts[i][1] + 0.004 * H.scale * t, H.center[2] + (pts[i][2] - H.center[2]) * 0.85], layer.inCurl * t); }
            }
            if (layer.waves) pts = curlStrand(H, pts, layer.waves * H.scale * hair.length, 0.08 * H.scale, false, rand() * 6.28);
            const curlAmt = (layer.curl ? layer.curl.amount : 0) + hair.curl * 0.012 * H.scale;
            if (curlAmt > 0) pts = curlStrand(H, pts, curlAmt, layer.curl ? layer.curl.period : 0.04 * H.scale, true, rand() * 6.28);
            const variance = 0.85 + 0.3 * rand();
            const highlight = rand() < hair.highlights * 0.5;
            addClump(m, pts, { width: layer.width * (0.75 + 0.5 * rand()) * (0.8 + 0.4 * hair.volume), flat: 0.35, sides: layer.sides || 3, center: H.center, color: t => ramp(t, variance, highlight) });
        }
    }

    /**
     * A curtain under long hair: strands grown from a ring just inside the
     * hairline, the neighbors' paths joined into one sheet, so the hair has
     * mass and nothing shows between the clumps.
     */
    function buildSheet(H, hair, m, layer, ramp, rand) {
        const ring = 56, guides = [];
        for (let k = 0; k < ring; k++) {
            const az = -180 + (360 * (k + 0.5)) / ring;
            if (Math.abs(az) < 62) { guides.push(null); continue; }
            const el = hairlineAt(az, hair.hairline) + 7;
            const { p, n } = scalpPoint(H, az, el, 0);
            const c = headCoords(H, p);
            if (layer.zone && layer.zone(c) <= 0) { guides.push(null); continue; }
            const pts = grow(H, p, n, layer.comb(p, n, c, rand), {
                steps: layer.steps, length: layer.length(c, rand), layer: layer.layer * 0.8, lift: typeof layer.lift === 'function' ? layer.lift(c) : layer.lift,
                gravity: layer.gravity, stiff: layer.stiff, hug: layer.hug, release: H.earBottom, fringe: false,
                stopY: layer.stopY ? layer.stopY(c) : null, front: false, bias: Math.abs(c.az) > 60 ? mul(AXIS.back, 0.6) : null
            });
            guides.push(pts.length === layer.steps + 1 ? pts : null);
        }
        const gap = 0.045 * H.scale;
        const col = t => shadeRgb(ramp(t, 0.8, false), 0.85);
        for (let k = 0; k < ring; k++) {
            const a = guides[k], b = guides[(k + 1) % ring];
            if (!a || !b) continue;
            const base = m.pos.length / 3;
            let rows = 0;
            for (let i = 0; i < a.length; i++) {
                if (len(sub(a[i], b[i])) > gap) break;
                const t = i / (a.length - 1);
                const out = norm(sub(lerp(a[i], b[i], 0.5), H.center));
                pushVert(m, a[i], out, col(t));
                pushVert(m, b[i], out, col(t));
                rows++;
            }
            for (let i = 0; i + 1 < rows; i++) {
                const v = base + i * 2;
                m.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
            }
        }
    }

    function buildSpikes(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair, layer.zone));
        const roots = layer.row ? [] : scatter(surf, layer.count * 3, rand);
        const list = [];
        if (layer.row) {
            // A row over the middle of the head: up the forehead to the crown, then down the back.
            for (let i = 0; i < layer.count; i++) {
                const t = i / (layer.count - 1);
                const { p, n } = scalpPoint(H, t < 0.45 ? 0 : 180, t < 0.45 ? mix(42, 90, t / 0.45) : mix(90, -20, (t - 0.45) / 0.55), 0.003 * H.scale);
                list.push({ p, n, c: headCoords(H, p), scale: 1 - 0.5 * Math.abs(t - 0.4) });
            }
        } else {
            for (const r of roots) {
                if (r.f < 4) continue;
                if (list.length >= layer.count) break;
                const c = headCoords(H, r.p);
                if (layer.front && Math.abs(c.az) > 60) continue;
                if (!layer.front && list.some(o => len(sub(o.p, r.p)) < layer.width * 0.55)) continue;
                list.push({ p: r.p, n: r.n, c, scale: 0.7 + 0.5 * rand() });
            }
        }
        for (const s of list) {
            let dir = norm(add(mul(s.n, 1), mul(AXIS.up, layer.up)));
            if (layer.anime) dir = norm(add(add(s.n, mul(AXIS.back, 0.6)), mul(AXIS.up, 0.25 * (s.c.el / 90))));
            if (layer.front) dir = norm(add(add(mul(AXIS.front, 0.7), mul(AXIS.down, 1)), mul([s.c.x, 0, 0], 1.2)));
            const length = layer.length * s.scale * (0.8 + 0.4 * rand());
            const steps = 6, pts = [s.p];
            let d = dir;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                d = norm(add(d, mul(AXIS.down, layer.anime ? 0.12 * t : 0.03)));
                let p = add(pts[i - 1], mul(d, length / steps));
                if (layer.front) { const sf = H.surface(p); if (Number.isFinite(sf.d) && sf.d < 0.006 * H.scale) p = add(p, mul(sf.n, 0.006 * H.scale - sf.d)); }
                pts.push(p);
            }
            const variance = 0.88 + 0.24 * rand();
            addClump(m, pts, { width: layer.width * s.scale, flat: layer.anime || layer.front ? 0.45 : 0.8, sides: 4, center: H.center, taper: t => 1 - t * 0.97, color: t => ramp(t, variance, false) });
        }
    }

    function buildAfro(H, hair, m, layer, rand) {
        // The scalp and its edges, then every point pushed out to a round mass centered above and behind the
        // skull's middle, so the sides and back fill in and the face stays clear.
        const surf = cutSurface(H, scalpField(H, hair, c => c.el - hairlineAt(c.az, hair.hairline) + 4));
        const ramp = colorRamp(hair);
        const R = layer.radius;
        const center = add(H.center, [0, H.radii[1] * 0.28, -H.radii[2] * 0.12]);
        const size = [H.radii[0] + R, H.radii[1] * 0.75 + R, H.radii[2] + R * 0.9];
        const freq = 1 / (0.011 * H.scale);
        const lumps = p => {
            const x = p[0] * freq, y = p[1] * freq, z = p[2] * freq;
            return 0.5 + 0.25 * Math.sin(x * 1.7 + Math.cos(y * 1.3)) * Math.cos(z * 1.9 + Math.sin(x)) + 0.25 * Math.sin(y * 2.3 + z * 0.7);
        };
        const base = m.pos.length / 3;
        for (let i = 0; i < surf.pos.length; i++) {
            const p = surf.pos[i];
            const d = norm(sub(p, center));
            // Where a ray from the mass's center leaves the ellipsoid, never inside the head.
            const k = 1 / Math.hypot(d[0] / size[0], d[1] / size[1], d[2] / size[2]);
            const target = add(center, mul(d, k * (0.92 + 0.12 * lumps(p))));
            const reach = Math.max(0, dot(sub(target, p), surf.nrm[i]));
            // At the hairline the mass curls down to the scalp.
            const hc = headCoords(H, p);
            // Over the forehead the slope down to the hairline is long, so the mass has no ledge.
            const edge = smooth(0, mix(14, 40, smooth(20, 0, Math.abs(hc.az)) * smooth(0, 0.5, hc.z)), surf.val[i]);
            const front = mix(1, 0.6, smooth(0.2, 0.7, hc.z));
            // Below the ears it thins to a close crop: the sideburns and nape do not flare.
            const low = smooth(-22, 18, hc.el);
            const q = add(p, mul(surf.nrm[i], (0.004 * H.scale + reach * front * low) * edge));
            pushVert(m, q, surf.nrm[i], ramp(0.5, 0.72 + 0.32 * lumps(p), false));
        }
        for (let t = 0; t < surf.index.length; t += 3) m.idx.push(base + surf.index[t], base + surf.index[t + 1], base + surf.index[t + 2]);
        // Tight curls over the surface, so the edge is not a hard shell.
        const roots = scatter(surf, 220, rand);
        for (const r of roots) {
            if (r.f < 6) continue;
            const d = norm(sub(r.p, center));
            const k = 1 / Math.hypot(d[0] / size[0], d[1] / size[1], d[2] / size[2]);
            const tip = add(center, mul(d, k * (0.98 + 0.08 * rand())));
            const hc = headCoords(H, r.p);
            const edge = smooth(0, mix(14, 40, smooth(20, 0, Math.abs(hc.az)) * smooth(0, 0.5, hc.z)), r.f);
            if (edge < 0.6 || hc.el < 5) continue;
            const reach = Math.max(0, dot(sub(tip, r.p), r.n)) * mix(1, 0.6, smooth(0.2, 0.7, hc.z)) * edge;
            const start = add(r.p, mul(r.n, reach * 0.75));
            const pts = [];
            for (let i = 0; i <= 6; i++) { const a = i * 1.4 + rand(); pts.push(add(add(start, mul(r.n, reach * 0.3 * i / 6)), mul(norm(cross(r.n, [0, 1, 0.3])), Math.sin(a) * 0.006 * H.scale))); }
            addClump(m, pts, { width: 0.016 * H.scale, flat: 0.8, sides: 4, center: H.center, color: t => ramp(0.6, 0.75 + 0.3 * rand(), false) });
        }
    }

    function buildTail(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair));
        const ties = layer.ties.map(([az, el]) => scalpPoint(H, az, el, 0.006 * H.scale));
        const roots = scatter(surf, 260, rand);
        // Hair swept to each tie over the scalp.
        for (const r of roots) {
            if (r.f < 2) continue;
            const c = headCoords(H, r.p);
            let tie = ties[0];
            if (ties.length > 1) tie = c.x >= 0 === (ties[0].p[0] >= H.center[0]) ? ties[0] : ties[1];
            const pts = gather(H, r.p, tie.p, (0.003 + 0.004 * rand()) * H.scale, 8);
            const variance = 0.85 + 0.3 * rand();
            addClump(m, pts, { width: 0.02 * H.scale, flat: 0.3, sides: 3, center: H.center, taper: t => 1 - t * 0.6, color: t => ramp(0.2 * t, variance, false) });
        }
        for (const tie of ties) {
            // The tail's own line: out from the head, then down.
            // A tie at the back sends its tail out and down; one at the side mostly down.
            const side = Math.abs(tie.n[0]);
            const out = norm(add(add(mul(tie.n, 0.7 - 0.35 * side), mul(AXIS.down, 0.5 + 0.6 * side)), mul(AXIS.back, 0.2 * side)));
            const steps = 14, seg = layer.length / steps;
            const spine = [add(tie.p, mul(tie.n, layer.radius * 0.4))];
            let d = out;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                d = norm(add(mul(d, 1 - 0.55 * smooth(0, 0.35, t)), mul(AXIS.down, 0.55 * smooth(0, 0.35, t))));
                let p = add(spine[i - 1], mul(d, seg));
                for (let k = 0; k < 2; k++) { const s = H.surface(p); if (Number.isFinite(s.d) && s.d < layer.radius) p = add(p, mul(s.n, layer.radius - s.d)); }
                spine.push(p);
                d = norm(sub(p, spine[i - 1]));
            }
            const radius = t => layer.radius * (0.55 + 0.6 * Math.sin(Math.min(1, t * 2.2 + 0.2) * Math.PI * 0.8)) * (1 - 0.7 * t);
            const count = 46;
            for (let k = 0; k < count; k++) {
                const ang = rand() * Math.PI * 2, f = Math.sqrt(rand());
                const phase = rand() * 6.28;
                const pts = spine.map((p, i) => {
                    const t = i / steps;
                    const T = norm(sub(spine[Math.min(steps, i + 1)], spine[Math.max(0, i - 1)]));
                    const B = norm(cross(T, AXIS.left)), N = cross(B, T);
                    const r = radius(t) * f + hair.curl * 0.008 * H.scale * Math.sin(t * 14 + phase);
                    return add(p, add(mul(B, Math.cos(ang) * r), mul(N, Math.sin(ang) * r)));
                });
                const variance = 0.85 + 0.3 * rand();
                const highlight = rand() < hair.highlights * 0.5;
                addClump(m, pts, { width: 0.018 * H.scale, flat: 0.4, sides: 4, center: H.center, outAt: (p, i) => norm(sub(p, spine[i])), color: t => ramp(0.2 + 0.8 * t, variance, highlight) });
            }
            addTie(H, m, spine[0], norm(sub(spine[1], spine[0])), layer.radius * 0.75);
        }
    }

    /** A band where hair is tied. */
    function addTie(H, m, c, axis, r) {
        const col = [0.05, 0.05, 0.06];
        const pts = [];
        const up = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const B = norm(cross(axis, up)), N = cross(B, axis);
        for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push(add(c, add(mul(B, Math.cos(a) * r), mul(N, Math.sin(a) * r)))); }
        addTube(m, pts, () => 0.0045 * H.scale * 2 / 2, () => col, 5);
    }

    function buildBun(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair));
        const tie = scalpPoint(H, layer.tie[0], layer.tie[1], 0.006 * H.scale);
        for (const r of scatter(surf, 260, rand)) {
            if (r.f < 2) continue;
            const pts = gather(H, r.p, tie.p, (0.003 + 0.004 * rand()) * H.scale, 8);
            const variance = 0.85 + 0.3 * rand();
            addClump(m, pts, { width: 0.02 * H.scale, flat: 0.3, sides: 3, center: H.center, taper: t => 1 - t * 0.6, color: t => ramp(0.2 * t, variance, false) });
        }
        const R = layer.radius;
        const c = add(tie.p, mul(tie.n, R * 0.8));
        const col = ramp(0.45, 0.95, false);
        addBlob(m, c, [R, R * (layer.knot ? 1.1 : 0.8), R], col, rand, 0.1);
        // Wraps around the bun.
        const axis = tie.n;
        const up = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
        const B = norm(cross(axis, up)), N = cross(B, axis);
        for (let k = 0; k < 7; k++) {
            const tilt = (k / 7) * Math.PI, pts = [];
            for (let i = 0; i <= 16; i++) {
                const a = (i / 16) * Math.PI * 1.8 + k;
                const dir = add(mul(add(mul(B, Math.cos(tilt)), mul(axis, Math.sin(tilt) * 0.6)), Math.cos(a)), mul(N, Math.sin(a)));
                pts.push(add(c, mul(norm(dir), R * 1.02)));
            }
            const variance = 0.85 + 0.25 * rand();
            addClump(m, pts, { width: R * 0.5, flat: 0.35, sides: 4, center: c, taper: t => 1 - 0.6 * Math.abs(t - 0.5), color: () => shadeRgb(col, variance) });
        }
        if (layer.knot) {
            // The top knot's tuft.
            for (let k = 0; k < 10; k++) {
                const start = add(c, mul(axis, R * 0.8));
                const d = norm(add(axis, [(rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8]));
                const pts = [start, add(start, mul(d, 0.03 * H.scale)), add(start, add(mul(d, 0.055 * H.scale), [0, -0.01 * H.scale, 0]))];
                addClump(m, pts, { width: 0.012 * H.scale, flat: 0.5, sides: 3, center: c, color: t => ramp(0.5 + t * 0.5, 0.9, false) });
            }
        }
        addTie(H, m, add(tie.p, mul(tie.n, R * 0.05)), tie.n, R * 0.55);
    }

    function buildBraid(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair));
        const ties = layer.ties.map(([az, el]) => scalpPoint(H, az, el, 0.006 * H.scale));
        for (const r of scatter(surf, 260, rand)) {
            if (r.f < 2) continue;
            const c = headCoords(H, r.p);
            let tie = ties[0];
            if (ties.length > 1) tie = (c.x >= 0) === (ties[0].p[0] >= H.center[0]) ? ties[0] : ties[1];
            const pts = gather(H, r.p, tie.p, (0.003 + 0.004 * rand()) * H.scale, 8);
            const variance = 0.85 + 0.3 * rand();
            addClump(m, pts, { width: 0.02 * H.scale, flat: 0.3, sides: 3, center: H.center, taper: t => 1 - t * 0.6, color: t => ramp(0.2 * t, variance, false) });
        }
        for (const tie of ties) {
            const steps = 40, seg = layer.length / steps;
            const spine = [add(tie.p, mul(tie.n, layer.radius * 0.6))];
            let d = norm(add(tie.n, mul(AXIS.down, 1.4)));
            for (let i = 1; i <= steps; i++) {
                d = norm(add(mul(d, 0.8), mul(AXIS.down, 0.2)));
                let p = add(spine[i - 1], mul(d, seg));
                for (let k = 0; k < 2; k++) { const s = H.surface(p); if (Number.isFinite(s.d) && s.d < layer.radius * 1.2) p = add(p, mul(s.n, layer.radius * 1.2 - s.d)); }
                spine.push(p);
                d = norm(sub(p, spine[i - 1]));
            }
            const R = layer.radius;
            const period = R * 4.2;
            for (let k = 0; k < 3; k++) {
                const pts = spine.map((p, i) => {
                    const t = (i / steps) * layer.length / period * Math.PI * 2 + (k * Math.PI * 2) / 3;
                    const T = norm(sub(spine[Math.min(steps, i + 1)], spine[Math.max(0, i - 1)]));
                    const B = norm(cross(T, AXIS.back)), N = cross(B, T);
                    const taper = 1 - 0.45 * (i / steps);
                    return add(p, add(mul(B, Math.sin(t) * R * 0.55 * taper), mul(N, Math.sin(2 * t) * R * 0.22 * taper)));
                });
                const col = ramp(0.5, 0.88 + 0.1 * k, false);
                addTube(m, pts, t => R * 0.55 * (1 - 0.45 * t) * (0.85 + 0.15 * Math.abs(Math.sin(t * layer.length / period * Math.PI * 6))), t => shadeRgb(col, 0.9 + 0.1 * Math.sin(t * 60)), 6);
            }
            const end = spine[steps];
            addTie(H, m, end, norm(sub(spine[steps], spine[steps - 1])), R * 0.4);
            // The tassel past the tie.
            for (let k = 0; k < 9; k++) {
                const a = (k / 9) * Math.PI * 2;
                const off = [Math.cos(a) * R * 0.25, 0, Math.sin(a) * R * 0.25];
                const pts = [add(end, off), add(end, add(mul(off, 1.6), [0, -0.035 * H.scale, 0])), add(end, add(mul(off, 1.9), [0, -0.06 * H.scale, 0]))];
                addClump(m, pts, { width: R * 0.45, flat: 0.5, sides: 3, center: end, color: t => ramp(0.8 + 0.2 * t, 0.95, false) });
            }
        }
    }

    function buildLocks(H, hair, m, layer, ramp, rand) {
        const surf = cutSurface(H, scalpField(H, hair));
        const roots = scatter(surf, layer.count * 2, rand);
        const used = [];
        for (const r of roots) {
            if (r.f < 3 || used.length >= layer.count) continue;
            if (used.some(p => len(sub(p, r.p)) < layer.radius * 2.2)) continue;
            used.push(r.p);
            const c = headCoords(H, r.p);
            const length = layer.length * (0.75 + 0.5 * rand()) * (c.z > 0.4 ? 0.55 : 1);
            const pts = grow(H, r.p, r.n, combFromPart(H, { part: 'center' }, r.p, r.n, c), {
                steps: 14, length, layer: layer.radius * 1.1, lift: 0.35, gravity: 0.7, stiff: 0.25, hug: 0.5, release: H.earBottom,
                fringe: false, bias: Math.abs(c.az) > 60 ? mul(AXIS.back, 0.6) : null
            });
            const variance = 0.8 + 0.35 * rand();
            const bumps = 10 + rand() * 6;
            addTube(m, pts, t => layer.radius * (0.9 + 0.12 * Math.sin(t * bumps * Math.PI)) * (1 - 0.35 * t), t => ramp(0.2 + 0.8 * t, variance * (0.92 + 0.08 * Math.sin(t * bumps * 3)), false), 6);
        }
    }

    // ── facial hair ────────────────────────────────────────────────────────
    function facialField(H, style) {
        const rx = H.radii[0];
        const noseBase = mix(H.lipTop, H.noseTip[1], 0.55);
        const mouthY = (H.lipTop + H.lipBottom) / 2;
        const lipH = Math.max(0.004, (H.lipTop - H.lipBottom) / 2);
        const lipW = H.lipHalf * 1.12;
        return v => {
            const p = H.P(v);
            if (H.ears[v]) return -10;
            const x = Math.abs(p[0] - H.center[0]);
            const ax = x / rx;
            // The mouth's inside (the body mesh carries it behind the lips) is never bearded: there the
            // skin faces the head's middle instead of away from it.
            if (x < H.lipHalf * 1.4 && p[1] > H.lipBottom - 0.012 * H.scale && p[1] < H.noseTip[1] && p[2] < H.lipFront - 0.02 * H.scale) return -10;
            const nrm = [H.normals[v * 3], H.normals[v * 3 + 1], H.normals[v * 3 + 2]];
            if (dot(nrm, norm(sub(p, H.center))) < 0.05 && p[1] > H.chin[1]) return -10;
            // Only the front of the head and neck, in front of the ears.
            if (p[2] < H.earBack + (H.earFront - H.earBack) * 0.5) return -10;
            const cheekLine = mix(noseBase - (noseBase - mouthY) * 0.1, H.earTop - H.radii[1] * 0.1, smooth(0.42, 0.98, ax));
            const above = (cheekLine - p[1]) / H.radii[1] * 60;
            const neckLine = H.neckBone.head[1] + (H.headBone.head[1] - H.neckBone.head[1]) * 0.08;
            const below = (p[1] - neckLine) / H.radii[1] * 60;
            // The mouth stays open: an ellipse around the lips.
            const mx = x / lipW, my = (p[1] - mouthY) / (lipH * 1.25);
            const mouthOut = (Math.hypot(mx, my) - 1) * 6;
            let f = Math.min(above, below, mouthOut);
            const mustacheBand = Math.min((noseBase - p[1]) / H.radii[1] * 60, (p[1] - (H.lipTop - lipH * 0.2)) / H.radii[1] * 60, (lipW * 1.15 - x) / rx * 60);
            const chinZone = (lipW * 1.4 - x) / rx * 60;
            switch (style) {
                case 'goatee': f = Math.max(Math.min(f, chinZone, (mouthY + lipH - p[1]) / H.radii[1] * 60), mustacheBand); break;
                case 'chinStrap': {
                    // A band along the jaw's edge, from the sideburns round the chin.
                    const edge = mix(H.chin[1] + 0.003 * H.scale, H.earBottom - 0.012 * H.scale, smooth(0.25, 0.95, ax));
                    f = Math.min(f, (p[1] - (edge - 0.009 * H.scale)) / H.radii[1] * 60, ((edge + 0.014 * H.scale) - p[1]) / H.radii[1] * 60);
                    break;
                }
                case 'muttonChops': f = Math.min(f, (x - lipW * 1.9) / rx * 60); break;
                case 'mustache': case 'pencil': case 'handlebar': case 'walrus': f = mustacheBand; if (style === 'pencil') f = Math.min(f, ((H.lipTop + lipH * 1.3) - p[1]) / H.radii[1] * 60); if (style === 'walrus') f = Math.max(mustacheBand, Math.min((lipW * 1.3 - x) / rx * 60, (noseBase - p[1]) / H.radii[1] * 60, (p[1] - mouthY) / H.radii[1] * 60)); break;
                case 'horseshoe': f = Math.max(mustacheBand, Math.min((lipW * 1.4 - x) / rx * 60, (x - lipW * 0.95) / rx * 60, (noseBase - p[1]) / H.radii[1] * 60, (p[1] - (H.chin[1] - 0.004)) / H.radii[1] * 60)); break;
                default: f = Math.max(f, mustacheBand);
            }
            return f;
        };
    }

    function buildFacial(H, hair, m, rand, skin) {
        const f = hair.facial;
        if (f.style === 'none') return;
        const S = H.scale;
        // Stubble is skin darkened by the hair under it, not a beard.
        const color = f.style === 'stubble' ? mixHex(skin || '#c69c7f', f.color || hair.color, 0.45) : (f.color || hair.color);
        const ramp = colorRamp({ color, tipColor: '', highlights: 0 });
        const surf = cutSurface(H, facialField(H, f.style));
        if (!surf.index.length) return;
        const V = f.volume, Lf = f.length;
        const thick = { stubble: 0.0008, goatee: 0.006, chinStrap: 0.004, shortBeard: 0.006, fullBeard: 0.012, longBeard: 0.014, wizardBeard: 0.016, braidedBeard: 0.013, muttonChops: 0.008, mustache: 0.006, pencil: 0.0025, handlebar: 0.006, walrus: 0.01, horseshoe: 0.007 }[f.style] * S * (0.6 + 0.8 * V);
        const freq = 1 / (0.006 * S);
        const lumps = p => 0.75 + 0.25 * Math.sin(p[0] * freq * 1.3 + Math.sin(p[1] * freq)) * Math.cos(p[2] * freq * 1.1 + p[1] * freq * 0.7);
        // Thicker toward the chin, thin at the cheek edge.
        const chinBoost = p => 1 + 0.9 * smooth(H.mouth[1], H.chin[1] - 0.01 * S, p[1]) * (f.style.includes('Beard') || f.style === 'fullBeard' ? 1 : 0.3);
        const stubble = f.style === 'stubble';
        // Thinner over the upper lip, so a heavy beard's mustache does not climb the nose.
        const lipThin = p => mix(1, Math.min(1, 0.006 * S / Math.max(thick, 1e-6)), smooth(H.lipBottom, H.lipTop + 0.004 * S, p[1]));
        addShell(m, surf, i => thick * smooth(0, 8, surf.val[i]) * lumps(surf.pos[i]) * chinBoost(surf.pos[i]) * lipThin(surf.pos[i]),
            i => (stubble ? mixRgb(linear(skin || '#c69c7f'), shadeRgb(linear(color), 1.28), smooth(0, 10, surf.val[i])) : ramp(0.3, 0.85 + 0.15 * lumps(surf.pos[i]), false)));
        if (f.style === 'stubble') return;
        // Strands: short over the beard, long below the chin for the long styles.
        const long = { longBeard: 0.16, wizardBeard: 0.32, braidedBeard: 0.12, fullBeard: 0.05 }[f.style];
        const mustache = ['mustache', 'handlebar', 'walrus', 'horseshoe', 'goatee', 'fullBeard', 'longBeard', 'wizardBeard', 'braidedBeard', 'shortBeard'].includes(f.style);
        const roots = scatter(surf, Math.min(long ? 300 : 420, Math.round(surf.index.length / 3 * 0.6)), rand);
        for (const r of roots) {
            if (r.f < 2) continue;
            const isLip = r.p[1] > H.lipBottom && Math.abs(r.p[0] - H.center[0]) < H.lipHalf * 1.4 && r.p[1] < H.noseTip[1];
            if (isLip && r.p[2] < H.lipFront - 0.012 * S) continue;
            if (isLip && !mustache) continue;
            let length, dir;
            if (isLip) {
                length = (f.style === 'walrus' ? 0.03 : 0.014) * S * Lf;
                dir = norm(add(mul(AXIS.down, 1), mul([Math.sign(r.p[0] - H.center[0]), 0, 0], 0.5)));
            } else if (long) {
                const low = smooth(H.mouth[1], H.chin[1] - 0.005 * S, r.p[1]);
                length = (0.012 + long * low) * S * Lf;
                dir = norm(add(mul(AXIS.down, 1), mul(r.n, 0.3)));
            } else {
                length = 0.012 * S * Lf;
                dir = norm(add(mul(AXIS.down, 1), mul(r.n, 0.2)));
            }
            if (f.style === 'pencil' || f.style === 'muttonChops' || f.style === 'chinStrap') length *= 0.6;
            // A mustache hangs to the lip, not over the mouth (the walrus does).
            const stopY = isLip && f.style !== 'walrus' ? H.lipTop - (H.lipTop - H.lipBottom) * 0.2 : null;
            const pts = grow(H, r.p, r.n, dir, { steps: long ? 10 : 4, length, layer: thick * 0.6, lift: 0.3, gravity: long ? 0.6 : 0.2, stiff: 0.3, hug: long ? 0.3 : 0.8, release: H.chin[1], fringe: true, stopY, front: true });
            const variance = 0.82 + 0.3 * rand();
            addClump(m, long ? curlStrand(H, pts, 0.004 * S * (1 - V * 0.5), 0.05 * S, false, rand() * 6) : pts, { width: (long ? 0.014 : 0.008) * S, flat: 0.45, sides: 3, center: H.mouth, color: t => ramp(0.3 + 0.7 * t, variance, false) });
        }
        if (f.style === 'handlebar') {
            for (const side of [1, -1]) {
                const startX = H.center[0] + side * H.lipHalf * 0.4;
                const pts = [];
                for (let i = 0; i <= 14; i++) {
                    const t = i / 14;
                    const x = startX + side * (H.lipHalf * 1.6 * t + 0.012 * S * Math.sin(t * Math.PI * 0.9) * t);
                    const y = H.lipTop + 0.003 * S - 0.006 * S * Math.sin(t * Math.PI * 0.6) + 0.02 * S * smooth(0.6, 1, t);
                    const z = H.lipFront + 0.004 * S - 0.012 * S * t * t;
                    pts.push([x, y, z]);
                }
                addTube(m, pts, t => 0.0045 * S * (1 - 0.8 * t) * (0.8 + 0.4 * V), () => ramp(0.4, 0.95, false), 6);
            }
        }
        if (f.style === 'braidedBeard') {
            const top = add(H.chin, [0, -0.01 * S, 0.004 * S]);
            const R = 0.009 * S;
            const steps = 24, length = 0.16 * S * Lf;
            for (let k = 0; k < 3; k++) {
                const pts = [];
                for (let i = 0; i <= steps; i++) {
                    const t = (i / steps) * length / (R * 4) * Math.PI * 2 + k * Math.PI * 2 / 3;
                    const y = top[1] - (i / steps) * length;
                    const z = top[2] - 0.15 * (i / steps) * length + 0.01 * S;
                    pts.push([top[0] + Math.sin(t) * R * 0.55, y, z + Math.sin(2 * t) * R * 0.25]);
                }
                addTube(m, pts, t => R * 0.55 * (1 - 0.4 * t), () => ramp(0.6, 0.85 + 0.1 * k, false), 6);
            }
            const end = [top[0], top[1] - length, top[2] - 0.15 * length + 0.01 * S];
            addTie(H, m, end, [0, -1, 0], R * 0.45);
        }
    }

    // ── brows and lashes ───────────────────────────────────────────────────
    function browShape(style) {
        // [inner height, peak height, outer height, peak at, width (thickness), hair count]
        return {
            natural: [1.55, 1.85, 1.55, 0.6, 1, 34],
            thin: [1.6, 1.85, 1.55, 0.62, 0.45, 26],
            thick: [1.5, 1.8, 1.5, 0.58, 1.6, 46],
            arched: [1.45, 2.05, 1.5, 0.55, 0.9, 34],
            straight: [1.65, 1.7, 1.6, 0.5, 1, 34],
            angry: [1.25, 1.75, 1.9, 0.7, 1.15, 38],
            bushy: [1.55, 1.85, 1.55, 0.55, 2.1, 60]
        }[style];
    }

    /** Snaps a point to the face's skin, then raises it `off`. */
    function onSkin(H, p, off) {
        for (let k = 0; k < 3; k++) { const s = H.surface(p); if (!Number.isFinite(s.d)) break; p = add(p, mul(s.n, off - s.d)); }
        const s = H.surface(p);
        return { p, n: Number.isFinite(s.d) ? s.n : [0, 0, 1] };
    }

    function buildBrows(H, hair, m, rand) {
        const b = hair.brows;
        if (b.style === 'none') return;
        const shape = browShape(b.style);
        const color = b.color || hair.color;
        const base = shadeRgb(linear(color), 0.8);
        const er = H.eyeRadius;
        const thickness = (0.6 + 0.8 * b.thickness) * shape[4];
        for (const eye of [H.eyeL, H.eyeR]) {
            const side = Math.sign(eye[0] - H.center[0]) || 1;
            const inner = eye[0] - side * er * 1.15, outer = eye[0] + side * er * 1.75;
            const count = Math.round(shape[5] * (0.7 + 0.6 * b.thickness));
            for (let k = 0; k < count; k++) {
                const u = (k + rand()) / count;
                const hgt = u < shape[3] ? mix(shape[0], shape[1], Math.sin((u / shape[3]) * Math.PI / 2)) : mix(shape[1], shape[2], 1 - Math.cos(((u - shape[3]) / (1 - shape[3])) * Math.PI / 2));
                const band = (rand() - 0.5) * er * 0.38 * thickness * (1 - 0.6 * u);
                const x = mix(inner, outer, u), y = eye[1] + er * hgt + band;
                const start = onSkin(H, [x, y, eye[2] + er * 1.5], 0.0006 * H.scale);
                // Hairs point outward along the brow, the inner ones more upward.
                const along = norm([side * 1, mix(1.4, -0.15, u), 0]);
                const dir = tangent(along, start.n);
                const hl = er * (0.4 + 0.35 * rand()) * (u < 0.15 ? 0.7 : 1);
                const mid = onSkin(H, add(start.p, mul(dir, hl * 0.5)), 0.0009 * H.scale).p;
                const end = onSkin(H, add(start.p, mul(dir, hl)), 0.0007 * H.scale).p;
                const shade = 0.75 + 0.35 * rand();
                addClump(m, [start.p, mid, end], { width: er * 0.2 * thickness, flat: 0.25, sides: 3, center: H.center, color: () => shadeRgb(base, shade) });
            }
        }
    }

    /**
     * MakeHuman's lash cards, given coordinates of their own: along the lid
     * (the angle round the eye) by root to tip (the distance from it), so the
     * strand picture (`lashTexture`) tapers each lash out from the lid.
     */
    function buildLashes(H, m) {
        const h = H.pack.helpers && H.pack.helpers.lashes;
        if (!h) return;
        const base = m.pos.length / 3;
        const col = [0.03, 0.022, 0.02];
        const pts = Array.from(h.source, v => H.P(v));
        // Each eye's center: the mean of its side's lash vertices.
        const center = side => {
            const own = pts.filter(p => Math.sign(p[0]) === side);
            return own.reduce((a, p) => [a[0] + p[0] / own.length, a[1] + p[1] / own.length, a[2] + p[2] / own.length], [0, 0, 0]);
        };
        const C = { 1: center(1), '-1': center(-1) };
        // Mirrored per eye, so the angle runs 0 at the outer corner to π at the inner one over the top
        // (and down to -π under it), and no lid crosses where the angle wraps.
        const polar = pts.map(p => {
            const side = Math.sign(p[0]) || 1, c = C[side];
            return { a: Math.atan2(p[1] - c[1], (p[0] - c[0]) * side), r: Math.hypot(p[0] - c[0], p[1] - c[1]), up: p[1] > c[1] };
        });
        // Each lid (upper and lower, each side): along it by its own angles, root to tip by distance from the eye.
        const span = {};
        polar.forEach((q, i) => {
            const k = Math.sign(pts[i][0]) + ':' + q.up;
            const sp = span[k] || (span[k] = { r: [Infinity, -Infinity], a: [Infinity, -Infinity] });
            sp.r[0] = Math.min(sp.r[0], q.r); sp.r[1] = Math.max(sp.r[1], q.r);
            sp.a[0] = Math.min(sp.a[0], q.a); sp.a[1] = Math.max(sp.a[1], q.a);
        });
        m.uv = m.uv || [];
        while (m.uv.length < base * 2) m.uv.push(0, 0);
        polar.forEach((q, i) => {
            pushVert(m, pts[i], [0, 0, 1], col);
            const sp = span[Math.sign(pts[i][0]) + ':' + q.up];
            m.uv.push((q.a - sp.a[0]) / Math.max(1e-5, sp.a[1] - sp.a[0]), (q.r - sp.r[0]) / Math.max(1e-5, sp.r[1] - sp.r[0]));
        });
        for (let t = 0; t < h.index.length; t++) m.idx.push(base + h.index[t]);
    }

    /** Lash strands: thin dark lines across the lid, tapering from the root (v = 0) to the tip. */
    function lashTexture(size = 128) {
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const u = x / size, v = y / size, o = (y * size + x) * 4;
            let a = 0;
            const strands = 40;
            for (let k = 0; k < strands; k++) {
                const c = (k + 0.5) / strands + Math.sin(k * 7.1) * 0.006 + v * 0.012 * Math.sin(k * 3.3);
                const width = 0.006 * (1 - v * 0.8);
                const d = Math.abs(u - c);
                a = Math.max(a, 1 - d / Math.max(0.004, width));
            }
            a *= 1 - Math.max(0, v - 0.85) / 0.15;
            data[o] = 18; data[o + 1] = 13; data[o + 2] = 11; data[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
        }
        return { width: size, height: size, data, name: 'lashes.png' };
    }

    // ── assembly ───────────────────────────────────────────────────────────
    /** Rigid on the head; below the head bone a blend toward Neck, below the neck toward Spine2. */
    function skinOf(H, y, rigid) {
        const hb = H.bones.head, nb = H.bones.neck, cb = H.bones.chest;
        if (rigid) return [[hb, 0, 0, 0], [1, 0, 0, 0]];
        const yH = H.headBone.head[1], yN = H.neckBone.head[1];
        if (y >= yH) return [[hb, nb, cb, 0], [1, 0, 0, 0]];
        if (y >= yN) { const a = (yH - y) / Math.max(1e-5, yH - yN); return [[hb, nb, cb, 0], [1 - 0.5 * a, 0.5 * a, 0, 0]]; }
        const b = clamp((yN - y) / (0.2 * H.scale), 0, 1);
        return [[hb, nb, cb, 0], [0.5 - 0.2 * b, 0.5 - 0.2 * b, 0.4 * b, 0]];
    }

    function toPart(H, m, name, opts) {
        const count = m.pos.length / 3;
        const joints = new Uint8Array(count * 4), weights = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            const [j, w] = skinOf(H, m.pos[i * 3 + 1], opts.rigid);
            joints.set(j, i * 4); weights.set(w, i * 4);
        }
        return Object.assign({
            name,
            positions: Float32Array.from(m.pos),
            normals: Float32Array.from(m.nrm),
            index: Uint32Array.from(m.idx),
            joints, weights,
            colors: Float32Array.from(m.col),
            roughness: 0.55,
            doubleSided: true
        }, opts.extra || {});
    }

    /**
     * The hair parts for a built body: Hair, Facial hair, Brows, Lashes
     * (those present). `options.seed` varies the scatter; the same recipe
     * and seed grow the same hair. `options.skin` (hex) tints stubble.
     */
    function build(pack, built, hairInput, options) {
        const hair = normalizeHair(hairInput);
        const o = options || {};
        const H = measure(pack, built);
        const seed = (o.seed >>> 0) || hash(hair.style);
        const parts = [];
        const ramp = colorRamp(hair);
        const head = meshBuilder();
        let rand = rng(seed);
        for (const layer of styleLayers(H, hair)) {
            if (layer.type === 'cap') buildCap(H, hair, head, layer, ramp);
            else if (layer.type === 'strands') {
                if (layer.sheet) buildSheet(H, hair, head, layer, ramp, rand);
                buildStrands(H, hair, head, layer, ramp, rand);
            }
            else if (layer.type === 'spikes') buildSpikes(H, hair, head, layer, ramp, rand);
            else if (layer.type === 'afro') buildAfro(H, hair, head, layer, rand);
            else if (layer.type === 'tail') buildTail(H, hair, head, layer, ramp, rand);
            else if (layer.type === 'bun') buildBun(H, hair, head, layer, ramp, rand);
            else if (layer.type === 'braid') buildBraid(H, hair, head, layer, ramp, rand);
            else if (layer.type === 'locks') buildLocks(H, hair, head, layer, ramp, rand);
        }
        if (head.idx.length) parts.push(toPart(H, head, 'Hair', {}));
        rand = rng(seed ^ 0x51ed);
        const facial = meshBuilder();
        buildFacial(H, hair, facial, rand, hexOk(o.skin) ? o.skin : (built.recipe && built.recipe.skin));
        if (facial.idx.length) parts.push(toPart(H, facial, 'Facial hair', { rigid: true }));
        const brows = meshBuilder();
        buildBrows(H, hair, brows, rng(seed ^ 0xb40));
        if (brows.idx.length) parts.push(toPart(H, brows, 'Brows', { rigid: true }));
        if (hair.lashes) {
            const lashes = meshBuilder();
            buildLashes(H, lashes);
            if (lashes.idx.length) parts.push(toPart(H, lashes, 'Lashes', { rigid: true, extra: { roughness: 0.8, uvs: Float32Array.from(lashes.uv), texture: 'lashes.png', cutout: true, alphaCutoff: 0.35 } }));
        }
        return parts;
    }

    /** A seeded random hair recipe; men get facial hair now and then. */
    function randomHair(seed, opts) {
        const rand = rng(seed);
        const male = (opts && opts.gender != null ? opts.gender : rand()) >= 0.5;
        const pick = list => list[Math.floor(rand() * list.length)];
        const short = ['buzz', 'crew', 'sidePart', 'undercut', 'quiff', 'slickBack', 'messy', 'curlyShort', 'spiky', 'mullet', 'pompadour'];
        const long = ['bob', 'shoulder', 'long', 'longWavy', 'ponytail', 'bun', 'braid', 'pigtails', 'hime', 'curly', 'sweptBangs', 'pixie', 'twinBraids', 'bunLow', 'ponytailLow'];
        const any = ['afro', 'dreadlocks', 'shag', 'mohawk', 'topKnot', 'bald'];
        const style = rand() < 0.12 ? pick(any) : pick(male ? (rand() < 0.8 ? short : long) : (rand() < 0.8 ? long : short));
        const natural = ['#0e0b09', '#22170f', '#3b2a1e', '#5a3d26', '#7a5532', '#a0763f', '#c99a5b', '#e0c48a', '#8c3b1c', '#b2552a', '#9c9c9c', '#dcdcdc'];
        const color = rand() < 0.08 ? pick(['#6a2fa0', '#2f6ad0', '#d02f6a', '#2fa06a', '#e0e0f0']) : pick(natural);
        return normalizeHair({
            style, color, length: 0.8 + rand() * 0.5, volume: rand(), curl: rand() < 0.2 ? rand() : 0,
            part: pick(PARTS), fringe: rand() < 0.5 ? rand() : 0, hairline: male && rand() < 0.25 ? rand() * 0.8 : 0,
            highlights: rand() < 0.2 ? rand() : 0,
            facial: { style: male && rand() < 0.45 ? pick(FACIAL.slice(1)).id : 'none', length: 0.7 + rand() * 0.6, volume: rand() },
            brows: { style: pick(['natural', 'natural', 'thin', 'thick', 'arched', 'straight', 'bushy']), thickness: male ? 0.5 + rand() * 0.5 : rand() * 0.6 }
        });
    }

    const api = {
        lashTexture,
        STYLES, FACIAL, BROWS, PARTS, DEFAULT_HAIR, normalizeHair, randomHair, build,
        _internal: { measure, headCoords, cutSurface, facialField, meshBuilder, addShell, addClump, addTube, addBlob, grow, curlStrand, scatter, tangent, rng, hash, linear }
    };
    root.RRCharacterHair = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

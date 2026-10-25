/**
 * RRShieldProp - Weapons › Shields: a round plank shield, a heater, a kite,
 * a tower shield, a steel buckler and an energy shield, painted with a
 * field and an emblem (RRFlagDesign's), worn by use. Saved holdable.
 *
 * Built in weapon space (RRWeaponKit): the shield's face toward +z, its
 * top toward +x, across along y. The board is its outline made solid and
 * bent (dished, or curved round the arm), finely enough to bend; an edging
 * runs round its rim; a boss, rivets and straps go on. The face is a
 * picture: the design over planks or steel, chipped and scratched by the
 * Wear setting. Saved lying face up; the hand rig is the blade's with the
 * grip bar behind the boss running up the shield (gripBottom, gripTop),
 * the top of the rim as its tip and the face as its edge, so a fist holds
 * it with the face out over its knuckles.
 */
(function(root) {
    'use strict';

    const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
    const Rand = need('RRPropRandom', './PropRandom.js');
    const Mesh = need('RRPropMesh', './PropMesh.js');
    const CM = need('RRContainerMesh', './ContainerMesh.js');
    const Paint = need('RRPropPaint', './PropPaint.js');
    const Design = need('RRFlagDesign', './FlagDesign.js');
    const K = need('RRWeaponKit', './WeaponKit.js');
    const { clamp, color, pick } = K;

    const FACES = [['wood', 'Painted wood'], ['metal', 'Painted steel'], ['bare', 'Bare steel']];
    const PATTERNS = [['solid', 'Solid'], ['bands', 'Bands'], ['cross', 'Cross'], ['saltire', 'Saltire'], ['quartered', 'Quartered'], ['checker', 'Checkered'], ['bend', 'Diagonal bend'], ['border', 'Border']];
    const EMBLEMS = [['none', 'None']].concat(Design.SHAPES);
    const PRESETS = [
        ['round', 'Round shield', 'shields', { size: 0.8, shape: 0.35, face: 'wood', pattern: 'quartered', colors: ['#8c1c1c', '#f2efe6'], emblem: 'none', emblemColor: '#d9b23c', metal: 'iron', wear: 0.45 }],
        ['heater', 'Heater shield', 'shields', { size: 0.85, shape: 0.45, face: 'wood', pattern: 'solid', colors: ['#1f3c78', '#d9b23c'], emblem: 'crown', emblemColor: '#d9b23c', metal: 'steel', wear: 0.3 }],
        ['kite', 'Kite shield', 'shields', { size: 1.1, shape: 0.5, face: 'wood', pattern: 'bend', colors: ['#f2efe6', '#1d5c34'], emblem: 'cross', emblemColor: '#8c1c1c', metal: 'bronze', wear: 0.35 }],
        ['tower', 'Tower shield', 'shields', { size: 1.35, shape: 0.6, face: 'metal', pattern: 'border', colors: ['#5a2a6e', '#d9b23c'], emblem: 'eagle', emblemColor: '#d9b23c', metal: 'gold', wear: 0.2 }],
        ['buckler', 'Buckler', 'shields', { size: 0.34, shape: 0.6, face: 'bare', pattern: 'solid', colors: ['#3a3f4a', '#d9b23c'], emblem: 'none', emblemColor: '#d9b23c', metal: 'bronze', wear: 0.3 }],
        ['energy', 'Energy shield', 'scifi', { size: 0.9, shape: 0.4, face: 'metal', pattern: 'solid', colors: ['#2e3036', '#38c8ff'], emblem: 'none', emblemColor: '#38c8ff', metal: 'steel', wear: 0.1 }]
    ];
    const FAMILY = {
        round: { range: [0.45, 1.1], icon: 'buckler', shape: 'Dish' }, heater: { range: [0.6, 1.1], icon: 'shield', shape: 'Curve' }, kite: { range: [0.8, 1.4], icon: 'shield', shape: 'Curve' },
        tower: { range: [1.0, 1.7], icon: 'shield', shape: 'Curve' }, buckler: { range: [0.25, 0.5], icon: 'buckler', shape: 'Dish' }, energy: { range: [0.6, 1.3], icon: 'shield', shape: 'Curve' }
    };
    const PRESET_BY_ID = new Map(PRESETS.map(p => [p[0], p[3]]));
    const IDS = PRESETS.map(p => p[0]);

    function normalize(input) {
        const r = input && typeof input === 'object' ? input : {};
        const preset = pick(r.preset, IDS, 'round'), base = PRESET_BY_ID.get(preset), fam = FAMILY[preset];
        const v = key => (r[key] !== undefined ? r[key] : base[key]);
        const cs = Array.isArray(r.colors) ? r.colors : base.colors;
        return {
            kind: 'shield', preset,
            size: clamp(v('size'), fam.range[0], fam.range[1], base.size), shape: clamp(v('shape'), 0, 1, base.shape),
            face: pick(v('face'), FACES.map(f => f[0]), 'wood'), pattern: pick(v('pattern'), PATTERNS.map(p => p[0]), 'solid'),
            colors: [0, 1].map(i => color(cs[i], base.colors[i])), emblem: pick(v('emblem'), EMBLEMS.map(e => e[0]), 'none'), emblemColor: color(v('emblemColor'), '#d9b23c'),
            metal: pick(v('metal'), K.METALS.map(m => m[0]), 'steel'), wear: clamp(v('wear'), 0, 1, 0.3)
        };
    }

    // ── outlines (x up, y across, centered) ─────────────────────────────────
    function outline(preset, H) {
        if (preset === 'round' || preset === 'buckler') return K.circle(0, 0, H / 2, 96);
        if (preset === 'heater') {
            const W = H * 0.72, t = H / 2;
            return K.path(K.quad([t - 0.02, -W / 2], [t + 0.03, 0], [t - 0.02, W / 2], 16), K.quad([t - 0.02, W / 2], [-H * 0.05, W / 2 * 1.04], [-t, 0], 22), K.quad([-t, 0], [-H * 0.05, -W / 2 * 1.04], [t - 0.02, -W / 2], 22));
        }
        if (preset === 'kite') {
            const W = H * 0.52, c = H / 2 - W / 2;
            return K.path(K.arc(c, 0, W / 2, -Math.PI / 2, Math.PI / 2, 24), K.cubic([c, W / 2], [c - H * 0.25, W / 2 * 1.02], [-H * 0.3, W * 0.2], [-H / 2, 0], 24), K.cubic([-H / 2, 0], [-H * 0.3, -W * 0.2], [c - H * 0.25, -W / 2 * 1.02], [c, -W / 2], 24));
        }
        if (preset === 'tower') {
            const W = H * 0.5, t = H / 2, rr = W * 0.2, b = W * 0.06;
            // Corners round (x up, y across): the top ones broad, the foot's small; the top edge a little raised.
            return K.path(K.arc(t - rr, -W / 2 + rr, rr, -Math.PI / 2, 0, 8), K.quad([t, -W / 2 + rr], [t + 0.02, 0], [t, W / 2 - rr], 12), K.arc(t - rr, W / 2 - rr, rr, 0, Math.PI / 2, 8), K.arc(-t + b, W / 2 - b, b, Math.PI / 2, Math.PI, 5), K.arc(-t + b, -W / 2 + b, b, Math.PI, Math.PI * 1.5, 5));
        }
        // The energy shield: a long hexagon.
        const W = H * 0.72, t = H / 2;
        return [[t, -W * 0.28], [t, W * 0.28], [t * 0.35, W / 2], [-t * 0.45, W / 2], [-t, W * 0.16], [-t, -W * 0.16], [-t * 0.45, -W / 2], [t * 0.35, -W / 2]];
    }
    const bounds = pts => { const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity]; for (const p of pts) for (let k = 0; k < 2; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } return { lo, hi }; };

    /**
     * The board: the outline as a solid `thick` deep, its middle at z = bend(x, y),
     * finely enough cut to bend. The faces carry uvs across the whole shield (0..1).
     */
    function board(O, thick, bend, box, step) {
        const out = K.wind(K.densify(O, step * 0.9), true), tri = K.triangulate(out, []), fine = K.refine(tri.all, tri.faces, step);
        const W = box.hi[1] - box.lo[1], Hh = box.hi[0] - box.lo[0];
        const uv = p => [(p[1] - box.lo[1]) / W, (box.hi[0] - p[0]) / Hh];
        const at = (p, side) => [p[0], p[1], bend(p[0], p[1]) + side * thick / 2];
        // Front and back share the refined points; every triangle keeps the counterclockwise turn the
        // triangulation gave it (front) or the reverse (back), slivers included, so the solid stays whole.
        const faces = fine.faces.map(f => { const q = f.map(k => fine.pts[k]); const a2 = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); return a2 < -1e-12 ? [f[0], f[2], f[1]] : f; });
        const side = sgn => {
            const P = [], T = [];
            for (const p of fine.pts) { P.push(...at(p, sgn)); T.push(...uv(p)); }
            const I = sgn > 0 ? faces.flat() : faces.flatMap(f => [f[0], f[2], f[1]]);
            return Mesh.computeNormals({ positions: Float32Array.from(P), normals: null, uvs: Float32Array.from(T), index: Uint32Array.from(I) });
        };
        // The wall: along every edge only one triangle has (the outline, as the triangulation kept it).
        const used = new Map();
        for (const f of faces) for (let e = 0; e < 3; e++) { const a = f[e], b = f[(e + 1) % 3], k = Math.min(a, b) + ':' + Math.max(a, b); used.set(k, used.has(k) ? null : [a, b]); }
        const wall = new CM.Geo();
        for (const e of used.values()) {
            if (!e) continue;
            const a = fine.pts[e[0]], b = fine.pts[e[1]];
            wall.poly([at(a, 1), at(a, -1), at(b, -1), at(b, 1)], null, [b[1] - a[1], -(b[0] - a[0]), 0]);
        }
        return { face: side(1), back: side(-1), wall: CM.smoothNormals(wall.done(), 0.7), out };
    }

    /** The face's picture: the design laid over planks or steel, chipped and scratched by wear. */
    function facePicture(r, box, O) {
        const W = box.hi[1] - box.lo[1], H = box.hi[0] - box.lo[0], a = H / W;
        const colors = r.pattern === 'quartered' ? [r.colors[0], r.colors[1], r.colors[1], r.colors[0]] : r.pattern === 'cross' ? [r.colors[0], r.colors[1], r.colors[1]] : r.pattern === 'bands' ? [r.colors[0], r.colors[1], r.colors[0]] : [r.colors[0], r.colors[1], r.colors[0], r.colors[1], r.colors[0]];
        const design = Design.normalize({ field: { layout: r.pattern, colors, count: 3, orient: 'v', arm: 0.2, border: 0.09 }, layers: r.emblem === 'none' ? [] : [{ source: 'shape', shape: r.emblem, color: r.emblemColor, size: r.preset === 'kite' || r.preset === 'tower' ? 0.42 : 0.55, place: 'free', x: 0.5, y: r.preset === 'heater' ? 0.42 : r.preset === 'kite' ? 0.36 : r.preset === 'tower' ? 0.3 : 0.5 }] });
        const P = Design.prepare(design, a, {}), out = [0, 0, 0, 255];
        const n1 = Paint.fractal(17, 8, 4), n2 = Paint.fractal(41, 32, 3), wood = r.face === 'wood', bare = r.face === 'bare';
        const under = Paint.hex(wood ? '#8a6038' : '#9aa0a8'), size = 512, planks = r.preset === 'round' ? 7 : r.preset === 'buckler' ? 1 : 6;
        // How close each texel is to the rim (for the wear), from the outline.
        const rim = (u, v) => { const x = box.hi[0] - v * H, y = box.lo[1] + u * W; let d = Infinity; for (let i = 0; i < O.length; i += 3) d = Math.min(d, Math.hypot(O[i][0] - x, O[i][1] - y)); return d; };
        const pic = Paint.paint(size, size, (u, v, o) => {
            let c;
            if (bare) c = Paint.hex(K.look(r.metal === 'gold' ? 'steel' : 'steel').color);
            else { Design.colorAt(P, u, v, out); c = [out[0], out[1], out[2]]; }
            let k = 1, worn = 0;
            if (wood) {
                // Planks down the shield: a dark seam between, the grain along each.
                const pu = u * planks, f = pu - Math.floor(pu), seam = Math.min(f, 1 - f) * W / planks;
                const grain = 0.5 + 0.5 * Math.sin((u * planks * 7 + n1(u * 3, v) * 4 + Math.floor(pu) * 1.7) * Math.PI * 2);
                k *= seam < 0.0025 ? 0.45 : 0.93 + 0.07 * grain;
            }
            // Wear: paint chipped off toward the rim and in patches, scratches across the face.
            const d = rim(u, v), chip = n2(u * 2, v * 2) + (0.06 - Math.min(0.06, d)) * 8 * r.wear;
            if (!bare && chip > 1.02 - r.wear * 0.42) worn = 1;
            const scratch = Math.abs(Math.sin((u * 37 + v * 11 + n1(u, v) * 3) * Math.PI)) < 0.012 * r.wear ? 1 : 0;
            if (worn) c = under.map((x, i) => x * (0.8 + 0.25 * n1(u * 5, v * 5)));
            k *= 1 + 0.18 * scratch - 0.1 * r.wear * n2(u * 4, v * 4);
            o[0] = Math.min(255, c[0] * k); o[1] = Math.min(255, c[1] * k); o[2] = Math.min(255, c[2] * k); o[3] = 255;
        }, 1);
        pic.name = 'shield-face.png';
        return pic;
    }

    // ── the build ──────────────────────────────────────────────────────────
    function build(recipe, cache) {
        const r = normalize(recipe), c = cache || {}, H = r.size, preset = r.preset;
        const O = outline(preset, H), box = bounds(O), W = box.hi[1] - box.lo[1];
        const metalOnly = preset === 'buckler' || preset === 'energy' || r.face !== 'wood';
        const thick = preset === 'buckler' ? 0.004 : preset === 'energy' ? 0.012 : metalOnly ? 0.006 : 0.016;
        const round = preset === 'round' || preset === 'buckler';
        const dish = round ? (0.02 + 0.08 * r.shape) * H : 0, curve = round ? 0 : (0.05 + 0.3 * r.shape) * W;
        const R2 = (H / 2) * (H / 2);
        const bend = (x, y) => (round ? dish * Math.max(0, 1 - (x * x + y * y) / R2) : -curve * Math.pow(y / (W / 2), 2));
        const S = { Face: [], Back: [], Rim: [], Boss: [], Metal: [], Strap: [], Grip: [], Glow: [], Field: [] };
        const brd = board(O, thick, bend, box, Math.max(0.03, H / 22));
        if (preset === 'energy') {
            // A frame of chamfered plates round a field of light.
            const inner = O.map(p => [p[0] * 0.8, p[1] * 0.8]);
            const frame = K.plate(O, { t: () => 0.012, chamfer: 0.003, holes: [{ pts: inner, chamfer: 0.002 }] });
            S.Metal.push(frame.body);
            const field = K.plate(inner.map(p => [p[0] * 1.02, p[1] * 1.02]), { t: () => 0.003, chamfer: 0.001 });
            S.Field.push(field.body);
            // Hexagonal cells drawn in the field.
            const cell = H * 0.08;
            for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
                const cx = i * cell * 1.5, cy = j * cell * Math.sqrt(3) + (i % 2 ? cell * Math.sqrt(3) / 2 : 0);
                const pts = K.circle(cx, cy, cell * 0.92, 6);
                if (pts.some(p => !Paint.pointInPolygon(inner.flat().map(v => v * 0.98), p[0], p[1]))) continue;
                for (let k = 0; k < 6; k++) { const a = pts[k], b = pts[(k + 1) % 6]; S.Glow.push(K.bar([a[0], a[1], 0.0034], [b[0], b[1], 0.0034], [0, 0, 1], 0.0018, 0.0006)); }
            }
            // A glowing trim round the field's opening, bolts at the frame's corners, emitters top and foot.
            for (let k = 0; k < inner.length; k++) { const a = inner[k], b = inner[(k + 1) % inner.length]; S.Glow.push(K.bar([a[0] * 1.03, a[1] * 1.03, 0.0125], [b[0] * 1.03, b[1] * 1.03, 0.0125], [0, 0, 1], 0.003, 0.001)); S.Metal.push(K.rivet([O[k][0] * 0.9, O[k][1] * 0.9, 0.012], [0, 0, 1], 0.006)); }
            for (const sx of [1, -1]) S.Metal.push(K.gem([sx * H * 0.47, 0, 0], [sx, 0, 0], 0.012, 0.04, 6));
            S.Glow.push(K.gem([H * 0.5, 0, 0.0], [1, 0, 0], 0.006, 0.02, 6));
        } else {
            S.Face.push(brd.face); S.Back.push(brd.back, brd.wall);
            // The edging round the rim, riveted through.
            const rimPts = brd.out.map(p => [p[0], p[1], bend(p[0], p[1])]);
            const rw = preset === 'buckler' ? 0.008 : 0.016, rh = thick + (preset === 'buckler' ? 0.006 : 0.008);
            S.Rim.push(K.sweep(rimPts, K.roundRect(rw, rh, Math.min(rh, rw) * 0.35, 2), { up: [0, 0, 1], closed: true, cos: Math.cos(50 * Math.PI / 180) }));
            const Oin = K.offsetLeft(K.wind(O, true), rw * 0.9 + 0.012);
            let run = 0;
            for (let i = 0; i < Oin.length; i++) {
                const a = Oin[i], b = Oin[(i + 1) % Oin.length];
                run += Math.hypot(b[0] - a[0], b[1] - a[1]);
                if (run < (preset === 'buckler' ? 0.04 : 0.085)) continue;
                run = 0;
                S.Metal.push(K.rivet([a[0], a[1], bend(a[0], a[1]) + thick / 2], [0, 0, 1], preset === 'buckler' ? 0.003 : 0.0045));
            }
        }
        // The boss over the hand (round shields, the buckler, the tower), riveted round its flange.
        const bossR = preset === 'buckler' ? H * 0.28 : preset === 'tower' ? H * 0.09 : preset === 'round' ? H * 0.12 : 0;
        const z0 = bend(0, 0) + thick / 2;
        if (bossR) {
            const hgt = bossR * (preset === 'buckler' ? 0.55 : 0.75);
            S.Boss.push(Mesh.lathe([[bossR * 1.18, -0.004], [bossR * 1.2, 0.002], [bossR * 1.0, 0.004], [bossR * 0.98, hgt * 0.35], [bossR * 0.8, hgt * 0.75], [bossR * 0.45, hgt * 0.97], [0, hgt]], 36, { base: [0, 0, z0], dir: [0, 0, 1], sharp: 0.75 }));
            for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; S.Metal.push(K.rivet([Math.cos(a) * bossR * 1.1, Math.sin(a) * bossR * 1.1, z0 + 0.002], [0, 0, 1], 0.0045 * Math.min(1, H / 0.6) + 0.0012)); }
            if (preset === 'buckler') for (const rr of [0.36, 0.43]) S.Boss.push(K.band([0, 0, bend(H * rr, 0) + thick / 2 - 0.0025], [0, 0, 1], H * rr, 0.004, 0.0018));
        }
        // Tower and kite shields: bands across, studded where they cross the board.
        if (preset === 'tower') for (const fx of [0.4, -0.36]) {
            const x = fx * H, pts = [];
            for (let k = 0; k <= 16; k++) { const y = -W / 2 * 0.98 + W * 0.98 * k / 16; pts.push([x, y, bend(x, y) + thick / 2 + 0.002]); }
            S.Metal.push(K.sweep(pts, K.roundRect(0.03, 0.004, 0.0015, 1), { up: [0, 0, 1] }));
            for (const y of [-W * 0.36, 0, W * 0.36]) S.Metal.push(K.rivet([x, y, bend(x, y) + thick / 2 + 0.004], [0, 0, 1], 0.006));
        }
        // Behind: a grip bar up the middle, straps for the arm on the larger ones.
        const zb = bend(0, 0) - thick / 2, gl = Math.min(0.13, H * 0.3);
        S.Grip.push(K.tube([[-gl / 2 - 0.012, 0, zb + 0.002], [-gl / 2, 0, zb - 0.028], [gl / 2, 0, zb - 0.028], [gl / 2 + 0.012, 0, zb + 0.002]], 0.012, 10));
        for (const x of [-gl / 2 - 0.012, gl / 2 + 0.012]) S.Metal.push(CM.chamferBox([x, 0, zb - 0.002], [0.02, 0.03, 0.005], 0.0015));
        if (!round && preset !== 'energy') for (const fx of [0.28, -0.2]) {
            const x = fx * H, y0 = -W * 0.3, y1 = W * 0.3, pts = [];
            for (let k = 0; k <= 12; k++) { const y = y0 + (y1 - y0) * k / 12; pts.push([x, y, bend(x, y) - thick / 2 - 0.004 - 0.03 * Math.sin(Math.PI * k / 12)]); }
            S.Strap.push(K.sweep(pts, K.roundRect(0.035, 0.005, 0.002, 1), { up: [0, 0, 1] }));
            for (const y of [y0, y1]) S.Metal.push(K.rivet([x, y, bend(x, y) - thick / 2 - 0.002], [0, 0, -1], 0.005));
        }
        // Materials: the painted face, the edging and fittings in the chosen metal.
        const textures = {}, metal = K.look(r.metal), steel = K.look('steel');
        const key = JSON.stringify([r.preset, r.face, r.pattern, r.colors, r.emblem, r.emblemColor, r.wear]);
        if (preset !== 'energy') { if (c.faceKey !== key) { c.face = facePicture(r, box, brd.out); c.faceKey = key; } textures['shield-face.png'] = c.face; }
        if (!c.backWood) c.backWood = K.woodPicture('#6e4a2c', 61, 'shield-back.png');
        textures['shield-back.png'] = c.backWood;
        const glow = r.colors[1];
        const P = {
            Face: { meshes: S.Face, look: { kind: r.face === 'wood' ? 'prop' : 'metal', texture: 'shield-face.png', roughness: r.face === 'bare' ? 0.32 : r.face === 'wood' ? 0.6 : 0.45, metalness: r.face === 'bare' ? 0.9 : r.face === 'metal' ? 0.35 : 0, mat: r.face === 'wood' ? 'wood' : 'metal' } },
            Back: { meshes: S.Back, look: metalOnly ? { kind: 'metal', color: steel.color, roughness: 0.5, metalness: 0.8, mat: 'metal' } : { kind: 'prop', texture: 'shield-back.png', roughness: 0.7, metalness: 0, mat: 'wood' } },
            Rim: { meshes: S.Rim, look: { kind: 'metal', color: metal.color, roughness: metal.roughness, metalness: metal.metalness, mat: 'metal' } },
            Boss: { meshes: S.Boss, look: { kind: 'metal', color: metal.edge, roughness: Math.max(0.15, metal.roughness - 0.08), metalness: metal.metalness, mat: 'metal' } },
            Metal: { meshes: S.Metal, look: preset === 'energy' ? { kind: 'metal', color: '#6a707a', roughness: 0.35, metalness: 0.85, mat: 'metal' } : { kind: 'metal', color: metal.color, roughness: metal.roughness, metalness: metal.metalness, mat: 'metal' } },
            Strap: { meshes: S.Strap, look: { kind: 'prop', color: '#3a2418', roughness: 0.75, metalness: 0, mat: 'leather' } },
            Grip: { meshes: S.Grip, look: { kind: 'prop', color: '#2a1d15', roughness: 0.75, metalness: 0, mat: 'leather' } },
            Field: { meshes: S.Field, look: { kind: 'prop', color: glow, emissive: glow, emissiveIntensity: 0.35, opacity: 0.55, roughness: 0.2, metalness: 0 } },
            Glow: { meshes: S.Glow, look: { kind: 'prop', color: K.shadeHex(glow, 0.5), emissive: glow, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0 } }
        };
        const topX = box.hi[0];
        const marks = { gripBottom: [-gl / 2, 0, zb - 0.028], gripTop: [gl / 2, 0, zb - 0.028], tip: [topX, 0, zb - 0.028], edge: [0, 0, z0 + 0.05] };
        return K.finish('shield', r, P, marks, textures, { template: 'blade' });
    }

    /** A random shield: a style of its own (another when Everything rolls); shape its size and curve; details its pattern and emblem; colors its paint and metal. */
    function random(seed, recipe, scope, keep) {
        const R = Rand.roll(seed), cur = normalize(recipe), out = JSON.parse(JSON.stringify(cur));
        const all = !scope || scope === 'all', has = part => all || scope === part;
        const family = all && !keep ? R.pick(PRESETS) : PRESETS.find(p => p[0] === cur.preset);
        const base = family[3], fam = FAMILY[family[0]];
        out.preset = family[0];
        if (has('shape')) { out.size = Math.max(fam.range[0], Math.min(fam.range[1], R.jitter(base.size, 0.12))); out.shape = R.range(0.1, 0.9); }
        else if (out.preset !== cur.preset) Object.assign(out, { size: base.size, shape: base.shape });
        if (has('details')) { out.pattern = R.pick(PATTERNS)[0]; out.emblem = R.chance(0.6) ? R.pick(Design.SHAPES)[0] : 'none'; out.wear = R.range(0, 0.8); if (family[0] !== 'energy' && family[0] !== 'buckler') out.face = R.weighted([['wood', 3], ['metal', 1.5], ['bare', 0.5]]); }
        if (has('colors')) { const pal = R.pick(Rand.PALETTES.heraldic); out.colors = [pal[0], pal[1]]; out.emblemColor = pal[2]; out.metal = R.pick(K.METALS)[0]; }
        return normalize(out);
    }

    const api = { PRESETS, FAMILY, FACES, PATTERNS, normalize, build, random, outline };
    root.RRShieldProp = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    const Model = root.RRPropModel || (typeof require === 'function' ? require('./PropModel.js') : null);
    const Catalog = root.RRPropCatalog || (typeof require === 'function' ? require('./PropCatalog.js') : null);
    if (Model && Model.register) Model.register({ id: 'shield', label: 'Shield', normalize, build, random, randomScopes: [Rand.SCOPES.all, Rand.SCOPES.shape, Rand.SCOPES.design, Rand.SCOPES.colors] });
    if (Catalog) {
        K.icons(Catalog);
        Catalog.category({ id: 'shields', label: 'Shields', order: 49, parent: 'weapons' });
        for (const [id, label, category] of PRESETS) Catalog.add({ id: 'shield-' + id, category, label, icon: FAMILY[id].icon, kind: 'shield', keywords: 'weapon armor defense shield ' + id, start: () => normalize({ preset: id }), matches: r => r.preset === id });
        Catalog.ui('shield', K.page({
            placeholder: 'Shield', PRESETS, normalize, random, keep: ['face', 'pattern', 'colors', 'emblem', 'emblemColor', 'metal', 'wear'],
            tabs: [['shape', 'Shape'], ['look', 'Design']],
            shape(r) {
                const fam = FAMILY[r.preset];
                return this._slider({ path: 'size', label: 'Height', range: fam.range, step: 0.01, format: 'm' }) + this._slider({ path: 'shape', label: fam.shape, range: [0, 1] });
            },
            look(r) {
                const energy = r.preset === 'energy', painted = !energy && r.face !== 'bare';
                let html = this._section('Materials') + (energy || r.preset === 'buckler' ? '' : this._select('face', 'Face', FACES)) + this._select('metal', 'Rim and fittings', K.METALS);
                if (energy) return html + this._section('Glow') + this._color('colors.1', 'Glow color', ['#38c8ff', '#7aff6a', '#ff4a3a', '#c86aff', '#ffd24a']);
                if (painted) html += this._section('Design') + this._select('pattern', 'Pattern', PATTERNS) + this._color('colors.0', 'Color', ['#8c1c1c', '#1f3c78', '#1d5c34', '#f2efe6', '#2b2b30'])
                    + (r.pattern !== 'solid' ? this._color('colors.1', 'Second color', ['#d9b23c', '#f2efe6', '#8c1c1c', '#1f3c78', '#1b1b1f']) : '')
                    + this._select('emblem', 'Emblem', EMBLEMS) + (r.emblem !== 'none' ? this._color('emblemColor', 'Emblem color', ['#d9b23c', '#f2efe6', '#8c1c1c', '#1b1b1f', '#1f3c78']) : '');
                return html + this._section('Wear') + this._slider({ path: 'wear', label: 'Wear', range: [0, 1] });
            }
        }));
    }
})(typeof window !== 'undefined' ? window : globalThis);

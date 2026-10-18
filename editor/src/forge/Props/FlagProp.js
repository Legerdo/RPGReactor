/**
 * RRFlagProp - Forge › Prop Builder's Flag: a pole (metal flagpole, wooden
 * staff, wall bracket or crossbar banner) with its finial and rope, and a
 * cloth with its design, flying in a wind.
 *
 * One recipe describes the flag. `build` gives what the view and the file
 * share: the parts (the cloth skinned to a grid of bones, everything else
 * on the root bone), the pictures, and the cloth's setup for the
 * simulation; with a baked loop (RRPropCloth.bake, then tracks) it carries
 * the "Wave" clip as well.
 */
(function(root) {
    'use strict';

    const Cloth = root.RRPropCloth || (typeof require === 'function' ? require('./PropCloth.js') : null);
    const Paint = root.RRPropPaint || (typeof require === 'function' ? require('./PropPaint.js') : null);
    const Mesh = root.RRPropMesh || (typeof require === 'function' ? require('./PropMesh.js') : null);

    const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
    const pick = (v, list, d) => (list.includes(v) ? v : d);

    const POLES = [
        { id: 'metal', label: 'Metal flagpole', height: [3, 14, 6], width: 1.5, aspect: '2:3', finial: 'ball', color: '#c3c7cc', finialColor: '#d4a940', angle: 0 },
        { id: 'staff', label: 'Wooden staff', height: [1.4, 4, 2.4], width: 1.0, aspect: '2:3', finial: 'spear', color: '#7a5434', finialColor: '#b8b8be', angle: 0 },
        { id: 'bracket', label: 'Wall bracket', height: [0.8, 3, 1.5], width: 0.9, aspect: '2:3', finial: 'ball', color: '#2a2a2e', finialColor: '#c9a03c', angle: 0 },
        { id: 'crossbar', label: 'Crossbar banner', height: [1.6, 6, 3], width: 0.8, aspect: '2:1', finial: 'spear', color: '#6e4a2c', finialColor: '#d4a940', angle: 55 }
    ];
    const POLE_BY_ID = new Map(POLES.map(p => [p.id, p]));
    const FINIALS = [['ball', 'Ball'], ['spear', 'Spearhead'], ['eagle', 'Eagle'], ['none', 'None']];
    const FABRICS = [['cotton', 'Cotton bunting'], ['silk', 'Silk'], ['wool', 'Heavy wool'], ['tattered', 'Worn and tattered']];
    /** Height to width. */
    const ASPECTS = [['1:2', '1:2', 0.5], ['3:5', '3:5', 0.6], ['2:3', '2:3', 2 / 3], ['3:4', '3:4', 0.75], ['1:1', '1:1', 1], ['3:2', '3:2 (tall)', 1.5], ['2:1', '2:1 (tall)', 2], ['custom', 'Custom', 0]];
    const LAYOUTS = [
        { id: 'solid', label: 'Solid', colors: ['Background'] },
        { id: 'bands2h', label: 'Two bands', colors: ['Top band', 'Bottom band'] },
        { id: 'bands3h', label: 'Three bands', colors: ['Top band', 'Middle band', 'Bottom band'] },
        { id: 'bands2v', label: 'Two upright bands', colors: ['Hoist band', 'Fly band'] },
        { id: 'bands3v', label: 'Three upright bands', colors: ['Hoist band', 'Middle band', 'Fly band'] },
        { id: 'nordic', label: 'Nordic cross', colors: ['Background', 'Cross', 'Outline'] },
        { id: 'saltire', label: 'Saltire', colors: ['Background', 'Cross'] },
        { id: 'canton', label: 'Canton', colors: ['Background', 'Canton'] },
        { id: 'triangle', label: 'Hoist triangle', colors: ['Top band', 'Bottom band', 'Hoist triangle'] },
        { id: 'border', label: 'Border', colors: ['Background', 'Border'] },
        { id: 'emblem', label: 'Centered emblem', colors: ['Background'] },
        { id: 'image', label: 'Picture', colors: [] }
    ];
    const LAYOUT_BY_ID = new Map(LAYOUTS.map(l => [l.id, l]));
    const EMBLEMS = [['none', 'None'], ['star', 'Star'], ['circle', 'Circle'], ['crescent', 'Crescent'], ['shield', 'Shield'], ['sun', 'Sun'], ['eagle', 'Eagle']];
    const PLACES = [['center', 'Center'], ['canton', 'Canton'], ['hoist', 'Hoist']];
    const LOOP = 3;

    const DEFAULT = {
        kind: 'flag',
        pole: { type: 'metal', height: 6, finial: 'ball', rope: true, color: '#c3c7cc', finialColor: '#d4a940' },
        cloth: { width: 1.5, aspect: '2:3', height: 1, fabric: 'cotton', wear: 0.5 },
        design: { layout: 'solid', colors: ['#8c1c1c', '#d9b23c', '#f2efe6', '#1f3c78'], emblem: { shape: 'eagle', color: '#d9b23c', size: 0.62, place: 'center' }, image: '' },
        wind: { strength: 0.4, gust: 0.4, direction: 0 },
        seed: 7
    };

    function ratioOf(aspect) { const a = ASPECTS.find(x => x[0] === aspect); return a ? a[2] : 0; }

    function normalize(input) {
        const r = input && typeof input === 'object' ? input : {};
        const d = DEFAULT;
        const p = r.pole || {}, c = r.cloth || {}, g = r.design || d.design, w = r.wind || {}, e = g.emblem || {};
        const type = pick(p.type, POLES.map(x => x.id), d.pole.type), def = POLE_BY_ID.get(type);
        const aspect = pick(c.aspect, ASPECTS.map(a => a[0]), def.aspect);
        const width = clamp(c.width, 0.3, 3, def.width);
        const height = aspect === 'custom' ? clamp(c.height, 0.2, 4, width * 2 / 3) : Math.round(width * ratioOf(aspect) * 1000) / 1000;
        const colors = [0, 1, 2, 3].map(k => color((g.colors || [])[k], d.design.colors[k]));
        return {
            kind: 'flag',
            pole: {
                type, height: clamp(p.height, def.height[0], def.height[1], def.height[2]),
                finial: pick(p.finial, FINIALS.map(f => f[0]), def.finial), rope: p.rope !== false,
                color: color(p.color, def.color), finialColor: color(p.finialColor, def.finialColor)
            },
            cloth: { width, aspect, height, fabric: pick(c.fabric, FABRICS.map(f => f[0]), 'cotton'), wear: clamp(c.wear, 0, 1, 0.5) },
            design: {
                layout: pick(g.layout, LAYOUTS.map(l => l.id), d.design.layout), colors,
                emblem: { shape: pick(e.shape, EMBLEMS.map(x => x[0]), 'none'), color: color(e.color, '#d9b23c'), size: clamp(e.size, 0.15, 0.95, 0.5), place: pick(e.place, PLACES.map(x => x[0]), 'center') },
                image: typeof g.image === 'string' ? g.image.slice(0, 200) : ''
            },
            wind: { strength: clamp(w.strength, 0, 1, d.wind.strength), gust: clamp(w.gust, 0, 1, d.wind.gust), direction: clamp(w.direction, -90, 90, def.angle) },
            seed: (Number(r.seed) >>> 0) || 1
        };
    }

    /** A pole type's own starting point, keeping the cloth's design, fabric and the wind. */
    function withPole(recipe, type) {
        const r = normalize(recipe), def = POLE_BY_ID.get(type) || POLES[0];
        r.pole = { type: def.id, height: def.height[2], finial: def.finial, rope: true, color: def.color, finialColor: def.finialColor };
        r.cloth.width = def.width; r.cloth.aspect = def.aspect;
        r.wind.direction = def.angle;
        return normalize(r);
    }

    /** Wind speed (m/s) for the Wind slider: a calm is a breath of air, a storm 20 m/s. */
    function windSpeed(strength) { return 0.25 + 19.75 * Math.pow(strength, 1.35); }

    // ── the design ─────────────────────────────────────────────────────────
    /** A design read once for painting: its colors as numbers, its emblem's test, size and place. */
    function prepare(design, a) {
        const C = design.colors.map(Paint.hex), e = design.emblem, layout = design.layout;
        const shape = layout === 'emblem' && e.shape === 'none' ? 'star' : e.shape;
        const out = { layout, C, a, emblem: null, nordic: Math.min(0.42, 0.5 - 0.14 / Math.max(0.5, a) * a), tip: Math.min(0.5, 0.866 * a) };
        if (shape !== 'none' && layout !== 'image') {
            const place = layout === 'emblem' ? 'center' : e.place;
            let size = e.size, cu = 0.5, cv = 0.5;
            if (place === 'canton') { size = Math.min(size, 0.45); cu = layout === 'canton' ? 0.21 : layout === 'nordic' ? out.nordic / 2 : 0.25; cv = layout === 'canton' ? 0.27 : 0.25; }
            else if (place === 'hoist') { size = Math.min(size, 0.7); cu = layout === 'triangle' ? out.tip * 0.36 : Math.min(0.22, 0.5 * size * a + 0.04); }
            out.emblem = { test: Paint.EMBLEMS[shape], cu, cv, su: size * 0.5 * a, sv: size * 0.5, color: Paint.hex(e.color) };
        }
        return out;
    }

    /** The design's color at (u, v): u from hoist to fly, v from top to bottom (`P` from prepare). */
    function designAt(P, u, v, out, image) {
        const C = P.C, a = P.a, layout = P.layout;
        let c = C[0];
        if (layout === 'image') {
            if (image) { Paint.sampleImage(image, u, v, out); return out; }
        } else if (layout === 'bands2h') c = v < 0.5 ? C[0] : C[1];
        else if (layout === 'bands3h') c = v < 1 / 3 ? C[0] : v < 2 / 3 ? C[1] : C[2];
        else if (layout === 'bands2v') c = u < 0.5 ? C[0] : C[1];
        else if (layout === 'bands3v') c = u < 1 / 3 ? C[0] : u < 2 / 3 ? C[1] : C[2];
        else if (layout === 'nordic') {
            // The upright bar toward the hoist; widths measured in the flag's height.
            const d = Math.min(Math.abs(u - P.nordic) / a, Math.abs(v - 0.5));
            c = d < 0.085 ? C[1] : d < 0.125 ? C[2] : C[0];
        } else if (layout === 'saltire') {
            const y = v * a, len = Math.hypot(1, a);
            const d = Math.min(Math.abs(u * a - y) / len, Math.abs((1 - u) * a - y) / len);
            c = d < 0.1 * a ? C[1] : C[0];
        } else if (layout === 'canton') c = u < 0.42 && v < 0.54 ? C[1] : C[0];
        else if (layout === 'triangle') c = u < P.tip * (1 - Math.abs(v - 0.5) * 2) ? C[2] : v < 0.5 ? C[0] : C[1];
        else if (layout === 'border') c = Math.min(u / a, (1 - u) / a, v, 1 - v) < 0.1 ? C[1] : C[0];
        out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 255;
        const E = P.emblem;
        if (E) {
            const ex = (u - E.cu) / E.su, ey = (v - E.cv) / E.sv;
            if (ex >= -1 && ex <= 1 && ey >= -1 && ey <= 1 && E.test(ex, ey)) { out[0] = E.color[0]; out[1] = E.color[1]; out[2] = E.color[2]; }
        }
        return out;
    }

    /** Where a worn cloth has worn through: 1 in a hole, 0 in sound cloth. */
    function wearAt(seed, wear) {
        const holes = Paint.fractal(seed * 31 + 5, 5, 3), fray = Paint.noise(seed * 17 + 3, 48), frayBig = Paint.noise(seed * 13 + 9, 6);
        const level = (u, v) => holes(u, v) * (0.75 + 0.5 * u);
        const edge = 0.92 - wear * 0.22;
        return {
            level, edge,
            hole: (u, v) => wear > 0 && level(u, v) > edge ? 1 : 0,
            // How far in from the fly the frayed edge has torn.
            fly: v => wear * (0.03 + 0.11 * frayBig(0.5, v) + 0.05 * fray(0.5, v)),
            seed
        };
    }

    /**
     * The cloth's picture: the design (each pixel the average of four
     * samples), with its weave in the color (threads, hems, the hoist's
     * heading or sleeve) and, worn, faded and soiled, holed and frayed at
     * the fly (holes and the torn edge are see-through).
     */
    function paintCloth(r, size, image) {
        const a = r.cloth.height / r.cloth.width;
        const [tw, th] = pictureSize(a, size);
        const P = prepare(r.design, a);
        const tattered = r.cloth.fabric === 'tattered', wear = tattered ? r.cloth.wear : 0;
        const worn = wearAt(r.seed, wear);
        const soil = Paint.fractal(r.seed * 7 + 1, 8, 3), fuzz = Paint.noise(r.seed + 77, 128), threads = Paint.noise(r.seed + 5, 64);
        const weave = r.cloth.fabric === 'wool' ? 'twill' : r.cloth.fabric === 'silk' ? 'satin' : 'plain';
        const depth = r.cloth.fabric === 'silk' ? 0.03 : r.cloth.fabric === 'wool' ? 0.1 : 0.06;
        const heading = r.pole.type === 'metal' ? Math.max(0.025, 0.04 / r.cloth.width) : 0;
        const sleeve = r.pole.type === 'staff' || r.pole.type === 'bracket' ? Math.max(0.02, 0.035 / r.cloth.width) : 0;
        const hem = 0.012 / Math.max(r.cloth.width, 0.3), hemV = 0.012 / Math.max(r.cloth.height, 0.2);
        const line = 1.2 / tw, lineV = 1.2 / th;
        const canvas = Paint.hex('#e9e4d6');
        const data = new Uint8ClampedArray(tw * th * 4), s = [0, 0, 0, 255];
        const one = r.design.layout === 'image';
        for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
            const u = (x + 0.5) / tw, v = (y + 0.5) / th;
            let R = 0, G = 0, B = 0, A = 0;
            if (one) { designAt(P, u, v, s, image); R = s[0]; G = s[1]; B = s[2]; A = s[3]; }
            else {
                for (let k = 0; k < 4; k++) { designAt(P, (x + 0.25 + 0.5 * (k & 1)) / tw, (y + 0.25 + 0.5 * (k >> 1)) / th, s, image); R += s[0]; G += s[1]; B += s[2]; }
                R /= 4; G /= 4; B /= 4; A = 255;
            }
            let k = 1;
            if (heading && u < heading) { R = canvas[0]; G = canvas[1]; B = canvas[2]; A = 255; if (u > heading * 0.85) k *= 0.85; }
            // Brass grommets near the heading's ends.
            if (heading) for (const gy of [0.06, 0.94]) {
                const d = Math.hypot((u - heading * 0.5) / a, v - gy) * 100;
                if (d < 1.4) { if (d > 0.8) { R = 186; G = 150; B = 80; k *= 0.8; } else k *= 0.15; }
            }
            if (sleeve && u < sleeve) k *= 0.9 + 0.1 * Math.sin(u / sleeve * Math.PI);
            // Hems: a double fold of cloth along the edges, stitched a little in from the edge.
            if (u > 1 - hem || v < hemV || v > 1 - hemV) k *= 0.93;
            if (Math.abs(u - (1 - hem)) < line || Math.abs(v - hemV) < lineV || Math.abs(v - (1 - hemV)) < lineV) k *= 0.85;
            const h = Paint.weaveHeight(weave, x / 2, y / 2);
            k *= 1 - depth + depth * 2 * h * (weave === 'twill' ? 0.8 + 0.4 * fuzz(u, v) : 1);
            if (wear > 0) {
                // Faded by the sun toward the fly, greyed, soiled toward the foot.
                const fade = wear * (0.2 + 0.35 * u) * 0.8, lum = 0.3 * R + 0.59 * G + 0.11 * B;
                R += (lum * 0.92 + 16 - R) * fade; G += (lum * 0.92 + 10 - G) * fade; B += (lum * 0.92 - 4 - B) * fade;
                const grime = Math.max(0, soil(u, v) - 0.5) * 0.9 * wear * (0.5 + 0.7 * v);
                k *= 1 - Math.min(0.18, grime);
                R *= 1 + grime * 0.08; B *= 1 - grime * 0.2;
                // Scorched rims around the holes.
                if (worn.level(u, v) > worn.edge - 0.025) k *= 0.6;
                if (worn.hole(u, v)) A = 0;
                const fly = worn.fly(v);
                if (u > 1 - fly) A = 0;
                else if (u > 1 - fly - 0.012) k *= 0.82;
                // Loose threads hang past the torn edge.
                if (u > 1 - fly && u < 1 - fly + 0.04 && Math.abs(((y / 3) % 1) - 0.5) < 0.18 && threads(u, v) > 0.55) { A = 255; k *= 0.7; }
            }
            const o = (y * tw + x) * 4;
            data[o] = R * k; data[o + 1] = G * k; data[o + 2] = B * k; data[o + 3] = A;
        }
        return { width: tw, height: th, data: new Uint8Array(data.buffer), name: 'cloth.png' };
    }

    /** A cloth picture's width and height: the long side `size`, the short one half of it when the cloth is at most three quarters as wide as long. */
    function pictureSize(a, size) {
        if (a <= 0.75) return [size, size / 2];
        if (a >= 1.34) return [size / 2, size];
        return [size, size];
    }

    function paintNormal(r, size) {
        const [tw, th] = pictureSize(r.cloth.height / r.cloth.width, size);
        const weave = r.cloth.fabric === 'wool' ? 'twill' : r.cloth.fabric === 'silk' ? 'satin' : 'plain';
        const hem = 0.012 / Math.max(r.cloth.width, 0.3) * tw;
        const map = Paint.normalMap(tw, th, (x, y) => {
            let h = Paint.weaveHeight(weave, x / 1.5, y / 1.5) * 0.6;
            if (x > tw - hem) h += 0.9;
            return h;
        }, r.cloth.fabric === 'silk' ? 0.8 : 2.2);
        map.name = 'cloth_normal.png';
        return map;
    }

    // ── the pole ───────────────────────────────────────────────────────────
    /** The finial on top of a pole, standing at `at` along `dir`, sized for a pole of radius `r`. */
    function finial(kind, at, dir, r) {
        const s = Math.max(r, 0.02);
        if (kind === 'none') return Mesh.tube(at, at.map((v, k) => v + dir[k] * s * 0.5), s * 1.05, s * 0.9, 12);
        if (kind === 'ball') return Mesh.lathe([[0, 0], [s * 0.7, 0], [s * 0.55, s * 0.6], [s * 0.9, s * 1.0], [s * 1.6, s * 1.9], [s * 1.75, s * 2.9], [s * 1.6, s * 3.9], [s * 0.9, s * 4.7], [0, s * 4.95]], 16, { base: at, dir, sharp: 0.3 });
        if (kind === 'spear') return Mesh.lathe([[0, 0], [s * 0.85, 0], [s * 0.85, s * 1.6], [s * 1.1, s * 2.0], [s * 0.6, s * 2.4], [s * 2.1, s * 4.2], [s * 1.6, s * 6.5], [0, s * 9]], 4, { base: at, dir, phase: Math.PI / 4, sharp: 0.95 });
        // The eagle: a ball and, on it, a flat silhouette with its wings raised, facing out of the flag.
        const ball = Mesh.sphere(at.map((v, k) => v + dir[k] * s * 1.4), s * 1.4, 12);
        const span = s * 7;
        // Drawn y down; stood up y up before it is made solid, so its faces stay outward.
        const outline = Array.from(Paint.EAGLE, (v, i) => (i % 2 ? -v : v));
        const bird = Mesh.extrude([outline], s * 0.7, { bevel: s * 0.18 });
        Mesh.transform(bird, ([x, y, z]) => [at[0] + x * span * 0.5, at[1] + s * 2.6 + (y + 0.95) * span * 0.5, at[2] + z]);
        return Mesh.merge([ball, Mesh.tube(at, at.map((v, k) => v + dir[k] * s * 0.6), s * 0.8, s * 0.8, 12), bird]);
    }

    /**
     * Where everything stands for a recipe: the pole's solids, the cloth's
     * rest grid with its pinned edge, and what the cloth must keep out of.
     * Model space: meters, y up, the pole's foot (or the wall plate's foot)
     * at the origin, the cloth's face toward +z, its fly toward +x.
     */
    function layout(r) {
        const P = r.pole, W = r.cloth.width;
        let H = r.cloth.height;
        const solids = { pole: [], finial: [], rope: [] };
        const colliders = [];
        let hoistTop, down, across, pinTop = false;
        if (P.type === 'metal') {
            const h = P.height, rb = 0.03 + h * 0.0035, rt = rb * 0.68;
            solids.pole.push(Mesh.lathe([[rb * 1.9, 0], [rb * 1.9, 0.1], [rb * 1.45, 0.14], [rb * 1.15, 0.18], [rb, 0.24], [rt, h - 0.05], [rt * 1.7, h - 0.05], [rt * 1.7, h], [rt, h]], 16, { sharp: 0.7 }));
            solids.finial.push(finial(P.finial, [0, h, 0], [0, 1, 0], rt));
            const x0 = rt + 0.025, top = h - 0.14;
            H = Math.min(H, top - 1.2);
            hoistTop = [x0, top, 0]; down = [0, -1, 0]; across = [1, 0, 0];
            colliders.push({ a: [0, 0, 0], b: [0, h, 0], r: (rb + rt) / 2 });
            if (P.rope) {
                // The halyard: down from the truck to the flag's head, from its foot to the cleat, and the
                // return line close beside the pole all the way.
                const cleat = 1.15, line = 0.0055;
                solids.rope.push(Mesh.tube([x0, h - 0.04, 0], [x0, top, 0], line, line, 5));
                solids.rope.push(Mesh.tube([x0, top - H, 0], [rb + 0.012, cleat + 0.03, 0.006], line, line, 5));
                solids.rope.push(Mesh.tube([rt + 0.012, h - 0.04, 0.012], [rb + 0.014, cleat + 0.03, 0.014], line, line, 5));
                solids.pole.push(Mesh.box([rb + 0.012, cleat, 0.01], [0.022, 0.14, 0.028]));
            }
        } else if (P.type === 'staff') {
            const h = P.height, rr = 0.021;
            solids.pole.push(Mesh.lathe([[rr * 1.15, 0], [rr * 1.15, 0.06], [rr, 0.07], [rr * 0.92, h]], 12, { sharp: 0.7 }));
            solids.finial.push(finial(P.finial, [0, h, 0], [0, 1, 0], rr * 0.95));
            const top = h - 0.05;
            H = Math.min(H, top - 0.4);
            hoistTop = [rr + 0.006, top, 0]; down = [0, -1, 0]; across = [1, 0, 0];
            colliders.push({ a: [0, 0, 0], b: [0, h, 0], r: rr });
        } else if (P.type === 'bracket') {
            // Out from a wall (the y-z plane at x = 0) and up, at forty degrees.
            const mount = 2.4, len = P.height, rr = 0.018, angle = 40 * Math.PI / 180;
            const d = [Math.cos(angle), Math.sin(angle), 0];
            const base = [0.07, mount, 0], tip = base.map((v, k) => v + d[k] * len);
            solids.pole.push(Mesh.box([0.008, mount + 0.04, 0], [0.016, 0.26, 0.11]));
            solids.pole.push(Mesh.tube([0.016, mount, 0], base, 0.032, 0.026, 12));
            solids.pole.push(Mesh.tube(base, tip, rr, rr * 0.9, 12));
            solids.finial.push(finial(P.finial, tip, d, rr));
            H = Math.min(H, len * 0.88);
            hoistTop = tip.map((v, k) => v - d[k] * 0.06 + [d[1], -d[0], 0][k] * (rr + 0.006));
            down = d.map(v => -v); across = [d[1], -d[0], 0];
            colliders.push({ a: base, b: tip, r: rr });
        } else {
            const h = P.height, rr = 0.024, bar = h - 0.1, zb = rr + 0.03;
            solids.pole.push(Mesh.lathe([[rr * 1.15, 0], [rr * 1.15, 0.06], [rr, 0.07], [rr * 0.9, h]], 12, { sharp: 0.7 }));
            solids.finial.push(finial(P.finial, [0, h, 0], [0, 1, 0], rr * 0.9));
            const half = W / 2 + 0.06;
            solids.pole.push(Mesh.tube([-half, bar, zb], [half, bar, zb], 0.014, 0.014, 10));
            for (const s of [-1, 1]) {
                solids.finial.push(Mesh.sphere([s * (half + 0.012), bar, zb], 0.022, 10));
                // Cords from the pole's top to the bar's ends, and a tassel hanging from each end.
                solids.rope.push(Mesh.tube([0, h - 0.02, rr * 0.5], [s * (half - 0.02), bar + 0.01, zb], 0.004, 0.004, 5));
                solids.rope.push(Mesh.tube([s * (half - 0.03), bar - 0.01, zb], [s * (half - 0.03), bar - 0.12, zb], 0.004, 0.004, 5));
                solids.rope.push(Mesh.lathe([[0, 0], [0.018, 0.012], [0.012, 0.08], [0.004, 0.1]], 8, { base: [s * (half - 0.03), bar - 0.22, zb] }));
            }
            H = Math.min(H, bar - 0.25);
            hoistTop = [-W / 2, bar - 0.018, zb]; down = [0, -1, 0]; across = [1, 0, 0]; pinTop = true;
            colliders.push({ a: [0, 0, 0], b: [0, h, 0], r: rr + 0.01 }, { a: [-half, bar, zb], b: [half, bar, zb], r: 0.014 });
        }
        // The cloth's grid: about 360 particles, odd counts each way so every other one carries a bone.
        const s = Math.sqrt(W * H / 360);
        const odd = (v, lo, hi) => { let n = Math.max(lo, Math.min(hi, Math.round(v))); if (n % 2 === 0) n++; return n; };
        const nx = odd(W / s + 1, 7, 31), ny = odd(H / s + 1, 7, 31);
        const rest = new Float32Array(nx * ny * 3), pinned = new Uint8Array(nx * ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = (j * nx + i) * 3, x = i / (nx - 1) * W, y = j / (ny - 1) * H;
            for (let c = 0; c < 3; c++) rest[k + c] = hoistTop[c] + across[c] * x + down[c] * y;
            if (pinTop ? j === 0 : i === 0) pinned[j * nx + i] = 1;
        }
        return { solids, colliders, nx, ny, rest, pinned, pinTop, width: W, height: H };
    }

    // ── the build ──────────────────────────────────────────────────────────
    const rigid = mesh => Object.assign(mesh, { joints: new Uint16Array(mesh.positions.length / 3 * 4), weights: (() => { const w = new Float32Array(mesh.positions.length / 3 * 4); for (let i = 0; i < w.length; i += 4) w[i] = 1; return w; })() });

    /**
     * Everything the view and the file need. `cache` keeps pictures between
     * builds (they depend on the design and cloth only); `options.images`
     * holds a design picture's pixels by its name; `options.loop` a baked
     * loop ({ times, T, Q } from RRPropCloth.tracks) to carry as the clip;
     * `options.textureSize` the cloth picture's long side (1024).
     */
    function build(recipe, cache, options) {
        const r = normalize(recipe), o = options || {}, c = cache || {};
        const L = layout(r);
        const size = o.textureSize || 1024;
        const image = r.design.layout === 'image' && r.design.image ? (o.images || {})[r.design.image] || null : null;
        const sizeKey = [r.cloth.width, L.height, r.pole.type, size].join(',');
        const pictureKey = JSON.stringify([r.design, r.cloth.fabric, r.cloth.wear, r.seed, sizeKey, image ? [image.width, image.height, image.version || 0] : 0]);
        const rr = Object.assign({}, r, { cloth: Object.assign({}, r.cloth, { height: L.height }) });
        if (c.pictureKey !== pictureKey) { c.picture = paintCloth(rr, size, image); c.pictureKey = pictureKey; }
        const normalKey = JSON.stringify([r.cloth.fabric, sizeKey]);
        if (c.normalKey !== normalKey) { c.normal = paintNormal(rr, Math.max(256, size / 2)); c.normalKey = normalKey; }
        const tattered = r.cloth.fabric === 'tattered';
        const cutout = tattered || (image && hasAlpha(image));

        // The cloth: the particle grid itself, skinned to every other particle.
        // About seventy bones: the cloth within a few millimeters of its simulation, at little cost a frame.
        const grid = Cloth.boneGrid(L.nx, L.ny, 72, L.pinTop ? 'across' : 'up');
        const nx = L.nx, ny = L.ny, nv = nx * ny;
        const uvs = new Float32Array(nv * 2), normals = new Float32Array(nv * 3), index = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = j * nx + i; uvs[v * 2] = i / (nx - 1); uvs[v * 2 + 1] = j / (ny - 1); }
        const face = faceNormal(L.rest, nx, ny);
        for (let v = 0; v < nv; v++) normals.set(face, v * 3);
        for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) { const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1; index.push(a, cc, b, b, cc, d); }
        const joints = new Uint16Array(nv * 4);
        for (let k = 0; k < joints.length; k++) joints[k] = grid.joints[k] + 1;
        const fabric = Cloth.FABRICS[r.cloth.fabric];
        const roughness = { cotton: 0.88, silk: 0.42, wool: 0.95, tattered: 0.92 }[r.cloth.fabric];
        const cloth = {
            name: 'Cloth', kind: 'cloth', positions: Float32Array.from(L.rest), normals, uvs, index: Uint32Array.from(index), joints, weights: grid.weights,
            texture: 'cloth.png', normalTexture: 'cloth_normal.png', normalScale: 0.35, roughness, metalness: 0, doubleSided: true
        };
        if (cutout) { cloth.cutout = true; cloth.alphaCutoff = 0.5; }
        const parts = [cloth];
        const metal = r.pole.type === 'metal' || r.pole.type === 'bracket';
        const pole = Mesh.merge(L.solids.pole);
        if (pole.index.length) parts.push(rigid(Object.assign(pole, { name: 'Pole', kind: metal ? 'metal' : 'prop', color: r.pole.color, roughness: metal ? 0.38 : 0.72, metalness: metal ? 0.8 : 0 })));
        const fin = Mesh.merge(L.solids.finial);
        if (fin.index.length) parts.push(rigid(Object.assign(fin, { name: 'Finial', kind: 'metal', color: r.pole.finialColor, roughness: 0.3, metalness: 0.9 })));
        const rope = Mesh.merge(L.solids.rope);
        if (rope.index.length) parts.push(rigid(Object.assign(rope, { name: 'Rope', kind: 'prop', color: r.pole.type === 'crossbar' ? r.pole.finialColor : '#d8d2c2', roughness: 0.9, metalness: 0 })));

        // The pole and what is on it keep their form in their colors; the cloth moves, so it does not.
        for (const p of parts.slice(1)) Mesh.shade(p);
        const bones = [{ name: 'Prop', head: [0, 0, 0], parent: -1 }];
        const restBones = new Float32Array(grid.count * 3);
        let b = 0;
        for (const j of grid.bj) for (const i of grid.bi) {
            const k = (j * nx + i) * 3;
            restBones.set(L.rest.subarray(k, k + 3), b * 3);
            bones.push({ name: `Cloth_${i}_${j}`, head: [L.rest[k], L.rest[k + 1], L.rest[k + 2]], parent: 0 });
            b++;
        }
        // Holes let the air through.
        const worn = wearAt(r.seed, tattered ? r.cloth.wear : 0);
        const holes = new Uint8Array((nx - 1) * (ny - 1));
        if (tattered) for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
            const u = (i + 0.5) / (nx - 1), v = (j + 0.5) / (ny - 1);
            holes[j * (nx - 1) + i] = worn.hole(u, v) || u > 1 - worn.fly(v) ? 1 : 0;
        }
        const setup = {
            nx, ny, rest: L.rest, pinned: L.pinned, area: r.cloth.width * L.height, fabric, holes, colliders: L.colliders,
            wind: { speed: windSpeed(r.wind.strength), gust: r.wind.gust, angle: r.wind.direction * Math.PI / 180, loop: LOOP, seed: r.seed, length: r.cloth.width }
        };
        const clips = [];
        if (o.loop) {
            const tracks = [];
            for (let k = 0; k < grid.count; k++) {
                tracks.push({ bone: k + 1, path: 'translation', values: o.loop.T[k] });
                tracks.push({ bone: k + 1, path: 'rotation', values: o.loop.Q[k] });
            }
            clips.push({ name: 'Wave', times: o.loop.times, tracks });
        }
        const triangles = parts.reduce((s, p) => s + p.index.length / 3, 0);
        return {
            kind: 'flag', recipe: r, parts, bones, clips, loop: o.loop || null, textures: { 'cloth.png': c.picture, 'cloth_normal.png': c.normal },
            cloth: { setup, grid, restBones, part: 0 }, height: Math.max(r.pole.type === 'bracket' ? 2.4 + r.pole.height : r.pole.height, 0.5),
            triangles, imageName: r.design.image, imageMissing: r.design.layout === 'image' && !!r.design.image && !image
        };
    }

    function faceNormal(P, nx, ny) {
        const a = 0, b = (nx - 1) * 3, c = (ny - 1) * nx * 3;
        const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[a] - P[c], P[a + 1] - P[c + 1], P[a + 2] - P[c + 2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
        return [n[0] / l, n[1] / l, n[2] / l];
    }

    function hasAlpha(img) { for (let i = 3; i < img.data.length; i += 16) if (img.data[i] < 128) return true; return false; }

    /** A random flag: a design, its colors, maybe an emblem; the pole and cloth stay. */
    function random(seed, recipe) {
        const rand = Paint.random(seed);
        const r = normalize(recipe);
        const palettes = [
            ['#8c1c1c', '#d9b23c', '#f2efe6', '#1f3c78'], ['#1f3c78', '#f2efe6', '#b3202a', '#d9b23c'], ['#1d5c34', '#f2efe6', '#c8a032', '#1b1b1f'],
            ['#2b2b30', '#c9a03c', '#8c1c1c', '#f2efe6'], ['#5a2a6e', '#e8c45a', '#f2efe6', '#1f1f24'], ['#0f5c78', '#f0e6c8', '#c84a2a', '#1b1b1f'],
            ['#c8501e', '#f2efe6', '#1f3c78', '#2b2b30'], ['#f2efe6', '#a51f2b', '#1f3c78', '#d9b23c'], ['#3a5a2a', '#d8c27a', '#7a2a1a', '#f2efe6']
        ];
        const colors = palettes[Math.floor(rand() * palettes.length)].slice();
        if (rand() < 0.5) colors.reverse();
        const layouts = LAYOUTS.filter(l => l.id !== 'image');
        const lay = layouts[Math.floor(rand() * layouts.length)].id;
        const shapes = EMBLEMS.filter(e => e[0] !== 'none');
        const emblem = rand() < (lay === 'emblem' ? 1 : 0.45)
            ? { shape: shapes[Math.floor(rand() * shapes.length)][0], color: colors[colors.length - 1 - Math.floor(rand() * 2)], size: 0.4 + rand() * 0.35, place: lay === 'canton' || lay === 'nordic' ? 'canton' : lay === 'triangle' ? 'hoist' : 'center' }
            : { shape: 'none', color: colors[1], size: 0.5, place: 'center' };
        r.design = { layout: lay, colors, emblem, image: r.design.image };
        r.seed = seed >>> 0 || 1;
        return normalize(r);
    }

    const api = { POLES, POLE_BY_ID, FINIALS, FABRICS, ASPECTS, LAYOUTS, LAYOUT_BY_ID, EMBLEMS, PLACES, DEFAULT, LOOP, normalize, withPole, windSpeed, prepare, designAt, layout, build, random, ratioOf };
    root.RRFlagProp = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

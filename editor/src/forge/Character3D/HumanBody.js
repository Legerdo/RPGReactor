/**
 * RRHumanBody - the Character Builder's body: a recipe of slider values in,
 * shaped vertex positions, joint positions and fitted eyes out.
 *
 * The data is the human pack (data/human.json + human.bin, built from
 * MakeHuman's CC0 assets by build-scripts/build-human-pack.cjs). One base
 * mesh carries every body: each slider blends shape targets on it, so the
 * vertex layout, UVs and skin weights never change and anything fitted to
 * the base (the eyes now, clothes later) follows every slider.
 *
 * No DOM and no three.js here: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    const AGES = ['child', 'young', 'old'];
    const LEVELS = ['min', 'average', 'max'];
    const ANCESTRY = ['african', 'asian', 'caucasian'];

    const Targets = root.RRHumanTargets || (typeof require === 'function' ? require('./HumanTargets.js') : null);
    /** Shape sliders from the shared catalog: paired ones -1..1, one-sided 0..1, either carried on to its `extreme`. */
    const SLIDERS = Targets.SLIDERS;
    const SHAPES = SLIDERS.map(s => s.key);
    const SLIDER_BY_KEY = new Map(SLIDERS.map(s => [s.key, s]));

    /**
     * The build sliders' ranges: natural, and how far Extreme carries them.
     * Past the natural range a target blend is extrapolated.
     */
    const MACRO_RANGES = {
        weight: { natural: [0, 1], extreme: [-0.4, 3] },
        muscle: { natural: [0, 1], extreme: [-0.3, 2.5] },
        height: { natural: [0, 1], extreme: [-0.6, 1.8] },
        cup: { natural: [0, 1], extreme: [-0.2, 5] },
        firmness: { natural: [0, 1], extreme: [-0.5, 1.5] }
    };

    const DEFAULT_RECIPE = Object.freeze({
        species: 'human',
        gender: 0.5,      // 0 female, 1 male
        age: 25,          // years, 11..90
        muscle: 0.5,
        weight: 0.5,
        height: 0.5,
        cup: 0.5,
        firmness: 0.5,
        ancestry: Object.freeze({ african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 }),
        shapes: Object.freeze({}),
        headSize: 1,
        morph: Object.freeze({ snout: 0, muzzle: 0, flat: 0, earsAway: 0 }),
        skin: '#c69c7f'
    });

    /** Face morphs beyond the targets: a snout or muzzle (and how narrow), a face flattened for a beak, human ears tucked away. */
    const MORPHS = { snout: [0, 1.5], muzzle: [0, 1], flat: [0, 1], earsAway: [0, 1] };

    const MIN_AGE = 11, MAX_AGE = 90;

    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : lo));

    const macro = (r, key) => {
        const [lo, hi] = MACRO_RANGES[key].extreme;
        return clamp(r[key] ?? DEFAULT_RECIPE[key], lo, hi);
    };

    /** A full recipe from a partial one: every field present and in range. */
    function normalizeRecipe(input) {
        const r = input || {};
        const out = {
            species: 'human',
            gender: clamp(r.gender ?? DEFAULT_RECIPE.gender, 0, 1),
            age: clamp(r.age ?? DEFAULT_RECIPE.age, MIN_AGE, MAX_AGE),
            muscle: macro(r, 'muscle'),
            weight: macro(r, 'weight'),
            height: macro(r, 'height'),
            cup: macro(r, 'cup'),
            firmness: macro(r, 'firmness'),
            ancestry: {},
            shapes: {},
            headSize: clamp(r.headSize ?? 1, 0.5, 2.2),
            morph: {},
            skin: /^#[0-9a-f]{6}$/i.test(r.skin || '') ? r.skin.toLowerCase() : DEFAULT_RECIPE.skin
        };
        if (Number.isFinite(r.seed)) out.seed = r.seed >>> 0;
        for (const k in MORPHS) out.morph[k] = clamp(r.morph?.[k] ?? 0, MORPHS[k][0], MORPHS[k][1]);
        let total = 0;
        for (const a of ANCESTRY) { out.ancestry[a] = clamp(r.ancestry?.[a] ?? DEFAULT_RECIPE.ancestry[a], 0, 1); total += out.ancestry[a]; }
        for (const a of ANCESTRY) out.ancestry[a] = total > 0 ? out.ancestry[a] / total : 1 / 3;
        for (const s of SLIDERS) {
            // Recipes from the first builder kept Pointed ears beside the shapes.
            const v = r.shapes?.[s.key] ?? (s.key === 'earsPointed' ? r.earsPointed : 0) ?? 0;
            out.shapes[s.key] = clamp(v, s.paired ? -s.extreme : 0, s.extreme);
        }
        return out;
    }

    /** Three-point blend: 0 → min, 0.5 → average, 1 → max; outside 0..1 the line carries on past the end. */
    function levelWeights(x) {
        if (x < 0.5) { const min = (0.5 - x) * 2; return { min, average: 1 - min, max: 0 }; }
        const max = (x - 0.5) * 2;
        return { min: 0, average: 1 - max, max };
    }

    /**
     * How a strong build carries its muscle: past average, muscle adds the
     * limb, chest and back bulk targets on top of the build blend, so a
     * strong body grows instead of only leaning out.
     */
    const MUSCLE_BULK = { upperArmMuscle: 0.7, shoulderMuscle: 0.7, forearmMuscle: 0.6, thighMuscle: 0.55, calfMuscle: 0.5, pecs: 0.6, lats: 0.55, vshape: 0.3, neck: 0.45 };
    /** And a heavy one its fat: past the heaviest natural build, the belly, chin and limbs keep filling. */
    const FAT_SPREAD = { belly: 0.7, doubleChin: 0.6, upperArmFat: 0.5, forearmFat: 0.35, thighFat: 0.5, calfFat: 0.35, butt: 0.4, headFat: 0.35, waist: 0.5, neck: 0.3 };

    /** Age in years onto child (11), young (25) and old (90). */
    function ageWeights(years) {
        if (years <= 25) { const child = (25 - years) / 14; return { child, young: 1 - child, old: 0 }; }
        const old = (years - 25) / 65;
        return { child: 0, young: 1 - old, old };
    }

    /** Every shape target's weight for a recipe, by target name. Zero weights are left out. */
    /** The recipe held to the natural ranges: what the targets were made for. */
    function naturalRecipe(recipe) {
        const r = normalizeRecipe(recipe);
        for (const key in MACRO_RANGES) r[key] = clamp(r[key], ...MACRO_RANGES[key].natural);
        for (const s of SLIDERS) r.shapes[s.key] = clamp(r.shapes[s.key], s.paired ? -1 : 0, 1);
        return r;
    }

    /**
     * A two-way grid of targets (min/average/max on each axis), blended
     * bilinearly inside 0..1. Past an end, each axis carries on along its own
     * edge's slope: two extremes add, they never multiply.
     */
    function grid(x, y, name, scale, add) {
        const xc = clamp(x, 0, 1), yc = clamp(y, 0, 1);
        const X = levelWeights(xc), Y = levelWeights(yc);
        for (const i of LEVELS) for (const j of LEVELS) add(name(i, j), scale * X[i] * Y[j]);
        const past = (v, vc) => (v > vc ? ['max', (v - vc) * 2] : v < vc ? ['min', (vc - v) * 2] : null);
        const ox = past(x, xc), oy = past(y, yc);
        if (ox) for (const j of LEVELS) { add(name(ox[0], j), scale * ox[1] * Y[j]); add(name('average', j), -scale * ox[1] * Y[j]); }
        if (oy) for (const i of LEVELS) { add(name(i, oy[0]), scale * oy[1] * X[i]); add(name(i, 'average'), -scale * oy[1] * X[i]); }
    }

    function targetWeights(recipe, natural) {
        const r = natural ? naturalRecipe(recipe) : normalizeRecipe(recipe);
        const out = {};
        const add = (name, w) => { if (Math.abs(w) > 1e-5) out[name] = (out[name] || 0) + w; };
        const genders = { female: 1 - r.gender, male: r.gender };
        const ages = ageWeights(r.age);
        // MakeHuman's height targets run from 1.2 m to 2.4 m; the slider spans about 1.45 to 2.05 m for an average man.
        const height = r.height < 0.5 ? { min: (0.5 - r.height) * 1.4, max: 0 } : { min: 0, max: (r.height - 0.5) * 0.9 };
        for (const g in genders) for (const a of AGES) {
            const ga = genders[g] * ages[a];
            if (ga <= 0) continue;
            grid(r.muscle, r.weight, (m, w) => `macro/${g}-${a}-${m}muscle-${w}weight`, ga, add);
            for (const race of ANCESTRY) add(`race/${race}-${g}-${a}`, ga * r.ancestry[race]);
            add(`height/${g}-${a}-min`, ga * height.min);
            add(`height/${g}-${a}-max`, ga * height.max);
            if (g === 'female') grid(r.cup, r.firmness, (c, f) => `cup/female-${a}-${c}cup-${f}firmness`, ga, add);
        }
        const shapes = Object.assign({}, r.shapes);
        const bulk = Math.max(0, (r.muscle - 0.5) * 2);
        for (const k in MUSCLE_BULK) shapes[k] += bulk * MUSCLE_BULK[k];
        const fat = Math.max(0, r.weight - 1) * 2;
        for (const k in FAT_SPREAD) shapes[k] += fat * FAT_SPREAD[k];
        for (const s of SLIDERS) {
            const v = natural ? clamp(shapes[s.key], s.paired ? -1 : 0, 1) : shapes[s.key];
            if (!s.paired) add(`shape/${s.key}`, v);
            else if (v < 0) add(`shape/${s.key}-decr`, -v);
            else add(`shape/${s.key}-incr`, v);
        }
        return out;
    }

    /** The pack's typed views over its binary. */
    function openPack(json, bytes) {
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const view = (Type, [offset, length]) => new Type(buffer, offset, length);
        const L = json.layout;
        return {
            json,
            vertexCount: json.vertexCount,
            positions: view(Float32Array, L.positions),
            body: { source: view(Uint16Array, L.bodySource), uv: view(Float32Array, L.bodyUV), index: view(Uint32Array, L.bodyIndex) },
            skinJoints: view(Uint8Array, L.skinJoints),
            skinWeights: view(Float32Array, L.skinWeights),
            bones: json.bones,
            helpers: Object.fromEntries(Object.entries(L.helpers || {}).map(([name, h]) => [name, { source: view(Uint16Array, h.source), uv: view(Float32Array, h.uv), index: view(Uint32Array, h.index) }])),
            targets: new Map(json.targets.map(t => [t.name, { scale: t.scale, index: view(Uint16Array, t.index), delta: view(Int16Array, t.delta) }])),
            eyes: {
                refs: view(Uint16Array, L.eyes.refs), weights: view(Float32Array, L.eyes.weights), offsets: view(Float32Array, L.eyes.offsets),
                source: view(Uint16Array, L.eyes.source), uv: view(Float32Array, L.eyes.uv), index: view(Uint32Array, L.eyes.index),
                scale: L.eyes.scale, texture: L.eyes.texture
            }
        };
    }

    const DATA_PATH = 'src/forge/Character3D/data';

    /**
     * The pack's folder on disk. A module's __dirname is this file's folder;
     * in an NW.js page it is the page's folder, the editor root.
     */
    function dataFolder() {
        const fs = require('fs'), path = require('path');
        const here = typeof __dirname === 'string' ? __dirname : process.cwd();
        const candidates = [path.join(here, 'data'), path.join(here, DATA_PATH), path.join(path.resolve(here, '..'), DATA_PATH), path.join(process.cwd(), DATA_PATH)];
        return candidates.find(dir => fs.existsSync(path.join(dir, 'human.json'))) || candidates[1];
    }

    /** Reads the pack (desktop: the file system; browser: fetch of the editor's served files). */
    async function loadPack(dir) {
        const base = dir || DATA_PATH;
        if (typeof require === 'function') {
            try {
                const fs = require('fs'), path = require('path');
                const folder = dir && path.isAbsolute(dir) ? dir : dataFolder();
                const json = JSON.parse(fs.readFileSync(path.join(folder, 'human.json'), 'utf8'));
                return openPack(json, fs.readFileSync(path.join(folder, 'human.bin')));
            } catch (error) {
                if (typeof fetch !== 'function') throw error;
            }
        }
        const [json, bin] = await Promise.all([
            fetch(base + '/human.json').then(r => r.json()),
            fetch(base + '/human.bin').then(r => r.arrayBuffer())
        ]);
        return openPack(json, new Uint8Array(bin));
    }

    /** Shaped positions (meters, MakeHuman's frame: y up, facing +z) for a recipe. */
    function applyTargets(pack, weights, positions) {
        for (const name in weights) {
            const t = pack.targets.get(name);
            if (!t) continue;
            const k = weights[name] * t.scale, idx = t.index, d = t.delta;
            for (let i = 0; i < idx.length; i++) {
                const v = idx[i] * 3;
                positions[v] += d[i * 3] * k;
                positions[v + 1] += d[i * 3 + 1] * k;
                positions[v + 2] += d[i * 3 + 2] * k;
            }
        }
    }

    /** Every vertex's neighbors over the body and helper faces, as a compact list (offsets + flat). */
    function neighbors(pack) {
        if (pack._neighbors) return pack._neighbors;
        const n = pack.vertexCount, sets = Array.from({ length: n }, () => new Set());
        const addFaces = (source, index) => {
            for (let t = 0; t < index.length; t += 3) {
                const a = source[index[t]], b = source[index[t + 1]], c = source[index[t + 2]];
                sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
            }
        };
        addFaces(pack.body.source, pack.body.index);
        for (const h of Object.values(pack.helpers || {})) addFaces(h.source, h.index);
        const offsets = new Uint32Array(n + 1);
        for (let v = 0; v < n; v++) offsets[v + 1] = offsets[v] + sets[v].size;
        const flat = new Uint32Array(offsets[n]);
        for (let v = 0; v < n; v++) flat.set([...sets[v]], offsets[v]);
        return (pack._neighbors = { offsets, flat });
    }

    /**
     * Relaxes a displacement field over the mesh: each pass moves every vertex's
     * value halfway to its neighbors' mean. Vertices with no neighbors (joint
     * markers) keep theirs.
     */
    function relax(pack, field, passes) {
        const { offsets, flat } = neighbors(pack);
        const n = pack.vertexCount;
        let a = field, b = new Float32Array(field.length);
        for (let p = 0; p < passes; p++) {
            for (let v = 0; v < n; v++) {
                const s = offsets[v], e = offsets[v + 1];
                if (e === s) { b[v * 3] = a[v * 3]; b[v * 3 + 1] = a[v * 3 + 1]; b[v * 3 + 2] = a[v * 3 + 2]; continue; }
                let x = 0, y = 0, z = 0;
                for (let i = s; i < e; i++) { const u = flat[i] * 3; x += a[u]; y += a[u + 1]; z += a[u + 2]; }
                const k = 1 / (e - s);
                b[v * 3] = 0.5 * a[v * 3] + 0.5 * x * k;
                b[v * 3 + 1] = 0.5 * a[v * 3 + 1] + 0.5 * y * k;
                b[v * 3 + 2] = 0.5 * a[v * 3 + 2] + 0.5 * z * k;
            }
            const t = a; a = b; b = t;
        }
        return a;
    }

    const EXTREME_PASSES = 24;

    /**
     * Shaped positions (meters, MakeHuman's frame: y up, facing +z) for a recipe.
     * Within the natural ranges the targets blend as made. Past them the
     * extra displacement is relaxed over the mesh before it is added, so a
     * target carried three times as far swells smoothly instead of folding.
     */
    function shape(pack, recipe, out) {
        const positions = out && out.length === pack.positions.length ? out : new Float32Array(pack.positions.length);
        positions.set(pack.positions);
        const natural = targetWeights(recipe, true), full = targetWeights(recipe);
        applyTargets(pack, natural, positions);
        const extra = {};
        let any = false;
        for (const name of new Set([...Object.keys(natural), ...Object.keys(full)])) {
            const d = (full[name] || 0) - (natural[name] || 0);
            if (Math.abs(d) > 1e-5) { extra[name] = d; any = true; }
        }
        if (any) {
            const field = new Float32Array(positions.length);
            applyTargets(pack, extra, field);
            const smooth = relax(pack, field, EXTREME_PASSES);
            for (let i = 0; i < positions.length; i++) positions[i] += smooth[i];
        }
        morph(pack, positions, normalizeRecipe(recipe));
        return positions;
    }

    /** Per pack vertex, how much the Head bone carries it; and the ear's own vertices, by how far the ear target moves them. */
    function headFields(pack) {
        if (pack._headFields) return pack._headFields;
        const head = pack.bones.findIndex(b => b.name === 'Head');
        const n = pack.vertexCount, w = new Float32Array(n), ear = new Float32Array(n);
        for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) if (pack.skinJoints[v * 4 + k] === head) w[v] += pack.skinWeights[v * 4 + k];
        const t = pack.targets.get('shape/earSize-incr');
        if (t) {
            let max = 0;
            for (let i = 0; i < t.index.length; i++) max = Math.max(max, Math.hypot(t.delta[i * 3], t.delta[i * 3 + 1], t.delta[i * 3 + 2]));
            for (let i = 0; i < t.index.length; i++) ear[t.index[i]] = Math.min(1, Math.hypot(t.delta[i * 3], t.delta[i * 3 + 1], t.delta[i * 3 + 2]) / max * 2.5);
        }
        const eyeIds = [...new Set(pack.eyes.refs)];
        return (pack._headFields = { head, w, ear, eyeIds });
    }

    const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    /**
     * Head size and the face morphs, worked in the head's own measure (its
     * joint, the eyes, the crown) so they suit any head the sliders made.
     */
    function morph(pack, P, r) {
        const m = r.morph, size = r.headSize;
        if (size === 1 && !m.snout && !m.flat && !m.earsAway && !m.muzzle) return;
        const F = headFields(pack);
        const h = meanOf(P, pack.bones[F.head].head);
        let crown = -Infinity;
        for (let v = 0; v < F.w.length; v++) if (F.w[v] > 0.9 && P[v * 3 + 1] > crown) crown = P[v * 3 + 1];
        const eye = meanOf(P, F.eyeIds);
        const H = crown - h[1];
        if (m.earsAway) {
            // Each ear folds in toward the middle of its own vertices.
            for (const side of [1, -1]) {
                let c = [0, 0, 0], n = 0;
                for (let v = 0; v < F.ear.length; v++) if (F.ear[v] > 0.6 && Math.sign(P[v * 3]) === side) { c[0] += P[v * 3]; c[1] += P[v * 3 + 1]; c[2] += P[v * 3 + 2]; n++; }
                if (!n) continue;
                c = c.map(x => x / n);
                // In toward the skull too: the side of the head under the ear.
                c[0] -= side * 0.012;
                for (let v = 0; v < F.ear.length; v++) {
                    const e = F.ear[v] * m.earsAway;
                    if (!e || Math.sign(P[v * 3]) !== side) continue;
                    for (let k = 0; k < 3; k++) P[v * 3 + k] += (c[k] - P[v * 3 + k]) * e * 0.85;
                }
            }
        }
        if (m.snout || m.flat || m.muzzle) {
            // The face below the eyes and in front of them: the mouth, the nose, the jaw.
            // From under the chin (about 0.62 of the head's height below the eyes) up to just under the eyes.
            const top = eye[1] - H * 0.02, bottom = eye[1] - H * 0.66, back = eye[2] - H * 0.42;
            for (let v = 0; v < F.w.length; v++) {
                const w = F.w[v];
                if (w <= 0) continue;
                const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
                const vert = smooth01(bottom - H * 0.12, bottom + H * 0.12, y) * (1 - smooth01(top - H * 0.16, top + H * 0.04, y));
                // The whole face block from the cheeks forward moves as one, so a snout keeps its width and depth.
                const fwd = smooth01(back, eye[2] - H * 0.1, z);
                const f = vert * fwd * w;
                if (!f) continue;
                const tip = smooth01(eye[2] - H * 0.1, eye[2] + H * 0.2, z);
                P[v * 3 + 2] += m.snout * H * 0.75 * f - m.flat * f * Math.max(0, z - back) * 0.35;
                P[v * 3 + 1] -= m.snout * f * tip * H * 0.06;
                P[v * 3] *= 1 - (m.muzzle * 0.4 * (0.5 + 0.5 * tip) + m.snout * 0.1) * f;
            }
        }
        if (size !== 1) {
            for (let v = 0; v < F.w.length; v++) {
                const w = F.w[v];
                if (!w) continue;
                for (let k = 0; k < 3; k++) P[v * 3 + k] = h[k] + (P[v * 3 + k] - h[k]) * (1 + (size - 1) * w);
            }
        }
    }

    const meanOf = (positions, list) => {
        let x = 0, y = 0, z = 0;
        for (const v of list) { x += positions[v * 3]; y += positions[v * 3 + 1]; z += positions[v * 3 + 2]; }
        const n = list.length || 1;
        return [x / n, y / n, z / n];
    };

    /** Each bone's head (and tail) on the shaped body. */
    function joints(pack, positions) {
        return pack.bones.map(b => ({ name: b.name, parent: b.parent, head: meanOf(positions, b.head), tail: meanOf(positions, b.tail) }));
    }

    /** The lowest point of the body faces: the soles. */
    function floorOf(pack, positions) {
        let min = Infinity;
        const src = pack.body.source;
        for (let i = 0; i < src.length; i++) min = Math.min(min, positions[src[i] * 3 + 1]);
        return min;
    }

    /** A fitted piece's vertices: each rides on three base vertices plus a scaled offset. */
    function fit(piece, positions) {
        const axisScale = axis => {
            const [a, b, dist] = piece.scale[axis];
            const k = 'xyz'.indexOf(axis);
            return Math.abs(positions[a * 3 + k] - positions[b * 3 + k]) / (dist || 1);
        };
        const sx = axisScale('x'), sy = axisScale('y'), sz = axisScale('z');
        const count = piece.refs.length / 3;
        const out = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            for (let k = 0; k < 3; k++) {
                const v = piece.refs[i * 3 + k] * 3, w = piece.weights[i * 3 + k];
                out[i * 3] += positions[v] * w; out[i * 3 + 1] += positions[v + 1] * w; out[i * 3 + 2] += positions[v + 2] * w;
            }
            out[i * 3] += piece.offsets[i * 3] * sx;
            out[i * 3 + 1] += piece.offsets[i * 3 + 1] * sy;
            out[i * 3 + 2] += piece.offsets[i * 3 + 2] * sz;
        }
        return out;
    }

    /** A fitted piece's skin: the influences of the base vertex it leans on most. */
    function fittedSkin(pack, piece) {
        const count = piece.refs.length / 3;
        const joints4 = new Uint8Array(count * 4), weights4 = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            let best = 0;
            for (let k = 1; k < 3; k++) if (piece.weights[i * 3 + k] > piece.weights[i * 3 + best]) best = k;
            const v = piece.refs[i * 3 + best];
            joints4.set(pack.skinJoints.subarray(v * 4, v * 4 + 4), i * 4);
            weights4.set(pack.skinWeights.subarray(v * 4, v * 4 + 4), i * 4);
        }
        return { joints: joints4, weights: weights4 };
    }

    /**
     * Smooth normals per source vertex (so UV seams do not crease), handed to
     * each render vertex. `source` maps render vertices to source vertices.
     */
    function normals(positions, source, index, sourceCount) {
        const acc = new Float32Array(sourceCount * 3);
        const p = i => source[i] * 3;
        for (let t = 0; t < index.length; t += 3) {
            const a = p(index[t]), b = p(index[t + 1]), c = p(index[t + 2]);
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { acc[s] += nx; acc[s + 1] += ny; acc[s + 2] += nz; }
        }
        const out = new Float32Array(source.length * 3);
        for (let i = 0; i < source.length; i++) {
            const s = source[i] * 3;
            const len = Math.hypot(acc[s], acc[s + 1], acc[s + 2]) || 1;
            out[i * 3] = acc[s] / len; out[i * 3 + 1] = acc[s + 1] / len; out[i * 3 + 2] = acc[s + 2] / len;
        }
        return out;
    }

    /** Smooth normals of every pack vertex over the body faces (vertices off the body get none). */
    function vertexNormals(pack, positions) {
        const n = new Float32Array(pack.vertexCount * 3);
        const src = pack.body.source, index = pack.body.index;
        for (let t = 0; t < index.length; t += 3) {
            const a = src[index[t]] * 3, b = src[index[t + 1]] * 3, c = src[index[t + 2]] * 3;
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { n[s] += nx; n[s + 1] += ny; n[s + 2] += nz; }
        }
        for (let i = 0; i < n.length; i += 3) {
            const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
            if (l > 0) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
        }
        return n;
    }

    /** Render-vertex attribute from a per-source one. */
    function gather(values, source, size) {
        const out = new values.constructor(source.length * size);
        for (let i = 0; i < source.length; i++) for (let k = 0; k < size; k++) out[i * size + k] = values[source[i] * size + k];
        return out;
    }

    /**
     * Everything a viewer or exporter needs for one recipe, floor at y = 0:
     * { parts: [{name, positions, normals, uvs, index, joints, weights, texture}], bones: [{name, parent, head}], height }
     */
    function build(pack, recipe) {
        const shaped = shape(pack, recipe);
        const floor = floorOf(pack, shaped);
        for (let i = 1; i < shaped.length; i += 3) shaped[i] -= floor;
        const body = pack.body;
        const parts = [{
            name: 'Body',
            positions: gather(shaped, body.source, 3),
            normals: normals(shaped, body.source, body.index, pack.vertexCount),
            uvs: body.uv,
            index: body.index,
            joints: gather(pack.skinJoints, body.source, 4),
            weights: gather(pack.skinWeights, body.source, 4)
        }];
        const eyes = pack.eyes;
        const eyeVerts = fit(eyes, shaped);
        const eyeSkin = fittedSkin(pack, eyes);
        parts.push({
            name: 'Eyes',
            positions: gather(eyeVerts, eyes.source, 3),
            normals: normals(eyeVerts, eyes.source, eyes.index, eyeVerts.length / 3),
            uvs: eyes.uv,
            index: eyes.index,
            joints: gather(eyeSkin.joints, eyes.source, 4),
            weights: gather(eyeSkin.weights, eyes.source, 4),
            texture: eyes.texture
        });
        const bones = joints(pack, shaped);
        let top = 0;
        for (let i = 1; i < parts[0].positions.length; i += 3) top = Math.max(top, parts[0].positions[i]);
        // `shaped` (every pack vertex, helpers included, floor at 0) is what garments and hair are built on.
        return { parts, bones, height: top, shaped };
    }

    /** A seeded random recipe within per-field ranges ({gender:[0,1], age:[18,60], ...}). */
    function randomRecipe(seed, ranges) {
        let s = (seed >>> 0) || 1;
        const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
        const R = Object.assign({ gender: [0, 1], age: [18, 70], muscle: [0.2, 0.8], weight: [0.2, 0.8], height: [0.25, 0.75], cup: [0.3, 0.7], shapes: [-0.6, 0.6] }, ranges || {});
        const pick = ([lo, hi]) => lo + (hi - lo) * rand();
        const gender = rand() < 0.5 ? pick([0, 0.15]) : pick([0.85, 1]);
        const r = {
            gender: R.gender[0] === 0 && R.gender[1] === 1 ? gender : pick(R.gender),
            age: pick(R.age), muscle: pick(R.muscle), weight: pick(R.weight), height: pick(R.height), cup: pick(R.cup),
            ancestry: { african: rand() ** 2, asian: rand() ** 2, caucasian: rand() ** 2 },
            shapes: {}
        };
        for (const s of SLIDERS) {
            if (!s.basic && rand() < 0.6) continue;
            r.shapes[s.key] = s.paired ? pick(R.shapes) * (s.key === 'belly' ? Math.max(0, r.weight - 0.3) * 1.5 : 1) : Math.max(0, pick(R.shapes)) * 0.5;
        }
        r.shapes.earsPointed = 0;
        const tones = ['#f1d3bd', '#e5b897', '#c69c7f', '#a8795a', '#8a5a3c', '#5e3b26', '#3f2618'];
        const t = rand() * (tones.length - 1), i = Math.floor(t), f = t - i;
        r.skin = mix(tones[i], tones[Math.min(i + 1, tones.length - 1)], f);
        r.seed = seed >>> 0;
        return normalizeRecipe(r);
    }

    function mix(a, b, f) {
        const ca = parseInt(a.slice(1), 16), cb = parseInt(b.slice(1), 16);
        const ch = k => Math.round(((ca >> k) & 255) * (1 - f) + ((cb >> k) & 255) * f);
        return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
    }

    const api = { MORPHS, morph, headFields, vertexNormals, gather, normals, fittedSkin, naturalRecipe, neighbors, relax, SLIDERS, SHAPES, SLIDER_BY_KEY, MACRO_RANGES, ANCESTRY, DEFAULT_RECIPE, MIN_AGE, MAX_AGE, DATA_PATH, dataFolder, normalizeRecipe, targetWeights, openPack, loadPack, shape, joints, fit, build, randomRecipe };
    root.RRHumanBody = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

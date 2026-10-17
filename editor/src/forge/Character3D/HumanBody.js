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
        weight: { natural: [0, 1], extreme: [-1, 6] },
        muscle: { natural: [0, 1], extreme: [-0.3, 2.5] },
        height: { natural: [0, 1], extreme: [-0.6, 1.8] },
        cup: { natural: [0, 1], extreme: [-0.2, 6] },
        firmness: { natural: [0, 1], extreme: [-0.5, 1.5] },
        // 0 MakeHuman's average build, 1 its idealized one (face and body).
        proportions: { natural: [0, 1], extreme: [0, 1.6] }
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
        proportions: 0.7,
        ancestry: Object.freeze({ african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 }),
        shapes: Object.freeze({}),
        headSize: 1,
        // Anatomy: detail on or off, the sex shown ('auto' follows Gender), the genitals' size.
        anatomy: Object.freeze({ detail: false, sex: 'auto', length: 0, girth: 0, testicles: 0, areola: 1, nipple: 1, areolaColor: '', fold: 1, mons: 1, labia: 1 }),
        morph: Object.freeze({ snout: 0, muzzle: 0, flat: 0, earsAway: 0, earHoles: 0.6, toes: 1, eyeWide: 1, eyeTall: 1, eyeSocket: 0 }),
        skin: '#c69c7f'
    });

    /** Face morphs beyond the targets: a snout or muzzle (and how narrow), a face flattened for a beak, human ears tucked away. */
    const MORPHS = { snout: [0, 1.5], muzzle: [0, 1], flat: [0, 1], earsAway: [0, 1], earHoles: [0, 2], toes: [0.4, 3], eyeWide: [0.5, 2.5], eyeTall: [0.5, 2.5], eyeSocket: [0, 1.5] };

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
            proportions: macro(r, 'proportions'),
            ancestry: {},
            shapes: {},
            headSize: clamp(r.headSize ?? 1, 0.5, 2.2),
            anatomy: {
                detail: r.anatomy?.detail === true,
                areola: clamp(r.anatomy?.areola ?? 1, 0.4, 2.5), nipple: clamp(r.anatomy?.nipple ?? 1, 0, 3), fold: clamp(r.anatomy?.fold ?? 1, 0, 2),
                mons: clamp(r.anatomy?.mons ?? 1, 0, 3), labia: clamp(r.anatomy?.labia ?? 1, 0, 3),
                areolaColor: /^#[0-9a-f]{6}$/i.test(r.anatomy?.areolaColor || '') ? r.anatomy.areolaColor.toLowerCase() : '',
                sex: ['auto', 'male', 'female'].includes(r.anatomy?.sex) ? r.anatomy.sex : 'auto',
                length: clamp(r.anatomy?.length ?? 0, -1, 2), girth: clamp(r.anatomy?.girth ?? 0, -1, 2), testicles: clamp(r.anatomy?.testicles ?? 0, -1, 2)
            },
            morph: {},
            skin: /^#[0-9a-f]{6}$/i.test(r.skin || '') ? r.skin.toLowerCase() : DEFAULT_RECIPE.skin
        };
        if (Number.isFinite(r.seed)) out.seed = r.seed >>> 0;
        for (const k in MORPHS) out.morph[k] = clamp(r.morph?.[k] ?? DEFAULT_RECIPE.morph[k], MORPHS[k][0], MORPHS[k][1]);
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
    /**
     * The face the Proportions macro refines toward at 1, per gender (shape
     * slider values, added under the recipe's own): an oval face (squarer on a
     * man), relaxed lids over larger eyes without bags, lips at rest with their corners lifted, a finer nose, defined
     * cheekbones; a woman's jaw and brow softer, a man's jaw and chin firmer.
     */
    const APPEAL = {
        female: { headWidth: -0.25, headFat: -0.3, cheeks: -0.25, cheekBones: 0.45, jaw: -0.4, chin: 0.25, chinWidth: -0.3, mouthHeight: 0.12, eyeSize: 0.35, eyeOpen: -0.15, eyeSlant: 0.2, eyeBags: -0.5, eyeSpacing: -0.1, headOval: 0.55,
            browRidge: -0.7, browHeight: -0.1, underbite: -0.25, noseWidth: -0.45, noseVolume: -0.3, noseLength: -0.2, noseTip: 0.2, nostrils: -0.2, upperLip: 0.35, lowerLip: -0.2, mouthWidth: -0.1, mouthCorners: 0.3, neck: -0.3 },
        male: { headWidth: -0.15, headFat: -0.3, cheeks: -0.3, cheekBones: 0.4, jaw: 0.4, chin: 0.3, chinWidth: 0.15, eyeOpen: -0.2, eyeBags: -0.5, headSquare: 0.35, headOval: 0.2, noseWidth: -0.15, noseHump: -0.1,
            upperLip: 0.1, lowerLip: -0.15, mouthCorners: 0.15, browHeight: -0.15, browRidge: -0.35, temples: -0.3, underbite: -0.2, neck: 0.15 }
    };
    /** With them, by their own targets (appeal/…): a defined upper lip, the mouth drawn back, an upright forehead, a younger skull. */
    const APPEAL_MOUTH = { female: { cupidsBow: 0.6, mouthBack: 0.35, foreheadForward: 0.5, younger: 0.35 }, male: { cupidsBow: 0.3, mouthBack: 0.3, foreheadForward: 0.45, younger: 0.25 } };

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
            // Past a little beyond natural, weight is volume (inflate), not more of the target, which folds.
            grid(r.muscle, clamp(r.weight, -1, 1.4), (m, w) => `macro/${g}-${a}-${m}muscle-${w}weight`, ga, add);
            for (const race of ANCESTRY) add(`race/${race}-${g}-${a}`, ga * r.ancestry[race]);
            add(`proportion/${g}-${a}-ideal`, ga * r.proportions);
            add(`height/${g}-${a}-min`, ga * height.min);
            add(`height/${g}-${a}-max`, ga * height.max);
            if (g === 'female') grid(clamp(r.cup, -0.2, 1.3), r.firmness, (c, f) => `cup/female-${a}-${c}cup-${f}firmness`, ga, add);
        }
        for (const k of ['length', 'girth', 'testicles']) {
            const v = r.anatomy[k];
            if (v) add(`genital/${k}-${v < 0 ? 'decr' : 'incr'}`, Math.abs(v));
        }
        const shapes = Object.assign({}, r.shapes);
        const appeal = Math.min(1, r.proportions);
        for (const [g, w] of [['female', 1 - r.gender], ['male', r.gender]]) for (const k in APPEAL[g]) shapes[k] = (shapes[k] || 0) + appeal * w * APPEAL[g][k];
        for (const [g, w] of [['female', 1 - r.gender], ['male', r.gender]]) for (const k in APPEAL_MOUTH[g]) add(`appeal/${k}`, appeal * w * APPEAL_MOUTH[g][k]);
        const bulk = Math.max(0, (r.muscle - 0.5) * 2);
        for (const k in MUSCLE_BULK) shapes[k] += bulk * MUSCLE_BULK[k];
        const fat = Math.min(0.8, Math.max(0, r.weight - 1) * 2);
        for (const k in FAT_SPREAD) shapes[k] += fat * FAT_SPREAD[k];
        for (const s of SLIDERS) {
            // Eye size past natural is a scale of the eye about its eyeball (morph), not more of the target.
            const v = natural || s.key === 'eyeSize' || VOLUME[s.key] ? clamp(shapes[s.key], s.paired ? -1 : 0, VOLUME[s.key] ? 1.3 : 1) : shapes[s.key];
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
    const FACE_SECTIONS = new Set(['Head shape', 'Forehead and brows', 'Eyes', 'Nose', 'Mouth and jaw', 'Ears']);
    const FACE_KEYS = new Set(SLIDERS.filter(s => FACE_SECTIONS.has(s.section)).map(s => s.key));
    const LOCAL_TARGET = /^shape\//;

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
            // A face slider's target is a small local shape that does not fold: carried past natural as it is.
            // The body's are relaxed, or smoothing would erase a nose or a lip altogether.
            const local = {}, broad = {};
            for (const name in extra) (LOCAL_TARGET.test(name) && FACE_KEYS.has(name.slice(6).replace(/-(incr|decr)$/, '')) ? local : broad)[name] = extra[name];
            const field = new Float32Array(positions.length);
            applyTargets(pack, broad, field);
            const smooth = relax(pack, field, EXTREME_PASSES);
            for (let i = 0; i < positions.length; i++) positions[i] += smooth[i];
            // Face targets past natural: a light relax, enough to iron out creases, not the feature.
            const near = new Float32Array(positions.length);
            applyTargets(pack, local, near);
            const eased = relax(pack, near, 4);
            for (let i = 0; i < positions.length; i++) positions[i] += eased[i];
        }
        const r = normalizeRecipe(recipe);
        volume(pack, positions, r);
        morph(pack, positions, r);
        return positions;
    }

    /**
     * Sliders that are volume: past their natural range they swell. Each has
     * the target its swelling takes its place from (where on the body, and
     * how much where), how far a step past natural reaches (meters), and how
     * much it sags.
     */
    const VOLUME = {
        belly: { targets: ['shape/belly-incr'], reach: 0.075, sag: 0.35 },
        butt: { targets: ['shape/butt-incr'], reach: 0.06, sag: 0.15 },
        hips: { targets: ['shape/hips-incr'], reach: 0.04, sag: 0 },
        thighFat: { targets: ['shape/thighFat-incr'], reach: 0.04, sag: 0.05 },
        upperArmFat: { targets: ['shape/upperArmFat-incr'], reach: 0.03, sag: 0.1 },
        calfFat: { targets: ['shape/calfFat-incr'], reach: 0.025, sag: 0 },
        doubleChin: { targets: ['shape/doubleChin-incr'], reach: 0.025, sag: 0.3 }
    };

    /** A smooth 0..1 mask from how far some targets move each vertex, relaxed so its edge fades. */
    function maskOf(pack, names, passes = 8) {
        pack._masks = pack._masks || new Map();
        const key = names.join('|');
        if (pack._masks.has(key)) return pack._masks.get(key);
        const field = new Float32Array(pack.vertexCount * 3);
        for (const name of names) {
            const t = pack.targets.get(name);
            if (!t) continue;
            for (let i = 0; i < t.index.length; i++) {
                const m = Math.hypot(t.delta[i * 3], t.delta[i * 3 + 1], t.delta[i * 3 + 2]) * t.scale;
                field[t.index[i] * 3] = Math.max(field[t.index[i] * 3], m);
            }
        }
        const smooth = relax(pack, field, passes);
        let max = 0;
        for (let v = 0; v < pack.vertexCount; v++) max = Math.max(max, smooth[v * 3]);
        const mask = new Float32Array(pack.vertexCount);
        for (let v = 0; v < pack.vertexCount; v++) mask[v] = max > 0 ? Math.min(1, smooth[v * 3] / max * 1.25) : 0;
        pack._masks.set(key, mask);
        return mask;
    }

    /**
     * Each breast's swelling, centered on its nipple (so the apex, the areola
     * painted round the nipple and any sag move together): a smooth dome of
     * the chest's front around it, none on the other breast or behind.
     */
    function breastMask(pack) {
        if (pack._breastMask) return pack._breastMask;
        const B = pack.positions, F = anatomyFields(pack), mask = new Float32Array(pack.vertexCount);
        const R = 0.12;
        for (const nip of F.nipples) {
            const c = [B[nip.v * 3], B[nip.v * 3 + 1], B[nip.v * 3 + 2]], side = Math.sign(c[0]);
            for (const v of pack.body.source) {
                if (Math.sign(B[v * 3]) !== side && Math.abs(B[v * 3]) > 0.01) continue;
                if (B[v * 3 + 2] < c[2] - 0.12) continue;
                // A little taller than wide; more below the nipple than above (the breast's own shape).
                const dx = B[v * 3] - c[0], dy = (B[v * 3 + 1] - c[1]) * (B[v * 3 + 1] < c[1] ? 0.85 : 1.25), dz = (B[v * 3 + 2] - c[2]) * 0.6;
                const d = Math.hypot(dx, dy, dz) / R;
                if (d < 1) mask[v] = Math.max(mask[v], (1 - d * d) ** 2);
            }
        }
        return (pack._breastMask = mask);
    }

    /** Where fat goes on a heavy body: how far MakeHuman's heaviest build moves each vertex from the average. */
    function fatMask(pack) {
        if (pack._fatMask) return pack._fatMask;
        const names = [];
        for (const g of ['female', 'male']) names.push(`macro/${g}-young-averagemuscle-maxweight`);
        const mask = maskOf(pack, names, 6).slice();
        // The hands, feet and face take little; the trunk, the seat and the tops of the limbs the most.
        const head = pack.bones.findIndex(b => b.name === 'Head');
        const light = pack.bones.map((b, i) => (/Hand|Foot|ToeBase|Head$/.test(b.name) ? i : -1)).filter(i => i >= 0);
        // The eyes stay open on any body: round each eye (lids, sockets, the cheek under it) nothing swells.
        const B = pack.positions, eyeIds = [...new Set(pack.eyes.refs)];
        const eyeC = [1, -1].map(sd => { const own = eyeIds.filter(v => Math.sign(B[v * 3]) === sd); return [0, 1, 2].map(k => own.reduce((a, v) => a + B[v * 3 + k], 0) / own.length); });
        // Nor the nose or the ears, and the lips ride out on it hardly thickened: fat gathers under the chin and in the cheeks.
        const nose = maskOf(pack, ['shape/noseVolume-incr', 'shape/noseWidth-incr'], 3), ears = maskOf(pack, ['shape/earSize-incr'], 2);
        const lips = maskOf(pack, ['shape/upperLip-incr', 'shape/lowerLip-incr'], 2);
        for (let v = 0; v < pack.vertexCount; v++) {
            let lw = 0;
            for (let k = 0; k < 4; k++) if (light.includes(pack.skinJoints[v * 4 + k])) lw += pack.skinWeights[v * 4 + k] * (pack.skinJoints[v * 4 + k] === head ? 0.6 : 0.85);
            let eye = 1;
            for (const c of eyeC) { const d = Math.hypot(B[v * 3] - c[0], B[v * 3 + 1] - c[1], B[v * 3 + 2] - c[2]); eye = Math.min(eye, Math.max(0, Math.min(1, (d - 0.022) / 0.03))); }
            mask[v] = Math.max(0.12, mask[v]) * (1 - lw) * eye * eye * (1 - 0.85 * nose[v]) * (1 - 0.3 * lips[v]) * (1 - 0.9 * ears[v]);
        }
        return (pack._fatMask = mask);
    }

    /** Each vertex off the body (helpers, joints) moves with its nearest body vertex. */
    function followers(pack) {
        if (pack._followers) return pack._followers;
        const B = pack.positions, onBody = new Set(pack.body.source), cell = 0.03;
        const grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
        for (const v of onBody) {
            const k = key(Math.floor(B[v * 3] / cell), Math.floor(B[v * 3 + 1] / cell), Math.floor(B[v * 3 + 2] / cell));
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(v);
        }
        const map = new Int32Array(pack.vertexCount).fill(-1);
        for (let v = 0; v < pack.vertexCount; v++) {
            if (onBody.has(v)) { map[v] = v; continue; }
            const cx = Math.floor(B[v * 3] / cell), cy = Math.floor(B[v * 3 + 1] / cell), cz = Math.floor(B[v * 3 + 2] / cell);
            let best = -1, bd = Infinity;
            for (let r = 1; r <= 4 && best < 0; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
                for (const u of grid.get(key(cx + i, cy + j, cz + k)) || []) {
                    const d = (B[u * 3] - B[v * 3]) ** 2 + (B[u * 3 + 1] - B[v * 3 + 1]) ** 2 + (B[u * 3 + 2] - B[v * 3 + 2]) ** 2;
                    if (d < bd) { bd = d; best = u; }
                }
            }
            map[v] = best;
        }
        return (pack._followers = map);
    }

    /**
     * Swelling and shrinking past the natural range: each volume slider, the
     * bust and the weight push the skin out along its normals by their masks,
     * in a few steps (the normals worked out again each step, so a swelling
     * rounds out like a balloon rather than a cone), relaxed between steps,
     * sagging a little under its own weight.
     */
    function volume(pack, P, r) {
        const n = pack.vertexCount;
        const amount = new Float32Array(n), sag = new Float32Array(n);
        let any = false;
        const addMask = (mask, meters, droop) => {
            if (!meters) return;
            any = true;
            for (let v = 0; v < n; v++) if (mask[v] > 0) { amount[v] += mask[v] * meters; sag[v] += mask[v] * Math.abs(meters) * droop; }
        };
        for (const key in VOLUME) {
            const past = (r.shapes[key] || 0) - 1.3;
            if (past > 0) addMask(maskOf(pack, VOLUME[key].targets), past * VOLUME[key].reach, VOLUME[key].sag);
        }
        if (r.cup > 1.3 && r.gender < 0.9) {
            const firm = clamp(r.firmness, 0, 1);
            addMask(breastMask(pack), (r.cup - 1.3) * 0.045 * (1 - r.gender), 0.45 - 0.3 * firm);
        }
        if (r.weight > 1.4) addMask(fatMask(pack), (r.weight - 1.4) * 0.07, 0.2);
        // Thin past natural: the soft parts drawn in toward the bone, never through it.
        if (r.weight < 0) addMask(fatMask(pack), Math.max(-0.03, r.weight * 0.03), 0);
        if (!any) return;
        const follow = followers(pack);
        const total = new Float32Array(n * 3);
        const steps = 4;
        for (let s = 0; s < steps; s++) {
            const N = vertexNormals(pack, P);
            const field = new Float32Array(n * 3);
            for (let v = 0; v < n; v++) {
                const b = follow[v];
                if (b < 0 || !amount[b]) continue;
                const a = amount[b] / steps, d = sag[b] / steps;
                field[v * 3] = N[b * 3] * a; field[v * 3 + 1] = N[b * 3 + 1] * a - d; field[v * 3 + 2] = N[b * 3 + 2] * a;
            }
            const eased = relax(pack, field, 3);
            for (let i = 0; i < P.length; i++) { P[i] += eased[i]; total[i] += eased[i]; }
        }
        // The floor stays the floor: nothing swells below the soles.
        let low = Infinity;
        for (const v of pack.body.source) low = Math.min(low, P[v * 3 + 1]);
        void low;
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

    /**
     * The eyes: MakeHuman's eye-size target grows the sockets and lids but
     * not the eyeballs, so the eyeballs are scaled to match it (by how much
     * the target widens the lids, measured once); past natural, socket, lids
     * and eyeball scale together about the eyeball, up to two and a half
     * times at the far end.
     */
    function eyes(pack, P, value, wide = 1, tall = 1) {
        if (!pack._eyeFields) {
            const t = pack.targets.get('shape/eyeSize-incr'), B = pack.positions;
            const eyeIds = [...new Set(pack.eyes.refs)];
            const side = v => (B[v * 3] > 0 ? 1 : -1);
            const center = sd => { const own = eyeIds.filter(v => side(v) === sd); return [0, 1, 2].map(k => own.reduce((a, v) => a + B[v * 3 + k], 0) / own.length); };
            const C = { 1: center(1), '-1': center(-1) };
            let grow = 0, n = 0;
            for (let i = 0; i < t.index.length; i++) {
                const v = t.index[i], d = [t.delta[i * 3] * t.scale, t.delta[i * 3 + 1] * t.scale];
                // How far the lids move outward from their eye, against how far they stand from it.
                if (v >= 14742 && v <= 14991) {
                    const c = C[side(v)], o = [B[v * 3] - c[0], B[v * 3 + 1] - c[1]], r = Math.hypot(o[0], o[1]) || 1;
                    grow += (o[0] * d[0] + o[1] * d[1]) / (r * r); n++;
                }
            }
            // The eyeball's radius, across the face.
            let radius = 0;
            for (const v of eyeIds) radius = Math.max(radius, Math.abs(B[v * 3] - C[side(v)][0]));
            // The face in front of the eyes, the only skin a socket may move.
            const head = pack.bones.findIndex(b => b.name === 'Head');
            const face = [];
            for (let v = 0; v < pack.vertexCount; v++) {
                let hw = 0;
                for (let k = 0; k < 4; k++) if (pack.skinJoints[v * 4 + k] === head) hw += pack.skinWeights[v * 4 + k];
                if (hw > 0.5 && B[v * 3 + 2] > C[side(v)][2] - radius * 2.5 && !eyeIds.includes(v)) face.push(v);
            }
            const w = { face, radius };
            pack._eyeFields = { eyeIds, side, weights: w, natural: n ? grow / n : 0.25 };
        }
        const F = pack._eyeFields;
        const nat = Math.max(-1, Math.min(1, value || 0));
        const extra = value > 1 ? 1 + (value - 1) * 0.5 : value < -1 ? 1 + (value + 1) * 0.2 : 1;
        // Width and tallness: the eye's own shape, across and up and down.
        const ex = extra * wide, ey = extra * tall;
        if (!nat && ex === 1 && ey === 1) return;
        const R = F.weights.radius;
        const smoothstep = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
        // The skin's moves gathered first, relaxed over the face, then laid on: the socket flows into the cheek.
        const field = new Float32Array(P.length);
        let moved = false;
        for (const sd of [1, -1]) {
            const own = F.eyeIds.filter(v => F.side(v) === sd);
            const c = [0, 1, 2].map(k => own.reduce((a, v) => a + P[v * 3 + k], 0) / own.length);
            // The eyeball: across by the whole scale, in depth by its square root, so it does not jut.
            // Across by the whole scale; in depth hardly at all, so big eyes are wide, not bulging.
            const base = 1 + F.natural * nat, ballX = base * ex, ballY = base * ey, deep = 1 + (base * Math.max(ex, ey) - 1) * 0.2;
            for (const v of own) {
                P[v * 3] = c[0] + (P[v * 3] - c[0]) * ballX;
                P[v * 3 + 1] = c[1] + (P[v * 3 + 1] - c[1]) * ballY;
                P[v * 3 + 2] = c[2] + (P[v * 3 + 2] - c[2]) * deep;
            }
            if (ex === 1 && ey === 1) continue;
            // The socket, in the face's plane: the lid opening widens with the eyeball, the skin
            // round it is pushed out less and less until, far enough out never to fold, not at all.
            // A falloff kept close to the eye, so the eye changes and the head does not, and shorter below
            // it, so the cheek and mouth stay; the relax below irons the compression it leaves.
            const dev = Math.max(0, Math.max(ex, ey) - 1, 1 - Math.min(ex, ey));
            const inner = R * 1.6, outer = inner * (1 + 0.9 * dev) + R * 0.6, outerDown = inner * (1 + 0.45 * dev) + R * 0.3;
            const along = (d, e, o) => (d <= inner ? d * e : d + (e - 1) * inner * (1 - smoothstep((d - inner) / (o - inner))));
            for (const v of F.weights.face) {
                if (F.side(v) !== sd) continue;
                const dx = P[v * 3] - c[0], dy = P[v * 3 + 1] - c[1], d = Math.hypot(dx, dy);
                const reach = dy < 0 ? outerDown : outer;
                if (d >= reach || d < 1e-6) continue;
                const kx = along(d, ex, reach) / d, ky = along(d, ey, reach) / d;
                // Toward the middle of the face the sideways push fades out, so the bridge of the nose
                // is pressed smoothly, never bunched or crossed.
                const mid = smoothstep(Math.abs(P[v * 3]) / Math.max(1e-4, Math.abs(c[0])));
                const push = dx * (kx - 1);
                field[v * 3] = push < 0 === sd > 0 ? push * mid * mid : push;
                field[v * 3 + 1] = dy * (ky - 1);
                // The lid rim, right at the eyeball, comes forward with its front.
                field[v * 3 + 2] = (deep - 1) * R * (1 - smoothstep((d - inner * 0.85) / (inner * 0.35)));
                moved = true;
            }
        }
        if (!moved) return;
        const eased = relax(pack, field, 10);
        // Laid on wherever the relaxed move reaches (past the face's own vertices too, so no edge shows);
        // the lid rim keeps more of its own move, so the eyeball stays covered.
        const own = new Set(F.eyeIds);
        for (let v = 0; v < pack.vertexCount; v++) {
            if (own.has(v)) continue;
            const keep = Math.abs(field[v * 3 + 2]) > 1e-5 ? 0.6 : 0;
            for (let k = 0; k < 3; k++) P[v * 3 + k] += eased[v * 3 + k] * (1 - keep) + field[v * 3 + k] * keep;
        }
    }

    /**
     * A grey's almond eye, one shape for its socket and the lens in it: the
     * eye's frame (forward a little out to the side, across tilted up toward
     * the outer corner), the outline's half height across it (fuller toward
     * the nose, drawn to a point at the outer corner), and the lens's height
     * off the frame at each ring of the outline (a dome, its edge set back).
     */
    const ALMOND = { width: 1.65, height: 0.64, tilt: 0.38, dome: 0.2, back: 0.06 };
    const almondHalf = out => (Math.abs(out) >= 1 ? 0 : Math.pow(1 - out * out, 0.42) * (1 - 0.22 * out));
    function almondFrame(pack, P, side, size = 1) {
        const ids = [...new Set(pack.eyes.refs)].filter(v => Math.sign(pack.positions[v * 3]) === side);
        const c0 = [0, 1, 2].map(k => ids.reduce((t, v) => t + P[v * 3 + k], 0) / ids.length);
        let R = 0;
        for (const v of ids) R = Math.max(R, Math.abs(P[v * 3] - c0[0]));
        const head = pack.bones.find(b => b.name === 'Head'), h = meanOf(P, head.head);
        const out = [c0[0] - h[0], 0, c0[2] - h[2]], ol = Math.hypot(out[0], out[2]) || 1;
        let F = [0.35 * out[0] / ol, 0, 0.65 + 0.35 * out[2] / ol];
        const fl = Math.hypot(...F); F = F.map(x => x / fl);
        const U0 = [F[2], 0, -F[0]], V0 = [0, 1, 0];
        const t = ALMOND.tilt * side, ct = Math.cos(t), st = Math.sin(t);
        const U = [0, 1, 2].map(k => U0[k] * ct + V0[k] * st), V = [0, 1, 2].map(k => -U0[k] * st + V0[k] * ct);
        const a = R * ALMOND.width * size, b = a * ALMOND.height;
        const c = [0, 1, 2].map(k => c0[k] + F[k] * R * 0.9 + U0[k] * side * a * 0.04 + V0[k] * a * 0.06);
        return { c, U, V, F, a, b, side, R, lens: rr => a * (ALMOND.dome * Math.sqrt(Math.max(0, 1 - rr * rr)) - ALMOND.back * rr * rr) };
    }
    /** Where a point lies on an almond frame: across (-1..1, + outward), up, out along forward, and its ring (1 the outline). */
    function almondAt(fr, p) {
        const d = [p[0] - fr.c[0], p[1] - fr.c[1], p[2] - fr.c[2]];
        const x = (d[0] * fr.U[0] + d[1] * fr.U[1] + d[2] * fr.U[2]) / fr.a, y = (d[0] * fr.V[0] + d[1] * fr.V[1] + d[2] * fr.V[2]) / fr.b;
        const f = d[0] * fr.F[0] + d[1] * fr.F[1] + d[2] * fr.F[2], half = almondHalf(x * fr.side);
        return { x, y, f, rr: Math.abs(x) >= 1 ? Math.hypot(x, y / 0.05) : Math.hypot(x, y / Math.max(0.05, half)) };
    }

    /**
     * Sockets for a grey's almond eyes: the skin inside each outline pressed
     * back behind where the lens lies, and a soft rim raised round it, so
     * the lens sits in the face with the lids closing over its edge.
     */
    function eyeSockets(pack, P, size) {
        const face = pack._eyeFields && pack._eyeFields.weights.face;
        if (!face) return;
        const field = new Float32Array(P.length), clamp = [];
        for (const side of [1, -1]) {
            const fr = almondFrame(pack, P, side, size), rimH = fr.a * 0.07;
            for (const v of face) {
                if (Math.sign(P[v * 3]) !== side) continue;
                const q = almondAt(fr, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
                let to = null;
                if (q.rr < 1) to = Math.min(q.f, fr.lens(q.rr) - 0.003);
                else if (q.rr < 1.5 && q.f > fr.lens(1) - fr.a * 0.35) to = Math.max(q.f, fr.lens(1) + 0.0015 + rimH * Math.exp(-(((q.rr - 1.08) / 0.15) ** 2)));
                if (to === null || to === q.f) continue;
                for (let k = 0; k < 3; k++) field[v * 3 + k] = fr.F[k] * (to - q.f);
                if (q.rr < 1) clamp.push([v, fr, q.rr]);
            }
        }
        const eased = relax(pack, field, 3);
        for (let v = 0; v < pack.vertexCount; v++) for (let k = 0; k < 3; k++) P[v * 3 + k] += eased[v * 3 + k];
        // Inside the outline the skin stays behind the lens however the easing spread it.
        for (const [v, fr, rr] of clamp) {
            const q = almondAt(fr, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]), to = fr.lens(rr) - 0.003;
            if (q.f > to) for (let k = 0; k < 3; k++) P[v * 3 + k] += fr.F[k] * (to - q.f);
        }
    }

    /** The sex a recipe shows: chosen, or by its Gender slider. */
    function sexOf(r) {
        const a = r.anatomy || {};
        return a.sex === 'male' || a.sex === 'female' ? a.sex : (r.gender >= 0.5 ? 'male' : 'female');
    }

    /**
     * Where anatomy sits, picked once on MakeHuman's base mesh: each nipple
     * (the vertex the bust target moves most, per side) with the vertices
     * around it, and the front of the crotch along the middle.
     */
    function anatomyFields(pack) {
        if (pack._anatomyFields) return pack._anatomyFields;
        const B = pack.positions, ids = [...new Set(pack.body.source)], onBody = new Set(ids);
        // The nipple: the skin vertex MakeHuman's breast-point target moves most (it moves the nipple's tip).
        const point = pack.targets.get('shape/breastPoint-incr') || pack.targets.get('cup/female-young-maxcup-averagefirmness');
        const best = { 1: [-1, 0], '-1': [-1, 0] };
        for (let i = 0; i < point.index.length; i++) {
            const v = point.index[i];
            if (!onBody.has(v)) continue;
            const m = Math.hypot(point.delta[i * 3], point.delta[i * 3 + 1], point.delta[i * 3 + 2]);
            const side = B[v * 3] > 0 ? 1 : -1;
            if (m > best[side][1]) best[side] = [v, m];
        }
        const around = (center, r) => ids.filter(v => Math.hypot(B[v * 3] - B[center * 3], B[v * 3 + 1] - B[center * 3 + 1], B[v * 3 + 2] - B[center * 3 + 2]) < r)
            .map(v => [v, Math.hypot(B[v * 3] - B[center * 3], B[v * 3 + 1] - B[center * 3 + 1], B[v * 3 + 2] - B[center * 3 + 2]) / r]);
        // That vertex sits about a centimeter above the nipple the mesh models on a breast: the nipple is the
        // middle of the small rise there, on a woman's natural bust (the bust's swell centers on it too).
        const P = Float32Array.from(B), nb = neighbors(pack);
        applyTargets(pack, targetWeights(normalizeRecipe({ gender: 0, cup: 0.75 }), true), P);
        const N = vertexNormals(pack, P);
        const rise = v => {
            const s = nb.offsets[v], e = nb.offsets[v + 1];
            let h = 0;
            for (let i = s; i < e; i++) for (let k = 0; k < 3; k++) h += (P[v * 3 + k] - P[nb.flat[i] * 3 + k]) * N[v * 3 + k];
            return e > s ? h / (e - s) : 0;
        };
        const modeled = top => {
            const near = ids.filter(v => Math.hypot(P[v * 3] - P[top * 3], P[v * 3 + 1] - P[top * 3 + 1], P[v * 3 + 2] - P[top * 3 + 2]) < 0.016)
                .map(v => [v, rise(v)]).sort((a, b) => b[1] - a[1]).slice(0, 6);
            const w = near.reduce((sum, x) => sum + Math.max(0, x[1]), 0);
            if (!(w > 0)) return top;
            const c = [0, 1, 2].map(k => near.reduce((sum, x) => sum + P[x[0] * 3 + k] * Math.max(0, x[1]), 0) / w);
            let pick = top, dist = Infinity;
            for (const [v] of near.concat([[top]])) {
                const d = Math.hypot(P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]);
                if (d < dist) { dist = d; pick = v; }
            }
            return pick;
        };
        const nipples = [best[1][0], best[-1][0]].map(modeled).map(v => ({ v, near: around(v, 0.012) }));
        // The crotch: the lowest front point of the trunk between the legs, and the midline above it.
        let low = -1;
        for (const v of ids) {
            if (Math.abs(B[v * 3]) > 0.004 || B[v * 3 + 2] < 0) continue;
            if (B[v * 3 + 1] < -0.35 || B[v * 3 + 1] > 0.3) continue;
            if (low < 0 || B[v * 3 + 1] < B[low * 3 + 1]) low = v;
        }
        const crease = ids.filter(v => Math.abs(B[v * 3]) < 0.012 && B[v * 3 + 2] > B[low * 3 + 2] - 0.03 && B[v * 3 + 1] > B[low * 3 + 1] - 0.005 && B[v * 3 + 1] < B[low * 3 + 1] + 0.045)
            .map(v => [v, Math.abs(B[v * 3]) / 0.012, (B[v * 3 + 1] - B[low * 3 + 1]) / 0.045]);
        // The front of the pelvis below the belly: for the mons above the fold and the labia beside it.
        const vulva = ids.filter(v => Math.abs(B[v * 3]) < 0.06 && B[v * 3 + 2] > B[low * 3 + 2] - 0.03 && B[v * 3 + 1] > B[low * 3 + 1] - 0.02 && B[v * 3 + 1] < B[low * 3 + 1] + 0.12)
            .map(v => [v, Math.abs(B[v * 3]), B[v * 3 + 1] - B[low * 3 + 1]]);
        return (pack._anatomyFields = { nipples, low, crease, vulva });
    }

    /** A vertex's normal on the shaped body, from its own triangles. */
    function normalAt(pack, P, v) {
        if (!pack._faceOf) {
            pack._faceOf = new Map();
            const src = pack.body.source, I = pack.body.index;
            for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
                const a = src[I[t + k]];
                if (!pack._faceOf.has(a)) pack._faceOf.set(a, []);
                pack._faceOf.get(a).push([src[I[t]], src[I[t + 1]], src[I[t + 2]]]);
            }
        }
        const n = [0, 0, 0];
        for (const [a, b, c] of pack._faceOf.get(v) || []) {
            const u = [0, 1, 2].map(k => P[b * 3 + k] - P[a * 3 + k]), w = [0, 1, 2].map(k => P[c * 3 + k] - P[a * 3 + k]);
            n[0] += u[1] * w[2] - u[2] * w[1]; n[1] += u[2] * w[0] - u[0] * w[2]; n[2] += u[0] * w[1] - u[1] * w[0];
        }
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        return [n[0] / l, n[1] / l, n[2] / l];
    }

    /** Nipples raised a little, a woman's crotch given its crease; both in the body's own surface. */
    function anatomyDetail(pack, P, r) {
        const F = anatomyFields(pack), female = sexOf(r) === 'female', B = pack.positions;
        const nb = neighbors(pack);
        const height = (female ? 0.0019 : 0.0009) * r.anatomy.nipple, tipR = (female ? 0.0045 : 0.003) * Math.max(0.6, Math.sqrt(r.anatomy.nipple));
        for (const nip of F.nipples) {
            const c = [B[nip.v * 3], B[nip.v * 3 + 1], B[nip.v * 3 + 2]];
            const zone = (nip.zone = nip.zone || [...new Set(pack.body.source)].map(v => [v, Math.hypot(B[v * 3] - c[0], B[v * 3 + 1] - c[1], B[v * 3 + 2] - c[2])]).filter(x => x[1] < 0.02));
            // The base mesh's own modeled nipple smoothed away, so only one stands: this one.
            for (let pass = 0; pass < 10; pass++) for (const [v, d] of zone) {
                if (d > 0.018) continue;
                const s = nb.offsets[v], e = nb.offsets[v + 1];
                let m0 = 0, m1 = 0, m2 = 0;
                for (let i = s; i < e; i++) { const u = nb.flat[i]; m0 += P[u * 3]; m1 += P[u * 3 + 1]; m2 += P[u * 3 + 2]; }
                const k = 1 / (e - s), w = 0.7 * (1 - d / 0.018);
                P[v * 3] += (m0 * k - P[v * 3]) * w; P[v * 3 + 1] += (m1 * k - P[v * 3 + 1]) * w; P[v * 3 + 2] += (m2 * k - P[v * 3 + 2]) * w;
            }
            const n = normalAt(pack, P, nip.v);
            for (const [v, d] of zone) {
                // A soft rise of the areola, then the nipple: a rounded column, its top a dome.
                // The areola barely rises; the nipple is a soft dome, wider at its base, its edge eased into the areola.
                const areola = (female ? 0.0003 : 0) * r.anatomy.areola * Math.max(0, 1 - (d / 0.018) ** 2);
                const column = height * Math.pow(1 - smooth01(0, tipR * 1.6, d), 1.5);
                const lift = areola + column;
                P[v * 3] += n[0] * lift; P[v * 3 + 1] += n[1] * lift; P[v * 3 + 2] += n[2] * lift;
            }
        }
        if (female) for (const [v, x, up] of F.vulva) {
            // The mons: a soft rise over the pubic bone, above the fold.
            const mons = r.anatomy.mons * 0.008 * Math.exp(-(((up - 0.065) / 0.03) ** 2)) * Math.exp(-((x / 0.04) ** 2));
            // The labia: a full ridge either side of the fold along its length, standing forward and a little down.
            const along = Math.sin(Math.min(1, Math.max(0, (up + 0.012) / 0.06)) * Math.PI);
            const labia = r.anatomy.labia * 0.0075 * Math.exp(-(((x - 0.011) / 0.008) ** 2)) * along;
            P[v * 3 + 2] += mons + labia;
            P[v * 3 + 1] -= labia * 0.25;
        }
        if (female) for (const [v, across, up] of F.crease) {
            const depth = 0.0028 * r.anatomy.fold * Math.max(0, 1 - across * across * 4) * Math.sin(Math.min(1, Math.max(0, up)) * Math.PI);
            P[v * 3 + 2] -= depth;
        }
    }

    /**
     * The toes drawn out (or in) along the foot. The skeleton keeps one toe
     * bone per foot, so the toes are found by place, not by weight: the foot's
     * vertices in front of the ball of the foot (that bone's joint) move
     * forward in proportion to how far in front they are, ramping in from
     * the ball, so all five lengthen and the ball stays.
     */
    function toes(pack, P, scale) {
        if (!pack._toeFeet) {
            const footBones = pack.bones.map((b, i) => (/(Foot|ToeBase)$/.test(b.name) ? i : -1)).filter(i => i >= 0);
            const onFoot = new Float32Array(pack.vertexCount);
            for (let v = 0; v < pack.vertexCount; v++) for (let k = 0; k < 4; k++) if (footBones.includes(pack.skinJoints[v * 4 + k])) onFoot[v] += pack.skinWeights[v * 4 + k];
            pack._toeFeet = { onFoot, toes: pack.bones.map((b, i) => (/ToeBase$/.test(b.name) ? i : -1)).filter(i => i >= 0) };
        }
        const T = pack._toeFeet;
        for (const i of T.toes) {
            const head = meanOf(P, pack.bones[i].head), tail = meanOf(P, pack.bones[i].tail);
            const side = pack.bones[i].name.startsWith('Left') ? 1 : -1;
            const d = [tail[0] - head[0], tail[2] - head[2]], l = Math.hypot(d[0], d[1]) || 1;
            d[0] /= l; d[1] /= l;
            // The ball of the foot sits a little behind the middle toe's joint.
            const ball = -0.012;
            for (let v = 0; v < T.onFoot.length; v++) {
                if (T.onFoot[v] < 0.5 || Math.sign(P[v * 3]) !== side) continue;
                const along = (P[v * 3] - head[0]) * d[0] + (P[v * 3 + 2] - head[2]) * d[1] - ball;
                if (along <= 0) continue;
                const ramp = Math.min(1, along / 0.02);
                const push = along * (scale - 1) * ramp * Math.min(1, T.onFoot[v]);
                P[v * 3] += d[0] * push; P[v * 3 + 2] += d[1] * push;
            }
        }
    }

    const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    /**
     * Head size and the face morphs, worked in the head's own measure (its
     * joint, the eyes, the crown) so they suit any head the sliders made.
     */
    function morph(pack, P, r) {
        const m = r.morph, size = r.headSize;
        if (m.toes !== 1) toes(pack, P, m.toes);
        eyes(pack, P, r.shapes.eyeSize, m.eyeWide, m.eyeTall);
        if (m.eyeSocket) eyeSockets(pack, P, m.eyeSocket);
        if (r.anatomy.detail) anatomyDetail(pack, P, r);
        if (size === 1 && !m.snout && !m.flat && !m.earsAway && !m.muzzle) return;
        const F = headFields(pack);
        const h = meanOf(P, pack.bones[F.head].head);
        let crown = -Infinity;
        for (let v = 0; v < F.w.length; v++) if (F.w[v] > 0.9 && P[v * 3 + 1] > crown) crown = P[v * 3 + 1];
        const eye = meanOf(P, F.eyeIds);
        const H = crown - h[1];
        if (m.earsAway) {
            const before = Float32Array.from(P);
            // Each ear folds in toward the middle of its own vertices.
            for (const side of [1, -1]) {
                let c = [0, 0, 0], n = 0;
                for (let v = 0; v < F.ear.length; v++) if (F.ear[v] > 0.6 && Math.sign(P[v * 3]) === side) { c[0] += P[v * 3]; c[1] += P[v * 3 + 1]; c[2] += P[v * 3 + 2]; n++; }
                if (!n) continue;
                c = c.map(x => x / n);
                // In toward the skull too: the side of the head under the ear, deeper the more it is put away.
                c[0] -= side * (0.012 + 0.01 * Math.max(0, m.earsAway - 0.6) / 0.4);
                for (let v = 0; v < F.ear.length; v++) {
                    const e = F.ear[v] * m.earsAway;
                    if (!e || Math.sign(P[v * 3]) !== side) continue;
                    // Laid flat on the skull's side at about its own size: nothing stretches, nothing pinches.
                    P[v * 3] += (c[0] - P[v * 3]) * e;
                    // Put all the way away, it gathers to its middle too, so no nub stands out of the head.
                    const gather = 0.45 + 0.45 * Math.max(0, m.earsAway - 0.6) / 0.4;
                    P[v * 3 + 1] += (c[1] - P[v * 3 + 1]) * e * gather;
                    P[v * 3 + 2] += (c[2] - P[v * 3 + 2]) * e * gather;
                }
                // With the ear gone, an ear hole: a pit in the side of the head, as wide as asked.
                if (m.earsAway > 0.6 && m.earHoles > 0) {
                    const r = 0.004 + 0.007 * m.earHoles, depth = (0.004 + 0.006 * m.earHoles) * (m.earsAway - 0.6) / 0.4;
                    for (let v = 0; v < F.w.length; v++) {
                        if (F.w[v] < 0.5 || Math.sign(P[v * 3]) !== side) continue;
                        const d = Math.hypot(P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]);
                        if (d > r || Math.abs(P[v * 3] - c[0]) > 0.03) continue;
                        P[v * 3] -= side * depth * (1 - (d / r) ** 2);
                    }
                }
            }
            // The fold relaxed over the side of the head, so the skin closes over the ear smoothly.
            const field = new Float32Array(P.length);
            for (let i = 0; i < P.length; i++) field[i] = P[i] - before[i];
            const eased = relax(pack, field, 20);
            for (let v = 0; v < F.ear.length; v++) {
                if (!F.ear[v] && !F.w[v]) continue;
                for (let k = 0; k < 3; k++) P[v * 3 + k] = before[v * 3 + k] + eased[v * 3 + k];
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
        const R = Object.assign({ gender: [0, 1], age: [18, 70], muscle: [0.2, 0.8], weight: [0.2, 0.8], height: [0.25, 0.75], cup: [0.3, 0.7], proportions: [0.4, 0.95], shapes: [-0.6, 0.6] }, ranges || {});
        const pick = ([lo, hi]) => lo + (hi - lo) * rand();
        const gender = rand() < 0.5 ? pick([0, 0.15]) : pick([0.85, 1]);
        const r = {
            gender: R.gender[0] === 0 && R.gender[1] === 1 ? gender : pick(R.gender),
            age: pick(R.age), muscle: pick(R.muscle), weight: pick(R.weight), height: pick(R.height), cup: pick(R.cup), proportions: pick(R.proportions),
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

    const api = { almondEye: { frame: almondFrame, half: almondHalf, at: almondAt }, VOLUME, maskOf, fatMask, volume, sexOf, anatomyFields, MORPHS, morph, headFields, vertexNormals, gather, normals, fittedSkin, naturalRecipe, neighbors, relax, SLIDERS, SHAPES, SLIDER_BY_KEY, MACRO_RANGES, ANCESTRY, DEFAULT_RECIPE, MIN_AGE, MAX_AGE, DATA_PATH, dataFolder, normalizeRecipe, targetWeights, openPack, loadPack, shape, joints, fit, build, randomRecipe };
    root.RRHumanBody = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

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

    /** Paired face and body sliders, -1..1, each blending a decrease and an increase target. */
    const SHAPES = ['headFat', 'headWidth', 'headHeight', 'noseWidth', 'noseLength', 'noseHump', 'earSize', 'neck', 'shoulders', 'belly', 'hips'];

    const DEFAULT_RECIPE = Object.freeze({
        species: 'human',
        gender: 0.5,      // 0 female, 1 male
        age: 25,          // years, 11..90
        muscle: 0.5,
        weight: 0.5,
        height: 0.5,
        cup: 0.5,
        ancestry: Object.freeze({ african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 }),
        shapes: Object.freeze({}),
        earsPointed: 0,
        skin: '#c69c7f'
    });

    const MIN_AGE = 11, MAX_AGE = 90;

    const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : lo));

    /** A full recipe from a partial one: every field present and in range. */
    function normalizeRecipe(input) {
        const r = input || {};
        const out = {
            species: 'human',
            gender: clamp(r.gender ?? DEFAULT_RECIPE.gender, 0, 1),
            age: clamp(r.age ?? DEFAULT_RECIPE.age, MIN_AGE, MAX_AGE),
            muscle: clamp(r.muscle ?? DEFAULT_RECIPE.muscle, 0, 1),
            weight: clamp(r.weight ?? DEFAULT_RECIPE.weight, 0, 1),
            height: clamp(r.height ?? DEFAULT_RECIPE.height, 0, 1),
            cup: clamp(r.cup ?? DEFAULT_RECIPE.cup, 0, 1),
            ancestry: {},
            shapes: {},
            earsPointed: clamp(r.earsPointed ?? 0, 0, 1),
            skin: /^#[0-9a-f]{6}$/i.test(r.skin || '') ? r.skin.toLowerCase() : DEFAULT_RECIPE.skin
        };
        if (Number.isFinite(r.seed)) out.seed = r.seed >>> 0;
        let total = 0;
        for (const a of ANCESTRY) { out.ancestry[a] = clamp(r.ancestry?.[a] ?? DEFAULT_RECIPE.ancestry[a], 0, 1); total += out.ancestry[a]; }
        for (const a of ANCESTRY) out.ancestry[a] = total > 0 ? out.ancestry[a] / total : 1 / 3;
        for (const s of SHAPES) out.shapes[s] = clamp(r.shapes?.[s] ?? 0, -1, 1);
        return out;
    }

    /** Three-point blend: 0 → min, 0.5 → average, 1 → max. */
    function levelWeights(x) {
        if (x < 0.5) { const min = (0.5 - x) * 2; return { min, average: 1 - min, max: 0 }; }
        const max = (x - 0.5) * 2;
        return { min: 0, average: 1 - max, max };
    }

    /** Age in years onto child (11), young (25) and old (90). */
    function ageWeights(years) {
        if (years <= 25) { const child = (25 - years) / 14; return { child, young: 1 - child, old: 0 }; }
        const old = (years - 25) / 65;
        return { child: 0, young: 1 - old, old };
    }

    /** Every shape target's weight for a recipe, by target name. Zero weights are left out. */
    function targetWeights(recipe) {
        const r = normalizeRecipe(recipe);
        const out = {};
        const add = (name, w) => { if (w > 1e-5) out[name] = (out[name] || 0) + w; };
        const genders = { female: 1 - r.gender, male: r.gender };
        const ages = ageWeights(r.age), muscles = levelWeights(r.muscle), weights = levelWeights(r.weight);
        // MakeHuman's height targets run from 1.2 m to 2.4 m; the slider spans about 1.45 to 2.05 m for an average man.
        const height = r.height < 0.5 ? { min: (0.5 - r.height) * 1.4, max: 0 } : { min: 0, max: (r.height - 0.5) * 0.9 };
        const cup = levelWeights(r.cup);
        for (const g in genders) for (const a of AGES) {
            const ga = genders[g] * ages[a];
            if (ga <= 0) continue;
            for (const m of LEVELS) for (const w of LEVELS) add(`macro/${g}-${a}-${m}muscle-${w}weight`, ga * muscles[m] * weights[w]);
            for (const race of ANCESTRY) add(`race/${race}-${g}-${a}`, ga * r.ancestry[race]);
            add(`height/${g}-${a}-min`, ga * height.min);
            add(`height/${g}-${a}-max`, ga * height.max);
            if (g === 'female') { add(`cup/female-${a}-min`, ga * cup.min); add(`cup/female-${a}-max`, ga * cup.max); }
        }
        for (const s of SHAPES) {
            const v = r.shapes[s];
            if (v < 0) add(`shape/${s}-decr`, -v);
            else add(`shape/${s}-incr`, v);
        }
        add('shape/earsPointed', r.earsPointed);
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
    function shape(pack, recipe, out) {
        const positions = out && out.length === pack.positions.length ? out : new Float32Array(pack.positions.length);
        positions.set(pack.positions);
        const weights = targetWeights(recipe);
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
        return positions;
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
        return { parts, bones, height: top };
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
        for (const k of SHAPES) r.shapes[k] = pick(R.shapes) * (k === 'belly' ? Math.max(0, r.weight - 0.3) * 1.5 : 1);
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

    const api = { SHAPES, ANCESTRY, DEFAULT_RECIPE, MIN_AGE, MAX_AGE, DATA_PATH, dataFolder, normalizeRecipe, targetWeights, openPack, loadPack, shape, joints, fit, build, randomRecipe };
    root.RRHumanBody = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * RRPropModel - the Prop Builder's kinds, and what every kind's build
 * becomes on Save: a skinned GLB (RRCharacterGlb) and its model.json.
 *
 * A kind is { id, label, normalize, build, random? }; build gives { parts,
 * bones, clips, textures, cloth? }. A kind with cloth carries the setup
 * its loop is baked from (RRPropCloth). The file's model.json plays the
 * loop always and puts the model's own origin (a pole's foot) where the
 * game stands it, since the game centers a model on its box.
 */
(function(root) {
    'use strict';

    const need = (name, file) => root[name] || (typeof require === 'function' ? require(file) : null);
    const Cloth = need('RRPropCloth', './PropCloth.js');
    const Glb = need('RRCharacterGlb', '../Character3D/CharacterGlb.js');

    const KINDS = [];
    const BY_ID = new Map();
    function register(kind) {
        if (BY_ID.has(kind.id)) KINDS.splice(KINDS.indexOf(BY_ID.get(kind.id)), 1, kind); else KINDS.push(kind);
        BY_ID.set(kind.id, kind);
    }

    function kindOf(recipe) { return BY_ID.get(recipe && recipe.kind) || KINDS[0]; }
    function normalize(recipe) { return kindOf(recipe).normalize(recipe || {}); }
    function build(recipe, cache, options) { return kindOf(recipe).build(recipe, cache, options); }

    /** A build's cloth baked into its loop: { times, T, Q } for every cloth bone, or null when it has no cloth. */
    function bake(result, options) {
        if (!result.cloth) return null;
        const { setup, grid } = result.cloth;
        const baked = Cloth.bake(setup, options);
        const tracks = Cloth.tracks(baked, setup.rest, grid);
        tracks.closing = baked.closing;
        return tracks;
    }

    /**
     * Where the model's own origin ends up once the game has centered it:
     * the middle of its box at rest across the ground, and the lowest point
     * its loop reaches (sampled as the game samples it, twelve times).
     */
    function origin(result) {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
        for (const p of result.parts) {
            const P = p.positions;
            for (let i = 0; i < P.length; i += 3) {
                minX = Math.min(minX, P[i]); maxX = Math.max(maxX, P[i]); minZ = Math.min(minZ, P[i + 2]); maxZ = Math.max(maxZ, P[i + 2]);
                if (!(result.cloth && p === result.parts[result.cloth.part] && result.clips.length)) minY = Math.min(minY, P[i + 1]);
            }
        }
        const clip = result.clips[0], loop = result.loop;
        if (clip && loop && result.cloth) {
            const part = result.parts[result.cloth.part], count = result.cloth.grid.count;
            const T = new Float32Array(count * 3), Q = new Float32Array(count * 4), out = new Float32Array(part.positions.length);
            const joints = part.joints.map(j => j - 1);
            const duration = loop.times[loop.times.length - 1];
            for (let s = 0; s < 12; s++) {
                Cloth.sample(loop, duration * s / 12, T, Q);
                Cloth.skin(part.positions, joints, part.weights, result.cloth.restBones, T, Q, out);
                for (let i = 1; i < out.length; i += 3) minY = Math.min(minY, out[i]);
            }
        }
        const round = v => Math.round(v * 10000) / 10000;
        return [round((minX + maxX) / 2), round(Number.isFinite(minY) ? minY : 0), round((minZ + maxZ) / 2)];
    }

    /** The model.json a saved prop starts with: its loop playing always, its origin where it is placed. */
    function sidecar(result) {
        const out = { transform: { offset: origin(result) } };
        if (result.clips.length) out.animations = result.clips.map(c => ({ type: 'clip', trigger: 'always', name: c.name, clip: c.name, part: '' }));
        return out;
    }

    /**
     * The GLB of a build. `loop` (from bake) becomes its clip; `encode(texture)`
     * turns a picture into PNG bytes (the page uses a canvas, node pngjs).
     */
    async function toGlb(result, name, encode) {
        const images = {};
        for (const [key, tex] of Object.entries(result.textures || {})) if (tex) images[key] = await encode(tex);
        const parts = result.parts.map(p => {
            const out = Object.assign({}, p);
            if (out.texture && !images[out.texture]) delete out.texture;
            if (out.normalTexture && !images[out.normalTexture]) delete out.normalTexture;
            if (!out.texture && !out.colors && !out.color) out.color = '#bbbbbb';
            return out;
        });
        return Glb.toGlb({ parts, bones: result.bones }, { name, clips: result.clips, images });
    }

    /** What a build costs: triangles, vertices, bones, the loop's keys and its pictures' pixels. */
    function stats(result) {
        let triangles = 0, vertices = 0;
        for (const p of result.parts) { triangles += p.index.length / 3; vertices += p.positions.length / 3; }
        const textures = Object.values(result.textures || {}).filter(Boolean).map(t => [t.width, t.height]);
        return { triangles, vertices, bones: result.bones.length, keys: result.clips[0] ? result.clips[0].times.length : 0, textures };
    }

    const api = { KINDS, BY_ID, register, kindOf, normalize, build, bake, origin, sidecar, toGlb, stats };
    root.RRPropModel = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    const flag = root.RRFlagProp || (typeof require === 'function' ? require('./FlagProp.js') : null);
    if (flag) register({ id: 'flag', label: 'Flag', normalize: flag.normalize, build: flag.build, random: flag.random });
    // From picture registers itself when it loads (after this file on the page).
    if (!root.RRPictureProp && typeof require === 'function' && typeof module !== 'undefined') require('./PictureProp.js');
})(typeof window !== 'undefined' ? window : globalThis);

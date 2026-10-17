/**
 * RRCreatureBody - the Character Builder's four-legged body plan: a recipe of
 * slider and option values in, a skinned, vertex-colored creature out.
 *
 * The body is an implicit surface: rounded cones and ellipsoids laid along
 * a quadruped skeleton (torso, neck, head and snout, legs, paws or hooves,
 * mane, hump) blended by smooth minimum and meshed by surface nets, the way
 * the runtime meshes rock (Reactor3D.rockMesh). Thin things an implicit
 * surface would lose (ears, tails, horns, antlers, tusks, spines) are lofted
 * tubes. Skin weights come from how near each vertex lies to the shapes of
 * each bone; coat patterns are painted per vertex.
 *
 * Bones carry the 3D Models Rig tool's quadruped names (Hips, Spine, Chest,
 * Neck, Head, Tail, LeftFrontUpperLeg …), so the built-in quadruped motions
 * drive the file's own skeleton. Frame: y up, facing +z, the creature's
 * left at +x, meters, standing on y = 0.
 *
 * No DOM and no three.js here: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    // ── small math ─────────────────────────────────────────────────────────
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
    const mirror = p => [-p[0], p[1], p[2]];
    const DEG = Math.PI / 180;

    // ── noise ──────────────────────────────────────────────────────────────
    function hash3(x, y, z, seed) {
        let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 2246822519) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    function valueNoise(x, y, z, seed) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
        let out = 0;
        for (let c = 0; c < 8; c++) {
            const dx = c & 1, dy = (c >> 1) & 1, dz = c >> 2;
            out += hash3(xi + dx, yi + dy, zi + dz, seed) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        }
        return out * 2 - 1;
    }
    function fbm(x, y, z, seed, octaves = 3) {
        let sum = 0, amp = 0.5, f = 1;
        for (let o = 0; o < octaves; o++) { sum += amp * valueNoise(x * f, y * f, z * f, seed + o * 17); amp *= 0.5; f *= 2.03; }
        return sum;
    }
    /** Distance to the nearest and second-nearest jittered cell point. */
    function worley(x, y, z, seed) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        let d1 = 9, d2 = 9;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
            const cx = xi + i, cy = yi + j, cz = zi + k;
            const px = cx + hash3(cx, cy, cz, seed), py = cy + hash3(cx, cy, cz, seed + 1), pz = cz + hash3(cx, cy, cz, seed + 2);
            const d = Math.hypot(px - x, py - y, pz - z);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return [d1, d2];
    }

    // ── color ──────────────────────────────────────────────────────────────
    const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const hexRgb = hex => { const n = parseInt(String(hex || '#888888').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const HEX = /^#[0-9a-f]{6}$/i;

    // ── the recipe ─────────────────────────────────────────────────────────
    /** Sliders: `natural` is the everyday range; min/max run on to the extremes. */
    const SLIDERS = [
        { key: 'size', label: 'Size', section: 'Body', min: 0.08, max: 5, step: 0.01, natural: [0.25, 2.4], unit: 'm' },
        { key: 'bodyLength', label: 'Body length', section: 'Body', min: 0.4, max: 2.5, step: 0.01, natural: [0.75, 1.4] },
        { key: 'girth', label: 'Girth', section: 'Body', min: 0.3, max: 2.6, step: 0.01, natural: [0.7, 1.45] },
        { key: 'chestDepth', label: 'Chest depth', section: 'Body', min: 0.5, max: 2.2, step: 0.01, natural: [0.75, 1.35] },
        { key: 'belly', label: 'Belly', section: 'Body', min: -1.5, max: 3, step: 0.01, natural: [-1, 1] },
        { key: 'hump', label: 'Shoulder hump', section: 'Body', min: 0, max: 2.5, step: 0.01, natural: [0, 1] },
        { key: 'hipHeight', label: 'Hip height', section: 'Body', min: 0.5, max: 1.6, step: 0.01, natural: [0.8, 1.2] },
        { key: 'fluff', label: 'Fur shagginess', section: 'Body', min: 0, max: 2, step: 0.01, natural: [0, 1] },
        { key: 'legLength', label: 'Leg length', section: 'Legs and feet', min: 0.2, max: 2.4, step: 0.01, natural: [0.45, 1.35] },
        { key: 'legThickness', label: 'Leg thickness', section: 'Legs and feet', min: 0.3, max: 2.6, step: 0.01, natural: [0.65, 1.5] },
        { key: 'pawSize', label: 'Paw size', section: 'Legs and feet', min: 0.3, max: 2.6, step: 0.01, natural: [0.7, 1.5] },
        { key: 'plantigrade', label: 'Flat feet', section: 'Legs and feet', min: 0, max: 1, step: 0.01, natural: [0, 1] },
        { key: 'neckLength', label: 'Neck length', section: 'Head', min: 0.1, max: 3.2, step: 0.01, natural: [0.4, 1.6] },
        { key: 'neckThickness', label: 'Neck thickness', section: 'Head', min: 0.4, max: 2.4, step: 0.01, natural: [0.7, 1.4] },
        { key: 'neckAngle', label: 'Neck raise', section: 'Head', min: -10, max: 95, step: 1, natural: [10, 75], unit: '°' },
        { key: 'headSize', label: 'Head size', section: 'Head', min: 0.4, max: 2.6, step: 0.01, natural: [0.7, 1.4] },
        { key: 'snoutLength', label: 'Snout length', section: 'Head', min: 0, max: 3, step: 0.01, natural: [0.2, 1.7] },
        { key: 'snoutWidth', label: 'Snout width', section: 'Head', min: 0.3, max: 2.2, step: 0.01, natural: [0.6, 1.4] },
        { key: 'headPitch', label: 'Head tilt', section: 'Head', min: -20, max: 80, step: 1, natural: [0, 60], unit: '°' },
        { key: 'eyeSize', label: 'Eye size', section: 'Head', min: 0.3, max: 3, step: 0.01, natural: [0.6, 1.6] },
        { key: 'eyeSide', label: 'Eyes to the side', section: 'Head', min: 0, max: 1, step: 0.01, natural: [0, 1] },
        { key: 'earSize', label: 'Ear size', section: 'Head', min: 0, max: 3.5, step: 0.01, natural: [0.4, 1.8] },
        { key: 'earDroop', label: 'Ear droop', section: 'Head', min: -1, max: 1.5, step: 0.01, natural: [-1, 1] },
        { key: 'tailLength', label: 'Tail length', section: 'Tail', min: 0, max: 3, step: 0.01, natural: [0, 1.5] },
        { key: 'tailThickness', label: 'Tail thickness', section: 'Tail', min: 0.2, max: 3, step: 0.01, natural: [0.5, 1.6] },
        { key: 'tailCurl', label: 'Tail carriage', section: 'Tail', min: -1.5, max: 1.5, step: 0.01, natural: [-1, 1] },
        { key: 'hornSize', label: 'Horn size', section: 'Features', min: 0, max: 3, step: 0.01, natural: [0.3, 1.5] },
        { key: 'tuskSize', label: 'Tusks', section: 'Features', min: 0, max: 2.5, step: 0.01, natural: [0, 1.2] },
        { key: 'maneSize', label: 'Mane size', section: 'Features', min: 0, max: 2.5, step: 0.01, natural: [0, 1.5] },
        { key: 'spines', label: 'Back spines', section: 'Features', min: 0, max: 2.5, step: 0.01, natural: [0, 1] },
        { key: 'wingSize', label: 'Wing size', section: 'Features', min: 0, max: 3, step: 0.01, natural: [0.4, 1.6] },
        { key: 'patternScale', label: 'Pattern scale', section: 'Coat', min: 0.3, max: 3, step: 0.01, natural: [0.5, 2] },
        { key: 'patternAmount', label: 'Pattern strength', section: 'Coat', min: 0, max: 1, step: 0.01, natural: [0, 1] }
    ];

    const OPTIONS = [
        { key: 'ears', label: 'Ears', choices: [['pointed', 'Pointed'], ['round', 'Round'], ['floppy', 'Floppy'], ['long', 'Long'], ['narrow', 'Narrow'], ['small', 'Small'], ['none', 'None']] },
        { key: 'tail', label: 'Tail', choices: [['long', 'Long'], ['bushy', 'Bushy'], ['stub', 'Stub'], ['tufted', 'Tufted'], ['horse', 'Hair'], ['thick', 'Thick'], ['curly', 'Curly'], ['none', 'None']] },
        { key: 'horns', label: 'Horns', choices: [['none', 'None'], ['antlers', 'Antlers'], ['bull', 'Bull'], ['ram', 'Ram'], ['goat', 'Goat'], ['unicorn', 'Unicorn'], ['rhino', 'Nose horn'], ['dragon', 'Dragon']] },
        { key: 'feet', label: 'Feet', choices: [['paw', 'Paws'], ['hoof', 'Hooves'], ['claw', 'Claws']] },
        { key: 'wings', label: 'Wings', choices: [['none', 'None'], ['bat', 'Bat'], ['feathered', 'Feathered']] },
        { key: 'mane', label: 'Mane', choices: [['none', 'None'], ['lion', 'Lion'], ['horse', 'Crest'], ['ruff', 'Ruff']] },
        { key: 'pattern', label: 'Pattern', choices: [['solid', 'Solid'], ['countershade', 'Light belly'], ['spots', 'Spots'], ['rosettes', 'Rosettes'], ['stripes', 'Stripes'], ['tabby', 'Tabby'], ['socks', 'Socks'], ['points', 'Color points'], ['saddle', 'Saddle'], ['piebald', 'Patches'], ['dapple', 'Dapple'], ['scales', 'Scales']] }
    ].map(o => ({ key: o.key, label: o.label, choices: o.choices.map(([id, label]) => ({ id, label })) }));

    /** Colors: coat, the pattern's marking color, the light belly/muzzle, nose/hooves/claws, horns, eyes, mane. */
    const COLORS = [
        { key: 'coat', label: 'Coat' }, { key: 'marking', label: 'Markings' }, { key: 'light', label: 'Light fur' },
        { key: 'nose', label: 'Nose' }, { key: 'hoof', label: 'Hooves and claws' }, { key: 'horn', label: 'Horns' }, { key: 'eye', label: 'Eyes' }, { key: 'mane', label: 'Mane and tail hair' }
    ];

    const DEFAULT_RECIPE = Object.freeze({
        plan: 'quadruped', kind: 'dog',
        size: 0.7, bodyLength: 1, girth: 1, chestDepth: 1, belly: 0, hump: 0, hipHeight: 1, fluff: 0.2,
        legLength: 1, legThickness: 1, pawSize: 1, plantigrade: 0,
        neckLength: 1, neckThickness: 1, neckAngle: 40, headSize: 1, snoutLength: 1, snoutWidth: 1, headPitch: 15, eyeSize: 1, eyeSide: 0.2,
        earSize: 1, earDroop: 0, tailLength: 0.9, tailThickness: 1, tailCurl: 0, hornSize: 1, tuskSize: 0, maneSize: 0, spines: 0, wingSize: 1,
        patternScale: 1, patternAmount: 1,
        ears: 'pointed', tail: 'long', horns: 'none', feet: 'paw', wings: 'none', mane: 'none', pattern: 'countershade',
        colors: Object.freeze({ coat: '#8a6a48', marking: '#3a2a1e', light: '#e8dcc8', nose: '#2a2220', hoof: '#2a2420', horn: '#d8ccb0', eye: '#6a4a20', mane: '#5a3f28' }),
        seed: 1
    });

    const K = (kind, over, colors) => ({ kind, over, colors });
    /** Presets: recipes over the defaults. */
    const KINDS = [
        K('cat', { size: 0.42, legLength: 0.85, girth: 0.82, chestDepth: 0.9, neckLength: 0.55, neckAngle: 35, headSize: 1.15, snoutLength: 0.3, snoutWidth: 0.85, headPitch: 5, eyeSize: 1.35, eyeSide: 0.05, earSize: 1.05, ears: 'pointed', tail: 'long', tailLength: 1.15, tailThickness: 0.7, tailCurl: 0.3, pattern: 'tabby', pawSize: 0.85, fluff: 0.3 },
            { coat: '#b58a5a', marking: '#4a3220', light: '#efe2cc', nose: '#d89090', eye: '#8db040', mane: '#b58a5a' }),
        K('lion', { size: 1.9, legLength: 0.95, girth: 1.12, chestDepth: 1.1, neckLength: 0.65, neckAngle: 30, headSize: 1.15, snoutLength: 0.55, snoutWidth: 1.05, headPitch: 10, eyeSize: 0.9, eyeSide: 0.05, earSize: 0.6, ears: 'round', tail: 'tufted', tailLength: 1.05, tailThickness: 0.75, tailCurl: -0.3, mane: 'lion', maneSize: 1.1, pattern: 'countershade', pawSize: 1.15, fluff: 0.25 },
            { coat: '#c89a58', marking: '#8a5a2c', light: '#ead2a4', nose: '#5a3028', eye: '#c08a30', mane: '#7a4a24' }),
        K('tiger', { size: 2.2, legLength: 0.9, girth: 1.1, chestDepth: 1.05, neckLength: 0.6, neckAngle: 28, headSize: 1.1, snoutLength: 0.5, snoutWidth: 1.05, headPitch: 8, eyeSize: 0.85, eyeSide: 0.05, earSize: 0.6, ears: 'round', tail: 'long', tailLength: 1.15, tailThickness: 0.85, tailCurl: -0.2, pattern: 'stripes', pawSize: 1.2, fluff: 0.25 },
            { coat: '#d8782a', marking: '#1e1610', light: '#f2e8d8', nose: '#c07070', eye: '#d0a030', mane: '#d8782a' }),
        K('dog', { girth: 1.05, legLength: 0.95, chestDepth: 1.1, snoutWidth: 1.05, headSize: 1.1, tailThickness: 1.2, earSize: 1.15, earDroop: 0.35, tailCurl: 0.25 }, {}),
        K('wolf', { size: 1.05, legLength: 1.1, girth: 0.95, chestDepth: 1.1, belly: -0.6, neckLength: 0.85, neckAngle: 32, headSize: 1.05, snoutLength: 1.15, snoutWidth: 0.95, headPitch: 15, eyeSize: 0.85, earSize: 1, ears: 'pointed', tail: 'bushy', tailLength: 0.85, tailThickness: 1.2, tailCurl: -0.6, mane: 'ruff', maneSize: 0.6, pattern: 'saddle', fluff: 0.55 },
            { coat: '#8c8478', marking: '#3a3632', light: '#ddd6c8', nose: '#1e1c1a', eye: '#c8a040', mane: '#7a746a' }),
        K('fox', { size: 0.55, legLength: 0.8, girth: 0.8, neckLength: 0.7, neckAngle: 35, headSize: 0.95, snoutLength: 1.1, snoutWidth: 0.75, headPitch: 12, eyeSize: 1, earSize: 1.45, ears: 'pointed', tail: 'bushy', tailLength: 1.15, tailThickness: 1.5, tailCurl: -0.25, pattern: 'points', fluff: 0.45 },
            { coat: '#d06a24', marking: '#2a1c14', light: '#f4ece0', nose: '#1a1412', eye: '#c08a20', mane: '#d06a24' }),
        K('deer', { size: 1.05, legLength: 1.35, girth: 0.85, chestDepth: 1.05, belly: -0.4, neckLength: 1.2, neckAngle: 58, headSize: 0.95, snoutLength: 1.0, snoutWidth: 0.8, headPitch: 40, eyeSize: 1.25, eyeSide: 0.85, earSize: 1.3, ears: 'narrow', earDroop: -0.3, tail: 'stub', tailLength: 0.35, feet: 'hoof', horns: 'antlers', hornSize: 1.1, legThickness: 0.75, pattern: 'countershade', fluff: 0.05 },
            { coat: '#9a6a40', marking: '#5a3a22', light: '#f0e6d6', nose: '#1e1816', horn: '#c8b090', eye: '#2a1a10', mane: '#9a6a40' }),
        K('horse', { size: 1.6, legLength: 1.25, girth: 1.05, belly: 0.2, neckLength: 1.35, neckAngle: 55, neckThickness: 1.35, headSize: 1.35, snoutLength: 1.25, snoutWidth: 1.1, headPitch: 60, chestDepth: 1.25, eyeSize: 1, eyeSide: 0.9, earSize: 1.2, ears: 'narrow', tail: 'horse', tailLength: 1.05, tailThickness: 1.2, tailCurl: -0.9, feet: 'hoof', mane: 'horse', maneSize: 1, pattern: 'socks', legThickness: 0.9, fluff: 0.05 },
            { coat: '#7a4a2a', marking: '#f2ede4', light: '#d8c4a8', nose: '#2a2220', eye: '#2a1810', mane: '#1e1612' }),
        K('bear', { size: 1.5, legLength: 1.15, girth: 1.25, chestDepth: 1.05, belly: 0.4, hump: 0.7, hipHeight: 0.95, neckLength: 0.55, neckAngle: 18, neckThickness: 1.4, headSize: 1.1, snoutLength: 0.75, snoutWidth: 1.05, headPitch: 15, eyeSize: 0.7, earSize: 0.7, ears: 'round', tail: 'stub', tailLength: 0.15, feet: 'claw', plantigrade: 1, pawSize: 1.1, legThickness: 1.4, pattern: 'solid', fluff: 0.7 },
            { coat: '#5a3c26', marking: '#3a261a', light: '#7a5a3a', nose: '#1a1412', eye: '#1a1010', mane: '#5a3c26' }),
        K('boar', { size: 1.05, legLength: 0.55, girth: 1.3, chestDepth: 1.25, hump: 0.4, belly: 0.2, neckLength: 0.35, neckAngle: 10, neckThickness: 1.5, headSize: 1.15, snoutLength: 1.15, snoutWidth: 0.95, headPitch: 25, eyeSize: 0.6, eyeSide: 0.6, earSize: 0.85, ears: 'pointed', earDroop: 0.2, tail: 'tufted', tailLength: 0.35, tailThickness: 0.5, tailCurl: -0.8, feet: 'hoof', tuskSize: 1, legThickness: 0.85, pattern: 'solid', fluff: 0.8, mane: 'horse', maneSize: 0.5 },
            { coat: '#4a3a30', marking: '#2a201a', light: '#6a5a4a', nose: '#3a2a26', horn: '#ece4d0', eye: '#1a1010', mane: '#2a2018' }),
        K('rabbit', { size: 0.32, bodyLength: 0.9, legLength: 0.6, hipHeight: 1.35, girth: 1.05, chestDepth: 1.05, neckLength: 0.35, neckAngle: 40, headSize: 1.3, snoutLength: 0.35, snoutWidth: 0.95, headPitch: 20, eyeSize: 1.5, eyeSide: 1, earSize: 2.1, ears: 'long', earDroop: -0.5, tail: 'stub', tailLength: 0.25, tailThickness: 1.4, tailCurl: 1, plantigrade: 0.6, pattern: 'countershade', fluff: 0.5 },
            { coat: '#9a8470', marking: '#5a4a3a', light: '#f2ece4', nose: '#d89aa0', eye: '#1a1210', mane: '#9a8470' }),
        K('bull', { size: 1.75, legLength: 0.85, girth: 1.4, chestDepth: 1.3, belly: 0.7, hump: 0.45, neckLength: 0.55, neckAngle: 15, neckThickness: 1.55, headSize: 1.15, snoutLength: 1.05, snoutWidth: 1.15, headPitch: 35, eyeSize: 0.9, eyeSide: 0.85, earSize: 0.8, ears: 'round', earDroop: 0.7, tail: 'tufted', tailLength: 1, tailThickness: 0.6, tailCurl: -1, feet: 'hoof', horns: 'bull', hornSize: 1, pattern: 'piebald', legThickness: 1.1, fluff: 0.05 },
            { coat: '#2a2220', marking: '#f0ece4', light: '#3a302a', nose: '#c08a8a', horn: '#e0d4b8', eye: '#1a1010', mane: '#1a1412' }),
        K('ram', { size: 0.95, legLength: 0.85, girth: 1.25, chestDepth: 1.1, belly: 0.3, neckLength: 0.6, neckAngle: 35, headSize: 1, snoutLength: 0.85, snoutWidth: 0.85, headPitch: 35, eyeSize: 1, eyeSide: 0.9, earSize: 0.75, ears: 'narrow', earDroop: 0.6, tail: 'stub', tailLength: 0.3, feet: 'hoof', horns: 'ram', hornSize: 1.1, pattern: 'points', legThickness: 0.7, fluff: 1.3 },
            { coat: '#e8e0d0', marking: '#3a3430', light: '#f4f0e8', nose: '#2a2624', horn: '#b8a888', eye: '#a07830', mane: '#e8e0d0' }),
        K('drake', { size: 2.6, bodyLength: 1.25, legLength: 0.75, girth: 1.15, chestDepth: 1.1, belly: 0.2, neckLength: 1.5, neckAngle: 38, headSize: 1.05, snoutLength: 1.35, snoutWidth: 0.9, headPitch: 18, eyeSize: 0.9, eyeSide: 0.35, earSize: 0.7, ears: 'small', tail: 'thick', tailLength: 2.1, tailThickness: 1.5, tailCurl: -0.35, feet: 'claw', plantigrade: 0.7, horns: 'dragon', hornSize: 1.2, spines: 1, wings: 'bat', wingSize: 1.1, pattern: 'scales', legThickness: 1.25, pawSize: 1.3, fluff: 0 },
            { coat: '#2f6a3a', marking: '#1c3a22', light: '#c8b878', nose: '#1a1a14', horn: '#d8d0b0', eye: '#e8b020', mane: '#2f6a3a' })
    ];
    const KIND_BY_ID = new Map(KINDS.map(k => [k.kind, k]));

    /** A preset's whole recipe. */
    function kindRecipe(kind) {
        const k = KIND_BY_ID.get(kind) || KIND_BY_ID.get('dog');
        return normalizeRecipe(Object.assign({}, DEFAULT_RECIPE, k.over, { kind: k.kind, colors: Object.assign({}, DEFAULT_RECIPE.colors, k.colors) }));
    }

    /** A full recipe from a partial one: every field present and in its extreme range. */
    function normalizeRecipe(input) {
        const r = input || {};
        const out = { plan: 'quadruped', kind: KIND_BY_ID.has(r.kind) ? r.kind : DEFAULT_RECIPE.kind };
        for (const s of SLIDERS) {
            const v = Number(r[s.key]);
            out[s.key] = clamp(Number.isFinite(v) ? v : DEFAULT_RECIPE[s.key], s.min, s.max);
        }
        for (const o of OPTIONS) out[o.key] = o.choices.some(c => c.id === r[o.key]) ? r[o.key] : DEFAULT_RECIPE[o.key];
        out.colors = {};
        for (const c of COLORS) {
            const v = r.colors && r.colors[c.key];
            out.colors[c.key] = HEX.test(v || '') ? v.toLowerCase() : DEFAULT_RECIPE.colors[c.key];
        }
        out.seed = Number.isFinite(r.seed) ? r.seed >>> 0 : DEFAULT_RECIPE.seed;
        return out;
    }

    /** A seeded variation on a preset (a random preset when none is named): sliders wander within their natural range. */
    function randomRecipe(seed, kind) {
        let s = (seed >>> 0) || 1;
        const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
        const id = KIND_BY_ID.has(kind) ? kind : KINDS[Math.floor(rand() * KINDS.length)].kind;
        const base = kindRecipe(id);
        const r = Object.assign({}, base, { colors: Object.assign({}, base.colors) });
        for (const sl of SLIDERS) {
            if (sl.key === 'neckAngle' || sl.key === 'headPitch') { r[sl.key] = base[sl.key] + (rand() - 0.5) * 12; continue; }
            if (sl.key === 'size') { r.size = base.size * (0.85 + rand() * 0.3); continue; }
            const [lo, hi] = sl.natural;
            r[sl.key] = clamp(base[sl.key] + (rand() - 0.5) * (hi - lo) * 0.22, lo, hi);
        }
        // Coat: a nudge of the preset's colors in lightness and warmth.
        const nudge = hex => {
            const c = hexRgb(hex), k = 0.85 + rand() * 0.3, w = (rand() - 0.5) * 0.08;
            const v = [c[0] * k + w, c[1] * k, c[2] * k - w].map(x => Math.round(clamp(x, 0, 1) * 255));
            return '#' + v.map(x => x.toString(16).padStart(2, '0')).join('');
        };
        for (const key of ['coat', 'marking', 'light', 'mane']) r.colors[key] = nudge(r.colors[key]);
        r.seed = seed >>> 0;
        return normalizeRecipe(r);
    }

    // ── shapes ─────────────────────────────────────────────────────────────
    /** A rounded cone from a (radius ra) to b (radius rb). */
    function cone(a, b, ra, rb, bone, k, tag) {
        const lo = [0, 1, 2].map(i => Math.min(a[i] - ra, b[i] - rb)), hi = [0, 1, 2].map(i => Math.max(a[i] + ra, b[i] + rb));
        return { type: 0, a, b, ra, rb, bone, k: k ?? 0.05, tag, lo, hi };
    }
    /** An ellipsoid at c with radii r along the axes x (side), y (up) and z (forward) of a basis turned to face `forward`. */
    function ellipsoid(c, r, bone, k, tag, forward) {
        const f = norm(forward || [0, 0, 1]);
        let side = cross([0, 1, 0], f);
        if (len(side) < 1e-6) side = [1, 0, 0];
        side = norm(side);
        const up = norm(cross(f, side));
        const m = Math.max(r[0], r[1], r[2]);
        return { type: 1, c, r, ax: side, ay: up, az: f, bone, k: k ?? 0.05, tag, lo: sub(c, [m, m, m]), hi: add(c, [m, m, m]) };
    }

    function shapeDistance(s, p) {
        if (s.type === 1) {
            const d = sub(p, s.c);
            const x = dot(d, s.ax) / s.r[0], y = dot(d, s.ay) / s.r[1], z = dot(d, s.az) / s.r[2];
            const k0 = Math.sqrt(x * x + y * y + z * z);
            const k1 = Math.sqrt(x * x / (s.r[0] * s.r[0]) + y * y / (s.r[1] * s.r[1]) + z * z / (s.r[2] * s.r[2]));
            return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(s.r[0], s.r[1], s.r[2]);
        }
        // Round cone (Inigo Quilez's exact distance).
        const ba = sub(s.b, s.a), l2 = dot(ba, ba);
        const pa = sub(p, s.a);
        if (l2 < 1e-12) return len(pa) - Math.max(s.ra, s.rb);
        const rr = s.ra - s.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
        const y = dot(pa, ba), z = y - l2;
        const q = sub(mul(pa, l2), mul(ba, y));
        const x2 = dot(q, q), y2 = y * y * l2, z2 = z * z * l2;
        const kk = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(z) * a2 * z2 > kk) return Math.sqrt(x2 + z2) * il2 - s.rb;
        if (Math.sign(y) * a2 * y2 < kk) return Math.sqrt(x2 + y2) * il2 - s.ra;
        return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - s.ra;
    }

    const smin = (a, b, k) => {
        if (k <= 0) return Math.min(a, b);
        const h = Math.max(k - Math.abs(a - b), 0) / k;
        return Math.min(a, b) - h * h * k * 0.25;
    };

    // ── skeleton and layout (units: shoulder-to-hip length = 1) ───────────
    /**
     * Every joint, shape and lofted piece of the creature, in body units. The
     * bones are the Rig tool's quadruped bones plus a tail chain.
     */
    function layout(r) {
        const g = r.girth, bl = r.bodyLength, L = r.legLength, ht = r.headSize, lt = r.legThickness;
        const plant = r.plantigrade;
        const J = {};
        // Leg tops: the shoulder joint in front, the hip joint behind.
        const yS = 0.66 * L, yH = 0.66 * L * r.hipHeight;
        const halfW = 0.12 * g;
        J.shoulder = [halfW, yS, 0.5 * bl];
        J.hip = [halfW * 0.95, yH, -0.5 * bl];
        // The spine line, a little above the leg tops.
        const depth = 0.24 * g * r.chestDepth;
        const spineF = [0, yS + 0.08 * g + depth * 0.9, 0.42 * bl], spineR = [0, yH + 0.24 * g, -0.48 * bl];
        J.hips = [0, yH + 0.06 * g, -0.42 * bl];
        J.neck = [0, yS + 0.08 * g + depth * 0.55, 0.6 * bl];
        // Neck: from its base out and up at the raise angle.
        const na = r.neckAngle * DEG, nlen = 0.36 * r.neckLength;
        const ndir = [0, Math.sin(na), Math.cos(na)];
        J.atlas = add(J.neck, mul(ndir, nlen));
        // Skull: forward of the atlas; the snout runs out from it along the head's tilt.
        const pitch = r.headPitch * DEG;
        const hdir = [0, -Math.sin(pitch), Math.cos(pitch)];
        const skullR = 0.14 * ht;
        const skull = add(J.atlas, add(mul(hdir, skullR * 0.75), [0, skullR * 0.35 * Math.cos(pitch), 0]));
        const snoutLen = 0.22 * ht * r.snoutLength;
        const snoutBase = add(skull, mul(hdir, skullR * 0.55));
        const snoutTip = add(snoutBase, add(mul(hdir, snoutLen), [0, -skullR * 0.15, 0]));
        J.skull = skull; J.snoutTip = snoutTip; J.hdir = hdir; J.skullR = skullR;
        J.headTop = add(skull, [0, skullR * 0.9, 0]);
        // Legs. Front: shoulder, elbow a little behind, wrist low, toe ahead.
        const fw = halfW * 1.02;
        const wristY = yS * (0.2 - 0.12 * plant), hockY = yH * (0.32 - 0.24 * plant);
        J.frontKnee = [fw, yS * 0.58, 0.44 * bl];
        J.frontAnkle = [fw, wristY, 0.49 * bl + 0.02];
        J.frontToe = [fw, 0, 0.5 * bl + 0.06 + 0.06 * plant + 0.03 * r.pawSize];
        // Rear: hip, stifle forward, hock back, paw under it.
        J.rearKnee = [halfW * 0.98, yH * 0.6, -0.36 * bl];
        J.rearAnkle = [halfW * 0.98, hockY, -0.6 * bl - 0.02 * (1 - plant)];
        J.rearToe = [halfW * 0.98, 0, -0.55 * bl + 0.05 + 0.12 * plant];
        // Tail: from the rump, out and drooping (carriage below zero) or curling up.
        const tailRoot = add(spineR, [0, -0.04 * g, -0.12 * g]);
        J.tailRoot = tailRoot;
        const tailLen = r.tail === 'none' ? 0 : 0.9 * r.tailLength * (r.tail === 'stub' ? 0.3 : 1);
        const segments = 6;
        const tailPts = [tailRoot];
        let dirAngle = (r.tailCurl * 45 - 12) * DEG;
        const step = tailLen / segments;
        for (let i = 0; i < segments; i++) {
            const last = tailPts[tailPts.length - 1];
            tailPts.push(add(last, [0, Math.sin(dirAngle) * step, -Math.cos(dirAngle) * step]));
            // A drooping tail hangs ever lower; a carried one curls forward over the back.
            dirAngle += (r.tail === 'curly' ? 70 : r.tailCurl > 0 ? 18 * r.tailCurl : 11 * r.tailCurl) * DEG;
        }
        // A long tail that reaches the ground lies along it.
        for (const p of tailPts) p[1] = Math.max(p[1], 0.05 * r.tailThickness * g);
        J.tail = tailPts;
        // Wings: from the top of the shoulders, held half open, up and back.
        if (r.wings !== 'none' && r.wingSize > 0) {
            const ws = r.wingSize * Math.max(0.8, bl);
            const root = [halfW * 0.7, yS + 0.08 * g + depth * 0.85, 0.32 * bl];
            const elbow = add(root, [0.32 * ws, 0.26 * ws, -0.12 * ws]);
            const wrist = add(elbow, [0.36 * ws, 0.12 * ws, 0.08 * ws]);
            // Finger tips fan from the wrist out, down and back to the flank.
            const tips = [
                add(wrist, [0.42 * ws, 0.08 * ws, -0.1 * ws]),
                add(wrist, [0.38 * ws, -0.18 * ws, -0.32 * ws]),
                add(wrist, [0.2 * ws, -0.36 * ws, -0.5 * ws]),
                add(wrist, [-0.05 * ws, -0.4 * ws, -0.62 * ws])
            ];
            // Where the membrane meets the body: along the flank, from the root back.
            const flank = [halfW * 0.85, yS + 0.08 * g + depth * 0.4, -0.35 * bl];
            J.wing = { root, elbow, wrist, tips, flank };
        }
        return { J, depth, spineF, spineR, halfW, g, bl, L, ht, lt, yS, yH };
    }

    function bonesOf(lay) {
        const { J } = lay;
        const bones = [];
        const addBone = (name, parent, head, tail) => { bones.push({ name, parent: parent == null ? -1 : bones.findIndex(b => b.name === parent), head, tail }); };
        // Hips, Spine and Chest as the Rig tool lays them: hips to the neck base at 0.4 and 0.75.
        addBone('Hips', null, J.hips, lerp(J.hips, J.neck, 0.4));
        addBone('Spine', 'Hips', lerp(J.hips, J.neck, 0.4), lerp(J.hips, J.neck, 0.75));
        addBone('Chest', 'Spine', lerp(J.hips, J.neck, 0.75), J.neck);
        addBone('Neck', 'Chest', J.neck, J.atlas);
        addBone('Head', 'Neck', J.atlas, J.snoutTip);
        const tail = J.tail;
        if (tail.length > 1 && len(sub(tail[tail.length - 1], tail[0])) > 1e-4) {
            // Three tail bones over the six segments.
            addBone('Tail', 'Hips', tail[0], tail[2]);
            addBone('Tail2', 'Tail', tail[2], tail[4]);
            addBone('Tail3', 'Tail2', tail[4], tail[6]);
        }
        if (J.wing) for (const side of ['Left', 'Right']) {
            const m = side === 'Left' ? p => p : mirror;
            addBone(side + 'Wing', 'Chest', m(J.wing.root), m(J.wing.wrist));
        }
        for (const side of ['Left', 'Right']) {
            const m = side === 'Left' ? p => p : mirror;
            addBone(side + 'FrontUpperLeg', 'Chest', m(J.shoulder), m(J.frontKnee));
            addBone(side + 'FrontLowerLeg', side + 'FrontUpperLeg', m(J.frontKnee), m(J.frontAnkle));
            addBone(side + 'FrontFoot', side + 'FrontLowerLeg', m(J.frontAnkle), m([J.frontAnkle[0], 0, J.frontAnkle[2]]));
            addBone(side + 'RearUpperLeg', 'Hips', m(J.hip), m(J.rearKnee));
            addBone(side + 'RearLowerLeg', side + 'RearUpperLeg', m(J.rearKnee), m(J.rearAnkle));
            addBone(side + 'RearFoot', side + 'RearLowerLeg', m(J.rearAnkle), m([J.rearAnkle[0], 0, J.rearAnkle[2]]));
        }
        return bones;
    }

    /** The implicit shapes, each bound to a bone, in body units. */
    function shapesOf(r, lay) {
        const { J, depth, spineF, spineR, g, bl, lt, ht, yS } = lay;
        const S = [];
        const kBody = 0.12 * g;
        // Torso: chest, belly, rump, joined along the spine.
        const chestC = [0, yS + 0.08 * g, 0.3 * bl];
        S.push(ellipsoid(chestC, [0.19 * g, depth, 0.34 * Math.max(0.6, bl)], 'Chest', kBody, 'torso'));
        const bellySag = r.belly * 0.07 * g;
        const bellyC = [0, (chestC[1] + spineR[1] - 0.22 * g) / 2 - bellySag, -0.04 * bl];
        S.push(ellipsoid(bellyC, [0.18 * g * (1 + Math.max(0, r.belly) * 0.25), (depth * 0.7 + 0.16 * g) / 2 * (1 + 0.35 * r.belly), 0.46 * bl], 'Spine', kBody, 'belly'));
        const rumpC = [0, spineR[1] - 0.19 * g, -0.4 * bl];
        S.push(ellipsoid(rumpC, [0.17 * g, 0.2 * g, 0.24 * Math.max(0.7, bl)], 'Hips', kBody, 'rump'));
        S.push(cone(add(spineR, [0, -0.06 * g, 0]), add(spineF, [0, -0.06 * g, 0]), 0.1 * g, 0.11 * g, 'Spine', kBody, 'back'));
        if (r.hump > 0) S.push(ellipsoid(add(spineF, [0, 0.02 * g, -0.06]), [0.12 * g, 0.12 * g * r.hump, 0.2 * Math.max(0.7, bl)], 'Chest', kBody, 'hump'));
        // Neck.
        const nt = r.neckThickness * g;
        S.push(cone(add(J.neck, [0, -0.04 * g, -0.06]), J.atlas, 0.17 * nt, 0.1 * nt * Math.max(0.7, ht), 'Neck', 0.1 * g, 'neck'));
        // Head: skull, snout, jaw, nose pad.
        const sr = J.skullR, hd = J.hdir, sw = r.snoutWidth;
        S.push(ellipsoid(J.skull, [sr * 0.95, sr * 0.9, sr * 1.05], 'Head', 0.05 * ht, 'skull', hd));
        const snoutBase = add(J.skull, mul(hd, sr * 0.4));
        const tipR = sr * 0.5 * sw;
        S.push(cone(snoutBase, J.snoutTip, sr * 0.72 * sw, tipR, 'Head', 0.08 * ht, 'snout'));
        const jawDrop = [0, -sr * 0.32, 0];
        const longFace = Math.max(0, r.snoutLength - 1);
        S.push(cone(add(snoutBase, add(jawDrop, mul(hd, -sr * 0.2))), add(J.snoutTip, add(jawDrop, mul(hd, -tipR * 0.6))), sr * (0.42 + 0.12 * longFace) * sw, tipR * 0.6, 'Head', 0.05 * ht, 'jaw'));
        // Cheeks and jowls: broad on a cat, deep on a long-faced horse.
        S.push(ellipsoid(add(J.skull, add(mul(hd, sr * (0.25 + 0.2 * longFace)), [0, -sr * (0.25 + 0.15 * longFace), 0])), [sr * 0.85 * Math.max(0.7, sw), sr * (0.55 + 0.22 * longFace), sr * (0.6 + 0.25 * longFace)], 'Head', 0.06 * ht, 'cheek', hd));
        // The muzzle's end: a rounded nose.
        S.push(ellipsoid(add(J.snoutTip, mul(hd, -tipR * 0.35)), [tipR * 1.05, tipR * (0.9 + 0.15 * longFace), tipR * 0.9], 'Head', 0.04 * ht, 'snout', hd));
        // Legs: thick at the top, a joint at each end, paws or hooves at the foot.
        const legT = 0.066 * g * lt;
        for (const side of [1, -1]) {
            const m = side > 0 ? p => p : mirror;
            const L = side > 0 ? 'Left' : 'Right';
            S.push(cone(add(m(J.shoulder), [0, 0.06 * g, 0]), m(J.frontKnee), legT * 1.7, legT * 1.05, L + 'FrontUpperLeg', 0.08 * g, 'upperleg'));
            S.push(cone(m(J.frontKnee), m(J.frontAnkle), legT * 1.0, legT * 0.72, L + 'FrontLowerLeg', 0.03 * g, 'lowerleg'));
            S.push(cone(add(m(J.hip), [0, 0.04 * g, 0.02]), m(J.rearKnee), legT * 2.3, legT * 1.2, L + 'RearUpperLeg', 0.1 * g, 'thigh'));
            S.push(cone(m(J.rearKnee), m(J.rearAnkle), legT * 1.15, legT * 0.7, L + 'RearLowerLeg', 0.03 * g, 'lowerleg'));
            for (const [ankle, toe, bone] of [[J.frontAnkle, J.frontToe, L + 'FrontFoot'], [J.rearAnkle, J.rearToe, L + 'RearFoot']]) {
                const ps = r.pawSize;
                if (r.feet === 'hoof') {
                    const base = [ankle[0], 0.045 * ps, ankle[2] + 0.015];
                    S.push(cone(m(ankle), m(base), legT * 0.7, legT * 0.72 * ps, bone, 0.02 * g, 'pastern'));
                    S.push(cone(m([base[0], 0.05 * ps, base[2]]), m([base[0], 0.012, base[2] + 0.01]), legT * 0.78 * ps, legT * 0.92 * ps, bone, 0.01, 'hoof'));
                } else {
                    const pawR = legT * 0.95 * ps;
                    const pawC = [toe[0], pawR * 0.75, (ankle[2] * 0.25 + toe[2] * 0.75)];
                    S.push(cone(m(ankle), m(pawC), legT * 0.68, pawR * 0.8, bone, 0.03 * g, 'pastern'));
                    S.push(ellipsoid(m(pawC), [pawR * 1.05, pawR * 0.75, pawR * (1.25 + 0.5 * r.plantigrade)], bone, 0.03 * g, 'paw'));
                }
            }
        }
        // Manes: a lion's around the head and neck, a horse's crest along the neck top, a ruff at the throat.
        if (r.mane !== 'none' && r.maneSize > 0) {
            const ms = r.maneSize;
            if (r.mane === 'lion') {
                S.push(ellipsoid(lerp(J.atlas, J.skull, 0.25), [sr * 1.45 * ms + sr * 0.3, sr * 1.5 * ms + sr * 0.3, sr * 1.0 * ms + sr * 0.2], 'Head', 0.1 * g, 'mane', sub(J.atlas, J.neck)));
                S.push(cone(J.neck, J.atlas, 0.2 * nt * (0.7 + 0.5 * ms), 0.19 * nt * (0.7 + 0.5 * ms), 'Neck', 0.1 * g, 'mane'));
            } else if (r.mane === 'horse') {
                const up = norm(cross(sub(J.atlas, J.neck), [1, 0, 0]));
                for (let i = 0; i < 5; i++) {
                    const t0 = i / 5, t1 = (i + 1) / 5;
                    const a = add(lerp(J.neck, J.atlas, t0), mul(up, -0.11 * nt)), b = add(lerp(J.neck, J.atlas, t1), mul(up, -0.09 * nt));
                    S.push(ellipsoid(lerp(a, b, 0.5), [0.035 * ms + 0.01, 0.06 * ms + 0.02, len(sub(b, a)) * 0.7], 'Neck', 0.03, 'mane', sub(b, a)));
                }
            } else {
                S.push(ellipsoid(lerp(J.neck, J.atlas, 0.45), [0.2 * nt * (0.8 + 0.4 * ms), 0.2 * nt * (0.8 + 0.4 * ms), 0.16 * nt * (0.8 + 0.3 * ms)], 'Neck', 0.12 * g, 'mane', sub(J.atlas, J.neck)));
            }
        }
        return S;
    }

    // ── lofted pieces ──────────────────────────────────────────────────────
    /**
     * A tube along `path`, each ring an ellipse (`radius(t)` → [across, through]),
     * flattened across `flat` (a direction, or null for round), with a cone cap at
     * the end. Returns { positions, index, t (per vertex 0..1 along the path) }.
     */
    function loft(path, radius, sides, flat, startCap) {
        const n = path.length;
        const positions = [], index = [], tv = [];
        // Frames: tangent, and a normal carried along so rings do not twist.
        let prevN = null;
        const rings = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            const tan = norm(i === 0 ? sub(path[1], path[0]) : i === n - 1 ? sub(path[n - 1], path[n - 2]) : sub(path[i + 1], path[i - 1]));
            let N;
            if (flat) N = norm(sub(flat, mul(tan, dot(flat, tan))));
            else if (prevN) N = norm(sub(prevN, mul(tan, dot(prevN, tan))));
            else { N = cross(tan, [0, 1, 0]); if (len(N) < 1e-4) N = cross(tan, [1, 0, 0]); N = norm(N); }
            if (!len(N) || !Number.isFinite(N[0])) N = [1, 0, 0];
            prevN = N;
            const B = norm(cross(tan, N));
            const [ra, rb] = radius(t);
            const ring = [];
            for (let k = 0; k < sides; k++) {
                const a = (k / sides) * Math.PI * 2;
                // Across N is the wide way (ra), along B the thin way (rb).
                ring.push(positions.length / 3);
                const p = add(path[i], add(mul(N, Math.cos(a) * ra), mul(B, Math.sin(a) * rb)));
                positions.push(p[0], p[1], p[2]);
                tv.push(t);
            }
            rings.push(ring);
        }
        for (let i = 0; i + 1 < n; i++) for (let k = 0; k < sides; k++) {
            const a = rings[i][k], b = rings[i][(k + 1) % sides], c = rings[i + 1][k], d = rings[i + 1][(k + 1) % sides];
            index.push(a, b, c, b, d, c);
        }
        // The far end closes on a point a little past the last ring.
        const endTan = norm(sub(path[n - 1], path[n - 2]));
        const [era] = radius(1);
        const tip = add(path[n - 1], mul(endTan, Math.max(era, 1e-4) * 0.6));
        const tipIndex = positions.length / 3;
        positions.push(tip[0], tip[1], tip[2]); tv.push(1);
        for (let k = 0; k < sides; k++) index.push(rings[n - 1][k], rings[n - 1][(k + 1) % sides], tipIndex);
        if (startCap) {
            const st = norm(sub(path[0], path[1]));
            const [sra] = radius(0);
            const sp = add(path[0], mul(st, sra * 0.4));
            const si = positions.length / 3;
            positions.push(sp[0], sp[1], sp[2]); tv.push(0);
            for (let k = 0; k < sides; k++) index.push(rings[0][k], si, rings[0][(k + 1) % sides]);
        }
        return { positions, index, t: tv };
    }

    /** A smooth path through control points (Catmull-Rom), `count` points. */
    function curve(points, count) {
        const out = [];
        const n = points.length;
        for (let i = 0; i < count; i++) {
            const u = (i / (count - 1)) * (n - 1);
            const k = Math.min(n - 2, Math.floor(u)), t = u - k;
            const p0 = points[Math.max(0, k - 1)], p1 = points[k], p2 = points[k + 1], p3 = points[Math.min(n - 1, k + 2)];
            const t2 = t * t, t3 = t2 * t;
            out.push([0, 1, 2].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
        }
        return out;
    }

    /** A spiral (a ram's horn) about an axis through `center`. */
    function spiral(center, axis, start, turns, shrink, count) {
        const ax = norm(axis);
        let r0 = sub(start, center);
        r0 = sub(r0, mul(ax, dot(r0, ax)));
        const R = len(r0), u = norm(r0), v = norm(cross(ax, u));
        const out = [];
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1), a = t * turns * Math.PI * 2, rad = R * (1 - shrink * t);
            out.push(add(center, add(add(mul(u, Math.cos(a) * rad), mul(v, Math.sin(a) * rad)), mul(ax, t * R * 0.9))));
        }
        return out;
    }

    /**
     * The lofted pieces: ears, tail, horns, tusks, spines. Each { mesh, kind
     * ('coat'|'horn'), weights: (t) → [[bone, w], …], tag }.
     */
    function loftsOf(r, lay) {
        const { J, g, ht } = lay;
        const out = [];
        const sr = J.skullR, hd = J.hdir;
        const rigid = bone => () => [[bone, 1]];
        // Ears.
        if (r.ears !== 'none' && r.earSize > 0) {
            const es = r.earSize * ht;
            const spec = {
                pointed: { len: 0.13, wide: 0.075, tip: 0.0, out: 0.55, up: 0.85, back: -0.1 },
                round: { len: 0.07, wide: 0.06, tip: 0.6, out: 0.75, up: 0.7, back: 0.05 },
                floppy: { len: 0.16, wide: 0.07, tip: 0.6, out: 1, up: 0.0, back: 0.1, droop: 1.3 },
                long: { len: 0.3, wide: 0.06, tip: 0.45, out: 0.3, up: 1, back: 0.25 },
                narrow: { len: 0.13, wide: 0.045, tip: 0.1, out: 0.85, up: 0.6, back: 0.2 },
                small: { len: 0.06, wide: 0.04, tip: 0.2, out: 0.8, up: 0.5, back: 0.4 }
            }[r.ears];
            for (const side of [1, -1]) {
                const base = add(J.skull, [side * sr * 0.5, sr * 0.72, -sr * 0.2]);
                const droop = (spec.droop || 0) + r.earDroop;
                const dir = norm([side * spec.out, spec.up - droop * 0.9, -spec.back - Math.max(0, droop) * 0.15]);
                const L = spec.len * es;
                const pts = curve([base, add(base, mul(dir, L * 0.5)), add(add(base, mul(dir, L)), [0, -Math.max(0, droop) * L * 0.25, 0])], 7);
                // Flat across the head's forward direction turned out to the side: the ear faces forward.
                const flatDir = norm([side * 0.25, 0, 1]);
                const mesh = loft(pts, t => {
                    const w = spec.wide * es * (t < 0.35 ? 0.8 + t * 0.6 : (1 - t) / 0.65 * (1 - spec.tip) + spec.tip * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.35) / 0.65, 2))));
                    return [Math.max(w, 0.003 * es), Math.max(0.012 * es, w * 0.18)];
                }, 8, flatDir, false);
                out.push({ mesh, kind: 'coat', weights: rigid('Head'), tag: 'ear' });
            }
        }
        // Tail.
        const tail = J.tail;
        if (r.tail !== 'none' && tail.length > 1 && len(sub(tail[tail.length - 1], tail[0])) > 1e-3) {
            const tt = r.tailThickness * g;
            const pts = curve(tail, 16);
            const bushy = r.tail === 'bushy', horse = r.tail === 'horse', thick = r.tail === 'thick';
            const radius = t => {
                let rr;
                if (bushy) rr = 0.03 * tt + 0.05 * tt * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.25 * t);
                else if (horse) rr = 0.035 * tt + 0.06 * tt * smooth(0.05, 0.4, t) * (1 - 0.5 * t);
                else if (thick) rr = 0.085 * tt * (1 - t * 0.92) + 0.005;
                else if (r.tail === 'stub') rr = 0.06 * tt * (1 - 0.6 * t);
                else rr = 0.04 * tt * (1 - t * 0.55);
                return horse ? [rr * 1.3, rr * 0.6] : [rr, rr];
            };
            const mesh = loft(pts, radius, 10, horse ? [1, 0, 0] : null, true);
            const names = ['Tail', 'Tail2', 'Tail3'];
            const w = t => {
                const u = clamp(t * 3 - 0.5, 0, 2);
                const i = Math.floor(u), f = u - i;
                if (t < 0.15) return [['Hips', 1 - t / 0.15], ['Tail', t / 0.15]];
                if (i >= 2) return [[names[2], 1]];
                return [[names[i], 1 - f], [names[i + 1], f]];
            };
            out.push({ mesh, kind: r.tail === 'horse' || r.tail === 'bushy' ? 'hair' : 'coat', weights: w, tag: 'tail' });
            if (r.tail === 'tufted') {
                const end = tail[tail.length - 1];
                const tuft = curve([lerp(tail[tail.length - 2], end, 0.4), end, add(end, mul(norm(sub(end, tail[tail.length - 2])), 0.08 * tt))], 6);
                out.push({ mesh: loft(tuft, t => { const v = 0.05 * tt * Math.sin(Math.PI * clamp(t * 1.15, 0, 1)) + 0.004; return [v, v]; }, 10, null, true), kind: 'hair', weights: () => [['Tail3', 1]], tag: 'tail' });
            }
        }
        // Horns.
        const hs = r.hornSize * ht;
        if (r.horns !== 'none' && hs > 0) {
            const hornTube = (pts, r0, r1, sides = 10) => loft(pts, t => { const v = r0 + (r1 - r0) * t; return [v, v]; }, sides, null, true);
            const top = J.skull;
            for (const side of [1, -1]) {
                const s = p => [p[0] * side, p[1], p[2]];
                const base = add(top, s([sr * 0.5, sr * 0.72, sr * 0.05]));
                if (r.horns === 'bull') {
                    const pts = curve([base, add(base, s([0.12 * hs, 0.01 * hs, 0])), add(base, s([0.2 * hs, 0.07 * hs, 0.05 * hs])), add(base, s([0.23 * hs, 0.15 * hs, 0.08 * hs]))], 12);
                    out.push({ mesh: hornTube(pts, 0.028 * hs, 0.004), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                } else if (r.horns === 'ram') {
                    const center = add(top, s([sr * 0.85, sr * 0.1, -sr * 0.35]));
                    const pts = spiral(center, s([1, 0, 0.1]), add(base, s([0, 0.02, -0.02])), 1.15 * clamp(hs, 0.4, 2), 0.55, 22).map(p => add(center, mul(sub(p, center), Math.max(0.5, hs))));
                    out.push({ mesh: hornTube(pts, 0.04 * hs, 0.008), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                } else if (r.horns === 'goat') {
                    const pts = curve([base, add(base, s([0.02, 0.12 * hs, -0.06 * hs])), add(base, s([0.05 * hs, 0.17 * hs, -0.2 * hs])), add(base, s([0.07 * hs, 0.12 * hs, -0.3 * hs]))], 12);
                    out.push({ mesh: hornTube(pts, 0.024 * hs, 0.003), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                } else if (r.horns === 'dragon') {
                    for (const [k, size] of [[0, 1], [1, 0.55]]) {
                        const b = add(base, s([k * 0.02, -k * sr * 0.4, -k * sr * 0.3]));
                        const pts = curve([b, add(b, s([0.03 * hs * size, 0.1 * hs * size, -0.12 * hs * size])), add(b, s([0.05 * hs * size, 0.15 * hs * size, -0.32 * hs * size])), add(b, s([0.06 * hs * size, 0.22 * hs * size, -0.45 * hs * size]))], 12);
                        out.push({ mesh: hornTube(pts, 0.03 * hs * size, 0.003), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                    }
                } else if (r.horns === 'antlers') {
                    // A main beam up and back, curving forward, with tines off its front.
                    const b = add(base, s([0, 0.0, -0.01]));
                    const beam = curve([b, add(b, s([0.08 * hs, 0.12 * hs, -0.06 * hs])), add(b, s([0.18 * hs, 0.28 * hs, -0.04 * hs])), add(b, s([0.2 * hs, 0.42 * hs, 0.06 * hs])), add(b, s([0.16 * hs, 0.52 * hs, 0.12 * hs]))], 16);
                    out.push({ mesh: hornTube(beam, 0.018 * hs, 0.005, 8), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                    for (const [at, l, lift] of [[0.15, 0.12, 0.6], [0.45, 0.14, 1], [0.7, 0.12, 1.1], [0.88, 0.09, 1]]) {
                        const i = Math.round(at * (beam.length - 1));
                        const p = beam[i];
                        const tine = curve([p, add(p, s([0.0, 0.05 * hs * lift, 0.05 * hs])), add(p, s([-0.01 * hs, l * hs * lift, l * hs * 0.55]))], 6);
                        out.push({ mesh: hornTube(tine, 0.011 * hs, 0.003, 7), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
                    }
                }
            }
            if (r.horns === 'unicorn') {
                const b = add(J.skull, add(mul(hd, sr * 0.55), [0, sr * 0.65, 0]));
                const dir = norm(add(mul(hd, 0.75), [0, 0.9, 0]));
                const pts = curve([b, add(b, mul(dir, 0.2 * hs)), add(b, mul(dir, 0.42 * hs))], 14);
                const mesh = loft(pts, t => { const v = (0.028 * (1 - t) + 0.002) * hs * (1 + 0.12 * Math.sin(t * 40)); return [v, v]; }, 10, null, true);
                out.push({ mesh, kind: 'horn', weights: rigid('Head'), tag: 'horn' });
            } else if (r.horns === 'rhino') {
                const b = add(lerp(J.skull, J.snoutTip, 0.82), [0, sr * 0.3, 0]);
                const pts = curve([b, add(b, [0, 0.12 * hs, 0.03 * hs]), add(b, [0, 0.22 * hs, -0.02 * hs])], 10);
                out.push({ mesh: hornTube(pts, 0.05 * hs, 0.004), kind: 'horn', weights: rigid('Head'), tag: 'horn' });
            }
        }
        // Tusks: out of the lower jaw near the snout tip, up and back.
        if (r.tuskSize > 0) {
            const ts = r.tuskSize * ht;
            for (const side of [1, -1]) {
                const b = add(lerp(J.skull, J.snoutTip, 0.78), [side * sr * 0.32 * r.snoutWidth, -sr * 0.32, 0]);
                const pts = curve([b, add(b, [side * 0.03 * ts, 0.04 * ts, 0.02 * ts]), add(b, [side * 0.05 * ts, 0.09 * ts, -0.02 * ts])], 8);
                out.push({ mesh: loft(pts, t => { const v = (0.016 * (1 - t) + 0.002) * ts; return [v, v]; }, 8, null, true), kind: 'horn', weights: rigid('Head'), tag: 'tusk' });
            }
        }
        // Back spines: a row of cones from the head down the neck, the back and the tail.
        if (r.spines > 0) {
            const sp = r.spines * g;
            const line = [...curve([J.atlas, lerp(J.atlas, J.neck, 0.5), J.neck], 6), ...curve([lay.spineF, lerp(lay.spineF, lay.spineR, 0.5), lay.spineR], 8), ...(J.tail.length > 1 ? curve(J.tail, 8) : [])];
            const boneAt = i => (i < 6 ? 'Neck' : i < 10 ? 'Chest' : i < 14 ? 'Spine' : i < 16 ? 'Hips' : i < 19 ? 'Tail' : i < 21 ? 'Tail2' : 'Tail3');
            line.forEach((p, i) => {
                if (i % 1) return;
                const fade = i >= 14 ? 1 - (i - 14) / Math.max(1, line.length - 14) * 0.7 : 1;
                const h = 0.07 * sp * fade, w = 0.022 * sp * fade;
                // Out of the body: a little below the line, leaning back.
                const b = add(p, [0, -h * 0.25, 0]);
                const pts = [b, add(b, [0, h * 0.6, -h * 0.25]), add(b, [0, h, -h * 0.55])];
                out.push({ mesh: loft(pts, t => [w * (1 - t) + 0.001, w * 0.45 * (1 - t) + 0.001], 6, [0, 0, 1], false), kind: 'horn', weights: () => [[boneAt(i), 1]], tag: 'spine' });
            });
        }
        return out;
    }

    /**
     * One wing (the left; the right is its mirror): the arm and fingers as
     * thin tubes, and the membrane as panels between the fingers and down to
     * the flank, scalloped (bat) or ragged with feather tips (feathered).
     * Vertices carry [x, y, z], a color key and how far out on the wing they
     * are (0 at the body).
     */
    function wingOf(r, lay) {
        const W = lay.J.wing, g = lay.g, ws = r.wingSize * Math.max(0.8, lay.bl);
        const positions = [], index = [], tone = [], reach = [];
        const bodyLine = [W.root, W.flank];
        const outFromBody = p => {
            const ab = sub(bodyLine[1], bodyLine[0]), t = clamp(dot(sub(p, bodyLine[0]), ab) / dot(ab, ab), 0, 1);
            return len(sub(p, add(bodyLine[0], mul(ab, t))));
        };
        const put = (p, key) => { positions.push(p[0], p[1], p[2]); tone.push(key); reach.push(outFromBody(p)); return positions.length / 3 - 1; };
        const tube = (pts, r0, r1) => {
            const m = loft(pts, t => { const v = r0 + (r1 - r0) * t; return [v, v]; }, 6, null, true);
            const base = positions.length / 3;
            for (let i = 0; i < m.positions.length; i += 3) put([m.positions[i], m.positions[i + 1], m.positions[i + 2]], 'bone');
            for (const q of m.index) index.push(q + base);
        };
        const arm = curve([W.root, W.elbow, W.wrist], 10);
        tube(arm, 0.03 * g * ws, 0.016 * g * ws);
        const fingers = W.tips.map((tip, i) => curve([W.wrist, add(lerp(W.wrist, tip, 0.55), [0, 0.03 * ws * (1 - i * 0.3), 0]), tip], 10));
        for (const f of fingers) tube(f, 0.012 * g * ws, 0.003);
        const feathered = r.wings === 'feathered';
        // A panel between two lines of the same count: a grid across, the far edge pulled in between the tips.
        const panel = (A, B, cols, sag, key) => {
            const rows = A.length;
            const grid = [];
            for (let i = 0; i < rows; i++) {
                const row = [];
                for (let j = 0; j <= cols; j++) {
                    const u = j / cols;
                    let p = lerp(A[i], B[i], u);
                    const far = i / (rows - 1);
                    let pull = sag * Math.sin(Math.PI * u) * far * far;
                    if (feathered) pull -= 0.05 * far * far * (((j % 2) ? 1 : 0) - 0.3);
                    p = lerp(p, W.wrist, clamp(pull, -0.2, 0.6));
                    row.push(put(p, key(far, u)));
                }
                grid.push(row);
            }
            for (let i = 0; i + 1 < rows; i++) for (let j = 0; j < cols; j++) {
                const a = grid[i][j], b2 = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1];
                index.push(a, c, b2, b2, c, d);
            }
        };
        const feather = (far, u) => (feathered ? (far > 0.55 ? (Math.floor(u * 8) % 2 ? 'marking' : 'flight') : 'coat') : 'membrane');
        for (let k = 0; k + 1 < fingers.length; k++) panel(fingers[k], fingers[k + 1], feathered ? 8 : 4, feathered ? 0.05 : 0.22, feather);
        // From the last finger down to the flank, and the fold under the arm.
        const side = curve([W.root, lerp(W.root, W.flank, 0.5), W.flank], fingers[0].length);
        panel(fingers[fingers.length - 1].map((p, i) => p), side.map(p => p), feathered ? 8 : 5, feathered ? 0.05 : 0.18, feather);
        const fold = [put(W.root, feathered ? 'coat' : 'membrane'), put(W.elbow, feathered ? 'coat' : 'membrane'), put(W.wrist, feathered ? 'coat' : 'membrane')];
        index.push(fold[0], fold[1], fold[2]);
        // The membrane between the arm's line and the panel's first row (root to wrist).
        return { positions, index, tone, reach, ws };
    }

    // ── surface nets over the shapes ───────────────────────────────────────
    function surfaceNet(shapes, cell, fieldNoise) {
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        let margin = 0;
        for (const s of shapes) { margin = Math.max(margin, s.k); for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], s.lo[i]); hi[i] = Math.max(hi[i], s.hi[i]); } }
        const pad = margin + cell * 3 + (fieldNoise ? fieldNoise.amp : 0);
        lo = lo.map(v => v - pad); hi = hi.map(v => v + pad);
        lo[1] = Math.max(lo[1], -cell * 2);
        const X = Math.ceil((hi[0] - lo[0]) / cell) + 1, Y = Math.ceil((hi[1] - lo[1]) / cell) + 1, Z = Math.ceil((hi[2] - lo[2]) / cell) + 1;
        const values = new Float32Array(X * Y * Z).fill(1e3);
        const id = (i, j, k) => (k * Y + j) * X + i;
        // Each shape writes only the grid points its blend can reach.
        for (const s of shapes) {
            const reach = s.k + cell * 2 + (fieldNoise ? fieldNoise.amp : 0);
            const i0 = Math.max(0, Math.floor((s.lo[0] - reach - lo[0]) / cell)), i1 = Math.min(X - 1, Math.ceil((s.hi[0] + reach - lo[0]) / cell));
            const j0 = Math.max(0, Math.floor((s.lo[1] - reach - lo[1]) / cell)), j1 = Math.min(Y - 1, Math.ceil((s.hi[1] + reach - lo[1]) / cell));
            const k0 = Math.max(0, Math.floor((s.lo[2] - reach - lo[2]) / cell)), k1 = Math.min(Z - 1, Math.ceil((s.hi[2] + reach - lo[2]) / cell));
            const p = [0, 0, 0];
            for (let k = k0; k <= k1; k++) { p[2] = lo[2] + k * cell; for (let j = j0; j <= j1; j++) { p[1] = lo[1] + j * cell; for (let i = i0; i <= i1; i++) {
                p[0] = lo[0] + i * cell;
                const at = id(i, j, k);
                values[at] = smin(values[at], shapeDistance(s, p), s.k);
            } } }
        }
        // Fur: the field roughened near the surface.
        if (fieldNoise && fieldNoise.amp > 0) {
            for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) {
                const at = id(i, j, k), v = values[at];
                if (Math.abs(v) > fieldNoise.amp * 2 + cell * 2) continue;
                const x = lo[0] + i * cell, y = lo[1] + j * cell, z = lo[2] + k * cell;
                values[at] = v - fieldNoise.amp * fieldNoise.at(x, y, z);
            }
        }
        // Nothing below the floor: the soles are cut flat.
        for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) {
            const y = lo[1] + j * cell;
            if (y >= 0) continue;
            for (let i = 0; i < X; i++) { const at = id(i, j, k); values[at] = Math.max(values[at], -y); }
        }
        const cubeVertex = new Int32Array((X - 1) * (Y - 1) * (Z - 1)).fill(-1);
        const verts = [];
        const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
        const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
        const v = new Float64Array(8);
        const vertexOf = (i, j, k) => {
            const key = (k * (Y - 1) + j) * (X - 1) + i;
            if (cubeVertex[key] >= 0) return cubeVertex[key];
            for (let c = 0; c < 8; c++) v[c] = values[id(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))];
            let sx = 0, sy = 0, sz = 0, n = 0;
            for (const [a, b] of edges) {
                if ((v[a] < 0) === (v[b] < 0)) continue;
                const t = v[a] / (v[a] - v[b]);
                const pa = corners[a], pb = corners[b];
                sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
            }
            verts.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
            cubeVertex[key] = verts.length / 3 - 1;
            return cubeVertex[key];
        };
        const index = [];
        const quad = (a, b, c, d, flip) => {
            // Split along the shorter diagonal.
            const P = q => [verts[q * 3], verts[q * 3 + 1], verts[q * 3 + 2]];
            const ac = len(sub(P(a), P(c))), bd = len(sub(P(b), P(d)));
            const t = ac < bd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
            if (flip) for (let q = 0; q < 6; q += 3) { const x = t[q + 1]; t[q + 1] = t[q + 2]; t[q + 2] = x; }
            index.push(...t);
        };
        for (let k = 1; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
            const here = values[id(i, j, k)];
            const inside = here < 0;
            // Edge along x: the cubes round it in y and z.
            if (i < X - 1 && (values[id(i + 1, j, k)] < 0) !== inside) quad(vertexOf(i, j - 1, k - 1), vertexOf(i, j, k - 1), vertexOf(i, j, k), vertexOf(i, j - 1, k), !inside);
            if (j < Y - 1 && (values[id(i, j + 1, k)] < 0) !== inside) quad(vertexOf(i - 1, j, k - 1), vertexOf(i - 1, j, k), vertexOf(i, j, k), vertexOf(i, j, k - 1), !inside);
            if (k < Z - 1 && (values[id(i, j, k + 1)] < 0) !== inside) quad(vertexOf(i - 1, j - 1, k), vertexOf(i, j - 1, k), vertexOf(i, j, k), vertexOf(i - 1, j, k), !inside);
        }
        return { positions: new Float32Array(verts), index };
    }

    /** One pass of neighbor averaging (the surface nets' stair steps eased), floor kept. */
    function relaxMesh(positions, index, passes) {
        const n = positions.length / 3;
        const nb = Array.from({ length: n }, () => new Set());
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t], b = index[t + 1], c = index[t + 2];
            nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
        }
        let p = positions;
        for (let pass = 0; pass < passes; pass++) {
            const q = new Float32Array(p.length);
            for (let v = 0; v < n; v++) {
                let x = 0, y = 0, z = 0;
                for (const u of nb[v]) { x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2]; }
                const c = nb[v].size || 1;
                q[v * 3] = p[v * 3] * 0.5 + x / c * 0.5;
                q[v * 3 + 1] = p[v * 3 + 1] < 1e-4 ? p[v * 3 + 1] : p[v * 3 + 1] * 0.5 + y / c * 0.5;
                q[v * 3 + 2] = p[v * 3 + 2] * 0.5 + z / c * 0.5;
            }
            p = q;
        }
        return p;
    }

    function faceNormals(positions, index) {
        const n = new Float32Array(positions.length);
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { n[s] += nx; n[s + 1] += ny; n[s + 2] += nz; }
        }
        for (let i = 0; i < n.length; i += 3) {
            const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
            n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
        }
        return n;
    }

    /** A UV sphere. */
    function sphere(c, rad, rows, cols) {
        const positions = [], index = [];
        for (let i = 0; i <= rows; i++) {
            const th = (i / rows) * Math.PI;
            for (let j = 0; j <= cols; j++) {
                const ph = (j / cols) * Math.PI * 2;
                positions.push(c[0] + rad * Math.sin(th) * Math.cos(ph), c[1] + rad * Math.cos(th), c[2] + rad * Math.sin(th) * Math.sin(ph));
            }
        }
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const a = i * (cols + 1) + j, b = a + cols + 1;
            index.push(a, a + 1, b, a + 1, b + 1, b);
        }
        return { positions, index };
    }

    // ── coat ───────────────────────────────────────────────────────────────
    /**
     * The coat color at a body point. `info` says where it is: the nearest
     * shape's tag and how high, how far down the body side, how far out on
     * a leg.
     */
    function coatColor(r, lay, p, n, tag, C) {
        const { J, g } = lay;
        const seed = r.seed % 1000;
        const ps = r.patternScale, amt = r.patternAmount;
        let col = C.coat;
        // Where the torso's middle line runs at this point.
        const torsoMid = lerp([0, J.hip[1] + 0.15 * g, J.hip[2]], [0, J.shoulder[1] + 0.15 * g, J.shoulder[2]], clamp((p[2] - J.hip[2]) / (J.shoulder[2] - J.hip[2]), 0, 1));
        const under = clamp(-n[1], 0, 1);
        const onLeg = tag === 'upperleg' || tag === 'thigh' || tag === 'lowerleg' || tag === 'pastern' || tag === 'paw' || tag === 'hoof';
        const lowLeg = tag === 'lowerleg' || tag === 'pastern' || tag === 'paw' || tag === 'hoof';
        const onHead = tag === 'skull' || tag === 'snout' || tag === 'jaw' || tag === 'cheek' || tag === 'ear';
        const belly = smooth(0.15, 0.75, under) * (p[1] < torsoMid[1] ? 1 : 0.3);
        const muzzle = (tag === 'jaw' ? 1 : 0) + (tag === 'snout' ? smooth(0.1, 0.9, under) : 0);
        const throat = tag === 'neck' ? smooth(0.2, 0.8, under) : 0;
        const pat = r.pattern;
        const k = x => x * amt;
        if (pat === 'countershade' || pat === 'points' || pat === 'tabby' || pat === 'saddle' || pat === 'stripes' || pat === 'spots' || pat === 'rosettes' || pat === 'scales') {
            col = mixRgb(col, C.light, k(clamp(belly + muzzle * 0.8 + throat * 0.9, 0, 1)));
        }
        if (pat === 'spots' || pat === 'dapple') {
            const [d1] = worley(p[0] * 9 / ps, p[1] * 9 / ps, p[2] * 9 / ps, seed);
            const spot = 1 - smooth(0.22, 0.32, d1);
            col = mixRgb(col, pat === 'dapple' ? C.light : C.marking, k(spot * (pat === 'dapple' ? 0.7 : 1) * (1 - belly * 0.8)));
        } else if (pat === 'rosettes') {
            const [d1, d2] = worley(p[0] * 8 / ps, p[1] * 8 / ps, p[2] * 8 / ps, seed);
            const ring = smooth(0.06, 0.12, d2 - d1) * (1 - smooth(0.12, 0.2, d2 - d1));
            const dotSpot = (1 - smooth(0.12, 0.2, d1)) * (lowLeg || onHead ? 1 : 0);
            col = mixRgb(col, C.marking, k(clamp(ring * (1 - (lowLeg || onHead ? 1 : 0)) + dotSpot, 0, 1) * (1 - belly * 0.7)));
        } else if (pat === 'stripes' || pat === 'tabby') {
            const warp = fbm(p[0] * 4, p[1] * 4, p[2] * 4, seed, 3) * 0.35;
            const along = onLeg ? p[1] * 1.3 : tag === 'neck' || onHead ? p[2] * 0.8 + p[1] * 0.6 : p[2];
            const s = Math.sin((along * 22 / ps + warp * 6) * Math.PI);
            const stripe = smooth(pat === 'tabby' ? 0.35 : 0.55, pat === 'tabby' ? 0.75 : 0.8, s) * (1 - belly);
            col = mixRgb(col, C.marking, k(stripe * (pat === 'tabby' ? 0.75 : 1)));
        } else if (pat === 'socks' || pat === 'points') {
            const sockTop = J.frontKnee[1] * (pat === 'socks' ? 0.75 : 1);
            const sock = lowLeg ? smooth(sockTop + 0.04, sockTop - 0.04, p[1]) : 0;
            const point = pat === 'points' ? clamp((tag === 'ear' ? 1 : 0) + (tag === 'snout' || tag === 'jaw' ? 0.5 : 0) + sock, 0, 1) : sock;
            col = mixRgb(col, C.marking, k(point));
            if (pat === 'socks') {
                // A blaze down the face.
                const blaze = (tag === 'snout' || tag === 'skull') && Math.abs(p[0]) < 0.025 * g && n[1] > -0.2 ? 1 : 0;
                col = mixRgb(col, C.marking, k(blaze));
            }
        } else if (pat === 'piebald') {
            const v = fbm(p[0] * 2.4 / ps, p[1] * 2.4 / ps, p[2] * 2.4 / ps, seed, 3);
            col = mixRgb(col, C.marking, k(smooth(0.0, 0.08, v)));
        } else if (pat === 'scales') {
            const [d1, d2] = worley(p[0] * 30 / ps, p[1] * 30 / ps, p[2] * 30 / ps, seed);
            const edge = 1 - smooth(0.0, 0.12, d2 - d1);
            col = mixRgb(col, C.marking, k(edge * 0.8 * (1 - belly)));
            // Darker along the back.
            col = mixRgb(col, C.marking, k(smooth(0.1, 0.9, n[1]) * 0.35));
        }
        if (pat === 'saddle') {
            const saddle = (tag === 'torso' || tag === 'belly' || tag === 'rump' || tag === 'back' || tag === 'hump' || tag === 'neck' || tag === 'mane') ? smooth(-0.1, 0.5, n[1]) * smooth(torsoMid[1] - 0.05, torsoMid[1] + 0.08, p[1]) : 0;
            col = mixRgb(col, C.marking, k(saddle));
        }
        if (tag === 'mane') col = C.mane;
        // Nose pad and hooves.
        const tipD = len(sub(p, J.snoutTip));
        if ((tag === 'snout' || tag === 'jaw') && tipD < J.skullR * 0.42 && n[2] > 0.2) col = mixRgb(col, C.nose, smooth(J.skullR * 0.42, J.skullR * 0.3, tipD));
        if (tag === 'hoof') col = C.hoof;
        if (tag === 'paw' && r.feet === 'claw' && n[2] > 0.5 && p[1] < 0.05) col = mixRgb(col, C.hoof, 0.7);
        // A little mottling so a solid coat is not flat paint.
        const mottle = 1 + 0.06 * fbm(p[0] * 20, p[1] * 20, p[2] * 20, seed + 5, 2);
        return [col[0] * mottle, col[1] * mottle, col[2] * mottle];
    }

    // ── assembly ───────────────────────────────────────────────────────────
    /**
     * The whole creature: { parts, bones, height, plan, rig, clips }.
     * `options.quality` 'preview' (coarser, for live sliders) or 'save'.
     */
    function build(recipe, options) {
        const r = normalizeRecipe(recipe);
        const quality = (options && options.quality) || 'save';
        const lay = layout(r);
        const bones = bonesOf(lay);
        const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
        const shapes = shapesOf(r, lay);
        const lofts = loftsOf(r, lay);
        // Grid cell: the body's longest reach over 60 (preview) or 80 (save).
        let span = 0;
        for (const s of shapes) for (let i = 0; i < 3; i++) span = Math.max(span, s.hi[i] - s.lo[i]);
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const s of shapes) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], s.lo[i]); hi[i] = Math.max(hi[i], s.hi[i]); }
        const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
        const cell = longest / (quality === 'preview' ? 60 : 80);
        const seed = r.seed % 997;
        const fur = r.fluff * 0.012 * lay.g;
        const net = surfaceNet(shapes, cell, fur > 0 ? { amp: fur, at: (x, y, z) => fbm(x * 30, y * 30, z * 30, seed, 2) * 0.5 + 0.5 * Math.abs(valueNoise(x * 70, y * 70, z * 70, seed + 3)) } : null);
        let positions = relaxMesh(net.positions, net.index, quality === 'preview' ? 1 : 2);
        const index = net.index;
        const normals = faceNormals(positions, index);
        const vcount = positions.length / 3;
        // Per vertex: its nearest shape (for the coat) and blended bone weights.
        const C = {};
        for (const c of COLORS) C[c.key] = hexRgb(r.colors[c.key]);
        const colors = new Float32Array(vcount * 3);
        const joints = new Uint8Array(vcount * 4), weights = new Float32Array(vcount * 4);
        const blend = 0.035 * lay.g;
        const dist = new Float64Array(shapes.length);
        const limbOf = shapes.map(sh => { const m = /^(Left|Right)(Front|Rear)/.exec(sh.bone); return m ? m[0] : ''; });
        shapes.forEach(sh => { sh.upper = sh.tag === 'upperleg' || sh.tag === 'thigh'; });
        for (let v = 0; v < vcount; v++) {
            const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
            let best = 0, bestD = Infinity;
            for (let s = 0; s < shapes.length; s++) {
                const d = shapeDistance(shapes[s], p);
                dist[s] = d;
                if (d < bestD) { bestD = d; best = s; }
            }
            const byBone = new Map();
            // A leg's skin answers to that leg and the body, never to another leg.
            const own = limbOf[best];
            for (let s = 0; s < shapes.length; s++) {
                if (limbOf[s] && limbOf[s] !== own && (own || !shapes[s].upper)) continue;
                const w = Math.exp(-(dist[s] - bestD) / blend);
                if (w < 0.01) continue;
                const b = boneIndex.get(shapes[s].bone);
                byBone.set(b, (byBone.get(b) || 0) + w);
            }
            setSkin(joints, weights, v, byBone);
            const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
            const c = coatColor(r, lay, p, n, shapes[best].tag, C);
            colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
        }
        const coat = { positions: Array.from(positions), index: Array.from(index), colors: Array.from(colors), joints: Array.from(joints), weights: Array.from(weights) };
        const horn = { positions: [], index: [], colors: [], joints: [], weights: [] };
        // Lofted pieces join the coat (ears, tails) or the horn part.
        for (const piece of lofts) {
            const target = piece.kind === 'horn' ? horn : coat;
            const base = target.positions.length / 3;
            const m = piece.mesh;
            for (let i = 0; i < m.positions.length / 3; i++) {
                const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
                target.positions.push(p[0], p[1], p[2]);
                const t = m.t[i];
                let c;
                if (piece.kind === 'horn') {
                    // Horns darken toward the base, tusks and spines toward the tip.
                    const shade = piece.tag === 'horn' ? 0.7 + 0.3 * t : 1 - 0.25 * t;
                    c = mixRgb(mul(C.horn, shade), C.nose, piece.tag === 'spine' ? 0 : 0.0);
                } else if (piece.kind === 'hair') {
                    c = mixRgb(C.mane, C.coat, piece.tag === 'tail' && r.tail === 'bushy' ? 0.7 : 0);
                    if (r.tail === 'bushy' && t > 0.85 && r.pattern !== 'solid') c = mixRgb(c, r.kind === 'fox' ? C.light : C.marking, smooth(0.85, 0.95, t));
                } else {
                    c = coatColor(r, lay, p, [0, 0, 1], piece.tag, C);
                    if (piece.tag === 'tail' && r.pattern === 'points') c = mixRgb(c, C.marking, smooth(0.4, 0.9, t) * r.patternAmount);
                    if (piece.tag === 'tail' && r.pattern === 'stripes') c = mixRgb(c, C.marking, (Math.sin(t * 30) > 0.3 ? 1 : 0) * r.patternAmount);
                    if (piece.tag === 'tail' && r.tail === 'tufted' && t > 0.9) c = C.mane;
                }
                target.colors.push(c[0], c[1], c[2]);
                const map = new Map();
                for (const [name, w] of piece.weights(t)) { const b = boneIndex.get(name); if (b != null) map.set(b, (map.get(b) || 0) + w); }
                if (!map.size) map.set(boneIndex.get('Head'), 1);
                const j4 = new Uint8Array(4), w4 = new Float32Array(4);
                setSkin(j4, w4, 0, map);
                target.joints.push(...j4); target.weights.push(...w4);
            }
            for (const q of m.index) target.index.push(q + base);
        }
        // Wings: a part of their own, seen from both sides; the root follows the chest.
        const wings = { positions: [], index: [], colors: [], joints: [], weights: [] };
        if (lay.J.wing) {
            const w = wingOf(r, lay);
            const chest = boneIndex.get('Chest');
            const tones = { bone: C.coat, coat: C.coat, membrane: mixRgb(C.marking, C.coat, 0.35), flight: mixRgb(C.coat, C.marking, 0.5), marking: C.marking };
            for (const [sideName, flip] of [['Left', p => p], ['Right', mirror]]) {
                const wingBone = boneIndex.get(sideName + 'Wing');
                const base = wings.positions.length / 3;
                for (let i = 0; i < w.positions.length / 3; i++) {
                    wings.positions.push(...flip([w.positions[i * 3], w.positions[i * 3 + 1], w.positions[i * 3 + 2]]));
                    const c = tones[w.tone[i]];
                    wings.colors.push(c[0], c[1], c[2]);
                    const out = smooth(0.02 * w.ws, 0.25 * w.ws, w.reach[i]);
                    wings.joints.push(wingBone, chest, 0, 0); wings.weights.push(out, 1 - out, 0, 0);
                }
                // The mirror turns the winding: flip it back so both wings face out alike.
                for (let t = 0; t < w.index.length; t += 3) {
                    const [a, b2, c] = [w.index[t] + base, w.index[t + 1] + base, w.index[t + 2] + base];
                    if (sideName === 'Left') wings.index.push(a, b2, c); else wings.index.push(a, c, b2);
                }
            }
        }
        // Eyes: dark glossy spheres on the skull, forward for a hunter, to the side for prey.
        const eyes = { positions: [], index: [], colors: [], joints: [], weights: [] };
        const sr = lay.J.skullR, hd = lay.J.hdir;
        const eyeR = sr * 0.2 * r.eyeSize;
        const head = boneIndex.get('Head');
        for (const side of [1, -1]) {
            const out = norm([side * (0.35 + 0.65 * r.eyeSide), 0.2, 0.9 - 0.6 * r.eyeSide]);
            const facing = norm([out[0], out[1] * 0.5 + hd[1] * 0.3, out[2] * 0.7 + hd[2] * 0.3]);
            // Out from the skull's middle until the surface, then sunk a little.
            const from = add(lay.J.skull, add(mul(hd, sr * 0.45), [0, sr * 0.25, 0]));
            let c = from;
            for (let i = 0; i < 40; i++) {
                const p = add(from, mul(facing, i * sr * 0.05));
                let d = Infinity;
                for (const s of shapes) if (s.bone === 'Head') d = smin(d, shapeDistance(s, p), s.k);
                if (d > -eyeR * 0.45) { c = p; break; }
            }
            const sph = sphere(c, eyeR, 8, 12);
            const base = eyes.positions.length / 3;
            for (let i = 0; i < sph.positions.length / 3; i++) {
                const p = [sph.positions[i * 3], sph.positions[i * 3 + 1], sph.positions[i * 3 + 2]];
                eyes.positions.push(...p);
                const a = dot(norm(sub(p, c)), facing);
                const col = a > 0.88 ? [0.02, 0.02, 0.02] : a > 0.55 ? hexRgb(r.colors.eye) : mul(hexRgb(r.colors.eye), 0.35);
                eyes.colors.push(...col);
                eyes.joints.push(head, 0, 0, 0); eyes.weights.push(1, 0, 0, 0);
            }
            for (const q of sph.index) eyes.index.push(q + base);
        }
        // Into meters, on the floor.
        const S = r.size;
        const parts = [];
        // The floor is where the feet stand: the body's lowest point (lofted pieces may dip under it).
        let minY = Infinity;
        for (let i = 1; i < net.positions.length; i += 3) minY = Math.min(minY, positions[i]);
        const place = arr => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 3) { out[i] = arr[i] * S; out[i + 1] = (arr[i + 1] - minY) * S; out[i + 2] = arr[i + 2] * S; } return out; };
        const finish = (name, part, extra) => {
            if (!part.positions.length) return;
            const positions = place(part.positions);
            const index = Uint32Array.from(part.index);
            parts.push(Object.assign({
                name, positions, normals: faceNormals(positions, index), index,
                colors: Float32Array.from(part.colors, toLinear),
                joints: Uint8Array.from(part.joints), weights: Float32Array.from(part.weights)
            }, extra));
        };
        finish('Body', coat, { roughness: 0.85 });
        finish('Horns', horn, { roughness: 0.45 });
        finish('Wings', wings, { roughness: 0.75, doubleSided: true });
        finish('Eyes', eyes, { roughness: 0.12 });
        const scalePoint = p => [p[0] * S, (p[1] - minY) * S, p[2] * S];
        const outBones = bones.map(b => ({ name: b.name, parent: b.parent, head: scalePoint(b.head), tail: scalePoint(b.tail) }));
        let top = 0;
        for (const part of parts) for (let i = 1; i < part.positions.length; i += 3) top = Math.max(top, part.positions[i]);
        const markers = markersOf(lay, scalePoint);
        return { parts, bones: outBones, height: top, plan: 'quadruped', rig: { template: 'quadruped', markers }, clips: [idleClip(outBones)], recipe: r };
    }

    /** The top four bone influences of a vertex, normalized. */
    function setSkin(joints, weights, v, byBone) {
        const top = [...byBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = top.reduce((s, [, w]) => s + w, 0) || 1;
        for (let k = 0; k < 4; k++) {
            joints[v * 4 + k] = top[k] ? top[k][0] : 0;
            weights[v * 4 + k] = top[k] ? top[k][1] / total : 0;
        }
    }

    /** The Rig tool's quadruped markers, from the joints. */
    function markersOf(lay, at) {
        const { J } = lay;
        // The template puts the head bone 70% of the way from the neck marker to the head marker.
        const head = add(J.neck, mul(sub(J.atlas, J.neck), 1 / 0.7));
        const m = {
            head: at(lerp(head, J.snoutTip, 0.0)), neck: at(J.neck), hips: at(J.hips),
            tailTip: at(J.tail.length > 1 ? J.tail[J.tail.length - 1] : add(J.hips, [0, 0, -0.2]))
        };
        for (const [side, f] of [['L', p => p], ['R', mirror]]) {
            m['frontLeg' + side] = at(f(J.shoulder)); m['frontKnee' + side] = at(f(J.frontKnee)); m['frontAnkle' + side] = at(f(J.frontAnkle));
            m['rearLeg' + side] = at(f(J.hip)); m['rearKnee' + side] = at(f(J.rearKnee)); m['rearAnkle' + side] = at(f(J.rearAnkle));
        }
        return m;
    }

    // ── idle ───────────────────────────────────────────────────────────────
    const axisAngle = (x, y, z, a) => { const s = Math.sin(a / 2); return [x * s, y * s, z * s, Math.cos(a / 2)]; };
    /** Breathing, a tail that swings, a head that looks about: three seconds round. */
    function idleClip(bones) {
        const steps = 25, period = 3;
        const times = [];
        for (let i = 0; i < steps; i++) times.push((period * i) / (steps - 1));
        const tracks = [];
        const track = (name, at) => {
            const bone = bones.findIndex(b => b.name === name);
            if (bone < 0) return;
            const values = [];
            for (let i = 0; i < steps; i++) values.push(...at((2 * Math.PI * i) / (steps - 1)));
            tracks.push({ bone, values });
        };
        track('Chest', a => axisAngle(1, 0, 0, 0.012 * Math.sin(a * 2)));
        track('Spine', a => axisAngle(1, 0, 0, -0.008 * Math.sin(a * 2)));
        track('Neck', a => axisAngle(1, 0, 0, 0.03 * Math.sin(a)));
        track('Head', a => axisAngle(0, 1, 0, 0.12 * Math.sin(a)));
        track('LeftWing', a => axisAngle(0, 0, 1, 0.06 * Math.sin(a)));
        track('RightWing', a => axisAngle(0, 0, 1, -0.06 * Math.sin(a)));
        track('Tail', a => axisAngle(0, 1, 0, 0.22 * Math.sin(a * 2)));
        track('Tail2', a => axisAngle(0, 1, 0, 0.25 * Math.sin(a * 2 - 0.6)));
        track('Tail3', a => axisAngle(0, 1, 0, 0.3 * Math.sin(a * 2 - 1.2)));
        return { name: 'Idle', times, tracks };
    }

    /**
     * The model.json beside the saved GLB: a quadruped rig whose bones are the
     * file's own (the runtime maps each onto the file joint of its name and
     * place, mapRigToSkeleton), so no weights file is needed.
     */
    function sidecar(built) {
        const names = new Set(['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'Tail']);
        for (const side of ['Left', 'Right']) for (const part of ['FrontUpperLeg', 'FrontLowerLeg', 'FrontFoot', 'RearUpperLeg', 'RearLowerLeg', 'RearFoot']) names.add(side + part);
        const kept = built.bones.map((b, i) => [b, i]).filter(([b]) => names.has(b.name));
        const remap = new Map(kept.map(([, i], k) => [i, k]));
        // A kept bone's parent is its nearest kept ancestor.
        const parentOf = i => { let p = built.bones[i].parent; while (p >= 0 && !remap.has(p)) p = built.bones[p].parent; return p >= 0 ? remap.get(p) : -1; };
        return {
            rig: {
                template: 'quadruped',
                markers: built.rig.markers,
                bones: kept.map(([b, i]) => ({ name: b.name, parent: parentOf(i), head: b.head.slice(), tail: b.tail.slice() }))
            }
        };
    }

    const api = { KINDS, SLIDERS, OPTIONS, COLORS, DEFAULT_RECIPE, kindRecipe, normalizeRecipe, randomRecipe, build, sidecar };
    root.RRCreatureBody = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

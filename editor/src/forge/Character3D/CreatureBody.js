/**
 * RRCreatureBody - the Character Builder's four-legged body plan: a recipe of
 * slider and option values in, a skinned, vertex-colored creature out.
 *
 * The body is an implicit surface laid over a quadruped skeleton the way the
 * animal is built: a deep rib cage and a narrower waist, shoulder blades on
 * the ribs, haunches over the hips, legs with their real joints (shoulder,
 * elbow, carpus and paw in front; hip, stifle, hock and paw behind, the hock
 * bent back), the muscles over each bone (deltoid, triceps, forearm, thigh,
 * hamstring, calf and the tendon to the hock), paws with pads and toes or
 * hooves, and a head of cranium, brows, cheekbones, muzzle, whisker pads,
 * nose pad, chin and jaw with the eyes in sockets. The pieces blend by a
 * tight smooth minimum (a few are smoothly cut away: eye sockets, the
 * philtrum) and the field is meshed by surface nets over a narrow band
 * around the surface, then laid onto the true surface; the saved file is
 * meshed finer and reduced by quadric edge collapse (RRQuadricDecimator).
 * Thin things a field would lose (ears, tails, horns, antlers, tusks, claws,
 * spines) are lofted tubes; a lion's mane and a shaggy coat are strand cards
 * over the body, as many as the hair budget allows. Skin weights come from
 * how near each vertex lies to the shapes of each bone; coat patterns are
 * painted per vertex.
 *
 * With `anatomy.detail` on, the external genitalia of the chosen sex and the
 * teats of the species are built in, as on a veterinary model.
 *
 * Bones carry the 3D Models Rig tool's quadruped names (Hips, Spine, Chest,
 * Neck, Head, Tail, LeftFrontUpperLeg …), so the built-in quadruped motions
 * drive the file's own skeleton. Frame: y up, facing +z, the creature's
 * left at +x, meters, standing on y = 0. `size` is the distance between the
 * shoulder and hip joints in meters.
 *
 * No DOM and no three.js here: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    const Gear = root.RRCreatureGear || (typeof require === 'function' ? (() => { try { return require('./CreatureGear.js'); } catch (e) { return null; } })() : null);
    const Decimator = root.RRQuadricDecimator || (typeof require === 'function' ? (() => { try { return require('../../utils/QuadricDecimator.js'); } catch (e) { return null; } })() : null);

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
    const same = p => p;
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
    function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

    // ── color ──────────────────────────────────────────────────────────────
    const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const hexRgb = hex => { const n = parseInt(String(hex || '#888888').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
    const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const HEX = /^#[0-9a-f]{6}$/i;

    // ── the recipe ─────────────────────────────────────────────────────────
    /** Sliders: `natural` is the everyday range; min/max run on to the extremes. */
    const SLIDERS = [
        { key: 'size', label: 'Size', section: 'Body', min: 0.06, max: 4, step: 0.01, natural: [0.15, 1.6], unit: 'm' },
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

    /** The sexes `anatomy.sex` may name. */
    const SEXES = ['male', 'female'];

    const DEFAULT_RECIPE = Object.freeze({
        plan: 'quadruped', kind: 'dog',
        size: 0.42, bodyLength: 1, girth: 1, chestDepth: 1, belly: 0, hump: 0, hipHeight: 1, fluff: 0.2,
        legLength: 1, legThickness: 1, pawSize: 1, plantigrade: 0,
        neckLength: 1, neckThickness: 1, neckAngle: 40, headSize: 1, snoutLength: 1, snoutWidth: 1, headPitch: 15, eyeSize: 1, eyeSide: 0.2,
        earSize: 1, earDroop: 0, tailLength: 0.9, tailThickness: 1, tailCurl: 0, hornSize: 1, tuskSize: 0, maneSize: 0, spines: 0, wingSize: 1,
        patternScale: 1, patternAmount: 1,
        ears: 'pointed', tail: 'long', horns: 'none', feet: 'paw', wings: 'none', mane: 'none', pattern: 'countershade',
        colors: Object.freeze({ coat: '#8a6a48', marking: '#3a2a1e', light: '#e8dcc8', nose: '#2a2220', hoof: '#2a2420', horn: '#d8ccb0', eye: '#6a4a20', mane: '#5a3f28' }),
        anatomy: Object.freeze({ detail: false, sex: 'male' }),
        gear: Object.freeze([]),
        seed: 1
    });

    /**
     * What a kind is, beyond its sliders: its pupil ('round', 'slit' upright,
     * 'bar' across), whether its hooves are cloven, where a male's sheath and
     * testes lie ('belly' sheath ahead of the thighs with the scrotum between
     * them, 'perineal' the scrotum under the tail as in cats and boars, with
     * the sheath just below it or, where `sheath` is 'belly' (a boar), on the
     * belly, 'pendulous' a hanging scrotum as in bulls and rams, 'cloaca' none
     * outside), its teats: pairs along the belly from `from` (0 the chest) to
     * `to` (1 the groin), or an udder between the thighs; `padColor` for ear
     * backs darker than the coat, `felid` for a cat's pale patches under the
     * eyes.
     */
    const PROFILE = {
        cat: { pupil: 'slit', genital: 'perineal', teats: { pairs: 4, from: 0.15, to: 0.95 }, padColor: true, felid: true },
        lion: { pupil: 'round', genital: 'perineal', teats: { pairs: 2, from: 0.55, to: 0.92 }, padColor: true, felid: true },
        tiger: { pupil: 'round', genital: 'perineal', teats: { pairs: 2, from: 0.55, to: 0.92 }, padColor: true, felid: true },
        dog: { pupil: 'round', genital: 'belly', teats: { pairs: 5, from: 0.1, to: 0.95 }, padColor: true },
        wolf: { pupil: 'round', genital: 'belly', teats: { pairs: 5, from: 0.1, to: 0.95 }, padColor: true },
        fox: { pupil: 'slit', genital: 'belly', teats: { pairs: 4, from: 0.2, to: 0.95 }, padColor: true },
        deer: { pupil: 'bar', cloven: true, genital: 'belly', teats: { udder: 0.5, count: 4 } },
        horse: { pupil: 'bar', genital: 'belly', teats: { udder: 0.45, count: 2 } },
        bear: { pupil: 'round', genital: 'belly', teats: { pairs: 3, from: 0.0, to: 0.95 }, padColor: true },
        boar: { pupil: 'round', cloven: true, genital: 'perineal', sheath: 'belly', teats: { pairs: 6, from: 0.05, to: 0.95 } },
        rabbit: { pupil: 'round', genital: 'perineal', teats: { pairs: 4, from: 0.1, to: 0.95 } },
        bull: { pupil: 'bar', cloven: true, genital: 'pendulous', teats: { udder: 1, count: 4 } },
        ram: { pupil: 'bar', cloven: true, genital: 'pendulous', teats: { udder: 0.7, count: 2 } },
        drake: { pupil: 'slit', genital: 'cloaca', teats: null }
    };
    const profileOf = r => PROFILE[r.kind] || PROFILE.dog;

    const K = (kind, over, colors) => ({ kind, over, colors });
    /** Presets: recipes over the defaults, sized as the grown animal (shoulder to hip joint, in meters). */
    const KINDS = [
        K('cat', { size: 0.21, bodyLength: 0.95, legLength: 0.9, girth: 0.95, chestDepth: 0.95, belly: -0.1, neckLength: 0.6, neckAngle: 34, headSize: 1.42, snoutLength: 0.26, snoutWidth: 0.92, headPitch: 6, eyeSize: 1.35, eyeSide: 0.05, earSize: 1.05, ears: 'pointed', tail: 'long', tailLength: 1.1, tailThickness: 1.25, tailCurl: 0.3, pattern: 'tabby', pawSize: 0.9, legThickness: 0.88, fluff: 0.3 },
            { coat: '#b58a5a', marking: '#4a3220', light: '#efe2cc', nose: '#c87a78', eye: '#8db040', mane: '#b58a5a' }),
        K('lion', { size: 0.86, bodyLength: 1, legLength: 0.97, girth: 1.08, chestDepth: 1.05, belly: -0.25, hump: 0, neckLength: 0.6, neckThickness: 1.2, neckAngle: 22, headSize: 1.45, snoutLength: 0.7, snoutWidth: 1.12, headPitch: 10, eyeSize: 1.1, eyeSide: 0.04, earSize: 0.62, ears: 'round', tail: 'tufted', tailLength: 1.05, tailThickness: 0.95, tailCurl: -0.35, mane: 'lion', maneSize: 1.0, pattern: 'countershade', pawSize: 1.2, legThickness: 1.28, fluff: 0.15 },
            { coat: '#c49556', marking: '#3a2618', light: '#ead6ae', nose: '#a8645a', eye: '#b98a32', mane: '#6e4322' }),
        K('tiger', { size: 0.88, bodyLength: 1.08, legLength: 0.9, girth: 1.02, chestDepth: 1.02, belly: -0.3, neckLength: 0.8, neckThickness: 1.05, neckAngle: 22, headSize: 1.1, snoutLength: 0.68, snoutWidth: 1.1, headPitch: 10, eyeSize: 1.1, eyeSide: 0.04, earSize: 0.8, ears: 'round', tail: 'long', tailLength: 1.15, tailThickness: 1, tailCurl: -0.25, mane: 'ruff', maneSize: 0.35, pattern: 'stripes', pawSize: 1.2, legThickness: 1.12, fluff: 0.2 },
            { coat: '#d8782a', marking: '#1e1610', light: '#f2e8d8', nose: '#c07a70', eye: '#d0a030', mane: '#d8782a' }),
        K('dog', { size: 0.42, legLength: 1.02, girth: 0.95, chestDepth: 1.05, belly: -0.4, neckLength: 1, neckAngle: 38, headSize: 1.15, snoutLength: 0.85, snoutWidth: 1, headPitch: 14, tailThickness: 1.1, earSize: 1.1, earDroop: 0.35, tailCurl: 0.25, legThickness: 0.95 }, {}),
        K('wolf', { size: 0.55, legLength: 1.12, girth: 0.92, chestDepth: 1.1, belly: -0.6, neckLength: 1, neckAngle: 30, headSize: 1.08, snoutLength: 0.92, snoutWidth: 0.95, headPitch: 15, eyeSize: 0.85, earSize: 1, ears: 'pointed', tail: 'bushy', tailLength: 0.85, tailThickness: 1.2, tailCurl: -0.6, mane: 'ruff', maneSize: 0.6, pattern: 'saddle', fluff: 0.55, legThickness: 0.9 },
            { coat: '#8c8478', marking: '#3a3632', light: '#ddd6c8', nose: '#1e1c1a', eye: '#c8a040', mane: '#7a746a' }),
        K('fox', { size: 0.3, legLength: 0.92, girth: 0.82, chestDepth: 0.98, belly: -0.4, neckLength: 0.9, neckAngle: 34, headSize: 1.05, snoutLength: 0.9, snoutWidth: 0.78, headPitch: 12, eyeSize: 1, earSize: 1.45, ears: 'pointed', tail: 'bushy', tailLength: 1.15, tailThickness: 1.5, tailCurl: -0.25, pattern: 'points', fluff: 0.45, legThickness: 0.8 },
            { coat: '#d06a24', marking: '#2a1c14', light: '#f4ece0', nose: '#1a1412', eye: '#c08a20', mane: '#d06a24' }),
        K('deer', { size: 0.6, legLength: 1.32, girth: 0.85, chestDepth: 1.05, belly: -0.3, neckLength: 1.45, neckAngle: 55, headSize: 0.98, snoutLength: 1.05, snoutWidth: 0.8, headPitch: 42, eyeSize: 1.25, eyeSide: 0.85, earSize: 1.3, ears: 'narrow', earDroop: -0.3, tail: 'stub', tailLength: 0.35, feet: 'hoof', horns: 'antlers', hornSize: 1.1, legThickness: 0.72, pattern: 'countershade', fluff: 0.05 },
            { coat: '#9a6a40', marking: '#5a3a22', light: '#f0e6d6', nose: '#1e1816', horn: '#c8b090', eye: '#2a1a10', mane: '#9a6a40' }),
        K('horse', { size: 0.95, legLength: 1.36, girth: 1.08, belly: 0.1, neckLength: 1.55, neckAngle: 52, neckThickness: 1.25, headSize: 1.3, snoutLength: 1.2, snoutWidth: 1.05, headPitch: 58, chestDepth: 1.2, eyeSize: 1.3, eyeSide: 0.9, earSize: 1.1, ears: 'narrow', tail: 'horse', tailLength: 1.05, tailThickness: 1.2, tailCurl: -0.9, feet: 'hoof', mane: 'horse', maneSize: 1, pattern: 'socks', legThickness: 0.92, fluff: 0.05 },
            { coat: '#7a4a2a', marking: '#f2ede4', light: '#d8c4a8', nose: '#2a2220', eye: '#2a1810', mane: '#1e1612' }),
        K('bear', { size: 0.78, legLength: 0.98, girth: 1.22, chestDepth: 1.05, belly: 0.4, hump: 0.7, hipHeight: 0.96, neckLength: 0.7, neckAngle: 16, neckThickness: 1.35, headSize: 1.08, snoutLength: 0.82, snoutWidth: 1.05, headPitch: 14, eyeSize: 0.7, earSize: 0.75, ears: 'round', tail: 'stub', tailLength: 0.15, feet: 'claw', plantigrade: 1, pawSize: 1.15, legThickness: 1.38, pattern: 'solid', fluff: 0.7 },
            { coat: '#5a3c26', marking: '#3a261a', light: '#7a5a3a', nose: '#1a1412', eye: '#1a1010', mane: '#5a3c26' }),
        K('boar', { size: 0.58, legLength: 0.72, girth: 1.28, chestDepth: 1.22, hump: 0.4, belly: 0.2, neckLength: 0.45, neckAngle: 10, neckThickness: 1.5, headSize: 1.12, snoutLength: 1.1, snoutWidth: 0.95, headPitch: 25, eyeSize: 0.6, eyeSide: 0.6, earSize: 0.85, ears: 'pointed', earDroop: 0.2, tail: 'tufted', tailLength: 0.35, tailThickness: 0.6, tailCurl: -0.8, feet: 'hoof', tuskSize: 1, legThickness: 0.85, pattern: 'solid', fluff: 0.8, mane: 'horse', maneSize: 0.5 },
            { coat: '#4a3a30', marking: '#2a201a', light: '#6a5a4a', nose: '#3a2a26', horn: '#ece4d0', eye: '#1a1010', mane: '#2a2018' }),
        K('rabbit', { size: 0.15, bodyLength: 0.8, legLength: 0.5, hipHeight: 1.2, girth: 1.15, chestDepth: 1.05, neckLength: 0.4, neckAngle: 40, headSize: 1.3, snoutLength: 0.38, snoutWidth: 0.95, headPitch: 20, eyeSize: 1.5, eyeSide: 1, earSize: 2.1, ears: 'long', earDroop: -0.5, tail: 'stub', tailLength: 0.25, tailThickness: 1.4, tailCurl: 1, plantigrade: 1, pattern: 'countershade', fluff: 0.95 },
            { coat: '#9a8470', marking: '#5a4a3a', light: '#f2ece4', nose: '#d89aa0', eye: '#1a1210', mane: '#9a8470' }),
        K('bull', { size: 0.95, legLength: 0.95, girth: 1.4, chestDepth: 1.28, belly: 0.6, hump: 0.45, neckLength: 0.6, neckAngle: 15, neckThickness: 1.5, headSize: 1.15, snoutLength: 1.0, snoutWidth: 1.15, headPitch: 35, eyeSize: 1.2, eyeSide: 0.85, earSize: 0.8, ears: 'round', earDroop: 0.7, tail: 'tufted', tailLength: 1, tailThickness: 0.7, tailCurl: -1, feet: 'hoof', horns: 'bull', hornSize: 1, pattern: 'piebald', legThickness: 1.08, fluff: 0.05 },
            { coat: '#2a2220', marking: '#f0ece4', light: '#3a302a', nose: '#c08a8a', horn: '#e0d4b8', eye: '#1a1010', mane: '#1a1412' }),
        K('ram', { size: 0.55, legLength: 0.92, girth: 1.22, chestDepth: 1.1, belly: 0.3, neckLength: 0.7, neckAngle: 35, headSize: 1, snoutLength: 0.85, snoutWidth: 0.85, headPitch: 35, eyeSize: 1, eyeSide: 0.9, earSize: 0.75, ears: 'narrow', earDroop: 0.6, tail: 'stub', tailLength: 0.3, feet: 'hoof', horns: 'ram', hornSize: 1.1, pattern: 'points', legThickness: 0.7, fluff: 1.3 },
            { coat: '#e8e0d0', marking: '#3a3430', light: '#f4f0e8', nose: '#2a2624', horn: '#b8a888', eye: '#a07830', mane: '#e8e0d0' }),
        K('drake', { size: 1.3, bodyLength: 1.25, legLength: 0.78, girth: 1.15, chestDepth: 1.1, belly: 0.2, neckLength: 1.6, neckAngle: 38, headSize: 1.05, snoutLength: 1.3, snoutWidth: 0.9, headPitch: 18, eyeSize: 0.9, eyeSide: 0.35, earSize: 0.7, ears: 'small', tail: 'thick', tailLength: 2.1, tailThickness: 1.5, tailCurl: -0.35, feet: 'claw', plantigrade: 0.7, horns: 'dragon', hornSize: 1.2, spines: 1, wings: 'bat', wingSize: 1.1, pattern: 'scales', legThickness: 1.25, pawSize: 1.3, fluff: 0 },
            { coat: '#2f6a3a', marking: '#1c3a22', light: '#c8b878', nose: '#1a1a14', horn: '#d8d0b0', eye: '#e8b020', mane: '#2f6a3a' })
    ];
    const KIND_BY_ID = new Map(KINDS.map(k => [k.kind, k]));

    /** A preset's whole recipe. */
    function kindRecipe(kind) {
        const k = KIND_BY_ID.get(kind) || KIND_BY_ID.get('dog');
        return normalizeRecipe(Object.assign({}, DEFAULT_RECIPE, k.over, { kind: k.kind, colors: Object.assign({}, DEFAULT_RECIPE.colors, k.colors) }));
    }

    /** Anatomical detail: off unless switched on; the sex one of SEXES. */
    function normalizeAnatomy(a) {
        const v = a || {};
        return { detail: v.detail === true, sex: SEXES.includes(v.sex) ? v.sex : DEFAULT_RECIPE.anatomy.sex };
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
        out.anatomy = normalizeAnatomy(r.anatomy);
        out.gear = Gear ? Gear.normalizeGear(r.gear) : [];
        out.seed = Number.isFinite(r.seed) ? r.seed >>> 0 : DEFAULT_RECIPE.seed;
        return out;
    }

    /**
     * A seeded variation on a preset (a random preset when none is named):
     * sliders wander within their natural range. It carries no `anatomy` and
     * no `gear`, so laid over a recipe it leaves those as they were.
     */
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
        const out = normalizeRecipe(r);
        delete out.anatomy;
        delete out.gear;
        return out;
    }

    // ── shapes ─────────────────────────────────────────────────────────────
    /**
     * Every shape carries the same fields in the same order (one object layout keeps the field's hot loop
     * fast): a cone's ends and radii, an ellipsoid's center, radii and axes, its bone, blend, tag and box,
     * and what may be set on it after: cut away, roughened, flattened, its blend narrowed at the midline,
     * an envelope of coat.
     */
    function shape(o) {
        return { type: o.type, a: o.a || null, b: o.b || null, ra: o.ra || 0, rb: o.rb || 0, c: o.c || null, r: o.r || null, m: o.m || 0, mr: o.mr || 0,
            ax: o.ax || null, ay: o.ay || null, az: o.az || null, bone: o.bone, k: o.k, tag: o.tag, lo: o.lo, hi: o.hi,
            cut: false, bump: 0, bumpScale: 12, bumpSeed: 7, fx: 0, x0: 0, mid: null, envelope: false };
    }
    /** A rounded cone from a (radius ra) to b (radius rb). */
    function cone(a, b, ra, rb, bone, k, tag) {
        const lo = [0, 1, 2].map(i => Math.min(a[i] - ra, b[i] - rb)), hi = [0, 1, 2].map(i => Math.max(a[i] + ra, b[i] + rb));
        return shape({ type: 0, a, b, ra, rb, bone, k: k ?? 0.03, tag, lo, hi });
    }
    /**
     * An ellipsoid at c with radii r along the axes x (side), y (up) and z
     * (forward) of a basis turned to face `forward`, its up toward `upHint`.
     */
    function ellipsoid(c, r, bone, k, tag, forward, upHint) {
        const f = norm(forward || [0, 0, 1]);
        let side = cross(upHint || [0, 1, 0], f);
        if (len(side) < 1e-6) side = cross([0, 0, 1], f);
        if (len(side) < 1e-6) side = [1, 0, 0];
        side = norm(side);
        const up = norm(cross(f, side));
        const m = Math.max(r[0], r[1], r[2]);
        return shape({ type: 1, c, r, m, mr: Math.min(r[0], r[1], r[2]), ax: side, ay: up, az: f, bone, k: k ?? 0.03, tag, lo: sub(c, [m, m, m]), hi: add(c, [m, m, m]) });
    }
    /** The same shape, smoothly cut away from what is built. */
    const cut = s => Object.assign(s, { cut: true });
    /** A cone made `f` times thinner across x about the plane x = x0 (a muscle mass flat against the body). */
    const flatten = (s, x0, f) => Object.assign(s, { fx: f, x0, a: [x0 + (s.a[0] - x0) * f, s.a[1], s.a[2]], b: [x0 + (s.b[0] - x0) * f, s.b[1], s.b[2]] });

    function shapeDistance(s, p) {
        if (s.type === 1) {
            const dx = p[0] - s.c[0], dy = p[1] - s.c[1], dz = p[2] - s.c[2];
            const x = (dx * s.ax[0] + dy * s.ax[1] + dz * s.ax[2]) / s.r[0];
            const y = (dx * s.ay[0] + dy * s.ay[1] + dz * s.ay[2]) / s.r[1];
            const z = (dx * s.az[0] + dy * s.az[1] + dz * s.az[2]) / s.r[2];
            const k0 = Math.sqrt(x * x + y * y + z * z);
            const k1 = Math.sqrt(x * x / (s.r[0] * s.r[0]) + y * y / (s.r[1] * s.r[1]) + z * z / (s.r[2] * s.r[2]));
            if (k1 < 1e-9) return -s.mr;
            const d = k0 * (k0 - 1) / k1;
            // Outside, the estimate runs short far from a flat ellipsoid: never nearer than its bounding
            // sphere, so a shape past its box (as the mesher culls it) never reaches into a blend. Inside, it
            // runs deep along a long axis: never deeper than the shortest radius allows, so the field never
            // falls faster than the distance and the mesher's far-block test holds.
            return k0 < 1 ? Math.max(d, (k0 - 1) * s.mr) : Math.max(d, Math.sqrt(dx * dx + dy * dy + dz * dz) - s.m);
        }
        // Round cone (Inigo Quilez's exact distance), in the flattened frame of a flat one.
        const px = s.fx ? s.x0 + (p[0] - s.x0) * s.fx : p[0];
        const bax = s.b[0] - s.a[0], bay = s.b[1] - s.a[1], baz = s.b[2] - s.a[2], l2 = bax * bax + bay * bay + baz * baz;
        const pax = px - s.a[0], pay = p[1] - s.a[1], paz = p[2] - s.a[2];
        if (l2 < 1e-12) return Math.hypot(pax, pay, paz) - Math.max(s.ra, s.rb);
        const rr = s.ra - s.rb, a2 = l2 - rr * rr, il2 = 1 / l2;
        const y = pax * bax + pay * bay + paz * baz, z = y - l2;
        const qx = pax * l2 - bax * y, qy = pay * l2 - bay * y, qz = paz * l2 - baz * y;
        const x2 = qx * qx + qy * qy + qz * qz, y2 = y * y * l2, z2 = z * z * l2;
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
    const smax = (a, b, k) => -smin(-a, -b, k);

    /** A shape's distance with its surface roughened (a mane's locks). */
    function bumpedDistance(s, p) {
        const d = shapeDistance(s, p);
        if (!s.bump || d > s.bump * 2) return d;
        const f = s.bumpScale;
        return d - s.bump * (0.5 + 0.5 * fbm(p[0] * f, p[1] * f * 0.6, p[2] * f, s.bumpSeed, 2));
    }

    /** The field at p over a list of shapes: unions first, then cuts; nothing below the floor. */
    function fieldAt(list, p) {
        let d = 1e3;
        for (let i = 0; i < list.length; i++) {
            const s = list[i];
            const v = s.bump ? bumpedDistance(s, p) : shapeDistance(s, p);
            // A limb's wide blend into the trunk narrows toward the midline, so the two legs of a pair never web together.
            let k = s.k;
            if (s.mid) {
                const t = (Math.abs(p[0]) - s.mid[0]) / (s.mid[1] - s.mid[0]);
                if (t < 1) k *= t <= 0 ? s.mid[2] : s.mid[2] + (1 - s.mid[2]) * t * t * (3 - 2 * t);
            }
            d = s.cut ? smax(d, -v, k) : smin(d, v, k);
        }
        return Math.max(d, -p[1]);
    }

    // ── skeleton and layout (units: shoulder-to-hip joint length = 1) ─────
    /**
     * Every joint and landmark of the creature, in body units. The bones are
     * the Rig tool's quadruped bones plus a tail chain.
     */
    function layout(r) {
        const g = r.girth, bl = r.bodyLength, L = r.legLength, ht = r.headSize, lt = r.legThickness, cd = r.chestDepth;
        const plant = r.plantigrade, hoof = r.feet === 'hoof';
        const J = {};
        const zS = 0.5 * bl, zH = -0.5 * bl;
        // Leg tops: the shoulder joint in front, the hip joint behind.
        const yS = 0.86 * L, yH = 0.84 * L * r.hipHeight;
        const halfW = 0.13 * g;
        J.shoulder = [halfW, yS, zS];
        J.hip = [halfW, yH, zH];
        // The withers (the shoulder blades' tops), the neck's root at the chest's front, the hips' bone.
        J.withers = [0, yS + 0.44 * g, zS - 0.17];
        J.neck = [0, yS + 0.22 * g, zS + 0.07];
        J.hips = [0, yH + 0.12 * g, zH + 0.06];
        const chestTop = yS + 0.36 * g, chestBottom = yS - 0.24 * g * cd;
        // Front leg: the humerus down and back to the elbow, the forearm down to the carpus, the paw ahead of it.
        const wristY = hoof ? yS * 0.36 : yS * (0.22 - 0.17 * plant);
        const hockY = hoof ? yH * 0.42 : yH * (0.33 - 0.27 * plant);
        J.frontKnee = [halfW * 1.1, yS * 0.6, zS - 0.1 * L];
        J.frontAnkle = [halfW * 1.05, wristY, zS - 0.05 * L];
        J.frontToe = [halfW * 1.05, 0, zS + (hoof ? 0.0 : 0.03 * L) + 0.12 * plant];
        // Hind leg: the femur down and forward to the stifle, the tibia down and back to the hock (steeper
        // than it is long back, as a standing animal holds it), the cannon or paw under it. Laid out from
        // the hip's height, so a long or short leg keeps the same angles.
        J.rearKnee = [halfW * 1.15, yH * (hoof ? 0.67 : 0.62), zH + (hoof ? 0.12 : 0.13 * (1 - 0.4 * plant)) * yH];
        J.rearAnkle = [halfW, hockY, zH - (hoof ? 0.07 : 0.1 * (1 - 0.5 * plant)) * yH];
        J.rearToe = [halfW, 0, zH - (hoof ? 0.05 : 0.04) * yH + 0.2 * plant];
        // Neck: from its root out and up at the raise angle.
        const na = r.neckAngle * DEG, nlen = 0.34 * r.neckLength;
        J.atlas = add(J.neck, mul([0, Math.sin(na), Math.cos(na)], nlen));
        // Head: a frame turned down by the tilt; the muzzle runs out of the skull along it.
        const pitch = r.headPitch * DEG;
        const hd = [0, -Math.sin(pitch), Math.cos(pitch)], hu = [0, Math.cos(pitch), Math.sin(pitch)];
        const sr = 0.15 * ht;
        const skull = add(J.atlas, add(mul(hd, sr * 0.78), mul(hu, sr * 0.22)));
        const sL = r.snoutLength;
        const mL = 0.35 + 0.9 * sL + 0.6 * sL * sL;
        /** A point in the head's frame, in skull radii: x out to the left, y up, z forward. */
        const H = (x, y, z) => [skull[0] + x * sr, skull[1] + (hu[1] * y + hd[1] * z) * sr, skull[2] + (hu[2] * y + hd[2] * z) * sr];
        J.skull = skull; J.hdir = hd; J.hup = hu; J.skullR = sr;
        J.snoutTip = H(0, -0.06, 0.55 + mL);
        J.headTop = H(0, 0.9, 0);
        // Tail: from the croup, out and drooping (carriage below zero) or curling up.
        const tailRoot = [0, yH + 0.27 * g, zH - 0.21];
        J.tailRoot = tailRoot;
        const tailLen = r.tail === 'none' ? 0 : 1.05 * r.tailLength * (r.tail === 'stub' ? 0.3 : 1);
        const segments = 6;
        const tailPts = [tailRoot];
        let dirAngle = (r.tailCurl * 45 - 18) * DEG;
        const step = tailLen / segments;
        for (let i = 0; i < segments; i++) {
            const last = tailPts[tailPts.length - 1];
            tailPts.push(add(last, [0, Math.sin(dirAngle) * step, -Math.cos(dirAngle) * step]));
            // A drooping tail hangs ever lower, then lifts a little at the end; a carried one curls forward over the back.
            dirAngle += (r.tail === 'curly' ? 70 : r.tailCurl > 0 ? 18 * r.tailCurl : (i < 4 ? 13 : -10) * r.tailCurl * (i < 4 ? 1 : -0.6)) * DEG;
        }
        // A long tail that reaches the ground lies along it.
        for (const p of tailPts) p[1] = Math.max(p[1], 0.04 * r.tailThickness * g);
        J.tail = tailPts;
        // Wings: from the top of the shoulders, held half open, up and back.
        if (r.wings !== 'none' && r.wingSize > 0) {
            const ws = r.wingSize * Math.max(0.8, bl);
            const rootW = [halfW * 0.8, J.withers[1] - 0.03 * g, zS - 0.12];
            const elbow = add(rootW, [0.32 * ws, 0.26 * ws, -0.12 * ws]);
            const wrist = add(elbow, [0.36 * ws, 0.12 * ws, 0.08 * ws]);
            // Finger tips fan from the wrist out, down and back to the flank.
            const tips = [
                add(wrist, [0.42 * ws, 0.08 * ws, -0.1 * ws]),
                add(wrist, [0.38 * ws, -0.18 * ws, -0.32 * ws]),
                add(wrist, [0.2 * ws, -0.36 * ws, -0.5 * ws]),
                add(wrist, [-0.05 * ws, -0.4 * ws, -0.62 * ws])
            ];
            // Where the membrane meets the body: along the flank, from the root back.
            const flank = [0.18 * g, yS + 0.15 * g, -0.35 * bl];
            J.wing = { root: rootW, elbow, wrist, tips, flank };
        }
        return { J, H, sr, mL, hd, hu, zS, zH, yS, yH, halfW, g, bl, L, ht, lt, cd, chestTop, chestBottom,
            spineF: [0, J.withers[1] - 0.02 * g, J.withers[2]], spineR: [0, yH + 0.32 * g, zH], toes: [], eyes: [], ears: [], nostrils: [] };
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
            const m = side === 'Left' ? same : mirror;
            addBone(side + 'Wing', 'Chest', m(J.wing.root), m(J.wing.wrist));
        }
        for (const side of ['Left', 'Right']) {
            const m = side === 'Left' ? same : mirror;
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
        const { J, H, sr, mL, hd, hu, zS, zH, yS, yH, halfW, g, bl, lt, cd, chestTop, chestBottom } = lay;
        const S = [];
        const E = (c, rad, bone, k, tag, f, up) => { const s = ellipsoid(c, rad, bone, k, tag, f, up); S.push(s); return s; };
        const C = (a, b, ra, rb, bone, k, tag) => { const s = cone(a, b, ra, rb, bone, k, tag); S.push(s); return s; };
        const prof = profileOf(r);
        const lw = lt * (0.55 + 0.45 * g);
        // ── torso: the rib cage deep and long, the waist narrower and tucked up, the croup and buttocks behind.
        const ribZ = zS - 0.27 * bl, ribLen = 0.34 * bl + 0.05;
        E([0, (chestTop + chestBottom) / 2, ribZ], [0.19 * g, (chestTop - chestBottom) / 2, ribLen], 'Chest', 0.08 * g, 'torso');
        for (const s of [1, -1]) E([s * 0.06 * g, yS - 0.05 * g * cd, zS + 0.05], [0.08 * g, 0.14 * g * cd, 0.1], 'Chest', 0.08 * g, 'torso');
        // The middle of the trunk follows the spine from the shoulders' height down (or up) to the hips'.
        const spineY = z => yH + (yS - yH) * clamp((z - zH) / (zS - zH), 0, 1);
        C(add(J.withers, [0, -0.06 * g, 0.1]), [0, spineY(-0.05 * bl) + (chestTop - 0.04 * g - yS), -0.05 * bl], 0.07 * g, 0.09 * g, 'Chest', 0.08 * g, 'back');
        const sag = r.belly * 0.06 * g;
        const bw = 1 + Math.max(0, r.belly) * 0.25;
        E([0, spineY(-0.1 * bl) + 0.17 * g - sag, -0.1 * bl], [0.165 * g * bw, 0.23 * g * (1 + 0.3 * Math.max(-0.6, r.belly)), 0.33 * bl + 0.02], 'Spine', 0.1 * g, 'belly');
        C([0, spineY(0.05 * bl) + 0.31 * g, 0.05 * bl], [0, yH + 0.3 * g, zH + 0.05], 0.1 * g, 0.115 * g, 'Spine', 0.08 * g, 'back');
        E([0, yH + 0.22 * g, zH - 0.03], [0.15 * g, 0.16 * g, 0.2], 'Hips', 0.08 * g, 'rump');
        E([0, yH + 0.08 * g, zH - 0.19], [0.12 * g, 0.12 * g, 0.09], 'Hips', 0.07 * g, 'rump');
        if (r.hump > 0) E(add(J.withers, [0, -0.02 * g, 0.02]), [0.12 * g, 0.12 * g * r.hump, 0.2 * Math.max(0.7, bl)], 'Chest', 0.05 * g, 'hump');
        // ── neck: the column, the crest of muscle over it, the throat under it.
        const nt = r.neckThickness * g;
        C(add(J.neck, [0, -0.02 * g, -0.04]), J.atlas, 0.18 * nt, 0.115 * nt * Math.sqrt(r.headSize), 'Neck', 0.06 * g, 'neck');
        C([0, J.withers[1] - 0.05 * g, zS - 0.1], add(J.atlas, mul(hu, 0.05 * nt)), 0.1 * nt, 0.08 * nt, 'Neck', 0.05 * g, 'neck');
        C([0, yS + 0.04 * g, zS + 0.1], add(J.atlas, [0, -0.06 * nt, 0.02]), 0.1 * nt, 0.07 * nt, 'Neck', 0.05 * g, 'neck');
        // ── head.
        headShapes(r, lay, S, E, C);
        // ── legs. The upper leg lies inside the trunk's skin down to the elbow and the stifle, its muscle
        // flat against the body and blended into it wide (narrowing toward the midline, so a pair never
        // webs together); below, the leg stands free with tighter joints and tendons.
        const ps = r.pawSize;
        const mid = [0.04 * g, 0.12 * g, 0.2];
        const M = s => Object.assign(s, { mid });
        // The upper legs' muscle follows the body's build as much as the leg's.
        const tw = 0.5 * lw + 0.5 * g;
        // Below the elbow and stifle a leg thins only so far, so the thinnest still holds together.
        const ll = Math.max(lw, 0.5 * Math.max(1, 0.9 * g));
        for (const side of [1, -1]) {
            const m = side > 0 ? same : mirror;
            const P = side > 0 ? 'Left' : 'Right';
            const sh = J.shoulder, el = J.frontKnee, wr = J.frontAnkle;
            // The shoulder blade flat on the ribs, up and back from the point of the shoulder to the withers.
            const sTop = [0.1 * g, J.withers[1] - 0.07 * g, zS - 0.22], sLow = add(sh, [0.02 * g, 0.05 * g, 0.03]);
            const sMid = lerp(sLow, sTop, 0.5); sMid[0] = 0.13 * g;
            M(E(m(sMid), [0.035 * g, 0.1 * g, len(sub(sTop, sLow)) / 2 + 0.02], 'Chest', 0.1 * g, 'scapula', m(sub(sTop, sLow))));
            // The upper arm: the point of the shoulder down to the elbow, the triceps filling the angle behind it.
            const ax = side * (sh[0] + 0.01 * g);
            M(flatten(C(m(add(sh, [0.01 * g, 0.02, 0.0])), m(add(el, [0, 0.03, 0.0])), 0.085 * tw, 0.05 * tw, P + 'FrontUpperLeg', 0.1 * g, 'upperleg'), ax, 1.5));
            M(flatten(C(m([sh[0], sh[1] + 0.03 * g, sh[2] - 0.13]), m(add(el, [0, 0.025, -0.03 * lw])), 0.075 * tw, 0.045 * tw, P + 'FrontUpperLeg', 0.09 * g, 'upperleg'), ax, 1.45));
            E(m(add(el, [0, 0.01, -0.04 * ll])), [0.032 * ll, 0.038 * ll, 0.034 * ll], P + 'FrontLowerLeg', 0.035 * g, 'lowerleg');
            // The forearm, full of muscle at the top and in front, slim at the carpus.
            C(m(el), m(wr), 0.06 * ll, 0.038 * ll, P + 'FrontLowerLeg', 0.05 * g, 'lowerleg');
            E(m(add(lerp(el, wr, 0.26), [0.003, 0, 0.01 * ll])), [0.055 * ll, 0.058 * ll, Math.max(0.05, len(sub(wr, el)) * 0.34)], P + 'FrontLowerLeg', 0.05 * g, 'lowerleg', m(sub(wr, el)));
            E(m(wr), [0.038 * ll, 0.038 * ll, 0.04 * ll], P + 'FrontFoot', 0.03 * g, 'lowerleg');
            footShapes(r, lay, S, E, C, m, P + 'FrontFoot', wr, J.frontToe, ps, ll, true, prof);
            const hp = J.hip, st = J.rearKnee, hk = J.rearAnkle;
            // The haunch: one broad mass from the point of the hip to the point of the buttock, tapering down
            // to the stifle; the hamstrings behind it down to the calf; its outside no wider than the ribs.
            const hx = side * halfW * 0.9, femL = len(sub(st, hp));
            M(flatten(C(m([halfW * 0.9, hp[1] + 0.02 * g, hp[2] - 0.04]), m(add(lerp(hp, st, 0.82), [0, 0, -0.005])), 0.11 * tw + 0.12 * femL, 0.06 * tw, P + 'RearUpperLeg', 0.11 * g, 'thigh'), hx, 1.9));
            M(flatten(C(m([halfW * 0.75, yH + 0.03 * g, zH - 0.16]), m(add(lerp(st, hk, 0.3), [0, 0, -0.032 * lw])), 0.07 * tw, 0.04 * lw, P + 'RearUpperLeg', 0.08 * g, 'thigh'), hx, 1.35));
            E(m(add(st, [0.006, 0.01, 0.022 * lw])), [0.038 * lw, 0.04 * lw, 0.036 * lw], P + 'RearLowerLeg', 0.04 * g, 'thigh');
            // The flank's fold: a thin web of skin from the belly down to the front of the stifle, filling the
            // angle between the belly and the thigh.
            const fa = [0.115 * g, yH + 0.04 * g - Math.max(0, r.belly) * 0.04 * g, zH + 0.22 * bl], fb = add(st, [-0.01 * g, 0.03, 0.01]);
            M(flatten(C(m(fa), m(fb), 0.1 * g + 0.08 * femL, 0.04 * tw, 'Spine', 0.12 * g, 'belly'), side * 0.115 * g, 2.0));
            // The gaskin: the tibia, the calf behind it, the tendon down to the point of the hock.
            C(m(st), m(hk), 0.05 * ll, 0.03 * ll, P + 'RearLowerLeg', 0.04 * g, 'lowerleg');
            E(m(add(lerp(st, hk, 0.3), [0, 0, -0.028 * ll])), [0.038 * ll, 0.044 * ll, Math.max(0.05, len(sub(hk, st)) * 0.3)], P + 'RearLowerLeg', 0.045 * g, 'lowerleg', m(sub(hk, st)));
            C(m(add(lerp(st, hk, 0.55), [0, 0, -0.042 * ll])), m(add(hk, [0, 0.012, -0.036 * ll])), 0.022 * ll, 0.021 * ll, P + 'RearLowerLeg', 0.03 * g, 'lowerleg');
            E(m(hk), [0.031 * ll, 0.033 * ll, 0.035 * ll], P + 'RearFoot', 0.03 * g, 'lowerleg');
            footShapes(r, lay, S, E, C, m, P + 'RearFoot', hk, J.rearToe, ps * 0.92, ll, false, prof);
        }
        // ── a thick coat rounds the trunk over the muscles: one soft mass from the chest to the buttocks
        // and over each haunch, filling the waist and the hollows between shoulder and thigh. It shapes the
        // surface only; skin weights and coat colors come from the shapes under it.
        if (r.fluff > 0.35) {
            const a = clamp((r.fluff - 0.35) / 0.6, 0, 1), top = Math.max(chestTop, yH + 0.3 * g);
            E([0, (chestBottom + top) / 2 + 0.01 * g, (zS + zH) / 2 - 0.03], [(0.16 + 0.03 * a) * g, (top - chestBottom) / 2 * (0.86 + 0.08 * a), (zS - zH) / 2 + 0.1], 'Spine', 0.09 * g * a, 'torso').envelope = true;
            for (const side of [1, -1]) M(E([side * 0.1 * g, yH + 0.1 * g, zH - 0.04], [0.11 * g, (0.18 + 0.04 * a) * g, 0.2], 'Hips', 0.08 * g * a, 'rump')).envelope = true;
        }
        // ── manes: a lion's around the face, down the neck and over the chest; a horse's crest; a ruff at the throat.
        maneShapes(r, lay, S, E, C);
        // ── anatomy: the sheath and scrotum or the vulva, and an udder where the species has one.
        if (r.anatomy && r.anatomy.detail) anatomyShapes(r, lay, S, E, C, prof);
        return S;
    }

    /** The head: cranium, forehead, brows, cheekbones, muzzle, whisker pads, nose pad, jaw and chin, eye sockets. */
    function headShapes(r, lay, S, E, C) {
        const { H, sr, mL, hd, hu, J } = lay;
        const sw = r.snoutWidth;
        const long = clamp((r.snoutLength - 0.6) / 0.8, 0, 1.6), cat = 1 - Math.min(1, long);
        const z0 = 0.55, zt = z0 + mL;
        const B = 'Head';
        const head = [];
        const e = (c, rad, k, tag) => { const s = E(c, rad.map(v => v * sr), B, k * sr, tag, hd, hu); head.push(s); return s; };
        const c = (a, b, ra, rb, k, tag) => { const s = C(a, b, ra * sr, rb * sr, B, k * sr, tag); head.push(s); return s; };
        // The braincase behind the eyes, the forehead flat and broad over them, the brows, the cheekbones.
        e(H(0, 0.06, -0.14), [0.84, 0.72, 0.95], 0.2, 'skull');
        e(H(0, 0.36, 0.34), [0.54, 0.27, 0.48], 0.18, 'skull');
        for (const s of [1, -1]) {
            e(H(s * 0.33, 0.3, 0.62), [0.27, 0.13, 0.22], 0.1, 'brow');
            e(H(s * (0.54 - 0.1 * Math.min(1, long)), -0.16, 0.2 + 0.15 * long), [0.29, 0.27 + 0.06 * long, 0.52 + 0.2 * long], 0.3, 'cheek');
            if (long > 0.35) e(H(s * 0.42, -0.5, 0.05), [0.3, 0.45, 0.55].map(v => v * Math.min(1, long)), 0.2, 'cheek');
        }
        // The muzzle and the bridge of the nose over it, straight and broad from the brows to the nose; a
        // cat's short muzzle wider than it is deep, square in front.
        c(H(0, -0.04, z0), H(0, -0.13, zt - 0.3), (0.5 - 0.06 * Math.min(1, long)) * sw * (1 - 0.25 * cat), (0.39 - 0.12 * Math.min(1, long)) * sw * (1 - 0.25 * cat), 0.16, 'snout');
        // (A small cat's short face has a small muzzle; a big cat's a deep one.)
        const deep = 0.72 + 0.28 * Math.min(1, mL / 1.25);
        if (cat > 0) e(H(0, -0.16 * deep, (z0 + zt) / 2 + 0.04), [0.47 * sw * deep, 0.42 * deep, (zt - z0) / 2 + 0.06].map(v => v * (0.75 + 0.25 * cat)), 0.16, 'snout');
        c(H(0, 0.3, z0 + 0.05), H(0, 0.12, zt - 0.17), 0.28 * sw, 0.21 * sw, 0.14, 'snout');
        // The upper lips either side of the philtrum, full over the whisker beds and hanging past the chin.
        const hoofFace = r.feet === 'hoof' && r.kind !== 'boar' && long > 0.3;
        const pad = (0.75 + 0.25 * cat) * (hoofFace ? 0.8 : 1);
        for (const s of [1, -1]) e(H(s * 0.21 * sw, -0.28 - 0.04 * cat * deep, zt - 0.3), [0.28 * sw * pad * (0.85 + 0.15 * deep), (0.3 + 0.04 * cat) * pad * deep, 0.34], 0.16, 'whisker');
        // The nose leather set into the muzzle's end, broad and flat on top; a boar's flat disc.
        const disc = r.kind === 'boar' ? 1 : 0;
        if (hoofFace) e(H(0, -0.1, zt - 0.14), [0.4 * sw, 0.36, 0.3], 0.12, 'snout');
        e(H(0, 0.04, zt + 0.0 + 0.05 * disc), [0.22 * sw * (1 + 0.5 * disc) * (hoofFace ? 0.7 : 1), 0.12 * (1 + 0.8 * disc), 0.12], 0.05, 'nosepad');
        // A paw animal's leather narrows down to the philtrum: a rounded triangle seen from the front.
        if (!disc && !hoofFace) c(H(0, 0.03, zt - 0.03), H(0, -0.12, zt - 0.05), 0.13 * sw, 0.045, 0.04, 'nosepad');
        // A paw animal's philtrum: a groove down the front of the muzzle from the nose to the lip, set where
        // the muzzle's front stands.
        if (!hoofFace && !disc) {
            const front = y => { const from = H(0, y, zt - 0.7); for (let i = 0; i < 60; i++) { const p = add(from, mul(hd, i * sr * 0.025)); if (fieldAt(head, p) > 0) return p; } return H(0, y, zt); };
            const a = front(-0.08), b = front(-0.36);
            S.push(cut(cone(sub(a, mul(hd, 0.01 * sr)), sub(b, mul(hd, 0.015 * sr)), 0.045 * sr, 0.035 * sr, B, 0.04 * sr, 'snout')));
        }
        // The nostrils, set into the surface where it stands: a hoofed long face's wide and tall on the
        // muzzle's front corners; a boar's two holes in its disc; a paw animal's small, in the pad.
        const hoofed = hoofFace;
        for (const s of [1, -1]) {
            const facing = hoofed ? norm(add(mul(hd, 0.75), [s * 0.66, 0, 0])) : norm(add(hd, [s * (disc ? 0.08 : 0.3), 0, 0]));
            const from = hoofed ? H(s * 0.1 * sw, -0.02, zt - 0.12) : H(s * (disc ? 0.12 : 0.07) * sw, disc ? 0.0 : 0.01, zt - 0.05);
            let at = null;
            for (let i = 0; i < 40; i++) {
                const p = add(from, mul(facing, i * sr * 0.02));
                if (fieldAt(head, p) > 0) { at = p; break; }
            }
            if (!at) continue;
            const nr = (hoofed ? [0.08, 0.16, 0.14] : disc ? [0.06, 0.08, 0.1] : [0.045, 0.035, 0.07]).map(v => v * sr * Math.sqrt(sw));
            const tilt = hoofed ? add(hu, [s * -0.35, 0, 0]) : hu;
            const hole = cut(ellipsoid(sub(at, mul(facing, nr[2] * 0.55)), nr, B, nr[0] * 0.5, 'nosepad', facing, tilt));
            S.push(hole);
            lay.nostrils.push({ shape: hole, R: nr[0] });
        }
        // The lower jaw from its angle to the chin, and the floor between its halves.
        for (const s of [1, -1]) c(H(s * 0.5, -0.42 - 0.04 * cat, -0.05), H(s * 0.13 * sw, -0.52 - 0.04 * cat, zt - 0.44), 0.2 + 0.03 * cat, 0.12 + 0.03 * cat, 0.12, 'jaw');
        e(H(0, -0.54 - 0.05 * cat, zt - 0.46), [0.2 * sw, 0.14 + 0.03 * cat, 0.17], 0.12, 'chin');
        e(H(0, -0.48, 0.2), [0.36, 0.22, 0.45], 0.2, 'jaw');
        // The eyes: out from the skull along their facing, to the surface, set into sockets cut around them.
        const eyeR = 0.15 * sr * r.eyeSize;
        const side = r.eyeSide;
        for (const s of [1, -1]) {
            const facing = norm(add(mul([s * (0.36 + 0.6 * side), 0, 0], 1), add(mul(hu, 0.12), mul(hd, 0.92 - 0.62 * side))));
            const from = H(s * (0.18 + 0.2 * side), 0.17, 0.42 - 0.2 * side + 0.1 * long);
            let at = from;
            for (let i = 0; i < 60; i++) {
                const p = add(from, mul(facing, i * sr * 0.025));
                if (fieldAt(head, p) > 0) { at = p; break; }
            }
            // The eye sits back in its socket, its front at the face's surface; the lids close round it in an
            // almond, the outer corner a little higher, their edges crisp.
            const center = sub(at, mul(facing, eyeR * 0.95));
            S.push(cut(ellipsoid(add(center, mul(facing, eyeR * 0.6)), [eyeR * 1.02, eyeR * 0.64, eyeR * 0.75], B, eyeR * 0.28, 'skull', facing, add(hu, [s * 0.22, 0, 0]))));
            lay.eyes.push({ center, facing, R: eyeR, side: s });
        }
        // The ears' roots on the skull.
        for (const s of [1, -1]) lay.ears.push({ base: H(s * 0.52, 0.66, -0.3), side: s });
        J.mouth = { z0, zt };
    }

    /** A paw (pads and toes, claws on a clawed foot) or a hoof (cloven or whole), under its carpus or hock. */
    function footShapes(r, lay, S, E, C, m, bone, ankle, toe, ps, lw, front, prof) {
        const g = lay.g, plant = r.plantigrade;
        if (r.feet === 'hoof') {
            const hr = 0.05 * ps * Math.sqrt(lw);
            const fet = [ankle[0], Math.max(hr * 2.2, ankle[1] * 0.3), ankle[2] + 0.01];
            const cor = [ankle[0], hr * 0.95, fet[2] + hr * 0.85];
            C(m(ankle), m(fet), 0.03 * lw, 0.027 * lw, bone, 0.02 * g, 'lowerleg');
            E(m(fet), [0.033 * lw, 0.034 * lw, 0.036 * lw], bone, 0.02 * g, 'pastern');
            C(m(fet), m(cor), 0.027 * lw, hr * 0.85, bone, 0.02 * g, 'pastern');
            if (!prof.cloven) C(m(cor), m([cor[0], 0.012, cor[2] + 0.35 * hr]), hr * 0.8, hr * 1.0, bone, 0.006, 'hoof');
            else {
                for (const s of [1, -1]) C(m([cor[0] + s * 0.36 * hr, cor[1], cor[2]]), m([cor[0] + s * 0.42 * hr, 0.012, cor[2] + 0.5 * hr]), hr * 0.46, hr * 0.52, bone, 0.006, 'hoof');
                // Dewclaws high at the back of the fetlock.
                for (const s of [1, -1]) E(m([fet[0] + s * 0.02 * lw, fet[1] * 0.75, fet[2] - 0.032 * lw]), [0.01 * lw, 0.012 * lw, 0.014 * lw], bone, 0.006, 'hoof');
            }
            return;
        }
        const pr = 0.072 * ps * (0.6 + 0.4 * g) * (front ? 1 : 0.92);
        const P = toe;
        const back = (0.8 + 1.2 * plant) * pr;
        const heel = [P[0], 0.55 * pr, P[2] - 0.5 * pr - 1.1 * plant * pr];
        C(m(ankle), m(heel), 0.034 * lw, 0.45 * pr, bone, 0.03 * g, 'pastern');
        E(m([P[0], 0.5 * pr, P[2] - 0.12 * pr - 0.6 * plant * pr]), [0.8 * pr, 0.5 * pr, back], bone, 0.12 * pr, 'paw');
        E(m([P[0], 0.3 * pr, P[2] - 0.38 * pr - 0.8 * plant * pr]), [0.55 * pr, 0.3 * pr, (0.45 + 0.6 * plant) * pr], bone, 0.1 * pr, 'pad');
        // Four toes in an arc, the middle two ahead; tight enough to show each one.
        const claw = r.feet === 'claw';
        for (const deg of [-50, -17, 17, 50]) {
            const a = deg * DEG;
            const reach = (deg === 17 || deg === -17) ? 1 : 0.86;
            const tc = [P[0] + Math.sin(a) * 0.6 * pr, 0.3 * pr, P[2] + (Math.cos(a) * 0.5 + 0.25) * pr * reach + (claw ? 0.1 * pr : 0)];
            const dir = norm([Math.sin(a) * 0.35, -0.12, 1]);
            E(m(tc), [0.26 * pr, 0.29 * pr, (claw ? 0.4 : 0.33) * pr], bone, 0.07 * pr, 'toe', m(dir));
            lay.toes.push({ tip: m(add(tc, mul(dir, (claw ? 0.36 : 0.3) * pr))), dir: m(dir), r: 0.12 * pr, bone, front, claw });
        }
    }

    /** Manes: shapes over the head and neck, roughened into locks. */
    function maneShapes(r, lay, S, E, C) {
        if (r.mane === 'none' || r.maneSize <= 0) return;
        const { J, H, sr, hd, hu, zS, yS, g } = lay;
        const ms = r.maneSize, nt = r.neckThickness * g;
        const lumpy = s => Object.assign(s, { bump: 0.012 * ms * g + 0.004, bumpScale: 13, bumpSeed: 11 });
        if (r.mane === 'lion') {
            // A ruff framing the face behind the cheeks and ears, the mass of it down the neck, a bib over the chest.
            const R = (1.0 + 0.15 * ms) * sr, size = 0.55 + 0.4 * ms;
            for (let i = 0; i < 11; i++) {
                const phi = (-130 + 260 * i / 10) * DEG;
                const at = H(Math.sin(phi) * R / sr, -0.1 + Math.cos(phi) * R / sr, -0.7 - 0.32 * Math.max(0, Math.cos(phi)));
                const out = norm(add(mul([Math.sin(phi) * 0.5, 0, 0], 1), add(mul(hu, Math.cos(phi) * 0.5), mul(hd, -1))));
                lumpy(E(at, [0.34 * sr * size, 0.34 * sr * size, 0.58 * sr * size], 'Head', 0.22 * sr, 'mane', out));
            }
            // Down the neck it is full for a lion's length of neck behind the head, then thins to a crest to the withers.
            const nape = H(0, -0.1, -1.3), wit = [0, J.withers[1] - 0.06 * g, zS - 0.1], full = lerp(nape, wit, Math.min(1, 0.42 / Math.max(1e-3, len(sub(wit, nape)))));
            lumpy(C(nape, full, (0.12 + 0.09 * ms) * nt, (0.12 + 0.08 * ms) * nt, 'Neck', 0.07 * g, 'mane'));
            if (len(sub(wit, full)) > 0.05) lumpy(C(full, wit, (0.12 + 0.08 * ms) * nt * 0.6, (0.12 + 0.08 * ms) * nt, 'Neck', 0.07 * g, 'mane'));
            lumpy(C(H(0, -0.85, -0.7), [0, yS - 0.02 * g, zS + 0.1], (0.1 + 0.07 * ms) * nt, (0.1 + 0.07 * ms) * g, 'Neck', 0.07 * g, 'mane'));
            lumpy(E([0, yS - 0.08 * g, zS + 0.09], [0.13 * g * (0.6 + 0.4 * ms), 0.2 * g * (0.6 + 0.4 * ms), 0.11 * (0.6 + 0.4 * ms)], 'Chest', 0.07 * g, 'mane'));
            lumpy(E([0, J.withers[1] - 0.02 * g, zS - 0.08], [0.17 * g * ms, 0.07 * g * ms + 0.02, 0.18 * ms], 'Chest', 0.07 * g, 'mane'));
        } else if (r.mane === 'horse') {
            const up = norm(cross(sub(J.atlas, J.neck), [1, 0, 0]));
            for (let i = 0; i < 6; i++) {
                const t0 = i / 6, t1 = (i + 1) / 6;
                const a = add(lerp(add(J.neck, [0, 0.12 * nt, -0.12]), J.atlas, t0), mul(up, -0.1 * nt)), b = add(lerp(add(J.neck, [0, 0.12 * nt, -0.12]), J.atlas, t1), mul(up, -0.085 * nt));
                lumpy(E(lerp(a, b, 0.5), [0.03 * ms + 0.008, 0.055 * ms + 0.02, len(sub(b, a)) * 0.7], 'Neck', 0.02, 'mane', sub(b, a)));
            }
            // The forelock between the ears.
            lumpy(E(H(0, 0.75, 0.15), [0.18 * sr, 0.12 * sr, 0.3 * sr].map(v => v * (0.5 + 0.5 * ms)), 'Head', 0.1 * sr, 'mane', hd));
        } else {
            lumpy(E(lerp(J.neck, J.atlas, 0.45), [0.17 * nt * (0.8 + 0.4 * ms), 0.17 * nt * (0.8 + 0.4 * ms), 0.15 * nt * (0.8 + 0.3 * ms)], 'Neck', 0.12 * g, 'mane', sub(J.atlas, J.neck)));
        }
    }

    /** The underside of the shapes built so far straight below `from`: down into them, then out at the bottom. */
    function surfaceBelow(S, from, g) {
        const list = S.filter(s => !s.cut);
        let entered = false;
        for (let y = from[1] + 0.6 * g; y > 0; y -= 0.004 * g) {
            const q = [from[0], y, from[2]], inside = fieldAt(list, q) < 0;
            if (inside) entered = true;
            else if (entered) return q;
        }
        return from;
    }

    /**
     * External genitalia and udders as a veterinary model shows them: a male's
     * sheath (prepuce) on the belly or under the tail and the scrotum, a
     * female's vulva below the tail and an udder between the thighs where the
     * species has one. Teats along the belly are small pieces of their own.
     */
    function anatomyShapes(r, lay, S, E, C, prof) {
        const { zH, yH, g, bl } = lay;
        const male = r.anatomy.sex === 'male';
        const tailBase = [0, yH + 0.12 * g, zH - 0.26];
        if (prof.genital === 'cloaca') return;
        /** The sheath on the belly's midline ahead of the thighs, its root in the skin, opening forward. */
        const belly = () => {
            const pend = prof.genital === 'pendulous';
            const root = surfaceBelow(S, [0, yH + 0.1 * g, zH + 0.24 * bl], g), front = surfaceBelow(S, [0, yH + 0.1 * g, zH + 0.46 * bl], g);
            const tip = add(front, [0, -0.012 * g - (pend ? 0.015 * g : 0), 0.015]);
            C(add(root, [0, 0.02 * g, 0]), tip, 0.03 * g, 0.026 * g, 'Spine', 0.035 * g, 'sheath');
            lay.sheathTip = tip;
        };
        if (male) {
            if (prof.genital === 'perineal') {
                // Testes in a furred scrotum set close under the anus, its neck in the skin of the perineum.
                const sy = yH - 0.015 * g, sz = zH - 0.215;
                C([0, yH + 0.07 * g, zH - 0.235], [0, sy + 0.012 * g, sz + 0.005], 0.03 * g, 0.036 * g, 'Hips', 0.03 * g, 'scrotum');
                for (const s of [1, -1]) E([s * 0.03 * g, sy, sz], [0.032 * g, 0.04 * g, 0.034 * g], 'Hips', 0.024 * g, 'scrotum');
                if (prof.sheath === 'belly') belly();
                else {
                    // The prepuce at the scrotum's lower front, a small furred mound opening back and down.
                    E([0, sy - 0.045 * g, sz + 0.03], [0.018 * g, 0.024 * g, 0.026 * g], 'Hips', 0.03 * g, 'sheath', [0, -0.55, -1]);
                    lay.sheathTip = [0, sy - 0.06 * g, sz + 0.012];
                }
            } else {
                // The sheath along the belly's midline ahead of the thighs, opening forward; the scrotum between the thighs.
                const pend = prof.genital === 'pendulous';
                belly();
                // Its neck rises into the skin between the thighs, so it hangs from the body.
                const sz = zH + 0.02, root = surfaceBelow(S, [0, yH + 0.1 * g, sz], g);
                const sy = Math.min(root[1] - 0.04 * g, pend ? yH * 0.62 : yH - 0.06 * g);
                C(add(root, [0, 0.03 * g, 0]), [0, sy + 0.02 * g, sz - 0.02], 0.035 * g, 0.03 * g, 'Hips', 0.025 * g, 'scrotum');
                for (const s of [1, -1]) E([s * 0.03 * g, sy, sz - 0.02], [0.034 * g, (pend ? 0.06 : 0.042) * g, 0.036 * g], 'Hips', 0.018 * g, 'scrotum');
            }
        } else {
            // The vulva below the anus: two labia either side of a vertical cleft.
            const vz = zH - 0.235, vy = yH + 0.02 * g;
            for (const s of [1, -1]) E([s * 0.013 * g, vy, vz], [0.014 * g, 0.036 * g, 0.018 * g], 'Hips', 0.01 * g, 'vulva', [0, -0.25, -1]);
            S.push(cut(ellipsoid([0, vy, vz - 0.014 * g], [0.004 * g, 0.03 * g, 0.012 * g], 'Hips', 0.004 * g, 'vulva', [0, -0.25, -1])));
            lay.vulva = [0, vy, vz];
            const t = prof.teats;
            if (t && t.udder) {
                const u = t.udder;
                // Hung from the skin between the thighs, never below it.
                const top = surfaceBelow(S, [0, yH, zH + 0.08], g)[1], ry = 0.07 * g * (0.5 + 0.5 * u);
                lay.udder = [0, Math.max(yH - 0.08 * g - 0.04 * u * g, top - 0.5 * ry), zH + 0.08];
                E(lay.udder, [0.09 * g * (0.6 + 0.4 * u), ry, 0.1 * (0.6 + 0.4 * u)], 'Hips', 0.04 * g, 'udder');
            }
        }
        lay.anus = tailBase;
    }

    // ── lofted pieces ──────────────────────────────────────────────────────
    /**
     * A tube along `path`, each ring an ellipse (`radius(t)` → [across, through]),
     * flattened across `flat` (a direction, or null for round) and cupped by
     * `cup` (its middle pushed back by that share of its width), with a cone
     * cap at the end. Returns { positions, index, t (per vertex 0..1 along the path) }.
     */
    function loft(path, radius, sides, flat, startCap, cup) {
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
            const Bv = norm(cross(tan, N));
            const [ra, rb] = radius(t);
            const ring = [];
            for (let k = 0; k < sides; k++) {
                const a = (k / sides) * Math.PI * 2;
                // Across N is the wide way (ra), along B the thin way (rb).
                ring.push(positions.length / 3);
                const ca = Math.cos(a);
                const bend = cup ? cup * ra * (1 - ca * ca) * (1 - t * 0.6) : 0;
                const p = add(path[i], add(mul(N, ca * ra), mul(Bv, Math.sin(a) * rb + bend)));
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
     * The lofted pieces: ears, tail, horns, tusks, claws, spines. Each { mesh, kind
     * ('coat'|'horn'|'hair'), weights: (t) → [[bone, w], …], tag }.
     */
    function loftsOf(r, lay) {
        const { J, g, ht } = lay;
        const out = [];
        const sr = J.skullR, hd = J.hdir;
        const rigid = bone => () => [[bone, 1]];
        // Ears: their open side forward, cupped.
        if (r.ears !== 'none' && r.earSize > 0) {
            const es = r.earSize * ht;
            const spec = {
                pointed: { len: 0.13, wide: 0.07, tip: 0.0, out: 0.5, up: 0.9, back: -0.05, cup: 0.35 },
                round: { len: 0.075, wide: 0.06, tip: 0.75, out: 0.62, up: 0.8, back: 0.1, cup: 0.45 },
                floppy: { len: 0.16, wide: 0.07, tip: 0.6, out: 1, up: 0.0, back: 0.1, droop: 1.3, cup: 0.1 },
                long: { len: 0.3, wide: 0.06, tip: 0.45, out: 0.3, up: 1, back: 0.25, cup: 0.4, leaf: true },
                narrow: { len: 0.13, wide: 0.045, tip: 0.1, out: 0.85, up: 0.6, back: 0.2, cup: 0.4 },
                small: { len: 0.06, wide: 0.04, tip: 0.2, out: 0.8, up: 0.5, back: 0.4, cup: 0.2 }
            }[r.ears];
            for (const ear of lay.ears) {
                const side = ear.side;
                const base = add(ear.base, mul(J.hup, -0.08 * sr));
                const droop = (spec.droop || 0) + r.earDroop;
                const dir = norm([side * spec.out, spec.up - droop * 0.9, -spec.back - Math.max(0, droop) * 0.15]);
                const L = spec.len * es;
                const pts = curve([base, add(base, mul(dir, L * 0.5)), add(add(base, mul(dir, L)), [0, -Math.max(0, droop) * L * 0.25, 0])], 8);
                // Wide across the head, thin front to back: the ear opens forward.
                const flatDir = norm([1, 0, side * 0.35]);
                // A long ear is a leaf: narrow at the root, widest near the middle, round at the tip.
                const mesh = loft(pts, t => {
                    const w = spec.wide * es * (spec.leaf
                        ? (t < 0.45 ? 0.55 + 0.45 * Math.sin(t / 0.45 * Math.PI / 2) : Math.pow(Math.max(0, 1 - Math.pow((t - 0.45) / 0.55, 2.4)), 0.5))
                        : t < 0.35 ? 0.8 + t * 0.6 : (1 - t) / 0.65 * (1 - spec.tip) + spec.tip * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.35) / 0.65, 2))));
                    return [Math.max(w, 0.003 * es), Math.max(0.008 * es, w * 0.14)];
                }, 12, flatDir, false, spec.cup * (droop > 0.6 ? 0.2 : 1));
                out.push({ mesh, kind: 'coat', weights: rigid('Head'), tag: 'ear' });
            }
        }
        // Tail.
        const tail = J.tail;
        if (r.tail !== 'none' && tail.length > 1 && len(sub(tail[tail.length - 1], tail[0])) > 1e-3) {
            const tt = r.tailThickness * g;
            const pts = curve(tail, 18);
            const bushy = r.tail === 'bushy', horse = r.tail === 'horse', thick = r.tail === 'thick';
            const radius = t => {
                let rr;
                if (bushy) rr = 0.03 * tt + 0.05 * tt * Math.sin(Math.PI * Math.min(1, t * 1.05)) * (1 - 0.25 * t);
                else if (horse) rr = 0.035 * tt + 0.06 * tt * smooth(0.05, 0.4, t) * (1 - 0.5 * t);
                else if (thick) rr = 0.085 * tt * (1 - t * 0.92) + 0.005;
                else if (r.tail === 'stub') rr = 0.06 * tt * (1 - 0.6 * t);
                else rr = (0.04 + 0.022 * (1 - smooth(0, 0.2, t))) * tt * (1 - t * 0.5);
                return horse ? [rr * 1.3, rr * 0.6] : [rr, rr];
            };
            // A tail that reaches the ground lies on it, never through it.
            pts.forEach((p, i) => { p[1] = Math.max(p[1], radius(i / (pts.length - 1))[1] + 0.003 * g); });
            const mesh = loft(pts, radius, 12, horse ? [1, 0, 0] : null, true);
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
                // The tuft's core: a small spindle of hair at the end the strands grow out of.
                const end = tail[tail.length - 1], before = tail[tail.length - 2];
                const tuft = curve([lerp(before, end, 0.55), end, add(end, mul(norm(sub(end, before)), 0.06 * tt))], 7);
                out.push({ mesh: loft(tuft, t => { const v = 0.04 * tt * Math.sin(Math.PI * clamp(t * 1.1 + 0.05, 0, 1)) + 0.004; return [v, v]; }, 10, null, true), kind: 'hair', weights: () => [['Tail3', 1]], tag: 'tuft' });
                lay.tuft = { from: lerp(before, end, 0.55), to: end, dir: norm(sub(end, before)), r: 0.04 * tt };
            }
        }
        // Claws: curved and pointed, out of each toe of a clawed foot.
        for (const toe of lay.toes) {
            if (!toe.claw) continue;
            const L = toe.r * (toe.front ? 5 : 4) * (r.plantigrade > 0.5 ? 1.3 : 1);
            const d = toe.dir;
            const pts = curve([toe.tip, add(toe.tip, add(mul(d, L * 0.5), [0, -L * 0.05, 0])), add(toe.tip, add(mul(d, L * 0.85), [0, -L * 0.4, 0]))], 7);
            out.push({ mesh: loft(pts, t => { const v = toe.r * (1 - 0.85 * t); return [v * 0.8, v]; }, 6, [1, 0, 0], true), kind: 'horn', weights: rigid(toe.bone), tag: 'claw' });
        }
        // Horns.
        const hs = r.hornSize * ht;
        if (r.horns !== 'none' && hs > 0) {
            const hornTube = (pts, r0, r1, sides = 10) => loft(pts, t => { const v = r0 + (r1 - r0) * t; return [v, v]; }, sides, null, true);
            const top = J.skull;
            for (const side of [1, -1]) {
                const s = p => [p[0] * side, p[1], p[2]];
                const base = add(top, s([sr * 0.5, sr * 0.7, sr * 0.05]));
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
            const line = [...curve([J.atlas, lerp(J.atlas, J.neck, 0.5), add(J.neck, [0, 0.18 * g, -0.05])], 6), ...curve([lay.spineF, lerp(lay.spineF, lay.spineR, 0.5), lay.spineR], 8), ...(J.tail.length > 1 ? curve(J.tail, 8) : [])];
            const boneAt = i => (i < 6 ? 'Neck' : i < 10 ? 'Chest' : i < 14 ? 'Spine' : i < 16 ? 'Hips' : i < 19 ? 'Tail' : i < 21 ? 'Tail2' : 'Tail3');
            line.forEach((p, i) => {
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
        const panel = (A, Bl, cols, sag, key) => {
            const rows = A.length;
            const grid = [];
            for (let i = 0; i < rows; i++) {
                const row = [];
                for (let j = 0; j <= cols; j++) {
                    const u = j / cols;
                    let p = lerp(A[i], Bl[i], u);
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
        const sideLine = curve([W.root, lerp(W.root, W.flank, 0.5), W.flank], fingers[0].length);
        panel(fingers[fingers.length - 1], sideLine, feathered ? 8 : 5, feathered ? 0.05 : 0.18, feather);
        const fold = [put(W.root, feathered ? 'coat' : 'membrane'), put(W.elbow, feathered ? 'coat' : 'membrane'), put(W.wrist, feathered ? 'coat' : 'membrane')];
        index.push(fold[0], fold[1], fold[2]);
        return { positions, index, tone, reach, ws };
    }

    // ── surface nets over a narrow band ────────────────────────────────────
    /**
     * Meshes the field of `shapes` at `cell`: the grid is walked in blocks of
     * four cells, a block far from every shape or wholly inside or outside
     * (judged at its center) takes one value, and only blocks the surface may
     * cross are sampled point by point, each over the shapes that can reach
     * it. Returns { positions, index, near(p) → the shape list for a point }.
     */
    function surfaceNet(shapes, cell, fieldNoise) {
        // The widest blends first, so each shape's reach is its own blend and the details settle onto the masses.
        const list = shapes.filter(s => !s.cut).sort((a, b) => b.k - a.k).concat(shapes.filter(s => s.cut));
        const noiseAmp = fieldNoise ? fieldNoise.amp : 0;
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const s of list) {
            if (s.cut) continue;
            const m = s.k + (s.bump || 0);
            for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], s.lo[i] - m); hi[i] = Math.max(hi[i], s.hi[i] + m); }
        }
        const pad = cell * 3 + noiseAmp;
        lo = lo.map(v => v - pad); hi = hi.map(v => v + pad);
        lo[1] = Math.max(lo[1], -cell * 2);
        const BS = 4;
        const X = Math.ceil((hi[0] - lo[0]) / cell / BS) * BS + 1, Y = Math.ceil((hi[1] - lo[1]) / cell / BS) * BS + 1, Z = Math.ceil((hi[2] - lo[2]) / cell / BS) * BS + 1;
        const BX = Math.ceil(X / BS), BY = Math.ceil(Y / BS), BZ = Math.ceil(Z / BS);
        const blockValue = new Float32Array(BX * BY * BZ);
        const blockAt = new Int32Array(BX * BY * BZ).fill(-1);
        const lists = new Array(BX * BY * BZ);
        const pool = [];
        // A shape reaches as far as its own blend, or a later one's: the nearest shape so far sets what the next blends with.
        const laterK = new Float64Array(list.length);
        for (let i = list.length - 2; i >= 0; i--) laterK[i] = Math.max(laterK[i + 1], list[i + 1].k);
        const reachOf = list.map((s, i) => Math.max(s.k, laterK[i]) + (s.bump || 0) + cell * 2 + noiseAmp);
        const half = (BS - 1) / 2 * cell * Math.sqrt(3);
        const p = [0, 0, 0];
        const sample = fieldNoise && fieldNoise.amp > 0
            ? (cand, q) => { const d = fieldAt(cand, q); return Math.abs(d) < noiseAmp * 2 + cell * 2 ? Math.max(d - noiseAmp * fieldNoise.at(q[0], q[1], q[2]), -q[1]) : d; }
            : fieldAt;
        const near = [];
        for (let bk = 0; bk < BZ; bk++) for (let bj = 0; bj < BY; bj++) for (let bi = 0; bi < BX; bi++) {
            const b = (bk * BY + bj) * BX + bi;
            const x0 = lo[0] + bi * BS * cell, y0 = lo[1] + bj * BS * cell, z0 = lo[2] + bk * BS * cell;
            const x1 = x0 + (BS - 1) * cell, y1 = y0 + (BS - 1) * cell, z1 = z0 + (BS - 1) * cell;
            const cand = [];
            // A flattened shape's field grows faster than the distance by its flattening: the block is judged by that.
            let lip = 1;
            for (let s = 0; s < list.length; s++) {
                const sh = list[s], rc = reachOf[s];
                if (sh.lo[0] - rc > x1 || sh.hi[0] + rc < x0 || sh.lo[1] - rc > y1 || sh.hi[1] + rc < y0 || sh.lo[2] - rc > z1 || sh.hi[2] + rc < z0) continue;
                cand.push(sh);
                if (sh.fx > lip) lip = sh.fx;
            }
            if (!cand.length || cand.every(s => s.cut)) { blockValue[b] = 1e3; continue; }
            p[0] = (x0 + x1) / 2; p[1] = (y0 + y1) / 2; p[2] = (z0 + z1) / 2;
            const d0 = fieldAt(cand, p);
            if (Math.abs(d0) > (half * 1.6 + cell * 2 + noiseAmp * 2) * lip) { blockValue[b] = d0; continue; }
            lists[b] = cand;
            blockAt[b] = pool.length;
            const vals = new Float32Array(BS * BS * BS);
            for (let k = 0; k < BS; k++) for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
                p[0] = x0 + i * cell; p[1] = y0 + j * cell; p[2] = z0 + k * cell;
                vals[(k * BS + j) * BS + i] = sample(cand, p);
            }
            pool.push(vals);
            near.push(b);
        }
        const val = (i, j, k) => {
            const b = ((k >> 2) * BY + (j >> 2)) * BX + (i >> 2), at = blockAt[b];
            return at < 0 ? blockValue[b] : pool[at][((k & 3) * BS + (j & 3)) * BS + (i & 3)];
        };
        const cubeVertex = new Map();
        const verts = [];
        const vblock = [];
        const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
        const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
        const v = new Float64Array(8);
        const vertexOf = (i, j, k) => {
            const key = (k * Y + j) * X + i;
            const known = cubeVertex.get(key);
            if (known !== undefined) return known;
            for (let c = 0; c < 8; c++) v[c] = val(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2));
            let sx = 0, sy = 0, sz = 0, n = 0;
            for (const [a, b] of edges) {
                if ((v[a] < 0) === (v[b] < 0)) continue;
                const t = v[a] / (v[a] - v[b]);
                const pa = corners[a], pb = corners[b];
                sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
            }
            if (!n) { sx = sy = sz = 0.5; n = 1; }
            verts.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
            vblock.push(((k >> 2) * BY + (j >> 2)) * BX + (i >> 2));
            const id = verts.length / 3 - 1;
            cubeVertex.set(key, id);
            return id;
        };
        const index = [];
        const quad = (a, b, c, d, flip) => {
            // Split along the shorter diagonal.
            const ac = Math.hypot(verts[a * 3] - verts[c * 3], verts[a * 3 + 1] - verts[c * 3 + 1], verts[a * 3 + 2] - verts[c * 3 + 2]);
            const bd = Math.hypot(verts[b * 3] - verts[d * 3], verts[b * 3 + 1] - verts[d * 3 + 1], verts[b * 3 + 2] - verts[d * 3 + 2]);
            const t = ac < bd ? [a, b, c, a, c, d] : [a, b, d, b, c, d];
            if (flip) for (let q = 0; q < 6; q += 3) { const x = t[q + 1]; t[q + 1] = t[q + 2]; t[q + 2] = x; }
            for (let q = 0; q < 6; q++) index.push(t[q]);
        };
        for (const b of near) {
            const bi = b % BX, bj = Math.floor(b / BX) % BY, bk = Math.floor(b / (BX * BY));
            for (let k = bk * BS; k < bk * BS + BS; k++) for (let j = bj * BS; j < bj * BS + BS; j++) for (let i = bi * BS; i < bi * BS + BS; i++) {
                if (i < 1 || j < 1 || k < 1 || i >= X - 1 || j >= Y - 1 || k >= Z - 1) continue;
                const inside = val(i, j, k) < 0;
                if ((val(i + 1, j, k) < 0) !== inside) quad(vertexOf(i, j - 1, k - 1), vertexOf(i, j, k - 1), vertexOf(i, j, k), vertexOf(i, j - 1, k), !inside);
                if ((val(i, j + 1, k) < 0) !== inside) quad(vertexOf(i - 1, j, k - 1), vertexOf(i - 1, j, k), vertexOf(i, j, k), vertexOf(i, j, k - 1), !inside);
                if ((val(i, j, k + 1) < 0) !== inside) quad(vertexOf(i - 1, j - 1, k), vertexOf(i, j - 1, k), vertexOf(i, j, k), vertexOf(i - 1, j, k), !inside);
            }
        }
        const nearList = q => {
            const bi = clamp(Math.floor((q[0] - lo[0]) / cell / BS), 0, BX - 1), bj = clamp(Math.floor((q[1] - lo[1]) / cell / BS), 0, BY - 1), bk = clamp(Math.floor((q[2] - lo[2]) / cell / BS), 0, BZ - 1);
            return lists[(bk * BY + bj) * BX + bi] || list;
        };
        return { positions: new Float32Array(verts), index, near: nearList, list };
    }

    /** Vertex neighbors as compressed rows. */
    function neighbors(n, index) {
        const count = new Int32Array(n + 1);
        for (let t = 0; t < index.length; t++) count[index[t] + 1] += 2;
        for (let v = 0; v < n; v++) count[v + 1] += count[v];
        const fill = count.slice(0, n), list = new Int32Array(count[n]);
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t], b = index[t + 1], c = index[t + 2];
            list[fill[a]++] = b; list[fill[a]++] = c; list[fill[b]++] = a; list[fill[b]++] = c; list[fill[c]++] = a; list[fill[c]++] = b;
        }
        return { start: count, list };
    }

    /** Taubin smoothing (a shrink and an equal swell a pass), so stair steps ease and nothing thins; the floor stays. */
    function relaxMesh(positions, index, passes) {
        const n = positions.length / 3;
        const { start, list } = neighbors(n, index);
        let p = Float32Array.from(positions);
        const step = (src, f) => {
            const q = new Float32Array(src.length);
            for (let v = 0; v < n; v++) {
                let x = 0, y = 0, z = 0;
                const s0 = start[v], s1 = start[v + 1], c = (s1 - s0) || 1;
                for (let i = s0; i < s1; i++) { const u = list[i]; x += src[u * 3]; y += src[u * 3 + 1]; z += src[u * 3 + 2]; }
                q[v * 3] = src[v * 3] + (x / c - src[v * 3]) * f;
                q[v * 3 + 1] = src[v * 3 + 1] < 1e-4 ? src[v * 3 + 1] : src[v * 3 + 1] + (y / c - src[v * 3 + 1]) * f;
                q[v * 3 + 2] = src[v * 3 + 2] + (z / c - src[v * 3 + 2]) * f;
            }
            return q;
        };
        for (let pass = 0; pass < passes; pass++) p = step(step(p, 0.5), -0.53);
        return p;
    }

    /** Each vertex moved onto the field's zero along its gradient. */
    function projectMesh(positions, net, cell) {
        const h = cell * 0.35;
        const q = [0, 0, 0];
        for (let v = 0; v < positions.length; v += 3) {
            const p = [positions[v], positions[v + 1], positions[v + 2]];
            const cand = net.near(p);
            for (let it = 0; it < 2; it++) {
                const d = fieldAt(cand, p);
                if (Math.abs(d) < cell * 0.01) break;
                q[0] = p[0] + h; q[1] = p[1]; q[2] = p[2]; const dx1 = fieldAt(cand, q); q[0] = p[0] - h; const dx0 = fieldAt(cand, q); q[0] = p[0];
                q[1] = p[1] + h; const dy1 = fieldAt(cand, q); q[1] = p[1] - h; const dy0 = fieldAt(cand, q); q[1] = p[1];
                q[2] = p[2] + h; const dz1 = fieldAt(cand, q); q[2] = p[2] - h; const dz0 = fieldAt(cand, q);
                const gx = (dx1 - dx0) / (2 * h), gy = (dy1 - dy0) / (2 * h), gz = (dz1 - dz0) / (2 * h), g2 = gx * gx + gy * gy + gz * gz;
                if (g2 < 1e-8) break;
                const s = clamp(d / g2, -cell, cell);
                p[0] -= gx * s; p[1] -= gy * s; p[2] -= gz * s;
            }
            positions[v] = p[0]; positions[v + 1] = Math.max(0, p[1]); positions[v + 2] = p[2];
        }
        return positions;
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

    /** An eye: a sphere whose pole looks along `facing`, rings close at the front so the iris and pupil are sharp. */
    function eyeball(c, rad, facing, up, rows, cols) {
        const f = norm(facing);
        let u = norm(sub(up, mul(f, dot(up, f))));
        const s = norm(cross(u, f));
        const positions = [], index = [], local = [];
        for (let i = 0; i <= rows; i++) {
            const th = Math.pow(i / rows, 1.35) * Math.PI;
            for (let j = 0; j <= cols; j++) {
                const ph = (j / cols) * Math.PI * 2;
                const lx = Math.sin(th) * Math.cos(ph), ly = Math.sin(th) * Math.sin(ph), lz = Math.cos(th);
                const d = add(add(mul(s, lx), mul(u, ly)), mul(f, lz));
                positions.push(c[0] + d[0] * rad, c[1] + d[1] * rad, c[2] + d[2] * rad);
                local.push(lx, ly, lz);
            }
        }
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
            const a = i * (cols + 1) + j, b = a + cols + 1;
            index.push(a, b, a + 1, a + 1, b, b + 1);
        }
        return { positions, index, local };
    }

    // ── strands: a mane, a tail's tuft, a shaggy coat ──────────────────────
    let lockPicture = null;
    /**
     * The strand picture: four lanes, each a lock of hairs (sparse to dense),
     * full at the root and tapering out to uneven tips, lighter toward them.
     */
    function lockTexture() {
        if (lockPicture) return lockPicture;
        const W = 128, Hh = 256;
        const data = new Uint8Array(W * Hh * 4);
        const rand = rng(41);
        const alpha = new Float32Array(W * Hh), lum = new Float32Array(W * Hh).fill(0.8);
        for (let lane = 0; lane < 4; lane++) {
            const count = [14, 20, 28, 36][lane];
            for (let k = 0; k < count; k++) {
                const u0 = lane * 0.25 + 0.02 + rand() * 0.21, lenS = 0.55 + rand() * 0.45;
                const lean = (rand() - 0.5) * 0.06, w0 = (0.006 + 0.006 * rand()) * W, light = 0.7 + 0.45 * rand();
                for (let y = 0; y < Hh; y++) {
                    const vv = (y + 0.5) / Hh;
                    if (vv > lenS) break;
                    const t = vv / lenS;
                    const cu = (u0 + lean * t * t) * W, w = w0 * (1 - 0.75 * t);
                    for (let x = Math.max(lane * W / 4, Math.floor(cu - w - 1)); x <= Math.min((lane + 1) * W / 4 - 1, Math.ceil(cu + w + 1)); x++) {
                        const d = Math.abs(x + 0.5 - cu) / Math.max(0.5, w);
                        if (d > 1) continue;
                        const o = y * W + x, a = (1 - d * d) * Math.min(1, (1 - t) * 5);
                        if (a > alpha[o]) { alpha[o] = a; lum[o] = light; }
                    }
                }
            }
        }
        for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
            const o = y * W + x, vv = (y + 0.5) / Hh;
            const lu = ((x + 0.5) / W % 0.25) / 0.25, edge = Math.min(1, Math.min(lu, 1 - lu) * 5);
            const a = Math.max(alpha[o], Math.max(0, 0.85 - vv * 5) * edge);
            const l = Math.min(255, Math.round(255 * 1.15 * lum[o] * (0.8 + 0.25 * Math.min(1, vv * 1.4))));
            data[o * 4] = data[o * 4 + 1] = data[o * 4 + 2] = l;
            data[o * 4 + 3] = Math.round(255 * Math.min(1, a));
        }
        lockPicture = { width: W, height: Hh, data, name: 'creaturefur.png' };
        return lockPicture;
    }

    /**
     * Strand cards: each a narrow strip from its root on the body, out of the
     * skin and along its flow, bending under its own weight (three segments),
     * carrying a lane of the strand picture. `roots`: [{ p, n, flow, len,
     * width, color, tipColor, joints, weights, lift }].
     */
    function strandCards(roots, rand) {
        const SEG = 3, per = (SEG + 1) * 2;
        const n = roots.length;
        const positions = new Float32Array(n * per * 3), normals = new Float32Array(n * per * 3), uvs = new Float32Array(n * per * 2), colors = new Float32Array(n * per * 3);
        const joints = new Uint8Array(n * per * 4), weights = new Float32Array(n * per * 4), index = new Uint32Array(n * SEG * 6);
        let vi = 0, ii = 0;
        for (const s of roots) {
            const nr = s.n, f = norm(sub(s.flow, mul(nr, dot(s.flow, nr) * 0.85)));
            // The card's width across the flow, turned about it a little so neighbors do not lie in one plane.
            let wd = norm(cross(nr, f));
            const turn = (rand() - 0.5) * 1.2;
            wd = norm(add(mul(wd, Math.cos(turn)), mul(nr, Math.sin(turn))));
            const lane = Math.floor(rand() * 4), u0 = lane * 0.25, u1 = u0 + 0.25;
            const base = vi;
            let p = s.p.slice();
            const step = s.len / SEG;
            for (let k = 0; k <= SEG; k++) {
                const t = k / SEG;
                if (k > 0) {
                    const lift = s.lift * (1 - t * 0.8);
                    const d = norm([f[0] + nr[0] * lift, f[1] + nr[1] * lift - (s.droop || 0.25) * t, f[2] + nr[2] * lift]);
                    p = add(p, mul(d, step));
                }
                const w = s.width * (1 - 0.35 * t);
                const col = mixRgb(s.color, s.tipColor || s.color, t);
                for (const side of [-1, 1]) {
                    const q = add(p, mul(wd, w * side));
                    positions.set(q, vi * 3);
                    normals.set(nr, vi * 3);
                    uvs[vi * 2] = side < 0 ? u0 : u1; uvs[vi * 2 + 1] = 0.02 + t * 0.96;
                    colors.set(col, vi * 3);
                    joints.set(s.joints, vi * 4); weights.set(s.weights, vi * 4);
                    vi++;
                }
            }
            for (let k = 0; k < SEG; k++) {
                const q = base + k * 2;
                index[ii++] = q; index[ii++] = q + 2; index[ii++] = q + 1; index[ii++] = q + 1; index[ii++] = q + 2; index[ii++] = q + 3;
            }
        }
        return { positions, normals, uvs, colors, joints, weights, index };
    }

    // ── coat ───────────────────────────────────────────────────────────────
    const LEG_TAGS = new Set(['upperleg', 'thigh', 'lowerleg', 'pastern', 'paw', 'pad', 'toe', 'hoof']);
    const LOW_LEG_TAGS = new Set(['lowerleg', 'pastern', 'paw', 'pad', 'toe', 'hoof']);
    const HEAD_TAGS = new Set(['skull', 'brow', 'snout', 'whisker', 'nosepad', 'jaw', 'chin', 'cheek', 'ear']);
    const TORSO_TAGS = new Set(['torso', 'belly', 'rump', 'back', 'hump', 'neck', 'mane', 'scapula']);

    /**
     * The coat color at a body point: the pattern, the light underside and
     * muzzle, the dark nose pad, lips and eye rims, the pads under the paws,
     * and the bare skin of the genitalia and teats. `tag` is the nearest
     * shape's.
     */
    function coatColor(r, lay, p, n, tag, C) {
        const { J, g, sr } = lay;
        const seed = r.seed % 1000;
        const ps = r.patternScale, amt = r.patternAmount;
        let col = C.coat;
        // Where the torso's middle line runs at this point.
        const torsoMid = lerp([0, J.hip[1] + 0.15 * g, J.hip[2]], [0, J.shoulder[1] + 0.15 * g, J.shoulder[2]], clamp((p[2] - J.hip[2]) / (J.shoulder[2] - J.hip[2]), 0, 1));
        const under = clamp(-n[1], 0, 1);
        const onLeg = LEG_TAGS.has(tag), lowLeg = LOW_LEG_TAGS.has(tag), onHead = HEAD_TAGS.has(tag);
        // The head's own frame: x across, y up, z forward, in skull radii.
        const rel = sub(p, J.skull), hx = Math.abs(rel[0]) / sr, hy = dot(rel, J.hup) / sr, hz = dot(rel, J.hdir) / sr;
        const { z0, zt } = J.mouth;
        const belly = smooth(0.15, 0.75, under) * (p[1] < torsoMid[1] ? 1 : 0.3);
        // Inside the legs, toward the body's middle.
        const inner = onLeg ? smooth(0.1, 0.7, -n[0] * Math.sign(p[0] || 1)) : 0;
        const muzzle = onHead ? smooth(-0.15, -0.35, hy) * smooth(z0 - 0.1, z0 + 0.3, hz) + (tag === 'chin' ? 1 : 0) + (tag === 'whisker' ? 0.85 : 0) : 0;
        const throat = tag === 'neck' || tag === 'jaw' ? smooth(0.2, 0.8, under) : 0;
        const pat = r.pattern;
        const k = x => x * amt;
        if (pat === 'countershade' || pat === 'points' || pat === 'tabby' || pat === 'saddle' || pat === 'stripes' || pat === 'spots' || pat === 'rosettes' || pat === 'scales') {
            col = mixRgb(col, C.light, k(clamp(belly + inner * 0.35 + muzzle * 0.85 + throat * 0.9, 0, 1)));
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
            // Upright bands down the trunk and the haunches, rings round the legs below the elbow and stifle.
            const knee = p[2] > 0 ? J.frontKnee[1] : J.rearKnee[1];
            const ring = onLeg ? 1 - smooth(knee, knee + 0.12 * g, p[1]) : 0;
            const along = tag === 'neck' || onHead ? p[2] * 0.8 + p[1] * 0.6 : p[2] + (p[1] * 1.3 - p[2]) * ring;
            const s = Math.sin((along * 22 / ps + warp * (pat === 'tabby' ? 2.5 : 4.5)) * Math.PI);
            const stripe = smooth(pat === 'tabby' ? 0.35 : 0.55, pat === 'tabby' ? 0.75 : 0.8, s) * (1 - belly) * (1 - muzzle);
            col = mixRgb(col, C.marking, k(stripe * (pat === 'tabby' ? 0.75 : 1)));
        } else if (pat === 'socks' || pat === 'points') {
            const sockTop = J.frontKnee[1] * (pat === 'socks' ? 0.75 : 1);
            const sock = lowLeg ? smooth(sockTop + 0.04, sockTop - 0.04, p[1]) : 0;
            const point = pat === 'points' ? clamp((tag === 'ear' ? 1 : 0) + (tag === 'snout' || tag === 'jaw' ? 0.5 : 0) + sock, 0, 1) : sock;
            col = mixRgb(col, C.marking, k(point));
            if (pat === 'socks') {
                // A blaze down the face.
                const blaze = onHead && hx < 0.18 && hy > -0.1 && hz > -0.2 ? 1 : 0;
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
            const saddle = TORSO_TAGS.has(tag) ? smooth(-0.1, 0.5, n[1]) * smooth(torsoMid[1] - 0.05, torsoMid[1] + 0.08, p[1]) : 0;
            col = mixRgb(col, C.marking, k(saddle));
        }
        if (tag === 'mane') {
            // A mane is fair at its fringe round the face and darker behind.
            const fringe = r.mane === 'lion' ? smooth(-0.9, 0.1, hz) * (onHead || hz > -2.2 ? 1 : 0) : 0;
            col = mixRgb(C.mane, mixRgb(C.mane, C.light, 0.55), fringe * 0.6);
        }
        if (onHead && r.feet !== 'hoof') {
            // Lips: a dark line where the upper lip meets the chin, out to the mouth's corner.
            const lipY = -0.4 - 0.05 * clamp((hz - z0) / (zt - z0), 0, 1);
            const lip = smooth(0.055, 0.015, Math.abs(hy - lipY)) * smooth(z0 + 0.1, z0 + 0.45, hz) * smooth(zt + 0.05, zt - 0.2, hz);
            col = mixRgb(col, mixRgb(C.nose, C.marking, 0.6), lip * 0.65);
        }
        // The lids' rims dark bare skin, a pale patch under each eye of a cat's face.
        for (const eye of lay.eyes) {
            const d = len(sub(p, eye.center)) / eye.R;
            if (d < 1.4) col = mixRgb(col, mixRgb(C.nose, [0.05, 0.04, 0.04], 0.55), smooth(1.4, 1.12, d) * 0.85);
            else if (d < 2.4 && profileOf(r).felid && r.pattern !== 'solid') col = mixRgb(col, C.light, smooth(2.4, 1.7, d) * smooth(0.2, -0.4, dot(sub(p, eye.center), J.hup) / eye.R) * 0.5 * amt);
        }
        if (tag === 'nosepad') col = C.nose;
        // Inside each nostril: dark, shading off at its rim.
        if (onHead) for (const no of lay.nostrils) {
            const d = shapeDistance(no.shape, p);
            if (d < no.R * 0.6) col = mixRgb(col, mul(C.nose, 0.35), smooth(no.R * 0.6, no.R * 0.1, d) * 0.9);
        }
        if (tag === 'hoof') col = C.hoof;
        // Pads under the paws, dark and bare.
        if ((tag === 'pad' || tag === 'toe' || tag === 'paw') && r.feet !== 'hoof' && n[1] < -0.35 && p[1] < 0.06 * g) col = mixRgb(C.nose, [0.08, 0.06, 0.06], 0.6);
        if (tag === 'scrotum') col = mixRgb(col, mixRgb(C.nose, C.coat, 0.5), 0.35);
        if (tag === 'sheath') {
            const tipD = lay.sheathTip ? len(sub(p, lay.sheathTip)) : 1;
            col = mixRgb(col, mixRgb(C.nose, [0.75, 0.5, 0.5], 0.4), smooth(0.04 * g, 0.015 * g, tipD));
        }
        if (tag === 'vulva') col = mixRgb(C.nose, [0.55, 0.32, 0.32], 0.35);
        if (tag === 'udder') col = mixRgb(col, mixRgb(C.light, [0.85, 0.65, 0.6], 0.5), 0.6);
        if (lay.anus) {
            const d = len(sub(p, lay.anus));
            if (d < 0.03 * g) col = mixRgb(col, mixRgb(C.nose, [0.1, 0.07, 0.07], 0.5), smooth(0.03 * g, 0.012 * g, d));
        }
        // A little mottling so a solid coat is not flat paint.
        const mottle = 1 + 0.06 * fbm(p[0] * 20, p[1] * 20, p[2] * 20, seed + 5, 2);
        return [col[0] * mottle, col[1] * mottle, col[2] * mottle];
    }

    // ── assembly ───────────────────────────────────────────────────────────
    /** The recipe as its sex wears it: a female grows no lion's mane and no antlers. */
    function asShown(r) {
        if (r.anatomy.sex !== 'female' || (r.mane !== 'lion' && r.horns !== 'antlers')) return r;
        return Object.assign({}, r, { mane: r.mane === 'lion' ? 'none' : r.mane, horns: r.horns === 'antlers' ? 'none' : r.horns });
    }

    /**
     * The whole creature: { parts, bones, height, plan, rig, clips, textures }.
     * `options.quality` 'preview' (coarser, for live sliders) or 'save';
     * `options.hairBudget` scales the strand cards (1 full; weak graphics less).
     */
    function build(recipe, options) {
        const given = normalizeRecipe(recipe);
        const r = asShown(given);
        const o = options || {};
        const quality = o.quality || 'save';
        const save = quality !== 'preview';
        const budget = clamp(o.hairBudget == null ? 1 : o.hairBudget, 0, 2);
        const lay = layout(r);
        const bones = bonesOf(lay);
        const boneIndex = new Map(bones.map((b, i) => [b.name, i]));
        const shapes = shapesOf(r, lay);
        const lofts = loftsOf(r, lay);
        const prof = profileOf(r);
        // Grid cell in body units, coarser for a very long body so the grid stays in bounds.
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const s of shapes) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], s.lo[i]); hi[i] = Math.max(hi[i], s.hi[i]); }
        const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
        const cell = Math.max(save ? 0.0068 : 0.019, longest / (save ? 360 : 150)) * Math.min(1.25, Math.max(0.85, lay.g));
        const seed = r.seed % 997;
        const fur = r.fluff * 0.006 * lay.g;
        const net = surfaceNet(shapes, cell, fur > 0 ? { amp: fur, at: (x, y, z) => fbm(x * 40, y * 40, z * 40, seed, 2) * 0.5 + 0.5 * Math.abs(valueNoise(x * 90, y * 90, z * 90, seed + 3)) } : null);
        let positions = relaxMesh(net.positions, net.index, 1);
        positions = projectMesh(positions, net, cell);
        let index = net.index;
        // The saved body: the fine mesh reduced where it is flat, kept where it curves.
        if (save && Decimator) {
            const target = 30000;
            if (index.length / 3 > target * 1.1) {
                // The finely painted face keeps its small faces: the muzzle and lips ahead of the eyes, the lids and rims round them.
                const locked = new Uint8Array(positions.length / 3);
                const { J } = lay, sk = J.skull, faceFrom = (J.mouth.z0 - 0.3) * J.skullR;
                const keep = lay.eyes.map(e => [e.center, e.R * 2.1]);
                let face = 0;
                for (let v = 0; v < locked.length; v++) {
                    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
                    const hz = ((y - sk[1]) * J.hdir[1] + (z - sk[2]) * J.hdir[2]) / J.skullR, hy = ((y - sk[1]) * J.hup[1] + (z - sk[2]) * J.hup[2]) / J.skullR;
                    if (hz > faceFrom / J.skullR && hz < J.mouth.zt + 0.5 && hy < 0.6 && hy > -1.1 && Math.abs(x) < 1.2 * J.skullR) { locked[v] = 2; face++; continue; }
                    for (const [c, rad] of keep) if ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < rad * rad) { locked[v] = 1; break; }
                }
                // A head grown huge keeps only its eyes' faces, so the body still comes down to its count.
                if (face > locked.length * 0.1) for (let v = 0; v < locked.length; v++) if (locked[v] === 2) locked[v] = 0;
                const d = Decimator.decimate({ positions, indices: Uint32Array.from(index), locked }, target, { boundaryWeight: 100 });
                positions = d.positions; index = Array.from(d.indices);
            }
        }
        const normals = faceNormals(positions, index);
        const vcount = positions.length / 3;
        // Per vertex: its nearest shape (for the coat) and blended bone weights.
        const C = {};
        for (const c of COLORS) C[c.key] = hexRgb(r.colors[c.key]);
        const colors = new Float32Array(vcount * 3);
        const joints = new Uint8Array(vcount * 4), weights = new Float32Array(vcount * 4);
        const tags = new Array(vcount);
        const blend = 0.035 * lay.g;
        const unions = shapes.filter(s => !s.cut && !s.envelope);
        const limbOf = unions.map(sh => { const m = /^(Left|Right)(Front|Rear)/.exec(sh.bone); return m ? m[0] : ''; });
        const upper = unions.map(sh => sh.tag === 'upperleg' || sh.tag === 'thigh');
        const unionBone = unions.map(sh => boneIndex.get(sh.bone));
        const dist = new Float64Array(unions.length);
        const reach = blend * 5;
        const byBone = new Map();
        /** The bones a point answers to (byBone filled), and its nearest shape. */
        const weigh = p => {
            let best = 0, bestD = Infinity;
            for (let s = 0; s < unions.length; s++) {
                const sh = unions[s];
                // Far past its box a shape cannot weigh in.
                const bx = Math.max(sh.lo[0] - p[0], 0, p[0] - sh.hi[0]), by = Math.max(sh.lo[1] - p[1], 0, p[1] - sh.hi[1]), bz = Math.max(sh.lo[2] - p[2], 0, p[2] - sh.hi[2]);
                if (bx > reach + 0.05 || by > reach + 0.05 || bz > reach + 0.05) { dist[s] = Infinity; continue; }
                const d = shapeDistance(sh, p);
                dist[s] = d;
                if (d < bestD) { bestD = d; best = s; }
            }
            byBone.clear();
            // A leg's skin answers to that leg and the body, never to another leg.
            const own = limbOf[best];
            for (let s = 0; s < unions.length; s++) {
                if (dist[s] === Infinity) continue;
                if (limbOf[s] && limbOf[s] !== own && (own || !upper[s])) continue;
                const w = Math.exp(-(dist[s] - bestD) / blend);
                if (w < 0.01) continue;
                const b = unionBone[s];
                byBone.set(b, (byBone.get(b) || 0) + w);
            }
            if (!byBone.size) byBone.set(boneIndex.get('Chest'), 1);
            return best;
        };
        for (let v = 0; v < vcount; v++) {
            const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
            const best = weigh(p);
            setSkin(joints, weights, v, byBone);
            tags[v] = unions[best].tag;
            const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
            const c = coatColor(r, lay, p, n, tags[v], C);
            colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
        }
        const coat = { positions: Array.from(positions), index: Array.from(index), colors: Array.from(colors), joints: Array.from(joints), weights: Array.from(weights) };
        const horn = { positions: [], index: [], colors: [], joints: [], weights: [] };
        // Lofted pieces join the coat (ears, tails) or the horn part.
        for (const piece of lofts) {
            const target = piece.kind === 'horn' ? horn : coat;
            const base = target.positions.length / 3;
            const m = piece.mesh;
            const pn = piece.tag === 'ear' ? faceNormals(Float32Array.from(m.positions), m.index) : null;
            for (let i = 0; i < m.positions.length / 3; i++) {
                const p = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
                target.positions.push(p[0], p[1], p[2]);
                const t = m.t[i];
                let c;
                if (piece.kind === 'horn') {
                    // Horns darken toward the base, tusks and spines toward the tip; claws are the hooves' color.
                    const shade = piece.tag === 'horn' ? 0.7 + 0.3 * t : 1 - 0.25 * t;
                    c = piece.tag === 'claw' ? mixRgb(C.hoof, [0.85, 0.82, 0.75], 0.25 * t) : mul(C.horn, shade);
                } else if (piece.kind === 'hair') {
                    c = mixRgb(C.mane, C.coat, piece.tag === 'tail' && r.tail === 'bushy' ? 0.7 : 0);
                    if (piece.tag === 'tuft') c = mixRgb(C.mane, C.marking, 0.5);
                    if (r.tail === 'bushy' && t > 0.85 && r.pattern !== 'solid') c = mixRgb(c, r.kind === 'fox' ? C.light : C.marking, smooth(0.85, 0.95, t));
                } else if (piece.tag === 'ear') {
                    const n = [pn[i * 3], pn[i * 3 + 1], pn[i * 3 + 2]];
                    c = coatColor(r, lay, p, n, 'ear', C);
                    // The ear's back: dark on a cat's; its inside: pale, furred.
                    const back = smooth(-0.1, -0.6, n[2]);
                    if (prof.padColor && r.pattern !== 'solid') c = mixRgb(c, C.marking, back * 0.75 * r.patternAmount * smooth(0.2, 0.6, t));
                    c = mixRgb(c, mixRgb(C.light, [0.85, 0.7, 0.66], 0.25), smooth(0.1, 0.6, n[2]) * 0.6 * smooth(0.95, 0.5, t));
                } else {
                    c = coatColor(r, lay, p, [0, 0, 1], piece.tag, C);
                    if (piece.tag === 'tail' && r.pattern === 'points') c = mixRgb(c, C.marking, smooth(0.4, 0.9, t) * r.patternAmount);
                    if (piece.tag === 'tail' && r.pattern === 'stripes') c = mixRgb(c, C.marking, (Math.sin(t * 30) > 0.3 ? 1 : 0) * r.patternAmount);
                    if (piece.tag === 'tail' && r.tail === 'tufted' && t > 0.88) c = mixRgb(c, mixRgb(C.mane, C.marking, 0.5), smooth(0.88, 0.95, t));
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
        // Teats: small rounded cones on the belly in two rows, or under the udder.
        if (r.anatomy.detail && r.anatomy.sex === 'female' && prof.teats) teatsOf(r, lay, net, coat, boneIndex, C);
        // Wings: a part of their own, seen from both sides; the root follows the chest.
        const wings = { positions: [], index: [], colors: [], joints: [], weights: [] };
        if (lay.J.wing) {
            const w = wingOf(r, lay);
            const chest = boneIndex.get('Chest');
            const tones = { bone: C.coat, coat: C.coat, membrane: mixRgb(C.marking, C.coat, 0.35), flight: mixRgb(C.coat, C.marking, 0.5), marking: C.marking };
            for (const [sideName, flip] of [['Left', same], ['Right', mirror]]) {
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
        // Eyes: in their sockets, an iris round the pupil (round, upright slit or bar across) and the white hidden in the lids.
        const eyes = { positions: [], index: [], colors: [], joints: [], weights: [] };
        const head = boneIndex.get('Head');
        const iris = hexRgb(r.colors.eye);
        for (const eye of lay.eyes) {
            const ball = eyeball(eye.center, eye.R, eye.facing, lay.hu, 10, 24);
            const base = eyes.positions.length / 3;
            for (let i = 0; i < ball.positions.length / 3; i++) {
                eyes.positions.push(ball.positions[i * 3], ball.positions[i * 3 + 1], ball.positions[i * 3 + 2]);
                const lx = ball.local[i * 3], ly = ball.local[i * 3 + 1], lz = ball.local[i * 3 + 2];
                let col;
                if (lz < 0.55) col = mixRgb(iris, [0.1, 0.07, 0.05], 0.7);
                else {
                    const pupil = prof.pupil === 'slit' ? Math.abs(lx) < 0.09 && Math.abs(ly) < 0.6 : prof.pupil === 'bar' ? Math.abs(ly) < 0.16 && Math.abs(lx) < 0.5 : Math.hypot(lx, ly) < 0.36;
                    const ring = smooth(0.62, 0.7, lz) * (1 - smooth(0.93, 0.99, lz) * 0.2);
                    col = pupil ? [0.015, 0.012, 0.012] : mixRgb(mul(iris, 0.55), mixRgb(iris, [1, 0.95, 0.8], 0.12), ring);
                }
                eyes.colors.push(col[0], col[1], col[2]);
                eyes.joints.push(head, 0, 0, 0); eyes.weights.push(1, 0, 0, 0);
            }
            for (const q of ball.index) eyes.index.push(q + base);
        }
        // Strand cards: the lion's mane and the tail's tuft, a shaggy coat over the body, as the budget allows.
        const cards = furRoots(r, lay, coat, tags, normals, vcount, C, boneIndex, budget, save);
        // Into meters, on the floor.
        const S = r.size;
        const parts = [];
        // The floor is where the feet stand: the body's lowest point (lofted pieces may dip under it).
        let minY = Infinity;
        for (let i = 1; i < vcount * 3; i += 3) minY = Math.min(minY, positions[i]);
        const place = arr => { const out = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 3) { out[i] = arr[i] * S; out[i + 1] = (arr[i + 1] - minY) * S; out[i + 2] = arr[i + 2] * S; } return out; };
        const finish = (name, part, extra) => {
            if (!part.positions.length) return;
            const pos = place(part.positions);
            const idx = Uint32Array.from(part.index);
            parts.push(Object.assign({
                name, positions: pos, normals: faceNormals(pos, idx), index: idx,
                colors: Float32Array.from(part.colors, toLinear),
                joints: Uint8Array.from(part.joints), weights: Float32Array.from(part.weights)
            }, extra));
        };
        finish('Body', coat, { roughness: 0.85 });
        finish('Horns', horn, { roughness: 0.45 });
        finish('Wings', wings, { roughness: 0.75, doubleSided: true });
        finish('Eyes', eyes, { roughness: 0.12, kind: 'eye' });
        // Gear, fitted to this body and skinned as it is.
        if (Gear && r.gear.length) {
            const skinAt = p => { weigh(p); const j4 = new Uint8Array(4), w4 = new Float32Array(4); setSkin(j4, w4, 0, byBone); return [Array.from(j4), Array.from(w4)]; };
            const headOnly = shapes.filter(s => s.bone === 'Head');
            const gearParts = Gear.build(r.gear, { r, lay, inside: p => fieldAt(net.near(p), p), insideHead: p => fieldAt(headOnly, p), skin: skinAt, loft, curve });
            for (const gp of gearParts) finish(gp.name, gp, { kind: gp.kind, roughness: gp.roughness, metalness: gp.metalness, doubleSided: true });
        }
        const textures = {};
        if (cards.roots.length) {
            const c = strandCards(cards.roots, rng(seed + 19));
            const pos = place(c.positions);
            parts.push({ name: 'Fur', positions: pos, normals: c.normals, uvs: c.uvs, colors: Float32Array.from(c.colors, toLinear), index: c.index, joints: c.joints, weights: c.weights,
                texture: 'creaturefur.png', cutout: true, alphaCutoff: 0.3, keepColors: true, doubleSided: true, roughness: 0.8, kind: 'hair', noShade: true });
            textures['creaturefur.png'] = lockTexture();
        }
        const scalePoint = p => [p[0] * S, (p[1] - minY) * S, p[2] * S];
        const outBones = bones.map(b => ({ name: b.name, parent: b.parent, head: scalePoint(b.head), tail: scalePoint(b.tail) }));
        let top = 0;
        for (const part of parts) for (let i = 1; i < part.positions.length; i += 3) top = Math.max(top, part.positions[i]);
        const markers = markersOf(lay, scalePoint);
        return { parts, bones: outBones, height: top, plan: 'quadruped', rig: { template: 'quadruped', markers }, clips: [idleClip(outBones)], textures, recipe: given };
    }

    /** The places strand cards grow, with their lie, length and color. */
    function furRoots(r, lay, coat, tags, normals, vcount, C, boneIndex, budget, save) {
        const roots = [];
        if (budget <= 0) return { roots };
        const rand = rng((r.seed % 997) + 101);
        const { J, g, sr } = lay;
        const P = coat.positions, I = coat.index, CO = coat.colors;
        const lionMane = (r.mane === 'lion' || r.mane === 'ruff') && r.maneSize > 0;
        const shag = smooth(0.12, 0.9, r.fluff);
        const maneCap = Math.round((save ? 2600 : 1300) * budget * Math.min(1.5, r.maneSize));
        const coatCap = Math.round((save ? 3200 : 1500) * budget * shag);
        const at = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
        const skinOf = v => ({ joints: coat.joints.slice(v * 4, v * 4 + 4), weights: coat.weights.slice(v * 4, v * 4 + 4) });
        // Areas of the body's triangles by kind of root.
        const maneTris = [], coatTris = [];
        let maneArea = 0, coatArea = 0;
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t], b = I[t + 1], c = I[t + 2];
            if (a >= vcount || b >= vcount || c >= vcount) continue;
            const tag = tags[a];
            const pa = at(a), pb = at(b), pc = at(c);
            const area = 0.5 * len(cross(sub(pb, pa), sub(pc, pa)));
            if (tag === 'mane' && lionMane) { maneArea += area; maneTris.push([t, maneArea]); }
            else if (shag > 0 && !(tag === 'nosepad' || tag === 'hoof' || tag === 'pad' || tag === 'vulva' || tag === 'sheath' || tag === 'udder') && !(tag === 'mane')) {
                const n = [normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]];
                // None on the soles or the face's front.
                if (n[1] < -0.8 && pa[1] < 0.1 * g) continue;
                if (HEAD_TAGS.has(tag) && dot(sub(pa, J.skull), J.hdir) / sr > 0.3) continue;
                coatArea += area; coatTris.push([t, coatArea]);
            }
        }
        const pick = (list, total) => {
            const x = rand() * total;
            let lo = 0, hi = list.length - 1;
            while (lo < hi) { const m = (lo + hi) >> 1; if (list[m][1] < x) lo = m + 1; else hi = m; }
            const t = list[lo][0];
            let s1 = rand(), s2 = rand();
            if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
            const a = I[t], b = I[t + 1], c = I[t + 2];
            const w = [1 - s1 - s2, s1, s2];
            const p = add(add(mul(at(a), w[0]), mul(at(b), w[1])), mul(at(c), w[2]));
            const n = norm(add(add(mul([normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]], w[0]), mul([normals[b * 3], normals[b * 3 + 1], normals[b * 3 + 2]], w[1])), mul([normals[c * 3], normals[c * 3 + 1], normals[c * 3 + 2]], w[2])));
            const main = w[0] > w[1] && w[0] > w[2] ? a : w[1] > w[2] ? b : c;
            return { p, n, v: main };
        };
        if (maneTris.length && maneCap > 0) {
            const mane = C.mane, fair = mixRgb(C.mane, C.light, 0.5), dark = mixRgb(C.mane, [0.05, 0.03, 0.02], 0.45);
            const ms = r.maneSize;
            for (let i = 0; i < maneCap; i++) {
                const { p, n, v } = pick(maneTris, maneArea);
                const rel = sub(p, J.skull), hz = dot(rel, J.hdir) / sr + (r.mane === 'ruff' ? -1.5 : 0);
                // Locks lie back from the face and down the neck, falling over the chest.
                const fromFace = smooth(-0.4, -1.6, hz);
                // Round the face the locks lie out from it and back, short; down the neck and chest they hang long.
                const radial = norm(sub(rel, mul(J.hdir, dot(rel, J.hdir))));
                const flow = hz > -0.6 ? norm(add(mul(radial, 0.8), mul(J.hdir, -0.6))) : norm(add(mul(J.hdir, -1), [0, -0.6 - 0.6 * fromFace, 0]));
                const fringe = smooth(-1.4, -0.2, hz);
                const color = mixRgb(mixRgb(dark, mane, 0.3 + 0.7 * rand()), fair, fringe * 0.7);
                roots.push(Object.assign({ p, n, flow, len: (0.07 + 0.1 * rand()) * (0.55 + 0.45 * ms) * g * (0.35 + 0.85 * fromFace), width: 0.028 * g * (0.8 + 0.4 * rand()), lift: 0.15 + 0.25 * rand(), droop: 0.45,
                    color, tipColor: mixRgb(color, fair, 0.35) }, skinOf(v)));
            }
        }
        if (lay.tuft && r.tail === 'tufted') {
            // The tail's tuft: strands out of its core, combed toward the tip.
            const tuftColor = mixRgb(C.mane, C.marking, 0.5);
            const t3 = boneIndex.get('Tail3');
            const count = Math.round((save ? 120 : 70) * Math.max(0.5, budget));
            const { from, to, dir } = lay.tuft;
            for (let i = 0; i < count; i++) {
                const t = rand();
                const a = rand() * Math.PI * 2;
                let side = norm(cross(dir, [0, 1, 0]));
                if (!len(side)) side = [1, 0, 0];
                const up = norm(cross(side, dir));
                const n = norm(add(mul(side, Math.cos(a)), mul(up, Math.sin(a))));
                const p = add(lerp(from, to, t), mul(n, lay.tuft.r * 0.6 * Math.sin(Math.PI * clamp(t, 0.1, 0.9))));
                roots.push({ p, n, flow: dir, len: lay.tuft.r * (1.8 + 1.6 * rand()), width: lay.tuft.r * 0.5, lift: 0.25, droop: 0.1, color: tuftColor, tipColor: mixRgb(tuftColor, C.marking, 0.3), joints: [t3, 0, 0, 0], weights: [1, 0, 0, 0] });
            }
        }
        if (coatTris.length && coatCap > 0) {
            const density = 900 * r.fluff * budget * (save ? 1 : 0.55);
            const count = Math.min(coatCap, Math.round(coatArea * density));
            for (let i = 0; i < count; i++) {
                const { p, n, v } = pick(coatTris, coatArea);
                const tag = tags[v];
                // A coat lies back along the body and down the legs and sides.
                const flow = LEG_TAGS.has(tag) ? [0, -1, -0.15] : HEAD_TAGS.has(tag) ? mul(J.hdir, -1) : [0, -0.45, -1];
                const color = [CO[v * 3], CO[v * 3 + 1], CO[v * 3 + 2]];
                roots.push(Object.assign({ p, n, flow, len: (0.018 + 0.03 * r.fluff) * g * (0.7 + 0.6 * rand()), width: 0.012 * g * (0.8 + 0.4 * rand()), lift: 0.35 + 0.2 * rand(), droop: 0.2,
                    color: mul(color, 0.97), tipColor: mixRgb(color, C.light, 0.15) }, skinOf(v)));
            }
        }
        return { roots };
    }

    /** Teats in pairs along the belly's two rows, or on an udder, each a short round-ended cone set on the skin. */
    function teatsOf(r, lay, net, coat, boneIndex, C) {
        const t = profileOf(r).teats;
        const { J, g, zS, zH, yH } = lay;
        const spots = [];
        if (t.udder) {
            const u = t.udder;
            const c = lay.udder || [0, yH - 0.08 * g - 0.04 * u * g, zH + 0.08];
            const n = t.count;
            for (let i = 0; i < n; i++) {
                const x = (n === 2 ? (i ? 1 : -1) * 0.03 : ((i % 2) ? 1 : -1) * 0.045) * g * (0.6 + 0.4 * u);
                const z = c[2] + (n === 2 ? 0.0 : (i < 2 ? 0.045 : -0.045)) * (0.6 + 0.4 * u);
                spots.push({ x, z, len: (0.035 + 0.03 * u) * g, rad: (0.009 + 0.006 * u) * g, bone: 'Hips' });
            }
        } else {
            for (let i = 0; i < t.pairs; i++) {
                const f = t.pairs === 1 ? 0.5 : t.from + (t.to - t.from) * i / (t.pairs - 1);
                const z = lerp([0, 0, zS - 0.05], [0, 0, zH + 0.2], f)[2];
                for (const s of [1, -1]) spots.push({ x: s * 0.05 * g, z, len: 0.016 * g, rad: 0.008 * g, bone: z > (zS + zH) / 2 ? 'Chest' : 'Spine' });
            }
        }
        const bone = name => boneIndex.get(name);
        for (const s of spots) {
            // Down from inside the belly to its surface.
            let p = [s.x, J.hip[1] + 0.2 * g, s.z], found = null;
            for (let i = 0; i < 200; i++) {
                const q = [s.x, p[1] - i * 0.004 * g, s.z];
                if (q[1] < 0) break;
                if (fieldAt(net.near(q), q) > 0) { found = q; break; }
            }
            if (!found) continue;
            const tip = add(found, [s.x * 0.15, -s.len, 0]);
            const mesh = loft(curve([add(found, [0, 0.004 * g, 0]), lerp(found, tip, 0.5), tip], 5), tt => { const v = s.rad * (1 - 0.35 * tt); return [v, v]; }, 8, null, false);
            const base = coat.positions.length / 3;
            const col = mixRgb(C.nose, [0.8, 0.55, 0.52], 0.45);
            for (let i = 0; i < mesh.positions.length / 3; i++) {
                coat.positions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
                const c = mixRgb(mixRgb(C.light, col, 0.5), col, mesh.t[i]);
                coat.colors.push(c[0], c[1], c[2]);
                coat.joints.push(bone(s.bone), 0, 0, 0); coat.weights.push(1, 0, 0, 0);
            }
            for (const q of mesh.index) coat.index.push(q + base);
        }
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
            head: at(head), neck: at(J.neck), hips: at(J.hips),
            tailTip: at(J.tail.length > 1 ? J.tail[J.tail.length - 1] : add(J.hips, [0, 0, -0.2]))
        };
        for (const [side, f] of [['L', same], ['R', mirror]]) {
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


    // ── poses ──────────────────────────────────────────────────────────────
    /** Poses and gaits to try a creature in, in the panel's order. */
    const POSES = [
        { id: 'walk', label: 'Walking' }, { id: 'trot', label: 'Trotting' }, { id: 'gallop', label: 'Galloping' }, { id: 'stalk', label: 'Stalking' },
        { id: 'pounce', label: 'Pouncing' }, { id: 'sit', label: 'Sitting' }, { id: 'lieDown', label: 'Lying down' }, { id: 'lieSide', label: 'Lying on the side' },
        { id: 'rear', label: 'Rearing up' }, { id: 'playBow', label: 'Play bow' }
    ];

    const qAxis = (x, y, z, a) => { const sn = Math.sin(a / 2); return [x * sn, y * sn, z * sn, Math.cos(a / 2)]; };
    const qMul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    const qRot = (q, v) => {
        const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
        return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    /** A joint's turn: pitch about x (positive swings a limb's end back, a head's nose down), then yaw about y, then roll about z. */
    const qTurn = (x = 0, y = 0, z = 0) => qMul(qAxis(0, 0, 1, z), qMul(qAxis(0, 1, 0, y), qAxis(1, 0, 0, x)));
    const TAU = Math.PI * 2;
    const wrap01 = x => ((x % 1) + 1) % 1;
    const easeIO = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
    const LEGS = [['LeftFront', true, 1], ['RightFront', true, -1], ['LeftRear', false, 1], ['RightRear', false, -1]];

    /**
     * A pose's clip for a creature's bones (as `build` returns them, meters):
     * { name, times, tracks: [{ bone, values }], heights, lift(t), skin } in
     * the RRCharacterPoses format, each track one local quaternion a time
     * relative to the unrotated rest; or null where the pose does not suit
     * the creature (rearing for a cat, a play bow on hooves).
     */
    function poseClip(bones, id, recipe) {
        if (!POSES.some(p => p.id === id)) return null;
        const at = new Map(bones.map((b, i) => [b.name, i]));
        for (const name of ['Hips', 'Chest', 'Head', 'LeftFrontUpperLeg', 'LeftRearFoot']) if (!at.has(name)) return null;
        const B = name => bones[at.get(name)];
        const r = recipe ? normalizeRecipe(recipe) : null;
        const hoofed = !!r && r.feet === 'hoof';
        const plant = r ? r.plantigrade : 0;
        if (id === 'rear' && r && !(r.feet === 'hoof' || plant > 0.5 || r.wings !== 'none')) return null;
        if (id === 'playBow' && r && r.feet === 'hoof') return null;
        const legH = B('LeftFrontUpperLeg').head[1];
        const D = Math.abs(B('LeftFrontUpperLeg').head[2] - B('LeftRearUpperLeg').head[2]) || legH;
        // Each bone's rest pitch: its forward angle from straight down.
        const restAngle = name => { const b = B(name); const d = sub(b.tail, b.head); return Math.atan2(d[2], -d[1]); };
        const gaitDef = { walk: { duty: 0.64, phases: { LeftRear: 0, LeftFront: 0.25, RightRear: 0.5, RightFront: 0.75 }, period: 1.1, front: 0.3, rear: 0.3, lift: 0.5 },
            trot: { duty: 0.45, phases: { LeftFront: 0, RightRear: 0, RightFront: 0.5, LeftRear: 0.5 }, period: 0.62, front: 0.42, rear: 0.4, lift: 0.75 },
            gallop: { duty: 0.3, phases: { LeftRear: 0, RightRear: 0.1, RightFront: 0.4, LeftFront: 0.52 }, period: 0.48, front: 0.75, rear: 0.7, lift: 1 } };
        const scaleT = Math.sqrt(Math.max(0.05, legH) / 0.75);
        const steps = gaitDef[id] ? 41 : id === 'pounce' ? 49 : 25;
        const period = gaitDef[id] ? gaitDef[id].period * scaleT : id === 'pounce' ? 1.6 * scaleT : 3;
        /** Locals for a leg from the forward angles (radians from straight down) wanted for its three bones, its parent pitched by `tilt`. */
        const chain = (leg, targets, out, tilt = 0) => {
            let parent = 0;
            ['UpperLeg', 'LowerLeg', 'Foot'].forEach((part, k) => {
                const name = leg + part;
                if (!at.has(name)) return;
                const world = restAngle(name) - (targets[k] + tilt);
                out[name] = [world - parent, 0, 0];
                parent = world;
            });
        };
        const frames = [];
        const flight = new Float32Array(steps);
        for (let f = 0; f < steps; f++) {
            const t = f / (steps - 1);
            const P = {};
            const set = (name, x = 0, y = 0, z = 0) => { if (at.has(name)) P[name] = [x, y, z]; };
            if (gaitDef[id]) {
                const G = gaitDef[id];
                for (const [leg, front] of LEGS) {
                    const ph = wrap01(t - G.phases[leg]);
                    // The protraction: forward at touchdown, back at lift-off; the swing lifts and folds the leg.
                    const stance = ph < G.duty;
                    const pr = stance ? 1 - 2 * ph / G.duty : -1 + 2 * easeIO((ph - G.duty) / (1 - G.duty));
                    const swing = stance ? 0 : Math.sin(Math.PI * (ph - G.duty) / (1 - G.duty));
                    const amp = front ? G.front : G.rear;
                    if (front) {
                        set(leg + 'UpperLeg', -amp * pr * 0.75 + 0.25 * swing * G.lift, 0, 0);
                        set(leg + 'LowerLeg', 0.55 * swing * G.lift - amp * pr * 0.25, 0, 0);
                        set(leg + 'Foot', 1.1 * swing * G.lift, 0, 0);
                    } else {
                        set(leg + 'UpperLeg', -amp * pr - 0.35 * swing * G.lift, 0, 0);
                        set(leg + 'LowerLeg', 0.6 * swing * G.lift, 0, 0);
                        set(leg + 'Foot', -0.55 * swing * G.lift + (stance ? -0.15 * (1 - pr) * 0.5 : 0), 0, 0);
                    }
                }
                const w = TAU * t;
                if (id === 'walk') {
                    // The head nods twice a stride; the hips roll and the tail swings with the hind legs.
                    set('Hips', 0, 0.04 * Math.sin(w), 0.03 * Math.sin(w));
                    set('Spine', 0, -0.03 * Math.sin(w), 0);
                    set('Chest', 0, -0.03 * Math.sin(w), -0.02 * Math.sin(w + 1.6));
                    set('Neck', 0.06 * Math.sin(2 * w + 0.6), 0.03 * Math.sin(w), 0);
                    set('Head', -0.04 * Math.sin(2 * w + 0.6), 0.02 * Math.sin(w), 0);
                    set('Tail', 0.05, 0.16 * Math.sin(w - 0.6), 0); set('Tail2', 0.04, 0.2 * Math.sin(w - 1.2), 0); set('Tail3', 0, 0.24 * Math.sin(w - 1.8), 0);
                } else if (id === 'trot') {
                    set('Hips', 0.03 * Math.sin(2 * w), 0, 0.02 * Math.sin(w));
                    set('Neck', 0.04 * Math.sin(2 * w + 1), 0, 0);
                    set('Tail', -0.15, 0.1 * Math.sin(w), 0); set('Tail2', 0.05, 0.12 * Math.sin(w - 0.8), 0); set('Tail3', 0.05, 0.14 * Math.sin(w - 1.6), 0);
                } else {
                    // The spine gathers as the hind legs reach under and stretches as they drive; the head and tail balance it.
                    const flex = Math.sin(w - 0.6);
                    set('Hips', 0.12 * flex, 0, 0);
                    set('Spine', -0.18 * flex, 0, 0);
                    set('Chest', -0.12 * flex, 0, 0);
                    set('Neck', 0.18 * flex + 0.1, 0, 0);
                    set('Head', -0.08 * flex, 0, 0);
                    set('Tail', -0.25 - 0.2 * flex, 0, 0); set('Tail2', 0.15 * flex, 0, 0); set('Tail3', 0.2 * flex, 0, 0);
                    // Two moments of flight a stride: gathered after the front feet, stretched after the hind.
                    flight[f] = 0.06 * legH * Math.max(0, Math.sin(TAU * (t - 0.62) / 0.38 * 0.5)) * (wrap01(t - 0.62) < 0.38 ? 1 : 0);
                }
            } else {
                const br = 0.01 * Math.sin(TAU * t * 2);
                const tailSwish = (a, b) => { set('Tail', a, b * Math.sin(TAU * t), 0); set('Tail2', a * 0.5, b * 1.3 * Math.sin(TAU * t - 0.8), 0); set('Tail3', a * 0.3, b * 1.6 * Math.sin(TAU * t - 1.6), 0); };
                let pitch = 0, roll = 0;
                if (id === 'sit') {
                    pitch = -0.8;
                    set('Spine', -0.05); set('Chest', -0.05 + br);
                    for (const leg of ['LeftFront', 'RightFront']) chain(leg, [-0.05, 0, 0], P, pitch - 0.1);
                    for (const leg of ['LeftRear', 'RightRear']) chain(leg, [1.35, -0.9, 1.5], P, pitch);
                    set('Neck', 0.45); set('Head', 0.3);
                    tailSwish(1.1, 0.06);
                } else if (id === 'lieDown') {
                    for (const leg of ['LeftFront', 'RightFront']) chain(leg, [-0.95, 1.5, 1.57], P);
                    for (const leg of ['LeftRear', 'RightRear']) chain(leg, [1.3, -1.7, 1.5], P);
                    set('Chest', br); set('Neck', -0.15); set('Head', 0.2, 0.15 * Math.sin(TAU * t), 0);
                    tailSwish(0.4, 0.08);
                } else if (id === 'lieSide') {
                    roll = Math.PI / 2;
                    chain('LeftFront', [0.35, 0.15, 0.3], P); chain('RightFront', [0.45, 0.25, 0.35], P);
                    chain('LeftRear', [0.55, -0.25, 0.4], P); chain('RightRear', [0.65, -0.15, 0.45], P);
                    set('Chest', br); set('Neck', -0.2, 0, 0); set('Head', -0.2, 0, 0.15);
                    tailSwish(0.15, 0.05);
                } else if (id === 'stalk') {
                    // Low and level, the head forward under the line of the back, a slow creep of the tail's tip.
                    pitch = 0.04;
                    chain('LeftFront', [-0.75, 0.5, 0.25], P, pitch); chain('RightFront', [-0.6, 0.45, 0.2], P, pitch);
                    chain('LeftRear', [0.9, -1.2, 0.5], P, pitch); chain('RightRear', [0.85, -1.15, 0.45], P, pitch);
                    set('Neck', 0.25); set('Head', -0.2);
                    set('Tail', 0.35, 0, 0); set('Tail2', 0.1, 0, 0); set('Tail3', -0.3, 0.25 * Math.sin(TAU * t * 2), 0);
                } else if (id === 'rear') {
                    // Up on the hind legs, the forelegs folded (a horse) or reaching (a bear).
                    const u = 0.5 + 0.5 * Math.sin(TAU * t - Math.PI / 2);
                    pitch = -0.95 - 0.08 * u;
                    for (const leg of ['LeftRear', 'RightRear']) chain(leg, [0.3, -0.45, 0.4], P, pitch);
                    if (hoofed) for (const leg of ['LeftFront', 'RightFront']) chain(leg, [1.5 - 0.3 * u, -0.2, -1.0], P, pitch);
                    else for (const leg of ['LeftFront', 'RightFront']) chain(leg, [2.0 - 0.2 * u, 2.1, 2.2], P, pitch);
                    set('Neck', 0.55); set('Head', 0.35 - 0.1 * u);
                    tailSwish(0.5, 0.1);
                } else if (id === 'playBow') {
                    // Elbows down and forelegs flat, the rump high, the tail up and wagging.
                    pitch = 0.42;
                    for (const leg of ['LeftFront', 'RightFront']) chain(leg, [-1.0, 1.45, 1.57], P, pitch);
                    for (const leg of ['LeftRear', 'RightRear']) chain(leg, [0.15, -0.35, 0.05], P, pitch);
                    set('Neck', -0.6); set('Head', -0.15, 0.1 * Math.sin(TAU * t * 2), 0);
                    set('Tail', -0.9, 0.35 * Math.sin(TAU * t * 3), 0); set('Tail2', -0.2, 0.45 * Math.sin(TAU * t * 3 - 0.8), 0); set('Tail3', 0, 0.5 * Math.sin(TAU * t * 3 - 1.6), 0);
                } else if (id === 'pounce') {
                    // Crouch, spring, fly stretched out, land on the forefeet, gather again.
                    const k = t;
                    const crouch = 1 - easeIO(k / 0.3) + easeIO((k - 0.85) / 0.15);
                    const stretch = easeIO((k - 0.3) / 0.12) * (1 - easeIO((k - 0.62) / 0.15));
                    const land = easeIO((k - 0.62) / 0.1) * (1 - easeIO((k - 0.85) / 0.15));
                    pitch = -0.25 * stretch + 0.15 * land + 0.05 * crouch;
                    const fr = [-0.7 * crouch + 1.0 * stretch + 0.35 * land, 0.5 * crouch + 0.6 * stretch + 0.1 * land, 0.25 * crouch + 0.3 * stretch];
                    const hr = [0.85 * crouch - 0.9 * stretch + 0.5 * land, -1.25 * crouch - 0.2 * stretch - 0.9 * land, 0.55 * crouch - 0.9 * stretch + 0.4 * land];
                    for (const leg of ['LeftFront', 'RightFront']) chain(leg, fr, P, pitch);
                    for (const leg of ['LeftRear', 'RightRear']) chain(leg, hr, P, pitch);
                    set('Neck', 0.2 * crouch - 0.1 * stretch); set('Head', -0.15 * crouch + 0.1 * stretch);
                    set('Tail', 0.3 * crouch - 0.2 * stretch, 0, 0); set('Tail2', -0.1 * stretch, 0, 0); set('Tail3', 0.2 * crouch, 0, 0);
                    flight[f] = 0.45 * legH * Math.max(0, Math.sin(Math.PI * clamp((k - 0.36) / 0.32, 0, 1)));
                }
                const hips = qMul(qTurn(0, 0, roll), qTurn(pitch, 0, 0));
                P.__hips = hips;
            }
            frames.push(P);
        }
        // Into quaternions.
        const qFrames = frames.map(P => {
            const out = {};
            for (const [name, v] of Object.entries(P)) if (name !== '__hips') out[name] = qTurn(v[0], v[1], v[2]);
            if (P.__hips) out.Hips = P.Hips ? qMul(P.__hips, out.Hips) : P.__hips;
            return out;
        });
        // Where the creature touches the floor in each frame: its feet, and for a lying or sitting pose its elbows, hocks, breastbone and seat.
        const hipJ = B('LeftRearUpperLeg').head, shJ = B('LeftFrontUpperLeg').head;
        const contacts = [];
        for (const [leg] of LEGS) {
            contacts.push([leg + 'Foot', B(leg + 'Foot').tail]);
            contacts.push([leg + 'Foot', B(leg + 'Foot').head]);
            if (at.has(leg + 'LowerLeg')) contacts.push([leg + 'LowerLeg', B(leg + 'LowerLeg').head]);
        }
        contacts.push(['Hips', [0, hipJ[1] * 0.75, hipJ[2] - 0.2 * D]], ['Chest', [0, shJ[1] * 0.7, shJ[2] + 0.02 * D]]);
        const heights = new Float32Array(steps);
        const fk = Q => {
            const rot = [], pos = [];
            bones.forEach((b, i) => {
                const q = Q[b.name] || [0, 0, 0, 1];
                if (b.parent < 0) { rot[i] = q; pos[i] = b.head.slice(); }
                else {
                    const pb = bones[b.parent], off = qRot(rot[b.parent], sub(b.head, pb.head));
                    pos[i] = add(pos[b.parent], off);
                    rot[i] = qMul(rot[b.parent], q);
                }
            });
            // The root turns about its own head.
            return (name, rest) => { const i = at.get(name); return add(pos[i], qRot(rot[i], sub(rest, bones[i].head))); };
        };
        qFrames.forEach((Q, f) => {
            const place = fk(Q);
            let low = Infinity;
            for (const [name, rest] of contacts) low = Math.min(low, place(name, rest)[1]);
            heights[f] = -low;
        });
        // A gait's weight rolls from foot to foot rather than jolting.
        if (gaitDef[id]) {
            let h = Array.from(heights);
            for (let pass = 0; pass < 2; pass++) h = h.map((v, i) => (h[(i - 1 + steps) % steps] + 2 * v + h[(i + 1) % steps]) / 4);
            h.forEach((v, i) => { heights[i] = v; });
        }
        for (let f = 0; f < steps; f++) heights[f] += flight[f];
        const times = Float32Array.from({ length: steps }, (_, i) => period * i / (steps - 1));
        const names = new Set(qFrames.flatMap(Q => Object.keys(Q)));
        const tracks = [];
        for (const name of names) {
            if (!at.has(name)) continue;
            const values = new Float32Array(steps * 4);
            qFrames.forEach((Q, i) => values.set(Q[name] || [0, 0, 0, 1], i * 4));
            tracks.push({ bone: at.get(name), values });
        }
        return {
            name: id, times, tracks, heights, skin: id === 'lieSide' || id === 'lieDown' || id === 'sit',
            lift: tm => {
                const x = ((tm % period) + period) % period / period * (steps - 1), i = Math.floor(x), k = x - i;
                return heights[i] + (heights[Math.min(steps - 1, i + 1)] - heights[i]) * k;
            }
        };
    }

    const api = { KINDS, SLIDERS, OPTIONS, COLORS, SEXES, POSES, DEFAULT_RECIPE, kindRecipe, normalizeRecipe, normalizeAnatomy, randomRecipe, build, sidecar, lockTexture, poseClip };
    root.RRCreatureBody = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

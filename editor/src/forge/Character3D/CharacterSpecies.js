/**
 * RRCharacterSpecies - who a humanoid is: species presets and the features
 * any body can grow (horns, a tail, wings, animal ears, a beak, tusks,
 * spines, whiskers).
 *
 * A species is a starting recipe on the human base: slider values, head
 * morphs (RRHumanBody.MORPHS: a snout, a flat face, ears tucked away), a
 * skin, eyes and a set of features. Everything stays editable afterwards;
 * a human given horns and a tail is a tiefling. Features are generated on
 * the shaped body from its landmarks, like accessories; a tail brings its
 * own chain of bones so it can sway.
 */
(function(root) {
    'use strict';

    const Props = root.RRCharacterProps || (typeof require === 'function' ? require('./CharacterProps.js') : null);
    const Outfit = root.RRCharacterOutfit || (typeof require === 'function' ? require('./CharacterOutfit.js') : null);
    const { add, sub, mul, norm, lerp, cross } = Props.vec;
    const linear = hex => Outfit.linear(hex);
    const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    // ── features ──────────────────────────────────────────────────────────
    const FEATURES = {
        horns: { label: 'Horns', types: [['none', 'None'], ['demon', 'Demon'], ['ram', 'Ram'], ['bull', 'Bull'], ['goat', 'Goat'], ['dragon', 'Dragon'], ['unicorn', 'Unicorn'], ['antlers', 'Antlers'], ['nubs', 'Nubs']], defaults: { size: 1, color: '#3a2a22', color2: '#d8c8a8' } },
        ears: { label: 'Animal ears', types: [['none', 'None'], ['cat', 'Cat'], ['fox', 'Fox'], ['wolf', 'Wolf'], ['rabbit', 'Rabbit'], ['bear', 'Bear'], ['mouse', 'Mouse'], ['floppy', 'Floppy']], defaults: { size: 1, color: '#8a6a4a', color2: '#e8b8a8' } },
        tail: { label: 'Tail', types: [['none', 'None'], ['lizard', 'Lizard'], ['dragon', 'Dragon'], ['cat', 'Cat'], ['fox', 'Bushy'], ['demon', 'Demon'], ['monkey', 'Monkey'], ['horse', 'Horse'], ['rabbit', 'Puff'], ['bird', 'Feathers']], defaults: { size: 1, length: 1, color: '#6a7a4a', color2: '#d8d0b0' } },
        wings: { label: 'Wings', types: [['none', 'None'], ['feathered', 'Feathered'], ['bat', 'Bat'], ['fairy', 'Fairy']], defaults: { size: 1, color: '#f2efe8', color2: '#c8c0b0' } },
        beak: { label: 'Beak', types: [['none', 'None'], ['raptor', 'Hooked'], ['crow', 'Pointed'], ['duck', 'Flat']], defaults: { size: 1, color: '#e0a830', color2: '#3a2a1a' } },
        tusks: { label: 'Tusks', types: [['none', 'None'], ['small', 'Small'], ['large', 'Large']], defaults: { size: 1, color: '#ece2c8' } },
        spines: { label: 'Spines', types: [['none', 'None'], ['ridge', 'Back ridge'], ['crest', 'Head crest'], ['both', 'Ridge and crest']], defaults: { size: 1, color: '#4a3a2a' } },
        whiskers: { label: 'Whiskers', types: [['none', 'None'], ['short', 'Short'], ['long', 'Long']], defaults: { size: 1, color: '#f0ece4' } },
        alienEyes: { label: 'Alien eyes', types: [['none', 'None'], ['almond', 'Almond'], ['round', 'Round']], defaults: { size: 1, color: '#050507' } }
    };

    function normalizeFeatures(input) {
        const out = {};
        for (const [key, def] of Object.entries(FEATURES)) {
            const f = Object.assign({ type: 'none' }, def.defaults, input && input[key]);
            if (!def.types.some(t => t[0] === f.type)) f.type = 'none';
            for (const k of ['color', 'color2']) if (!/^#[0-9a-f]{6}$/i.test(f[k] || '')) f[k] = def.defaults[k] || '#808080';
            f.size = Math.max(0.2, Math.min(3, +f.size || 1));
            if (f.length != null) f.length = Math.max(0.2, Math.min(3, +f.length || 1));
            out[key] = f;
        }
        return out;
    }

    // ── species ───────────────────────────────────────────────────────────
    // body: recipe fields; shapes; morph; skin; eyes; features; hair hints (none: bald by nature).
    const SPECIES = [
        { id: 'human', label: 'Human', group: 'Common', recipe: {} },
        { id: 'elf', label: 'Elf', group: 'Fantasy', recipe: { height: 0.68, weight: 0.32, muscle: 0.4, shapes: { earsPointed: 2.6, earSize: 0.5, cheekBones: 0.7, chinPointed: 0.5, eyeSlant: 0.6, jaw: -0.4, neckLength: 0.5 } } },
        { id: 'darkelf', label: 'Dark elf', group: 'Fantasy', recipe: { height: 0.62, weight: 0.3, shapes: { earsPointed: 3, earSize: 0.6, cheekBones: 0.9, chinPointed: 0.6, eyeSlant: 0.8, jaw: -0.4 }, skin: '#5e5470', eyes: { color: '#d8302a' } } },
        { id: 'dwarf', label: 'Dwarf', group: 'Fantasy', recipe: { height: 0.12, weight: 0.78, muscle: 0.85, headSize: 1.08, hair: { facial: { style: 'longBeard' }, brows: { style: 'bushy' } }, shapes: { legLength: -1.6, armLength: -0.6, shoulders: 1.2, chest: 1, noseDepth: 1.2, noseWidth: 1, browRidge: 0.8, handSize: 0.6, neck: 0.8 } } },
        { id: 'halfling', label: 'Halfling', group: 'Fantasy', recipe: { height: -0.35, weight: 0.6, headSize: 1.14, shapes: { legLength: -0.6, footSize: 1.6, earsPointed: 0.9, cheeks: 0.8, headFat: 0.5 } } },
        { id: 'gnome', label: 'Gnome', group: 'Fantasy', recipe: { height: -0.6, weight: 0.5, headSize: 1.3, shapes: { noseDepth: 2.2, noseVolume: 1.5, earsPointed: 1.4, earSize: 1, legLength: -0.8, cheeks: 1 } } },
        { id: 'orc', label: 'Orc', group: 'Fantasy', recipe: { height: 0.75, weight: 0.7, muscle: 1.35, hair: { style: 'mohawk', color: '#1a1410' }, shapes: { jaw: 1.6, underbite: 1.2, browRidge: 2.2, noseWidth: 1.6, noseHump: -1.2, noseTip: 1, earsPointed: 1.3, neck: 1.5, mouthWidth: 0.8 }, skin: '#6a8a4a', eyes: { color: '#c8a020' }, features: { tusks: { type: 'small' } } } },
        { id: 'goblin', label: 'Goblin', group: 'Fantasy', recipe: { height: -0.7, weight: 0.18, muscle: 0.3, headSize: 1.28, shapes: { earsPointed: 3.4, earSize: 2.6, earOut: 1.5, noseDepth: 2.2, noseLength: 1.4, chinPointed: 1, mouthWidth: 1.2, eyeSize: 0.8 }, skin: '#7a9a3a', eyes: { color: '#e8c020', pupil: 'slit' } } },
        { id: 'troll', label: 'Troll', group: 'Fantasy', recipe: { height: 1.55, weight: 0.55, muscle: 1.1, shapes: { armLength: 2.2, handSize: 2, noseDepth: 2.8, noseLength: 2.2, browRidge: 2.5, earsPointed: 2, jaw: 1, shoulders: 1.4, torsoLength: -0.6 }, skin: '#6e8a86', eyes: { color: '#e8a020' }, features: { tusks: { type: 'small', size: 0.8 } } } },
        { id: 'ogre', label: 'Ogre', group: 'Fantasy', recipe: { height: 1.45, weight: 2.1, muscle: 1.4, headSize: 0.9, shapes: { underbite: 1.6, jaw: 2, browRidge: 2, noseWidth: 2, earSize: 1 }, skin: '#a8946a', features: { tusks: { type: 'large', size: 0.9 } } } },
        { id: 'lizardfolk', label: 'Lizardfolk', group: 'Beastfolk', recipe: { height: 0.75, weight: 0.7, muscle: 1.2, morph: { snout: 0.42, muzzle: 0.1, earsAway: 1 }, shapes: { noseDepth: -1.5, noseVolume: -1, upperLip: -1, lowerLip: -1, mouthWidth: 1.8, browRidge: 1.2, browHeight: -0.6, headWidth: 1.4, jaw: 2, chinWidth: 1.4, chin: 0.6, cheekBones: 1.2, eyeSize: 1.5, eyeSpacing: 0.6, headHeight: -1.6, headSquare: 1, headBack: -1, neck: 2.2, neckLength: -0.3, shoulders: 1.2 }, skin: '#5a8a4a', skinPattern: { type: 'scales', color: '#3e6a34', belly: '#c8c890', lips: '#46703a' }, eyes: { color: '#e0c030', pupil: 'slit' }, features: { tail: { type: 'lizard', color: '#5a8a4a', color2: '#c8c890' }, spines: { type: 'ridge', size: 0.6, color: '#3e5a2a' } }, bald: true } },
        { id: 'dragonborn', label: 'Dragonborn', group: 'Beastfolk', recipe: { height: 0.8, muscle: 0.9, morph: { snout: 0.8, muzzle: 0.25, earsAway: 1 }, shapes: { browRidge: 2, noseDepth: -1.2, upperLip: -1, lowerLip: -1, neck: 1.2, shoulders: 1 }, skin: '#a8402c', skinPattern: { type: 'scales', color: '#7a2a1c', belly: '#e0b070' }, eyes: { color: '#ffb020', pupil: 'slit' }, features: { horns: { type: 'dragon', color: '#2a1e18', color2: '#e8d8b8' }, tail: { type: 'dragon', color: '#a8402c', color2: '#e0b070' }, spines: { type: 'crest', color: '#5a2414' } }, bald: true } },
        { id: 'birdfolk', label: 'Birdfolk', group: 'Beastfolk', recipe: { weight: 0.3, morph: { flat: 1, earsAway: 1 }, shapes: { noseDepth: -3, noseVolume: -2, upperLip: -1.5, lowerLip: -1.5, mouthWidth: -1, eyeSize: 1.2, neckLength: 0.8 }, skin: '#8a6a4a', skinPattern: { type: 'feathers', color: '#5a4030', belly: '#e8dcc8' }, eyes: { color: '#e8a020' }, features: { beak: { type: 'raptor' }, wings: { type: 'feathered', size: 0.75, color: '#7a5a3a', color2: '#e8dcc8' }, tail: { type: 'bird', color: '#6a4a2a', color2: '#f0e8d8' } }, bald: true } },
        { id: 'catfolk', label: 'Catfolk', group: 'Beastfolk', recipe: { weight: 0.38, bodyHair: { amount: 0.6, pattern: 'furry', fur: 0.5, length: 0.7, color: '#c8924a' }, morph: { snout: 0.32, muzzle: 0.55, earsAway: 1 }, shapes: { noseDepth: -1, noseWidth: -0.4, eyeSize: 0.8, eyeSlant: 0.8, cheekBones: 0.6, upperLip: -0.6 }, skin: '#c8924a', skinPattern: { type: 'stripes', color: '#7a4a1a', belly: '#f0e0c8' }, eyes: { color: '#7ad040', pupil: 'slit' }, features: { ears: { type: 'cat', color: '#c8924a' }, tail: { type: 'cat', color: '#c8924a', color2: '#7a4a1a' }, whiskers: { type: 'long' } } } },
        { id: 'werewolf', label: 'Werewolf', group: 'Beastfolk', recipe: { height: 0.7, muscle: 1.1, weight: 0.55, morph: { snout: 0.22, muzzle: 0.15 }, shapes: { browRidge: 2.2, earsPointed: 2.2, earSize: 1.2, noseWidth: 0.8, jaw: 0.9, cheekBones: 0.8, shoulders: 1, handSize: 0.6 }, skin: '#b08a6a', eyes: { color: '#f0c020' }, bodyHair: { amount: 1, pattern: 'werewolf', fur: 0.75, length: 1.2, color: '#4a3424' }, hair: { style: 'messy', color: '#4a3424', fringe: 0, facial: { style: 'muttonChops', color: '#4a3424' }, brows: { style: 'bushy' } } } },
        { id: 'wolffolk', label: 'Wolffolk', group: 'Beastfolk', recipe: { height: 0.65, muscle: 0.8, hair: { style: 'buzz', color: '#5a5450' }, bodyHair: { amount: 1, pattern: 'werewolf', fur: 0.9, length: 1.1, color: '#6a6460' }, morph: { snout: 0.85, muzzle: 0.45, earsAway: 1 }, shapes: { noseDepth: -1, upperLip: -0.8, browRidge: 1, neck: 1 }, skin: '#7a7470', skinPattern: { type: 'fur', color: '#4a4440', belly: '#d8d4cc' }, eyes: { color: '#e8c030' }, features: { ears: { type: 'wolf', color: '#6a6460' }, tail: { type: 'fox', color: '#7a7470', color2: '#d8d4cc' } } } },
        { id: 'rabbitfolk', label: 'Rabbitfolk', group: 'Beastfolk', recipe: { height: 0.35, weight: 0.4, bodyHair: { amount: 0.6, pattern: 'werewolf', fur: 0.7, length: 0.8, color: '#d8c8b0' }, morph: { snout: 0.25, muzzle: 0.5, earsAway: 1 }, shapes: { noseDepth: -0.6, footSize: 2, upperLip: -0.5, eyeSize: 1 }, skin: '#c8b8a0', skinPattern: { type: 'fur', color: '#a89878', belly: '#f2ece2' }, eyes: { color: '#6a3a1a' }, features: { ears: { type: 'rabbit', color: '#c8b8a0' }, tail: { type: 'rabbit', color: '#f2ece2' }, whiskers: { type: 'short' } } } },
        { id: 'minotaur', label: 'Minotaur', group: 'Beastfolk', recipe: { height: 1.5, weight: 0.8, muscle: 1.7, hair: { style: 'buzz', color: '#2a1a10' }, bodyHair: { amount: 1, pattern: 'werewolf', fur: 0.7, length: 1, color: '#3a2414' }, morph: { snout: 0.7, muzzle: 0.05, earsAway: 0.6 }, shapes: { noseWidth: 2, nostrils: 2, neck: 2.4, shoulders: 1.6, browRidge: 1.5 }, skin: '#5a3a24', skinPattern: { type: 'fur', color: '#3a2414', belly: '#7a5a3a' }, eyes: { color: '#2a1a10' }, features: { horns: { type: 'bull', size: 1.3, color: '#e8dcc0', color2: '#3a2a1a' }, tail: { type: 'horse', color: '#2a1a10' } } } },
        { id: 'tiefling', label: 'Tiefling', group: 'Otherworldly', recipe: { shapes: { cheekBones: 0.8, chinPointed: 0.6, earsPointed: 1.6 }, skin: '#b0463e', eyes: { color: '#f0d020', pupil: 'none' }, features: { horns: { type: 'demon', color: '#2a1e1e', color2: '#5a4a4a' }, tail: { type: 'demon', color: '#b0463e' } } } },
        { id: 'demon', label: 'Demon', group: 'Otherworldly', recipe: { height: 1.4, muscle: 1.6, weight: 0.7, shapes: { browRidge: 2.5, cheekBones: 1.5, jaw: 1.2, earsPointed: 2.5, chinPointed: 1 }, skin: '#7a1e1e', skinPattern: { type: 'scales', color: '#5a1212', belly: '#3a0a0a' }, eyes: { color: '#ffd020', pupil: 'slit', sclera: '#1a0808' }, features: { horns: { type: 'ram', size: 1.3, color: '#1a1414', color2: '#6a5a50' }, tail: { type: 'demon', color: '#7a1e1e' }, wings: { type: 'bat', color: '#3a1010', color2: '#5a1818' } }, bald: true } },
        { id: 'angel', label: 'Angel', group: 'Otherworldly', recipe: { height: 0.75, shapes: { cheekBones: 0.5 }, skin: '#f0d8c4', eyes: { color: '#5aa8e8' }, features: { wings: { type: 'feathered', size: 0.95, color: '#ffffff', color2: '#e8e4dc' } }, props: [{ id: 'halo' }] } },
        { id: 'fairy', label: 'Fairy', group: 'Otherworldly', recipe: { height: -0.5, weight: 0.2, headSize: 1.12, shapes: { earsPointed: 2.2, eyeSize: 1.5, chinPointed: 0.8 }, skin: '#f2dcd0', eyes: { color: '#40c8a0' }, features: { wings: { type: 'fairy', color: '#bfeaff', color2: '#ffffff' } } } },
        { id: 'undead', label: 'Undead', group: 'Otherworldly', recipe: { weight: -0.2, muscle: 0.1, shapes: { headFat: -1.5, cheeks: -2, eyeBags: 2, headAge: 1.5 }, age: 60, skin: '#8a9a80', skinPattern: { type: 'decay', color: '#5a6a50' }, eyes: { color: '#e8f0e0', pupil: 'none', sclera: '#2a3028' } } },
        { id: 'alien', label: 'Grey alien', group: 'Otherworldly', recipe: { height: 0.2, weight: 0.05, headSize: 1.45, morph: { earsAway: 1, earHoles: 0.6, flat: 0.35 }, shapes: { eyeSize: 1.2, noseDepth: -1.6, noseVolume: -1, noseWidth: -1, nostrils: 1.5, noseHump: -1, mouthWidth: -1.3, upperLip: -1.3, lowerLip: -1.3, mouthCorners: -0.8, chinPointed: 1.2, chinHeight: -1, jaw: -1.5, chinWidth: -1.2, cheeks: -1, headFat: -1, neck: -1.5, headWidth: 0.5 }, skin: '#737c84', skinPattern: { lips: '#666e75' }, eyes: { color: '#0a0a0e', pupil: 'none', sclera: '#0a0a0e', catchlight: false }, features: { alienEyes: { type: 'almond' } }, bald: true } },
        { id: 'android', label: 'Android', group: 'Otherworldly', recipe: { skin: '#d8dce2', skinPattern: { type: 'panels', color: '#8a9098' }, eyes: { color: '#30b8ff', pupil: 'none' }, bald: true } }
    ];
    const BY_ID = new Map(SPECIES.map(s => [s.id, s]));

    /** A recipe for a species: its preset over the average body, keeping the name, gender and age asked for. */
    function speciesRecipe(id, keep) {
        const s = BY_ID.get(id) || BY_ID.get('human');
        const r = JSON.parse(JSON.stringify(s.recipe));
        r.species = s.id;
        if (keep) for (const k of ['gender', 'age', 'ancestry']) if (keep[k] != null && r[k] == null) r[k] = keep[k];
        return r;
    }

    // ── making features ───────────────────────────────────────────────────
    function headPoint(L, y, angle, out = 0) {
        const R = L.ring(y, 0.014) || L.ring(L.brow, 0.02);
        return { p: [R.center[0] + Math.sin(angle) * (R.rx + out), y, R.center[2] + Math.cos(angle) * (R.rz + out)], n: norm([Math.sin(angle) / R.rx, 0, Math.cos(angle) / R.rz]), R };
    }

    function horns(m, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head), s = f.size;
        const base = linear(f.color), tip = linear(f.color2 || f.color);
        const color = t => mixRgb(base, tip, t * t);
        const H = L.crown - L.brow;
        if (f.type === 'unicorn') {
            const at = headPoint(L, L.brow + H * 0.35, 0, -0.004);
            const pts = [];
            for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push(add(at.p, [0, t * 0.2 * s, t * 0.08 * s])); }
            m.tube(pts, t => 0.016 * s * (1 - t) + 0.0015, 10, (t, a) => mixRgb(base, tip, 0.5 + 0.5 * Math.sin(a * 2 + t * 40)), skin);
            return;
        }
        if (f.type === 'antlers') {
            for (const side of [1, -1]) {
                const at = headPoint(L, L.crown - H * 0.2, side * 0.75, -0.006);
                const main = [];
                for (let k = 0; k <= 10; k++) { const t = k / 10; main.push(add(at.p, [side * t * 0.12 * s, t * 0.26 * s, -t * 0.06 * s + Math.sin(t * 3) * 0.03 * s])); }
                m.tube(main, t => 0.012 * s * (1 - t * 0.7), 6, color, skin);
                for (const [k, len] of [[3, 0.1], [6, 0.09], [8, 0.07]]) {
                    const from = main[k];
                    m.tube([from, add(from, [side * len * 0.2 * s, len * 0.6 * s, len * 0.8 * s]), add(from, [side * len * 0.3 * s, len * s, len * 0.9 * s])], t => 0.007 * s * (1 - t * 0.8), 5, color, skin);
                }
            }
            return;
        }
        for (const side of [1, -1]) {
            let at, path;
            const P = (t, fn) => fn(t);
            if (f.type === 'ram') {
                at = headPoint(L, L.crown - H * 0.25, side * 1.05, -0.008);
                path = t => { const a = t * Math.PI * 1.7; const r = 0.055 * s * (1 - t * 0.35); return add(at.p, [side * (0.02 + t * 0.03) * s, Math.sin(a) * r + 0.01, -Math.cos(a) * r + r * 0.8 - 0.02]); };
            } else if (f.type === 'bull') {
                at = headPoint(L, L.crown - H * 0.25, side * 1.2, -0.008);
                path = t => add(at.p, [side * t * 0.2 * s, Math.pow(t, 2.2) * 0.12 * s, t * 0.06 * s]);
            } else if (f.type === 'goat') {
                at = headPoint(L, L.crown - H * 0.12, side * 0.5, -0.006);
                path = t => add(at.p, [side * t * 0.03 * s, Math.sin(t * 1.4) * 0.12 * s, -Math.pow(t, 1.6) * 0.16 * s]);
            } else if (f.type === 'dragon') {
                at = headPoint(L, L.crown - H * 0.25, side * 0.7, -0.006);
                path = t => add(at.p, [side * t * 0.05 * s, t * 0.06 * s + Math.pow(t, 2) * 0.02, -t * 0.24 * s]);
            } else if (f.type === 'nubs') {
                at = headPoint(L, L.brow + H * 0.25, side * 0.45, -0.004);
                path = t => add(at.p, mul(norm(add(at.n, [0, 1.2, 0])), t * 0.025 * s));
            } else {
                // Demon: up from the brow, sweeping back.
                at = headPoint(L, L.brow + H * 0.3, side * 0.42, -0.006);
                path = t => add(at.p, [side * t * 0.035 * s, Math.sin(t * 1.6) * 0.13 * s, -Math.pow(t, 1.8) * 0.1 * s]);
            }
            const pts = [];
            for (let k = 0; k <= 14; k++) pts.push(P(k / 14, path));
            const r0 = (f.type === 'nubs' ? 0.012 : f.type === 'bull' ? 0.024 : f.type === 'ram' ? 0.026 : 0.018) * Math.sqrt(s);
            m.tube(pts, t => r0 * (1 - t * 0.92), 9, color, skin);
        }
    }

    function animalEars(m, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head), s = f.size;
        const outer = linear(f.color), inner = linear(f.color2 || '#e8b8a8');
        const H = L.crown - L.brow;
        const shape = { cat: [0.07, 0.045, 0], fox: [0.1, 0.05, 0], wolf: [0.095, 0.045, 0], rabbit: [0.24, 0.04, 0.05], bear: [0.04, 0.04, 0], mouse: [0.05, 0.06, 0], floppy: [0.13, 0.05, -1] }[f.type] || [0.07, 0.045, 0];
        const [tall, wide, lean] = shape;
        for (const side of [1, -1]) {
            const at = headPoint(L, L.crown - H * (f.type === 'floppy' ? 0.45 : 0.3), side * (f.type === 'rabbit' ? 0.55 : 0.85), -0.012);
            const up = norm(add(mul(at.n, f.type === 'floppy' ? 1.2 : 0.45), [0, 1, 0]));
            const fwd = norm(cross(up, [side, 0, 0]));
            const round = f.type === 'bear' || f.type === 'mouse';
            m.loft(9, (i, t) => {
                let dir = up;
                if (lean < 0) dir = norm(lerp(up, [side * 0.4, -1, 0.15], t));
                const center = add(at.p, mul(dir, t * tall * s));
                const w = round ? Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2))) * wide : wide * (1 - t) * (lean < 0 ? 0.9 + 0.3 * Math.sin(t * Math.PI) : 1);
                return { center, x: norm(cross(fwd, dir)), y: fwd, rx: Math.max(0.0015, w * s), ry: Math.max(0.001, w * s * 0.28) };
            }, 10, (t, a) => (Math.sin(a) > 0.2 && t < 0.85 ? inner : outer), skin, true);
        }
    }

    /** The tail's path from the base of the spine, and its thickness along it. */
    function tailShape(type, len, s) {
        const T = {
            lizard: { r: t => 0.065 * s * Math.pow(1 - t, 1.3) + 0.004, path: t => [0, -0.45 * t * t * len, -len * t] },
            dragon: { r: t => 0.08 * s * Math.pow(1 - t, 1.2) + 0.005, path: t => [Math.sin(t * 3) * 0.08 * len, -0.4 * t * t * len, -len * t * 1.1] },
            cat: { r: t => 0.018 * s * (1 - t * 0.4), path: t => [0, Math.sin(t * Math.PI * 0.9) * 0.25 * len - t * 0.1 * len, -Math.cos(t * 0.6) * t * len * 0.8] },
            fox: { r: t => (0.03 + 0.07 * Math.sin(Math.min(1, t * 1.15) * Math.PI)) * s + 0.006, path: t => [0, Math.sin(t * Math.PI * 0.6) * 0.18 * len - 0.12 * t * len, -t * len * 0.8] },
            demon: { r: t => 0.012 * s * (1 - t * 0.5), path: t => [Math.sin(t * 4) * 0.05 * len, -0.35 * Math.sin(t * Math.PI * 0.7) * len + t * 0.15 * len, -t * len * 0.85] },
            monkey: { r: t => 0.014 * s, path: t => { const curl = Math.max(0, t - 0.7) / 0.3; return [0, Math.sin(t * Math.PI * 0.8) * 0.3 * len + Math.sin(curl * 5) * 0.06, -t * len * 0.8 + (1 - Math.cos(curl * 5)) * 0.04]; } },
            horse: { r: t => (0.03 + t * 0.03) * s, path: t => [0, -t * len * 0.7, -0.08 * len - t * 0.12 * len] },
            rabbit: { r: t => Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2))) * 0.045 * s + 0.001, path: t => [0, 0, -t * 0.08 * s] },
            bird: { r: t => 0.02 * s, path: t => [0, -t * 0.15 * len, -t * 0.12 * len] }
        };
        return T[type] || T.lizard;
    }

    /** The tail's base: the back of the pelvis, just above the seat. */
    function tailBase(pack, L) {
        const an = Outfit.anatomy(pack), P = L.P;
        let best = null;
        for (const v of pack._bodyIds) {
            if (an.member[v * 5] < 0.6 || Math.abs(P[v * 3]) > 0.02) continue;
            const s = an.s[v * 5];
            if (s < 0.25 || s > 0.75) continue;
            if (!best || P[v * 3 + 2] < best[2]) best = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
        }
        return best || add(L.bone('Hips').head, [0, 0, -0.1]);
    }

    function tail(m, pack, L, f, bones, boneBase) {
        const s = f.size, len = 0.9 * (f.length || 1);
        const shape = tailShape(f.type, len, s);
        const base = add(tailBase(pack, L), [0, 0, 0.015]);
        const count = 24;
        const pts = Array.from({ length: count + 1 }, (_, k) => add(base, shape.path(k / count)));
        // The tail's bones: a chain from the hips, five along the tail.
        const chain = 5, hips = L.boneIndex('Hips');
        const at = t => pts[Math.min(count, Math.round(t * count))];
        for (let b = 0; b < chain; b++) bones.push({ name: b ? 'Tail' + (b + 1) : 'Tail', parent: b ? bones.length - 1 + boneBase : hips, head: at(b / chain), tail: at((b + 1) / chain), local: true });
        const first = boneBase + bones.length - chain;
        const skinAt = t => {
            const x = Math.min(chain - 1e-6, t * chain), i = Math.floor(x), w = x - i;
            const next = Math.min(chain - 1, i + 1);
            return { joints: [first + i, first + next, 0, 0], weights: [1 - w * 0.5, w * 0.5, 0, 0] };
        };
        const main = linear(f.color), tip = linear(f.color2 || f.color);
        if (f.type === 'bird') {
            // A fan of tail feathers.
            for (let k = -4; k <= 4; k++) {
                const dir = norm([k * 0.12, -0.6, -1]);
                const a = base, b = add(base, mul(dir, 0.32 * s * (1 - Math.abs(k) * 0.06)));
                const right = norm(cross(dir, [0, 1, 0]));
                m.loft(6, (i, t) => ({ center: lerp(a, b, t), x: right, y: [0, 1, 0], rx: 0.022 * s * Math.sin(Math.max(0.15, t) * Math.PI) + 0.002, ry: 0.002 }), 6, t => mixRgb(main, tip, t > 0.8 ? 1 : 0), skinAt(0.3), true);
            }
            return;
        }
        if (f.type === 'horse') {
            for (let k = 0; k < 14; k++) {
                const off = [Math.cos(k * 2.3) * 0.02, 0, Math.sin(k * 2.3) * 0.02];
                const strand = Array.from({ length: 9 }, (_, q) => add(add(pts[Math.round(q / 8 * count)], mul(off, 1 + q * 0.3)), [0, 0, 0]));
                m.tube(strand, t => 0.012 * (1 - t * 0.7), 4, t => mixRgb(main, tip, t), p => skinAt(Math.min(1, (base[1] - p[1]) / (len * 0.7))), true);
            }
            return;
        }
        m.tube(pts, t => shape.r(t), 12, (t, a) => {
            // Lighter underneath.
            const under = Math.max(0, Math.sin(a)) ** 2;
            const c = mixRgb(main, tip, f.type === 'cat' ? (t > 0.88 ? 1 : 0) : under * 0.6);
            return f.type === 'fox' && t > 0.85 ? linear('#f4f0e8') : c;
        }, p => {
            let best = 0, bd = Infinity;
            for (let k = 0; k <= count; k++) { const d = (p[0] - pts[k][0]) ** 2 + (p[1] - pts[k][1]) ** 2 + (p[2] - pts[k][2]) ** 2; if (d < bd) { bd = d; best = k; } }
            return skinAt(best / count);
        }, true);
        if (f.type === 'demon') {
            // The spade at the tip.
            const end = pts[count], dir = norm(sub(pts[count], pts[count - 2]));
            const side = norm(cross(dir, [0, 1, 0]));
            m.loft(6, (i, t) => ({ center: add(end, mul(dir, t * 0.06 * s)), x: side, y: norm(cross(side, dir)), rx: 0.03 * s * Math.sin(Math.max(0.1, Math.min(1, t * 1.6)) * Math.PI * 0.75) + 0.001, ry: 0.004 }), 8, main, skinAt(1), true);
        }
        if (f.type === 'dragon' || f.type === 'lizard') return pts;
    }

    function wings(m, L, f) {
        const spine = L.boneIndex('Spine2'), skin = Props.rigid(spine), s = f.size;
        const y = L.bone('Spine2').head[1] + 0.1;
        const z0 = L.backAt(y, 0.06);
        const main = linear(f.color), second = linear(f.color2 || f.color);
        for (const side of [1, -1]) {
            const root = [side * 0.07, y, (isFinite(z0) ? z0 : -0.12) - 0.02];
            // The leading edge: up and out to the wrist, then out and down to the tip.
            const shoulder = add(root, [side * 0.18 * s, 0.16 * s, -0.12 * s]);
            const wrist = add(root, [side * 0.55 * s, 0.32 * s, -0.22 * s]);
            const tip = add(root, [side * 0.95 * s, 0.05 * s, -0.25 * s]);
            if (f.type === 'fairy') {
                for (const [dir, len, wid] of [[[side * 0.7, 0.7, -0.25], 0.42, 0.13], [[side * 0.8, -0.35, -0.2], 0.3, 0.09]]) {
                    const d = norm(dir), right = norm(cross(d, [0, 0, 1]));
                    m.loft(10, (i, t) => ({ center: add(root, mul(d, t * len * s)), x: right, y: [0, 0, 1], rx: Math.sin(Math.max(0.05, t) * Math.PI) * wid * s + 0.002, ry: 0.0015 }), 10, (t) => mixRgb(main, second, t), skin, true);
                }
                continue;
            }
            const arm = [root, shoulder, wrist, tip];
            if (f.type === 'bat') {
                m.tube([root, shoulder, wrist], t => 0.014 * s * (1 - t * 0.5), 6, second, skin);
                const fingers = [tip, add(root, [side * 0.8 * s, -0.25 * s, -0.22 * s]), add(root, [side * 0.55 * s, -0.42 * s, -0.18 * s]), add(root, [side * 0.25 * s, -0.4 * s, -0.12 * s])];
                for (const fg of fingers) m.tube([wrist, lerp(wrist, fg, 0.5), fg], t => 0.008 * s * (1 - t * 0.7), 5, second, skin);
                // The membrane between the fingers, scalloped at the trailing edge, both sides drawn.
                const edge = [shoulder, ...fingers.map((fg, k) => fg)];
                const hubs = [shoulder].concat(fingers);
                const membrane = [];
                for (let k = 0; k + 1 < hubs.length; k++) {
                    const a = hubs[k], b = hubs[k + 1];
                    const sag = add(lerp(a, b, 0.5), mul(norm(sub(lerp(a, b, 0.5), wrist)), -0.06 * s));
                    membrane.push([wrist, a, sag], [wrist, sag, b]);
                }
                membrane.push([wrist, hubs[hubs.length - 1], root], [root, wrist, shoulder]);
                for (const [a, b, c] of membrane) {
                    const n = norm(cross(sub(b, a), sub(c, a)));
                    const i0 = m.vertex(a, n, main, skin), i1 = m.vertex(b, n, main, skin), i2 = m.vertex(c, n, main, skin);
                    m.tri(i0, i1, i2);
                    const j0 = m.vertex(a, mul(n, -1), main, skin), j1 = m.vertex(b, mul(n, -1), main, skin), j2 = m.vertex(c, mul(n, -1), main, skin);
                    m.tri(j0, j2, j1);
                }
                void edge;
                continue;
            }
            // Feathered: rows of feathers hanging from the arm, longest at the hand.
            m.tube(arm, t => 0.03 * s * (1 - t * 0.6), 8, main, skin);
            const rows = [[1, 0.42, 14, main], [0.62, 0.26, 16, mixRgb(main, second, 0.4)], [0.35, 0.14, 18, second]];
            for (const [reach, length, count, color] of rows) {
                for (let k = 0; k < count; k++) {
                    const t = k / (count - 1);
                    const seg = t < 0.5 ? lerp(shoulder, wrist, t * 2) : lerp(wrist, tip, (t - 0.5) * 2);
                    const from = lerp(lerp(root, shoulder, 0.5), seg, Math.min(1, 0.25 + t));
                    const handward = t > 0.5 ? (t - 0.5) * 2 : 0;
                    const dir = norm([side * (0.15 + handward * 0.9), -1 + handward * 0.35, -0.1]);
                    const flen = length * s * reach * (0.55 + 0.45 * t + handward * 0.5);
                    const to = add(from, mul(dir, flen));
                    const right = norm(cross(dir, [0, 0, 1]));
                    m.loft(5, (i, q) => ({ center: lerp(from, to, q), x: right, y: [0, 0, 1], rx: (0.022 + 0.012 * t) * s * Math.sin(Math.max(0.2, q) * Math.PI * 0.9) + 0.003, ry: 0.0025 }), 6, color, skin, true);
                }
            }
        }
    }

    function beak(m, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head), s = f.size;
        const base = lerp(L.mouth, L.noseTip, 0.55);
        base[2] = Math.max(L.mouth[2], L.noseTip[2] - 0.012);
        const width = 0.032 * s, len = (f.type === 'duck' ? 0.07 : f.type === 'crow' ? 0.085 : 0.065) * s;
        const main = linear(f.color), dark = linear(f.color2 || f.color);
        const hook = f.type === 'raptor' ? 1 : 0, flat = f.type === 'duck' ? 1 : 0;
        // Upper bill.
        m.loft(10, (i, t) => {
            const c = add(base, [0, 0.008 - Math.pow(t, 2.2) * hook * 0.035 * s, t * len]);
            return { center: c, x: [1, 0, 0], y: [0, 1, 0], rx: Math.max(0.002, width * (flat ? 1 - t * 0.3 : 1 - t * 0.95)), ry: Math.max(0.002, (0.02 - t * 0.016) * s * (flat ? 0.45 : 1)) };
        }, 12, t => mixRgb(main, dark, t > 0.85 ? 0.7 : 0), skin, true);
        // Lower bill.
        m.loft(8, (i, t) => ({ center: add(base, [0, -0.012 * s, t * len * 0.8]), x: [1, 0, 0], y: [0, 1, 0], rx: Math.max(0.002, width * (flat ? 0.95 - t * 0.3 : 0.9 - t * 0.85)), ry: Math.max(0.0015, 0.008 * s * (1 - t)) }), 10, main, skin, true);
    }

    function tusks(m, pack, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head);
        const s = f.size * (f.type === 'large' ? 1.8 : 1);
        const P = L.P, teeth = pack.helpers.lowerTeeth.source;
        for (const side of [1, -1]) {
            // The lower teeth's front corner on this side.
            let best = null;
            for (const v of teeth) {
                const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
                if (Math.sign(p[0]) !== side) continue;
                const score = p[2] - Math.abs(p[0] - side * 0.015) * 2;
                if (!best || score > best.score) best = { p, score };
            }
            if (!best) continue;
            const a = best.p;
            const pts = [];
            for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(add(a, [side * t * 0.012 * s, t * 0.04 * s, 0.008 + Math.sin(t * 1.4) * 0.012 * s])); }
            m.tube(pts, t => 0.0075 * Math.sqrt(s) * (1 - t * 0.92), 8, linear(f.color), skin);
        }
    }

    function spines(m, pack, L, f) {
        const s = f.size, color = linear(f.color);
        const an = Outfit.anatomy(pack), P = L.P;
        if (f.type === 'ridge' || f.type === 'both') {
            // Down the middle of the back, from the neck to the seat.
            const skin = Props.spineSkin(L);
            for (let k = 0; k < 14; k++) {
                const target = 3.9 - k * 0.27;
                let best = null;
                for (const v of pack._bodyIds) {
                    if (an.member[v * 5] < 0.7 || Math.abs(P[v * 3]) > 0.015 || Math.abs(an.s[v * 5] - target) > 0.12) continue;
                    if (!best || P[v * 3 + 2] < best[2]) best = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
                }
                if (!best) continue;
                const h = (0.025 + 0.02 * Math.sin(k / 13 * Math.PI)) * s;
                m.tube([add(best, [0, 0, 0.006]), add(best, [0, h * 0.4, -h * 0.6]), add(best, [0, h * 0.7, -h])], [0.012 * s, 0.006 * s, 0.001], 6, color, skin);
            }
        }
        if (f.type === 'crest' || f.type === 'both') {
            const head = L.boneIndex('Head'), skin = Props.rigid(head);
            const H = L.crown - L.brow;
            for (let k = 0; k < 6; k++) {
                const a = Math.PI * (0.05 + k * 0.17);
                const y = L.crown - H * 0.1 - Math.pow(k / 5, 1.6) * H * 0.8;
                const at = headPoint(L, Math.min(y, L.crown - 0.008), Math.PI - a + Math.PI, -0.004);
                const p = [0, at.p[1], at.p[2]];
                const out = norm([0, 0.8, -0.6]);
                const h = 0.04 * s * (1 - k * 0.08);
                m.tube([p, add(p, mul(out, h * 0.5)), add(p, mul(out, h))], [0.01 * s, 0.005 * s, 0.001], 6, color, skin);
            }
        }
    }

    function whiskers(m, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head);
        const len = (f.type === 'long' ? 0.11 : 0.06) * f.size;
        for (const side of [1, -1]) for (let k = 0; k < 3; k++) {
            const a = add(L.noseTip, [side * 0.018, -0.012 - k * 0.005, -0.012]);
            const b = add(a, [side * len, (1 - k) * 0.012, -len * 0.25]);
            m.tube([a, lerp(a, b, 0.5), b], t => 0.0009 * (1 - t * 0.6), 3, linear(f.color), skin, false);
        }
    }

    /**
     * A grey's eyes: a large glossy lens over each eye, almond-shaped (rounder
     * toward the nose, drawn to a point at the outer corner and tilted up
     * there) or round, laid on the face's own surface and domed a little.
     */
    function alienEyes(m, pack, built, L, f) {
        const head = L.boneIndex('Head'), skin = Props.rigid(head), rgb = linear(f.color);
        const P = built.shaped, ids = pack._bodyIds || (pack._bodyIds = [...new Set(pack.body.source)]);
        const almond = f.type === 'almond';
        for (const E of [L.eyeL, L.eyeR]) {
            const side = Math.sign(E.center[0]) || 1;
            const a = E.radius * 1.45 * f.size, b = a * (almond ? 0.68 : 0.85), tilt = almond ? 0.38 * side : 0;
            const c = add(E.center, [side * a * 0.03, a * 0.08, 0]);
            // The front surface under each point of the lens: the face's triangles and the eyeball's, the
            // nearest to the viewer where several lie under it.
            const tris = [];
            const keep = (A, B, C) => {
                const xs = [A[0], B[0], C[0]], ys = [A[1], B[1], C[1]];
                if (Math.max(...xs) < c[0] - a * 1.4 || Math.min(...xs) > c[0] + a * 1.4 || Math.max(...ys) < c[1] - a * 1.2 || Math.min(...ys) > c[1] + a * 1.2) return;
                if (Math.min(A[2], B[2], C[2]) < E.center[2] - E.radius * 2) return;
                tris.push([A, B, C]);
            };
            const src = pack.body.source, I = pack.body.index, at3 = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
            for (let t = 0; t < I.length; t += 3) keep(at3(src[I[t]]), at3(src[I[t + 1]]), at3(src[I[t + 2]]));
            const eyes = built.parts.find(p => p.name === 'Eyes');
            if (eyes) {
                const Q = eyes.positions, at = k => [Q[k * 3], Q[k * 3 + 1], Q[k * 3 + 2]];
                for (let t = 0; t < eyes.index.length; t += 3) keep(at(eyes.index[t]), at(eyes.index[t + 1]), at(eyes.index[t + 2]));
            }
            const skinZ = (x, y) => {
                let z = -Infinity;
                for (const [A, B, C] of tris) {
                    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
                    if (Math.abs(d) < 1e-12) continue;
                    const w0 = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / d, w1 = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / d, w2 = 1 - w0 - w1;
                    if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
                    z = Math.max(z, w0 * A[2] + w1 * B[2] + w2 * C[2]);
                }
                return Number.isFinite(z) ? z : E.center[2] + E.radius;
            };
            const cols = 16, rows = 10, grid = [];
            for (let i = 0; i <= cols; i++) {
                const u = -1 + 2 * i / cols, out = u * side;
                // The outline's half height across: an almond, fuller toward the nose, pointed at the outer corner.
                const half = almond ? Math.pow(Math.max(0, 1 - u * u), 0.42) * (1 - 0.22 * out) : Math.sqrt(Math.max(0, 1 - u * u));
                const col = [];
                for (let j = 0; j <= rows; j++) {
                    const v = (-1 + 2 * j / rows) * half;
                    const lx = u * a, ly = v * b;
                    const x = c[0] + lx * Math.cos(tilt) - ly * Math.sin(tilt), y = c[1] + lx * Math.sin(tilt) + ly * Math.cos(tilt);
                    const dome = Math.max(0, 1 - u * u - (half > 1e-4 ? (v / half) ** 2 : 1));
                    // Set into the face: the edge dives under the skin round it, so the lids close over the lens.
                    const rr = Math.min(1, Math.hypot(u, half > 1e-4 ? v / half : 1));
                    const z = skinZ(x, y) + 0.0025 + dome * a * 0.1 - 0.006 * Math.max(0, (rr - 0.78) / 0.22) ** 2;
                    col.push([x, y, z]);
                }
                grid.push(col);
            }
            const at = (i, j) => grid[Math.max(0, Math.min(cols, i))][Math.max(0, Math.min(rows, j))];
            const idx = [];
            for (let i = 0; i <= cols; i++) {
                idx.push([]);
                for (let j = 0; j <= rows; j++) {
                    const du = sub(at(i + 1, j), at(i - 1, j)), dv = sub(at(i, j + 1), at(i, j - 1));
                    let n = norm(cross(du, dv));
                    if (n[2] < 0) n = mul(n, -1);
                    idx[i].push(m.vertex(grid[i][j], n, rgb, skin));
                }
            }
            for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
                const p00 = idx[i][j], p10 = idx[i + 1][j], p01 = idx[i][j + 1], p11 = idx[i + 1][j + 1];
                if (side > 0) { m.tri(p00, p10, p11); m.tri(p00, p11, p01); } else { m.tri(p00, p11, p10); m.tri(p00, p01, p11); }
            }
        }
    }

    /** Feature parts on a built body, and the bones they bring (a tail's chain). */
    function build(pack, built, features, landmarks) {
        const F = normalizeFeatures(features);
        const L = landmarks || Props.landmarks(pack, built);
        const hard = new Props.Mesh(), soft = new Props.Mesh();
        const bones = [];
        if (F.horns.type !== 'none') horns(hard, L, F.horns);
        if (F.ears.type !== 'none') animalEars(soft, L, F.ears);
        if (F.tail.type !== 'none') tail(soft, pack, L, F.tail, bones, built.bones.length);
        if (F.wings.type !== 'none') wings(soft, L, F.wings);
        if (F.beak.type !== 'none') beak(hard, L, F.beak);
        if (F.tusks.type !== 'none') tusks(hard, pack, L, F.tusks);
        if (F.spines.type !== 'none') spines(hard, pack, L, F.spines);
        if (F.whiskers.type !== 'none') whiskers(soft, L, F.whiskers);
        const lenses = new Props.Mesh();
        if (F.alienEyes.type !== 'none') alienEyes(lenses, pack, built, L, F.alienEyes);
        const parts = [];
        if (!lenses.empty) parts.push(lenses.part('Alien eyes', { roughness: 0.06, metalness: 0, kind: 'eye', doubleSided: true, envMapIntensity: 0.3 }));
        if (!hard.empty) parts.push(hard.part('Horns and claws', { roughness: 0.4, metalness: 0 }));
        if (!soft.empty) parts.push(soft.part('Features', { roughness: 0.8, metalness: 0, doubleSided: true, opacity: F.wings.type === 'fairy' ? 0.55 : undefined }));
        return { parts, bones, features: F };
    }

    const api = { FEATURES, SPECIES, BY_ID, normalizeFeatures, speciesRecipe, build, tailShape };
    root.RRCharacterSpecies = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

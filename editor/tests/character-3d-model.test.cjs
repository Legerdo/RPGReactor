'use strict';
// Forge › 3D Character Builder, the whole character (RRCharacterModel): every species, outfit preset and accessory
// builds on any body, extremes included; garments stay outside the skin they are cut from; the outfit's picture is
// kept while the body changes; the GLB carries its pictures, its skin and its tail; random characters differ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src', 'forge', 'Character3D');
const load = name => require(path.join(dir, name + '.js'));
const Body = load('HumanBody');
for (const name of ['HumanTargets', 'CharacterOutfit', 'CharacterAtlas', 'CharacterWardrobe', 'CharacterProps', 'CharacterSpecies', 'CharacterSkin', 'CharacterHair', 'CreatureBody', 'CharacterGlb', 'CharacterShading', 'CharacterDetail']) load(name);
const Model = load('CharacterModel');
const Outfit = load('CharacterOutfit');
const Wardrobe = load('CharacterWardrobe');
const Props = load('CharacterProps');
const Species = load('CharacterSpecies');
const Skin = load('CharacterSkin');
const Optimizer = require(path.join(root, 'src', 'utils', 'GlbOptimizer.js'));
const { PNG } = require('pngjs');

let pack, eyeSource;
test.before(async () => {
    pack = await Body.loadPack();
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, 'data', 'eye-brown.png')));
    eyeSource = { width: png.width, height: png.height, data: new Uint8Array(png.data) };
});

/** Every part well formed: finite numbers, skin indices in range, weights summing to one. */
function assertSound(result, label) {
    assert.ok(result.parts.length > 0, label + ' has parts');
    for (const p of result.parts) {
        const n = p.positions.length / 3;
        assert.ok(n > 0 && p.index.length > 0, `${label}: ${p.name} has geometry`);
        for (let i = 0; i < p.positions.length; i++) assert.ok(Number.isFinite(p.positions[i]), `${label}: ${p.name} position ${i}`);
        for (let i = 0; i < p.index.length; i++) assert.ok(p.index[i] < n, `${label}: ${p.name} index ${i}`);
        assert.equal(p.joints.length, n * 4, `${label}: ${p.name} joints`);
        for (let v = 0; v < n; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) { assert.ok(p.joints[v * 4 + k] < result.bones.length, `${label}: ${p.name} joint`); sum += p.weights[v * 4 + k]; }
            assert.ok(Math.abs(sum - 1) < 0.02, `${label}: ${p.name} weights at ${v} sum to ${sum}`);
        }
        if (p.uvs) for (let i = 0; i < p.uvs.length; i++) assert.ok(p.uvs[i] >= -1e-6 && p.uvs[i] <= 1 + 1e-6, `${label}: ${p.name} uv in the picture`);
    }
}

test('every species builds, with its features and its own bones', () => {
    for (const s of Species.SPECIES) {
        const result = Model.build(pack, Model.withSpecies({}, s.id), {}, { quality: 'preview' });
        assertSound(result, s.id);
        const tail = s.recipe.features && s.recipe.features.tail;
        if (tail && tail.type !== 'none') {
            assert.ok(result.bones.some(b => b.name === 'Tail'), s.id + ' has a tail chain');
            const tailBone = result.bones.findIndex(b => b.name === 'Tail2');
            assert.ok(result.clips[0].tracks.some(t => t.bone === tailBone), s.id + ' sways its tail');
        }
        assert.ok(result.height > 0.6 && result.height < 3.5, s.id + ' height ' + result.height);
    }
});

test('every outfit preset and every accessory builds on an average and an extreme body', () => {
    const bodies = [{}, { gender: 1, weight: 3, muscle: 2.2, headSize: 1.6 }, { gender: 0, weight: -0.3, height: -0.5, cup: 4 }];
    for (const body of bodies) {
        const cache = {};
        for (const preset of Wardrobe.PRESETS) assertSound(Model.build(pack, Object.assign({}, body, { outfit: preset.items }), cache, { quality: 'preview' }), preset.id + ' on ' + JSON.stringify(body));
        assertSound(Model.build(pack, Object.assign({}, body, { props: Props.PROPS.map(p => ({ id: p.id })) }), cache, { quality: 'preview' }), 'accessories on ' + JSON.stringify(body));
    }
});

test('garments stay outside the skin, however far the sliders go', () => {
    for (const body of [{}, { gender: 1, weight: 2.5, muscle: 1.5 }]) {
        const built = Body.build(pack, Body.normalizeRecipe(body));
        const normals = Body.vertexNormals(pack, built.shaped);
        const ids = [...new Set(pack.body.source)];
        const grid = Outfit.pointGrid(built.shaped, new Set(ids), 0.04);
        const out = Wardrobe.build(pack, built, [{ id: 'tshirt' }, { id: 'jeans' }, { id: 'boots' }], {});
        let inside = 0, total = 0;
        for (const p of out.parts) for (let i = 0; i < p.positions.length; i += 3) {
            const q = grid.nearest(p.positions[i], p.positions[i + 1], p.positions[i + 2], 2);
            if (q < 0) continue;
            const P = built.shaped;
            const d = (p.positions[i] - P[q * 3]) * normals[q * 3] + (p.positions[i + 1] - P[q * 3 + 1]) * normals[q * 3 + 1] + (p.positions[i + 2] - P[q * 3 + 2]) * normals[q * 3 + 2];
            total++;
            if (d < -0.004) inside++;
        }
        // The rims fold back to the skin and a few vertices sit at creases: well under one in a hundred.
        assert.ok(inside / total < 0.01, `${inside} of ${total} garment vertices under the skin on ${JSON.stringify(body)}`);
        assert.ok(out.hidden.size > 1000, 'the skin under the clothes is left out');
    }
});

test('a kept cache lays the outfit on the body built now, not on the one before', () => {
    const outfit = Wardrobe.PRESETS.find(p => p.id === 'winter').items;
    const kept = {};
    Model.build(pack, { outfit }, kept, { quality: 'preview' });
    for (const body of [{ age: 11 }, { cup: 4, gender: 0 }, { weight: 3, gender: 1 }]) {
        const reused = Model.build(pack, Object.assign({ outfit }, body), kept, { quality: 'preview' });
        const fresh = Model.build(pack, Object.assign({ outfit }, body), {}, { quality: 'preview' });
        for (let k = 0; k < fresh.parts.length; k++) assert.deepEqual(Array.from(reused.parts[k].positions), Array.from(fresh.parts[k].positions), fresh.parts[k].name + ' on ' + JSON.stringify(body));
    }
});

test('the outfit and skin pictures are kept while the body changes, and repainted when the outfit does', () => {
    const cache = {};
    const a = Model.build(pack, { outfit: [{ id: 'tunic' }], weight: 0.2 }, cache, { quality: 'preview' });
    const b = Model.build(pack, { outfit: [{ id: 'tunic' }], weight: 0.9, muscle: 0.9 }, cache, { quality: 'preview' });
    assert.equal(a.textures['outfit.png'], b.textures['outfit.png']);
    assert.equal(a.textures['skin.png'], b.textures['skin.png']);
    const c = Model.build(pack, { outfit: [{ id: 'tunic', color: '#123456' }] }, cache, { quality: 'preview' });
    assert.notEqual(c.textures['outfit.png'], a.textures['outfit.png']);
});

test('lips, eye shadow and markings land where they belong; the iris takes its color, the whites stay white', () => {
    const plain = Skin.paint(pack, '#c69c7f', {}, { size: 256 });
    const made = Skin.paint(pack, '#c69c7f', { lips: '#b02040', type: 'scales', color: '#203020' }, { size: 256 });
    let changed = 0;
    for (let i = 0; i < plain.data.length; i += 4) if (Math.abs(plain.data[i] - made.data[i]) + Math.abs(plain.data[i + 1] - made.data[i + 1]) > 30) changed++;
    assert.ok(changed > 1000, 'markings painted');
    const eyes = Skin.paintEyes(eyeSource.data, eyeSource.width, { color: '#3a8ad8' });
    const at = (u, v) => ((Math.floor(v * eyeSource.width) * eyeSource.width + Math.floor(u * eyeSource.width)) * 4);
    const iris = at(0.708 + 0.07, 0.259), white = at(0.5, 0.5);
    assert.ok(eyes[iris + 2] > eyes[iris], 'the iris turned blue');
    // The whites are lifted from the picture's dim beige, and stay a white.
    const [r, g, b] = eyes.slice(white, white + 3);
    assert.ok(r > eyeSource.data[white] && Math.max(r, g, b) - Math.min(r, g, b) < 30, `whites ${r},${g},${b}`);
});

test('the GLB holds the pictures, the skinned parts, the tail and the Idle', async () => {
    const result = Model.build(pack, Object.assign(Model.withSpecies({}, 'dragonborn'), { outfit: Wardrobe.PRESETS.find(p => p.id === 'knight').items, props: [{ id: 'cape' }] }), {}, { eyeSource });
    const glb = await Model.toGlb(result, 'Test', tex => { const png = new PNG({ width: tex.width, height: tex.height }); png.data = Buffer.from(tex.data); return new Uint8Array(PNG.sync.write(png)); });
    const { json } = Optimizer.parseGlb(glb);
    assert.deepEqual(json.images.map(i => i.name).sort(), ['eyes.png', 'outfit.png', 'skin.png']);
    assert.equal(json.meshes.length, result.parts.length);
    for (const node of json.nodes.filter(n => n.mesh != null)) assert.equal(node.skin, 0);
    const names = json.skins[0].joints.map(j => json.nodes[j].name);
    assert.ok(names.includes('Tail') && names.includes('Tail5') && names.includes('LeftHandThumb1'));
    assert.equal(json.animations[0].name, 'Idle');
    // Vertex colors only on the parts without a picture.
    for (const [i, part] of result.parts.entries()) {
        const prim = json.meshes[i].primitives[0];
        assert.equal(prim.attributes.COLOR_0 != null, !!part.colors && !part.texture, part.name);
    }
});

test('a four-legged creature saves with its quadruped rig beside it', async () => {
    const result = Model.build(pack, { plan: 'quadruped', kind: 'horse' }, {});
    assert.equal(result.plan, 'quadruped');
    assert.equal(result.sidecar.rig.template, 'quadruped');
    const glb = await Model.toGlb(result, 'Horse', () => new Uint8Array(0));
    const { json } = Optimizer.parseGlb(glb);
    assert.ok(json.skins[0].joints.map(j => json.nodes[j].name).includes('LeftFrontUpperLeg'));
});

test('random characters differ, and a bald species stays bald', () => {
    const looks = new Set();
    for (let seed = 1; seed <= 12; seed++) {
        const r = Model.random(seed);
        looks.add(r.outfit.map(i => i.id).join(',') + '|' + r.hair.style);
    }
    assert.ok(looks.size >= 9, 'twelve seeds give ' + looks.size + ' looks');
    assert.deepEqual(Model.random(5), Model.random(5));
    assert.equal(Model.random(3, { species: 'lizardfolk' }).hair.style, 'bald');
    // Leaving a bald species grows hair back.
    assert.notEqual(Model.withSpecies(Model.withSpecies({}, 'lizardfolk'), 'human').hair.style, 'bald');
});

test('the arms hang clear of a wide body', () => {
    const thin = Model.build(pack, {}, {}, { quality: 'preview' }), wide = Model.build(pack, { weight: 3, muscle: 2 }, {}, { quality: 'preview' });
    assert.ok(Model.armAngle(wide.recipe, wide.built, pack) > Model.armAngle(thin.recipe, thin.built, pack) + 0.4);
});

test('the editor page loads each module after the ones it needs', () => {
    const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(page.indexOf('src/utils/ColorPopover.js') > 0 && page.indexOf('src/utils/ColorPopover.js') < page.indexOf('src/forge/Character3D/Character3DBuilder.js'), 'the color picker is loaded before the builder');
    const order = ['HumanTargets', 'HumanBody', 'CharacterOutfit', 'CharacterAtlas', 'CharacterWardrobe', 'CharacterProps', 'CharacterSpecies', 'CharacterSkin', 'CharacterHair', 'CreatureBody', 'CharacterGlb', 'CharacterShading', 'CharacterDetail', 'CharacterModel', 'Character3DBuilder'];
    const at = order.map(name => page.indexOf(`src/forge/Character3D/${name}.js`));
    assert.ok(at.every(i => i > 0), 'every module is loaded');
    assert.deepEqual(at.slice().sort((a, b) => a - b), at);
});

test('every module a builder file needs is on the page before it (in the editor, require resolves elsewhere)', () => {
    const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const rel = 'src/forge/Character3D/';
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const at = page.indexOf(rel + file);
        assert.ok(at > 0, file + ' is loaded');
        for (const m of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/require\('\.\/([A-Za-z0-9]+)\.js'\)/g)) {
            const need = page.indexOf(rel + m[1] + '.js');
            assert.ok(need > 0 && need < at, `${file} needs ${m[1]}.js loaded before it`);
        }
    }
});

test('body hair grows where its pattern says, and never on the palms', () => {
    const K = Skin;
    const at = (fam, s, ang, n, x = 0.05) => ({ fam, s, ang, n, rest: [x, 1, 0], lips: 0, lids: 0, nose: 0 });
    const chest = at(0, 3.0, 0, [0, 0, 1]), back = at(0, 2.0, Math.PI, [0, 0, -1]), face = at(0, 5.0, 1.2, [0.9, 0, 0.4], 0.06);
    const palm = at(1, 3.4, 0, [0, -1, 0]), handBack = at(1, 3.4, 0, [0, 1, 0]), knee = at(3, 1.0, 0, [0, 0, 1]);
    const natural = K.normalizeBodyHair({ pattern: 'natural' }).regions, wolf = K.normalizeBodyHair({ pattern: 'werewolf' }).regions;
    assert.ok(K.hairDensity(natural, chest) > 0.5, 'a natural chest');
    assert.ok(K.hairDensity(natural, back) < 0.1, 'a natural back is bare');
    assert.equal(K.hairDensity(natural, face), 0);
    assert.ok(K.hairDensity(wolf, face) > 0.9, 'a werewolf cheek');
    assert.ok(K.hairDensity(wolf, knee) > 0.9, 'no gap at the knee where thigh and shin meet');
    assert.ok(K.hairDensity(wolf, handBack) > 0.5);
    assert.equal(K.hairDensity(wolf, palm), 0);
    // A region moved by hand keeps its value under the pattern's others.
    assert.equal(K.normalizeBodyHair({ pattern: 'custom', regions: { back: 0.4 } }).regions.back, 0.4);
});

test('toe length lengthens all five toes, and leaves the heel', () => {
    const across = recipe => {
        const b = Body.build(pack, recipe), P = b.shaped;
        const ids = [...new Set(pack.body.source)].filter(v => P[v * 3] > 0.03 && P[v * 3 + 1] < 0.06);
        let mn = 1, mx = 0, heel = 1;
        for (const v of ids) { mn = Math.min(mn, P[v * 3]); mx = Math.max(mx, P[v * 3]); heel = Math.min(heel, P[v * 3 + 2]); }
        const tips = [-1, -1, -1, -1, -1];
        for (const v of ids) { const k = Math.min(4, Math.floor((P[v * 3] - mn) / (mx - mn) * 5)); tips[k] = Math.max(tips[k], P[v * 3 + 2]); }
        return { tips, heel };
    };
    const a = across({}), b = across({ morph: { toes: 2 } });
    a.tips.forEach((t, k) => assert.ok(b.tips[k] - t > 0.03, `strip ${k} grew ${b.tips[k] - t}`));
    assert.ok(Math.abs(b.heel - a.heel) < 0.002, 'the heel stays');
});

test('eye size reaches big eyes past natural, eyeballs included; width and tallness shape them', () => {
    const span = recipe => {
        const b = Body.build(pack, recipe), eyes = b.parts.find(p => p.name === 'Eyes').positions;
        let mn = [9, 9], mx = [-9, -9];
        for (let i = 0; i < eyes.length; i += 3) if (eyes[i] > 0) { mn[0] = Math.min(mn[0], eyes[i]); mx[0] = Math.max(mx[0], eyes[i]); mn[1] = Math.min(mn[1], eyes[i + 1]); mx[1] = Math.max(mx[1], eyes[i + 1]); }
        return [mx[0] - mn[0], mx[1] - mn[1]];
    };
    const base = span({}), big = span({ shapes: { eyeSize: 4 } }), wide = span({ shapes: { eyeSize: 2 }, morph: { eyeWide: 2 } }), nat = span({ shapes: { eyeSize: 1 } });
    assert.ok(nat[0] > base[0] * 1.08, 'the natural slider grows the eyeballs too');
    assert.ok(big[0] > base[0] * 2, 'big eyes at the far end: ' + (big[0] / base[0]).toFixed(2));
    assert.ok(wide[0] / wide[1] > base[0] / base[1] * 1.4, 'width widens');
});

test('hidden ears leave ear holes, not nubs', () => {
    const out = recipe => { const P = Body.build(pack, recipe).shaped, F = Body.headFields(pack); let m = 0; for (let v = 0; v < F.ear.length; v++) if (F.ear[v] > 0.6 && P[v * 3] > 0) m = Math.max(m, P[v * 3]); return m; };
    const ears = out({}), hidden = out({ morph: { earsAway: 1 } });
    assert.ok(ears - hidden > 0.015, 'the ear lies flat against the head');
});

test('anatomical detail: one sharp areola patch per nipple, centered on it, and none without the switch', () => {
    const on = Model.build(pack, { gender: 0, anatomy: { detail: true } }, {}, { quality: 'preview' });
    const off = Model.build(pack, { gender: 0 }, {}, { quality: 'preview' });
    assert.ok(!off.parts.some(p => p.name === 'Areolas' || p.name === 'Genitals'), 'nothing anatomical by default');
    const patch = on.parts.find(p => p.name === 'Areolas');
    assert.ok(patch && on.textures['areola.png'].width >= 256, 'a patch with its own picture');
    // Each patch's middle (uv 0.5) is the nipple: the patch vertex nearest it sits on the nipple vertex.
    const F = Body.anatomyFields(pack);
    for (const nip of F.nipples) {
        const i = Array.from(patch.source).indexOf(nip.v);
        assert.ok(i >= 0, 'the nipple is in its patch');
        assert.ok(Math.abs(patch.uvs[i * 2] - 0.5) < 0.02 && Math.abs(patch.uvs[i * 2 + 1] - 0.5) < 0.02, 'centered on it');
    }
});

test('body hair is strands grown out of the skin where its regions say, and covered skin grows none', () => {
    const hairy = Model.build(pack, { gender: 1, bodyHair: { amount: 1, pattern: 'natural' } }, {}, { quality: 'preview' });
    const part = hairy.parts.find(p => p.name === 'Body hair');
    assert.ok(part && part.index.length / 3 > 2000, 'thousands of clumps');
    assert.ok(part.cutout && part.texture === 'bodyhair.png' && part.noShade, 'clumps of strands on their picture, not shaded');
    // Many hairs to a triangle: a full werewolf coat stays well inside a weak GPU's reach.
    const wolf = Model.build(pack, { gender: 1, bodyHair: { amount: 1, pattern: 'werewolf' } }, {}, { quality: 'preview' }).parts.find(p => p.name === 'Body hair');
    assert.ok(wolf.index.length / 3 < 160000, `werewolf body hair ${wolf.index.length / 3} triangles`);
    const dressed = Model.build(pack, { gender: 1, bodyHair: { amount: 1, pattern: 'natural' }, outfit: Wardrobe.PRESETS.find(p => p.id === 'knight').items }, {}, { quality: 'preview' });
    const under = dressed.parts.find(p => p.name === 'Body hair');
    assert.ok(!under || under.index.length < part.index.length * 0.5, 'armor covers most of it');
    assert.ok(!Model.build(pack, { gender: 1 }, {}, { quality: 'preview' }).parts.some(p => p.name === 'Body hair'), 'none by default');
});

test('every pose to try a character in plays on the built skeleton, its turns whole quaternions', () => {
    const Poses = require(path.join(root, 'src', 'forge', 'Character3D', 'CharacterPoses.js'));
    const built = Model.build(pack, { gender: 0 }, {}, { quality: 'preview' });
    for (const pose of Poses.POSES) {
        const clip = Poses.clip(built.bones, pose.id);
        assert.ok(clip && clip.tracks.length >= 4, pose.id);
        for (const t of clip.tracks) {
            assert.ok(t.bone >= 0 && t.bone < built.bones.length, `${pose.id} bone`);
            assert.equal(t.values.length, clip.times.length * 4, `${pose.id} track length`);
            for (let i = 0; i < t.values.length; i += 4) assert.ok(Math.abs(Math.hypot(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]) - 1) < 1e-5, `${pose.id} unit quaternion`);
        }
        assert.ok(Number.isFinite(clip.lift(0.3)), `${pose.id} lift`);
    }
    assert.equal(Poses.clip(built.bones, 'nonsense'), null);
});

test('the poses are motion capture fitted to each body: loops close, feet meet the floor, heavy arms clear the flanks', () => {
    const Poses = require(path.join(root, 'src', 'forge', 'Character3D', 'CharacterPoses.js'));
    const Data = require(path.join(root, 'src', 'forge', 'Character3D', 'CharacterPosesData.js'));
    const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const rot = (q, v) => { const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], u = [q[0], q[1], q[2]], t = c(u, v).map(x => 2 * x), t2 = c(u, t); return [v[0] + q[3] * t[0] + t2[0], v[1] + q[3] * t[1] + t2[1], v[2] + q[3] * t[2] + t2[2]]; };
    /** Every joint's place at frame f, the body lifted as the clip says. */
    const place = (bones, clip, f) => {
        const local = bones.map(() => [0, 0, 0, 1]), W = [], pos = [];
        for (const t of clip.tracks) local[t.bone] = Array.from(t.values.slice(f * 4, f * 4 + 4));
        bones.forEach((b, i) => {
            if (b.parent < 0) { W[i] = local[i]; pos[i] = [b.head[0], b.head[1] + clip.heights[f], b.head[2]]; return; }
            W[i] = mul(W[b.parent], local[i]);
            const o = rot(W[b.parent], b.head.map((v, k) => v - bones[b.parent].head[k]));
            pos[i] = pos[b.parent].map((v, k) => v + o[k]);
        });
        return { pos, W };
    };
    /** How far the lowest point under either foot (heel, ball, toe tip) is above where it stands at rest. */
    const soleClear = (bones, clip, f) => {
        const { pos, W } = place(bones, clip, f), at = n => bones.findIndex(b => b.name === n);
        const s = Math.max(...bones.map(b => b.head[1])) / 1.7;
        let low = Infinity;
        for (const S of ['Left', 'Right']) for (const [n, o] of [['Foot', [0, -0.065, -0.055]], ['ToeBase', [0, 0, 0]], ['ToeBase', [0, -0.012, 0.06]]]) {
            const i = at(S + n), d = rot(W[i], o.map(v => v * s));
            low = Math.min(low, pos[i][1] + d[1] - (bones[i].head[1] + o[1] * s));
        }
        return low;
    };
    assert.deepEqual(Object.keys(Data.poses).sort(), Poses.POSES.map(p => p.id).sort(), 'every pose captured');
    for (const recipe of [{ gender: 1 }, { gender: 0, age: 0.3 }, { gender: 1, extreme: true, weight: 4 }]) {
        const { bones } = Model.build(pack, recipe, {}, { quality: 'preview' });
        for (const pose of Poses.POSES) {
            const clip = Poses.clip(bones, pose.id), last = clip.times.length - 1;
            for (const t of clip.tracks) {
                const a = t.values.slice(0, 4), b = t.values.slice(last * 4, last * 4 + 4);
                assert.ok(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 0.9999, `${pose.id} loops back to its first frame`);
            }
            assert.ok(Math.abs(clip.heights[0] - clip.heights[last]) < 1e-3, `${pose.id} height loops`);
        }
        // Walking and running: some sole on the floor except in a run's flight, never one under it.
        for (const id of ['walk', 'run', 'fight', 'crouch']) {
            const clip = Poses.clip(bones, id);
            let flying = 0;
            for (let f = 0; f < clip.times.length; f++) {
                const low = soleClear(bones, clip, f);
                assert.ok(low > -0.01, `${id} frame ${f}: a foot ${low.toFixed(3)} m under the floor`);
                if (low > 0.025) flying++;
            }
            if (id === 'run') assert.ok(flying > 0 && flying < clip.times.length / 2, `run has a short flight (${flying} frames)`);
            else assert.equal(flying, 0, `${id} keeps a foot down`);
        }
        // The jump leaves the floor and comes back.
        const jump = Poses.clip(bones, 'jump');
        assert.ok(Math.max(...jump.heights) > 0.2 && Math.abs(jump.heights[0]) < 0.1, 'jump rises off the floor');
    }
    // A heavy body's hanging arm is held further from its trunk than a slim one's.
    const out = recipe => {
        const { bones } = Model.build(pack, recipe, {}, { quality: 'preview' }), clip = Poses.clip(bones, 'walk'), at = n => bones.findIndex(b => b.name === n);
        let least = Infinity;
        for (let f = 0; f < clip.times.length; f++) { const { pos } = place(bones, clip, f); least = Math.min(least, Math.abs(pos[at('LeftForeArm')][0] - pos[at('Spine1')][0])); }
        return least / Math.abs(bones[at('LeftArm')].head[0]);
    };
    assert.ok(out({ gender: 1, extreme: true, weight: 4 }) > out({ gender: 1 }) + 0.2, 'heavy arms swing out');
});

test('a top worn with its own skirt reaches under the skirt: no bare waist between them on any body', () => {
    const an = Outfit.anatomy(pack);
    // The trunk from just above the hips to above the navel, where the bodice meets the skirt's waistband.
    const waist = [...new Set(pack.body.source)].filter(v => an.member[v * 5] > 0.9 && an.s[v * 5] > 0.6 && an.s[v * 5] < 1.2);
    for (const body of [{ gender: 0 }, { gender: 0, weight: 1, cup: 1 }, { gender: 1, muscle: 1 }, { gender: 0, extreme: true, weight: 4 }]) {
        const built = Body.build(pack, Body.normalizeRecipe(body));
        for (const id of ['dress', 'gown', 'robe', 'tunic', 'chainmail']) {
            const out = Wardrobe.build(pack, built, [{ id }], {});
            const bare = waist.filter(v => !out.hidden.has(v));
            assert.equal(bare.length, 0, `${id} on ${JSON.stringify(body)}: ${bare.length} waist vertices bare`);
        }
    }
});

const Clothes = load('CharacterClothes');
const MODELED = Wardrobe.GARMENTS.filter(g => g.modeled);

test('every modeled garment builds on an average and an extreme body, outside the skin, hiding what it covers', () => {
    assert.ok(MODELED.length >= 10, 'modeled garments in the catalog');
    const clothes = Clothes.load(pack);
    for (const g of MODELED) assert.ok(clothes.garments.has(g.id), g.id + ' is in the clothes pack');
    const bodies = [{}, { extreme: true, weight: 4 }, { gender: 1, extreme: true, muscle: 2, weight: 0.3 }, { gender: 0, cup: 1, weight: 0.8 }];
    for (const body of bodies) {
        const built = Body.build(pack, Body.normalizeRecipe(body));
        const normals = Body.vertexNormals(pack, built.shaped);
        const ids = [...new Set(pack.body.source)];
        const isBody = new Uint8Array(pack.vertexCount);
        for (const v of ids) isBody[v] = 1;
        const grid = Outfit.pointGrid(built.shaped, new Set(ids), 0.04);
        const bare = Model.build(pack, Object.assign({}, body, { outfit: [] }), {}, { quality: 'preview' });
        for (const g of MODELED) {
            const label = `${g.id} on ${JSON.stringify(body)}`;
            const result = Model.build(pack, Object.assign({}, body, { outfit: [{ id: g.id }] }), {}, { quality: 'preview' });
            assertSound(result, label);
            const part = result.parts.find(p => p.name === g.label);
            assert.ok(part, label + ' is worn');
            assert.equal(part.kind, 'cloth', label + ' is cloth to the view');
            assert.ok(result.textures[part.texture] && result.textures[part.texture].data.length === result.textures[part.texture].width * result.textures[part.texture].height * 4, label + ' has its picture');
            // The drag's fast path: each vertex knows the skin vertex it rides on.
            assert.equal(part.source.length, part.positions.length / 3, label + ' source per vertex');
            for (const v of part.source) assert.ok(isBody[v], label + ' rides on the skin');
            // Outside the skin.
            const out = Wardrobe.build(pack, built, [{ id: g.id }], {});
            const P = built.shaped, Q = out.parts[0].positions;
            let inside = 0, total = 0;
            for (let i = 0; i < Q.length; i += 3) {
                const q = grid.nearest(Q[i], Q[i + 1], Q[i + 2], 2);
                if (q < 0) continue;
                const d = (Q[i] - P[q * 3]) * normals[q * 3] + (Q[i + 1] - P[q * 3 + 1]) * normals[q * 3 + 1] + (Q[i + 2] - P[q * 3 + 2]) * normals[q * 3 + 2];
                total++;
                if (d < -0.004) inside++;
            }
            assert.ok(inside / Math.max(1, total) < 0.01, `${label}: ${inside} of ${total} vertices under the skin`);
            // The skin it covers is left out.
            for (const v of clothes.garments.get(g.id).hidden) assert.ok(out.hidden.has(v), label + ' hides vertex ' + v);
            assert.ok(result.parts[0].index.length < bare.parts[0].index.length, label + ' leaves the covered skin out');
        }
    }
});

test('a modeled garment shows its own picture until a color is chosen; a color keeps the weave and folds', () => {
    const clothes = Clothes.load(pack);
    const g = clothes.garments.get('mh_tee_jeans');
    const own = Clothes.picture(clothes, g);
    const plain = Model.build(pack, { outfit: [{ id: 'mh_tee_jeans' }] }, {}, { quality: 'preview' });
    assert.equal(plain.textures['cloth-mh_tee_jeans.png'].data, own.data, 'own picture, untouched');
    const red = Model.build(pack, { outfit: [{ id: 'mh_tee_jeans', color: '#b02020', color2: '#6a6a6a' }] }, {}, { quality: 'preview' }).textures['cloth-mh_tee_jeans.png'];
    assert.notEqual(red.data, own.data);
    // Sample the texels the shirt and the trousers use.
    const part = plain.parts.find(p => p.name === 'T-shirt and jeans'), size = red.width;
    const stats = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]];
    for (let i = 0; i < part.uvs.length / 2; i++) {
        const o = (Math.min(size - 1, Math.floor(part.uvs[i * 2 + 1] * size)) * size + Math.min(size - 1, Math.floor(part.uvs[i * 2] * size))) * 4;
        const r = g.region[i], s = stats[r];
        const l = red.data[o] * 0.3 + red.data[o + 1] * 0.59 + red.data[o + 2] * 0.11;
        s[0] += red.data[o]; s[1] += red.data[o + 1]; s[2] += red.data[o + 2]; s[3] += l * l; s[4]++;
    }
    const [shirt, trousers] = stats;
    assert.ok(shirt[0] > shirt[2] * 2 && shirt[0] > shirt[1] * 2, 'the shirt is red: ' + shirt.slice(0, 3).map(x => Math.round(x / shirt[4])));
    // The trousers grey, their faded denim still showing.
    const mean = (trousers[0] * 0.3 + trousers[1] * 0.59 + trousers[2] * 0.11) / trousers[4], spread = Math.sqrt(trousers[3] / trousers[4] - mean * mean);
    assert.ok(Math.abs(trousers[0] - trousers[2]) / trousers[4] < 8, 'the trousers are grey');
    assert.ok(spread > 10, 'the denim keeps its fading, spread ' + spread.toFixed(1));
});

test('boots go over trouser legs, shoes under trouser hems', () => {
    const built = Body.build(pack, Body.normalizeRecipe({}));
    const count = list => Wardrobe.build(pack, built, list, {}).parts.map(p => [p.name, p.index.length / 3]);
    const alone = Object.fromEntries(count([{ id: 'mh_jacket_jeans' }]).concat(count([{ id: 'mh_viking_boots' }]), count([{ id: 'mh_sneakers' }])));
    const booted = Object.fromEntries(count([{ id: 'mh_jacket_jeans' }, { id: 'mh_viking_boots' }]));
    assert.ok(booted['Jacket and jeans'] < alone['Jacket and jeans'], 'the trouser legs inside the boots are not drawn');
    assert.equal(booted['Viking boots'], alone['Viking boots'], 'the boots whole');
    const shod = Object.fromEntries(count([{ id: 'mh_jacket_jeans' }, { id: 'mh_sneakers' }]));
    assert.equal(shod['Jacket and jeans'], alone['Jacket and jeans'], 'the trousers whole');
    assert.ok(shod['Running shoes'] < alone['Running shoes'] && shod['Running shoes'] > alone['Running shoes'] * 0.7, 'the socks under the hems are not drawn, the shoes are');
});

test('modeled garments save into the GLB with their pictures', async () => {
    const result = Model.build(pack, { outfit: [{ id: 'mh_suit' }, { id: 'mh_loafers', color: '#3a2a1a' }] }, {}, { eyeSource });
    const glb = await Model.toGlb(result, 'Suit', tex => { const png = new PNG({ width: tex.width, height: tex.height }); png.data = Buffer.from(tex.data); return new Uint8Array(PNG.sync.write(png)); });
    const { json } = Optimizer.parseGlb(glb);
    for (const [name, image] of [['Suit and tie', 'cloth-mh_suit.png'], ['Loafers', 'cloth-mh_loafers.png']]) {
        const mesh = json.meshes.find(m => m.name === name);
        assert.ok(mesh, name + ' mesh saved');
        const material = json.materials[mesh.primitives[0].material];
        const tex = material.pbrMetallicRoughness.baseColorTexture;
        assert.ok(tex, name + ' has a picture');
        assert.equal(json.images[json.textures[tex.index].source].name, image);
        assert.ok(mesh.primitives[0].attributes.JOINTS_0 != null && mesh.primitives[0].attributes.TEXCOORD_0 != null, name + ' skinned and mapped');
    }
});

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
for (const name of ['HumanTargets', 'CharacterOutfit', 'CharacterAtlas', 'CharacterWardrobe', 'CharacterProps', 'CharacterSpecies', 'CharacterSkin', 'CharacterHair', 'CreatureBody', 'CharacterGlb']) load(name);
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
    const order = ['HumanTargets', 'HumanBody', 'CharacterOutfit', 'CharacterAtlas', 'CharacterWardrobe', 'CharacterProps', 'CharacterSpecies', 'CharacterSkin', 'CharacterHair', 'CreatureBody', 'CharacterGlb', 'CharacterShading', 'CharacterModel', 'Character3DBuilder'];
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

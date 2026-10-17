'use strict';
// Forge › 3D Character Builder: sliders shape one MakeHuman-based body (RRHumanBody), and Save to Project writes a
// skinned GLB (RRCharacterGlb) whose Mixamo-named skeleton the Rig tool reads, with an Idle clip that keeps the
// skeleton live in the game's model reader.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const Body = require(path.join(root, 'src', 'forge', 'Character3D', 'HumanBody.js'));
const Glb = require(path.join(root, 'src', 'forge', 'Character3D', 'CharacterGlb.js'));
const Optimizer = require(path.join(root, 'src', 'utils', 'GlbOptimizer.js'));
global.ModelRigger = require(path.join(root, 'src', 'database', 'ModelRigger.js'));
const AutoRig = require(path.join(root, 'src', 'database', 'ModelAutoRig.js'));

let pack;
test.before(async () => { pack = await Body.loadPack(); });

const lowestY = part => { let min = Infinity; for (let i = 1; i < part.positions.length; i += 3) min = Math.min(min, part.positions[i]); return min; };

test('a recipe is completed and kept in range; ancestry is a mix', () => {
    const r = Body.normalizeRecipe({ gender: 4, age: 3, weight: -1, ancestry: { african: 2, asian: 0, caucasian: 2 }, shapes: { noseWidth: 9 }, skin: 'red' });
    assert.equal(r.gender, 1);
    assert.equal(r.age, Body.MIN_AGE);
    // Past the natural ranges as far as Extreme reaches, and no further.
    assert.equal(r.weight, Body.MACRO_RANGES.weight.extreme[0]);
    assert.equal(r.ancestry.african, 0.5);
    assert.equal(r.ancestry.caucasian, 0.5);
    assert.equal(r.shapes.noseWidth, Body.SLIDER_BY_KEY.get('noseWidth').extreme);
    assert.equal(r.shapes.belly, 0);
    assert.equal(r.skin, Body.DEFAULT_RECIPE.skin);
});

test('the body-type blends always add up to one whole body', () => {
    for (const recipe of [{}, { gender: 0.2, age: 40, muscle: 0.9, weight: 0.1 }, { gender: 1, age: 90 }, { age: 11, muscle: 0, weight: 1 }]) {
        const w = Body.targetWeights(recipe);
        // The ancestry targets carry each age's whole shape, so they sum to one; the build targets are
        // offsets from the average build and sum to at most one.
        let macro = 0, race = 0;
        for (const [name, value] of Object.entries(w)) {
            if (name.startsWith('macro/')) macro += value;
            if (name.startsWith('race/')) race += value;
        }
        assert.ok(macro <= 1 + 1e-9, 'macro ' + macro);
        assert.ok(Math.abs(race - 1) < 1e-9, 'race ' + race);
    }
});

test('the sliders change the body the way their names say', () => {
    const height = r => Body.build(pack, r).height;
    const woman = height({ gender: 0 }), man = height({ gender: 1 }), child = height({ age: 11 });
    assert.ok(woman > 1.45 && woman < 1.7, 'woman ' + woman);
    assert.ok(man > 1.65 && man < 1.85, 'man ' + man);
    assert.ok(child < woman - 0.2, 'child ' + child);
    assert.ok(height({ gender: 1, height: 1 }) < 2.15, 'tallest man stays a man');
    assert.ok(height({ gender: 1, height: 0 }) > 1.4, 'shortest man stays a man');
    // The torso's front at the navel: the bones say where that is on each body.
    const belly = r => {
        const built = Body.build(pack, r), p = built.parts[0].positions;
        const y = built.bones.find(b => b.name === 'Spine').head[1];
        let front = -Infinity;
        for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) < 0.12 && Math.abs(p[i + 1] - y) < 0.03) front = Math.max(front, p[i + 2]);
        return front;
    };
    assert.ok(belly({ weight: 1 }) > belly({ weight: 0 }) + 0.015, 'heavier is rounder at the belly');
    assert.ok(belly({ weight: 1, muscle: 0 }) > belly({ weight: 1 }) + 0.04, 'heavy without muscle is fat');
});

test('every body stands on the floor with its eyes in its head', () => {
    for (const recipe of [{}, { gender: 1, weight: 1 }, { age: 11 }, Body.randomRecipe(7)]) {
        const built = Body.build(pack, recipe);
        assert.ok(Math.abs(lowestY(built.parts[0])) < 1e-6);
        const head = built.bones.find(b => b.name === 'Head').head;
        const eyes = built.parts.find(p => p.name === 'Eyes').positions;
        for (let i = 0; i < eyes.length; i += 3) {
            assert.ok(Math.abs(eyes[i]) < 0.06 && eyes[i + 1] > head[1] && eyes[i + 1] < built.height, 'eye vertex ' + i);
        }
    }
});

test('a seed gives the same character every time', () => {
    assert.deepEqual(Body.randomRecipe(1234), Body.randomRecipe(1234));
    assert.notDeepEqual(Body.randomRecipe(1234), Body.randomRecipe(1235));
    assert.equal(Body.randomRecipe(99).seed, 99);
});

test('the saved model is a skinned GLB with Mixamo bones and an Idle clip', () => {
    const built = Body.build(pack, { gender: 1 });
    built.parts[0].color = '#c69c7f';
    const eye = fs.readFileSync(path.join(Body.dataFolder(), built.parts[1].texture));
    const glb = Glb.toGlb(built, { name: 'Test', images: { [built.parts[1].texture]: eye }, idle: { armAngle: 0.2 } });
    const { json } = Optimizer.parseGlb(glb);
    const skin = json.skins[0];
    const names = skin.joints.map(j => json.nodes[j].name);
    for (const name of ['Hips', 'Spine', 'Head', 'LeftArm', 'RightForeArm', 'LeftHandThumb3', 'RightHandPinky1', 'LeftFoot']) assert.ok(names.includes(name), name);
    assert.equal(json.meshes.length, 2);
    for (const node of json.nodes.filter(n => n.mesh != null)) assert.equal(node.skin, 0);
    const prim = json.meshes[0].primitives[0];
    assert.equal(json.accessors[prim.attributes.JOINTS_0].count, json.accessors[prim.attributes.POSITION].count);
    assert.equal(json.animations.length, 1);
    assert.equal(json.animations[0].name, 'Idle');
    assert.ok(json.animations[0].channels.some(c => json.nodes[c.target.node].name === 'LeftArm'));
    assert.equal(json.images.length, 1);
});

test('the Rig tool reads every marker, fingers included, from the bones', () => {
    const built = Body.build(pack, {});
    const joints = built.bones.map(b => ({ name: b.name, parent: b.parent, position: b.head }));
    const read = AutoRig.markersFromSkeleton(joints);
    assert.ok(read.humanoid);
    for (const key of ['hips', 'shoulderL', 'elbowR', 'wristL', 'thumbBaseL', 'thumbTipR', 'kneeL', 'ankleR']) assert.ok(read.found.includes(key), key);
});

test('the builder is on the Forge sidebar, in the Forge menu and loaded by the editor page', () => {
    const forge = fs.readFileSync(path.join(root, 'src', 'forge', 'ForgeManager.js'), 'utf8');
    assert.match(forge, /id: 'character-3d-builder'[\s\S]*?new Character3DBuilder\(\)/);
    const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    for (const file of ['HumanBody.js', 'CharacterGlb.js', 'Character3DBuilder.js']) assert.ok(page.includes(`src/forge/Character3D/${file}`), file);
    assert.ok(page.includes('data-action="forge-character-3d-builder"'));
    assert.match(fs.readFileSync(path.join(root, 'src', 'UIManager.js'), 'utf8'), /case 'forge-character-3d-builder':[\s\S]*?openForgeTool\('character-3d-builder'\)/);
});

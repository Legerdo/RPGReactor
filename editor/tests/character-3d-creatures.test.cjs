'use strict';
// Forge › 3D Character Builder, four-legged body plan (RRCreatureBody): presets build skinned, colored creatures on
// the floor with the Rig tool's quadruped bones, an Idle clip, and a model.json rig the runtime maps onto them.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const Creature = require(path.join(root, 'src', 'forge', 'Character3D', 'CreatureBody.js'));
const Glb = require(path.join(root, 'src', 'forge', 'Character3D', 'CharacterGlb.js'));
const Optimizer = require(path.join(root, 'src', 'utils', 'GlbOptimizer.js'));
const Rigger = require(path.join(root, 'src', 'database', 'ModelRigger.js'));
const Presets = require(path.join(root, 'src', 'database', 'RigMotionPresets.js'));

const bounds = parts => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of parts) for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p.positions[i + k]); hi[k] = Math.max(hi[k], p.positions[i + k]);
    }
    return { lo, hi };
};

test('a recipe is completed and kept in its extreme range', () => {
    const r = Creature.normalizeRecipe({ size: 99, legLength: -4, ears: 'antennae', pattern: 'stripes', colors: { coat: 'red', light: '#ABCDEF' } });
    assert.equal(r.size, Creature.SLIDERS.find(s => s.key === 'size').max);
    assert.equal(r.legLength, Creature.SLIDERS.find(s => s.key === 'legLength').min);
    assert.equal(r.ears, Creature.DEFAULT_RECIPE.ears);
    assert.equal(r.pattern, 'stripes');
    assert.equal(r.colors.coat, Creature.DEFAULT_RECIPE.colors.coat);
    assert.equal(r.colors.light, '#abcdef');
    for (const s of Creature.SLIDERS) assert.ok(s.natural[0] >= s.min && s.natural[1] <= s.max, s.key);
});

test('every preset stands on the floor, faces +z and is the size it says', () => {
    for (const kind of Creature.KINDS) {
        const built = Creature.build(Creature.kindRecipe(kind.kind), { quality: 'preview' });
        const { lo, hi } = bounds(built.parts.filter(p => p.name === 'Body'));
        assert.ok(Math.abs(lo[1]) < 1e-6, kind.kind + ' floor ' + lo[1]);
        const head = built.bones.find(b => b.name === 'Head'), hips = built.bones.find(b => b.name === 'Hips');
        assert.ok(head.tail[2] > hips.head[2], kind.kind + ' faces +z');
        // Left at +x, mirrored.
        const l = built.bones.find(b => b.name === 'LeftFrontUpperLeg'), r = built.bones.find(b => b.name === 'RightFrontUpperLeg');
        assert.ok(l.head[0] > 0 && Math.abs(l.head[0] + r.head[0]) < 1e-9, kind.kind + ' left at +x');
        assert.ok(hi[1] > 0.1 && hi[1] < 8, kind.kind + ' height ' + hi[1]);
        assert.ok(Math.abs(built.height - Math.max(...built.parts.map(p => bounds([p]).hi[1]))) < 1e-6);
    }
    const cat = Creature.build(Creature.kindRecipe('cat'), { quality: 'preview' }), horse = Creature.build(Creature.kindRecipe('horse'), { quality: 'preview' });
    const withers = b => b.bones.find(x => x.name === 'Chest').tail[1];
    assert.ok(withers(cat) > 0.15 && withers(cat) < 0.45, 'cat at the shoulder ' + withers(cat));
    assert.ok(withers(horse) > 1.2 && withers(horse) < 2.0, 'horse at the shoulder ' + withers(horse));
});

test('the bones are the Rig tool\'s quadruped bones, parents first, and the built-in motions find theirs', () => {
    const built = Creature.build(Creature.kindRecipe('dog'), { quality: 'preview' });
    built.bones.forEach((b, i) => assert.ok(b.parent < i, b.name + ' after its parent'));
    const names = new Set(built.bones.map(b => b.name));
    const template = Rigger.bonesFromMarkers(built.rig.markers, 'quadruped');
    for (const b of template) assert.ok(names.has(b.name), b.name);
    for (const key of Rigger.TEMPLATES.quadruped.markers.map(m => m.key)) assert.ok(Array.isArray(built.rig.markers[key]), key);
    // Hips, Spine, Chest and the legs stand where the Rig tool would lay them from these markers.
    for (const name of ['Hips', 'Spine', 'Chest', 'Neck', 'LeftFrontUpperLeg', 'RightRearLowerLeg', 'LeftRearFoot']) {
        const ours = built.bones.find(b => b.name === name).head, theirs = template.find(b => b.name === name).head;
        assert.ok(Math.hypot(ours[0] - theirs[0], ours[1] - theirs[1], ours[2] - theirs[2]) < 1e-6, name);
    }
    // Every bone a built-in quadruped motion turns is one of ours (a rule with no part moves the whole model).
    for (const preset of Presets.forTemplate('quadruped')) for (const rule of preset.rules) if (rule.part && rule.part !== 'Body') assert.ok(names.has(rule.part), preset.id + ' drives ' + rule.part);
});

test('skin: every vertex has weights that sum to one on real bones; legs follow their own bones', () => {
    const built = Creature.build(Creature.kindRecipe('wolf'), { quality: 'preview' });
    for (const part of built.parts) {
        for (let v = 0; v < part.positions.length / 3; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) { sum += part.weights[v * 4 + k]; assert.ok(part.joints[v * 4 + k] < built.bones.length); }
            assert.ok(Math.abs(sum - 1) < 1e-4, part.name + ' vertex ' + v + ' sums ' + sum);
        }
    }
    const body = built.parts.find(p => p.name === 'Body');
    const foot = built.bones.findIndex(b => b.name === 'LeftFrontFoot'), rightLeg = new Set(built.bones.map((b, i) => [b, i]).filter(([b]) => b.name.startsWith('Right')).map(([, i]) => i));
    // A vertex at the left front paw is the left front foot's, never a right leg's.
    let checked = 0;
    const fb = built.bones[foot];
    for (let v = 0; v < body.positions.length / 3; v++) {
        const p = [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]];
        if (Math.hypot(p[0] - fb.head[0], p[2] - fb.head[2]) > 0.06 || p[1] > fb.head[1] * 0.6) continue;
        checked++;
        let main = 0;
        for (let k = 1; k < 4; k++) if (body.weights[v * 4 + k] > body.weights[v * 4 + main]) main = k;
        assert.equal(body.joints[v * 4 + main], foot);
        for (let k = 0; k < 4; k++) if (body.weights[v * 4 + k] > 0.01) assert.ok(!rightLeg.has(body.joints[v * 4 + k]));
    }
    assert.ok(checked > 5, 'paw vertices checked ' + checked);
});

test('a seed gives the same creature; options change the shape', () => {
    assert.deepEqual(Creature.randomRecipe(77, 'fox'), Creature.randomRecipe(77, 'fox'));
    assert.notDeepEqual(Creature.randomRecipe(77, 'fox'), Creature.randomRecipe(78, 'fox'));
    assert.equal(Creature.randomRecipe(5).seed, 5);
    const count = r => Creature.build(r, { quality: 'preview' }).parts.reduce((s, p) => s + p.index.length, 0);
    const deer = Creature.kindRecipe('deer');
    assert.ok(count(deer) > count(Object.assign({}, deer, { horns: 'none' })), 'antlers add geometry');
    assert.ok(!Creature.build(Object.assign({}, deer, { horns: 'none' }), { quality: 'preview' }).parts.some(p => p.name === 'Horns'));
    const long = Creature.build(Object.assign(Creature.kindRecipe('dog'), { legLength: 1.6 }), { quality: 'preview' }).height;
    const short = Creature.build(Object.assign(Creature.kindRecipe('dog'), { legLength: 0.5 }), { quality: 'preview' }).height;
    assert.ok(long > short * 1.2, 'leg length ' + long + ' / ' + short);
});

test('the saved creature is a skinned GLB with vertex colors and an Idle clip, and its sidecar rigs it', () => {
    const built = Creature.build(Creature.kindRecipe('horse'));
    const glb = Glb.toGlb(built, { name: 'Horse', clips: built.clips });
    const { json } = Optimizer.parseGlb(glb);
    const names = json.skins[0].joints.map(j => json.nodes[j].name);
    for (const name of ['Hips', 'Chest', 'Head', 'Tail', 'LeftFrontUpperLeg', 'RightRearFoot']) assert.ok(names.includes(name), name);
    for (const mesh of json.meshes) assert.ok(mesh.primitives[0].attributes.COLOR_0 != null, mesh.name + ' colors');
    assert.equal(json.animations.length, 1);
    assert.equal(json.animations[0].name, 'Idle');
    assert.ok(json.animations[0].channels.some(c => json.nodes[c.target.node].name === 'Tail'));
    const tris = built.parts.reduce((s, p) => s + p.index.length / 3, 0);
    assert.ok(tris > 8000 && tris < 45000, 'triangles ' + tris);
    const side = Creature.sidecar(built);
    assert.equal(side.rig.template, 'quadruped');
    assert.equal(side.rig.weightsFile, undefined);
    side.rig.bones.forEach((b, i) => {
        assert.ok(b.parent < i);
        assert.ok(names.includes(b.name));
        const own = built.bones.find(x => x.name === b.name);
        assert.deepEqual(b.head, own.head);
    });
    assert.ok(side.rig.bones.find(b => b.name === 'LeftFrontUpperLeg').parent === side.rig.bones.findIndex(b => b.name === 'Chest'));
    assert.deepEqual(JSON.parse(JSON.stringify(side)), side);
});

test('a preview build is quick enough for a live slider', () => {
    const start = Date.now();
    for (const kind of ['dog', 'horse', 'drake']) Creature.build(Creature.kindRecipe(kind), { quality: 'preview' });
    assert.ok((Date.now() - start) / 3 < 400, 'preview ' + (Date.now() - start) / 3 + ' ms');
});

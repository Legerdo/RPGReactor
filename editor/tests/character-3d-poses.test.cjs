'use strict';
// Forge › 3D Character Builder, the poses (RRCharacterPoses): no bone spins or flips from one frame to the next in
// any clip, on any body; every finger joint stays within its range and curls in its own plane; fingertips stop at
// the palm; hands hang in line with the forearms.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src', 'forge', 'Character3D');
const load = name => require(path.join(dir, name + '.js'));
const Body = load('HumanBody');
for (const name of ['HumanTargets', 'CharacterOutfit', 'CharacterAtlas', 'CharacterWardrobe', 'CharacterProps', 'CharacterSpecies', 'CharacterSkin', 'CharacterHair', 'CreatureBody', 'CharacterGlb', 'CharacterShading', 'CharacterDetail']) load(name);
const Model = load('CharacterModel');
const Poses = load('CharacterPoses');

const DEG = 180 / Math.PI;
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const rot = (q, v) => { const c = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], u = [q[0], q[1], q[2]], t = c(u, v).map(x => 2 * x), t2 = c(u, t); return [v[0] + q[3] * t[0] + t2[0], v[1] + q[3] * t[1] + t2[1], v[2] + q[3] * t[2] + t2[2]]; };
const key = (t, f) => Array.from(t.values.slice(f * 4, f * 4 + 4));
/** The angle a turn makes about a unit axis (signed, degrees), and what is left of it off that axis (degrees). */
function about(q, axis) {
    const a = dot(q, axis), w = q[3], l = Math.hypot(a, w) || 1;
    const swing = mul(q, [-axis[0] * a / l, -axis[1] * a / l, -axis[2] * a / l, w / l]);
    return { angle: 2 * Math.atan2(a, w) * DEG, off: 2 * Math.acos(Math.min(1, Math.abs(swing[3]))) * DEG };
}

const BODIES = [
    ['man', { gender: 1 }], ['woman', { gender: 0 }], ['heavy man', { gender: 1, extreme: true, weight: 4 }],
    ['tiny woman', { gender: 0, extreme: true, height: -3 }], ['long-limbed man', { gender: 1, extreme: true, height: 3, muscle: 1 }]
];
let pack;
const built = new Map();
const bodyOf = name => {
    if (!built.has(name)) { const b = Model.build(pack, BODIES.find(x => x[0] === name)[1], {}, { quality: 'preview' }); built.set(name, { bones: b.bones, body: b.parts.find(p => p.name === 'Body') }); }
    return built.get(name);
};
test.before(async () => { pack = await Body.loadPack(); });

test('no bone turns faster than a joint can, every track keeps one hemisphere, and no loop winds a bone round', () => {
    // 65 degrees from one key to the next is past any joint's own turn (keys come 30 or 60 a second; a pitcher's
    // arm, the fastest turn a body makes, comes to about 50 at 60 a second): a flip or a capture glitch.
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name);
        for (const pose of Poses.POSES) {
            const clip = Poses.clip(bones, pose.id, body);
            assert.ok(clip, `${pose.id} on ${name}`);
            for (const t of clip.tracks) {
                if (t.path) continue;
                for (let f = 1; f < clip.times.length; f++) {
                    const a = key(t, f - 1), b = key(t, f), d = dot4(a, b);
                    assert.ok(d >= 0, `${pose.id} on ${name}: ${bones[t.bone].name} changes hemisphere at frame ${f}`);
                    const step = 2 * Math.acos(Math.min(1, d)) * DEG;
                    assert.ok(step <= 65, `${pose.id} on ${name}: ${bones[t.bone].name} turns ${step.toFixed(0)} degrees at frame ${f}`);
                }
                // Keys a short step apart keep one sign, so a loop's last key lands back on its first with the same
                // sign; landing on the opposite sign means the bone wound a whole turn round over the loop (a
                // propeller), however slowly.
                if (clip.once) continue;
                const last = clip.times.length - 1;
                assert.ok(dot4(key(t, 0), key(t, last)) > 0.99, `${pose.id} on ${name}: ${bones[t.bone].name} winds a whole turn over the loop`);
            }
        }
    }
});

test('the sitting right hand holds still: no spin through the loop', () => {
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name);
        const clip = Poses.clip(bones, 'sit', body), hand = bones.findIndex(b => b.name === 'RightHand');
        const t = clip.tracks.find(x => x.bone === hand);
        let total = 0;
        for (let f = 1; f < clip.times.length; f++) total += 2 * Math.acos(Math.min(1, Math.abs(dot4(key(t, f - 1), key(t, f))))) * DEG;
        assert.ok(total < 60, `sit on ${name}: the right hand turns ${total.toFixed(0)} degrees over the loop`);
    }
});

test('every finger joint stays within its range in every clip: it curls in its own plane, spreads a little, the thumb within its reach', () => {
    const R = Poses.FINGER_RANGE, slack = 1;
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name), frames = Poses.handFrames(bones);
        const joints = new Map();
        for (const S of ['Left', 'Right']) for (const j of frames[S].joints) joints.set(j.bone, j);
        assert.equal(joints.size, 30, `${name}: fifteen finger joints a hand`);
        for (const pose of Poses.POSES) {
            const clip = Poses.clip(bones, pose.id, body);
            const seen = new Set();
            for (const t of clip.tracks) {
                const j = joints.get(t.bone);
                if (!j) continue;
                seen.add(t.bone);
                const label = `${pose.id} on ${name}: ${bones[t.bone].name}`;
                for (let f = 0; f < clip.times.length; f++) {
                    const q = key(t, f), { angle, off } = about(q, j.axis);
                    if (j.finger === 'Thumb') {
                        if (j.k === 1) assert.ok(angle >= R.thumbBase[0] - slack && angle <= R.thumbBase[1] + slack && off <= R.thumbRoll[1] + slack, `${label} base ${angle.toFixed(0)}, roll ${off.toFixed(0)}`);
                        else assert.ok(angle >= R.thumbJoint[0] - slack && angle <= R.thumbJoint[1] + slack && off < 1, `${label} ${angle.toFixed(0)} (${off.toFixed(1)} off its plane)`);
                        continue;
                    }
                    const range = j.k === 1 ? R.knuckle : j.k === 2 ? R.middle : R.end;
                    assert.ok(angle >= range[0] - slack && angle <= range[1] + slack, `${label} closes ${angle.toFixed(0)} degrees`);
                    if (j.k === 1) assert.ok(off <= Math.max(-R.spread[0], R.spread[1]) + slack, `${label} spreads ${off.toFixed(0)} degrees`);
                    else assert.ok(off < 1, `${label} bends ${off.toFixed(1)} degrees out of its plane`);
                }
            }
            assert.equal(seen.size, 30, `${pose.id} on ${name} shapes every finger`);
        }
    }
});

test('a closed hand stops at the palm: no fingertip passes into it, on any body, in any shape', () => {
    for (const [name] of BODIES) {
        const { bones } = bodyOf(name), frames = Poses.handFrames(bones), at = n => bones.findIndex(b => b.name === n);
        for (const shape of Object.keys(Poses.HAND_SHAPES)) {
            const tracks = Poses.handShape(bones, shape), local = bones.map(() => [0, 0, 0, 1]), W = [], pos = [];
            for (const t of tracks) local[t.bone] = key(t, 0);
            bones.forEach((b, i) => {
                if (b.parent < 0) { W[i] = local[i]; pos[i] = b.head.slice(); return; }
                W[i] = mul(W[b.parent], local[i]);
                const o = rot(W[b.parent], sub(b.head, bones[b.parent].head));
                pos[i] = pos[b.parent].map((v, k) => v + o[k]);
            });
            for (const S of ['Left', 'Right']) {
                const F = frames[S], hand = pos[at(S + 'Hand')];
                for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
                    const i = at(S + 'Hand' + f + '3'), b = bones[i], tip = sub(pos[i].map((v, k) => v + rot(W[i], sub(b.tail, b.head))[k]), hand);
                    const over = dot(tip, F.along) / F.length;
                    if (over < 0.1 || over > 1.05) continue;
                    assert.ok(dot(tip, F.palm) >= 0.2 * F.length, `${shape} on ${name}: the ${S.toLowerCase()} ${f.toLowerCase()} tip is ${(dot(tip, F.palm) * 100).toFixed(1)} cm off the palm`);
                }
            }
        }
    }
});

test('walking hands hang in line with the forearms, not cocked out at the wrist', () => {
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name), frames = Poses.handFrames(bones), at = n => bones.findIndex(b => b.name === n);
        for (const id of ['walk', 'run']) {
            const clip = Poses.clip(bones, id, body);
            for (const S of ['Left', 'Right']) {
                const t = clip.tracks.find(x => x.bone === at(S + 'Hand')), F = frames[S];
                for (let f = 0; f < clip.times.length; f++) {
                    // The hand's length after its turn, against the forearm's line (the hand at rest).
                    const a = rot(key(t, f), F.along), bend = Math.acos(Math.min(1, dot(a, F.along))) * DEG;
                    assert.ok(bend < 16, `${id} on ${name}: the ${S.toLowerCase()} wrist bends ${bend.toFixed(0)} degrees at frame ${f}`);
                }
            }
        }
    }
});

/** Every joint's turn and place at frame f of a clip, the body lifted as the clip says. */
function posed(bones, clip, f) {
    const local = bones.map(() => [0, 0, 0, 1]), W = [], pos = [];
    for (const t of clip.tracks) if (!t.path) local[t.bone] = key(t, f);
    bones.forEach((b, i) => {
        if (b.parent < 0) { W[i] = local[i]; pos[i] = [b.head[0], b.head[1] + clip.heights[f], b.head[2]]; return; }
        W[i] = mul(W[b.parent], local[i]);
        const o = rot(W[b.parent], sub(b.head, bones[b.parent].head));
        pos[i] = pos[b.parent].map((v, k) => v + o[k]);
    });
    return { W, pos };
}

test('a gun hand holds its grip on the line ahead of the eye, and a second hand meets the first, on every body', () => {
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name), F = Poses.handFrames(bones), at = n => bones.findIndex(b => b.name === n);
        const s = Math.max(...bones.map(b => b.head[1])) / 1.7;
        const grip = (W, pos, S) => { const i = at(S + 'Hand'), w = W[i], f = F[S]; return pos[i].map((v, k) => v + rot(w, f.along)[k] * f.length * 0.62 + rot(w, f.palm)[k] * f.length * 0.27); };
        for (const id of ['pistol', 'pistolTwo']) {
            const clip = Poses.clip(bones, id, body);
            for (let f = 0; f < clip.times.length; f += 8) {
                const { W, pos } = posed(bones, clip, f), head = at('Head');
                const eye = pos[head].map((v, k) => v + rot(W[head], [-0.031 * s, 0.062 * s, 0.078 * s])[k]), g = grip(W, pos, 'Right');
                // Level with the eye a hand's height under it, straight ahead of it.
                assert.ok(Math.abs(g[0] - eye[0]) < 0.05 * s, `${id} on ${name}: the gun hand is ${((g[0] - eye[0]) * 100).toFixed(1)} cm off the eye's line`);
                assert.ok(Math.abs(eye[1] - g[1] - 0.07 * s) < 0.05 * s && g[2] - eye[2] > 0.3 * s, `${id} on ${name}: the gun hand at ${g.map(v => v.toFixed(2))}, the eye at ${eye.map(v => v.toFixed(2))}`);
                if (id === 'pistolTwo') {
                    const l = grip(W, pos, 'Left'), d = Math.hypot(...sub(l, g));
                    assert.ok(d < 0.09 * s, `pistolTwo on ${name}: the hands ${(d * 100).toFixed(1)} cm apart`);
                }
            }
        }
        const sword = Poses.clip(bones, 'sword', body);
        for (let f = 0; f < sword.times.length; f += 6) {
            const { W, pos } = posed(bones, sword, f), d = Math.hypot(...sub(grip(W, pos, 'Left'), grip(W, pos, 'Right')));
            assert.ok(d > 0.05 * s && d < 0.13 * s, `sword on ${name}: the hands ${(d * 100).toFixed(1)} cm apart on the hilt at frame ${f}`);
        }
    }
});

test('standing motions keep the soles on the floor, never under it; a jump and the flips leave it and come back', () => {
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name), at = n => bones.findIndex(b => b.name === n), s = Math.max(...bones.map(b => b.head[1])) / 1.7;
        const low = (clip, f) => {
            const { W, pos } = posed(bones, clip, f);
            let least = Infinity;
            for (const S of ['Left', 'Right']) for (const [n, o] of [['Foot', [0, -0.065, -0.055]], ['ToeBase', [0, 0, 0]], ['ToeBase', [0, -0.012, 0.06]]]) {
                const i = at(S + n);
                least = Math.min(least, pos[i][1] + rot(W[i], o.map(v => v * s))[1] - (bones[i].head[1] + o[1] * s));
            }
            return least;
        };
        for (const p of Poses.POSES) {
            const clip = Poses.clip(bones, p.id, body);
            if (clip.skin) continue;
            let most = 0;
            for (let f = 0; f < clip.times.length; f++) {
                const l = low(clip, f);
                assert.ok(l > -0.012, `${p.id} on ${name}: a foot ${(l * 100).toFixed(1)} cm under the floor at frame ${f}`);
                most = Math.max(most, l);
            }
            if (['jump', 'frontFlip', 'backFlip'].includes(p.id)) {
                assert.ok(most > 0.3 * s, `${p.id} on ${name} leaves the floor (${most.toFixed(2)} m)`);
                assert.ok(low(clip, clip.times.length - 1) < 0.03 * s, `${p.id} on ${name} lands`);
            }
        }
    }
});

test('a saved character carries its motions as clips the game plays by name, keyed lean', () => {
    const runtime = path.join(root, '..', 'runtime');
    const R = require(path.join(runtime, 'reactor_3d.js'));
    const { bones, body } = bodyOf('man');
    const clips = Poses.gameClips(bones, body);
    const names = clips.map(c => c.name);
    // The movement states the game plays a model's own clips for, without anyone setting them up.
    const states = Object.fromEntries(R.ownClipAnimations([], names.map(name => ({ name })), null).map(rule => [rule.trigger, rule.clip]));
    assert.deepEqual(states, { walking: 'Walk', dashing: 'Run', jumping: 'Jump', swimming: 'Swim', treading: 'Tread Water', climbing: 'Climb' });
    for (const n of ['Sword Swing', 'Guard', 'Hit', 'Death', 'Cast Spell', 'Throw', 'Dodge', 'Pistol Aim', 'Rifle Aim', 'Fight Stance']) assert.ok(names.includes(n), n);
    assert.deepEqual(Poses.gameClips(bones, body, 'none'), []);
    assert.ok(Poses.gameClips(bones, body, 'all').length === Poses.GAME_CLIPS.length, 'all the motions');
    let bytes = 0;
    const hips = bones.findIndex(b => b.parent < 0);
    for (const c of clips) {
        const end = c.times[c.times.length - 1];
        assert.ok(c.tracks.some(t => t.bone === hips && t.path === 'translation'), `${c.name} carries the hips' height`);
        for (const t of c.tracks) {
            const d = t.path ? 3 : 4;
            assert.equal(t.values.length, t.times.length * d, `${c.name}: ${bones[t.bone].name} keys`);
            assert.ok(t.times[0] === 0 && Math.abs(t.times[t.times.length - 1] - end) < 1e-6, `${c.name}: ${bones[t.bone].name} spans the clip`);
            for (let i = 1; i < t.times.length; i++) assert.ok(t.times[i] > t.times[i - 1], `${c.name}: keys in order`);
            bytes += t.values.length * 4 + t.times.length * 4;
        }
    }
    assert.ok(bytes < 400 * 1024, `the motions' keys come to ${(bytes / 1024).toFixed(0)} KB`);
    // A body lying down lies on the floor: its lowest skin at the floor when the fall has ended.
    const death = clips.find(c => c.name === 'Death'), t = death.tracks.find(x => x.path === 'translation');
    assert.ok(t.values[t.values.length - 2] < bones[hips].head[1] * 0.45, 'the fallen body lies low');
});

test('every pose sits in one of the list\'s groups, and the builder\'s pose picker shows them under those groups', () => {
    const vm = require('node:vm'), fs = require('node:fs');
    const ids = new Set(Poses.GROUPS.map(g => g.id));
    for (const p of Poses.POSES) assert.ok(ids.has(p.group), `${p.id} has a group`);
    const picker = { dataset: {}, innerHTML: '', value: '' };
    const ctx = { window: {}, rrEscapeHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'), RRCharacterPoses: Poses };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'Character3DBuilder.js'), 'utf8'), ctx);
    const b = Object.create(ctx.window.Character3DBuilder.prototype);
    Object.assign(b, { pose: 'rifle', root: { querySelector: () => picker }, _t: s => s });
    b._syncPose();
    assert.equal(picker.value, 'rifle');
    const groups = [...picker.innerHTML.matchAll(/<optgroup label="([^"]*)">(.*?)<\/optgroup>/g)];
    assert.deepEqual(groups.map(m => m[1]), Poses.GROUPS.map(g => g.label));
    for (const [, label, body] of groups) {
        const names = [...body.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map(m => m[1]);
        const want = Poses.POSES.filter(p => Poses.GROUPS.find(g => g.label === label).id === p.group).map(p => p.label);
        assert.deepEqual(names.slice().sort(), want.slice().sort(), `${label} holds its poses`);
        assert.deepEqual(names, names.slice().sort((x, y) => x.localeCompare(y)), `${label} in order`);
    }
});

test('every leg joint stays within its reach in every clip: hip, knee a hinge never past straight, ankle, toes; a standing foot points near where its knee does', () => {
    const R = Poses.LEG_RANGE, slack = 1.5;
    const logOf = q => { const w = q[3] < 0 ? -1 : 1, c = Math.min(1, q[3] * w), a = 2 * Math.acos(c), k = a > 1e-6 ? a / Math.sin(a / 2) : 2; return [q[0] * w * k * DEG, q[1] * w * k * DEG, q[2] * w * k * DEG]; };
    const conj = q => [-q[0], -q[1], -q[2], q[3]];
    for (const [name] of BODIES) {
        const { bones, body } = bodyOf(name), at = n => bones.findIndex(b => b.name === n);
        for (const pose of Poses.POSES) {
            const clip = Poses.clip(bones, pose.id, body);
            for (let f = 0; f < clip.times.length; f++) {
                const { W } = posed(bones, clip, f);
                for (const S of ['Left', 'Right']) {
                    const parentOf = { UpLeg: 'Hips', Leg: S + 'UpLeg', Foot: S + 'Leg', ToeBase: S + 'Foot' };
                    for (const n of ['UpLeg', 'Leg', 'Foot', 'ToeBase']) {
                        const v = logOf(mul(conj(W[at(parentOf[n])]), W[at(S + n)])), r = R[n], label = `${pose.id} on ${name}: ${S}${n} at frame ${f}`;
                        assert.ok(v[0] >= r.x[0] - slack && v[0] <= r.x[1] + slack, `${label} bends ${v[0].toFixed(0)}`);
                        assert.ok(Math.abs(v[1]) <= r.y + slack && Math.abs(v[2]) <= r.z + slack, `${label} turns ${v[1].toFixed(0)}, tilts ${v[2].toFixed(0)}`);
                    }
                    // The foot against the knee: both read square to the shin, on a level foot.
                    const leg = at(S + 'Leg'), foot = at(S + 'Foot'), shin = rot(W[leg], sub(bones[foot].head, bones[leg].head)).map(v => v / Math.hypot(...sub(bones[foot].head, bones[leg].head)));
                    const off = (v, d) => { const k = dot(v, d); const o = v.map((x, i) => x - d[i] * k), l = Math.hypot(...o) || 1; return o.map(x => x / l); };
                    const fr = sub(bones[at(S + 'ToeBase')].head, bones[foot].head), fw = rot(W[foot], fr.map(v => v / Math.hypot(...fr)));
                    // (A leg standing: its shin near upright, its foot near level.)
                    if (Math.abs(fw[1]) > 0.5 || shin[1] > -0.75) continue;
                    const knee = off(rot(W[leg], [0, 0, 1]), shin), toe = off(fw, shin);
                    const angle = Math.acos(Math.max(-1, Math.min(1, dot(knee, toe)))) * DEG;
                    assert.ok(angle < 40, `${pose.id} on ${name}: the ${S.toLowerCase()} foot points ${angle.toFixed(0)} degrees off its knee at frame ${f}`);
                }
            }
        }
    }
});

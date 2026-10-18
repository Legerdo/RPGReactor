#!/usr/bin/env node
/**
 * Builds the 3D Character Builder's motions from the CMU Graphics Lab Motion
 * Capture Database (mocap.cs.cmu.edu, free for all uses).
 *
 *   node editor/build-scripts/build-poses.cjs <folder of CMU .asf/.amc files>
 *
 * Writes src/forge/Character3D/CharacterPosesData.js. The folder holds the
 * subjects' skeletons (`35.asf`) and the trials named in TAKES (`35_01.amc`),
 * as served at http://mocap.cs.cmu.edu/subjects/<subject>/.
 *
 * Each take is cut to a loop, turned to face +z (left toward +x), mirrored
 * when its hands are the wrong way round, and sampled at 30 frames a second.
 * Every mapped bone is kept as a frame in the world: the direction from its
 * joint to the next one, and a second direction across it (where the elbow
 * bends, the front of a thigh, the thumb side of a hand) that carries its
 * twist. CharacterPoses.js turns these into each body's own joint turns, so
 * the motions hold for any height, limb length or build. The loop's last
 * frame repeats the first.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FPS = 30;
const INCH = 0.0254;

// ── vectors, matrices (row-major 3x3) and quaternions ──────────────────────
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const orth = (s, d) => norm(sub(s, scale(d, dot(s, d))));
const mm = (A, B) => { const R = new Array(9); for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return R; };
const mv = (A, v) => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
const tr = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const rz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const DEG = Math.PI / 180;
/** An Acclaim rotation: x first, then y, then z, about the fixed axes. */
const euler = (x, y, z) => mm(rz(z * DEG), mm(ry(y * DEG), rx(x * DEG)));
/** The frame whose columns are d, s made square to d, and d x s. */
const frame = (d, s) => { const a = norm(d), b = orth(s, a), c = cross(a, b); return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]]; };
function matQuat(m) {
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m, t = m00 + m11 + m22;
    let q;
    if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
    else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
    else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
    else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
    const l = Math.hypot(...q);
    return q.map(v => v / l);
}
const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const qinv = q => [-q[0], -q[1], -q[2], q[3]];
function qpow(q, k) {
    const w = Math.max(-1, Math.min(1, q[3])), a = Math.acos(w), s = Math.sin(a);
    if (s < 1e-9) return [0, 0, 0, 1];
    const b = a * k, f = Math.sin(b) / s;
    return [q[0] * f, q[1] * f, q[2] * f, Math.cos(b)];
}

// ── Acclaim skeleton (.asf) and motion (.amc) ──────────────────────────────
function parseAsf(text) {
    const lines = text.split(/\r?\n/);
    const bones = { root: { name: 'root', dir: [0, 0, 0], length: 0, C: euler(0, 0, 0), dof: ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'], children: [] } };
    let unit = 1, i = 0, current = null, section = '';
    for (; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t.startsWith(':')) { section = t.split(/\s+/)[0]; continue; }
        const p = t.split(/\s+/);
        if (section === ':units' && p[0] === 'length') unit = +p[1];
        if (section === ':bonedata') {
            if (p[0] === 'begin') current = { dof: [], children: [] };
            else if (p[0] === 'end' && current) { bones[current.name] = current; current = null; }
            else if (current && p[0] === 'name') current.name = p[1];
            else if (current && p[0] === 'direction') current.dir = norm([+p[1], +p[2], +p[3]]);
            else if (current && p[0] === 'length') current.length = +p[1];
            else if (current && p[0] === 'axis') current.C = euler(+p[1], +p[2], +p[3]);
            else if (current && p[0] === 'dof') current.dof = p.slice(1).map(s => s.toLowerCase());
        }
        if (section === ':hierarchy' && p[0] !== 'begin' && p[0] !== 'end' && p.length > 1) {
            for (const c of p.slice(1)) { bones[c].parent = p[0]; bones[p[0]].children.push(c); }
        }
    }
    for (const b of Object.values(bones)) b.Ci = tr(b.C);
    // Lengths in meters: an Acclaim unit is 1/length inches.
    return { bones, meters: INCH / unit };
}

function parseAmc(text) {
    const frames = [];
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith(':')) continue;
        if (/^\d+$/.test(t)) { cur = {}; frames.push(cur); continue; }
        if (!cur) continue;
        const p = t.split(/\s+/);
        cur[p[0]] = p.slice(1).map(Number);
    }
    return frames;
}

/** Every bone's world turn from the skeleton's rest, and every joint's place (each bone's far end), in meters. */
function pose(asf, values) {
    const { bones, meters } = asf, rot = {}, pos = {};
    const visit = name => {
        const b = bones[name], v = values[name] || [];
        const a = { tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0 };
        b.dof.forEach((d, k) => { a[d] = v[k] || 0; });
        const local = mm(b.C, mm(euler(a.rx, a.ry, a.rz), b.Ci));
        if (name === 'root') { rot.root = local; pos.root = scale([a.tx, a.ty, a.tz], meters); }
        else {
            rot[name] = mm(rot[b.parent], local);
            pos[name] = add(pos[b.parent], mv(rot[name], scale(b.dir, b.length * meters)));
        }
        for (const c of b.children) visit(c);
    };
    visit('root');
    return { rot, pos };
}

// ── which joints make each of the builder's bones ──────────────────────────
// `from`/`to` name the joints (a bone's far end; 'root' the pelvis), `twist`
// the source bone whose turn carries the second direction, `side` that
// direction at the source's rest, or a rule to work it out. The trunk, neck,
// head and collarbones place their joints differently from the builder's
// skeleton, so they keep their own rest and take the capture's turns from
// its rest (`rest`: the direction both skeletons share along the bone);
// limbs follow the captured directions themselves.
const Z = [0, 0, 1], Y = [0, 1, 0];
const MAP = {
    Hips: { twist: 'root', rest: Y, side: Z },
    Spine: { twist: 'lowerback', rest: Y, side: Z },
    Spine1: { twist: 'upperback', rest: Y, side: Z },
    Spine2: { twist: 'thorax', rest: Y, side: Z },
    Neck: { twist: 'lowerneck', also: 'upperneck', rest: Y, side: Z },
    Head: { twist: 'head', rest: Y, side: Z }
};
for (const [S, s] of [['Left', 'l'], ['Right', 'r']]) Object.assign(MAP, {
    [S + 'Shoulder']: { twist: s + 'clavicle', rest: [S === 'Left' ? 1 : -1, 0, 0], side: Z },
    [S + 'Arm']: { from: s + 'clavicle', to: s + 'humerus', twist: s + 'humerus', side: 'elbow' },
    [S + 'ForeArm']: { from: s + 'humerus', to: s + 'radius', twist: s + 'radius', also: s + 'wrist', side: 'elbow' },
    [S + 'Hand']: { from: s + 'wrist', to: s + 'hand', twist: s + 'hand', side: Z },
    [S + 'UpLeg']: { from: s + 'hipjoint', to: s + 'femur', twist: s + 'femur', side: Z },
    [S + 'Leg']: { from: s + 'femur', to: s + 'tibia', twist: s + 'tibia', side: Z },
    [S + 'Foot']: { from: s + 'tibia', to: s + 'foot', twist: s + 'foot', side: Y },
    [S + 'ToeBase']: { from: s + 'foot', to: s + 'toes', twist: s + 'toes', side: Y }
});
const BONES = Object.keys(MAP);

/** At the skeleton's rest, the second direction of each mapped bone (in the world, rest being unturned). */
function restSides(asf) {
    const out = {};
    for (const [name, m] of Object.entries(MAP)) {
        if (m.side !== 'elbow') { out[name] = m.side; continue; }
        // Where the elbow bends: the forearm's tip swings about its hinge (the radius's x axis), flexing forward.
        const r = asf.bones[m.twist.replace('humerus', 'radius')];
        const hinge = mv(r.C, [1, 0, 0]);
        out[name] = orth(cross(hinge, r.dir), r.dir);
    }
    return out;
}

/** One frame of the take as the mapped bones' world frames, plus where the joints are. */
function frames(asf, values, sides) {
    const { rot, pos } = pose(asf, values), out = {};
    for (const [name, m] of Object.entries(MAP)) {
        let d = m.rest ? mv(rot[m.twist], m.rest) : sub(pos[m.to], pos[m.from]);
        let s = mv(rot[m.twist], sides[name]);
        // A bone made of two takes half of each (the neck); the forearm turns half way to the wrist's
        // twist, so the twist spreads along it.
        if (m.also) { s = add(s, mv(rot[m.also], sides[name])); if (m.rest) d = add(d, mv(rot[m.also], m.rest)); }
        out[name] = { d: norm(d), s: orth(s, norm(d)) };
    }
    return { bones: out, pos };
}

// ── the takes ──────────────────────────────────────────────────────────────
/**
 * Per pose: the trial, the stretch of it to use (seconds), whether to mirror
 * it, and which way the body faces (`face`: the pelvis's front to +z, or for
 * a body lying down the line from its hips toward its head given). A loop
 * looks within the stretch for a cycle of `cycle` seconds whose ends meet; a
 * `swing` plays a held pose's stretch forward and back over `period`
 * seconds; otherwise the whole stretch plays. `air` keeps the take's own
 * height off the floor (a jump, a run's flight), `hover` holds the body that
 * many leg lengths up (a fall), and `skin` rests the body itself on the floor.
 * `borrow` takes some bones from another take instead; `fist` closes the hands.
 */
let TAKES = {
    walk: { trial: '35_01', from: 0.1, to: 2.9, cycle: [0.9, 1.4] },
    run: { trial: '09_01', from: 0.05, to: 1.2, cycle: [0.55, 0.85], air: true },
    crouch: { trial: '136_09', from: 1.5, to: 2.3, swing: true, period: 2.4 },
    jump: { trial: '13_39', from: 0, to: 2.9, air: true },
    fall: { trial: '82_04', from: 1.9, to: 2.35, swing: true, period: 1.4, hover: 0.35 },
    fight: { trial: '14_01', from: 8.8, to: 11.3, cycle: [1.0, 1.4], fist: true },
    wave: { trial: '143_25', from: 2.2, to: 3.12, cycle: [0.45, 0.85], mirror: true },
    armsUp: { trial: '13_10', from: 8.1, to: 9.0, swing: true, period: 2.6 },
    kneel: { trial: '23_03', from: 2.0, to: 3.8, swing: true, period: 3.6, skin: true, borrow: { trial: '111_28', from: 1.0, to: 2.8, bones: ['RightArm', 'RightForeArm', 'RightHand'] } },
    sit: { trial: '82_05', from: 2.0, to: 6.5, cycle: [2.0, 4.4], skin: true },
    lieBack: { trial: '113_08', from: 5.5, to: 9.0, cycle: [2.0, 3.4], skin: true, face: { bone: 'Hips', to: [0, 0, -1] } },
    lieSide: { trial: '140_04', from: 0, to: 1.3, swing: true, period: 3.2, skin: true, mirror: true, face: { bone: 'Hips', to: [-1, 0, 0] } }
};

/** A world turn about y by a. */
const yaw = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];

function load(dir, trial) {
    const subject = trial.split('_')[0];
    const asf = parseAsf(fs.readFileSync(path.join(dir, subject + '.asf'), 'utf8'));
    const amc = parseAmc(fs.readFileSync(path.join(dir, trial + '.amc'), 'utf8'));
    return { asf, amc };
}

/** The frames of a stretch of the take at FPS, turned and mirrored as asked. */
function sample(src, take, from, to) {
    const { asf, amc } = src, sides = restSides(asf), step = take.rate || 120;
    // A swing plays the stretch forward and back again, easing at each end, over `period` seconds.
    const n = Math.round((take.swing ? take.period : to - from) * FPS) + 1, out = [];
    for (let i = 0; i < n; i++) {
        const u = take.swing ? (1 - Math.cos(2 * Math.PI * i / (n - 1))) / 2 : i / (n - 1);
        const t = from + (to - from) * u, k = Math.min(amc.length - 1, Math.max(0, Math.round(t * step)));
        out.push(frames(asf, amc[k], sides));
    }
    return out;
}

const MIRROR = n => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;
const JOINT_MIRROR = n => /^l[a-z]/.test(n) && n !== 'lowerback' && n !== 'lowerneck' ? 'r' + n.slice(1) : /^r[a-z]/.test(n) && n !== 'root' ? 'l' + n.slice(1) : n;
const flip = v => [-v[0], v[1], v[2]];

function orient(list, take) {
    // Mirrored: every direction reflected left for right, and the sides swapped.
    if (take.mirror) list = list.map(f => {
        const bones = {}, pos = {};
        for (const [n, b] of Object.entries(f.bones)) bones[MIRROR(n)] = { d: flip(b.d), s: flip(b.s) };
        for (const [n, p] of Object.entries(f.pos)) pos[JOINT_MIRROR(n)] = flip(p);
        return { bones, pos };
    });
    // Facing: the heading that brings the chosen line round to its direction, averaged over the stretch.
    let sx = 0, sz = 0;
    const face = take.face || { bone: 'Hips', side: true, to: [0, 0, 1] };
    for (const f of list) {
        const b = f.bones[face.bone], v = face.side ? b.s : b.d;
        sx += v[0]; sz += v[2];
    }
    const R = yaw(Math.atan2(face.to[0], face.to[2]) - Math.atan2(sx, sz));
    return list.map(f => {
        const bones = {}, pos = {};
        for (const [n, b] of Object.entries(f.bones)) bones[n] = { d: mv(R, b.d), s: mv(R, b.s) };
        for (const [n, p] of Object.entries(f.pos)) pos[n] = mv(R, p);
        return { bones, pos };
    });
}

/** How far off its pose one frame is from another (summed over bones, about radians squared). */
function distance(a, b) {
    let e = 0;
    for (const n of BONES) e += 2 - dot(a.bones[n].d, b.bones[n].d) - dot(a.bones[n].s, b.bones[n].s);
    return e;
}

/** For a loop of steps: the start and length in the stretch whose ends meet best, in pose and in motion. */
function bestCycle(list, take) {
    const lo = Math.round(take.cycle[0] * FPS), hi = Math.round(take.cycle[1] * FPS);
    let best = null;
    for (let a = 1; a + lo + 1 < list.length; a++) for (let T = lo; T <= hi && a + T + 1 < list.length; T++) {
        const e = distance(list[a], list[a + T]) + 0.5 * (distance(list[a - 1], list[a + T - 1]) + distance(list[a + 1], list[a + T + 1]));
        if (!best || e < best.e) best = { a, T, e };
    }
    return best;
}

/** Bone frames as quaternions; a loop's mismatch at its seam spread evenly over it, so the last frame is the first. */
function seal(list) {
    const qs = list.map(f => Object.fromEntries(BONES.map(n => [n, matQuat(frame(f.bones[n].d, f.bones[n].s))])));
    const N = qs.length - 1;
    for (const n of BONES) {
        for (let i = 1; i <= N; i++) if (dot4(qs[i][n], qs[i - 1][n]) < 0) qs[i][n] = qs[i][n].map(v => -v);
        const miss = qmul(qs[0][n], qinv(qs[N][n]));
        for (let i = 0; i <= N; i++) qs[i][n] = norm4(qmul(qpow(miss, i / N), qs[i][n]));
    }
    return qs;
}
const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const norm4 = q => { const l = Math.hypot(...q); return q.map(v => v / l); };

/** The body's height above its standing height (the lowest foot's lift off the floor), per frame, in leg lengths. */
function clearance(list, legLength, floor) {
    return list.map(f => {
        let low = Infinity;
        for (const j of ['lfoot', 'rfoot', 'ltoes', 'rtoes', 'ltibia', 'rtibia']) if (f.pos[j]) low = Math.min(low, f.pos[j][1] - (floor[j] || 0));
        return low / legLength;
    });
}

function encode(values) {
    const a = new Int16Array(values.length);
    values.forEach((v, i) => { a[i] = Math.max(-32767, Math.min(32767, Math.round(v * 32767))); });
    return Buffer.from(a.buffer).toString('base64');
}

function build(dir) {
    const out = {};
    for (const [id, take] of Object.entries(TAKES)) {
        const src = load(dir, take.trial);
        let list = orient(sample(src, take, take.from, take.to), take);
        if (take.cycle) {
            const c = bestCycle(list, take);
            console.log(`${id}: cycle ${(c.T / FPS).toFixed(2)} s from ${(take.from + c.a / FPS).toFixed(2)} s, seam ${c.e.toFixed(3)}`);
            list = list.slice(c.a, c.a + c.T + 1);
        } else console.log(`${id}: ${(take.to - take.from).toFixed(2)} s, seam ${distance(list[0], list[list.length - 1]).toFixed(3)}`);
        // Bones borrowed from another take, played over the same frames (an arm at rest by the side).
        if (take.borrow) {
            const o = take.borrow, other = load(dir, o.trial);
            const from = orient(sample(other, Object.assign({}, take, o, { period: take.swing ? take.period : (list.length - 1) / FPS }), o.from, o.to), o);
            list = list.map((f, i) => ({ pos: f.pos, bones: Object.assign({}, f.bones, Object.fromEntries(o.bones.map(n => [n, from[Math.min(from.length - 1, i)].bones[n]]))) }));
        }
        const qs = seal(list);
        // Leg length, and the standing heights of the ankles, balls and toe tips, from the skeleton at rest.
        const b = src.asf.bones, m = src.asf.meters;
        const leg = (b.lfemur.length + b.ltibia.length) * m;
        const rest = pose(src.asf, {}).pos, ground = Math.min(rest.ltoes[1], rest.rtoes[1]);
        const floor = {}; for (const j of ['lfoot', 'rfoot', 'ltoes', 'rtoes', 'ltibia', 'rtibia']) floor[j] = rest[j][1] - ground;
        // The take's floor: where its lowest foot stands through most of the stance (a quarter of the
        // frames lower still), so the feet's small rolls on the floor read as standing, not as flight.
        const lows = clearance(list, leg, floor), base = lows.slice().sort((a, b) => a - b)[Math.floor(lows.length / 4)];
        // A body held off the floor (a fall) stands `hover` leg lengths above it throughout.
        const air = take.hover ? list.map(() => take.hover) : lows.map(v => Math.max(0, v - base));
        // Seam the height too, so the loop never steps.
        const N = air.length - 1, gap = air[N] - air[0];
        const rise = air.map((v, i) => v - gap * i / N);
        out[id] = {
            frames: qs.length, air: !!(take.air || take.hover), skin: !!take.skin, fist: !!take.fist,
            rise: encode(rise.map(v => Math.max(-1, Math.min(1, v)))),
            bones: Object.fromEntries(BONES.map(n => [n, encode(qs.flatMap(q => q[n]))]))
        };
    }
    return out;
}

if (require.main === module) {
    const dir = process.argv[2];
    if (!dir || !fs.existsSync(dir)) { console.error('usage: build-poses.cjs <folder of CMU .asf/.amc files>'); process.exit(1); }
    const data = build(dir);
    const file = path.join(__dirname, '..', 'src', 'forge', 'Character3D', 'CharacterPosesData.js');
    const body = JSON.stringify({ fps: FPS, bones: BONES, poses: data });
    fs.writeFileSync(file, `/**\n * RRCharacterPosesData - motion capture for RRCharacterPoses, made by\n * editor/build-scripts/build-poses.cjs from the CMU Graphics Lab Motion\n * Capture Database (mocap.cs.cmu.edu; see data/LICENSE.md). Per pose, each\n * bone's world frame per frame as Int16 quaternions (base64), and \`rise\`,\n * the body's height off the floor in leg lengths.\n */\n(function (root) {\n    'use strict';\n    const data = ${body};\n    root.RRCharacterPosesData = data;\n    if (typeof module !== 'undefined' && module.exports) module.exports = data;\n})(typeof window !== 'undefined' ? window : globalThis);\n`);
    console.log(`wrote ${file} (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

module.exports = { TAKES, setTakes: t => { TAKES = t; }, build, load, pose, restSides, BONES, mv };

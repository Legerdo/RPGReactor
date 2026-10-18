/**
 * RRCharacterPoses - poses and motions to try a humanoid character in: the
 * 3D Character Builder's view plays them to show where a body, its clothes
 * and its hair hold up and where they do not.
 *
 *   RRCharacterPoses.POSES             [{ id, label }], in the panel's order
 *   RRCharacterPoses.clip(bones, id, body)   { name, times, tracks: [{ bone, values }], heights, lift, skin } or null
 *
 * `body` (optional) is the built body's skin at rest, { positions, joints,
 * weights } as the model's Body part holds them: the arms then keep out of
 * the trunk as this body is shaped.
 *
 * Bones rest unrotated (each one's frame is the world's), as the builder
 * saves them; the character faces +z with its left toward +x. A track holds
 * one quaternion per time. The motions are motion capture
 * (RRCharacterPosesData, from the CMU Graphics Lab Motion Capture Database):
 * per frame, each mapped bone's frame in the world, a direction along it and
 * one across it. Each body's own joints are turned to match them, so a
 * motion holds for any height, limb length or build; the arms keep out of
 * the body's own trunk, and the hands off the face. The fingers
 * stay at rest, or close in a fist where the pose says so. `lift(t)` is how
 * far the whole body stands off its rest height at time t: worked out by
 * following the skeleton joint by joint, so the lowest heel, ball or toe
 * touches the floor, and for a jump or a run's flight the capture's own
 * height off it added, in leg lengths. A pose resting the body itself on the
 * floor (sitting, kneeling, lying) says `skin`: the view then sets its
 * lowest skin on the floor.
 */
(function (root) {
    'use strict';

    const POSES = [
        { id: 'walk', label: 'Walking' }, { id: 'run', label: 'Running' }, { id: 'crouch', label: 'Crouching' }, { id: 'jump', label: 'Jumping' },
        { id: 'fall', label: 'Falling' }, { id: 'fight', label: 'Fighting stance' }, { id: 'wave', label: 'Waving' }, { id: 'armsUp', label: 'Arms up' },
        { id: 'kneel', label: 'Kneeling' }, { id: 'sit', label: 'Sitting' }, { id: 'lieBack', label: 'Lying on the back' }, { id: 'lieSide', label: 'Lying on the side' }
    ];

    const quat = (x, y, z, a) => { const s = Math.sin(a / 2); return [x * s, y * s, z * s, Math.cos(a / 2)]; };
    const mul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    const rotate = (q, v) => {
        const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
        return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    /** How far each joint's flesh reaches below it, by name (meters on a 1.7 m body): the floor stops it there. */
    const REACH = { Hips: 0.11, Spine: 0.1, Spine1: 0.1, Spine2: 0.11, Neck: 0.06, Head: 0.1, Arm: 0.05, ForeArm: 0.04, Hand: 0.025, UpLeg: 0.085, Leg: 0.055 };

    const DATA = root.RRCharacterPosesData || (typeof require === 'function' ? (() => { try { return require('./CharacterPosesData.js'); } catch (e) { return null; } })() : null);
    const decoded = new Map();
    /** A base64 run of little-endian Int16 as numbers in -1..1. */
    function decode(text) {
        let bytes;
        if (typeof Buffer !== 'undefined') bytes = Buffer.from(text, 'base64');
        else { const raw = atob(text); bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i); }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Float32Array(bytes.byteLength >> 1);
        for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32767;
        return out;
    }
    function take(id) {
        if (decoded.has(id)) return decoded.get(id);
        const p = DATA && DATA.poses && DATA.poses[id];
        const t = p ? { frames: p.frames, air: p.air, skin: !!p.skin, fist: !!p.fist, rise: decode(p.rise), bones: Object.fromEntries(Object.entries(p.bones).map(([n, v]) => [n, decode(v)])) } : null;
        decoded.set(id, t);
        return t;
    }
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const square = (s, d) => { const k = dot(s, d); return unit([s[0] - d[0] * k, s[1] - d[1] * k, s[2] - d[2] * k]); };
    const conj = q => [-q[0], -q[1], -q[2], q[3]];
    /** The turn taking x to d and y to s (made square to d). */
    function frameQuat(d, s) {
        const a = unit(d), b = square(s, a), c = cross(a, b);
        const m00 = a[0], m01 = b[0], m02 = c[0], m10 = a[1], m11 = b[1], m12 = c[1], m20 = a[2], m21 = b[2], m22 = c[2], t = m00 + m11 + m22;
        let q;
        if (t > 0) { const k = 0.5 / Math.sqrt(t + 1); q = [(m21 - m12) * k, (m02 - m20) * k, (m10 - m01) * k, 0.25 / k]; }
        else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k]; }
        else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k]; }
        else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k]; }
        const l = Math.hypot(...q);
        return q.map(v => v / l);
    }

    /**
     * Each mapped bone's own frame at rest, as the capture's frames are made.
     * The trunk, neck and head stand straight up and the collarbones straight
     * out, facing front, so they take the capture's turns from its rest and
     * keep the body's own posture; a limb runs along the bone toward the next
     * joint (the toes straight ahead), across it toward the front, up for a
     * foot, toward where the elbow bends for an arm, toward the thumb for a
     * hand, and follows the captured directions.
     */
    function restFrames(bones, index) {
        const at = n => index.has(n) ? bones[index.get(n)].head : null;
        const along = (n, next, fallback) => (at(n) && at(next) ? sub(at(next), at(n)) : fallback);
        const F = [0, 0, 1], U = [0, 1, 0], out = {};
        const put = (n, d, s) => { if (index.has(n)) out[n] = frameQuat(d, s); };
        for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']) put(n, U, F);
        for (const S of ['Left', 'Right']) {
            put(S + 'Shoulder', [S === 'Left' ? 1 : -1, 0, 0], F);
            const u = along(S + 'Arm', S + 'ForeArm', [S === 'Left' ? 1 : -1, -1, 0]), f = along(S + 'ForeArm', S + 'Hand', u);
            // A straight arm at rest bends its elbow toward the front.
            const bend = Math.abs(dot(unit(u), unit(f))) > 0.999 ? F : f;
            put(S + 'Arm', u, bend);
            put(S + 'ForeArm', f, Math.abs(dot(unit(u), unit(f))) > 0.999 ? F : u.map(v => -v));
            const knuckles = at(S + 'HandIndex1') && at(S + 'HandPinky1') ? sub(at(S + 'HandIndex1'), at(S + 'HandPinky1')) : F;
            put(S + 'Hand', along(S + 'Hand', S + 'HandMiddle1', f), knuckles);
            put(S + 'UpLeg', along(S + 'UpLeg', S + 'Leg', [0, -1, 0]), F);
            put(S + 'Leg', along(S + 'Leg', S + 'Foot', [0, -1, 0]), F);
            put(S + 'Foot', along(S + 'Foot', S + 'ToeBase', F), U);
            put(S + 'ToeBase', F, U);
        }
        return out;
    }

    /** Points under each foot that bear on the floor: the heel, the ball and the toe tip, off the ankle and the ball joint (meters on a 1.7 m body). */
    const SOLE = { Foot: [[0, -0.065, -0.055]], ToeBase: [[0, 0, 0], [0, -0.012, 0.06]] };

    /** How far each finger joint closes in a fist (radians), knuckle to tip; the thumb's last two joints bend a little. */
    const CURL = { 1: 1.55, 2: 1.75, 3: 1.2 }, THUMB = { 2: 0.5, 3: 0.6 };
    /**
     * The hands closed: each finger turns about the line of the knuckles,
     * toward the palm (the side facing the body at rest), and the thumb
     * folds across the front of the curled fingers.
     */
    function fists(bones, index, steps) {
        const out = [];
        const hold = (i, q) => { const values = new Float32Array(steps * 4); for (let n = 0; n < steps; n++) values.set(q, n * 4); out.push({ bone: i, values }); };
        for (const [S, m] of [['Left', 1], ['Right', -1]]) {
            const at = n => index.has(S + n) ? bones[index.get(S + n)].head : null;
            const hand = at('Hand'), mid = at('HandMiddle1'), a = at('HandIndex1'), b = at('HandPinky1');
            if (!hand || !mid || !a || !b) continue;
            const along = unit(sub(mid, hand));
            let axis = square(sub(a, b), along);
            // The palm faces the body's middle at rest; the fingers close toward it.
            if (dot(cross(axis, along), [-hand[0], 0, 0]) < 0) axis = axis.map(v => -v);
            const palm = cross(axis, along);
            for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const k of [1, 2, 3]) {
                const i = index.get(S + 'Hand' + f + k);
                if (i !== undefined) hold(i, quat(axis[0], axis[1], axis[2], CURL[k]));
            }
            // The thumb swings about the hand's length, round past the palm to lie across the curled fingers
            // (the same turn both sides in the mirror), and its joints bend in.
            const t1 = index.get(S + 'HandThumb1'), ta = at('HandThumb1'), tb = at('HandThumb2');
            if (t1 !== undefined) hold(t1, quat(along[0], along[1], along[2], 1.6 * m));
            const bend = ta && tb ? unit(cross(unit(sub(tb, ta)), palm)) : axis;
            for (const k of [2, 3]) {
                const i = index.get(S + 'HandThumb' + k);
                if (i !== undefined) hold(i, quat(bend[0], bend[1], bend[2], THUMB[k]));
            }
        }
        return out;
    }

    /** The ball round the face a hand keeps out of, off the head joint (meters on a 1.7 m body). */
    const FACE = { at: [0, -0.01, 0.03], radius: 0.22 };
    /** The trunk's bones, whose skin the arms keep out of, and the height of each slice it is measured in. */
    const TRUNK = ['Hips', 'Spine', 'Spine1', 'Spine2'], SLICE = 0.03;

    /**
     * The body's own trunk and arms, measured from its skin at rest: for each
     * trunk bone, its skin in slices up the bone to the armpits (how far it
     * reaches to each side, in front and behind), and how thick each arm
     * bone's flesh is.
     * Each skin vertex counts for the bone that moves it most.
     */
    function measure(bones, index, body, scale) {
        if (!body || !body.positions || !body.joints || !body.weights) return null;
        const trunk = new Map(TRUNK.filter(n => index.has(n)).map(n => [index.get(n), new Map()]));
        const limbs = new Map(), band = SLICE * scale;
        for (const S of ['Left', 'Right']) for (const [n, next] of [['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['Hand', 'HandMiddle1']]) {
            if (index.has(S + n) && index.has(S + next)) limbs.set(index.get(S + n), { a: bones[index.get(S + n)].head, b: bones[index.get(S + next)].head, sum: 0, count: 0 });
        }
        // The trunk is measured up to the armpits: above them its skin runs out over the shoulders.
        const P = body.positions, J = body.joints, W = body.weights, arm = index.has('LeftArm') ? bones[index.get('LeftArm')].head[1] : Infinity, top = arm - 0.08 * scale;
        for (let v = 0; v * 3 < P.length; v++) {
            let j = J[v * 4], w = W[v * 4];
            for (let k = 1; k < 4; k++) if (W[v * 4 + k] > w) { w = W[v * 4 + k]; j = J[v * 4 + k]; }
            const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
            const slices = trunk.get(j);
            if (slices) {
                if (p[1] > top) continue;
                const h = bones[j].head, key = Math.floor((p[1] - h[1]) / band), x = Math.abs(p[0] - h[0]), z = p[2] - h[2];
                const s = slices.get(key);
                if (s) { s.side = Math.max(s.side, x); s.front = Math.max(s.front, z); s.back = Math.min(s.back, z); }
                else slices.set(key, { side: x, front: z, back: z });
                continue;
            }
            const limb = limbs.get(j);
            if (limb) {
                // Distance from the bone's line.
                const d = sub(limb.b, limb.a), l2 = dot(d, d) || 1, t = Math.max(0, Math.min(1, dot(sub(p, limb.a), d) / l2));
                limb.sum += Math.hypot(...sub(p, [limb.a[0] + d[0] * t, limb.a[1] + d[1] * t, limb.a[2] + d[2] * t]));
                limb.count++;
            }
        }
        const thick = new Map([...limbs].map(([i, l]) => [i, l.count ? l.sum / l.count : 0.04 * scale]));
        return { trunk, band, thick };
    }

    /**
     * Arms kept off the face and the trunk: a body's arms, head and girth
     * differ from the captured one's, so a hand brought to the chin (a
     * boxer's guard) can land in the mouth, and an arm swinging past a broad
     * or heavy trunk can pass into it. Points down each arm (the elbow, the
     * forearm's middle, the wrist and the knuckles; the upper arm lies against
     * the chest at the armpit as it should),
     * each with its own flesh round it, keep out of the ball round the face
     * and out of the trunk's measured skin; the deepest one inside swings
     * out, the whole arm about the shoulder, to the surface.
     */
    function clearBody(bones, index, names, world, steps, place, scale, body, resting) {
        const head = index.get('Head'), faceRadius = FACE.radius * scale;
        // An arm resting on the body (lying, sitting, kneeling) may lie on its skin, so only its bones keep
        // out, swung no further than a little; elsewhere no arm swings further than this, so a pose stays
        // the captured one.
        const give = resting ? 0 : 1, most = resting ? 0.3 : 0.6;
        for (const S of ['Left', 'Right']) {
            const chain = ['Arm', 'ForeArm', 'Hand'].map(n => names.indexOf(S + n)), shoulder = index.get(S + 'Arm');
            const joint = n => index.get(S + n), need = ['Arm', 'ForeArm', 'Hand', 'HandMiddle1', 'HandIndex1', 'HandPinky1'];
            if (chain[0] < 0 || shoulder === undefined || need.some(n => joint(n) === undefined)) continue;
            const flesh = n => ((body && body.thick.get(joint(n))) || 0.03 * scale) * give;
            for (let f = 0; f < steps; f++) {
                const { rot, pos } = place(f), s = pos[shoulder], at = n => pos[joint(n)];
                const mid = (a, b) => a.map((v, k) => (v + b[k]) / 2);
                // Each point with the flesh round it; the hand's own points keep off the face too.
                let pts = [
                    [at('ForeArm'), Math.max(flesh('Arm'), flesh('ForeArm'))],
                    [mid(at('ForeArm'), at('Hand')), flesh('ForeArm')], [at('Hand'), flesh('ForeArm') * 0.8, true],
                    [at('HandMiddle1'), flesh('Hand'), true], [at('HandIndex1'), flesh('Hand'), true], [at('HandPinky1'), flesh('Hand'), true]
                ];
                const c = head === undefined ? null : rotate(rot[head], FACE.at.map(v => v * scale));
                const centre = c && [pos[head][0] + c[0], pos[head][1] + c[1], pos[head][2] + c[2]];
                // How deep a point is inside the face's ball or the trunk, and where on the surface it goes.
                const inside = (p, r, hand) => {
                    let best = null;
                    if (centre && hand) {
                        const d = faceRadius - Math.hypot(...sub(p, centre));
                        if (d > 0) { const o = unit(sub(p, centre)); best = { depth: d, to: [centre[0] + o[0] * faceRadius, centre[1] + o[1] * faceRadius, centre[2] + o[2] * faceRadius] }; }
                    }
                    if (body) for (const [b, slices] of body.trunk) {
                        const turn = rot[b], l = rotate(conj(turn), sub(p, pos[b])), slice = slices.get(Math.floor(l[1] / body.band));
                        if (!slice) continue;
                        // A rounded box round the slice, the point's own flesh added.
                        const across = slice.side + r, mid = (slice.front + slice.back) / 2, deep = (slice.front - slice.back) / 2 + r;
                        // A slice too thin to hold anything (a few stray vertices) is no wall.
                        if (across < 0.02 * scale || deep < 0.02 * scale) continue;
                        const x = Math.abs(l[0]) / across, z = Math.abs(l[2] - mid) / deep, e = Math.cbrt(x * x * x + z * z * z);
                        const d = (1 - e) * Math.min(across, deep);
                        if (e < 1e-6 || d <= 0 || (best && best.depth >= d)) continue;
                        const o = rotate(turn, [l[0] / e, l[1], mid + (l[2] - mid) / e]);
                        best = { depth: d, to: [pos[b][0] + o[0], pos[b][1] + o[1], pos[b][2] + o[2]] };
                    }
                    return best;
                };
                // A few small swings, each moving the deepest point out to the surface.
                let swung = 0;
                for (let pass = 0; pass < 4 && swung < most; pass++) {
                    let deep = null, hit = null;
                    for (const [p, r, hand] of pts) { const o = inside(p, r, hand); if (o && (!hit || o.depth > hit.depth)) { hit = o; deep = p; } }
                    if (!hit) break;
                    const a = unit(sub(deep, s)), b = unit(sub(hit.to, s)), axis = cross(a, b), l = Math.hypot(...axis);
                    if (l < 1e-6) break;
                    const angle = Math.min(Math.atan2(l, dot(a, b)), most - swung);
                    swung += angle;
                    const q = quat(axis[0] / l, axis[1] / l, axis[2] / l, angle);
                    for (const k of chain) if (k >= 0) world[k][f] = mul(q, world[k][f]);
                    pts = pts.map(([p, r, hand]) => { const v = rotate(q, sub(p, s)); return [[s[0] + v[0], s[1] + v[1], s[2] + v[2]], r, hand]; });
                }
            }
        }
    }

    /**
     * Feet set down: a foot whose lowest sole point hangs a little off the
     * floor (the back foot of a kneel, its toes short of the ground on a body
     * with other proportions) turns at the ankle, toes and all, until that
     * point rests where it would standing; the turn fades out as the foot
     * rises further, so a foot lifting off never jumps.
     */
    function settleFeet(bones, index, names, world, steps, place, heights, scale) {
        const near = 0.06 * scale, far = 0.14 * scale, most = 0.8;
        for (const S of ['Left', 'Right']) {
            const foot = index.get(S + 'Foot'), toe = index.get(S + 'ToeBase'), chain = [names.indexOf(S + 'Foot'), names.indexOf(S + 'ToeBase')];
            if (foot === undefined || toe === undefined || chain[0] < 0) continue;
            const sole = [[foot, SOLE.Foot[0]], [toe, SOLE.ToeBase[0]], [toe, SOLE.ToeBase[1]]].map(([i, o]) => [i, o.map(v => v * scale)]);
            for (let f = 0; f < steps; f++) {
                const { rot, pos } = place(f), ankle = pos[foot], hinge = rotate(rot[foot], [1, 0, 0]);
                // Each sole point's height over where it stands at rest, the foot turned by a about the ankle's hinge.
                const low = a => {
                    const q = quat(hinge[0], hinge[1], hinge[2], a);
                    let h = Infinity;
                    for (const [i, o] of sole) {
                        const p = sub([pos[i][0] + rotate(rot[i], o)[0], pos[i][1] + rotate(rot[i], o)[1], pos[i][2] + rotate(rot[i], o)[2]], ankle);
                        h = Math.min(h, ankle[1] + rotate(q, p)[1] + heights[f] - (bones[i].head[1] + o[1]));
                    }
                    return h;
                };
                const off = low(0);
                if (off <= 0.005 * scale || off >= far) continue;
                // The smallest turn either way that brings the foot down, if there is one.
                let turn = null;
                for (let a = 0.02; a <= most && turn === null; a += 0.02) for (const t of [a, -a]) if (turn === null && low(t) <= 0) turn = t;
                if (turn === null) continue;
                const fade = off <= near ? 1 : (far - off) / (far - near), q = quat(hinge[0], hinge[1], hinge[2], turn * fade);
                for (const k of chain) if (k >= 0) world[k][f] = mul(q, world[k][f]);
            }
        }
    }

    function captured(bones, id, cap, body) {
        const index = new Map(bones.map((b, i) => [b.name, i]));
        const rest = restFrames(bones, index);
        const names = DATA.bones.filter(n => rest[n] && cap.bones[n]);
        const steps = cap.frames, times = new Float32Array(steps);
        for (let i = 0; i < steps; i++) times[i] = i / DATA.fps;
        // A bone's world turn per frame: its captured frame over its rest frame; unmapped bones keep their parent's.
        const world = names.map(n => {
            const v = cap.bones[n], r = conj(rest[n]), out = new Array(steps);
            for (let i = 0; i < steps; i++) out[i] = mul([v[i * 4], v[i * 4 + 1], v[i * 4 + 2], v[i * 4 + 3]], r);
            return out;
        });
        const slot = new Map(names.map((n, k) => [index.get(n), k]));
        const turnAt = (i, f) => {
            for (let b = i; b >= 0; b = bones[b].parent) if (slot.has(b)) return world[slot.get(b)][f];
            return [0, 0, 0, 1];
        };
        /** Every joint's turn and place at frame f, the hips at rest. */
        const place = f => {
            const rot = [], pos = [];
            bones.forEach((b, i) => {
                rot[i] = turnAt(i, f);
                if (b.parent < 0) pos[i] = b.head.slice();
                else { const r = rotate(rot[b.parent], sub(b.head, bones[b.parent].head)); pos[i] = [pos[b.parent][0] + r[0], pos[b.parent][1] + r[1], pos[b.parent][2] + r[2]]; }
            });
            return { rot, pos };
        };
        let top = 0;
        for (const b of bones) top = Math.max(top, b.head[1]);
        const scale = top / 1.7 || 1;
        clearBody(bones, index, names, world, steps, place, scale, measure(bones, index, body, scale), cap.skin);
        // Where the body meets the floor: the skeleton followed joint by joint from the hips.
        const leg = side => { const a = index.get(side + 'UpLeg'), k = index.get(side + 'Leg'), f = index.get(side + 'Foot'); return a === undefined || k === undefined || f === undefined ? 0.85 * scale : Math.hypot(...sub(bones[k].head, bones[a].head)) + Math.hypot(...sub(bones[f].head, bones[k].head)); };
        const legLength = (leg('Left') + leg('Right')) / 2;
        const reach = bones.map(b => {
            const key = b.name.replace(/^(Left|Right)/, '');
            if (SOLE[key]) return SOLE[key].map(o => o.map(v => v * scale));
            return cap.skin && REACH[key] !== undefined ? REACH[key] * scale : null;
        });
        const stand = () => {
            const heights = new Float32Array(steps);
            for (let f = 0; f < steps; f++) {
                const { rot, pos } = place(f);
                let need = -Infinity;
                bones.forEach((b, i) => {
                    const c = reach[i];
                    if (c === null) return;
                    if (typeof c === 'number') { need = Math.max(need, c - pos[i][1]); return; }
                    // A sole point: wherever it is at rest is on the floor.
                    for (const o of c) need = Math.max(need, b.head[1] + o[1] - (pos[i][1] + rotate(rot[i], o)[1]));
                });
                heights[f] = (Number.isFinite(need) ? need : 0) + (cap.air ? cap.rise[f] * legLength : 0);
            }
            return heights;
        };
        // Resting on the body (kneeling, sitting, lying), a foot just off the floor turns at the ankle to rest on it.
        if (cap.skin) settleFeet(bones, index, names, world, steps, place, stand(), scale);
        const heights = stand();
        const tracks = names.map((n, k) => {
            const i = index.get(n), values = new Float32Array(steps * 4);
            let last = null;
            for (let f = 0; f < steps; f++) {
                const p = bones[i].parent;
                let q = mul(conj(p >= 0 ? turnAt(p, f) : [0, 0, 0, 1]), world[k][f]);
                const l = Math.hypot(...q);
                q = q.map(x => x / l);
                // Each frame on the same side of the sphere as the one before, so the turns blend the short way.
                if (last && dot4(q, last) < 0) q = q.map(x => -x);
                values.set(q, f * 4);
                last = q;
            }
            return { bone: i, values };
        });

        if (cap.fist) for (const t of fists(bones, index, steps)) tracks.push(t);

        const period = times[steps - 1] || 1;
        return {
            name: id, times, tracks, heights, skin: !!cap.skin,
            lift: t => {
                const x = ((t % period) + period) % period * DATA.fps, i = Math.min(steps - 1, Math.floor(x)), k = x - i;
                return heights[i] + (heights[Math.min(steps - 1, i + 1)] - heights[i]) * k;
            }
        };
    }
    const dot4 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

    function clip(bones, id, body) {
        if (!POSES.some(p => p.id === id)) return null;
        const index = new Set(bones.map(b => b.name));
        if (!index.has('LeftArm') || !index.has('LeftForeArm') || !index.has('LeftUpLeg')) return null;
        const cap = take(id);
        return cap ? captured(bones, id, cap, body) : null;
    }

    const api = { POSES, clip };
    root.RRCharacterPoses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

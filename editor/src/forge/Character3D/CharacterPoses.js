/**
 * RRCharacterPoses - poses and motions to try a humanoid character in: the
 * 3D Character Builder's view plays them to show where a body, its clothes
 * and its hair hold up and where they do not.
 *
 *   RRCharacterPoses.POSES             [{ id, label }], in the panel's order
 *   RRCharacterPoses.clip(bones, id)   { name, times, tracks: [{ bone, values }], heights, lift, skin } or null
 *
 * Bones rest unrotated (each one's frame is the world's), as the builder
 * saves them; the character faces +z with its left toward +x. A track holds
 * one quaternion per time. The motions are motion capture
 * (RRCharacterPosesData, from the CMU Graphics Lab Motion Capture Database):
 * per frame, each mapped bone's frame in the world, a direction along it and
 * one across it. Each body's own joints are turned to match them, so a
 * motion holds for any height, limb length or build; a heavy body's arms
 * swing out clear of its flanks, and hands stay off the face. The fingers
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
    const CURL = { 1: 1.55, 2: 1.75, 3: 1.2 }, THUMB = { 2: 0.3, 3: 0.4 };
    /**
     * The hands closed: each finger turns about the line of the knuckles,
     * toward the palm (the side facing the body at rest), and the thumb
     * swings in across the front of the curled fingers.
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
            // The thumb turns about the hand's length and toward the palm, the same both sides in the mirror,
            // and its joints bend in toward the palm.
            const t1 = index.get(S + 'HandThumb1'), ta = at('HandThumb1'), tb = at('HandThumb2');
            if (t1 !== undefined) hold(t1, mul(quat(along[0], along[1], along[2], 0.3 * m), quat(palm[0], palm[1], palm[2], -0.3 * m)));
            const bend = ta && tb ? unit(cross(unit(sub(tb, ta)), palm)) : axis;
            for (const k of [2, 3]) {
                const i = index.get(S + 'HandThumb' + k);
                if (i !== undefined) hold(i, quat(bend[0], bend[1], bend[2], THUMB[k]));
            }
        }
        return out;
    }

    /**
     * A heavy body's arms kept off its flanks: hips set wide for the shoulders
     * mean a wide waist, so an arm hanging closer to the trunk than the body
     * allows swings out, the forearm and hand with it, about the chest's
     * front-to-back line. A slim body (hips well inside the shoulders) is left
     * as captured.
     */
    function clearFlanks(bones, index, names, world, steps) {
        const at = n => index.has(n) ? bones[index.get(n)].head : null;
        const hip = at('LeftUpLeg'), arm = at('LeftArm'), elbow = at('LeftForeArm'), chest = names.indexOf('Spine2');
        if (!hip || !arm || !elbow || chest < 0) return;
        const wide = Math.max(0, Math.min(1, (Math.abs(hip[0]) / Math.abs(arm[0]) - 0.65) / 0.35));
        if (wide <= 0) return;
        // The least angle out from the trunk's side, up to that of the body's own rest.
        const rest = Math.atan2(Math.abs(elbow[0] - arm[0]), arm[1] - elbow[1]), least = wide * Math.min(rest, 0.55);
        for (const [S, out] of [['Left', 1], ['Right', -1]]) {
            const k = ['Arm', 'ForeArm', 'Hand'].map(n => names.indexOf(S + n));
            if (k[0] < 0) continue;
            const a = at(S + 'Arm'), e = at(S + 'ForeArm'), dir = unit(sub(e, a));
            for (let f = 0; f < steps; f++) {
                const T = world[chest][f], v = rotate(conj(T), rotate(world[k[0]][f], dir));
                if (v[1] >= 0) continue;
                const angle = Math.atan2(v[0] * out, -v[1]), short = least - angle;
                if (short <= 0) continue;
                // Eased, so an arm swinging across its limit never kinks.
                const turn = short * Math.min(1, -v[1] * 2), axis = rotate(T, [0, 0, 1]), q = quat(axis[0], axis[1], axis[2], turn * out);
                for (const i of k) if (i >= 0) world[i][f] = mul(q, world[i][f]);
            }
        }
    }

    /** Points of a hand that come near the face, and the ball round the face they keep out of (meters on a 1.7 m body, off the head joint). */
    const HAND_POINTS = ['Hand', 'HandIndex1', 'HandMiddle1', 'HandPinky1', 'HandThumb2'], FACE = { at: [0, -0.01, 0.03], radius: 0.18 };
    /**
     * Hands kept off the face: a body's arms and head differ in size from the
     * captured one's, so a hand brought to the chin (a boxer's guard) can
     * land in the mouth. A hand inside the ball round the face swings out,
     * the whole arm about the shoulder, to its surface.
     */
    function clearFace(bones, index, names, world, steps, place, scale) {
        const head = index.get('Head');
        if (head === undefined) return;
        const radius = FACE.radius * scale;
        for (const S of ['Left', 'Right']) {
            const chain = ['Arm', 'ForeArm', 'Hand'].map(n => names.indexOf(S + n)), shoulder = index.get(S + 'Arm');
            const points = HAND_POINTS.map(n => index.get(S + n)).filter(i => i !== undefined);
            if (chain[0] < 0 || shoulder === undefined) continue;
            for (let f = 0; f < steps; f++) {
                const { rot, pos } = place(f), c = rotate(rot[head], FACE.at.map(v => v * scale)), centre = [pos[head][0] + c[0], pos[head][1] + c[1], pos[head][2] + c[2]];
                let pts = points.map(i => pos[i]);
                const s = pos[shoulder];
                // A few small swings, each moving the deepest point out to the surface.
                for (let pass = 0; pass < 3; pass++) {
                    let deep = null, most = 0;
                    for (const p of pts) { const d = radius - Math.hypot(...sub(p, centre)); if (d > most) { most = d; deep = p; } }
                    if (!deep) break;
                    const out = unit(sub(deep, centre)), to = [centre[0] + out[0] * radius, centre[1] + out[1] * radius, centre[2] + out[2] * radius];
                    const a = unit(sub(deep, s)), b = unit(sub(to, s)), axis = cross(a, b), l = Math.hypot(...axis);
                    if (l < 1e-6) break;
                    const q = quat(axis[0] / l, axis[1] / l, axis[2] / l, Math.atan2(l, dot(a, b)));
                    for (const k of chain) if (k >= 0) world[k][f] = mul(q, world[k][f]);
                    pts = pts.map(p => { const r = rotate(q, sub(p, s)); return [s[0] + r[0], s[1] + r[1], s[2] + r[2]]; });
                }
            }
        }
    }

    function captured(bones, id, cap) {
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
        clearFlanks(bones, index, names, world, steps);
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
        clearFace(bones, index, names, world, steps, place, scale);
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

        // Where the body meets the floor: the skeleton followed joint by joint from the hips.
        const leg = side => { const a = index.get(side + 'UpLeg'), k = index.get(side + 'Leg'), f = index.get(side + 'Foot'); return a === undefined || k === undefined || f === undefined ? 0.85 * scale : Math.hypot(...sub(bones[k].head, bones[a].head)) + Math.hypot(...sub(bones[f].head, bones[k].head)); };
        const legLength = (leg('Left') + leg('Right')) / 2;
        const reach = bones.map(b => {
            const key = b.name.replace(/^(Left|Right)/, '');
            if (SOLE[key]) return SOLE[key].map(o => o.map(v => v * scale));
            return cap.skin && REACH[key] !== undefined ? REACH[key] * scale : null;
        });
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

    function clip(bones, id) {
        if (!POSES.some(p => p.id === id)) return null;
        const index = new Set(bones.map(b => b.name));
        if (!index.has('LeftArm') || !index.has('LeftForeArm') || !index.has('LeftUpLeg')) return null;
        const cap = take(id);
        return cap ? captured(bones, id, cap) : null;
    }

    const api = { POSES, clip };
    root.RRCharacterPoses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

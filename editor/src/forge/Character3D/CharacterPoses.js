/**
 * RRCharacterPoses - poses and motions to try a humanoid character in: the
 * 3D Character Builder's view plays them to show where a body, its clothes
 * and its hair hold up and where they do not.
 *
 *   RRCharacterPoses.POSES             [{ id, label }], in the panel's order
 *   RRCharacterPoses.clip(bones, id)   { name, times, tracks: [{ bone, values }], lift, plant } or null
 *
 * Bones rest unrotated (each one's frame is the world's), as the builder
 * saves them; the character faces +z with its left toward +x. A track holds
 * one quaternion per time. `plant` says the view should stand the pose on
 * the floor (the lowest foot, knee or seat on it); `lift(t)` raises it off
 * the floor at time t, for a jump or a fall.
 */
(function (root) {
    'use strict';

    const POSES = [
        { id: 'walk', label: 'Walking' }, { id: 'run', label: 'Running' }, { id: 'crouch', label: 'Crouching' }, { id: 'jump', label: 'Jumping' },
        { id: 'fall', label: 'Falling' }, { id: 'fight', label: 'Fighting stance' }, { id: 'wave', label: 'Waving' }, { id: 'armsUp', label: 'Arms up' },
        { id: 'kneel', label: 'Kneeling' }, { id: 'sit', label: 'Sitting' }
    ];

    const quat = (x, y, z, a) => { const s = Math.sin(a / 2); return [x * s, y * s, z * s, Math.cos(a / 2)]; };
    const mul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    /** A joint's turn: first about z (out to the side), then y (twist), then x (forward and back). */
    const turn = (x = 0, y = 0, z = 0) => mul(quat(1, 0, 0, x), mul(quat(0, 1, 0, y), quat(0, 0, 1, z)));
    const smooth = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
    const S = p => Math.sin(2 * Math.PI * p), C = p => Math.cos(2 * Math.PI * p);

    /**
     * Each pose: its length in seconds, whether it stands on the floor, its
     * lift, and the joints' turns at phase p (0..1). `down` is the angle that
     * brings the A-pose's arms to hang at the sides; `E.L(a)` and `E.R(a)` bend
     * an elbow by a, the hand coming forward. Signs: a leg or a hanging arm
     * swings forward with a negative x; a knee bends with a positive x; the
     * spine leans forward and the head nods with a positive x; the left arm
     * lowers with a negative z and the right with a positive one.
     */
    const DEFS = {
        walk: { period: 1.1, plant: true, at: (p, down, E) => ({
            Hips: turn(0.03, -0.08 * S(p)), Spine1: turn(0.03, 0.06 * S(p)), Spine2: turn(0.02, 0.04 * S(p)), Head: turn(-0.03, -0.05 * S(p)),
            LeftUpLeg: turn(-0.42 * S(p)), RightUpLeg: turn(0.42 * S(p)),
            LeftLeg: turn(0.08 + 0.7 * Math.max(0, S(p + 0.2))), RightLeg: turn(0.08 + 0.7 * Math.max(0, S(p + 0.7))),
            LeftFoot: turn(0.15 * S(p) - 0.1 * Math.max(0, S(p + 0.2))), RightFoot: turn(-0.15 * S(p) - 0.1 * Math.max(0, S(p + 0.7))),
            LeftArm: turn(0.32 * S(p), 0, -down), RightArm: turn(-0.32 * S(p), 0, down),
            LeftForeArm: E.L(0.25 + 0.15 * Math.max(0, -S(p))), RightForeArm: E.R(0.25 + 0.15 * Math.max(0, S(p)))
        }) },
        run: { period: 0.68, plant: true, lift: p => 0.035 * Math.max(0, -C(2 * p)), at: (p, down, E) => ({
            Hips: turn(0.12, -0.14 * S(p)), Spine: turn(0.1), Spine1: turn(0.06, 0.12 * S(p)), Spine2: turn(0.04, 0.08 * S(p)), Head: turn(-0.2, -0.08 * S(p)),
            LeftUpLeg: turn(-0.35 - 0.75 * S(p)), RightUpLeg: turn(-0.35 + 0.75 * S(p)),
            LeftLeg: turn(0.35 + 1.25 * Math.max(0, S(p + 0.15))), RightLeg: turn(0.35 + 1.25 * Math.max(0, S(p + 0.65))),
            LeftFoot: turn(0.25 * S(p)), RightFoot: turn(-0.25 * S(p)),
            LeftArm: turn(0.75 * S(p) - 0.2, 0, -down + 0.15), RightArm: turn(-0.75 * S(p) - 0.2, 0, down - 0.15),
            LeftForeArm: E.L(1.4), RightForeArm: E.R(1.4)
        }) },
        crouch: { period: 3, plant: true, at: (p, down, E) => ({
            Hips: turn(0.2), Spine: turn(0.25 + 0.02 * S(p)), Spine1: turn(0.12), Spine2: turn(0.05), Neck: turn(-0.2), Head: turn(-0.3),
            LeftUpLeg: turn(-1.35, 0, 0.18), RightUpLeg: turn(-1.35, 0, -0.18),
            LeftLeg: turn(2.1), RightLeg: turn(2.1),
            LeftFoot: turn(-0.55), RightFoot: turn(-0.55),
            LeftArm: turn(-0.75, 0, -down + 0.1), RightArm: turn(-0.75, 0, down - 0.1),
            LeftForeArm: E.L(0.7), RightForeArm: E.R(0.7)
        }) },
        jump: { period: 1.5, plant: true, lift: p => 0.42 * Math.sin(Math.PI * smooth(0, 1, (p - 0.3) / 0.5)) * (p > 0.3 && p < 0.8 ? 1 : 0), at: (p, down, E) => {
            // Down into a crouch, up and off, tucked at the top, down again and absorbed.
            const set = p < 0.3 ? Math.sin(Math.PI * p / 0.3) : p > 0.8 ? Math.sin(Math.PI * (p - 0.8) / 0.2) * 0.8 : 0;
            const tuck = p > 0.35 && p < 0.75 ? Math.sin(Math.PI * (p - 0.35) / 0.4) : 0;
            const reach = p > 0.28 && p < 0.6 ? Math.sin(Math.PI * (p - 0.28) / 0.32) : 0;
            return {
                Hips: turn(0.25 * set), Spine: turn(0.3 * set - 0.1 * reach), Head: turn(-0.25 * set),
                LeftUpLeg: turn(-1.0 * set - 0.9 * tuck, 0, 0.08), RightUpLeg: turn(-1.0 * set - 0.9 * tuck, 0, -0.08),
                LeftLeg: turn(1.6 * set + 1.3 * tuck), RightLeg: turn(1.6 * set + 1.3 * tuck),
                LeftFoot: turn(-0.6 * set + 0.3 * tuck), RightFoot: turn(-0.6 * set + 0.3 * tuck),
                LeftArm: turn(0.5 * set - 2.3 * reach, 0, -down * (1 - reach)), RightArm: turn(0.5 * set - 2.3 * reach, 0, down * (1 - reach)),
                LeftForeArm: E.L(0.3 + 0.3 * tuck), RightForeArm: E.R(0.3 + 0.3 * tuck)
            };
        } },
        fall: { period: 1.2, plant: false, lift: p => 0.25 + 0.03 * S(p), at: (p, down, E) => ({
            Spine: turn(-0.15), Spine1: turn(-0.08), Head: turn(-0.25),
            LeftUpLeg: turn(-0.35 - 0.25 * S(p), 0, 0.12), RightUpLeg: turn(-0.35 + 0.25 * S(p), 0, -0.12),
            LeftLeg: turn(0.6 + 0.3 * S(p + 0.25)), RightLeg: turn(0.6 - 0.3 * S(p + 0.25)),
            LeftArm: turn(-0.2 * S(p), 0, 1.5 + 0.3 * S(p * 2)), RightArm: turn(0.2 * S(p), 0, -1.5 - 0.3 * S(p * 2 + 0.3)),
            LeftForeArm: E.L(0.5 + 0.3 * S(p * 2)), RightForeArm: E.R(0.5 + 0.3 * S(p * 2 + 0.5))
        }) },
        fight: { period: 1.4, plant: true, at: (p, down, E) => ({
            Hips: turn(0.08, 0.45), Spine1: turn(0.08, -0.2), Spine2: turn(0.06, -0.15), Neck: turn(0, -0.05), Head: turn(-0.05, -0.08),
            LeftUpLeg: turn(-0.45, 0, 0.14), RightUpLeg: turn(0.25, 0, -0.14),
            LeftLeg: turn(0.45 + 0.06 * S(2 * p)), RightLeg: turn(0.4 + 0.06 * S(2 * p)),
            LeftFoot: turn(0.05), RightFoot: turn(-0.2),
            // Guard up: elbows in and down, fists before the chin.
            LeftArm: turn(-0.55, 0, -down - 0.08), RightArm: turn(-0.4, 0, down + 0.08),
            LeftForeArm: E.L(2.25 - 0.05 * S(2 * p)), RightForeArm: E.R(2.35 - 0.05 * S(2 * p + 0.5)),
            LeftHand: turn(0, 0, 0.2), RightHand: turn(0, 0, -0.2)
        }) },
        wave: { period: 1.6, plant: true, at: (p, down, E) => ({
            Spine1: turn(0, 0, 0.03), Head: turn(0, 0.12, 0.04),
            LeftArm: turn(0, 0, -down), LeftForeArm: E.L(0.2),
            RightArm: turn(-0.25, 0, -0.95), RightForeArm: turn(0, 0, -1.25 + 0.4 * S(2 * p)), RightHand: turn(0, 0, 0.15 * S(2 * p))
        }) },
        armsUp: { period: 3, plant: true, at: (p, down, E) => ({
            Spine1: turn(-0.04), Head: turn(-0.1),
            LeftArm: turn(-0.1, 0, 2.15 + 0.03 * S(p)), RightArm: turn(-0.1, 0, -2.15 - 0.03 * S(p)),
            LeftForeArm: turn(0, 0, 0.1), RightForeArm: turn(0, 0, -0.1)
        }) },
        kneel: { period: 3, plant: true, at: (p, down, E) => ({
            Hips: turn(0.05), Spine: turn(0.05 + 0.015 * S(p)), Head: turn(0.05),
            LeftUpLeg: turn(-1.45, 0, 0.1), LeftLeg: turn(1.5), LeftFoot: turn(-0.05),
            RightUpLeg: turn(0.05, 0, -0.06), RightLeg: turn(1.55), RightFoot: turn(0.6), RightToeBase: turn(-0.6),
            LeftArm: turn(-0.5, 0, -down), RightArm: turn(0.1, 0, down), LeftForeArm: E.L(0.6), RightForeArm: E.R(0.3)
        }) },
        sit: { period: 3, plant: true, at: (p, down, E) => ({
            Hips: turn(-0.12), Spine: turn(0.12 + 0.015 * S(p)), Spine1: turn(0.05), Head: turn(0.08),
            LeftUpLeg: turn(-1.45, 0, 0.12), RightUpLeg: turn(-1.45, 0, -0.12),
            LeftLeg: turn(0.35), RightLeg: turn(0.35), LeftFoot: turn(-0.3), RightFoot: turn(-0.3),
            LeftArm: turn(0.55, 0, -down + 0.05), RightArm: turn(0.55, 0, down - 0.05), LeftForeArm: E.L(-0.1), RightForeArm: E.R(-0.1)
        }) }
    };

    function clip(bones, id) {
        const def = DEFS[id];
        const index = new Map(bones.map((b, i) => [b.name, i]));
        if (!def || !index.has('LeftArm') || !index.has('LeftForeArm') || !index.has('LeftUpLeg')) return null;
        // The A-pose's arm angle from straight down, so 'down' brings the arms to hang at the sides.
        const a = bones[index.get('LeftArm')].head, f = bones[index.get('LeftForeArm')].head;
        const down = Math.atan2(Math.abs(f[0] - a[0]), a[1] - f[1]) - 0.08;
        // Each elbow's hinge: square to the upper arm's rest direction, level, so a bend brings the hand forward.
        const hinge = side => {
            const s0 = bones[index.get(side + 'Arm')].head, s1 = bones[index.get(side + 'ForeArm')].head;
            const d = [s1[0] - s0[0], s1[1] - s0[1]], l = Math.hypot(d[0], d[1]) || 1;
            return a => quat(d[1] / l, -d[0] / l, 0, a);
        };
        const E = { L: hinge('Left'), R: hinge('Right') };
        const steps = Math.max(13, Math.round(def.period * 24) + 1);
        const times = new Float32Array(steps);
        const frames = [];
        for (let i = 0; i < steps; i++) { times[i] = def.period * i / (steps - 1); frames.push(def.at(i / (steps - 1), down, E)); }
        const names = new Set(frames.flatMap(f => Object.keys(f)));
        const tracks = [];
        for (const name of names) {
            if (!index.has(name)) continue;
            const values = new Float32Array(steps * 4);
            frames.forEach((f, i) => values.set(f[name] || [0, 0, 0, 1], i * 4));
            tracks.push({ bone: index.get(name), values });
        }
        const lift = def.lift || (() => 0);
        return { name: id, times, tracks, plant: def.plant, lift: t => lift((t % def.period) / def.period) };
    }

    const api = { POSES, clip };
    root.RRCharacterPoses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

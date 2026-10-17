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
 * one quaternion per time. `lift(t)` is how far the whole body stands off
 * its rest height at time t: worked out here by following the skeleton joint
 * by joint, so the lowest foot, knee, hip or back touches the floor (a jump
 * or a fall leaves it), smoothed so support passing from foot to foot never
 * jolts. A pose resting the body itself on the floor (sitting, kneeling,
 * lying) says `skin`: the view then sets its lowest skin on the floor.
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
    /** A joint's turn: first about z (out to the side), then y (twist), then x (forward and back). */
    const turn = (x = 0, y = 0, z = 0) => mul(quat(1, 0, 0, x), mul(quat(0, 1, 0, y), quat(0, 0, 1, z)));
    const TAU = Math.PI * 2;
    const S = p => Math.sin(TAU * p), C = p => Math.cos(TAU * p);
    /** A smooth periodic bump centered on c, w wide (a phase of a cycle, wrapping). */
    const bump = (p, c, w) => { const d = ((p - c) % 1 + 1.5) % 1 - 0.5; return Math.exp(-(d * d) / (2 * w * w)); };
    const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

    /**
     * Walking, from measured gait (one stride, q 0 at this foot's heel strike):
     * hip flexion, knee flexion, ankle dorsiflexion and the toes' push-off, radians.
     */
    const gait = {
        hip: q => 0.17 + 0.33 * C(q - 0.92),
        knee: q => 0.06 + 0.3 * bump(q, 0.15, 0.06) + 1.02 * bump(q, 0.72, 0.1),
        ankle: q => 0.03 - 0.1 * bump(q, 0.06, 0.04) + 0.17 * bump(q, 0.42, 0.12) - 0.36 * bump(q, 0.62, 0.05),
        toe: q => 0.45 * bump(q, 0.6, 0.05)
    };
    /** Running, the same way: a longer swing, a deeper bend, and push-off sooner. */
    const stride = {
        hip: q => 0.35 + 0.55 * C(q - 0.88),
        knee: q => 0.32 + 0.3 * bump(q, 0.12, 0.06) + 1.5 * bump(q, 0.68, 0.12),
        ankle: q => 0.08 + 0.18 * bump(q, 0.14, 0.06) - 0.5 * bump(q, 0.42, 0.06),
        toe: q => 0.4 * bump(q, 0.42, 0.05)
    };
    /** One leg by its curves: the thigh swings forward with flexion, the foot follows the ankle. */
    const leg = (side, g, q, out = 0) => ({
        [side + 'UpLeg']: turn(-g.hip(q), 0, side === 'Left' ? out : -out),
        [side + 'Leg']: turn(g.knee(q)),
        [side + 'Foot']: turn(-g.ankle(q)),
        [side + 'ToeBase']: turn(-g.toe(q))
    });

    /**
     * Each pose: its length in seconds; when its feet are on the floor
     * (`ground(p)`, all the time when left out; never for a fall); a lift on
     * top of that; and the joints' turns at phase p (0..1). `down` is the
     * angle that brings the A-pose's arms to hang at the sides; `E.L(a)` and
     * `E.R(a)` bend an elbow to a in all (0 straight), the hand coming forward. Signs: a leg or a
     * hanging arm swings forward with a negative x; a knee bends with a
     * positive x; the spine leans forward and the head nods with a positive x;
     * the left arm lowers with a negative z and the right with a positive one.
     */
    const DEFS = {
        walk: { period: 1.1, at: (p, down, E) => {
            // The arms swing against the legs, a little behind them; the pelvis turns and dips with the
            // stride and the shoulders turn against it, so the head travels straight.
            const arm = C(p - 0.06);
            return Object.assign(leg('Left', gait, p, 0.02), leg('Right', gait, p + 0.5, 0.02), {
                Hips: turn(0.04, -0.08 * C(p), 0.05 * S(p)),
                Spine: turn(0.02, 0.03 * C(p), -0.025 * S(p)), Spine1: turn(0.01, 0.04 * C(p)), Spine2: turn(0.01, 0.03 * C(p), -0.02 * S(p)),
                Neck: turn(-0.02), Head: turn(-0.02 + 0.015 * C(2 * p), -0.02 * C(p)),
                LeftArm: turn(-0.04 + 0.26 * arm, 0, -down - 0.04), RightArm: turn(-0.04 - 0.26 * arm, 0, down + 0.04),
                LeftForeArm: E.L(0.28 + 0.22 * (1 - arm) / 2), RightForeArm: E.R(0.28 + 0.22 * (1 + arm) / 2),
                LeftHand: turn(0.1), RightHand: turn(0.1)
            });
        } },
        run: { period: 0.68, lift: p => 0.045 * (bump(p, 0.36, 0.08) + bump(p, 0.86, 0.08)), at: (p, down, E) => {
            const arm = C(p - 0.04);
            return Object.assign(leg('Left', stride, p, 0.03), leg('Right', stride, p + 0.5, 0.03), {
                Hips: turn(0.1, -0.13 * C(p), 0.06 * S(p)),
                Spine: turn(0.1, 0.06 * C(p)), Spine1: turn(0.05, 0.07 * C(p)), Spine2: turn(0.03, 0.06 * C(p), -0.03 * S(p)),
                Neck: turn(-0.1), Head: turn(-0.12 + 0.03 * C(2 * p), -0.04 * C(p)),
                LeftArm: turn(-0.2 + 0.62 * arm, 0, -down + 0.06), RightArm: turn(-0.2 - 0.62 * arm, 0, down - 0.06),
                LeftForeArm: E.L(1.55 - 0.25 * arm), RightForeArm: E.R(1.55 + 0.25 * arm),
                LeftHand: turn(0.15), RightHand: turn(0.15)
            });
        } },
        crouch: { period: 3.2, at: (p, down, E) => ({
            Hips: turn(0.22), Spine: turn(0.24 + 0.02 * S(p)), Spine1: turn(0.1 + 0.01 * S(p)), Spine2: turn(0.05), Neck: turn(-0.2), Head: turn(-0.28),
            LeftUpLeg: turn(-1.35, -0.12, 0.2), RightUpLeg: turn(-1.35, 0.12, -0.2),
            LeftLeg: turn(2.1), RightLeg: turn(2.1),
            LeftFoot: turn(-0.62, 0.1), RightFoot: turn(-0.62, -0.1), LeftToeBase: turn(-0.3), RightToeBase: turn(-0.3),
            LeftArm: turn(-0.7, 0, -down + 0.12), RightArm: turn(-0.7, 0, down - 0.12),
            LeftForeArm: E.L(0.7), RightForeArm: E.R(0.7), LeftHand: turn(0.2), RightHand: turn(0.2)
        }) },
        // Down into the crouch, up and off with the arms thrown up, tucked at the top, then down and absorbed.
        jump: { period: 1.6, ground: p => p < 0.33 || p > 0.78,
            lift: p => (p > 0.33 && p < 0.78 ? 0.5 * Math.sin(Math.PI * (p - 0.33) / 0.45) : 0),
            at: (p, down, E) => {
                const set = p < 0.33 ? Math.sin(Math.PI * ease(p / 0.33)) * (p < 0.26 ? 1 : 1 - (p - 0.26) / 0.07) : 0;
                const land = p > 0.78 ? Math.sin(Math.PI * (p - 0.78) / 0.22) * 0.85 : 0;
                const crouch = Math.max(set, land), tuck = p > 0.4 && p < 0.72 ? Math.sin(Math.PI * (p - 0.4) / 0.32) : 0;
                const reach = p > 0.25 && p < 0.62 ? Math.sin(Math.PI * (p - 0.25) / 0.37) : 0;
                return {
                    Hips: turn(0.3 * crouch), Spine: turn(0.32 * crouch - 0.08 * reach), Neck: turn(-0.1 * crouch), Head: turn(-0.22 * crouch),
                    LeftUpLeg: turn(-1.05 * crouch - 0.85 * tuck, 0, 0.06), RightUpLeg: turn(-1.05 * crouch - 0.85 * tuck, 0, -0.06),
                    LeftLeg: turn(0.05 + 1.75 * crouch + 1.25 * tuck), RightLeg: turn(0.05 + 1.75 * crouch + 1.25 * tuck),
                    LeftFoot: turn(-0.65 * crouch + 0.35 * tuck + 0.4 * reach * (1 - tuck)), RightFoot: turn(-0.65 * crouch + 0.35 * tuck + 0.4 * reach * (1 - tuck)),
                    LeftArm: turn(0.55 * crouch - 2.2 * reach, 0, -down * (1 - 0.7 * reach)), RightArm: turn(0.55 * crouch - 2.2 * reach, 0, down * (1 - 0.7 * reach)),
                    LeftForeArm: E.L(0.35 + 0.6 * tuck), RightForeArm: E.R(0.35 + 0.6 * tuck)
                };
            } },
        fall: { period: 1.3, ground: () => false, lift: p => 0.3 + 0.03 * S(p), at: (p, down, E) => ({
            Hips: turn(-0.1), Spine: turn(-0.14), Spine1: turn(-0.08), Head: turn(-0.25),
            LeftUpLeg: turn(-0.4 - 0.25 * S(p), 0, 0.14), RightUpLeg: turn(-0.4 + 0.25 * S(p), 0, -0.14),
            LeftLeg: turn(0.7 + 0.3 * S(p + 0.25)), RightLeg: turn(0.7 - 0.3 * S(p + 0.25)), LeftFoot: turn(0.3), RightFoot: turn(0.3),
            LeftArm: turn(-0.25 * S(p), 0, 1.45 + 0.25 * S(2 * p)), RightArm: turn(0.25 * S(p), 0, -1.45 - 0.25 * S(2 * p + 0.3)),
            LeftForeArm: E.L(0.6 + 0.3 * S(2 * p)), RightForeArm: E.R(0.6 + 0.3 * S(2 * p + 0.5))
        }) },
        fight: { period: 1.2, at: (p, down, E) => {
            // A boxer's guard, weight on the balls of the feet, bouncing.
            const b = S(2 * p);
            return {
                Hips: turn(0.1, 0.5), Spine: turn(0.05, -0.15), Spine1: turn(0.08, -0.15), Spine2: turn(0.06, -0.1), Neck: turn(0.05, -0.05), Head: turn(-0.02, -0.12),
                LeftUpLeg: turn(-0.5, -0.3, 0.12), RightUpLeg: turn(0.2, -0.2, -0.14),
                LeftLeg: turn(0.55 + 0.08 * b), RightLeg: turn(0.5 + 0.08 * b), LeftFoot: turn(-0.05 - 0.04 * b), RightFoot: turn(-0.35 - 0.04 * b), RightToeBase: turn(-0.3),
                LeftArm: turn(-0.55, 0, -down - 0.08), RightArm: turn(-0.4, 0, down + 0.08),
                LeftForeArm: E.L(2.3 - 0.05 * b), RightForeArm: E.R(2.4 - 0.05 * b),
                LeftHand: turn(0, 0, 0.2), RightHand: turn(0, 0, -0.2)
            };
        } },
        wave: { period: 1.4, at: (p, down, E) => ({
            Hips: turn(0, 0, 0.03), Spine1: turn(0, 0.05, -0.03), Head: turn(0.02, 0.12, 0.05),
            LeftUpLeg: turn(0.02, 0, 0.02), RightUpLeg: turn(-0.05, 0.1, -0.06), RightLeg: turn(0.12),
            LeftArm: turn(0.02, 0, -down - 0.04), LeftForeArm: E.L(0.3),
            RightArm: turn(-0.3, 0, -0.95), RightForeArm: turn(0, 0, -1.25 + 0.38 * S(2 * p)), RightHand: turn(0, 0, 0.18 * S(2 * p - 0.1))
        }) },
        armsUp: { period: 3.2, at: p => ({
            Spine: turn(-0.03), Spine1: turn(-0.04 - 0.01 * S(p)), Head: turn(-0.12),
            LeftArm: turn(-0.1, 0, 2.15 + 0.03 * S(p)), RightArm: turn(-0.1, 0, -2.15 - 0.03 * S(p)),
            LeftForeArm: turn(0, 0, 0.12), RightForeArm: turn(0, 0, -0.12)
        }) },
        kneel: { skin: true, period: 3.2, at: (p, down, E) => ({
            Hips: turn(0.05), Spine: turn(0.06 + 0.015 * S(p)), Head: turn(0.06),
            LeftUpLeg: turn(-1.45, 0, 0.1), LeftLeg: turn(1.5), LeftFoot: turn(-0.05),
            RightUpLeg: turn(0.05, 0, -0.06), RightLeg: turn(1.55), RightFoot: turn(0.6), RightToeBase: turn(-0.6),
            LeftArm: turn(-0.5, 0, -down), RightArm: turn(0.1, 0, down), LeftForeArm: E.L(1.2), RightForeArm: E.R(0.35)
        }) },
        sit: { skin: true, period: 3.2, at: (p, down, E) => ({
            // On the floor, leaning back a little on the hands, one knee up.
            Hips: turn(-0.12), Spine: turn(0.1 + 0.015 * S(p)), Spine1: turn(0.04), Head: turn(0.1, 0.1),
            LeftUpLeg: turn(-1.5, 0.15, 0.14), RightUpLeg: turn(-2.1, -0.1, -0.1),
            LeftLeg: turn(0.3), RightLeg: turn(1.9), LeftFoot: turn(-0.35, 0.2), RightFoot: turn(-0.2),
            LeftArm: turn(0.6, 0, -down + 0.08), RightArm: turn(0.6, 0, down - 0.08), LeftForeArm: E.L(0.1), RightForeArm: E.R(0.1),
            LeftHand: turn(-0.9), RightHand: turn(-0.9)
        }) },
        lieBack: { skin: true, period: 4, reach: { Hips: 0.03, Spine: 0.08, Spine1: 0.09, Spine2: 0.1, Head: 0.09, Arm: 0.04, ForeArm: 0.03, Hand: 0.02, UpLeg: 0.07, Leg: 0.05 }, at: (p, down, E) => ({
            // On the back, face up, breathing; the back, legs and arms resting on the floor, the feet falling open.
            Hips: turn(-Math.PI / 2), Spine: turn(-0.08), Spine1: turn(-0.04), Spine2: turn(0.015 * S(p)), Neck: turn(0.05), Head: turn(0.08, 0.1),
            LeftUpLeg: turn(0.03, -0.15, 0.08), RightUpLeg: turn(0.03, 0.15, -0.08), LeftLeg: turn(0.1), RightLeg: turn(0.1),
            LeftFoot: turn(0.55, -0.25), RightFoot: turn(0.55, 0.25),
            LeftArm: turn(0.55, 0, -down + 0.18), RightArm: turn(0.55, 0, down - 0.18), LeftForeArm: E.L(0.3), RightForeArm: E.R(0.3),
            LeftHand: turn(0.2, 0, -0.2), RightHand: turn(0.2, 0, 0.2)
        }) },
        lieSide: { skin: true, period: 4, reach: { Hips: 0.15, Spine: 0.13, Spine1: 0.13, Spine2: 0.15, Neck: 0.08, Head: 0.07 }, at: (p, down, E) => ({
            // On the right side, the head on the lower arm stretched out beyond it, the upper hand on the floor before
            // the chest, the knees drawn up, the upper one fallen forward over the lower.
            Hips: turn(0, 0, Math.PI / 2), Spine: turn(0.1), Spine1: turn(0.06), Spine2: turn(0.04 + 0.015 * S(p)), Neck: turn(0.1, 0, 0.2), Head: turn(0.08, 0, 0.12),
            LeftUpLeg: turn(-1.15, 0, -0.5), RightUpLeg: turn(-0.6, 0, 0.05), LeftLeg: turn(1.35), RightLeg: turn(0.95),
            LeftFoot: turn(0.4), RightFoot: turn(0.4),
            RightArm: turn(-0.15, 0, -2.3), RightForeArm: E.R(0.6), RightHand: turn(0.1),
            LeftArm: turn(-1.05, 0, -down - 0.2), LeftForeArm: E.L(0.9), LeftHand: turn(-0.3)
        }) }
    };

    /** How far each joint's flesh reaches below it, by name (meters on a 1.7 m body): the floor stops it there. */
    const REACH = { Hips: 0.11, Spine: 0.1, Spine1: 0.1, Spine2: 0.11, Neck: 0.06, Head: 0.1, Arm: 0.05, ForeArm: 0.04, Hand: 0.025, UpLeg: 0.085, Leg: 0.055 };

    function clip(bones, id) {
        const def = DEFS[id];
        const index = new Map(bones.map((b, i) => [b.name, i]));
        if (!def || !index.has('LeftArm') || !index.has('LeftForeArm') || !index.has('LeftUpLeg')) return null;
        // The A-pose's arm angle from straight down, so 'down' brings the arms to hang at the sides.
        const a = bones[index.get('LeftArm')].head, f = bones[index.get('LeftForeArm')].head;
        const down = Math.atan2(Math.abs(f[0] - a[0]), a[1] - f[1]) - 0.08;
        // Each elbow's hinge: square to the plane of the upper arm and forearm at rest. The rest pose
        // already bends the elbow (the hands forward), so a pose's bend is the whole bend, that subtracted.
        const hinge = side => {
            const at = n => bones[index.get(side + n)] && bones[index.get(side + n)].head;
            const s0 = at('Arm'), s1 = at('ForeArm'), s2 = at('Hand');
            const u = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]], f = s2 ? [s2[0] - s1[0], s2[1] - s1[1], s2[2] - s1[2]] : u;
            let ax = [u[1] * f[2] - u[2] * f[1], u[2] * f[0] - u[0] * f[2], u[0] * f[1] - u[1] * f[0]], l = Math.hypot(...ax);
            const rest = l > 1e-6 ? Math.atan2(l, u[0] * f[0] + u[1] * f[1] + u[2] * f[2]) : 0;
            // A straight arm at rest: the level hinge that brings the hand forward.
            if (l < 1e-6) { ax = [u[1], -u[0], 0]; l = Math.hypot(...ax) || 1; }
            ax = ax.map(x => x / l);
            return bend => quat(ax[0], ax[1], ax[2], bend - rest);
        };
        const E = { L: hinge('Left'), R: hinge('Right') };
        const steps = Math.max(16, Math.round(def.period * 30) + 1);
        const times = new Float32Array(steps);
        const frames = [];
        for (let i = 0; i < steps; i++) { times[i] = def.period * i / (steps - 1); frames.push(def.at(i / (steps - 1), down, E)); }

        // Where the body meets the floor in each frame: the joints followed down the skeleton from the hips.
        let top = 0;
        for (const b of bones) top = Math.max(top, b.head[1]);
        const scale = top / 1.7 || 1;
        // A lying pose rests on its own side of each joint (the back, a hip), so it gives its own reach.
        const reachOf = Object.assign({}, REACH, def.reach || {});
        const reach = bones.map(b => {
            if (/^(Left|Right)(Foot|ToeBase)$/.test(b.name)) return b.head[1];
            const key = b.name.replace(/^(Left|Right)/, '');
            return reachOf[key] !== undefined ? reachOf[key] * scale : null;
        });
        const floor = frames.map(fr => {
            const rot = [], pos = [];
            let need = -Infinity;
            bones.forEach((b, i) => {
                const q = fr[b.name] || [0, 0, 0, 1];
                if (b.parent < 0) { rot[i] = q; pos[i] = b.head.slice(); }
                else {
                    const pb = bones[b.parent], off = [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]], r = rotate(rot[b.parent], off);
                    pos[i] = [pos[b.parent][0] + r[0], pos[b.parent][1] + r[1], pos[b.parent][2] + r[2]];
                    rot[i] = mul(rot[b.parent], q);
                }
                if (reach[i] !== null) need = Math.max(need, reach[i] - pos[i][1]);
            });
            return Number.isFinite(need) ? need : 0;
        });
        // Frames off the floor (a jump) take the height between the last and next on it; then a soft
        // smoothing round the loop, so the weight passing from foot to foot rolls rather than jolts.
        const ground = def.ground || (() => true), on = frames.map((_, i) => ground(i / (steps - 1)));
        let base = floor.slice(0, steps - 1);
        const n = base.length;
        if (on.some(Boolean) && !on.every(Boolean)) {
            base = base.map((v, i) => {
                if (on[i]) return v;
                let b = i, f = i, db = 0, df = 0;
                while (!on[b]) { b = (b - 1 + n) % n; db++; }
                while (!on[f]) { f = (f + 1) % n; df++; }
                return base[b] + (base[f] - base[b]) * db / (db + df);
            });
        } else if (!on.some(Boolean)) base = base.map(() => 0);
        for (let pass = 0; pass < 3; pass++) base = base.map((v, i) => (base[(i - 1 + n) % n] + 2 * v + base[(i + 1) % n]) / 4);
        const lift = def.lift || (() => 0);
        const heights = Float32Array.from({ length: steps }, (_, i) => base[i % n] + lift(i / (steps - 1)));

        const names = new Set(frames.flatMap(fr => Object.keys(fr)));
        const tracks = [];
        for (const name of names) {
            if (!index.has(name)) continue;
            const values = new Float32Array(steps * 4);
            frames.forEach((fr, i) => values.set(fr[name] || [0, 0, 0, 1], i * 4));
            tracks.push({ bone: index.get(name), values });
        }
        return {
            name: id, times, tracks, heights, skin: !!def.skin,
            lift: t => {
                const x = ((t % def.period) + def.period) % def.period / def.period * (steps - 1), i = Math.floor(x), k = x - i;
                return heights[i] + (heights[Math.min(steps - 1, i + 1)] - heights[i]) * k;
            }
        };
    }

    const api = { POSES, clip };
    root.RRCharacterPoses = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

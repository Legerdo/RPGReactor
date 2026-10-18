/**
 * RRCharacterCloth - capes, skirts, robes, coat tails and loincloths that
 * move as cloth, worked out ahead of time. A game only plays the keys.
 *
 *   rig(result)               cloth bones for a build's loose pieces (a
 *                             grid down a cape, chains round a skirt hanging
 *                             at least MIN_HANG below its hold), their
 *                             vertices bound to them, the cape settled under
 *                             gravity onto what it covers; result.cloth holds
 *                             the rig, or null when nothing hangs loose
 *   bake(result, clip, o)     the clip with keys for the cloth bones: the
 *                             cloth simulated over the clip's frames,
 *                             pushed aside by the body's own limbs, kept
 *                             above the floor, a looping clip's cloth
 *                             ending where it starts; a cape kept outside a
 *                             skirt worked out before it. o.quality
 *                             'preview' (coarser, for the builder's view) or
 *                             'save'; the same clip, body and garment is
 *                             worked out once
 *   bakeAll(result, clips, o) every clip baked (bakeAllAsync between frames)
 *   colliders(result)         the limbs and trunk the cloth keeps out of,
 *                             measured on this body as it is built
 *   pose / skin / inside / collidersAt / floors
 *                             the helpers the tests check the bake with
 *
 * The cloth hangs from an anchor bone (the cape from the chest, a skirt from
 * the hips); its top row of points moves with the anchor and never slips.
 * Bones rest unrotated, as the builder writes them; a clip's tracks are
 * [{ bone, values }] of quaternions per time (path 'translation' for a
 * bone's offset from its parent), with `heights` and `skin` as
 * RRCharacterPoses makes them. No DOM and no three.js.
 */
(function (root) {
    'use strict';

    /** At most this many cloth bones on one character, these grids, keys 30 a second; a bone moving less than keyError radians keeps two. */
    const LIMITS = { bones: 72, cape: { columns: 6, rows: 5 }, skirt: { chains: 10, rows: 4 }, fps: 30, keyError: 0.003 };
    const QUALITY = {
        preview: { substeps: 3, iterations: 6, settle: 30, fix: 4, stride: 1, lead: 40 },
        save: { substeps: 4, iterations: 8, settle: 40, fix: 8, lead: 30 }
    };
    /** How far the cloth keeps off the body's surface (meters). */
    const GAP = 0.008;
    /** How much of a push out of the body the cloth keeps as its own speed's share left out (1 keeps none). */
    const CARRY = 0.85;
    /** How much of its own speed cloth touching the body loses each step (friction). */
    const GRIP = 0.5;
    /** How far above the hip joints a skirt is held (meters): above the thighs' roots, so a raised thigh lifts the cloth. */
    const PIN_ABOVE_HIP = 0.07;
    /** How far below its hold a skirt must hang to hang as cloth (meters). */
    const MIN_HANG = 0.28;

    // ── math ──────────────────────────────────────────────────────────────
    const qmul = (a, b) => [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
    const conj = q => [-q[0], -q[1], -q[2], q[3]];
    const rotate = (q, v) => {
        const x = q[0], y = q[1], z = q[2], w = q[3];
        const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
        return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const nlerp = (a, b, k) => {
        const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
        const q = [a[0] + (b[0] * s - a[0]) * k, a[1] + (b[1] * s - a[1]) * k, a[2] + (b[2] * s - a[2]) * k, a[3] + (b[3] * s - a[3]) * k];
        const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    };
    /** The turn taking x to d and y to s (made square to d). */
    function frameQuat(d, s) {
        const a = unit(d);
        let b = sub(s, a.map(v => v * dot(s, a)));
        if (Math.hypot(b[0], b[1], b[2]) < 1e-9) b = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        b = unit(sub(b, a.map(v => v * dot(b, a))));
        const c = cross(a, b);
        const m00 = a[0], m01 = b[0], m02 = c[0], m10 = a[1], m11 = b[1], m12 = c[1], m20 = a[2], m21 = b[2], m22 = c[2], t = m00 + m11 + m22;
        let q;
        if (t > 0) { const k = 0.5 / Math.sqrt(t + 1); q = [(m21 - m12) * k, (m02 - m20) * k, (m10 - m01) * k, 0.25 / k]; }
        else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k]; }
        else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k]; }
        else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k]; }
        const l = Math.hypot(q[0], q[1], q[2], q[3]);
        return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    }
    const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    // ── poses ─────────────────────────────────────────────────────────────
    /** A track's value at time t: quaternions blended the short way, offsets in a line. */
    function sampleTrack(times, values, n, t, out) {
        const last = times.length - 1;
        let i = 0;
        if (t >= times[last]) i = last;
        else { let lo = 0, hi = last; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; } i = lo; }
        if (i >= last) { for (let j = 0; j < n; j++) out[j] = values[last * n + j]; return out; }
        const k = Math.max(0, Math.min(1, (t - times[i]) / ((times[i + 1] - times[i]) || 1)));
        if (n === 4) {
            const a = i * 4, b = a + 4;
            const s = values[a] * values[b] + values[a + 1] * values[b + 1] + values[a + 2] * values[b + 2] + values[a + 3] * values[b + 3] < 0 ? -1 : 1;
            let l = 0;
            for (let j = 0; j < 4; j++) { out[j] = values[a + j] + (values[b + j] * s - values[a + j]) * k; l += out[j] * out[j]; }
            l = Math.sqrt(l) || 1;
            for (let j = 0; j < 4; j++) out[j] /= l;
            return out;
        }
        for (let j = 0; j < n; j++) out[j] = values[i * n + j] + (values[(i + 1) * n + j] - values[i * n + j]) * k;
        return out;
    }

    /** Every bone's turn (R) and place (P) in the model at time t of a clip; bones without a track keep their rest. */
    function pose(bones, clip, t) {
        const n = bones.length, L = new Array(n), T = new Array(n);
        for (let i = 0; i < n; i++) { L[i] = [0, 0, 0, 1]; T[i] = null; }
        if (clip) for (const tr of clip.tracks) {
            if (tr.bone >= n) continue;
            const times = tr.times || clip.times;
            if (tr.path === 'translation') T[tr.bone] = sampleTrack(times, tr.values, 3, t, [0, 0, 0]);
            else sampleTrack(times, tr.values, 4, t, L[tr.bone]);
        }
        const R = new Array(n), P = new Array(n);
        for (let i = 0; i < n; i++) {
            const b = bones[i];
            if (b.parent < 0) { R[i] = L[i]; P[i] = T[i] || b.head.slice(); continue; }
            const pb = bones[b.parent], off = T[i] || [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]];
            R[i] = qmul(R[b.parent], L[i]);
            const o = rotate(R[b.parent], off);
            P[i] = [P[b.parent][0] + o[0], P[b.parent][1] + o[1], P[b.parent][2] + o[2]];
        }
        return { R, P };
    }

    /** The pose at time t of a clip with only the share k of each turn (0 the rest pose, 1 the clip's own). */
    function poseShare(bones, clip, t, k) {
        const full = { times: clip.times, tracks: clip.tracks.map(tr => {
            const times = tr.times || clip.times, n = tr.path === 'translation' ? 3 : 4, v = sampleTrack(times, tr.values, n, t, new Array(n));
            const b = bones[tr.bone], pb = b && b.parent >= 0 ? bones[b.parent] : null;
            const rest = n === 4 ? [0, 0, 0, 1] : pb ? [b.head[0] - pb.head[0], b.head[1] - pb.head[1], b.head[2] - pb.head[2]] : b.head;
            const out = n === 4 ? nlerp(rest, v, k) : [0, 1, 2].map(c => rest[c] + (v[c] - rest[c]) * k);
            return { bone: tr.bone, path: tr.path, times: [0], values: out };
        }) };
        return pose(bones, full, 0);
    }

    /** A part's vertices skinned at a pose (`only`: the vertex ids to do, else all). */
    function skin(part, bones, ps, only) {
        const X = part.positions, J = part.joints, W = part.weights;
        const ids = only || null, count = ids ? ids.length : X.length / 3, out = new Float32Array(count * 3);
        const v3 = [0, 0, 0];
        for (let i = 0; i < count; i++) {
            const v = ids ? ids[i] : i;
            let x = 0, y = 0, z = 0;
            for (let k = 0; k < 4; k++) {
                const w = W[v * 4 + k];
                if (!w) continue;
                const b = J[v * 4 + k], h = bones[b].head;
                v3[0] = X[v * 3] - h[0]; v3[1] = X[v * 3 + 1] - h[1]; v3[2] = X[v * 3 + 2] - h[2];
                const o = rotate(ps.R[b], v3), p = ps.P[b];
                x += w * (o[0] + p[0]); y += w * (o[1] + p[1]); z += w * (o[2] + p[2]);
            }
            out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
        }
        return out;
    }

    // ── colliders ─────────────────────────────────────────────────────────
    /**
     * The body's limbs and trunk as colliders: each runs along its bone
     * toward the next joint, its reach measured round it on the flesh and
     * clothes that bone moves (so a heavy belly, broad hips or bulky armor
     * keep their size), kept under any cloth lying over it at rest.
     */
    /** [bone, toward, rounded ends]: ends 1 at the start, 2 at the end, 3 both; an end another collider covers stays open. */
    const COLLIDERS = [
        ['Hips', 'Spine', 1], ['Spine', 'Spine1', 0], ['Spine1', 'Spine2', 0], ['Spine2', 'Neck', 0], ['Neck', 'Head', 0], ['Head', null, 2],
        ['LeftShoulder', 'LeftArm', 1], ['LeftArm', 'LeftForeArm', 0], ['LeftForeArm', 'LeftHand', 0], ['LeftHand', 'LeftHandMiddle1', 2],
        ['RightShoulder', 'RightArm', 1], ['RightArm', 'RightForeArm', 0], ['RightForeArm', 'RightHand', 0], ['RightHand', 'RightHandMiddle1', 2],
        ['LeftUpLeg', 'LeftLeg', 0], ['LeftLeg', 'LeftFoot', 0], ['LeftFoot', 'LeftToeBase', 0], ['LeftToeBase', null, 2],
        ['RightUpLeg', 'RightLeg', 0], ['RightLeg', 'RightFoot', 0], ['RightFoot', 'RightToeBase', 0], ['RightToeBase', null, 2]
    ];
    /** Which collider a vertex's strongest bone counts for: fingers with the hand. */
    const owner = name => name.replace(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d$/, '$1Hand');
    const SKIP_KIND = new Set(['hair', 'eye', 'glass']);
    const SKIP_NAME = new Set(['Lashes', 'Brows', 'Eyes', 'Fur', 'Feature fur', 'Head fur']);

    /** Bearings round each collider and the most slices along it. */
    const AROUND = 24;

    /**
     * Colliders measured on the build: for each listed bone, the vertices it
     * moves most (fingers count for the hand), excluding hair, eyes and the
     * cloth itself (`exclude`: part index to a flag per vertex), described
     * as how far they reach from the bone's line at each of 16 bearings in
     * slices along it. Each is { bone, name, head, e, u, w, t0, t1, slices,
     * r (slices x 16 radii), cap0, cap1 }.
     */
    function colliders(result, exclude) {
        const bones = result.bones, index = new Map(bones.map((b, i) => [b.name, i]));
        const groups = new Map();
        COLLIDERS.forEach(([name], k) => { if (index.has(name)) groups.set(index.get(name), { k, pts: [] }); });
        const ownerOf = bones.map(b => (index.has(owner(b.name)) ? index.get(owner(b.name)) : -1));
        result.parts.forEach((p, pi) => {
            if (SKIP_KIND.has(p.kind) || SKIP_NAME.has(p.name) || p.cloth) return;
            const skip = exclude && exclude.get(pi), n = p.positions.length / 3;
            for (let v = 0; v < n; v++) {
                if (skip && skip[v]) continue;
                let j = p.joints[v * 4], w = p.weights[v * 4];
                for (let k = 1; k < 4; k++) if (p.weights[v * 4 + k] > w) { w = p.weights[v * 4 + k]; j = p.joints[v * 4 + k]; }
                const g = groups.get(ownerOf[j]);
                if (g) g.pts.push(p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]);
            }
        });
        // The cloth itself as it lies at rest: what a collider holds is only what lies under it.
        const cloth = [];
        if (exclude) for (const [pi, flags] of exclude) { const P = result.parts[pi].positions; for (let v = 0; v < flags.length; v++) if (flags[v]) cloth.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
        const out = [];
        for (const [b, g] of groups) {
            const [, toName, ends] = COLLIDERS[g.k];
            const head = bones[b].head;
            let to = toName && index.has(toName) ? bones[index.get(toName)].head : null;
            if (!to) to = /ToeBase$/.test(bones[b].name) ? [head[0], head[1], head[2] + 0.06] : [head[0], head[1] + 0.2, head[2]];
            const e = unit(sub(to, head));
            const n = g.pts.length / 3;
            if (n < 8) continue;
            const u = unit(cross(e, Math.abs(e[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), w = cross(e, u);
            const T = new Float32Array(n);
            for (let i = 0; i < n; i++) T[i] = (g.pts[i * 3] - head[0]) * e[0] + (g.pts[i * 3 + 1] - head[1]) * e[1] + (g.pts[i * 3 + 2] - head[2]) * e[2];
            const sorted = Array.from(T).sort((x, y) => x - y);
            const t0 = sorted[Math.floor(n * 0.005)], t1 = sorted[Math.min(n - 1, Math.ceil(n * 0.995))];
            const slices = Math.max(2, Math.min(14, Math.round((t1 - t0) / 0.035))), r = new Float32Array(slices * AROUND);
            for (let i = 0; i < n; i++) {
                const t = T[i];
                if (t < t0 || t > t1) continue;
                const d = [g.pts[i * 3] - head[0] - e[0] * t, g.pts[i * 3 + 1] - head[1] - e[1] * t, g.pts[i * 3 + 2] - head[2] - e[2] * t];
                const a = dot(d, u), c = dot(d, w), rho = Math.hypot(a, c);
                const si = Math.min(slices - 1, Math.floor((t - t0) / ((t1 - t0) || 1) * slices));
                const ai = Math.round(((Math.atan2(c, a) + Math.PI) / (2 * Math.PI)) * AROUND) % AROUND;
                const o = si * AROUND + ai;
                if (rho > r[o]) r[o] = rho;
            }
            // Empty bins from their neighbors round and along, then eased so one stray vertex is no spike.
            for (let pass = 0; pass < AROUND; pass++) {
                let empty = 0;
                for (let si = 0; si < slices; si++) for (let ai = 0; ai < AROUND; ai++) {
                    const o = si * AROUND + ai;
                    if (r[o]) continue;
                    empty++;
                    const near = [r[si * AROUND + (ai + 1) % AROUND], r[si * AROUND + (ai + AROUND - 1) % AROUND], si > 0 ? r[o - AROUND] : 0, si < slices - 1 ? r[o + AROUND] : 0].filter(Boolean);
                    if (near.length) r[o] = Math.max(...near) * (pass ? 1 : 1);
                }
                if (!empty) break;
            }
            const eased = Float32Array.from(r);
            for (let si = 0; si < slices; si++) for (let ai = 0; ai < AROUND; ai++) {
                const o = si * AROUND + ai, l = r[si * AROUND + (ai + AROUND - 1) % AROUND], rr = r[si * AROUND + (ai + 1) % AROUND];
                eased[o] = Math.max(r[o] * 0.85 + (l + rr) * 0.075, Math.min(r[o], Math.max(l, rr)));
            }
            // Kept under the cloth lying over it: each bin no further out than the nearest cloth in it or beside it.
            const under = new Float32Array(slices * AROUND).fill(Infinity);
            for (let i = 0; i < cloth.length; i += 3) {
                const d = [cloth[i] - head[0], cloth[i + 1] - head[1], cloth[i + 2] - head[2]], t = dot(d, e);
                if (t < t0 - 0.02 || t > t1 + 0.02) continue;
                const a = dot(d, u), c = dot(d, w), rho = Math.hypot(a, c);
                if (rho > 0.4) continue;
                const si = Math.max(0, Math.min(slices - 1, Math.floor((t - t0) / ((t1 - t0) || 1) * slices)));
                const ai = Math.round(((Math.atan2(c, a) + Math.PI) / (2 * Math.PI)) * AROUND) % AROUND;
                for (let ds = -1; ds <= 1; ds++) for (let da = -1; da <= 1; da++) {
                    const ss = si + ds;
                    if (ss < 0 || ss >= slices) continue;
                    const o = ss * AROUND + (ai + da + AROUND) % AROUND;
                    if (rho < under[o]) under[o] = rho;
                }
            }
            for (let o = 0; o < eased.length; o++) if (under[o] < Infinity) eased[o] = Math.max(eased[o] * 0.3, Math.min(eased[o], under[o] - 0.004));
            const capOf = si => { let m = 0; for (let ai = 0; ai < AROUND; ai++) m += eased[si * AROUND + ai]; return Math.max(0.012, Math.min(0.06, (m / AROUND) * 0.5)); };
            out.push({ bone: b, name: bones[b].name, head: head.slice(), e, u, w, t0, t1, slices, r: eased, cap0: ends & 1 ? capOf(0) : 0, cap1: ends & 2 ? capOf(slices - 1) : 0 });
        }
        return out;
    }

    /** A collider placed at a pose: its origin (the bone's joint) and axes in the model, 16 numbers at k. */
    function placeCollider(c, ps, into, k) {
        const R = ps.R[c.bone], P = ps.P[c.bone];
        const e = rotate(R, c.e), u = rotate(R, c.u), w = rotate(R, c.w);
        const at = k * 16;
        into[at] = P[0]; into[at + 1] = P[1]; into[at + 2] = P[2];
        into[at + 3] = e[0]; into[at + 4] = e[1]; into[at + 5] = e[2];
        into[at + 6] = u[0]; into[at + 7] = u[1]; into[at + 8] = u[2];
        into[at + 9] = w[0]; into[at + 10] = w[1]; into[at + 11] = w[2];
    }

    /** The collider's reach from its line at slice position t (along it) and bearing angle. */
    function radiusAt(c, t, angle) {
        const x = Math.max(0, Math.min(c.slices - 1, (t - c.t0) / ((c.t1 - c.t0) || 1) * c.slices - 0.5)), s0 = Math.floor(x), fs = x - s0, s1 = Math.min(c.slices - 1, s0 + 1);
        const y = ((angle + Math.PI) / (2 * Math.PI)) * AROUND, a0 = Math.floor(y), fa = y - a0, i0 = ((a0 % AROUND) + AROUND) % AROUND, i1 = (i0 + 1) % AROUND;
        const r = c.r;
        return (r[s0 * AROUND + i0] * (1 - fa) + r[s0 * AROUND + i1] * fa) * (1 - fs) + (r[s1 * AROUND + i0] * (1 - fa) + r[s1 * AROUND + i1] * fa) * fs;
    }

    /**
     * How deep a point is inside a placed collider grown by `gap`: below 1
     * is inside (the share of the way out from its line). `push` (when
     * given) is filled with where on the grown surface the point goes, out
     * from the line at its own bearing, or at the bearing of `from` (where
     * the point was a moment before, so a limb passing a piece of cloth
     * sends it out the side it came from); past an end, round the end's cap.
     */
    function insideAt(C, k, c, gap, x, y, z, push, from) {
        const at = k * 16;
        const dx = x - C[at], dy = y - C[at + 1], dz = z - C[at + 2];
        const t = dx * C[at + 3] + dy * C[at + 4] + dz * C[at + 5];
        const ex = t < c.t0 ? c.t0 - t : t > c.t1 ? t - c.t1 : 0;
        const cap = t < c.t0 ? c.cap0 : c.cap1;
        // Past an open end the next collider takes over.
        if (ex > 0 && !cap) return 2;
        const rc = cap + gap;
        if (ex >= rc) return 2;
        const a = dx * C[at + 6] + dy * C[at + 7] + dz * C[at + 8], b = dx * C[at + 9] + dy * C[at + 10] + dz * C[at + 11];
        const rho = Math.sqrt(a * a + b * b), angle = Math.atan2(b, a), R = radiusAt(c, t, angle) + gap;
        if (R <= 0) return 2;
        const s = Math.sqrt((rho / R) * (rho / R) + (ex ? (ex / rc) * (ex / rc) : 0));
        if (push && s < 1) {
            let ka, kb;
            let ua = a, ub = b, ur = rho;
            if (from) {
                const fx = from[0] - C[at], fy = from[1] - C[at + 1], fz = from[2] - C[at + 2];
                const fa = fx * C[at + 6] + fy * C[at + 7] + fz * C[at + 8], fb = fx * C[at + 9] + fy * C[at + 10] + fz * C[at + 11], fr = Math.sqrt(fa * fa + fb * fb);
                if (fr > 1e-6 && fa * a + fb * b < rho * fr * 0.7) { ua = fa; ub = fb; ur = fr; }
            }
            if (ur < 1e-6) { ka = 0; kb = -R; }
            else {
                // The surface at the chosen bearing, the point's depth kept.
                const Rb = ua === a ? R : radiusAt(c, t, Math.atan2(ub, ua)) + gap, reach = Rb * Math.sqrt(Math.max(0, 1 - (ex ? (ex / rc) * (ex / rc) : 0))) || Rb * 0.05;
                const out = ua === a ? rho / s : Math.max(reach, rho);
                ka = ua / ur * out; kb = ub / ur * out;
            }
            const along = t < c.t0 ? c.t0 - ex / s : t > c.t1 ? c.t1 + ex / s : t;
            push[0] = C[at] + C[at + 3] * along + C[at + 6] * ka + C[at + 9] * kb;
            push[1] = C[at + 1] + C[at + 4] * along + C[at + 7] * ka + C[at + 10] * kb;
            push[2] = C[at + 2] + C[at + 5] * along + C[at + 8] * ka + C[at + 11] * kb;
        }
        return s;
    }

    /** The middle of a collider's span and how far round it reaches, for a quick test before the exact one. */
    function boundOf(c) {
        let m = 0;
        for (let i = 0; i < c.r.length; i++) m = Math.max(m, c.r[i]);
        return { mid: (c.t0 + c.t1) / 2, radius: (c.t1 - c.t0) / 2 + Math.max(m, c.cap0, c.cap1) + 0.05 };
    }

    /** Whether a model-space point lies inside a collider at a pose (the tests' check); `shrink` eases the surface in. */
    function inside(c, ps, p, shrink) {
        const C = new Float32Array(16);
        placeCollider(c, ps, C, 0);
        return insideAt(C, 0, c, -(shrink || 0), p[0], p[1], p[2], null) < 1;
    }

    /**
     * The colliders placed at a pose once, for checking many points: returns
     * (point, shrink) => the name of the first collider the point lies
     * inside (its surface eased in by shrink), or null.
     */
    function collidersAt(cols, ps) {
        const C = new Float32Array(cols.length * 16);
        cols.forEach((c, i) => placeCollider(c, ps, C, i));
        const { reach, mids } = reaches(cols);
        return (p, shrink) => {
            for (let k = 0; k < cols.length; k++) {
                const at = k * 16, dx = p[0] - C[at] - C[at + 3] * mids[k], dy = p[1] - C[at + 1] - C[at + 4] * mids[k], dz = p[2] - C[at + 2] - C[at + 5] * mids[k];
                if (dx * dx + dy * dy + dz * dz > reach[k]) continue;
                if (insideAt(C, k, cols[k], -(shrink || 0), p[0], p[1], p[2], null) < 1) return cols[k].name;
            }
            return null;
        };
    }

    // ── the rig ───────────────────────────────────────────────────────────
    /** Vertex neighbors from a triangle list, for the vertices in `keep` (or all). */
    function neighbors(index, count) {
        const near = Array.from({ length: count }, () => []);
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t], b = index[t + 1], c = index[t + 2];
            if (a >= count || b >= count || c >= count) continue;
            near[a].push(b, c); near[b].push(a, c); near[c].push(a, b);
        }
        return near.map(n => [...new Set(n)]);
    }

    /** The biggest connected sheet among a part's vertices [start, end). */
    function sheetOf(part, start, end) {
        const near = neighbors(part.index, part.positions.length / 3);
        const seen = new Int32Array(end - start).fill(-1);
        let best = [];
        for (let v = start; v < end; v++) {
            if (seen[v - start] >= 0) continue;
            const group = [v];
            seen[v - start] = v;
            for (let q = 0; q < group.length; q++) for (const u of near[group[q]]) if (u >= start && u < end && seen[u - start] < 0) { seen[u - start] = v; group.push(u); }
            if (group.length > best.length) best = group;
        }
        return best;
    }

    /**
     * The four strongest of two skins mixed, `a` (joints, weights) by 1 - k
     * and `b` by k.
     */
    function blendSkin(ja, wa, jb, wb, k) {
        const m = new Map();
        for (let q = 0; q < 4; q++) { if (wa[q] > 0) m.set(ja[q], (m.get(ja[q]) || 0) + wa[q] * (1 - k)); if (wb[q] > 0) m.set(jb[q], (m.get(jb[q]) || 0) + wb[q] * k); }
        const top = [...m.entries()].filter(e => e[1] > 1e-5).sort((p, q) => q[1] - p[1]).slice(0, 4);
        const total = top.reduce((s, e) => s + e[1], 0) || 1;
        const J = [0, 0, 0, 0], W = [0, 0, 0, 0];
        top.forEach(([j, w], q) => { J[q] = j; W[q] = w / total; });
        return [J, W];
    }

    /** A chain grid's bones' skin at (across a, down s): two chains by two bones along. */
    function gridSkin(region, a, s, present) {
        const S = region.rows;
        const r = Math.max(0, Math.min(S - 1, Math.floor(s))), f = s - r;
        // Along the chain, each bone weighs most at its own middle.
        let along;
        if (f < 0.5 && r > 0) along = [[r - 1, 0.5 - f], [r, 0.5 + f]];
        else if (f >= 0.5 && r < S - 1) along = [[r, 1.5 - f], [r + 1, f - 0.5]];
        else along = [[r, 1]];
        const K = region.chains;
        let c0 = Math.floor(a), fa = a - c0;
        if (region.ring) { c0 = ((c0 % K) + K) % K; }
        else if (c0 >= K - 1) { c0 = K - 1; fa = 0; }
        else if (c0 < 0) { c0 = 0; fa = 0; }
        let c1 = region.ring ? (c0 + 1) % K : Math.min(K - 1, c0 + 1);
        // A missing chain (an open front, a slit) gives its share to the one beside it.
        const has = (c, row) => present(c, row);
        const cols = [];
        for (const [c, w] of [[c0, 1 - fa], [c1, fa]]) if (w > 1e-4) cols.push([c, w]);
        const out = new Map();
        for (const [c, wc] of cols) for (const [row, wr] of along) {
            let cc = c;
            if (!has(cc, row)) { const other = cc === c0 ? c1 : c0; if (has(other, row)) cc = other; else continue; }
            const bone = region.boneOf(cc, row);
            if (bone < 0) continue;
            out.set(bone, (out.get(bone) || 0) + wc * wr);
        }
        // A vertex below a chain's last bone rides on its last bone.
        if (!out.size) for (const [c] of cols) for (let row = Math.min(S - 1, r); row >= 0; row--) if (region.boneOf(c, row) >= 0) { out.set(region.boneOf(c, row), 1); break; }
        const top = [...out.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
        const total = top.reduce((sum, e) => sum + e[1], 0) || 1;
        const J = [0, 0, 0, 0], W = [0, 0, 0, 0];
        top.forEach(([j, w], q) => { J[q] = j; W[q] = w / total; });
        return [J, W];
    }

    /**
     * A cape's grid: the sheet's height down from its top (t, 0..1) and its
     * place across each row (u, 0..1); rows of points from below the
     * shoulders down to the hem.
     */
    function capeRegion(result, pi, range, bones, index, budget) {
        const part = result.parts[pi], P = part.positions;
        const sheet = sheetOf(part, range.start, range.start + range.count);
        if (sheet.length < 16) return null;
        let top = -Infinity, bottom = Infinity;
        for (const v of sheet) { top = Math.max(top, P[v * 3 + 1]); bottom = Math.min(bottom, P[v * 3 + 1]); }
        const height = top - bottom;
        if (height < 0.15) return null;
        const BINS = 32, lo = new Float32Array(BINS).fill(Infinity), hi = new Float32Array(BINS).fill(-Infinity);
        const tOf = v => (top - P[v * 3 + 1]) / height;
        for (const v of sheet) { const b = Math.min(BINS - 1, Math.floor(tOf(v) * BINS)); lo[b] = Math.min(lo[b], P[v * 3]); hi[b] = Math.max(hi[b], P[v * 3]); }
        for (let pass = 0; pass < 2; pass++) for (let b = 0; b < BINS; b++) if (!isFinite(lo[b])) { const n = isFinite(lo[b - 1]) ? b - 1 : b + 1; lo[b] = lo[n]; hi[b] = hi[n]; }
        const extent = t => { const x = Math.max(0, Math.min(BINS - 1.001, t * BINS - 0.5)), b = Math.floor(x), f = x - b, c = Math.min(BINS - 1, b + 1); return [lo[b] + (lo[c] - lo[b]) * f, hi[b] + (hi[c] - hi[b]) * f]; };
        const uOf = v => { const [a, b] = extent(tOf(v)); return b - a > 1e-6 ? (P[v * 3] - a) / (b - a) : 0.5; };
        // Held from just below the tops of the shoulders.
        const arm = index.has('LeftArm') ? bones[index.get('LeftArm')].head[1] : top - 0.1;
        const tPin = Math.max(0.04, Math.min(0.3, (top - (arm - 0.04)) / height));
        const C = budget.columns, S = budget.rows;
        const params = new Map(sheet.map(v => [v, [uOf(v), tOf(v)]]));
        // Each point of the grid on the sheet: the mean of the vertices round it.
        const rest = new Float32Array(C * (S + 1) * 3);
        for (let c = 0; c < C; c++) for (let j = 0; j <= S; j++) {
            const u = c / (C - 1), t = tPin + (1 - tPin) * j / S;
            // On an edge or the hem only the vertices along it count, so the grid reaches the sheet's very edge.
            const uOnly = c === 0 || c === C - 1 ? 0.02 : 1, tOnly = j === S ? 0.02 : 1;
            let sx = 0, sy = 0, sz = 0, sw = 0;
            for (const v of sheet) {
                const [pu, pt] = params.get(v), du = (pu - u) / 0.06, dt = (pt - t) / 0.045, d = du * du + dt * dt;
                if (d > 9 || Math.abs(pu - u) > uOnly || Math.abs(pt - t) > tOnly) continue;
                const w = Math.exp(-d);
                sx += P[v * 3] * w; sy += P[v * 3 + 1] * w; sz += P[v * 3 + 2] * w; sw += w;
            }
            const o = (c * (S + 1) + j) * 3;
            rest[o] = sx / (sw || 1); rest[o + 1] = sy / (sw || 1); rest[o + 2] = sz / (sw || 1);
        }
        const anchor = index.get(range.anchor || 'Spine2');
        return {
            kind: 'cape', part: pi, anchor, chains: C, rows: S, ring: false, rest, length: new Int32Array(C).fill(S),
            sheet, params, tPin, height, top,
            stiff: 0.004, drag: 0.02, gap: GAP
        };
    }

    /**
     * A skirt's chains: hanging round the hips from where the skirt leaves the
     * body (the hip joints' height) to the lowest hem, one chain at each
     * bearing where cloth hangs, each only as long as the cloth under it.
     */
    function skirtRegion(result, marks, bones, index, budget) {
        const hips = index.get('Hips'), upL = index.get('LeftUpLeg'), upR = index.get('RightUpLeg');
        if (hips === undefined || upL === undefined) return null;
        const hipY = (bones[upL].head[1] + bones[upR].head[1]) / 2;
        const center = [(bones[upL].head[0] + bones[upR].head[0]) / 2, 0, (bones[upL].head[2] + bones[upR].head[2]) / 2];
        const verts = [];
        for (const [pi, hang] of marks) {
            const P = result.parts[pi].positions;
            for (let v = 0; v < hang.length; v++) if (hang[v] >= 0) verts.push([pi, v, hang[v], Math.atan2(P[v * 3] - center[0], P[v * 3 + 2] - center[2]), P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
        }
        if (verts.length < 30) return null;
        // Held a little above the hip joints, where lifting a thigh moves the body least.
        const near = verts.filter(q => Math.abs(q[5] - (hipY + PIN_ABOVE_HIP)) < 0.025).map(q => q[2]).sort((a, b) => a - b);
        let uPin = near.length ? near[Math.floor(near.length / 2)] : 0.2;
        let uHem = 0;
        for (const q of verts) uHem = Math.max(uHem, q[2]);
        if (uHem - uPin < 0.06) return null;
        // Height of the pin and hem rings, for the length of each segment.
        const yAt = u => { let s = 0, n = 0; for (const q of verts) if (Math.abs(q[2] - u) < 0.03) { s += q[5]; n++; } return n ? s / n : hipY; };
        const yPin = yAt(uPin), yHem = yAt(uHem);
        // A short skirt (a tunic's, a mini) hugs the hips and moves with the body's own skin; a long one hangs as cloth.
        if (yPin - yHem < MIN_HANG) return null;
        const S = Math.max(1, Math.min(budget.rows, Math.round((yPin - yHem) / 0.17)));
        const K = budget.chains, step = (2 * Math.PI) / K;
        // Points of each chain: the cloth nearest the body at that bearing and reach.
        const uOfRow = j => uPin + (uHem - uPin) * j / S;
        const rest = new Float32Array(K * (S + 1) * 3), has = new Uint8Array(K * (S + 1));
        const bins = Array.from({ length: K }, () => []);
        for (const q of verts) { const a = ((q[3] % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); bins[Math.round(a / step) % K].push(q); }
        const du = Math.max(0.03, (uHem - uPin) / S * 0.45);
        for (let k = 0; k < K; k++) {
            const ak = k * step;
            for (let j = 0; j <= S; j++) {
                const u = j === S ? uHem : uOfRow(j);
                // At the hem the band reaches only upward, so a short flap ends its chain at its own hem.
                // The vertices nearest that reach (a short flap's own hem ends its chain), the innermost layer of them.
                const around = bins[k].filter(q => Math.abs(q[2] - u) < (j === S ? du * 1.2 : du)).sort((a, b) => Math.abs(a[2] - u) - Math.abs(b[2] - u)).slice(0, 16);
                if (around.length < 3) continue;
                let rmin = Infinity;
                for (const q of around) rmin = Math.min(rmin, Math.hypot(q[4] - center[0], q[6] - center[2]));
                let sr = 0, sy = 0, n = 0;
                for (const q of around) { const r = Math.hypot(q[4] - center[0], q[6] - center[2]); if (r < rmin + 0.012) { sr += r; sy += q[5]; n++; } }
                const o = (k * (S + 1) + j) * 3;
                rest[o] = center[0] + Math.sin(ak) * sr / n; rest[o + 1] = sy / n; rest[o + 2] = center[2] + Math.cos(ak) * sr / n;
                has[k * (S + 1) + j] = 1;
            }
        }
        // A chain runs from its pin down while it has cloth; one without its pin is left out.
        const length = new Int32Array(K);
        for (let k = 0; k < K; k++) { let j = 0; if (!has[k * (S + 1)]) continue; while (j < S && has[k * (S + 1) + j + 1]) j++; length[k] = j; }
        if (!length.some(l => l > 0)) return null;
        // Each point carried by the skin nearest it (a thigh's for the points in front of it): a clip starts with the
        // skirt laid over the thighs of a body already sitting and lets it fall from there.
        const startSkin = [], body = result.parts.find(p => p.name === 'Body');
        for (let i = 0; i < K * (S + 1); i++) {
            if (!has[i] || !body) { startSkin.push(null); continue; }
            const B = body.positions;
            let best = -1, bd = Infinity;
            for (let v = 0; v < B.length / 3; v += 2) { const d = (B[v * 3] - rest[i * 3]) ** 2 + (B[v * 3 + 1] - rest[i * 3 + 1]) ** 2 + (B[v * 3 + 2] - rest[i * 3 + 2]) ** 2; if (d < bd) { bd = d; best = v; } }
            startSkin.push([Array.from(body.joints.subarray(best * 4, best * 4 + 4)), Array.from(body.weights.subarray(best * 4, best * 4 + 4))]);
        }
        return {
            kind: 'skirt', anchor: hips, chains: K, rows: S, ring: true, rest, length, center, uPin, uHem, verts, step, startSkin,
            stiff: 0.01, drag: 0.03, gap: GAP
        };
    }

    /** The cloth links of a region: down each chain, across between chains, and every other point down (bending). */
    function linksOf(region) {
        const K = region.chains, S = region.rows, R = region.rest, at = (k, j) => k * (S + 1) + j;
        const len = (a, b) => Math.hypot(R[a * 3] - R[b * 3], R[a * 3 + 1] - R[b * 3 + 1], R[a * 3 + 2] - R[b * 3 + 2]);
        const down = [], across = [], bend = [], shear = [];
        for (let k = 0; k < K; k++) for (let j = 0; j < region.length[k]; j++) {
            down.push(at(k, j), at(k, j + 1), len(at(k, j), at(k, j + 1)));
            if (j + 2 <= region.length[k]) bend.push(at(k, j), at(k, j + 2), len(at(k, j), at(k, j + 2)));
        }
        const next = k => (region.ring ? (k + 1) % K : k + 1);
        for (let k = 0; k < K; k++) {
            const n = next(k);
            if (n >= K || n === k) continue;
            for (let j = 0; j <= S; j++) {
                if (j > region.length[k] || j > region.length[n]) continue;
                // Across a slit or an open front the chains stay apart.
                if (region.kind === 'skirt' && !covered(region, (k + 0.5) * region.step, j)) continue;
                across.push(at(k, j), at(n, j), len(at(k, j), at(n, j)));
                // The two diagonals of the square below, so the panel keeps its shape.
                if (j < S && j + 1 <= region.length[k] && j + 1 <= region.length[n] && (region.kind !== 'skirt' || covered(region, (k + 0.5) * region.step, j + 1))) {
                    shear.push(at(k, j), at(n, j + 1), len(at(k, j), at(n, j + 1)), at(n, j), at(k, j + 1), len(at(n, j), at(k, j + 1)));
                }
            }
        }
        return { down: Float32Array.from(down), across: Float32Array.from(across), bend: Float32Array.from(bend), shear: Float32Array.from(shear) };
    }

    /** Whether a skirt has cloth at a bearing, at a row's reach. */
    function covered(region, angle, j) {
        const S = region.rows, u = region.uPin + (region.uHem - region.uPin) * Math.min(S, j) / S, du = Math.max(0.03, (region.uHem - region.uPin) / S * 0.5);
        const a0 = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let n = 0;
        for (const q of region.verts) {
            let d = Math.abs((((q[3] - a0) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
            if (d < region.step * 0.3 && Math.abs(q[2] - u) < du && ++n >= 2) return true;
        }
        return false;
    }

    /**
     * Cloth bones for the build's loose pieces. Parts carrying `cloth`
     * (ranges of an accessory's vertices: { start, count, anchor }) hang as
     * a cape; parts carrying `hang` (each vertex's reach down a skirt, 0 at
     * the waistband, below 0 off it) hang as a skirt. Mutates the result:
     * parts bound to the new bones (new arrays), bones appended, the cape
     * settled; returns result.cloth (null when nothing hangs).
     */
    function rig(result) {
        result.cloth = null;
        if (!result || result.plan === 'quadruped' || !result.bones || !result.parts) return null;
        const bones = result.bones, index = new Map(bones.map((b, i) => [b.name, i]));
        if (!index.has('Hips') || !index.has('LeftUpLeg')) return null;
        const capes = [], marks = [];
        result.parts.forEach((p, pi) => {
            if (Array.isArray(p.cloth)) for (const r of p.cloth) capes.push([pi, r]);
            if (p.hang && p.hang.length === p.positions.length / 3) marks.push([pi, p.hang]);
        });
        if (!capes.length && !marks.length) return null;
        const regions = [];
        let room = Math.max(0, Math.min(LIMITS.bones, 255 - bones.length));
        const capeBudget = LIMITS.cape, skirtBudget = LIMITS.skirt;
        if (marks.length && room >= 4) {
            const s = skirtRegion(result, marks, bones, index, skirtBudget);
            if (s) regions.push(s);
        }
        for (const [pi, r] of capes) {
            const c = capeRegion(result, pi, r, bones, index, capeBudget);
            if (c) regions.push(c);
        }
        if (!regions.length) return null;
        // Bones: chain by chain, each segment from one point to the next, the first hung on the anchor.
        const exclude = new Map();
        const parts = result.parts.slice();
        for (const g of regions) {
            const S = g.rows, at = (k, j) => k * (S + 1) + j;
            const ids = new Int32Array(g.chains * S).fill(-1);
            for (let k = 0; k < g.chains; k++) for (let j = 0; j < g.length[k]; j++) {
                if (room <= 0) break;
                const a = at(k, j) * 3, b = at(k, j + 1) * 3;
                ids[k * S + j] = bones.length;
                bones.push({ name: (g.kind === 'cape' ? 'ClothCape' : 'ClothSkirt') + k + '_' + j, parent: j === 0 ? g.anchor : ids[k * S + j - 1], head: [g.rest[a], g.rest[a + 1], g.rest[a + 2]], tail: [g.rest[b], g.rest[b + 1], g.rest[b + 2]], cloth: true });
                room--;
            }
            g.boneIds = ids;
            g.boneOf = (k, j) => (k >= 0 && k < g.chains && j >= 0 && j < S ? ids[k * S + j] : -1);
            g.links = linksOf(g);
        }
        // The cape settled where it hangs at rest, then every vertex bound.
        const capeRegions = regions.filter(g => g.kind === 'cape');
        // What the cloth keeps out of: the body and everything on it but the cloth. A cape over a skirt also keeps out
        // of the skirt above its hold (it moves with the body); the skirt itself leaves all of its own out.
        const flag = (map, pi, v) => { const m = map.get(pi) || new Uint8Array(parts[pi].positions.length / 3); m[v] = 1; map.set(pi, m); };
        const overCape = new Map();
        for (const g of regions) {
            if (g.kind === 'cape') for (const v of g.sheet) { flag(exclude, g.part, v); flag(overCape, g.part, v); }
            else for (const q of g.verts) { flag(exclude, q[0], q[1]); if (q[2] >= g.uPin - 0.06) flag(overCape, q[0], q[1]); }
        }
        const cols = colliders({ bones, parts }, exclude);
        const capeCols = capeRegions.length && regions.some(g => g.kind === 'skirt') ? colliders({ bones, parts }, overCape) : cols;
        // The cape lies over everything else, a skirt or a coat's tails included.
        const own = new Map();
        for (const g of capeRegions) { const m = own.get(g.part) || new Uint8Array(parts[g.part].positions.length / 3); for (const v of g.sheet) m[v] = 1; own.set(g.part, m); }
        const surface = capeRegions.length ? surfaceOf(parts, own) : null;
        for (const g of capeRegions) settleCape(g, parts, capeCols, bones, surface);
        for (const g of regions) bindRegion(g, parts, bones);
        result.parts = parts;
        let key = 0;
        for (const g of regions) for (let i = 0; i < g.rest.length; i += 7) key = (key * 31 + Math.round(g.rest[i] * 1e4)) | 0;
        for (const c of cols.concat(capeCols === cols ? [] : capeCols)) for (let i = 0; i < c.r.length; i += 5) key = (key * 31 + Math.round(c.r[i] * 1e4)) | 0;
        result.cloth = {
            regions: regions.map(g => ({ kind: g.kind, anchor: g.anchor, chains: g.chains, rows: g.rows, ring: g.ring, rest: g.rest, length: g.length, boneIds: g.boneIds, links: g.links, stiff: g.stiff, drag: g.drag, gap: g.gap, part: g.part, sheet: g.sheet ? Int32Array.from(g.sheet) : null, verts: g.kind === 'skirt' ? g.verts.map(q => [q[0], q[1]]) : null, center: g.center || null, startSkin: g.startSkin || null, colliders: g.kind === 'cape' && capeCols !== cols ? capeCols : null })),
            colliders: cols, key: String(key >>> 0) + ':' + bones.length, bones: bones.length
        };
        return result.cloth;
    }

    /**
     * The surfaces under the cloth (skin, garments, armor; not hair, eyes or
     * the cloth itself) as points with their normals and skins in a grid of
     * 4 cm cells, for finding what lies under a point.
     */
    function surfaceOf(parts, exclude) {
        const cell = 0.04, grid = new Map(), pts = [];
        parts.forEach((p, pi) => {
            if (SKIP_KIND.has(p.kind) || SKIP_NAME.has(p.name) || p.cloth || !p.normals) return;
            const skip = exclude.get(pi), n = p.positions.length / 3;
            for (let v = 0; v < n; v++) {
                if (skip && skip[v]) continue;
                const x = p.positions[v * 3], y = p.positions[v * 3 + 1], z = p.positions[v * 3 + 2];
                const key = Math.floor(x / cell) + ',' + Math.floor(y / cell) + ',' + Math.floor(z / cell);
                let list = grid.get(key);
                if (!list) grid.set(key, list = []);
                list.push(pts.length);
                pts.push([x, y, z, p.normals[v * 3], p.normals[v * 3 + 1], p.normals[v * 3 + 2], pi, v]);
            }
        });
        /** The nearest surface point within two cells, or null. */
        const nearest = (x, y, z) => {
            const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
            let best = null, bd = Infinity;
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
                const list = grid.get((cx + i) + ',' + (cy + j) + ',' + (cz + k));
                if (list) for (const q of list) { const p = pts[q], d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2; if (d < bd) { bd = d; best = p; } }
            }
            return best;
        };
        return { nearest, parts };
    }

    /** Points (a Float32Array, the ids in `ids`) moved out in front of the surface under them by `gap`. */
    function pushOut(P, ids, surface, gap) {
        let moved = 0;
        for (const v of ids) {
            for (let pass = 0; pass < 2; pass++) {
                const q = surface.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
                if (!q) break;
                const d = (P[v * 3] - q[0]) * q[3] + (P[v * 3 + 1] - q[1]) * q[4] + (P[v * 3 + 2] - q[2]) * q[5];
                if (d >= gap) break;
                P[v * 3] += q[3] * (gap - d); P[v * 3 + 1] += q[4] * (gap - d); P[v * 3 + 2] += q[5] * (gap - d);
                moved++;
            }
        }
        return moved;
    }

    /**
     * The cape let fall at rest: its points under gravity, held at the top,
     * their links keeping their lengths, kept out of the body; then each
     * vertex of the sheet moved with the grid round it, and the grid's
     * bones made to rest where it settled.
     */
    function settleCape(g, parts, cols, bones, surface) {
        const S = g.rows, K = g.chains, n = K * (S + 1);
        const x = Float32Array.from(g.rest), prev = Float32Array.from(g.rest), inv = new Float32Array(n);
        for (let k = 0; k < K; k++) for (let j = 1; j <= S; j++) inv[k * (S + 1) + j] = 1;
        const ps = { R: bones.map(() => [0, 0, 0, 1]), P: bones.map(b => b.head) };
        const C = new Float32Array(cols.length * 16);
        cols.forEach((c, i) => placeCollider(c, ps, C, i));
        const { reach, mids } = reaches(cols);
        const sim = { x, prev, inv, links: g.links, n, C, cols, reach, mids, floor: 0, gap: g.gap, drag: 0.08, stiff: 0.03, target: Float32Array.from(g.rest) };
        const h = 1 / 60;
        for (let s = 0; s < 90; s++) step(sim, h, 6);
        project(sim, g);
        // Each vertex moved as its grid square moved: bilinear over the four points round it.
        const part = parts[g.part], P = Float32Array.from(part.positions);
        for (const v of g.sheet) {
            const [u, t] = g.params.get(v);
            if (t < g.tPin) continue;
            const a = Math.max(0, Math.min(K - 1.0001, u * (K - 1))), s = Math.max(0, Math.min(S - 0.0001, (t - g.tPin) / (1 - g.tPin) * S));
            const c0 = Math.floor(a), r0 = Math.floor(s), fa = a - c0, fs = s - r0;
            let dx = 0, dy = 0, dz = 0;
            for (const [c, j, w] of [[c0, r0, (1 - fa) * (1 - fs)], [c0 + 1, r0, fa * (1 - fs)], [c0, r0 + 1, (1 - fa) * fs], [c0 + 1, r0 + 1, fa * fs]]) {
                const o = (c * (S + 1) + j) * 3;
                dx += (x[o] - g.rest[o]) * w; dy += (x[o + 1] - g.rest[o + 1]) * w; dz += (x[o + 2] - g.rest[o + 2]) * w;
            }
            // Eased in below the held top, so the shoulders keep their wrap.
            const k = smoothstep(g.tPin, g.tPin + 0.12, t);
            P[v * 3] += dx * k; P[v * 3 + 1] += dy * k; P[v * 3 + 2] += dz * k;
        }
        // Whatever of the sheet still lies in the body is lifted out.
        const push = [0, 0, 0];
        for (const v of g.sheet) for (let i = 0; i < cols.length; i++) {
            if (insideAt(C, i, cols[i], g.gap * 0.6, P[v * 3], P[v * 3 + 1], P[v * 3 + 2], push) < 1) { P[v * 3] = push[0]; P[v * 3 + 1] = push[1]; P[v * 3 + 2] = push[2]; }
        }
        // Then clear of the very surface under it, the held top riding on that surface's own skin.
        pushOut(P, g.sheet, surface, 0.009);
        g.under = new Map();
        for (const v of g.sheet) {
            if (g.params.get(v)[1] >= g.tPin) continue;
            const q = surface.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
            if (q) { const sp = parts[q[6]]; g.under.set(v, [Array.from(sp.joints.subarray(q[7] * 4, q[7] * 4 + 4)), Array.from(sp.weights.subarray(q[7] * 4, q[7] * 4 + 4))]); }
        }
        parts[g.part] = Object.assign({}, part, { positions: P, normals: normalsOf(P, part.index) });
        g.rest = Float32Array.from(x);
        // The bones rest where the grid came to rest.
        for (let k = 0; k < K; k++) for (let j = 0; j < S; j++) {
            const id = g.boneOf(k, j);
            if (id < 0) continue;
            const a = (k * (S + 1) + j) * 3, b = (k * (S + 1) + j + 1) * 3;
            bones[id].head = [x[a], x[a + 1], x[a + 2]]; bones[id].tail = [x[b], x[b + 1], x[b + 2]];
        }
        g.links = linksOf(g);
    }

    function normalsOf(P, I) {
        const N = new Float32Array(P.length);
        for (let t = 0; t < I.length; t += 3) {
            const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { N[s] += nx; N[s + 1] += ny; N[s + 2] += nz; }
        }
        for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
        return N;
    }

    /**
     * Each vertex of a region bound to its bones: below the held top, to the
     * grid round it; across a narrow band at the top, eased from its own
     * skin to the anchor's, so the held edge never tears.
     */
    function bindRegion(g, parts, bones) {
        const S = g.rows;
        const present = (c, row) => row < g.length[c];
        const touched = new Map();
        const take = pi => { if (!touched.has(pi)) { const p = parts[pi]; touched.set(pi, { J: Uint8Array.from(p.joints), W: Float32Array.from(p.weights) }); } return touched.get(pi); };
        const anchorJ = [g.anchor, 0, 0, 0], anchorW = [1, 0, 0, 0];
        const write = (o, v, J, W) => { for (let q = 0; q < 4; q++) { o.J[v * 4 + q] = J[q]; o.W[v * 4 + q] = W[q]; } };
        const own = (pi, v) => { const p = parts[pi]; return [Array.from(p.joints.subarray(v * 4, v * 4 + 4)), Array.from(p.weights.subarray(v * 4, v * 4 + 4))]; };
        if (g.kind === 'cape') {
            const o = take(g.part);
            for (const v of g.sheet) {
                const [u, t] = g.params.get(v), s = (t - g.tPin) / (1 - g.tPin) * S;
                if (s < 0) {
                    // The held top rides on the surface under it, eased into the anchor just above the grid.
                    const [J, W] = (g.under && g.under.get(v)) || own(g.part, v);
                    const [J2, W2] = blendSkin(J, W, anchorJ, anchorW, smoothstep(-0.35, 0, s));
                    write(o, v, J2, W2);
                    continue;
                }
                const [J, W] = gridSkin(g, u * (g.chains - 1), s, present);
                write(o, v, J, W);
            }
        } else {
            const span = g.uHem - g.uPin, band = Math.min(0.06, span * 0.4);
            for (const q of g.verts) {
                const [pi, v, u, ang] = q, o = take(pi);
                if (u < g.uPin - band) continue;
                const a = ((ang / g.step) % g.chains + g.chains) % g.chains;
                if (u < g.uPin) { const [J, W] = own(pi, v); const [J2, W2] = blendSkin(J, W, anchorJ, anchorW, smoothstep(g.uPin - band, g.uPin, u)); write(o, v, J2, W2); continue; }
                const [J, W] = gridSkin(g, a, (u - g.uPin) / span * S, present);
                write(o, v, J, W);
            }
        }
        for (const [pi, o] of touched) parts[pi] = Object.assign({}, parts[pi], { joints: o.J, weights: o.W });
    }

    // ── the solver ────────────────────────────────────────────────────────
    /**
     * One step of the cloth: moved on by its own speed and gravity, its
     * links kept, the body and the floor pushing it out. `sim.target`
     * (optional) pulls each point a little toward where it hangs at rest.
     */
    function step(sim, h, iterations) {
        const { x, prev, inv, n, links } = sim, g = 9.8 * h * h, keep = 1 - sim.drag;
        for (let i = 0; i < n; i++) {
            if (!inv[i]) continue;
            const o = i * 3;
            for (let c = 0; c < 3; c++) { const v = (x[o + c] - prev[o + c]) * keep; prev[o + c] = x[o + c]; x[o + c] += v; }
            x[o + 1] -= g;
            if (sim.target && sim.stiff) for (let c = 0; c < 3; c++) x[o + c] += (sim.target[o + c] - x[o + c]) * sim.stiff;
        }
        for (let it = 0; it < iterations; it++) {
            solve(x, inv, links.down, 1, 1, 1);
            solve(x, inv, links.across, 0.9, 1.03, 0.958);
            solve(x, inv, links.shear, 0.5, 1.06, 0.916);
            solve(x, inv, links.bend, 0.3, Infinity, 0.62);
            if (it === iterations - 1 || it % 3 === 2) collide(sim);
        }
    }

    /**
     * Distance links (a, b, rest) kept between low and high times their
     * rest length, with stiffness k: a chain's own links exactly, the cloth
     * across free to gather into folds but not to stretch.
     */
    function solve(x, inv, L, k, high, low) {
        for (let e = 0; e < L.length; e += 3) {
            const i = L[e], j = L[e + 1], rest = L[e + 2], wi = inv[i], wj = inv[j], ws = wi + wj;
            if (!ws) continue;
            const a = i * 3, b = j * 3, dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
            const goal = d > rest * high ? rest * high : d < rest * low ? rest * low : d;
            if (goal === d) continue;
            const f = (d - goal) / d / ws * k;
            x[a] += dx * f * wi; x[a + 1] += dy * f * wi; x[a + 2] += dz * f * wi;
            x[b] -= dx * f * wj; x[b + 1] -= dy * f * wj; x[b + 2] -= dz * f * wj;
        }
    }

    function reaches(cols) {
        const reach = new Float32Array(cols.length), mids = new Float32Array(cols.length);
        cols.forEach((c, i) => { const b = boundOf(c); reach[i] = b.radius * b.radius; mids[i] = b.mid; });
        return { reach, mids };
    }

    /** Points and the links between them pushed out of the body, then off the floor. */
    function collide(sim) {
        const { x, prev, inv, n, C, cols, gap } = sim, push = [0, 0, 0], from = [0, 0, 0];
        const m = cols.length, reach = sim.reach, mids = sim.mids;
        for (let i = 0; i < n; i++) {
            if (!inv[i]) continue;
            const o = i * 3;
            for (let k = 0; k < m; k++) {
                const at = k * 16, dx = x[o] - C[at] - C[at + 3] * mids[k], dy = x[o + 1] - C[at + 1] - C[at + 4] * mids[k], dz = x[o + 2] - C[at + 2] - C[at + 5] * mids[k];
                if (dx * dx + dy * dy + dz * dz > reach[k]) continue;
                from[0] = prev[o]; from[1] = prev[o + 1]; from[2] = prev[o + 2];
                if (insideAt(C, k, cols[k], gap, x[o], x[o + 1], x[o + 2], push, from) < 1) {
                    // Where the body rests on the floor the cloth under it lies flat on the floor, never under it.
                    if (push[1] < sim.floor + gap) push[1] = sim.floor + gap;
                    // Carried by the limb rather than thrown: the push takes most of its own speed with it, and cloth
                    // lying on the body grips it (a robe stays on a raised thigh rather than sliding off the knee).
                    for (let c = 0; c < 3; c++) { const d = push[c] - x[o + c]; x[o + c] = push[c]; prev[o + c] += d * CARRY; prev[o + c] += (x[o + c] - prev[o + c]) * GRIP; }
                }
            }
            if (sim.shell && sim.shell.push(x[o], x[o + 1], x[o + 2], gap, push)) for (let c = 0; c < 3; c++) { const d = push[c] - x[o + c]; x[o + c] = push[c]; prev[o + c] += d * CARRY; }
        }
        // A link through a limb pushed out at its deepest point; a limb holding the link's upper end (its pin) is left to it.
        for (const L of [sim.links.down, sim.links.across]) for (let e = 0; e < L.length; e += 3) {
            const i = L[e], j = L[e + 1], a = i * 3, b = j * 3;
            let held = 0;
            for (let k = 0; k < m && !inv[i]; k++) if (insideAt(C, k, cols[k], gap, x[a], x[a + 1], x[a + 2], null) < 1) held |= 1 << k;
            for (const lam of [0.5, 0.25, 0.75]) {
                const px = x[a] + (x[b] - x[a]) * lam, py = x[a + 1] + (x[b + 1] - x[a + 1]) * lam, pz = x[a + 2] + (x[b + 2] - x[a + 2]) * lam;
                for (let k = 0; k < m; k++) {
                    if (held & (1 << k)) continue;
                    const at = k * 16, dx = px - C[at] - C[at + 3] * mids[k], dy = py - C[at + 1] - C[at + 4] * mids[k], dz = pz - C[at + 2] - C[at + 5] * mids[k];
                    if (dx * dx + dy * dy + dz * dz > reach[k]) continue;
                    if (insideAt(C, k, cols[k], gap, px, py, pz, push, null) >= 1) continue;
                    const wi = inv[i] * (1 - lam), wj = inv[j] * lam, ws = wi * (1 - lam) + wj * lam;
                    if (ws <= 0) continue;
                    const mx = push[0] - px, my = push[1] - py, mz = push[2] - pz;
                    x[a] += mx * wi / ws; x[a + 1] += my * wi / ws; x[a + 2] += mz * wi / ws;
                    x[b] += mx * wj / ws; x[b + 1] += my * wj / ws; x[b + 2] += mz * wj / ws;
                    prev[a] += mx * wi / ws * CARRY; prev[a + 1] += my * wi / ws * CARRY; prev[a + 2] += mz * wi / ws * CARRY;
                    prev[b] += mx * wj / ws * CARRY; prev[b + 1] += my * wj / ws * CARRY; prev[b + 2] += mz * wj / ws * CARRY;
                }
            }
        }
        const floor = sim.floor + gap;
        for (let i = 0; i < n; i++) {
            if (!inv[i]) continue;
            const o = i * 3;
            if (x[o + 1] < floor) {
                x[o + 1] = floor;
                // Cloth on the floor drags on it.
                prev[o] += (x[o] - prev[o]) * 0.6; prev[o + 2] += (x[o + 2] - prev[o + 2]) * 0.6;
                if (prev[o + 1] < floor) prev[o + 1] = floor;
            }
        }
    }

    /**
     * The chains laid out again row by row from the pins, every link at its
     * exact length (what the bones' turns can show), neighbors in a row kept
     * from drifting apart or together, each link turned out of the body and
     * off the floor about the point above it.
     */
    function project(sim, g) {
        const { x, C, cols, mids, reach } = sim, S = g.rows, K = g.chains, push = [0, 0, 0], from = [0, 0, 0], floor = sim.floor + sim.gap, m = cols.length, ra = g.rest;
        // Where each point was before the layout (outside the body): the side a link is sent out to.
        const ref = sim.ref || null;
        const near = (px, py, pz, k) => {
            const at = k * 16, dx = px - C[at] - C[at + 3] * mids[k], dy = py - C[at + 1] - C[at + 4] * mids[k], dz = pz - C[at + 2] - C[at + 5] * mids[k];
            return dx * dx + dy * dy + dz * dz <= reach[k];
        };
        const lengths = g._lengths || (g._lengths = (() => {
            const out = new Float32Array(K * S);
            for (let k = 0; k < K; k++) for (let j = 0; j < S; j++) { const a = (k * (S + 1) + j) * 3, b = a + 3; out[k * S + j] = Math.hypot(ra[b] - ra[a], ra[b + 1] - ra[a + 1], ra[b + 2] - ra[a + 2]); }
            return out;
        })());
        const relay = (k, j) => {
            const a = (k * (S + 1) + j) * 3, b = a + 3, L = lengths[k * S + j];
            const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
            x[b] = x[a] + dx / d * L; x[b + 1] = x[a + 1] + dy / d * L; x[b + 2] = x[a + 2] + dz / d * L;
        };
        const clear = (k, j) => {
            const a = (k * (S + 1) + j) * 3, b = a + 3, L = lengths[k * S + j];
            let dx = (x[b] - x[a]) / L, dy = (x[b + 1] - x[a + 1]) / L, dz = (x[b + 2] - x[a + 2]) / L;
            // A limb holding the pin is left to the link's lower end.
            let held = 0;
            if (j === 0) for (let c = 0; c < m; c++) if (insideAt(C, c, cols[c], sim.gap, x[a], x[a + 1], x[a + 2], null) < 1) held |= 1 << c;
            for (let pass = 0; pass < 4; pass++) {
                let turned = false;
                for (const lam of [0.34, 0.67, 1]) {
                    let px = x[a] + dx * L * lam, py = x[a + 1] + dy * L * lam, pz = x[a + 2] + dz * L * lam, hit = false;
                    if (ref) { from[0] = ref[a] + (ref[b] - ref[a]) * lam; from[1] = ref[a + 1] + (ref[b + 1] - ref[a + 1]) * lam; from[2] = ref[a + 2] + (ref[b + 2] - ref[a + 2]) * lam; }
                    for (let c = 0; c < m; c++) {
                        if ((held & (1 << c)) && lam < 1) continue;
                        if (!near(px, py, pz, c)) continue;
                        if (insideAt(C, c, cols[c], sim.gap, px, py, pz, push, ref ? from : null) < 1) { px = push[0]; py = Math.max(push[1], floor); pz = push[2]; hit = true; }
                    }
                    if (sim.shell && sim.shell.push(px, py, pz, sim.gap, push)) { px = push[0]; py = push[1]; pz = push[2]; hit = true; }
                    if (lam === 1 && py < floor) { py = floor; hit = true; }
                    if (hit) { dx = px - x[a]; dy = py - x[a + 1]; dz = pz - x[a + 2]; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9; dx /= d; dy /= d; dz /= d; turned = true; }
                }
                if (!turned) break;
            }
            x[b] = x[a] + dx * L; x[b + 1] = x[a + 1] + dy * L; x[b + 2] = x[a + 2] + dz * L;
        };
        const A = sim.links.across;
        for (let j = 0; j < S; j++) {
            for (let k = 0; k < K; k++) if (j < g.length[k]) relay(k, j);
            // The row's neighbors held near their rest spacing.
            for (let it = 0; it < 3; it++) {
                for (let e = 0; e < A.length; e += 3) {
                    const i = A[e], q = A[e + 1];
                    if (i % (S + 1) !== j + 1) continue;
                    const pa = i * 3, pb = q * 3, rest = A[e + 2];
                    const dx = x[pb] - x[pa], dy = x[pb + 1] - x[pa + 1], dz = x[pb + 2] - x[pa + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
                    const goal = d > rest * 1.06 ? rest * 1.06 : d < rest * 0.8 ? rest * 0.8 : d;
                    if (goal === d) continue;
                    const f = (d - goal) / d * 0.5;
                    x[pa] += dx * f; x[pa + 1] += dy * f; x[pa + 2] += dz * f;
                    x[pb] -= dx * f; x[pb + 1] -= dy * f; x[pb + 2] -= dz * f;
                }
                for (let k = 0; k < K; k++) if (j < g.length[k]) relay(k, j);
            }
            for (let k = 0; k < K; k++) if (j < g.length[k]) clear(k, j);
            // A limb between two neighbors of the row sends both out together, so it never parts them.
            for (let pass = 0; pass < 2; pass++) for (let e = 0; e < A.length; e += 3) {
                const i = A[e], q = A[e + 1];
                if (i % (S + 1) !== j + 1) continue;
                const pa = i * 3, pb = q * 3;
                for (const lam of [0.5, 0.25, 0.75]) {
                    const px = x[pa] + (x[pb] - x[pa]) * lam, py = x[pa + 1] + (x[pb + 1] - x[pa + 1]) * lam, pz = x[pa + 2] + (x[pb + 2] - x[pa + 2]) * lam;
                    let hit = false;
                    for (let c = 0; c < m && !hit; c++) {
                        if (!near(px, py, pz, c)) continue;
                        if (insideAt(C, c, cols[c], sim.gap, px, py, pz, push, null) < 1) hit = true;
                    }
                    if (!hit) continue;
                    const dx = push[0] - px, dy = Math.max(push[1], floor) - py, dz = push[2] - pz;
                    x[pa] += dx; x[pa + 1] += dy; x[pa + 2] += dz; x[pb] += dx; x[pb + 1] += dy; x[pb + 2] += dz;
                    relay(Math.floor(i / (S + 1)), j); relay(Math.floor(q / (S + 1)), j);
                    break;
                }
            }
        }
    }

    /**
     * A skirt already worked out, as a shell for cloth hanging over it (a
     * cape over a robe or a tunic): at each frame its chains' reach out from
     * the hips at each bearing and height, seen in the hips' own frame, and
     * the skirt's own thickness outside them. `set(f0, f1, k)` picks the
     * moment (frames of the clip, eased by k; before the first frame it is
     * off); `push(x, y, z, gap, out)` puts a point inside it on its surface
     * and says whether it did.
     */
    function shellOf(g, rec, poses, bones, points) {
        const S = g.rows, K = g.chains, head = bones[g.anchor].head, c = g.center, F = rec.length;
        const local = rec.map((X, f) => {
            const R = conj(poses[f].R[g.anchor]), P = poses[f].P[g.anchor], out = new Float32Array(X.length / 3 * 2);
            for (let i = 0; i < X.length / 3; i++) {
                const l = rotate(R, [X[i * 3] - P[0], X[i * 3 + 1] - P[1], X[i * 3 + 2] - P[2]]);
                out[i * 2] = Math.hypot(l[0] + head[0] - c[0], l[2] + head[2] - c[2]); out[i * 2 + 1] = l[1] + head[1];
            }
            return out;
        });
        let on = false, A = null, L0 = null, L1 = null, mix = 0;
        const chainAt = (k, y) => {
            const n = g.length[k];
            if (!n) return -1;
            const r = j => L0[(k * (S + 1) + j) * 2] * (1 - mix) + L1[(k * (S + 1) + j) * 2] * mix;
            const h = j => L0[(k * (S + 1) + j) * 2 + 1] * (1 - mix) + L1[(k * (S + 1) + j) * 2 + 1] * mix;
            if (y > h(0)) return -1;
            for (let j = 0; j < n; j++) {
                const ya = h(j), yb = h(j + 1);
                if (y <= ya && y >= Math.min(ya, yb) - 0.02) { const t = ya - yb > 1e-4 ? Math.max(0, Math.min(1, (ya - y) / (ya - yb))) : 1; return r(j) + (r(j + 1) - r(j)) * t; }
            }
            return -1;
        };
        // The skirt's own thickness outside its chains, measured at rest over its vertices (most of them, not a stray few).
        const rest = new Float32Array(g.rest.length / 3 * 2);
        for (let i = 0; i < rest.length / 2; i++) { rest[i * 2] = Math.hypot(g.rest[i * 3] - c[0], g.rest[i * 3 + 2] - c[2]); rest[i * 2 + 1] = g.rest[i * 3 + 1]; }
        L0 = L1 = rest; mix = 0;
        const out = [];
        for (let i = 0; i < points.length; i += 3) {
            const lx = points[i] - c[0], lz = points[i + 2] - c[2], a = ((Math.atan2(lx, lz) / g.step) % K + K) % K, k0 = Math.floor(a) % K, k1 = (k0 + 1) % K, fa = a - Math.floor(a);
            const r0 = chainAt(k0, points[i + 1]), r1 = chainAt(k1, points[i + 1]);
            if (r0 < 0 && r1 < 0) continue;
            out.push(Math.hypot(lx, lz) - (r0 < 0 ? r1 : r1 < 0 ? r0 : r0 + (r1 - r0) * fa));
        }
        out.sort((x, y) => x - y);
        const offset = Math.max(0.01, Math.min(0.08, (out.length ? out[Math.floor(out.length * 0.98)] : 0.02) + 0.015));
        return {
            offset,
            set(f0, f1, k) {
                on = f0 >= 0 && f1 >= 0 && f0 < F && f1 < F;
                if (!on) return;
                L0 = local[f0]; L1 = local[f1]; mix = k;
                const pa = poses[f0], pb = poses[f1];
                A = { R: nlerp(pa.R[g.anchor], pb.R[g.anchor], k), P: [0, 1, 2].map(i => pa.P[g.anchor][i] + (pb.P[g.anchor][i] - pa.P[g.anchor][i]) * k) };
                A.inv = conj(A.R);
            },
            push(x, y, z, gap, out) {
                if (!on) return false;
                const l = rotate(A.inv, [x - A.P[0], y - A.P[1], z - A.P[2]]), lx = l[0] + head[0] - c[0], ly = l[1] + head[1], lz = l[2] + head[2] - c[2];
                const rho = Math.hypot(lx, lz), a = ((Math.atan2(lx, lz) / g.step) % K + K) % K, k0 = Math.floor(a) % K, k1 = (k0 + 1) % K, fa = a - Math.floor(a);
                const r0 = chainAt(k0, ly), r1 = chainAt(k1, ly);
                if (r0 < 0 && r1 < 0) return false;
                const R = (r0 < 0 ? r1 : r1 < 0 ? r0 : r0 + (r1 - r0) * fa) + offset + gap;
                if (rho >= R) return false;
                const kx = rho > 1e-6 ? lx / rho : 0, kz = rho > 1e-6 ? lz / rho : -1;
                const back = rotate(A.R, [c[0] + kx * R - head[0], ly - head[1], c[2] + kz * R - head[2]]);
                out[0] = A.P[0] + back[0]; out[1] = A.P[1] + back[1]; out[2] = A.P[2] + back[2];
                return true;
            }
        };
    }

    /** A skirt region's vertices at rest, x y z in a row. */
    function skirtPoints(result, g) {
        if (g._points) return g._points;
        const out = [];
        for (const [pi, v] of g.verts) { const P = result.parts[pi].positions; out.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); }
        return (g._points = out);
    }

    // ── baking ────────────────────────────────────────────────────────────
    const bakes = new Map();
    function clipKey(clip) {
        let h = clip.times.length * 131 + Math.round((clip.times[clip.times.length - 1] || 0) * 1000);
        for (const t of clip.tracks) { if (t.cloth) continue; h = (h * 31 + t.bone) | 0; const v = t.values; for (let i = 0; i < v.length; i += 3) h = (h * 31 + Math.round(v[i] * 1e4)) | 0; }
        if (clip.heights) for (let i = 0; i < clip.heights.length; i += 2) h = (h * 31 + Math.round(clip.heights[i] * 1e3)) | 0;
        return (clip.name || '') + ':' + (h >>> 0);
    }

    /** Whether a clip ends in the pose it starts in (within `tolerance` radians on every track). */
    function loops(clip, tolerance) {
        const last = clip.times.length - 1;
        if (last < 2) return true;
        for (const t of clip.tracks) {
            if (t.cloth) continue;
            const v = t.values;
            if (t.path === 'translation') { const n = (t.times || clip.times).length - 1; if (Math.hypot(v[0] - v[n * 3], v[1] - v[n * 3 + 1], v[2] - v[n * 3 + 2]) > 0.05) return false; continue; }
            const n = (t.times || clip.times).length - 1, d = Math.abs(v[0] * v[n * 4] + v[1] * v[n * 4 + 1] + v[2] * v[n * 4 + 2] + v[3] * v[n * 4 + 3]);
            if (2 * Math.acos(Math.min(1, d)) > tolerance) return false;
        }
        if (clip.heights && Math.abs(clip.heights[0] - clip.heights[clip.heights.length - 1]) > 0.04) return false;
        return true;
    }

    /** The floor under the model at each frame: the clip's own lift taken off, a pose resting on the body set on its lowest skin. */
    function floors(result, clip, times, poses) {
        const out = new Float32Array(times.length);
        if (!clip.heights) return out;
        const period = clip.times[clip.times.length - 1] || 1, fps = (clip.heights.length - 1) / period;
        const lift = t => { const x = Math.max(0, Math.min(clip.heights.length - 1, t * fps)), i = Math.floor(x), k = x - i; return clip.heights[i] + ((clip.heights[Math.min(clip.heights.length - 1, i + 1)] - clip.heights[i]) * k); };
        let low = 0;
        if (clip.skin) {
            const body = result.parts.find(p => p.name === 'Body');
            const sample = [];
            if (body) for (let v = 0; v < body.positions.length / 3; v += 7) sample.push(v);
            low = Infinity;
            for (let f = 0; f < times.length; f += Math.max(1, Math.floor(times.length / 12))) {
                const s = skin(body, result.bones, poses[f], sample);
                let m = Infinity;
                for (let i = 1; i < s.length; i += 3) m = Math.min(m, s[i]);
                low = Math.min(low, m + lift(times[f]));
            }
            if (!isFinite(low)) low = 0;
        }
        for (let f = 0; f < times.length; f++) out[f] = low - lift(times[f]);
        return out;
    }

    /**
     * The clip with its cloth: the cloth bones' keys added (a clip already
     * baked for this rig comes back as it is). Null without a rig.
     */
    function bake(result, clip, options) {
        const cloth = result && result.cloth;
        if (!cloth || !clip || !clip.times || clip.times.length < 2) return clip;
        if (clip.cloth === cloth.key) return clip;
        const quality = QUALITY[(options && options.quality) || 'save'] || QUALITY.save;
        const key = cloth.key + '|' + clipKey(clip) + '|' + ((options && options.quality) || 'save');
        let tracks = bakes.get(key);
        if (!tracks) {
            tracks = simulateClip(result, clip, quality);
            bakes.set(key, tracks);
            if (bakes.size > 48) bakes.delete(bakes.keys().next().value);
        }
        const keep = clip.tracks.filter(t => !t.cloth && !(result.bones[t.bone] && result.bones[t.bone].cloth));
        return Object.assign({}, clip, { tracks: keep.concat(tracks), cloth: cloth.key });
    }

    function bakeAll(result, clips, options) { return (clips || []).map(c => bake(result, c, options)); }

    /** bakeAll, letting the page draw between clips (a save with many clips stays responsive). */
    async function bakeAllAsync(result, clips, options) {
        const out = [];
        for (const c of clips || []) { out.push(bake(result, c, options)); await new Promise(done => setTimeout(done, 0)); }
        return out;
    }

    function simulateClip(result, clip, quality) {
        const cloth = result.cloth, bones = result.bones;
        const duration = clip.times[clip.times.length - 1];
        // The frames the cloth is worked out at: the clip's own when they come often and evenly, else 30 a second.
        const own = clip.times, even = own.length > 2 && own.every((t, i) => i === 0 || Math.abs((t - own[i - 1]) - duration / (own.length - 1)) < 1e-4);
        const useOwn = even && duration / (own.length - 1) <= 1 / 24 + 1e-6;
        const F = useOwn ? own.length : Math.max(2, Math.round(duration * LIMITS.fps) + 1);
        const times = useOwn ? Float32Array.from(own) : Float32Array.from({ length: F }, (_, i) => duration * i / (F - 1));
        const clipPoses = Array.from(times, t => pose(bones, clip, t));
        const clipFloor = floors(result, clip, times, clipPoses);
        // A lead-in: the body eased from its rest pose into the first frame, so a sitting body's thighs lift the
        // skirt over them rather than rising through it.
        const cyclic = loops(clip, 0.35);
        // A loop is warmed up over its last second, so its first frame starts from the motion that leads into it.
        const start = cyclic ? Math.max(0, F - 1 - Math.round(1 / (duration / (F - 1)))) : 0;
        const LEAD = quality.lead;
        // The limbs come first and the floor after, as a body sits down: knees up, then the seat to the floor.
        const lead = Array.from({ length: LEAD }, (_, i) => i / LEAD);
        const poses = lead.map(k => poseShare(bones, clip, times[start], smoothstep(0, 0.7, k))).concat(clipPoses);
        const floor = Float32Array.from(lead.map(k => clipFloor[start] * smoothstep(0.45, 1, k)).concat(Array.from(clipFloor)));
        // Each set of colliders placed once per frame.
        const sets = new Map();
        const setOf = list => {
            if (!sets.has(list)) sets.set(list, Object.assign({ Cf: poses.map(ps => { const C = new Float32Array(list.length * 16); list.forEach((c, i) => placeCollider(c, ps, C, i)); return C; }) }, reaches(list)));
            return sets.get(list);
        };
        const out = [];
        // Each region on its own, skirt first, against its own colliders.
        const states = cloth.regions.map(g => {
            const S = g.rows, n = g.chains * (S + 1), inv = new Float32Array(n);
            for (let k = 0; k < g.chains; k++) for (let j = 1; j <= g.length[k]; j++) inv[k * (S + 1) + j] = 1;
            return { g, n, inv };
        });
        const dt = duration / (F - 1);
        const sub = quality.substeps, h = dt / sub;
        for (const st of states) {
            const g = st.g, n = st.n, cols = g.colliders || cloth.colliders, m = cols.length, { Cf, reach, mids } = setOf(cols);
            const placeRest = (A, into) => { for (let i = 0; i < n; i++) { const o = i * 3, r = rotate(A.R, [g.rest[o] - A.h[0], g.rest[o + 1] - A.h[1], g.rest[o + 2] - A.h[2]]); into[o] = A.P[0] + r[0]; into[o + 1] = A.P[1] + r[1]; into[o + 2] = A.P[2] + r[2]; } };
            const x = new Float32Array(n * 3), prev = new Float32Array(n * 3), target = new Float32Array(n * 3);
            const C = new Float32Array(m * 16);
            // A cape keeps outside a skirt worked out before it.
            const shell = g.kind === 'cape' ? (states.find(o => o.g.kind === 'skirt' && o.rec) || {}).shell || null : null;
            const sim = { x, prev, inv: st.inv, n, links: g.links, C, cols, reach, mids, gap: g.gap, drag: g.drag, stiff: g.stiff, target, floor: 0, shell };
            x.set(g.rest); prev.set(x);
            // Between two frames: the body's capsules, the anchor and the floor eased from one to the next.
            // Frame numbers count from the clip's first frame; the lead-in's run below zero.
            const at = (f0, f1, k) => {
                if (sim.shell) sim.shell.set(f0, f1, k);
                f0 += LEAD; f1 += LEAD;
                const a = Cf[f0], b = Cf[f1];
                for (let i = 0; i < C.length; i++) C[i] = a[i] + (b[i] - a[i]) * k;
                sim.floor = floor[f0] + (floor[f1] - floor[f0]) * k;
                const pa = poses[f0], pb = poses[f1];
                const A = { R: nlerp(pa.R[g.anchor], pb.R[g.anchor], k), P: [0, 1, 2].map(c => pa.P[g.anchor][c] + (pb.P[g.anchor][c] - pa.P[g.anchor][c]) * k), h: bones[g.anchor].head };
                placeRest(A, target);
                for (let i = 0; i < n; i++) if (!st.inv[i]) { const o = i * 3; x[o] = target[o]; x[o + 1] = target[o + 1]; x[o + 2] = target[o + 2]; prev[o] = x[o]; prev[o + 1] = x[o + 1]; prev[o + 2] = x[o + 2]; }
            };
            // A skirt starts carried by the body as the garment was (over the thighs of a body already sitting); a cape is
            // eased in from rest. Then settled, and (a loop) its last second played to warm it up.
            if (g.startSkin) {
                const ps = clipPoses[start], v = [0, 0, 0];
                for (let i = 0; i < n; i++) {
                    const sk = g.startSkin[i];
                    if (!sk) continue;
                    let px = 0, py = 0, pz = 0;
                    for (let q = 0; q < 4; q++) {
                        const w = sk[1][q], b = sk[0][q];
                        if (!w) continue;
                        const hd = bones[b].head;
                        v[0] = g.rest[i * 3] - hd[0]; v[1] = g.rest[i * 3 + 1] - hd[1]; v[2] = g.rest[i * 3 + 2] - hd[2];
                        const o = rotate(ps.R[b], v);
                        px += w * (o[0] + ps.P[b][0]); py += w * (o[1] + ps.P[b][1]); pz += w * (o[2] + ps.P[b][2]);
                    }
                    x[i * 3] = px; x[i * 3 + 1] = py; x[i * 3 + 2] = pz;
                }
                at(start, start, 0);
                prev.set(x);
                project(sim, g);
                prev.set(x);
            } else for (let i = 1 - LEAD; i <= 0; i++) {
                const to = i === 0 ? start : i;
                for (let s = 1; s <= 2; s++) { at(i - 1, to, s / 2); step(sim, 1 / 60, quality.iterations); }
            }
            at(start, start, 0);
            for (let s = 0; s < quality.settle; s++) step(sim, 1 / 60, quality.iterations);
            const advance = (f0, f1) => { for (let s = 1; s <= sub; s++) { at(f0, f1, s / sub); step(sim, h, quality.iterations); } };
            if (cyclic) for (let f = start + 1; f < F; f++) advance(f - 1, f);
            const rec = Array.from({ length: F }, () => new Float32Array(n * 3));
            const keep = new Float32Array(n * 3);
            const record = f => { keep.set(x); sim.ref = keep; project(sim, g); sim.ref = null; rec[f].set(x); x.set(keep); };
            at(0, 0, 0); record(0);
            for (let f = 1; f < F; f++) { advance(f - 1, f); record(f); }
            // A loop ends where it starts: the drift over the round taken off evenly.
            if (cyclic) {
                const drift = new Float32Array(n * 3);
                for (let i = 0; i < n * 3; i++) drift[i] = rec[F - 1][i] - rec[0][i];
                for (let f = 1; f < F; f++) {
                    const k = f / (F - 1), r = rec[f];
                    for (let i = 0; i < n * 3; i++) r[i] -= drift[i] * k;
                    at(f, f, 0); x.set(r); project(sim, g); r.set(x);
                }
                rec[F - 1].set(rec[0]);
            }
            fixFrames(result, g, rec, clipPoses, Cf.slice(LEAD), clipFloor, sim, at, quality.fix, quality.stride || 1);
            if (cyclic && loops(clip, 0.02)) rec[F - 1].set(rec[0]);
            st.rec = rec;
            if (g.kind === 'skirt') st.shell = shellOf(g, rec, clipPoses, bones, skirtPoints(result, g));
            out.push(...tracksOf(g, rec, clipPoses, bones, times, useOwn));
        }
        return out;
    }

    /** Each cloth bone's rest frame (its line down the chain and across it), as the turn undoing it. */
    function restTurns(g) {
        if (g._restTurns) return g._restTurns;
        const S = g.rows, out = new Array(g.chains * S).fill(null), A = new Array(g.chains * S).fill(null);
        for (let k = 0; k < g.chains; k++) for (let j = 0; j < g.length[k]; j++) {
            const d0 = segment(g, g.rest, k, j), a0 = acrossAt(g, g.rest, k, j) || [1, 0, 0];
            out[k * S + j] = conj(frameQuat(d0, a0)); A[k * S + j] = a0;
        }
        return (g._restTurns = { inverse: out, across: A });
    }
    const pointOf = (g, k, j) => (k * (g.rows + 1) + j) * 3;
    function segment(g, X, k, j) { const a = pointOf(g, k, j), b = pointOf(g, k, j + 1); return [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]]; }
    /** Across a chain's link: the mean of across its head's row and its tail's, so the link twists as both rows do. */
    function acrossAt(g, X, k, j) {
        const a = acrossRow(g, X, k, j), b = j + 1 <= g.length[k] ? acrossRow(g, X, k, j + 1) : null;
        if (!a || !b) return a || b;
        const la = Math.hypot(a[0], a[1], a[2]) || 1, lb = Math.hypot(b[0], b[1], b[2]) || 1;
        return [a[0] / la + b[0] / lb, a[1] / la + b[1] / lb, a[2] / la + b[2] / lb];
    }
    /** Across a chain at a row: from the chain on one side to the chain on the other (or to itself at an edge). */
    function acrossRow(g, X, k, j) {
        const K = g.chains;
        const kl = g.ring ? (k + K - 1) % K : Math.max(0, k - 1), kr = g.ring ? (k + 1) % K : Math.min(K - 1, k + 1);
        const l = j <= g.length[kl] ? kl : k, r = j <= g.length[kr] ? kr : k;
        if (l === r) return null;
        const a = pointOf(g, l, j), b = pointOf(g, r, j);
        return [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]];
    }
    /** The cloth bones' turns in the model that lay each chain through the points X. */
    function chainTurns(g, X, anchorTurn) {
        const S = g.rows, rt = restTurns(g), out = new Array(g.chains * S).fill(null);
        for (let k = 0; k < g.chains; k++) for (let j = 0; j < g.length[k]; j++) {
            const a = acrossAt(g, X, k, j) || rotate(anchorTurn, rt.across[k * S + j]);
            out[k * S + j] = qmul(frameQuat(segment(g, X, k, j), a), rt.inverse[k * S + j]);
        }
        return out;
    }

    /**
     * The skin of every vertex the cloth bones move, for checking a frame
     * against the body: rest position, and per influence the bone, its
     * weight, the bone's chain slot and how far down the bone the vertex
     * lies (0 at its head, 1 at its tail).
     */
    function boundVerts(result, g) {
        if (g._bound) return g._bound;
        const bones = result.bones, slotOf = new Map();
        for (let i = 0; i < g.boneIds.length; i++) if (g.boneIds[i] >= 0) slotOf.set(g.boneIds[i], i);
        const list = g.kind === 'cape' ? Array.from(g.sheet, v => [g.part, v]) : g.verts;
        const out = [];
        for (const [pi, v] of list) {
            const p = result.parts[pi], infl = [];
            let cloth = 0;
            for (let q = 0; q < 4; q++) {
                const w = p.weights[v * 4 + q], b = p.joints[v * 4 + q];
                if (w <= 0) continue;
                const slot = slotOf.has(b) ? slotOf.get(b) : -1;
                let lam = 0;
                if (slot >= 0) {
                    cloth += w;
                    const h = bones[b].head, t = bones[b].tail, d = sub(t, h), l2 = dot(d, d) || 1;
                    lam = Math.max(0, Math.min(1, ((p.positions[v * 3] - h[0]) * d[0] + (p.positions[v * 3 + 1] - h[1]) * d[1] + (p.positions[v * 3 + 2] - h[2]) * d[2]) / l2));
                }
                infl.push([b, w, slot, lam]);
            }
            if (cloth > 0.3) out.push({ x: [p.positions[v * 3], p.positions[v * 3 + 1], p.positions[v * 3 + 2]], infl });
        }
        return (g._bound = out);
    }

    /**
     * Frames checked vertex by vertex: wherever the skinned cloth (between
     * its points) still dips into the body or below the floor, the points of the bones that
     * carry it are moved out by what each contributes, the chains laid out
     * again, and the frame checked once more.
     */
    function fixFrames(result, g, rec, poses, Cf, floors, sim, at, passes, stride) {
        const bones = result.bones, bound = boundVerts(result, g), S = g.rows, cols = sim.cols, m = cols.length, x = sim.x;
        const push = [0, 0, 0], n = rec[0].length / 3, want = new Float32Array(n * 3), most = new Float32Array(n);
        const step = Math.max(1, stride | 0);
        // Each vertex where it was the frame before: the side it is sent back out to.
        const before = new Float32Array(bound.length * 3), now = new Float32Array(bound.length * 3), from = [0, 0, 0];
        const best = new Float32Array(rec[0].length);
        for (let f = 0; f < rec.length; f++) {
            // The frame as it checks best is kept: a move out of one limb can push the cloth into another.
            let fewest = Infinity;
            for (let pass = 0; pass <= passes; pass++) {
                const X = rec[f], ps = poses[f], turns = chainTurns(g, X, ps.R[g.anchor]);
                sim.C = Cf[f];
                if (sim.shell) sim.shell.set(f, f, 0);
                want.fill(0); most.fill(0);
                let bad = 0;
                for (let i = 0; i < bound.length; i += step) {
                    const B = bound[i];
                    let px = 0, py = 0, pz = 0;
                    for (const [b, w, slot] of B.infl) {
                        const h = bones[b].head, d = [B.x[0] - h[0], B.x[1] - h[1], B.x[2] - h[2]];
                        let o, P;
                        if (slot >= 0) { o = rotate(turns[slot], d); const a = pointOf(g, Math.floor(slot / S), slot % S); P = [X[a], X[a + 1], X[a + 2]]; }
                        else { o = rotate(ps.R[b], d); P = ps.P[b]; }
                        px += w * (o[0] + P[0]); py += w * (o[1] + P[1]); pz += w * (o[2] + P[2]);
                    }
                    let dx = 0, dy = 0, dz = 0, hit = false;
                    if (f > 0) { from[0] = before[i * 3]; from[1] = before[i * 3 + 1]; from[2] = before[i * 3 + 2]; }
                    for (let c = 0; c < m; c++) {
                        const atc = c * 16, mx = px + dx - sim.C[atc] - sim.C[atc + 3] * sim.mids[c], my = py + dy - sim.C[atc + 1] - sim.C[atc + 4] * sim.mids[c], mz = pz + dz - sim.C[atc + 2] - sim.C[atc + 5] * sim.mids[c];
                        if (mx * mx + my * my + mz * mz > sim.reach[c]) continue;
                        if (py + dy < floors[f] + 0.035) break;
                        if (insideAt(sim.C, c, cols[c], sim.gap * 0.6, px + dx, py + dy, pz + dz, push, f > 0 ? from : null) < 1) { dx = push[0] - px; dy = push[1] - py; dz = push[2] - pz; hit = true; }
                    }
                    if (sim.shell && sim.shell.push(px + dx, py + dy, pz + dz, sim.gap * 0.6, push)) { dx = push[0] - px; dy = push[1] - py; dz = push[2] - pz; hit = true; }
                    if (py + dy < floors[f] + sim.gap * 0.5) { dy = floors[f] + sim.gap * 0.5 - py; hit = true; }
                    now[i * 3] = px + dx; now[i * 3 + 1] = py + dy; now[i * 3 + 2] = pz + dz;
                    if (!hit) continue;
                    bad++;
                    // Each carrying bone's head and tail take the share of the move its weight and place along it ask for.
                    for (const [, w, slot, lam] of B.infl) {
                        if (slot < 0) continue;
                        const k = Math.floor(slot / S), j = slot % S, head = k * (S + 1) + j, norm = lam * lam + (1 - lam) * (1 - lam);
                        // Under a held head the whole move falls to the tail, which carries the point by its share along.
                        const pinned = !sim.inv[head];
                        for (const [pt, share] of [[head + 1, pinned ? 1 / Math.max(lam, 0.15) : lam / norm], [head, (1 - lam) / norm]]) {
                            if (!sim.inv[pt] || share <= 0) continue;
                            const kk = w * share, mag = Math.hypot(dx, dy, dz) * kk;
                            if (mag > most[pt]) { most[pt] = mag; want[pt * 3] = dx * kk; want[pt * 3 + 1] = dy * kk; want[pt * 3 + 2] = dz * kk; }
                        }
                    }
                }
                if (bad < fewest) { fewest = bad; best.set(X); }
                if (!bad || pass === passes) break;
                at(f, f, 0);
                for (let i = 0; i < n * 3; i++) x[i] = sim.inv[Math.floor(i / 3)] ? X[i] + want[i] * (1.2 + pass * 0.15) : x[i];
                project(sim, g);
                X.set(x);
            }
            if (fewest < Infinity) rec[f].set(best);
            before.set(now);
        }
    }

    /**
     * A cloth bone that hardly moves over the clip (within `error` radians
     * of its first key) keeps two keys, sharing `ends` (the clip's first and
     * last time); the rest keep every frame, on the clip's own times
     * (`times` null) or on `times`.
     */
    function keysOf(times, values, error, ends) {
        const lim = Math.cos(error / 2);
        for (let i = 1; i < values.length / 4; i++) {
            if (Math.abs(values[0] * values[i * 4] + values[1] * values[i * 4 + 1] + values[2] * values[i * 4 + 2] + values[3] * values[i * 4 + 3]) < lim) return times ? { times, values } : { values };
        }
        const v = new Float32Array(8);
        v.set(values.subarray(0, 4), 0); v.set(values.subarray(0, 4), 4);
        return { times: ends, values: v };
    }

    /** The cloth bones' turns that put each chain through its points, frame by frame, each from its parent's. */
    function tracksOf(g, rec, poses, bones, times, own) {
        const S = g.rows, F = rec.length, ends = Float32Array.of(times[0], times[F - 1]);
        const turns = rec.map((X, f) => chainTurns(g, X, poses[f].R[g.anchor]));
        const tracks = [];
        for (let k = 0; k < g.chains; k++) for (let j = 0; j < g.length[k]; j++) {
            const id = g.boneIds[k * S + j];
            if (id < 0) continue;
            const values = new Float32Array(F * 4);
            let last = null;
            for (let f = 0; f < F; f++) {
                const pw = j === 0 ? poses[f].R[g.anchor] : turns[f][k * S + j - 1];
                let q = qmul(conj(pw), turns[f][k * S + j]);
                const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
                q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
                if (last && q[0] * last[0] + q[1] * last[1] + q[2] * last[2] + q[3] * last[3] < 0) q = q.map(v => -v);
                values.set(q, f * 4);
                last = q;
            }
            tracks.push(Object.assign({ bone: id, cloth: true }, keysOf(own ? null : times, values, LIMITS.keyError, ends)));
        }
        return tracks;
    }

    const api = { LIMITS, QUALITY, COLLIDERS, rig, bake, bakeAll, bakeAllAsync, colliders, collidersAt, pose, skin, inside, loops, floors, frameQuat };
    root.RRCharacterCloth = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

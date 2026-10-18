/**
 * RRCharacterProps - accessories built to fit the shaped body: glasses and
 * other eyewear, hats and helmets, jewelry, capes, scarves and things worn
 * on the back.
 *
 * Each accessory is generated from landmarks measured on the body as it is
 * shaped now (the eyes, the head's cross-section at the brow, the ears, the
 * neck, the shoulders), so a monocle sits on any eye and a crown on any
 * head. Rigid accessories ride on one bone; a cape, a scarf or a necklace
 * blends down the spine.
 */
(function(root) {
    'use strict';

    const Body = root.RRHumanBody || (typeof require === 'function' ? require('./HumanBody.js') : null);
    const Outfit = root.RRCharacterOutfit || (typeof require === 'function' ? require('./CharacterOutfit.js') : null);
    const linear = hex => Outfit.linear(hex);

    // ── vectors ───────────────────────────────────────────────────────────
    const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    /** Geometry with vertex colors and per-vertex skin. */
    class Mesh {
        constructor() { this.p = []; this.n = []; this.c = []; this.j = []; this.w = []; this.i = []; }
        vertex(pos, nrm, rgb, skin) {
            const k = this.p.length / 3;
            this.p.push(pos[0], pos[1], pos[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(rgb[0], rgb[1], rgb[2]);
            const s = typeof skin === 'function' ? skin(pos) : skin;
            for (let q = 0; q < 4; q++) { this.j.push(s.joints[q] || 0); this.w.push(s.weights[q] || 0); }
            return k;
        }
        tri(a, b, c) { this.i.push(a, b, c); }
        /**
         * Rings swept along a path: `ring(i, t)` gives {center, x, y, rx, ry}
         * (axes of the ring's plane and its radii) and an optional `cup`, which
         * bows the ring back along -y by that share of rx (a hollow front).
         * Caps close the ends.
         */
        loft(count, ring, sides, rgb, skin, caps) {
            const rows = [];
            for (let r = 0; r < count; r++) {
                const t = count > 1 ? r / (count - 1) : 0;
                const R = ring(r, t);
                const row = [];
                for (let k = 0; k < sides; k++) {
                    const a = k / sides * Math.PI * 2;
                    const bend = R.cup ? R.cup * R.rx * (1 - Math.cos(a) * Math.cos(a)) : 0;
                    const off = add(mul(R.x, Math.cos(a) * R.rx), mul(R.y, Math.sin(a) * R.ry - bend));
                    const pos = add(R.center, off);
                    const color = typeof rgb === 'function' ? rgb(t, a, pos) : rgb;
                    row.push(this.vertex(pos, norm(off), color, skin));
                }
                rows.push({ row, R });
            }
            for (let r = 0; r + 1 < rows.length; r++) for (let k = 0; k < sides; k++) {
                const a = rows[r].row[k], b = rows[r].row[(k + 1) % sides], c = rows[r + 1].row[k], d = rows[r + 1].row[(k + 1) % sides];
                this.tri(a, c, b); this.tri(b, c, d);
            }
            if (caps) for (const [end, flip] of [[rows[0], true], [rows[rows.length - 1], false]]) {
                const R = end.R, axis = norm(cross(R.x, R.y));
                const color = typeof rgb === 'function' ? rgb(flip ? 0 : 1, 0, R.center) : rgb;
                const center = this.vertex(R.center, flip ? mul(axis, -1) : axis, color, skin);
                for (let k = 0; k < sides; k++) {
                    const a = end.row[k], b = end.row[(k + 1) % sides];
                    if (flip) this.tri(center, b, a); else this.tri(center, a, b);
                }
            }
            this.computeNormals();
            return rows;
        }
        /** A tube through points with radii (number or per-point array). */
        tube(points, radii, sides, rgb, skin, caps = true) {
            const n = points.length;
            let prevX = null;
            return this.loft(n, i => {
                const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
                const d = norm(sub(b, a));
                let x = prevX ? norm(sub(prevX, mul(d, dot(prevX, d)))) : norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
                prevX = x;
                const y = cross(d, x);
                const r = Array.isArray(radii) ? radii[i] : typeof radii === 'function' ? radii(i / (n - 1)) : radii;
                return { center: points[i], x, y, rx: r, ry: r };
            }, sides, rgb, skin, caps);
        }
        sphere(center, r, rgb, skin, rows = 8, sides = 12, squash = [1, 1, 1]) {
            return this.loft(rows + 1, (i, t) => {
                const phi = -Math.PI / 2 + t * Math.PI;
                const rr = Math.cos(phi) * r;
                return { center: add(center, [0, Math.sin(phi) * r * squash[1], 0]), x: [1, 0, 0], y: [0, 0, -1], rx: Math.max(1e-5, rr * squash[0]), ry: Math.max(1e-5, rr * squash[2]) };
            }, sides, rgb, skin, false);
        }
        disk(center, normal, r, rgb, skin, sides = 24, ry) {
            const x = norm(cross(normal, Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), y = cross(normal, x);
            const c = this.vertex(center, normal, rgb, skin);
            const ring = [];
            for (let k = 0; k < sides; k++) {
                const a = k / sides * Math.PI * 2;
                ring.push(this.vertex(add(center, add(mul(x, Math.cos(a) * r), mul(y, Math.sin(a) * (ry || r)))), normal, rgb, skin));
            }
            for (let k = 0; k < sides; k++) this.tri(c, ring[k], ring[(k + 1) % sides]);
        }
        box(center, axes, half, rgb, skin) {
            const [X, Y, Z] = axes;
            const corner = (sx, sy, sz) => add(center, add(add(mul(X, sx * half[0]), mul(Y, sy * half[1])), mul(Z, sz * half[2])));
            const faces = [[X, [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [mul(X, -1), [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
                [Y, [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [mul(Y, -1), [-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
                [Z, [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [mul(Z, -1), [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]];
            for (const [n, ...cs] of faces) {
                const ids = cs.map(s => this.vertex(corner(...s), n, rgb, skin));
                this.tri(ids[0], ids[1], ids[2]); this.tri(ids[0], ids[2], ids[3]);
            }
        }
        computeNormals() {
            const P = this.p, N = new Float32Array(P.length);
            for (let t = 0; t < this.i.length; t += 3) {
                const a = this.i[t] * 3, b = this.i[t + 1] * 3, c = this.i[t + 2] * 3;
                const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
                const n = cross(u, v);
                for (const s of [a, b, c]) { N[s] += n[0]; N[s + 1] += n[1]; N[s + 2] += n[2]; }
            }
            for (let k = 0; k < N.length; k += 3) { const l = Math.hypot(N[k], N[k + 1], N[k + 2]); if (l > 0) { this.n[k] = N[k] / l; this.n[k + 1] = N[k + 1] / l; this.n[k + 2] = N[k + 2] / l; } }
        }
        part(name, extra) {
            return Object.assign({ name, positions: Float32Array.from(this.p), normals: Float32Array.from(this.n), colors: Float32Array.from(this.c),
                joints: Uint8Array.from(this.j), weights: Float32Array.from(this.w), index: Uint32Array.from(this.i) }, extra);
        }
        get empty() { return !this.i.length; }
    }

    // ── landmarks ─────────────────────────────────────────────────────────
    /**
     * Where things are on a built body: eyes, head cross-sections, ears,
     * nose, mouth, chin, neck, shoulders, wrists, waist. All in the body's
     * frame as built (floor at 0, facing +z).
     */
    function landmarks(pack, built) {
        const P = built.shaped;
        const bone = name => built.bones.find(b => b.name === name);
        const boneIndex = name => built.bones.findIndex(b => b.name === name);
        const eyes = built.parts.find(p => p.name === 'Eyes').positions;
        const eye = side => {
            let c = [0, 0, 0], n = 0, mn = Infinity, mx = -Infinity;
            for (let i = 0; i < eyes.length; i += 3) if ((eyes[i] > 0) === (side > 0)) { c = add(c, [eyes[i], eyes[i + 1], eyes[i + 2]]); n++; mn = Math.min(mn, eyes[i]); mx = Math.max(mx, eyes[i]); }
            return { center: mul(c, 1 / n), radius: (mx - mn) / 2 };
        };
        const eyeL = eye(1), eyeR = eye(-1);
        const an = Outfit.anatomy(pack);
        const ids = pack._bodyIds || (pack._bodyIds = [...new Set(pack.body.source)]);
        const headIds = ids.filter(v => an.member[v * 5] > 0.6 && an.s[v * 5] > 4.3);
        let crown = 0, noseTip = null, chin = Infinity;
        for (const v of headIds) {
            const y = P[v * 3 + 1];
            if (y > crown) crown = y;
            if (!noseTip || P[v * 3 + 2] > noseTip[2]) noseTip = [P[v * 3], y, P[v * 3 + 2]];
        }
        /** The head's cross-section about a height: center, half width and half depth (and front/back). */
        const ring = (y, band = 0.012) => {
            let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
            for (const v of headIds) {
                if (Math.abs(P[v * 3 + 1] - y) > band) continue;
                // The ears stick out of the section: leave them to the ears.
                if (earSet.has(v)) continue;
                mnx = Math.min(mnx, P[v * 3]); mxx = Math.max(mxx, P[v * 3]); mnz = Math.min(mnz, P[v * 3 + 2]); mxz = Math.max(mxz, P[v * 3 + 2]);
            }
            if (!isFinite(mnx)) return null;
            return { center: [(mnx + mxx) / 2, y, (mnz + mxz) / 2], rx: (mxx - mnx) / 2, rz: (mxz - mnz) / 2, front: mxz, back: mnz };
        };
        const earTarget = pack.targets.get('shape/earSize-incr');
        const earSet = new Set(earTarget ? earTarget.index : []);
        const ear = side => {
            let c = [0, 0, 0], n = 0, low = null, out = null;
            for (const v of earSet) {
                const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
                if ((p[0] > 0) !== (side > 0)) continue;
                c = add(c, p); n++;
                if (!low || p[1] < low[1]) low = p;
                if (!out || Math.abs(p[0]) > Math.abs(out[0])) out = p;
            }
            return n ? { center: mul(c, 1 / n), lobe: low, outer: out } : null;
        };
        const teeth = pack.helpers.upperTeeth;
        let mouth = [0, 0, 0];
        for (const v of teeth.source) mouth = add(mouth, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
        mouth = mul(mouth, 1 / teeth.source.length);
        for (const v of headIds) if (P[v * 3 + 2] > mouth[2] - 0.01 && Math.abs(P[v * 3]) < 0.02) chin = Math.min(chin, P[v * 3 + 1]);
        const eyeY = (eyeL.center[1] + eyeR.center[1]) / 2;
        const brow = eyeY + (eyeL.radius + eyeR.radius) * 1.3;
        // The neck at its base: a ring over the skin of the lower neck.
        const neckIds = ids.filter(v => an.member[v * 5] > 0.8 && Math.abs(an.s[v * 5] - 4.05) < 0.08);
        let nmin = [Infinity, 0, Infinity], nmax = [-Infinity, 0, -Infinity], ny = 0;
        for (const v of neckIds) { nmin[0] = Math.min(nmin[0], P[v * 3]); nmax[0] = Math.max(nmax[0], P[v * 3]); nmin[2] = Math.min(nmin[2], P[v * 3 + 2]); nmax[2] = Math.max(nmax[2], P[v * 3 + 2]); ny += P[v * 3 + 1]; }
        const neck = { center: [(nmin[0] + nmax[0]) / 2, ny / (neckIds.length || 1), (nmin[2] + nmax[2]) / 2], rx: (nmax[0] - nmin[0]) / 2, rz: (nmax[2] - nmin[2]) / 2 };
        // The back and the shoulders' tops: for capes and packs.
        const torso = ids.filter(v => an.member[v * 5] > 0.7 && an.s[v * 5] > 1 && an.s[v * 5] < 4);
        const backAt = (y, x) => {
            let z = Infinity;
            for (const v of torso) if (Math.abs(P[v * 3 + 1] - y) < 0.03 && Math.abs(P[v * 3] - x) < 0.04) z = Math.min(z, P[v * 3 + 2]);
            return z;
        };
        return {
            P, bone, boneIndex, eyeL, eyeR, eyeY, brow, crown, ring, earL: ear(1), earR: ear(-1), noseTip, mouth, chin, neck, backAt, torsoIds: torso,
            height: built.height, headIds
        };
    }

    const rigid = index => ({ joints: [index, 0, 0, 0], weights: [1, 0, 0, 0] });
    /** A skin blended down the spine by height: neck at the top, hips at the bottom. */
    function spineSkin(L) {
        const chain = ['Head', 'Neck', 'Spine2', 'Spine1', 'Spine', 'Hips'].map(n => ({ i: L.boneIndex(n), y: L.bone(n).head[1] }));
        return p => {
            for (let k = 0; k + 1 < chain.length; k++) {
                const a = chain[k], b = chain[k + 1];
                if (p[1] >= b.y || k + 2 === chain.length) {
                    const t = Math.max(0, Math.min(1, (a.y - p[1]) / (a.y - b.y || 1)));
                    return { joints: [a.i, b.i, 0, 0], weights: [1 - t, t, 0, 0] };
                }
            }
            return rigid(chain[0].i);
        };
    }

    // ── catalog ───────────────────────────────────────────────────────────
    const PROPS = [
        // Eyes and face
        { id: 'glasses', label: 'Glasses', slot: 'eyes', group: 'Face', defaults: { color: '#2a2420', shape: 'round', size: 1 }, shapes: [['round', 'Round'], ['square', 'Square'], ['cat', 'Cat-eye']], make: (m, L, o) => eyewear(m, L, o, { tint: '#cfe4f0', opacity: 0.18 }) },
        { id: 'sunglasses', label: 'Sunglasses', slot: 'eyes', group: 'Face', defaults: { color: '#141414', color2: '#1c1c22', shape: 'aviator', size: 1.1 }, shapes: [['aviator', 'Aviator'], ['square', 'Square'], ['round', 'Round']], make: (m, L, o) => eyewear(m, L, o, { tint: o.color2, opacity: 0.92 }) },
        { id: 'monocle', label: 'Monocle', slot: 'eyes', group: 'Face', defaults: { color: '#c9a35a', size: 1 }, make: (m, L, o) => monocle(m, L, o) },
        { id: 'eyepatch', label: 'Eye patch', slot: 'eyes', group: 'Face', defaults: { color: '#141414', side: 'left' }, make: (m, L, o) => eyepatch(m, L, o) },
        { id: 'goggles', label: 'Goggles', slot: 'eyes', group: 'Face', defaults: { color: '#5a3d22', color2: '#7a9a6a', up: 0 }, make: (m, L, o) => goggles(m, L, o) },
        { id: 'visor', label: 'Cyber visor', slot: 'eyes', group: 'Face', defaults: { color: '#202024', color2: '#ff2bd6' }, make: (m, L, o) => visor(m, L, o) },
        // Head
        { id: 'wizardhat', label: 'Wizard hat', slot: 'hat', group: 'Hats', defaults: { color: '#2e3f8a', color2: '#d4af37', size: 1, height: 1 }, make: (m, L, o) => coneHat(m, L, o, { brim: 1.95, tall: 0.42, bend: 0.12 }) },
        { id: 'witchhat', label: 'Witch hat', slot: 'hat', group: 'Hats', defaults: { color: '#1a1a1e', color2: '#6a2a8a', size: 1, height: 1 }, make: (m, L, o) => coneHat(m, L, o, { brim: 2.3, tall: 0.36, bend: 0.2 }) },
        { id: 'tophat', label: 'Top hat', slot: 'hat', group: 'Hats', defaults: { color: '#141416', color2: '#5a1a1a', size: 1, height: 1 }, make: (m, L, o) => crownHat(m, L, o, { brim: 1.45, tall: 0.17, flare: 1.08, top: 'flat', band: 0.025 }) },
        { id: 'fedora', label: 'Fedora', slot: 'hat', group: 'Hats', defaults: { color: '#5a4a3a', color2: '#2a2018', size: 1, height: 1 }, make: (m, L, o) => crownHat(m, L, o, { brim: 1.55, tall: 0.11, flare: 0.92, top: 'pinch', band: 0.018, curl: 0.25 }) },
        { id: 'cowboy', label: 'Cowboy hat', slot: 'hat', group: 'Hats', defaults: { color: '#8a6a44', color2: '#4a3622', size: 1, height: 1 }, make: (m, L, o) => crownHat(m, L, o, { brim: 1.95, tall: 0.12, flare: 0.95, top: 'pinch', band: 0.016, curl: 0.9 }) },
        { id: 'bowler', label: 'Bowler hat', slot: 'hat', group: 'Hats', defaults: { color: '#18181a', color2: '#18181a', size: 1, height: 1 }, make: (m, L, o) => crownHat(m, L, o, { brim: 1.32, tall: 0.1, flare: 0.9, top: 'dome', band: 0.014, curl: 0.5 }) },
        { id: 'tricorn', label: 'Tricorn', slot: 'hat', group: 'Hats', defaults: { color: '#1e1a18', color2: '#d4af37', size: 1, height: 1 }, make: (m, L, o) => crownHat(m, L, o, { brim: 1.7, tall: 0.09, flare: 0.95, top: 'dome', band: 0, fold: 3 }) },
        { id: 'cap', label: 'Cap', slot: 'hat', group: 'Hats', defaults: { color: '#b03030', color2: '#ffffff', size: 1, height: 1 }, make: (m, L, o) => cap(m, L, o) },
        { id: 'crown', label: 'Crown', slot: 'hat', group: 'Hats', defaults: { color: '#e0b84a', color2: '#c0203a', size: 1, height: 1 }, make: (m, L, o) => crown(m, L, o) },
        { id: 'circlet', label: 'Circlet', slot: 'hat', group: 'Hats', defaults: { color: '#d8d8e0', color2: '#3a8ad8', size: 1 }, make: (m, L, o) => circlet(m, L, o) },
        { id: 'vikinghelm', label: 'Horned helmet', slot: 'hat', group: 'Hats', defaults: { color: '#8a8e96', color2: '#ece4d0', size: 1, height: 1 }, make: (m, L, o) => vikingHelm(m, L, o) },
        { id: 'headband', label: 'Headband', slot: 'hat', group: 'Hats', defaults: { color: '#c03030', size: 1 }, make: (m, L, o) => headband(m, L, o) },
        { id: 'halo', label: 'Halo', slot: 'halo', group: 'Hats', defaults: { color: '#ffe48a', size: 1 }, make: (m, L, o) => halo(m, L, o) },
        // Jewelry
        { id: 'hoops', label: 'Hoop earrings', slot: 'earrings', group: 'Jewelry', defaults: { color: '#e0b84a', size: 1 }, make: (m, L, o) => earrings(m, L, o, 'hoop') },
        { id: 'studs', label: 'Stud earrings', slot: 'earrings', group: 'Jewelry', defaults: { color: '#e8e8f0', size: 1 }, make: (m, L, o) => earrings(m, L, o, 'stud') },
        { id: 'necklace', label: 'Necklace', slot: 'neck', group: 'Jewelry', defaults: { color: '#e0b84a', color2: '#3a8ad8', length: 0.5 }, make: (m, L, o) => necklace(m, L, o) },
        { id: 'choker', label: 'Choker', slot: 'neck', group: 'Jewelry', defaults: { color: '#141414', color2: '#c0203a' }, make: (m, L, o) => choker(m, L, o) },
        { id: 'bracelets', label: 'Bracelets', slot: 'wristwear', group: 'Jewelry', defaults: { color: '#e0b84a', size: 1 }, make: (m, L, o) => bracelets(m, L, o) },
        // Worn on the back and about the neck
        { id: 'cape', label: 'Cape', slot: 'back', group: 'Back', defaults: { color: '#8a1a2a', color2: '#d4af37', length: 0.8, width: 1 }, make: (m, L, o) => cape(m, L, o) },
        { id: 'scarf', label: 'Scarf', slot: 'scarf', group: 'Back', defaults: { color: '#c8a040', color2: '#8a2a2a', length: 0.5 }, make: (m, L, o) => scarf(m, L, o) },
        { id: 'backpack', label: 'Backpack', slot: 'back', group: 'Back', defaults: { color: '#4a5a3a', color2: '#2a3020', size: 1 }, make: (m, L, o) => backpack(m, L, o) },
        { id: 'quiver', label: 'Quiver', slot: 'back', group: 'Back', defaults: { color: '#6a4426', color2: '#e8e0d0', size: 1 }, make: (m, L, o) => quiver(m, L, o) },
        { id: 'jetpack', label: 'Jetpack', slot: 'back', group: 'Back', defaults: { color: '#9aa0a8', color2: '#ff8a20', size: 1 }, make: (m, L, o) => jetpack(m, L, o) },
        { id: 'bowtie', label: 'Bow tie', slot: 'tie', group: 'Jewelry', defaults: { color: '#141416' }, make: (m, L, o) => bowtie(m, L, o) }
    ];
    const BY_ID = new Map(PROPS.map(p => [p.id, p]));

    // ── makers ────────────────────────────────────────────────────────────
    const ringPath = (r, count, f) => Array.from({ length: count }, (_, k) => f(k / count * Math.PI * 2));

    /** A closed loop of tube (torus-like) through `points`. */
    function loop(m, points, radius, rgb, skin, sides = 6) {
        const pts = points.concat([points[0], points[1]]);
        const rows = m.tube(pts, radius, sides, rgb, skin, false);
        return rows;
    }

    function eyewear(m, L, o, lens) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const frame = linear(o.color), size = o.size || 1;
        const lensParts = new Mesh();
        for (const E of [L.eyeL, L.eyeR]) {
            const side = Math.sign(E.center[0]);
            const r = E.radius * 1.55 * size;
            const c = add(E.center, [side * r * 0.08, -E.radius * 0.15, E.radius * 1.05 + 0.006]);
            const shape = o.shape || 'round';
            const pts = ringPath(r, 28, a => {
                let x = Math.cos(a) * r, y = Math.sin(a) * r * (shape === 'round' ? 0.92 : 0.72);
                if (shape === 'square') { const k = 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)) * 1.25); x = Math.cos(a) * r * Math.min(1.12, k * 0.85); y = Math.sin(a) * r * 0.72 * Math.min(1.25, k * 0.85); }
                if (shape === 'cat') { y *= 1 + 0.35 * Math.max(0, Math.sin(a)) * (side * Math.cos(a) > 0 ? 1 : 0.2); }
                if (shape === 'aviator') { y = Math.sin(a) * r * (Math.sin(a) < 0 ? 1.05 : 0.72); x *= 1.05; }
                return add(c, [x, y, -Math.abs(x) * 0.12]);
            });
            loop(m, pts, 0.0018 * (shape === 'aviator' ? 0.8 : 1.15), frame, skin);
            const ln = new Mesh();
            ln.disk(c, [0, 0, 1], r * 0.98, linear(lens.tint), skin, 24, r * (shape === 'round' ? 0.9 : shape === 'aviator' ? 0.86 : 0.7));
            lensParts.p.push(...ln.p); lensParts.n.push(...ln.n); lensParts.c.push(...ln.c); lensParts.j.push(...ln.j); lensParts.w.push(...ln.w);
            const base = lensParts.i.length ? Math.max(...lensParts.i) + 1 : 0;
            for (const x of ln.i) lensParts.i.push(x + base);
            // The arm back to the ear, along the side of the head.
            const ear = side > 0 ? L.earL : L.earR;
            const outer = add(c, [side * r, 0, -r * 0.12]);
            const back = ear ? add(ear.center, [side * 0.004, 0.012, 0]) : add(outer, [0, 0, -0.09]);
            const ring = L.ring(c[1]);
            const mid = [side * (ring ? ring.rx + 0.004 : Math.abs(outer[0])), lerp(outer, back, 0.5)[1] + 0.004, lerp(outer, back, 0.5)[2]];
            m.tube([outer, lerp(outer, mid, 0.5), mid, back, add(back, [0, -0.018, -0.008])], 0.0018, 5, frame, skin);
        }
        // The bridge over the nose.
        const inL = add(L.eyeL.center, [-L.eyeL.radius * 0.5, 0.002, L.eyeL.radius * 1.15 + 0.006]);
        const inR = add(L.eyeR.center, [L.eyeR.radius * 0.5, 0.002, L.eyeR.radius * 1.15 + 0.006]);
        m.tube([inL, add(lerp(inL, inR, 0.5), [0, 0.004, 0.004]), inR], 0.0017, 5, frame, skin);
        return [{ mesh: lensParts, extra: { name: 'Lenses', opacity: lens.opacity, roughness: 0.05, metalness: 0 } }];
    }

    function monocle(m, L, o) {
        const head = L.boneIndex('Head');
        const E = L.eyeR, r = E.radius * 1.5 * (o.size || 1);
        const c = add(E.center, [0, 0, E.radius * 1.05 + 0.004]);
        loop(m, ringPath(r, 28, a => add(c, [Math.cos(a) * r, Math.sin(a) * r, 0])), 0.0022, linear(o.color), rigid(head));
        const lens = new Mesh();
        lens.disk(c, [0, 0, 1], r, linear('#dfeef6'), rigid(head));
        // A chain from the rim down to the chest, sagging.
        const start = add(c, [0, -r, 0]);
        const end = [L.neck.center[0] - L.neck.rx * 1.6, L.neck.center[1] - 0.12, L.neck.center[2] + L.neck.rz * 1.5];
        const pts = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16; const p = lerp(start, end, t); p[1] -= Math.sin(t * Math.PI) * 0.05; p[2] += Math.sin(t * Math.PI) * 0.03; pts.push(p); }
        m.tube(pts, 0.0011, 4, linear(o.color), spineSkin(L));
        return [{ mesh: lens, extra: { name: 'Lenses', opacity: 0.15, roughness: 0.05 } }];
    }

    function eyepatch(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const E = o.side === 'right' ? L.eyeR : L.eyeL, side = Math.sign(E.center[0]);
        const c = add(E.center, [0, 0, E.radius * 1.1 + 0.003]);
        const r = E.radius * 1.7;
        m.loft(5, (i, t) => ({ center: add(c, [0, 0, -t * 0.006]), x: [1, 0, 0], y: [0, 1, 0], rx: r * (1 - t * t * 0.5), ry: r * 0.85 * (1 - t * t * 0.5) }), 20, linear(o.color), skin, true);
        // The strap round the head, rising toward the back.
        const ring = L.ring(E.center[1] + 0.02);
        if (ring) {
            const pts = ringPath(1, 32, a => [ring.center[0] + Math.sin(a) * (ring.rx + 0.004), E.center[1] + 0.015 + (1 - Math.cos(a)) * 0.012, ring.center[2] + Math.cos(a) * (ring.rz + 0.004)]);
            loop(m, pts, 0.0025, linear(o.color), skin, 4);
        }
        return [];
    }

    function goggles(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const lift = (o.up || 0) * 0.06;
        for (const E of [L.eyeL, L.eyeR]) {
            const r = E.radius * 1.55;
            const c = add(E.center, [0, lift, E.radius * 0.9 + lift * 0.3]);
            m.loft(4, (i, t) => ({ center: add(c, [0, 0, t * 0.014]), x: [1, 0, 0], y: [0, 1, 0], rx: r * (1 + t * 0.12), ry: r * (1 + t * 0.12) }), 18, linear(o.color), skin, false);
            const lens = add(c, [0, 0, 0.013]);
            m.disk(lens, [0, 0, 1], r * 1.02, linear(o.color2 || '#7a9a6a'), skin);
        }
        const ring = L.ring(L.eyeY + lift);
        if (ring) loop(m, ringPath(1, 32, a => [ring.center[0] + Math.sin(a) * (ring.rx + 0.006), L.eyeY + lift + 0.004, ring.center[2] + Math.cos(a) * (ring.rz + 0.006)]), 0.006, linear(o.color), skin, 4);
        return [];
    }

    function visor(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const ring = L.ring(L.eyeY);
        if (!ring) return [];
        // A band round the front of the face at the eyes, glowing.
        m.loft(17, (i, t) => {
            const a = -1.45 + t * 2.9;
            return { center: [ring.center[0] + Math.sin(a) * (ring.rx + 0.012), L.eyeY, ring.center[2] + Math.cos(a) * (ring.rz + 0.012)], x: [Math.sin(a), 0, Math.cos(a)], y: [0, 1, 0], rx: 0.004, ry: 0.016 };
        }, 6, t => (Math.abs(t - 0.5) < 0.42 ? linear(o.color2) : linear(o.color)), skin, true);
        return [];
    }

    /** The hat line: just above the brow, its section scaled out a little for the hair under it. */
    function hatRing(L, o, raise = 0.012) {
        const y = L.brow + raise;
        const ring = L.ring(y, 0.015) || { center: [0, y, 0], rx: 0.08, rz: 0.1 };
        const fit = 1.07 * (o.size || 1);
        return { center: ring.center, rx: ring.rx * fit + 0.008, rz: ring.rz * fit + 0.008 };
    }

    function brim(m, R, out, rgb, skin, curl = 0, fold = 0) {
        // Two rings of the brim's top and underside: from the crown's edge out to `out` times its radius.
        const sides = 40;
        m.loft(7, (i, t) => {
            const k = 1 + (out - 1) * (i < 4 ? i / 3 : (6 - i) / 3);
            const lip = i < 4 ? 0.004 : -0.004;
            return { center: [R.center[0], R.center[1] + lip, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: R.rx * k, ry: R.rz * k };
        }, sides, rgb, skin, false);
        // Curl and fold bend the brim's outer ring up: at the sides (curl) or in three points (fold).
        const P = m.p;
        for (let v = 0; v < P.length; v += 3) {
            const dx = (P[v] - R.center[0]) / R.rx, dz = (P[v + 2] - R.center[2]) / R.rz;
            const d = Math.hypot(dx, dz);
            if (d <= 1.02 || Math.abs(P[v + 1] - R.center[1]) > 0.006) continue;
            const reach = (d - 1) / Math.max(0.01, out - 1);
            const a = Math.atan2(dx, dz);
            let up = 0;
            if (curl) up += curl * Math.abs(Math.sin(a)) ** 2 * reach * reach * R.rx * 0.9;
            if (fold) up += Math.max(0, Math.cos(fold * a)) ** 2 * reach * R.rx * 1.2;
            P[v + 1] += up;
        }
        m.computeNormals();
    }

    function coneHat(m, L, o, k) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o), tall = k.tall * (o.height || 1) * (o.size || 1);
        brim(m, R, k.brim, linear(o.color), skin);
        const band = linear(o.color2 || o.color);
        m.loft(20, (i, t) => {
            const w = Math.pow(1 - t, 1.25) * (1 - t * 0.05);
            const bendZ = -k.bend * Math.pow(t, 2.2) * tall * 1.4, bendY = -k.bend * Math.pow(t, 3) * tall * 0.6;
            return { center: [R.center[0], R.center[1] + t * tall + bendY, R.center[2] + bendZ], x: [1, 0, 0], y: [0, 0, 1], rx: Math.max(0.002, R.rx * w), ry: Math.max(0.002, R.rz * w) };
        }, 28, t => (t < 0.09 ? band : linear(o.color)), skin, true);
        return [];
    }

    function crownHat(m, L, o, k) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o), tall = k.tall * (o.height || 1) * (o.size || 1);
        brim(m, R, k.brim, linear(o.color), skin, k.curl || 0, k.fold || 0);
        const base = m.p.length;
        const band = linear(o.color2 || o.color);
        const rows = 10;
        m.loft(rows + 1, (i, t) => {
            let w = 1 + (k.flare - 1) * t;
            let y = t * tall;
            if (k.top === 'dome') { w *= Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, t - 0.35) / 0.65, 2))); }
            if (t >= 1 && k.top !== 'dome') w *= 0.98;
            return { center: [R.center[0], R.center[1] + y, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: Math.max(0.002, R.rx * w), ry: Math.max(0.002, R.rz * w) };
        }, 28, t => (k.band && t * tall < k.band ? band : linear(o.color)), skin, true);
        // A pinched crown: the front dents in at the top.
        if (k.top === 'pinch') for (let v = base; v < m.p.length; v += 3) {
            const up = (m.p[v + 1] - R.center[1]) / tall;
            if (up < 0.55) continue;
            const front = (m.p[v + 2] - R.center[2]) / R.rz;
            m.p[v + 1] -= Math.max(0, front) * (up - 0.55) * tall * 0.45 + (1 - Math.abs((m.p[v] - R.center[0]) / R.rx)) * (up - 0.55) * tall * 0.2;
        }
        m.computeNormals();
        return [];
    }

    function cap(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o, 0.004);
        m.loft(9, (i, t) => {
            const a = t * Math.PI / 2;
            return { center: [R.center[0], R.center[1] + Math.sin(a) * R.rx * 0.85, R.center[2] - t * 0.01], x: [1, 0, 0], y: [0, 0, 1], rx: Math.max(0.002, R.rx * Math.cos(a)), ry: Math.max(0.002, R.rz * Math.cos(a)) };
        }, 28, linear(o.color), skin, true);
        // The bill, in front.
        const v0 = [R.center[0], R.center[1] + 0.004, R.center[2] + R.rz * 0.92];
        m.loft(5, (i, t) => ({ center: add(v0, [0, -t * 0.012, t * R.rz * 0.75]), x: [1, 0, 0], y: [0, 0.25, 1], rx: R.rx * (0.85 - t * 0.25), ry: 0.003 }), 16, linear(o.color2 || o.color), skin, true);
        return [];
    }

    function crown(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o, 0.03), tall = 0.06 * (o.height || 1);
        const gold = linear(o.color), gem = linear(o.color2 || '#c0203a');
        m.loft(2, (i, t) => ({ center: [R.center[0], R.center[1] + t * 0.018, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: R.rx, ry: R.rz }), 36, gold, skin, false);
        const points = 8;
        for (let k = 0; k < points; k++) {
            const a = k / points * Math.PI * 2;
            const base = [R.center[0] + Math.sin(a) * R.rx, R.center[1] + 0.012, R.center[2] + Math.cos(a) * R.rz];
            m.tube([base, add(base, [0, tall * 0.6, 0]), add(base, [0, tall, 0])], [0.012, 0.007, 0.001], 4, gold, skin);
            m.sphere(add(base, [0, tall + 0.004, 0]), 0.0045, gold, skin, 4, 6);
            m.sphere(add(base, [Math.sin(a) * 0.002, -0.003, Math.cos(a) * 0.002]), 0.005, gem, skin, 4, 6);
        }
        return [];
    }

    function circlet(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o, -0.004);
        loop(m, ringPath(1, 36, a => [R.center[0] + Math.sin(a) * R.rx, R.center[1] - Math.cos(a) * 0.01 + 0.01, R.center[2] + Math.cos(a) * R.rz]), 0.0022, linear(o.color), skin, 5);
        m.sphere([R.center[0], R.center[1], R.center[2] + R.rz + 0.004], 0.006, linear(o.color2 || '#3a8ad8'), skin, 5, 8, [1, 1.3, 0.7]);
        return [];
    }

    function vikingHelm(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o, -0.004);
        const dome = R.rx * 1.05;
        m.loft(10, (i, t) => {
            const a = t * Math.PI / 2;
            return { center: [R.center[0], R.center[1] + Math.sin(a) * dome, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: Math.max(0.002, R.rx * Math.cos(a)), ry: Math.max(0.002, R.rz * Math.cos(a)) };
        }, 28, linear(o.color), skin, true);
        m.loft(2, (i, t) => ({ center: [R.center[0], R.center[1] + t * 0.02, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: R.rx + 0.004, ry: R.rz + 0.004 }), 28, linear('#6a5a3a'), skin, false);
        for (const side of [1, -1]) {
            const start = [R.center[0] + side * R.rx * 0.9, R.center[1] + dome * 0.45, R.center[2]];
            const pts = [];
            for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(add(start, [side * t * 0.11 * (o.size || 1), Math.sin(t * Math.PI * 0.6) * 0.09 * (o.height || 1), -t * 0.02])); }
            m.tube(pts, t => 0.022 * (1 - t) + 0.002, 8, linear(o.color2 || '#ece4d0'), skin);
        }
        return [];
    }

    function headband(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const R = hatRing(L, o, -0.002);
        m.loft(2, (i, t) => ({ center: [R.center[0], R.center[1] - 0.01 + t * 0.022, R.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: R.rx - 0.004, ry: R.rz - 0.004 }), 36, linear(o.color), skin, false);
        return [];
    }

    function halo(m, L, o) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        const c = [0, L.crown + 0.06, L.ring(L.brow)?.center[2] || 0];
        const r = 0.09 * (o.size || 1);
        loop(m, ringPath(1, 40, a => [c[0] + Math.sin(a) * r, c[1], c[2] + Math.cos(a) * r]), 0.006, linear(o.color), skin, 6);
        return [];
    }

    function earrings(m, L, o, kind) {
        const head = L.boneIndex('Head'), skin = rigid(head);
        for (const E of [L.earL, L.earR]) {
            if (!E || !E.lobe) continue;
            const side = Math.sign(E.lobe[0]);
            const at = add(E.lobe, [side * 0.002, 0.002, 0]);
            if (kind === 'stud') { m.sphere(at, 0.0035 * (o.size || 1), linear(o.color), skin, 4, 8); continue; }
            const r = 0.011 * (o.size || 1);
            loop(m, ringPath(1, 24, a => add(at, [side * 0.001, -r + Math.cos(a) * r, Math.sin(a) * r])), 0.0012, linear(o.color), skin, 5);
        }
        return [];
    }

    function necklace(m, L, o) {
        const skin = spineSkin(L), N = L.neck;
        const drop = 0.03 + (o.length ?? 0.5) * 0.12;
        const pts = ringPath(1, 40, a => {
            const f = Math.max(0, Math.cos(a));
            return [N.center[0] + Math.sin(a) * (N.rx + 0.012 + f * 0.03), N.center[1] - 0.02 - f * f * drop, N.center[2] + Math.cos(a) * (N.rz + 0.008) + f * f * drop * 0.6];
        });
        loop(m, pts, 0.0016, linear(o.color), skin, 5);
        const front = pts[0];
        m.sphere(add(front, [0, -0.012, 0.004]), 0.008, linear(o.color2 || o.color), skin, 6, 8, [1, 1.3, 0.6]);
        return [];
    }

    function choker(m, L, o) {
        const skin = spineSkin(L), N = L.neck;
        const y = N.center[1] + 0.035;
        m.loft(2, (i, t) => ({ center: [N.center[0], y + t * 0.014, N.center[2]], x: [1, 0, 0], y: [0, 0, 1], rx: N.rx * 0.92 + 0.004, ry: N.rz * 0.92 + 0.004 }), 32, linear(o.color), skin, false);
        m.sphere([N.center[0], y + 0.004, N.center[2] + N.rz * 0.92 + 0.008], 0.005, linear(o.color2 || o.color), skin, 4, 8);
        return [];
    }

    function bracelets(m, L, o) {
        for (const name of ['LeftHand', 'RightHand']) {
            const hand = L.bone(name), fore = L.bone(name.replace('Hand', 'ForeArm'));
            const axis = norm(sub(hand.head, fore.head));
            const c = sub(hand.head, mul(axis, 0.025));
            const x = norm(cross(axis, [0, 0, 1])), y = cross(axis, x);
            const r = 0.032 * (o.size || 1);
            loop(m, ringPath(1, 24, a => add(c, add(mul(x, Math.cos(a) * r), mul(y, Math.sin(a) * r * 0.8)))), 0.003, linear(o.color), rigid(L.boneIndex(name.replace('Hand', 'ForeArm'))), 5);
        }
        return [];
    }

    /**
     * A cape: a sheet from the shoulders, hanging behind the body. Each
     * column keeps behind the deepest part of the back above it, so it falls
     * clear of the shoulder blades and the seat.
     */
    function cape(m, L, o) {
        const N = L.neck, width = (o.width || 1);
        const sh = L.bone('LeftArm').head, top = N.center[1] - 0.01;
        const half = Math.abs(sh[0]) * 1.25 * width;
        const length = 0.35 + (o.length ?? 0.8) * (top - 0.08 - 0.35);
        const cols = 17, rows = 22;
        const skin = spineSkin(L);
        const grid = [];
        const main = linear(o.color), lining = linear(o.color2 || o.color);
        for (let r = 0; r <= rows; r++) {
            const t = r / rows, y = top - t * length;
            const row = [];
            for (let c = 0; c <= cols; c++) {
                const u = c / cols * 2 - 1;
                const spread = half * (0.55 + 0.45 * Math.min(1, t * 4)) * (1 + t * 0.35);
                const x = u * spread;
                let z = Infinity;
                // Behind the back: the deepest point of the body above, then clear of it.
                for (let yy = y; yy <= top + 0.001; yy += 0.04) z = Math.min(z, L.backAt(yy, x * 0.8));
                if (!isFinite(z)) z = N.center[2] - N.rz;
                // At the shoulders the cape wraps forward over them.
                const wrap = Math.max(0, 1 - t * 6) * Math.abs(u) ** 2 * 0.09;
                const fold = Math.sin(u * Math.PI * 4 + 1) * 0.008 * t;
                row.push([x, y - (1 - Math.min(1, t * 5)) * Math.abs(u) * 0.02, z - 0.025 - t * 0.05 + wrap + fold]);
            }
            grid.push(row);
        }
        const ids = grid.map((row, r) => row.map(p => m.vertex(p, [0, 0, -1], r === rows ? lining : main, skin)));
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const a = ids[r][c], b = ids[r][c + 1], d = ids[r + 1][c], e = ids[r + 1][c + 1];
            m.tri(a, b, d); m.tri(b, e, d);
        }
        m.computeNormals();
        // A clasp at the collar.
        m.sphere([0, top, N.center[2] + N.rz + 0.01], 0.009, linear(o.color2 || '#d4af37'), skin, 4, 8);
        return [{ mesh: null, extra: { doubleSided: true } }];
    }

    function scarf(m, L, o) {
        const skin = spineSkin(L), N = L.neck;
        const main = linear(o.color), stripe = linear(o.color2 || o.color);
        const y = N.center[1] + 0.015;
        const pts = ringPath(1, 28, a => [N.center[0] + Math.sin(a) * (N.rx + 0.022), y + Math.cos(a) * 0.006, N.center[2] + Math.cos(a) * (N.rz + 0.022)]);
        loop(m, pts, 0.022, (t, a, p) => (Math.floor(t * 12) % 3 === 0 ? stripe : main), skin, 8);
        // A tail hanging down the front.
        const start = [N.center[0] + N.rx * 0.6, y - 0.01, N.center[2] + N.rz + 0.03];
        const tail = [];
        const len = 0.12 + (o.length ?? 0.5) * 0.35;
        for (let k = 0; k <= 8; k++) { const t = k / 8; tail.push(add(start, [t * 0.02, -t * len, 0.025 * Math.sin(t * 2) + t * 0.02])); }
        m.loft(tail.length, i => ({ center: tail[i], x: [1, 0, 0], y: [0, 0, 1], rx: 0.03, ry: 0.006 }), 8, (t) => (Math.floor(t * 8) % 3 === 0 ? stripe : main), skin, true);
        return [];
    }

    function backpack(m, L, o) {
        const spine = L.boneIndex('Spine2'), skin = rigid(spine);
        const y = L.bone('Spine2').head[1] + 0.06;
        const z = L.backAt(y, 0);
        const s = o.size || 1;
        const c = [0, y, (isFinite(z) ? z : -0.12) - 0.07 * s];
        m.loft(8, (i, t) => {
            const a = -Math.PI / 2 + t * Math.PI;
            return { center: add(c, [0, Math.sin(a) * 0.2 * s, 0]), x: [1, 0, 0], y: [0, 0, 1], rx: 0.15 * s * (0.75 + 0.25 * Math.cos(a)), ry: 0.07 * s * (0.6 + 0.4 * Math.cos(a)) };
        }, 16, linear(o.color), skin, true);
        m.box(add(c, [0, -0.06 * s, -0.075 * s]), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.1 * s, 0.07 * s, 0.025 * s], linear(o.color2 || o.color), skin);
        // Straps over the shoulders.
        for (const side of [1, -1]) {
            const sh = L.bone(side > 0 ? 'LeftArm' : 'RightArm').head;
            const top = [side * Math.abs(sh[0]) * 0.55, sh[1] + 0.06, sh[2] - 0.01];
            const front = [side * Math.abs(sh[0]) * 0.55, sh[1] - 0.14, L.neck.center[2] + L.neck.rz + 0.07];
            m.tube([add(c, [side * 0.08, 0.15, 0.03]), top, add(top, [0, 0.005, 0.06]), front], 0.008, 4, linear(o.color2 || o.color), spineSkin(L), true);
        }
        return [];
    }

    function quiver(m, L, o) {
        const spine = L.boneIndex('Spine2'), skin = rigid(spine);
        const y = L.bone('Spine2').head[1];
        const z = L.backAt(y + 0.05, 0);
        const base = [-0.1, y - 0.12, (isFinite(z) ? z : -0.12) - 0.05], top = [0.12, y + 0.3, (isFinite(z) ? z : -0.12) - 0.05];
        m.tube([base, lerp(base, top, 0.5), top], 0.045 * (o.size || 1), 12, linear(o.color), skin);
        for (let k = 0; k < 7; k++) {
            const off = [Math.cos(k * 2.4) * 0.02, 0, Math.sin(k * 2.4) * 0.02];
            const a = add(top, off), b = add(add(top, off), mul(norm(sub(top, base)), 0.12));
            m.tube([a, b], 0.004, 4, linear('#8a6a44'), skin);
            m.box(b, [[1, 0, 0], norm(sub(top, base)), [0, 0, 1]], [0.012, 0.03, 0.001], linear(o.color2 || '#e8e0d0'), skin);
        }
        return [];
    }

    function jetpack(m, L, o) {
        const spine = L.boneIndex('Spine2'), skin = rigid(spine);
        const y = L.bone('Spine2').head[1] + 0.04;
        const z = L.backAt(y, 0);
        const s = o.size || 1, back = (isFinite(z) ? z : -0.12) - 0.06 * s;
        m.box([0, y, back + 0.02], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0.13 * s, 0.17 * s, 0.03 * s], linear(o.color), skin);
        for (const side of [1, -1]) {
            const c = [side * 0.075 * s, y, back - 0.04 * s];
            m.tube([add(c, [0, 0.2 * s, 0]), add(c, [0, -0.12 * s, 0]), add(c, [0, -0.2 * s, 0])], [0.05 * s, 0.05 * s, 0.035 * s], 14, linear(o.color), skin);
            m.disk(add(c, [0, -0.205 * s, 0]), [0, -1, 0], 0.03 * s, linear(o.color2 || '#ff8a20'), skin, 14);
        }
        return [];
    }

    function bowtie(m, L, o) {
        const skin = spineSkin(L), N = L.neck;
        const c = [N.center[0], N.center[1] + 0.005, N.center[2] + N.rz + 0.02];
        for (const side of [1, -1]) m.tube([c, add(c, [side * 0.03, 0.012, -0.004]), add(c, [side * 0.04, 0, -0.004]), add(c, [side * 0.03, -0.012, -0.004]), c], [0.006, 0.01, 0.012, 0.01, 0.006], 6, linear(o.color), skin);
        m.sphere(c, 0.007, linear(o.color), skin, 4, 6);
        return [];
    }

    // ── building ──────────────────────────────────────────────────────────
    function normalizeProp(item) {
        const def = BY_ID.get(item && item.id);
        if (!def) return null;
        const out = Object.assign({ id: def.id }, def.defaults, item);
        for (const k of ['color', 'color2']) if (out[k] && !/^#[0-9a-f]{6}$/i.test(out[k])) out[k] = def.defaults[k];
        for (const k of ['size', 'height', 'length', 'width', 'up']) if (out[k] != null) out[k] = Math.max(0, Math.min(3, +out[k] || 0));
        return out;
    }

    /** One accessory per slot, the later one winning. */
    function normalizeProps(list) {
        const bySlot = new Map();
        for (const raw of Array.isArray(list) ? list : []) {
            const item = normalizeProp(raw);
            if (item) bySlot.set(BY_ID.get(item.id).slot, item);
        }
        return [...bySlot.values()];
    }

    /** Parts for the accessories on a built body, merged by finish. */
    function build(pack, built, list) {
        const items = normalizeProps(list);
        if (!items.length) return { parts: [], items };
        const L = landmarks(pack, built);
        const solid = new Mesh(), cloth = new Mesh(), extras = [];
        for (const item of items) {
            const def = BY_ID.get(item.id);
            const m = new Mesh();
            const more = def.make(m, L, item) || [];
            const soft = more.some(x => x.extra && x.extra.doubleSided);
            merge(soft ? cloth : solid, m);
            for (const x of more) if (x.mesh && !x.mesh.empty) extras.push(x.mesh.part(x.extra.name || def.label, x.extra));
        }
        const parts = [];
        if (!solid.empty) parts.push(solid.part('Accessories', { roughness: 0.35, metalness: 0.6 }));
        if (!cloth.empty) parts.push(cloth.part('Cape', { roughness: 0.85, metalness: 0, doubleSided: true }));
        return { parts: parts.concat(extras), items, landmarks: L };
    }

    function merge(into, m) {
        const base = into.p.length / 3;
        into.p.push(...m.p); into.n.push(...m.n); into.c.push(...m.c); into.j.push(...m.j); into.w.push(...m.w);
        for (const x of m.i) into.i.push(x + base);
    }

    const api = { PROPS, BY_ID, Mesh, landmarks, rigid, spineSkin, normalizeProp, normalizeProps, build, vec: { add, sub, mul, dot, cross, len, norm, lerp } };
    root.RRCharacterProps = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

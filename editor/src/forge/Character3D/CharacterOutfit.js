/**
 * RRCharacterOutfit - garments cut from the body and fitted to every slider.
 *
 * MakeHuman's base mesh carries clothing helpers (a bodysuit, a long skirt)
 * that every shape target moves with the body. A garment here is a piece of
 * one of those surfaces (or of the skin, for gloves and hoods), cut along
 * smooth lines measured on the body's own chains (spine, arms, legs), lifted
 * off it by a thickness, draped (smoothed, but never inside the body) and
 * colored by vertex. Its vertices are recorded as points between two pack
 * vertices, so after any slider change the same garment is laid on the new
 * body by interpolation, already skinned with the body's weights.
 *
 * Pieces of hard armor are the same cut, lifted further, smoothed harder,
 * split into plates along a chain and given a metal finish.
 *
 * No DOM and no three.js: the builder page and the node tests share it.
 */
(function(root) {
    'use strict';

    const Body = root.RRHumanBody || (typeof require === 'function' ? require('./HumanBody.js') : null);

    // ── colors ────────────────────────────────────────────────────────────
    const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    /** Hex to linear rgb. */
    function linear(hex) {
        const n = parseInt(String(hex || '#808080').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
        return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
    }
    const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    // ── body chains ───────────────────────────────────────────────────────
    const FAMILIES = ['spine', 'armL', 'armR', 'legL', 'legR'];
    const familyOf = name => {
        if (/^Left(Shoulder|Arm|ForeArm|Hand)/.test(name)) return 1;
        if (/^Right(Shoulder|Arm|ForeArm|Hand)/.test(name)) return 2;
        if (/^Left(UpLeg|Leg|Foot|ToeBase)/.test(name)) return 3;
        if (/^Right(UpLeg|Leg|Foot|ToeBase)/.test(name)) return 4;
        return 0;
    };
    /**
     * Each chain's joints, as positions along it: the spine runs Hips 0,
     * Spine 1, Spine1 2, Spine2 3, Neck 4, Head 5, crown 6; an arm Shoulder 0,
     * Arm 1, ForeArm 2, Hand 3, fingertips 4; a leg UpLeg 0, knee 1, ankle 2,
     * toes 3, toe tips 4.
     */
    const CHAINS = {
        spine: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Head>'],
        armL: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle3>'],
        armR: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'RightHandMiddle3>'],
        legL: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToeBase>'],
        legR: ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToeBase>']
    };

    function chainPoints(bones, family) {
        return CHAINS[family].map(entry => {
            const tail = entry.endsWith('>');
            const bone = bones.find(b => b.name === entry.replace('>', ''));
            return (tail ? bone.tail : bone.head).slice();
        });
    }

    /**
     * A height on the trunk as a spine position: even steps from the hips'
     * joint (0) to the neck's (4), carried on below; above the neck, through
     * the head's joint (5) to the crown (6).
     */
    function spineAt(points, y) {
        const hip = points[0][1], neck = points[4][1];
        if (y <= neck) return (y - hip) / (neck - hip) * 4;
        if (y <= points[5][1]) return 4 + (y - neck) / (points[5][1] - neck);
        return 5 + (y - points[5][1]) / (points[6][1] - points[5][1]);
    }

    /** Where a point falls along a polyline: segment index plus fraction, carried past either end. */
    function along(points, x, y, z) {
        let best = Infinity, at = 0, axis = null, dir = null;
        for (let i = 0; i + 1 < points.length; i++) {
            const a = points[i], b = points[i + 1];
            const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
            const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
            let t = ((x - a[0]) * dx + (y - a[1]) * dy + (z - a[2]) * dz) / len2;
            const free = t;
            if (i > 0) t = Math.max(0, t);
            if (i + 2 < points.length) t = Math.min(1, t);
            const px = a[0] + dx * t, py = a[1] + dy * t, pz = a[2] + dz * t;
            const d = (x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2;
            if (d < best) { best = d; at = i + (i === 0 || i + 2 === points.length ? free : t); axis = [px, py, pz]; const l = Math.sqrt(len2); dir = [dx / l, dy / l, dz / l]; }
        }
        return { s: at, axis, dir, dist: Math.sqrt(best) };
    }

    /**
     * Per pack vertex, measured once on the average body: how much it belongs
     * to each chain (from the skin weights), where it falls along each chain,
     * and its angle about the spine (0 in front, ±π behind) and about a limb.
     */
    function anatomy(pack) {
        if (pack._anatomy) return pack._anatomy;
        const built = Body.build(pack, Body.DEFAULT_RECIPE);
        const P = built.shaped, n = pack.vertexCount;
        const chains = {};
        for (const f of FAMILIES) chains[f] = chainPoints(built.bones, f);
        const familyOfBone = pack.bones.map(b => familyOf(b.name));
        const member = new Float32Array(n * 5), s = new Float32Array(n * 5), angle = new Float32Array(n * 5);
        for (let v = 0; v < n; v++) {
            for (let k = 0; k < 4; k++) member[v * 5 + familyOfBone[pack.skinJoints[v * 4 + k]]] += pack.skinWeights[v * 4 + k];
            const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
            FAMILIES.forEach((f, fi) => {
                const at = along(chains[f], x, y, z);
                // The trunk stands upright: along it, height is the measure (through its joints' heights).
                s[v * 5 + fi] = fi === 0 ? spineAt(chains.spine, y) : at.s;
                // Spine: about the vertical; a limb: about its own axis, in front where z grows.
                if (fi === 0) angle[v * 5] = Math.atan2(x - at.axis[0], z - at.axis[2]);
                else {
                    // About the limb's own axis: 0 toward the front (+z), positive toward the limb's top/outside.
                    const d = at.dir, f = [-d[2] * d[0], -d[2] * d[1], 1 - d[2] * d[2]];
                    const fl = Math.hypot(f[0], f[1], f[2]) || 1;
                    const b = [d[1] * f[2] - d[2] * f[1], d[2] * f[0] - d[0] * f[2], d[0] * f[1] - d[1] * f[0]];
                    const o = [x - at.axis[0], y - at.axis[1], z - at.axis[2]];
                    angle[v * 5 + fi] = Math.atan2((o[0] * b[0] + o[1] * b[1] + o[2] * b[2]) / fl, (o[0] * f[0] + o[1] * f[1] + o[2] * f[2]) / fl);
                }
            });
        }
        // The skirt helper: 0 at its waistband to 1 at its hem.
        const skirt = pack.helpers.skirt;
        const skirtV = new Set(skirt.source);
        let top = -Infinity, bottom = Infinity;
        for (const v of skirtV) { top = Math.max(top, P[v * 3 + 1]); bottom = Math.min(bottom, P[v * 3 + 1]); }
        const skirtU = new Float32Array(n);
        for (const v of skirtV) skirtU[v] = (top - P[v * 3 + 1]) / (top - bottom);
        // Each chain's size, for laying its surface flat: mean distance from its axis, meters per step along it.
        const radius = new Float32Array(6), unit = new Float32Array(6), counts = new Float32Array(6);
        for (let v = 0; v < n; v++) {
            let fi = 0;
            for (let k = 1; k < 5; k++) if (member[v * 5 + k] > member[v * 5 + fi]) fi = k;
            const at = along(chains[FAMILIES[fi]], P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
            radius[fi] += at.dist; counts[fi]++;
        }
        for (let fi = 0; fi < 5; fi++) {
            radius[fi] /= counts[fi] || 1;
            const pts = chains[FAMILIES[fi]];
            unit[fi] = fi === 0 ? (pts[4][1] - pts[0][1]) / 4 : Math.hypot(...[0, 1, 2].map(k => pts[2][k] - pts[1][k]));
        }
        // The skirt: as wide as the hips, its length from waistband to hem.
        radius[5] = 0.2; unit[5] = (top - bottom);
        return (pack._anatomy = { member, s, angle, skirtU, height: built.height, chains, rest: P, radius, unit });
    }

    // ── binding to the skin ───────────────────────────────────────────────
    /** A grid over points for nearest-point queries. */
    function pointGrid(P, ids, cell) {
        const map = new Map();
        const key = (x, y, z) => x + ',' + y + ',' + z;
        for (const v of ids) {
            const k = key(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell));
            let list = map.get(k);
            if (!list) map.set(k, list = []);
            list.push(v);
        }
        return {
            nearest(x, y, z, reach = 2) {
                const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
                let best = -1, bd = Infinity;
                for (let r = 1; r <= reach && best < 0; r++) {
                    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
                        const list = map.get(key(cx + i, cy + j, cz + k));
                        if (!list) continue;
                        for (const v of list) {
                            const d = (P[v * 3] - x) ** 2 + (P[v * 3 + 1] - y) ** 2 + (P[v * 3 + 2] - z) ** 2;
                            if (d < bd) { bd = d; best = v; }
                        }
                    }
                }
                return best;
            }
        };
    }

    /** The body's triangles by pack vertex, and each vertex's triangles. */
    function bodyTriangles(pack) {
        if (pack._bodyTris) return pack._bodyTris;
        const src = pack.body.source, idx = pack.body.index;
        const tris = new Uint32Array(idx.length);
        for (let i = 0; i < idx.length; i++) tris[i] = src[idx[i]];
        const around = new Map();
        for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
            const v = tris[t + k];
            if (!around.has(v)) around.set(v, []);
            around.get(v).push(t);
        }
        return (pack._bodyTris = { tris, around });
    }

    /**
     * Binds a helper's vertices to the skin as MakeHuman fits clothes: each
     * rides on its nearest body triangle (barycentric weights) at a fixed
     * height along that triangle's normal, measured on the average body.
     * Laid on any body, a bound helper keeps its distance from the skin
     * however far the sliders push it.
     */
    function binding(pack, name) {
        pack._bindings = pack._bindings || {};
        if (pack._bindings[name]) return pack._bindings[name];
        const an = anatomy(pack), R = an.rest;
        const { tris, around } = bodyTriangles(pack);
        const grid = pointGrid(R, new Set(pack.body.source), 0.03);
        const ids = [...new Set(pack.helpers[name].source)];
        const out = { ids, tri: new Uint32Array(ids.length * 3), bary: new Float32Array(ids.length * 3), height: new Float32Array(ids.length) };
        ids.forEach((v, i) => {
            const x = [R[v * 3], R[v * 3 + 1], R[v * 3 + 2]];
            const near = grid.nearest(x[0], x[1], x[2], 4);
            let best = null;
            for (const t of around.get(near) || []) {
                const hit = projectOnTriangle(R, tris[t], tris[t + 1], tris[t + 2], x);
                if (!best || hit.dist < best.dist) best = Object.assign(hit, { t });
            }
            if (!best) return;
            out.tri.set([tris[best.t], tris[best.t + 1], tris[best.t + 2]], i * 3);
            out.bary.set(best.bary, i * 3);
            out.height[i] = best.height;
        });
        return (pack._bindings[name] = out);
    }

    function projectOnTriangle(P, a, b, c, x) {
        const A = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], B = [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]], C = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const nl = Math.hypot(...n) || 1e-12;
        n[0] /= nl; n[1] /= nl; n[2] /= nl;
        const w = [x[0] - A[0], x[1] - A[1], x[2] - A[2]];
        const height = w[0] * n[0] + w[1] * n[1] + w[2] * n[2];
        const q = [w[0] - n[0] * height, w[1] - n[1] * height, w[2] - n[2] * height];
        const d00 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], d01 = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], d11 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        const d20 = q[0] * u[0] + q[1] * u[1] + q[2] * u[2], d21 = q[0] * v[0] + q[1] * v[1] + q[2] * v[2];
        const den = d00 * d11 - d01 * d01 || 1e-12;
        let bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den;
        // Clamped into the triangle: a point past an edge rides on the nearest edge.
        bv = Math.max(0, bv); bw = Math.max(0, bw);
        if (bv + bw > 1) { const k = bv + bw; bv /= k; bw /= k; }
        const bu = 1 - bv - bw;
        const px = A[0] + u[0] * bv + v[0] * bw, py = A[1] + u[1] * bv + v[1] * bw, pz = A[2] + u[2] * bv + v[2] * bw;
        return { bary: [bu, bv, bw], height, dist: Math.hypot(x[0] - px, x[1] - py, x[2] - pz) };
    }

    /** The shaped positions with a helper laid on the skin by its binding. */
    function boundPositions(pack, built, name, cache) {
        const key = 'bound:' + name;
        if (cache[key]) return cache[key];
        const P = Float32Array.from(built.shaped);
        const bind = binding(pack, name);
        bind.ids.forEach((v, i) => {
            const a = bind.tri[i * 3], b = bind.tri[i * 3 + 1], c = bind.tri[i * 3 + 2];
            if (a === b && b === c) return;
            const A = a * 3, B = b * 3, C = c * 3;
            const u = [P[B] - P[A], P[B + 1] - P[A + 1], P[B + 2] - P[A + 2]], w = [P[C] - P[A], P[C + 1] - P[A + 1], P[C + 2] - P[A + 2]];
            const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            const nl = Math.hypot(...n) || 1;
            const [ba, bb, bc] = [bind.bary[i * 3], bind.bary[i * 3 + 1], bind.bary[i * 3 + 2]];
            for (let k = 0; k < 3; k++) P[v * 3 + k] = built.shaped[A + k] * ba + built.shaped[B + k] * bb + built.shaped[C + k] * bc + n[k] / nl * bind.height[i];
        });
        return (cache[key] = P);
    }

    /** Pushes points out of the body wherever they lie within `gap` of the skin or under it. */
    function collide(pack, built, positions, start, end, gap, cache) {
        if (!cache.bodyGrid) {
            cache.bodyNormals = Body.vertexNormals(pack, built.shaped);
            cache.bodyGrid = pointGrid(built.shaped, new Set(pack.body.source), 0.04);
        }
        const P = built.shaped, N = cache.bodyNormals;
        for (let i = start; i < end; i++) {
            const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
            const q = cache.bodyGrid.nearest(x, y, z, 2);
            if (q < 0) continue;
            const d = (x - P[q * 3]) * N[q * 3] + (y - P[q * 3 + 1]) * N[q * 3 + 1] + (z - P[q * 3 + 2]) * N[q * 3 + 2];
            if (d < gap) {
                const k = gap - d;
                positions[i * 3] += N[q * 3] * k; positions[i * 3 + 1] += N[q * 3 + 1] * k; positions[i * 3 + 2] += N[q * 3 + 2] * k;
            }
        }
    }

    // ── cutting ───────────────────────────────────────────────────────────
    /**
     * A garment's coverage of one vertex: positive inside, negative outside,
     * zero on the cut line, in chain units. `rules` name an interval along a
     * chain for any of spine, arms, legs ([lo, hi], or a function of the
     * vertex's angle returning one), and optionally `open` (a gap down the
     * front, in radians) and `back` (a gap behind).
     */
    function coverage(an, v, rules) {
        let c = 0;
        for (let fi = 0; fi < 5; fi++) {
            const m = an.member[v * 5 + fi];
            if (m <= 0) continue;
            const key = fi === 0 ? 'spine' : fi < 3 ? 'arms' : 'legs';
            const rule = rules[key];
            let cf = -1;
            if (rule) {
                const ang = an.angle[v * 5 + fi];
                const side = fi === 1 || fi === 3 ? 1 : -1;
                const [lo, hi] = typeof rule === 'function' ? rule(ang, side) : rule;
                const sv = an.s[v * 5 + fi];
                cf = Math.max(-1, Math.min(1, Math.min(sv - lo, hi - sv)));
            }
            c += m * cf;
        }
        if (rules.open) {
            const a = Math.abs(an.angle[v * 5]);
            c = Math.min(c, (a - rules.open) * 0.6);
        }
        return c;
    }

    function skinOf(pack, v) {
        return { joints: pack.skinJoints.subarray(v * 4, v * 4 + 4), weights: pack.skinWeights.subarray(v * 4, v * 4 + 4) };
    }

    /** Two skins mixed (a vertex on an edge): the four strongest influences of both. */
    function mixSkin(pack, a, b, t) {
        const m = new Map();
        for (const [v, w] of [[a, 1 - t], [b, t]]) for (let k = 0; k < 4; k++) {
            const j = pack.skinJoints[v * 4 + k], x = pack.skinWeights[v * 4 + k] * w;
            if (x > 0) m.set(j, (m.get(j) || 0) + x);
        }
        const top = [...m.entries()].sort((p, q) => q[1] - p[1]).slice(0, 4);
        const total = top.reduce((sum, e) => sum + e[1], 0) || 1;
        const joints = new Uint8Array(4), weights = new Float32Array(4);
        top.forEach(([j, w], k) => { joints[k] = j; weights[k] = w / total; });
        return { joints, weights };
    }

    /**
     * The piece of a surface ({source, uv, index}) where `value` (per pack
     * vertex) is at least zero, its triangles clipped exactly along the zero
     * line. Returns vertices as pack-vertex pairs {a, b, t} with uvs, the
     * triangle list and the value at each vertex.
     */
    function cut(surface, value) {
        const verts = [], uvs = [], vals = [], index = [];
        const keyOf = new Map();
        const at = (ra, rb, t) => {
            // ra, rb: render-vertex ids of the surface. Keyed by the pack vertices, so a uv seam stays closed.
            if (t <= 0 || ra === rb) t = 0;
            if (t >= 1) { const x = ra; ra = rb; rb = x; t = 0; }
            const pa = surface.source[ra], pb = surface.source[rb];
            const key = t === 0 ? pa + ':' : (pa < pb ? pa + ':' + pb + ':' + t.toFixed(5) : pb + ':' + pa + ':' + (1 - t).toFixed(5));
            let i = keyOf.get(key);
            if (i !== undefined) return i;
            i = verts.length;
            keyOf.set(key, i);
            const a = surface.source[ra], b = surface.source[rb];
            verts.push({ a, b, t });
            uvs.push(surface.uv[ra * 2] * (1 - t) + surface.uv[rb * 2] * t, surface.uv[ra * 2 + 1] * (1 - t) + surface.uv[rb * 2 + 1] * t);
            vals.push(value[a] * (1 - t) + value[b] * t);
            return i;
        };
        for (let f = 0; f < surface.index.length; f += 3) {
            const r = [surface.index[f], surface.index[f + 1], surface.index[f + 2]];
            const c = r.map(x => value[surface.source[x]]);
            const inside = c.map(x => x >= 0);
            const count = inside.filter(Boolean).length;
            if (count === 0) continue;
            if (count === 3) { index.push(at(r[0], r[0], 0), at(r[1], r[1], 0), at(r[2], r[2], 0)); continue; }
            // Walk the triangle's edges, keeping inside corners and the crossings (a polygon of 3 or 4).
            const poly = [];
            for (let k = 0; k < 3; k++) {
                const i = k, j = (k + 1) % 3;
                if (inside[i]) poly.push(at(r[i], r[i], 0));
                if (inside[i] !== inside[j]) poly.push(at(r[i], r[j], c[i] / (c[i] - c[j])));
            }
            for (let k = 1; k + 1 < poly.length; k++) index.push(poly[0], poly[k], poly[k + 1]);
        }
        return { verts, uvs: Float32Array.from(uvs), vals: Float32Array.from(vals), index: Uint32Array.from(index) };
    }

    /** Each piece vertex's neighbors in the piece. */
    function pieceNeighbors(count, index) {
        const sets = Array.from({ length: count }, () => new Set());
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t], b = index[t + 1], c = index[t + 2];
            sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b);
        }
        return sets.map(s => [...s]);
    }

    /** Edges used by one triangle only: the piece's open border, as [a, b] in winding order. */
    function borderEdges(index) {
        const count = new Map();
        for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) {
            const a = index[t + k], b = index[t + (k + 1) % 3];
            const key = a < b ? a + ',' + b : b + ',' + a;
            const e = count.get(key);
            if (e) e.n++; else count.set(key, { n: 1, a, b });
        }
        return [...count.values()].filter(e => e.n === 1).map(e => [e.a, e.b]);
    }

    /** Relaxes a per-pack-vertex scalar over the given surface's faces. */
    function relaxScalar(surface, value, passes, count) {
        const sets = new Map();
        for (let t = 0; t < surface.index.length; t += 3) {
            const v = [surface.source[surface.index[t]], surface.source[surface.index[t + 1]], surface.source[surface.index[t + 2]]];
            for (let k = 0; k < 3; k++) {
                if (!sets.has(v[k])) sets.set(v[k], new Set());
                sets.get(v[k]).add(v[(k + 1) % 3]).add(v[(k + 2) % 3]);
            }
        }
        const list = [...sets.entries()].map(([v, s]) => [v, [...s]]);
        let a = value, b = Float32Array.from(value);
        for (let p = 0; p < passes; p++) {
            for (const [v, near] of list) {
                let sum = 0;
                for (const u of near) sum += a[u];
                b[v] = 0.5 * a[v] + 0.5 * sum / near.length;
            }
            const x = a; a = b; b = x;
        }
        return a;
    }

    // ── garments ──────────────────────────────────────────────────────────
    /**
     * A garment's cut is worked out once for its settings and kept: the
     * pack's anatomy is measured on the average body, so the same cut fits
     * every recipe.
     */
    function cutFor(pack, spec) {
        pack._cuts = pack._cuts || new Map();
        const key = JSON.stringify(spec.cutKey);
        if (pack._cuts.has(key)) return pack._cuts.get(key);
        const an = anatomy(pack);
        const surface = pack.helpers[spec.surface] || pack.body;
        const value = new Float32Array(pack.vertexCount).fill(-1);
        const used = new Set(surface.source);
        for (const v of used) value[v] = spec.value ? spec.value(an, v) : coverage(an, v, spec.rules);
        const smooth = relaxScalar(surface, value, spec.smoothCut ?? 3);
        const piece = cut(surface, smooth);
        piece.neighbors = pieceNeighbors(piece.verts.length, piece.index);
        piece.border = borderEdges(piece.index);
        // Fields at each piece vertex, for patterns: spine/limb position and angle, blended like the vertex.
        piece.field = piece.verts.map(({ a, b, t }) => {
            const f = v => {
                let best = 0;
                for (let fi = 1; fi < 5; fi++) if (an.member[v * 5 + fi] > an.member[v * 5 + best]) best = fi;
                return { fam: best, s: an.s[v * 5 + best], ang: an.angle[v * 5 + best], u: an.skirtU[v] };
            };
            const fa = f(a), fb = f(b);
            const y = an.rest[a * 3 + 1] * (1 - t) + an.rest[b * 3 + 1] * t;
            return { fam: fa.fam, s: fa.s * (1 - t) + (fa.fam === fb.fam ? fb.s : fa.s) * t, ang: fa.ang, u: fa.u * (1 - t) + fb.u * t, y };
        });
        // Distance from the cut line, along the surface, for hems and trims (in chain units, from the cut value).
        piece.skins = piece.verts.map(({ a, b, t }) => (t === 0 ? skinOf(pack, a) : mixSkin(pack, a, b, t)));
        pack._cuts.set(key, piece);
        return piece;
    }

    /** Smooth normals of a surface's pack vertices, from the shaped positions. */
    function surfaceNormals(surface, P, count) {
        const n = new Float32Array(count * 3);
        for (let t = 0; t < surface.index.length; t += 3) {
            const a = surface.source[surface.index[t]] * 3, b = surface.source[surface.index[t + 1]] * 3, c = surface.source[surface.index[t + 2]] * 3;
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
            const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { n[s] += nx; n[s + 1] += ny; n[s + 2] += nz; }
        }
        for (let i = 0; i < n.length; i += 3) {
            const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
            if (l > 0) { n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
        }
        return n;
    }

    function triangleNormals(positions, index) {
        const n = new Float32Array(positions.length);
        for (let t = 0; t < index.length; t += 3) {
            const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
            const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
            const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            for (const s of [a, b, c]) { n[s] += nx; n[s + 1] += ny; n[s + 2] += nz; }
        }
        for (let i = 0; i < n.length; i += 3) {
            const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
            n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
        }
        return n;
    }

    /**
     * Lays a cut piece on a shaped body: lifted by `lift` meters, draped by
     * `drape` smoothing passes (held at least `lift` off the body), flared
     * (`flare(field)` adds meters straight out from the body's axis), with a
     * rim along its border folding back to the body so the cut edge has a
     * thickness. Returns {positions, normals, uvs, index, joints, weights, field, border}.
     */
    function lay(pack, built, piece, spec, cache) {
        cache.normals = cache.normals || {};
        const bound = spec.surface === 'tights';
        const P = bound ? boundPositions(pack, built, 'tights', cache) : built.shaped, count = piece.verts.length;
        const surface = pack.helpers[spec.surface] || pack.body;
        const sn = cache.normals[spec.surface] || (cache.normals[spec.surface] = surfaceNormals(surface, P, pack.vertexCount));
        const base = new Float32Array(count * 3), normal = new Float32Array(count * 3);
        piece.verts.forEach(({ a, b, t }, i) => {
            for (let k = 0; k < 3; k++) {
                base[i * 3 + k] = P[a * 3 + k] * (1 - t) + P[b * 3 + k] * t;
                normal[i * 3 + k] = sn[a * 3 + k] * (1 - t) + sn[b * 3 + k] * t;
            }
            const l = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]) || 1;
            normal[i * 3] /= l; normal[i * 3 + 1] /= l; normal[i * 3 + 2] /= l;
        });
        const lift = spec.lift ?? 0.006;
        let pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const extra = spec.liftAt ? spec.liftAt(piece.field[i], piece.vals[i]) : 0;
            for (let k = 0; k < 3; k++) pos[i * 3 + k] = base[i * 3 + k] + normal[i * 3 + k] * (lift + extra);
        }
        if (spec.flare) {
            const hips = built.bones.find(b => b.name === 'Hips').head;
            for (let i = 0; i < count; i++) {
                const amount = spec.flare(piece.field[i]);
                if (!amount) continue;
                const dx = pos[i * 3] - hips[0], dz = pos[i * 3 + 2] - hips[2];
                const l = Math.hypot(dx, dz) || 1;
                pos[i * 3] += dx / l * amount; pos[i * 3 + 2] += dz / l * amount;
            }
        }
        // Drape: smooth, then push back out wherever the smoothing sank into the body.
        const passes = spec.drape ?? 0;
        if (passes > 0) {
            let next = new Float32Array(pos.length);
            const N = piece.neighbors;
            for (let p = 0; p < passes; p++) {
                for (let i = 0; i < count; i++) {
                    const near = N[i];
                    if (!near.length) { next[i * 3] = pos[i * 3]; next[i * 3 + 1] = pos[i * 3 + 1]; next[i * 3 + 2] = pos[i * 3 + 2]; continue; }
                    let x = 0, y = 0, z = 0;
                    for (const j of near) { x += pos[j * 3]; y += pos[j * 3 + 1]; z += pos[j * 3 + 2]; }
                    const k = 1 / near.length;
                    next[i * 3] = 0.5 * pos[i * 3] + 0.5 * x * k;
                    next[i * 3 + 1] = 0.5 * pos[i * 3 + 1] + 0.5 * y * k;
                    next[i * 3 + 2] = 0.5 * pos[i * 3 + 2] + 0.5 * z * k;
                    // Never closer to the body than its lift.
                    const ox = next[i * 3] - base[i * 3], oy = next[i * 3 + 1] - base[i * 3 + 1], oz = next[i * 3 + 2] - base[i * 3 + 2];
                    const d = ox * normal[i * 3] + oy * normal[i * 3 + 1] + oz * normal[i * 3 + 2];
                    if (d < lift * 0.85) {
                        const push = lift * 0.85 - d;
                        next[i * 3] += normal[i * 3] * push; next[i * 3 + 1] += normal[i * 3 + 1] * push; next[i * 3 + 2] += normal[i * 3 + 2] * push;
                    }
                }
                const x = pos; pos = next; next = x;
            }
        }
        // Whatever still lies in the skin (a slider pushed past what the helper follows) is lifted out.
        if (spec.collide !== false) collide(pack, built, pos, 0, count, lift * 0.7, cache);
        // The rim: each border vertex gets a twin back down at the body, a strip between them.
        const index = Array.from(piece.index);
        const positions = Array.from(pos), uvs = Array.from(piece.uvs);
        const fields = piece.field.slice(), skins = piece.skins.slice(), vals = Array.from(piece.vals);
        const origin = piece.verts.map((_, i) => i);
        const rimOf = new Map();
        const rim = i => {
            if (rimOf.has(i)) return rimOf.get(i);
            const j = positions.length / 3;
            origin.push(i);
            const depth = spec.rimDepth ?? 0.85;
            for (let k = 0; k < 3; k++) positions.push(pos[i * 3 + k] - (pos[i * 3 + k] - base[i * 3 + k]) * depth);
            uvs.push(piece.uvs[i * 2], piece.uvs[i * 2 + 1]);
            fields.push(piece.field[i]); skins.push(piece.skins[i]); vals.push(-1);
            rimOf.set(i, j);
            return j;
        };
        if (spec.rim !== false) {
            for (const [a, b] of piece.border) {
                const ra = rim(a), rb = rim(b);
                // Border edge a→b runs with its triangle; the strip faces outward.
                index.push(b, a, ra, b, ra, rb);
            }
        }
        const out = Float32Array.from(positions);
        const joints = new Uint8Array(skins.length * 4), weights = new Float32Array(skins.length * 4);
        skins.forEach((s, i) => { joints.set(s.joints, i * 4); weights.set(s.weights, i * 4); });
        return { positions: out, normals: triangleNormals(out, index), uvs: Float32Array.from(uvs), index: Uint32Array.from(index), joints, weights, field: fields, vals: Float32Array.from(vals), base, rimStart: count, origin: Int32Array.from(origin), piece };
    }

    // ── patterns ──────────────────────────────────────────────────────────
    /** A vertex's color: the garment's pattern from its body position, the trim along its cut lines. */
    function paint(laid, look) {
        const c1 = linear(look.color), c2 = linear(look.color2 || look.color), trim = linear(look.trim || look.color2 || look.color);
        const n = laid.positions.length / 3;
        const colors = new Float32Array(n * 3);
        const scale = look.scale || 1;
        for (let i = 0; i < n; i++) {
            const f = laid.field[i];
            // Bands run around the body: by height on the trunk, along the chain on a limb.
            const s = (f.fam === 0 ? f.y * 5 : f.s) * scale, a = f.ang;
            let t = 0;
            switch (look.pattern) {
                case 'stripes': t = (Math.floor(s * 4) & 1); break;
                case 'pinstripes': t = (s * 10 % 1) < 0.18 ? 1 : 0; break;
                case 'vstripes': t = Math.floor((a / Math.PI + 1) * 6 * scale) & 1; break;
                case 'checker': t = (Math.floor(s * 4) + Math.floor((a / Math.PI + 1) * 6 * scale)) & 1; break;
                case 'plaid': {
                    const u = (s * 3) % 1, v = ((a / Math.PI + 1) * 4 * scale) % 1;
                    t = ((u < 0.3) ? 0.5 : 0) + ((v < 0.3) ? 0.5 : 0);
                    break;
                }
                case 'gradient': t = smoothstep(look.from ?? 0, look.to ?? 4, f.s); break;
                case 'halves': t = laid.positions[i * 3] < 0 ? 1 : 0; break;
                case 'camo': {
                    const p = laid.positions;
                    const x = p[i * 3] * 9, y = p[i * 3 + 1] * 9, z = p[i * 3 + 2] * 9;
                    const v = Math.sin(x * 1.7 + Math.sin(y * 1.3)) + Math.sin(y * 2.1 + Math.cos(z * 1.9)) + Math.sin(z * 1.5 + x * 0.7);
                    t = v > 0.6 ? 1 : v < -0.9 ? 0.5 : 0;
                    break;
                }
                default: t = 0;
            }
            let rgb = mixRgb(c1, c2, t);
            // Trim along the cut lines (the hem, cuffs, collar) and on the rim.
            if (look.trimWidth && (laid.vals[i] < look.trimWidth)) rgb = trim;
            // A little darker toward the body at the rim, as a fold would be.
            if (laid.vals[i] < 0) rgb = rgb.map(x => x * 0.7);
            colors.set(rgb, i * 3);
        }
        return colors;
    }

    const api = { binding, boundPositions, collide, pointGrid, FAMILIES, CHAINS, linear, anatomy, coverage, cut, cutFor, lay, paint, mixSkin, surfaceNormals, triangleNormals, relaxScalar };
    root.RRCharacterOutfit = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

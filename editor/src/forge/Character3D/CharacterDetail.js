/**
 * RRCharacterDetail - the small things the body's own picture is too coarse
 * for: the areolas and nipples, and body hair.
 *
 * The skin picture spreads a whole body over 1024 texels, so a 4 cm areola
 * gets about twenty and blurs. Here each areola is a patch of the body's own
 * triangles, lifted a hair off the skin, with a picture of its own laid flat
 * on it: 256 texels for a few centimeters, sharp at any distance. It shares
 * the body's vertices and skin weights, so it moves and bends with it.
 *
 * Body hair is real hair: strands grown out of the skin, each a narrow card
 * carrying a strand picture, leaning the way hair grows at its root (down
 * the limbs, down and in on the chest, out over the face), longer and curlier
 * where it grows so (the armpits, the groin), dense as the region's setting.
 * Each strand rides on one body triangle by barycentric weights, so the same
 * hair is laid on any body the sliders make, and on the fast drag path it
 * moves with its triangle's first corner.
 */
(function(root) {
    'use strict';

    const Outfit = root.RRCharacterOutfit || (typeof require === 'function' ? require('./CharacterOutfit.js') : null);
    const fract = x => x - Math.floor(x);
    const hash = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
    const toByte = c => Math.max(0, Math.min(255, Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)));
    const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
    function noise2(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const a = hash(ix, iy, 0), b = hash(ix + 1, iy, 0), c = hash(ix, iy + 1, 0), d = hash(ix + 1, iy + 1, 0);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    // ── areolas ───────────────────────────────────────────────────────────
    /**
     * Each areola's patch, worked out once on the average body: the body
     * triangles round the nipple (pack vertex ids) and each vertex's place on
     * the patch's own picture, flat on the plane the skin has there.
     */
    function areolaPatches(pack, reach) {
        pack._areolaPatches = pack._areolaPatches || new Map();
        const key = reach.toFixed(4);
        if (pack._areolaPatches.has(key)) return pack._areolaPatches.get(key);
        const Body = root.RRHumanBody || require('./HumanBody.js');
        const F = Body.anatomyFields(pack), B = pack.positions;
        const N = Body.vertexNormals(pack, B);
        const src = pack.body.source, I = pack.body.index;
        const patches = F.nipples.map(nip => {
            const c = [B[nip.v * 3], B[nip.v * 3 + 1], B[nip.v * 3 + 2]], n = [N[nip.v * 3], N[nip.v * 3 + 1], N[nip.v * 3 + 2]];
            // The patch's own axes: across the chest and up it, on the skin's plane.
            let t1 = [n[2], 0, -n[0]];
            const l1 = Math.hypot(...t1) || 1; t1 = t1.map(x => x / l1);
            const t2 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]];
            const tris = [];
            for (let t = 0; t < I.length; t += 3) {
                const v = [src[I[t]], src[I[t + 1]], src[I[t + 2]]];
                if (v.every(q => Math.hypot(B[q * 3] - c[0], B[q * 3 + 1] - c[1], B[q * 3 + 2] - c[2]) < reach * 1.15)) tris.push(...v);
            }
            const ids = [...new Set(tris)];
            const at = new Map(ids.map((v, i) => [v, i]));
            const uvs = new Float32Array(ids.length * 2);
            ids.forEach((v, i) => {
                const o = [B[v * 3] - c[0], B[v * 3 + 1] - c[1], B[v * 3 + 2] - c[2]];
                uvs[i * 2] = 0.5 + (o[0] * t1[0] + o[1] * t1[1] + o[2] * t1[2]) / (2 * reach);
                uvs[i * 2 + 1] = 0.5 - (o[0] * t2[0] + o[1] * t2[1] + o[2] * t2[2]) / (2 * reach);
            });
            return { ids, index: tris.map(v => at.get(v)), uvs };
        });
        pack._areolaPatches.set(key, patches);
        return patches;
    }

    /**
     * The areola picture: a rim of slightly darker, rosier skin fading into the
     * body's, the areola's own grain (Montgomery bumps round its edge, fine
     * folds toward the middle), the nipple at the center with a soft light on
     * it. Alpha fades the rim so the patch melts into the skin.
     */
    function areolaTexture(skinHex, options) {
        const o = options || {}, size = 256;
        const skin = Outfit.linear(skinHex || '#c69c7f');
        // A natural areola: the skin's own color, deeper and rosier, more so on fair skin.
        const lum = skin[0] * 0.3 + skin[1] * 0.59 + skin[2] * 0.11;
        // Close to the skin's own tone: a little deeper, a little rosier, never orange.
        const base = o.color ? Outfit.linear(o.color) : skin.map((c, i) => c * [0.8, 0.66, 0.66][i] * (0.92 + 0.08 * (1 - lum)));
        const nipple = base.map((c, i) => c * [0.88, 0.78, 0.78][i]);
        const R = o.areolaFrac || 0.36, tipR = R * (o.male ? 0.34 : 0.3) * (o.nippleScale || 1);
        const data = new Uint8Array(size * size * 4);
        const bumps = [];
        const rand = rng(91);
        for (let k = 0; k < 14; k++) { const a = rand() * Math.PI * 2, r = R * (0.62 + rand() * 0.3); bumps.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.006 + rand() * 0.007]); }
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const u = (x + 0.5) / size, v = (y + 0.5) / size, du = u - 0.5, dv = v - 0.5;
            // A slightly uneven edge, as real areolas have.
            const ang = Math.atan2(dv, du), wob = 1 + 0.06 * Math.sin(ang * 3 + 0.7) + 0.04 * Math.sin(ang * 7 + 2.1);
            const r = Math.hypot(du, dv) / wob;
            const edge = 1 - smooth(R * 0.82, R * 1.08, r);
            let rgb = mix(skin, base, Math.pow(edge, 0.8));
            // Fine radial folds and grain inside the areola.
            const folds = noise2(ang * 9, r * 60) * 0.5 + noise2(u * 180, v * 180) * 0.5;
            rgb = rgb.map(c => c * (0.9 + 0.14 * folds * edge));
            // Montgomery glands: small raised dots near the edge, a touch lighter with a darker ring.
            for (const [bx, by, br] of bumps) {
                const d = Math.hypot(u - bx, v - by);
                if (d < br) rgb = rgb.map(c => c * (1.06 - 0.12 * (d / br)));
            }
            // The nipple: darker, with its own creases and a soft light toward its top.
            if (r < tipR * 1.4) {
                const t = 1 - smooth(tipR * 0.75, tipR * 1.3, r);
                const crease = noise2(ang * 5, r * 120);
                rgb = mix(rgb, nipple.map(c => c * (0.85 + 0.2 * crease)), t);
                const hl = Math.max(0, 1 - Math.hypot(du + tipR * 0.25, dv + tipR * 0.35) / (tipR * 0.45));
                rgb = rgb.map(c => c + hl * 0.12 * t);
            }
            const o4 = (y * size + x) * 4;
            data[o4] = toByte(rgb[0]); data[o4 + 1] = toByte(rgb[1]); data[o4 + 2] = toByte(rgb[2]);
            // The patch itself fades out past the areola, so its square never shows.
            data[o4 + 3] = Math.round(255 * (1 - smooth(R * 0.95, R * 1.35, r)));
        }
        return { width: size, height: size, data, name: 'areola.png' };
    }

    /** The areola patches as one part over the shaped body (`P`, every pack vertex, floor at 0). */
    function areolaPart(pack, P, normals, reach, skinPart) {
        const patches = areolaPatches(pack, reach);
        const ids = [], index = [], uvs = [];
        for (const p of patches) {
            const base = ids.length;
            ids.push(...p.ids);
            for (const i of p.index) index.push(base + i);
            uvs.push(...p.uvs);
        }
        const n = ids.length, positions = new Float32Array(n * 3), nrm = new Float32Array(n * 3), joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
        ids.forEach((v, i) => {
            // A hair off the skin, so it draws over it without fighting.
            for (let k = 0; k < 3; k++) { nrm[i * 3 + k] = normals[v * 3 + k]; positions[i * 3 + k] = P[v * 3 + k] + normals[v * 3 + k] * 0.0004; }
            joints.set(pack.skinJoints.subarray(v * 4, v * 4 + 4), i * 4);
            weights.set(pack.skinWeights.subarray(v * 4, v * 4 + 4), i * 4);
        });
        void skinPart;
        return { name: 'Areolas', positions, normals: nrm, uvs: Float32Array.from(uvs), index: Uint32Array.from(index), joints, weights,
            texture: 'areola.png', opacity: 0.999, roughness: 0.5, kind: 'skin', source: Int32Array.from(ids), decal: true };
    }

    // ── body hair ─────────────────────────────────────────────────────────
    /**
     * The strands, worked out once per body hair setting on the average body:
     * each strand's triangle (pack vertex ids), its place in it, its lean,
     * length, curl and lane on the strand picture.
     */
    function hairStrands(pack, bodyHair, hidden) {
        const Skin = root.RRCharacterSkin || require('./CharacterSkin.js');
        const Body = root.RRHumanBody || require('./HumanBody.js');
        const key = JSON.stringify([bodyHair.regions, bodyHair.amount, bodyHair.fur, bodyHair.length]) + '|' + (hidden ? hidden.size : 0);
        pack._strandCache = pack._strandCache || { key: null };
        if (pack._strandCache.key === key) return pack._strandCache.strands;
        const an = Outfit.anatomy(pack), R = an.rest;
        const fields = Skin.fieldsOf(pack);
        const src = pack.body.source, I = pack.body.index;
        const famOf = v => { let best = 0; for (let fi = 1; fi < 5; fi++) if (an.member[v * 5 + fi] > an.member[v * 5 + best]) best = fi; return best; };
        // Density at each vertex, from the regions; strands per square meter at full density.
        const dens = new Float32Array(pack.vertexCount);
        const seen = new Set(src);
        for (const v of seen) {
            const fam = famOf(v);
            const p = { fam, s: an.s[v * 5 + fam], ang: an.angle[v * 5 + fam], n: [fields.normals[v * 3], fields.normals[v * 3 + 1], fields.normals[v * 3 + 2]],
                rest: [R[v * 3], R[v * 3 + 1], R[v * 3 + 2]], lips: fields.lips[v], lids: fields.lids[v], nose: fields.nose[v] };
            dens[v] = Skin.hairDensity(bodyHair.regions, p) * bodyHair.amount;
        }
        const fur = bodyHair.fur || 0;
        // Tufts per square meter at full density: each carries several strands (fur's, more and finer).
        const perM2 = (bodyHair.budget || 1) * (16000 + 4000 * fur);
        const rand = rng(1234);
        const strands = [];
        for (let t = 0; t < I.length; t += 3) {
            const a = src[I[t]], b = src[I[t + 1]], c = src[I[t + 2]];
            if (hidden && hidden.has(a) && hidden.has(b) && hidden.has(c)) continue;
            const d = (dens[a] + dens[b] + dens[c]) / 3;
            if (d < 0.02) continue;
            const ux = R[b * 3] - R[a * 3], uy = R[b * 3 + 1] - R[a * 3 + 1], uz = R[b * 3 + 2] - R[a * 3 + 2];
            const vx = R[c * 3] - R[a * 3], vy = R[c * 3 + 1] - R[a * 3 + 1], vz = R[c * 3 + 2] - R[a * 3 + 2];
            const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
            let count = area * perM2 * d;
            while (count > 0) {
                if (count < 1 && rand() > count) break;
                count -= 1;
                let s1 = rand(), s2 = rand();
                if (s1 + s2 > 1) { s1 = 1 - s1; s2 = 1 - s2; }
                const fam = famOf(a), sv = an.s[a * 5 + fam];
                // Coarser, longer, curlier hair where it grows so; fine short hair on the forearms and legs.
                const coarse = fam === 0 && (sv < 0.3 || (sv > 2.9 && sv < 3.4 && Math.abs(R[a * 3]) > 0.1)) ? 1 : 0;
                const face = fam === 0 && sv > 4.35;
                // Lengths as people grow them: chest and belly 1.5 to 2.5 cm, the groin and armpits longer
                // and curled, forearms and shins a little over a centimeter, a furred face short.
                const chest = fam === 0 && sv > 0.6 && sv < 3.9;
                const base = face ? 0.009 : coarse ? 0.024 : chest ? 0.019 : fam >= 3 ? 0.014 : 0.012;
                strands.push({ tri: [a, b, c], w: [1 - s1 - s2, s1, s2],
                    len: base * (0.65 + 0.7 * rand()) * (1 + fur * 0.9 * (bodyHair.length || 1)),
                    lean: 0.1 + 0.12 * rand() + fur * 0.2, curl: coarse ? 0.9 : chest ? 0.45 * rand() : 0.2 * rand(), twist: (rand() - 0.5) * 0.9,
                    lane: (fur > 0.3 && rand() < fur ? 2 : 0) + Math.floor(rand() * 2), shade: 0.75 + 0.3 * rand(), fam, x: R[a * 3] });
            }
        }
        pack._strandCache = { key, strands };
        return strands;
    }

    /** Which way hair lies at a place: down, out to the sides on the limbs and face, in toward the middle lower on the chest. */
    function flowAt(s) {
        if (s.fam === 1 || s.fam === 2) return [Math.sign(s.x) * 0.55, -0.83, 0];
        if (s.fam === 0) return [-Math.sign(s.x) * 0.3, -0.95, 0];
        return [0, -1, 0];
    }

    /**
     * The strands laid on a shaped body: each a narrow card from its root,
     * leaning out of the skin and along the flow, bending as it goes (two
     * segments), its width a few strands of the picture. Returns a part.
     */
    function hairPart(pack, P, normals, strands, color, options) {
        const o = options || {};
        const n = strands.length;
        const SEG = 3, perStrand = SEG * 2;
        const positions = new Float32Array(n * perStrand * 3), nrm = new Float32Array(n * perStrand * 3), uvs = new Float32Array(n * perStrand * 2), colors = new Float32Array(n * perStrand * 3);
        const joints = new Uint8Array(n * perStrand * 4), weights = new Float32Array(n * perStrand * 4), index = new Uint32Array(n * (SEG - 1) * 6), source = new Int32Array(n * perStrand);
        const rgb = Outfit.linear(color || '#2a1d15');
        let vi = 0, ii = 0;
        // A tuft is a few millimeters across: its picture holds the strands.
        const width = 0.0022 * (o.width || 1);
        for (const s of strands) {
            const [a, b, c] = s.tri, [wa, wb, wc] = s.w;
            const root3 = [0, 1, 2].map(k => P[a * 3 + k] * wa + P[b * 3 + k] * wb + P[c * 3 + k] * wc);
            let nn = [0, 1, 2].map(k => normals[a * 3 + k] * wa + normals[b * 3 + k] * wb + normals[c * 3 + k] * wc);
            const nl = Math.hypot(...nn) || 1; nn = nn.map(x => x / nl);
            let f = flowAt(s);
            f = [f[0] + s.twist * 0.5, f[1], f[2] + s.twist * 0.5];
            const fd = f[0] * nn[0] + f[1] * nn[1] + f[2] * nn[2];
            f = [f[0] - nn[0] * fd, f[1] - nn[1] * fd, f[2] - nn[2] * fd];
            const fl = Math.hypot(...f) || 1; f = f.map(x => x / fl);
            // Across the card: on the skin's plane, square to the flow.
            const side = [nn[1] * f[2] - nn[2] * f[1], nn[2] * f[0] - nn[0] * f[2], nn[0] * f[1] - nn[1] * f[0]];
            const u0 = s.lane * 0.25, u1 = u0 + 0.25;
            const base = vi;
            let p = root3.slice();
            for (let g = 0; g < SEG; g++) {
                const t = g / (SEG - 1);
                if (g > 0) {
                    // Out of the skin at first, lying down along the flow further out; curl turns it sideways.
                    const lift = s.lean * (1 - t * 0.6), turn = Math.sin(t * Math.PI * s.curl) * s.curl * 0.8;
                    const dir = [f[0] + nn[0] * lift + side[0] * turn, f[1] + nn[1] * lift + side[1] * turn, f[2] + nn[2] * lift + side[2] * turn];
                    const dl = Math.hypot(...dir) || 1;
                    p = p.map((x, k) => x + dir[k] / dl * s.len / (SEG - 1));
                }
                const w = width * (1 - t * 0.5);
                for (const k of [-1, 1]) {
                    positions.set([p[0] + side[0] * w * k, p[1] + side[1] * w * k, p[2] + side[2] * w * k], vi * 3);
                    nrm.set(nn, vi * 3);
                    uvs.set([k < 0 ? u0 : u1, 0.05 + t * 0.9], vi * 2);
                    colors.set(rgb.map(x => x * s.shade * (0.85 + 0.15 * t)), vi * 3);
                    joints.set(pack.skinJoints.subarray(a * 4, a * 4 + 4), vi * 4);
                    weights.set(pack.skinWeights.subarray(a * 4, a * 4 + 4), vi * 4);
                    source[vi] = a;
                    vi++;
                }
            }
            for (let g = 0; g + 1 < SEG; g++) {
                const q = base + g * 2;
                index.set([q, q + 2, q + 1, q + 1, q + 2, q + 3], ii);
                ii += 6;
            }
        }
        return { name: o.name || 'Body hair', positions, normals: nrm, uvs, colors, index, joints, weights, texture: 'bodyhair.png', cutout: true, alphaCutoff: 0.35,
            keepColors: true, doubleSided: true, roughness: 0.75, kind: 'hair', source };
    }

    /**
     * Body hair's strand picture: four lanes, each a tuft (two of three or four
     * strands for body hair, two of eight finer ones for fur), each strand its
     * own length and drift, tapering to its tip.
     */
    function bodyHairTexture(size = 256) {
        const data = new Uint8Array(size * size * 4);
        const rand = rng(5);
        const strands = [];
        for (let lane = 0; lane < 4; lane++) {
            const count = lane < 2 ? 4 + lane : 9, fine = lane < 2 ? 0.8 : 0.55;
            // Strands bunched irregularly (never evenly spaced), each its own darkness and drift.
            for (let k = 0; k < count; k++) strands.push({ u: lane * 0.25 + 0.025 + rand() * 0.2, len: 0.45 + rand() * 0.55, wob: (rand() - 0.5) * 0.09, lane, fine: fine * (0.7 + 0.6 * rand()), ink: 0.55 + 0.45 * rand() });
        }
        for (const st of strands) for (let y = 0; y < size; y++) {
            const v = (y + 0.5) / size;
            if (v > st.len) break;
            const tip = 1 - v / st.len, w = (0.004 + 0.006 * tip) * st.fine * size, cu = (st.u + st.wob * v * v) * size;
            for (let x = Math.floor(cu - w - 1); x <= Math.ceil(cu + w + 1); x++) {
                if (x < st.lane * size / 4 || x >= (st.lane + 1) * size / 4) continue;
                const d = Math.abs(x + 0.5 - cu) / w;
                if (d > 1) continue;
                const o = (y * size + x) * 4, a = Math.round(255 * (1 - d * d) * Math.min(1, tip * 5) * st.ink);
                if (a > data[o + 3]) { data[o] = data[o + 1] = data[o + 2] = 235; data[o + 3] = a; }
            }
        }
        return { width: size, height: size, data, name: 'bodyhair.png' };
    }

    const api = { areolaPatches, areolaTexture, areolaPart, hairStrands, hairPart, bodyHairTexture };
    root.RRCharacterDetail = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

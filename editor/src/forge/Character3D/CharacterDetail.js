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

    /** Smooth 3D value noise, 0..1, for patterns over the body that drift rather than jump. */
    function noise3(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
        let out = 0;
        for (let k = 0; k < 8; k++) {
            const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
            const h = Math.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + (iz + dz) * 74.7) * 43758.5453;
            out += (h - Math.floor(h)) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        }
        return out;
    }

    /**
     * Which way body hair grows at a place on the average body, as it does on
     * people: on the upper chest out from the breastbone and up toward the
     * shoulders, lower down in toward the middle and down it in a trail to
     * the groin; on the back down and out over the shoulders; down the limbs
     * toward the hands and feet.
     */
    function flowOf(fam, sv, p, front) {
        const sx = Math.sign(p[0]) || 1, mid = Math.min(1, Math.abs(p[0]) / 0.04);
        if (fam === 0) {
            if (sv > 4.35) return [sx * 0.15, -1, 0.15];
            if (front) {
                if (sv > 2.6) return [sx * 0.75 * mid, -0.25 + 0.6 * mid, 0];
                if (sv > 0.4) return [-sx * 0.45 * mid, -0.95, 0];
                return [-sx * 0.3 * mid, -0.95, 0];
            }
            if (sv > 3.4) return [sx * 0.8, -0.35, 0];
            return [sx * 0.25, -0.95, 0];
        }
        if (fam === 1 || fam === 2) return [sx * 0.55, -0.83, 0];
        return [sx * 0.15, -1, 0];
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
        let base = o.color ? Outfit.linear(o.color) : skin.map((c, i) => c * [0.8, 0.66, 0.66][i] * (0.92 + 0.08 * (1 - lum)));
        // Under body hair or fur the skin round the areola takes the hair's color as the skin painter lays it,
        // and the areola mostly gives way to it, so no bare disc shows through the coat.
        if (o.under && o.cover > 0) {
            const u = Outfit.linear(o.under);
            for (let k = 0; k < 3; k++) { skin[k] += (u[k] - skin[k]) * o.cover; base[k] += (u[k] - base[k]) * o.cover * 0.8; }
        }
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
            texture: 'areola.png', opacity: 0.999, roughness: 0.5, kind: 'skin', source: Int32Array.from(ids), decal: true, noShade: true };
    }

    // ── body hair ─────────────────────────────────────────────────────────
    /**
     * The strands, worked out once per body hair setting on the average body:
     * each strand's triangle (pack vertex ids), its place in it, its lean,
     * length, curl and lane on the strand picture.
     */
    function hairStrands(pack, bodyHair, hidden, mode = 'tuft') {
        const Skin = root.RRCharacterSkin || require('./CharacterSkin.js');
        const key = mode + JSON.stringify([bodyHair.regions, bodyHair.amount, bodyHair.fur, bodyHair.length, bodyHair.budget]) + '|' + (hidden ? hidden.size : 0);
        pack._strandCache = pack._strandCache || new Map();
        if (pack._strandCache.has(key)) return pack._strandCache.get(key);
        const an = Outfit.anatomy(pack), R = an.rest;
        const src = pack.body.source, I = pack.body.index;
        const famOf = v => { let best = 0; for (let fi = 1; fi < 5; fi++) if (an.member[v * 5 + fi] > an.member[v * 5 + best]) best = fi; return best; };
        // Density at each vertex, from the regions; strands per square meter at full density.
        const field = Skin.hairField(pack, bodyHair.regions), dens = field.map(d => d * bodyHair.amount);
        const fur = bodyHair.fur || 0;
        // Tufts per square meter at full density: each carries several strands (fur's, more and finer).
        // Single strands for body hair (about four a square centimeter at full), tufts for fur.
        const perM2 = (bodyHair.budget || 1) * (mode === 'strand' ? 40000 : mode === 'clump' ? 16000 : 10000 + 16000 * fur);
        const rand = rng(1234);
        const strands = [];
        for (let t = 0; t < I.length; t += 3) {
            const a = src[I[t]], b = src[I[t + 1]], c = src[I[t + 2]];
            if (hidden && hidden.has(a) && hidden.has(b) && hidden.has(c)) continue;
            const d = (dens[a] + dens[b] + dens[c]) / 3;
            if (d < 0.02) continue;
            // Where hair is sparse it is fine and short (vellus); where thick, full-length terminal hair.
            const full = Math.min(1, d * 1.6);
            const ux = R[b * 3] - R[a * 3], uy = R[b * 3 + 1] - R[a * 3 + 1], uz = R[b * 3 + 2] - R[a * 3 + 2];
            const vx = R[c * 3] - R[a * 3], vy = R[c * 3 + 1] - R[a * 3 + 1], vz = R[c * 3 + 2] - R[a * 3 + 2];
            const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
            // Hair grows thicker in some patches than others; at its fullest, everywhere.
            const cx = (R[a * 3] + R[b * 3] + R[c * 3]) / 3, cy = (R[a * 3 + 1] + R[b * 3 + 1] + R[c * 3 + 1]) / 3, cz = (R[a * 3 + 2] + R[b * 3 + 2] + R[c * 3 + 2]) / 3;
            const patch = 0.45 + 1.1 * noise3(cx * 14 + 3, cy * 14, cz * 14), even = Math.min(1, d * 1.15) ** 3;
            let count = area * perM2 * d * (mode === 'clump' ? 0.7 + 0.7 * d : 1) * (patch + (1 - patch) * even);
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
                const base = mode === 'clump' ? (face ? 0.01 : coarse ? 0.03 : chest ? 0.024 : fam >= 3 ? 0.017 : 0.015) : face ? 0.009 : coarse ? 0.024 : chest ? 0.019 : fam >= 3 ? 0.014 : 0.012;
                const at = [R[a * 3], R[a * 3 + 1], R[a * 3 + 2]], front = Math.cos(an.angle[a * 5 + fam]) > 0;
                strands.push({ tri: [a, b, c], w: [1 - s1 - s2, s1, s2],
                    len: base * (0.65 + 0.7 * rand()) * (mode === 'clump' ? (0.6 + 0.9 * full) * (bodyHair.length || 1) : mode === 'strand' ? 0.35 + 0.65 * full : 1 + fur * 1.4 * (bodyHair.length || 1)), fine: full,
                    // A coat stands off the skin and lies one way, combed; single hairs lie close and stray more.
                    lean: mode !== 'tuft' ? 0.1 + 0.12 * rand() : 0.28 + 0.22 * rand() + fur * 0.25,
                    // The lie: the place's own flow, turned by a slow drift over the body (neighbors comb the same
                    // way, whorls form) and a little by each lock; the curliest hair, at the groin, every way.
                    flow: flowOf(fam, sv, at, front),
                    curl: coarse ? 0.9 : chest ? 0.45 * rand() : 0.2 * rand(),
                    twist: (noise3(at[0] * 9, at[1] * 9, at[2] * 9) - 0.5) * 1.3 + (rand() - 0.5) * (coarse ? 2.5 : 0.3),
                    // A clump carries more hairs where hair grows thick (the picture's lanes run sparse to dense).
                    lane: mode === 'clump' ? Math.min(3, Math.floor(d * 3.2 + rand() * 0.8)) : (fur > 0.3 && rand() < fur ? 2 : 0) + Math.floor(rand() * 2), shade: mode !== 'tuft' ? 0.75 + 0.3 * rand() : 0.82 + 0.36 * rand(), fam, x: R[a * 3] });
            }
        }
        if (pack._strandCache.size > 6) pack._strandCache.clear();
        pack._strandCache.set(key, strands);
        return strands;
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
        const rgb = Outfit.linear(color || '#2a1d15'), skin = Outfit.linear(o.skin || '#c69c7f');
        let vi = 0, ii = 0;
        // A tuft is a few millimeters across: its picture holds the strands.
        const single = o.mode === 'strand', clump = o.mode === 'clump';
        const width = (single ? 0.00028 : clump ? 0.0032 : 0.0022) * (o.width || 1);
        const SKJ = pack.skinJoints, SKW = pack.skinWeights;
        for (let si = 0; si < n; si++) {
            const s = strands[si], a = s.tri[0], b = s.tri[1], c = s.tri[2], wa = s.w[0], wb = s.w[1], wc = s.w[2];
            let px = P[a * 3] * wa + P[b * 3] * wb + P[c * 3] * wc, py = P[a * 3 + 1] * wa + P[b * 3 + 1] * wb + P[c * 3 + 1] * wc, pz = P[a * 3 + 2] * wa + P[b * 3 + 2] * wb + P[c * 3 + 2] * wc;
            let nx = normals[a * 3] * wa + normals[b * 3] * wb + normals[c * 3] * wc, ny = normals[a * 3 + 1] * wa + normals[b * 3 + 1] * wb + normals[c * 3 + 1] * wc, nz = normals[a * 3 + 2] * wa + normals[b * 3 + 2] * wb + normals[c * 3 + 2] * wc;
            let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
            // The flow at the root, on the skin's plane, turned about the skin's normal by the lock's twist.
            let [fx, fy, fz] = s.flow || [0, -1, 0];
            const fd = fx * nx + fy * ny + fz * nz;
            fx -= nx * fd; fy -= ny * fd; fz -= nz * fd;
            l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
            {
                const cs = Math.cos(s.twist), sn = Math.sin(s.twist), ox = ny * fz - nz * fy, oy = nz * fx - nx * fz, oz = nx * fy - ny * fx;
                fx = fx * cs + ox * sn; fy = fy * cs + oy * sn; fz = fz * cs + oz * sn;
            }
            const sx = ny * fz - nz * fy, sy = nz * fx - nx * fz, sz = nx * fy - ny * fx;
            const u0 = single ? 0 : s.lane * 0.25, u1 = single ? 1 : u0 + 0.25;
            const base = vi, step = s.len / (SEG - 1);
            // Fine hair is fainter: toward the color of the skin it grows on.
            const faint = single || clump ? 0.55 * (1 - (s.fine ?? 1)) : 0;
            const cr = (rgb[0] + (skin[0] - rgb[0]) * faint) * s.shade, cg = (rgb[1] + (skin[1] - rgb[1]) * faint) * s.shade, cb = (rgb[2] + (skin[2] - rgb[2]) * faint) * s.shade;
            for (let g = 0; g < SEG; g++) {
                const t = g / (SEG - 1);
                if (g > 0) {
                    // Out of the skin at first, lying down along the flow further out; curl turns it sideways.
                    const lift = s.lean * (1 - t * 0.6), turn = Math.sin(t * Math.PI * s.curl) * s.curl * 0.8;
                    let dx = fx + nx * lift + sx * turn, dy = fy + ny * lift + sy * turn, dz = fz + nz * lift + sz * turn;
                    const dl = Math.hypot(dx, dy, dz) || 1;
                    px += dx / dl * step; py += dy / dl * step; pz += dz / dl * step;
                }
                // Darker at the root; a tuft's tips catch the light, so a coat reads soft rather than speckled.
                // A clump's hairs fan out from its root, so its card keeps its width.
                const w = width * (single ? 1 - t * 0.65 : clump ? 0.8 + t * 0.2 : 1 - t * 0.5), tone = single || clump ? 0.85 + 0.15 * t : 0.78 + 0.45 * t * t;
                for (let k = -1; k <= 1; k += 2) {
                    const o3 = vi * 3, o4 = vi * 4;
                    positions[o3] = px + sx * w * k; positions[o3 + 1] = py + sy * w * k; positions[o3 + 2] = pz + sz * w * k;
                    nrm[o3] = nx; nrm[o3 + 1] = ny; nrm[o3 + 2] = nz;
                    uvs[vi * 2] = k < 0 ? u0 : u1; uvs[vi * 2 + 1] = 0.05 + t * 0.9;
                    colors[o3] = cr * tone; colors[o3 + 1] = cg * tone; colors[o3 + 2] = cb * tone;
                    joints[o4] = SKJ[a * 4]; joints[o4 + 1] = SKJ[a * 4 + 1]; joints[o4 + 2] = SKJ[a * 4 + 2]; joints[o4 + 3] = SKJ[a * 4 + 3];
                    weights[o4] = SKW[a * 4]; weights[o4 + 1] = SKW[a * 4 + 1]; weights[o4 + 2] = SKW[a * 4 + 2]; weights[o4 + 3] = SKW[a * 4 + 3];
                    source[vi] = a;
                    vi++;
                }
            }
            for (let g = 0; g + 1 < SEG; g++) {
                const q = base + g * 2;
                index[ii] = q; index[ii + 1] = q + 2; index[ii + 2] = q + 1; index[ii + 3] = q + 1; index[ii + 4] = q + 2; index[ii + 5] = q + 3;
                ii += 6;
            }
        }
        return { name: o.name || 'Body hair', positions, normals: nrm, uvs, colors, index, joints, weights, texture: single ? 'strand.png' : 'bodyhair.png', cutout: true, alphaCutoff: clump ? 0.15 : single ? 0.3 : 0.35,
            keepColors: true, doubleSided: true, roughness: 0.75, kind: 'hair', onSkin: true, source, noShade: true };
    }

    /**
     * Fur on a part that is not the body (a tail, an animal ear): tufts on
     * the body fur's own picture, so the two coats read as one. `roots`:
     * [{ p, n, flow, len, width, color (linear rgb), tip?, lift?, droop?,
     * joints, weights }]. Each tuft grows out of the surface along `n`,
     * lies down along `flow` and bends under its own weight; darker at the
     * root, its tips catching the light, as the body's do. Returns a part.
     */
    function furCards(roots, options) {
        const o = options || {}, n = roots.length, SEG = 3, per = SEG * 2;
        const positions = new Float32Array(n * per * 3), nrm = new Float32Array(n * per * 3), uvs = new Float32Array(n * per * 2), colors = new Float32Array(n * per * 3);
        const joints = new Uint8Array(n * per * 4), weights = new Float32Array(n * per * 4), index = new Uint32Array(n * (SEG - 1) * 6);
        const rand = rng(o.seed || 77);
        let vi = 0, ii = 0;
        for (const s of roots) {
            const N = s.n;
            let fx = s.flow[0], fy = s.flow[1], fz = s.flow[2];
            const fd = fx * N[0] + fy * N[1] + fz * N[2];
            fx -= N[0] * fd; fy -= N[1] * fd; fz -= N[2] * fd;
            let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
            // A little turn about the normal per tuft, so neighbors never comb in lockstep.
            const tw = (rand() - 0.5) * (s.twist ?? 0.6), cs = Math.cos(tw), sn = Math.sin(tw);
            const ox = N[1] * fz - N[2] * fy, oy = N[2] * fx - N[0] * fz, oz = N[0] * fy - N[1] * fx;
            [fx, fy, fz] = [fx * cs + ox * sn, fy * cs + oy * sn, fz * cs + oz * sn];
            const sx = N[1] * fz - N[2] * fy, sy = N[2] * fx - N[0] * fz, sz = N[0] * fy - N[1] * fx;
            const lane = s.lane ?? (2 + Math.floor(rand() * 2)), u0 = lane * 0.25, u1 = u0 + 0.25;
            const shade = 0.84 + 0.32 * rand(), step = s.len / (SEG - 1), lift = s.lift ?? 0.4, droop = s.droop ?? 0;
            const tip = s.tip || s.color;
            let px = s.p[0], py = s.p[1], pz = s.p[2];
            const base = vi;
            for (let g = 0; g < SEG; g++) {
                const t = g / (SEG - 1);
                if (g > 0) {
                    const up = lift * (1 - t * 0.6);
                    let dx = fx + N[0] * up, dy = fy + N[1] * up - droop * t, dz = fz + N[2] * up;
                    const dl = Math.hypot(dx, dy, dz) || 1;
                    px += dx / dl * step; py += dy / dl * step; pz += dz / dl * step;
                }
                const w = s.width * (1 - t * 0.45), tone = (0.78 + 0.45 * t * t) * shade;
                const c = mix(s.color, tip, t);
                for (let k = -1; k <= 1; k += 2) {
                    const o3 = vi * 3, o4 = vi * 4;
                    positions[o3] = px + sx * w * k; positions[o3 + 1] = py + sy * w * k; positions[o3 + 2] = pz + sz * w * k;
                    nrm[o3] = N[0]; nrm[o3 + 1] = N[1]; nrm[o3 + 2] = N[2];
                    uvs[vi * 2] = k < 0 ? u0 : u1; uvs[vi * 2 + 1] = 0.05 + t * 0.9;
                    colors[o3] = c[0] * tone; colors[o3 + 1] = c[1] * tone; colors[o3 + 2] = c[2] * tone;
                    for (let q = 0; q < 4; q++) { joints[o4 + q] = s.joints[q] || 0; weights[o4 + q] = s.weights[q] || 0; }
                    vi++;
                }
            }
            for (let g = 0; g + 1 < SEG; g++) {
                const q = base + g * 2;
                index[ii] = q; index[ii + 1] = q + 2; index[ii + 2] = q + 1; index[ii + 3] = q + 1; index[ii + 4] = q + 2; index[ii + 5] = q + 3;
                ii += 6;
            }
        }
        return { name: o.name || 'Feature fur', positions, normals: nrm, uvs, colors, index, joints, weights, texture: 'bodyhair.png', cutout: true, alphaCutoff: 0.35,
            keepColors: true, doubleSided: true, roughness: 0.75, kind: 'hair', onSkin: true, noShade: true };
    }

    /**
     * Body hair's strand picture: four lanes, each a tuft (two of three or four
     * strands for body hair, two of eight finer ones for fur), each strand its
     * own length and drift, tapering to its tip.
     */
    function bodyHairTexture(size = 256) {
        const data = new Uint8Array(size * size * 4);
        const rand = rng(5);
        const alpha = new Float32Array(size * size), tone = new Float32Array(size * size).fill(1);
        for (let lane = 0; lane < 4; lane++) {
            // A lock of hairs, sparse to dense (6, 10, 14, 20). No two start at the same place or run the
            // same way: each grows from its own point near the root, leans its own way and stops at its
            // own length, so a lock never shows a root line, a tip line or an outline.
            const count = [6, 10, 14, 20][lane], fine = lane < 2 ? 0.8 : 0.65;
            for (let k = 0; k < count; k++) {
                const u0 = lane * 0.25 + 0.125 + (rand() - 0.5) * 0.12, v0 = rand() * 0.22;
                const lean = (rand() - 0.5) * 0.5, bend = (rand() - 0.5) * 0.35, len = 0.45 + rand() * 0.5;
                const w0 = (0.0035 + 0.003 * rand()) * fine * size, ink = 0.6 + 0.4 * rand(), shade = 0.75 + 0.45 * rand();
                const steps = Math.ceil(len * size * 1.4);
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps, v = v0 + t * len;
                    if (v >= 1) break;
                    const cu = (u0 + (lean + bend * t) * t * len * 0.5) * size, cy = v * size, w = w0 * (1 - 0.8 * t);
                    for (let x = Math.floor(cu - w - 1); x <= Math.ceil(cu + w + 1); x++) {
                        if (x < lane * size / 4 + 1 || x >= (lane + 1) * size / 4 - 1) continue;
                        const d = Math.abs(x + 0.5 - cu) / Math.max(0.5, w);
                        if (d > 1) continue;
                        const o = Math.floor(cy) * size + x, a = (1 - d * d) * ink * Math.min(1, (1 - t) * 4);
                        if (a > alpha[o]) { alpha[o] = a; tone[o] = shade; }
                    }
                }
            }
        }
        for (let o = 0; o < size * size; o++) {
            const l = Math.min(255, Math.round(225 * tone[o]));
            data[o * 4] = data[o * 4 + 1] = data[o * 4 + 2] = l; data[o * 4 + 3] = Math.round(255 * Math.min(1, alpha[o]));
        }
        return { width: size, height: size, data, name: 'bodyhair.png' };
    }

    /** One strand across its card: a soft round section, darker at its core, tapering to its tip. */
    function strandTexture(w = 32, h = 128) {
        const data = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h, o = (y * w + x) * 4;
            const width = 0.8 * (1 - v * 0.75);
            const a = Math.max(0, 1 - (u / width) ** 2) * Math.min(1, (1 - v) * 6);
            const l = Math.round(200 + 55 * (1 - Math.abs(u) / Math.max(0.05, width)));
            data[o] = data[o + 1] = data[o + 2] = Math.min(255, l); data[o + 3] = Math.round(255 * a);
        }
        return { width: w, height: h, data, name: 'strand.png' };
    }

    const api = { strandTexture, areolaPatches, areolaTexture, areolaPart, hairStrands, hairPart, furCards, bodyHairTexture };
    root.RRCharacterDetail = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * RRCharacterSkin - the body's painted skin and the eyes' irises.
 *
 * The skin is a picture in the body's own UV layout (MakeHuman's), each
 * texel painted from where it lies on the average body: its height, its
 * place along the spine or a limb, which way it faces, and how far the lip
 * and eyelid targets move it there. So a tiger's stripes run round its arms,
 * a lizard's belly is pale, and lipstick stays on the lips, on any body.
 * The picture depends on the skin settings only, never on the body's shape.
 *
 * The eyes are MakeHuman's eye picture with the iris recolored from its own
 * light and dark (its fibers kept) and the pupil reshaped.
 */
(function(root) {
    'use strict';

    const Outfit = root.RRCharacterOutfit || (typeof require === 'function' ? require('./CharacterOutfit.js') : null);
    const toByte = c => Math.max(0, Math.min(255, Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)));
    const srgb = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const fract = x => x - Math.floor(x);
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

    function hash3(x, y, z) { return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453); }
    function noise3(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
        let out = 0;
        for (let k = 0; k < 8; k++) {
            const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
            out += hash3(ix + dx, iy + dy, iz + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
        }
        return out;
    }
    /** Distance to the nearest and second nearest cell point (cells of `size` meters). */
    function cells(x, y, z, size) {
        x /= size; y /= size; z /= size;
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        let d1 = 9, d2 = 9;
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
            const cx = ix + i + hash3(ix + i, iy + j, iz + k), cy = iy + j + hash3(iy + j, iz + k, ix + i), cz = iz + k + hash3(iz + k, ix + i, iy + j);
            const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        return [Math.sqrt(d1), Math.sqrt(d2)];
    }

    const PATTERNS = [['none', 'None'], ['freckles', 'Freckles'], ['scales', 'Scales'], ['stripes', 'Stripes'], ['spots', 'Spots'], ['fur', 'Fur'], ['feathers', 'Feathers'], ['decay', 'Decay'], ['panels', 'Panels'], ['tribal', 'Tribal marks'], ['vitiligo', 'Patches']];

    const DEFAULT_SKIN = Object.freeze({ type: 'none', color: '#5a4030', belly: '', amount: 1, scale: 1, lips: '', blush: 0, eyeshadow: '', shadowAmount: 0.7 });

    function normalizeSkin(input) {
        const s = Object.assign({}, DEFAULT_SKIN, input || {});
        if (!PATTERNS.some(p => p[0] === s.type)) s.type = 'none';
        for (const k of ['color', 'belly', 'lips', 'eyeshadow']) if (s[k] && !/^#[0-9a-f]{6}$/i.test(s[k])) s[k] = '';
        s.amount = Math.max(0, Math.min(1, +s.amount || 0));
        s.scale = Math.max(0.3, Math.min(3, +s.scale || 1));
        s.blush = Math.max(0, Math.min(1, +s.blush || 0));
        s.shadowAmount = Math.max(0, Math.min(1, +(s.shadowAmount ?? 0.7)));
        return s;
    }

    /** Per pack vertex, how much a set of targets moves it, 0..1 (lips, eyelids). */
    function regionOf(pack, names) {
        const out = new Float32Array(pack.vertexCount);
        let max = 0;
        for (const name of names) {
            const t = pack.targets.get(name);
            if (!t) continue;
            for (let i = 0; i < t.index.length; i++) {
                const m = Math.hypot(t.delta[i * 3], t.delta[i * 3 + 1], t.delta[i * 3 + 2]) * t.scale;
                out[t.index[i]] = Math.max(out[t.index[i]], m);
                max = Math.max(max, m);
            }
        }
        if (max > 0) for (let v = 0; v < out.length; v++) out[v] /= max;
        return out;
    }

    function fields(pack) {
        if (pack._skinFields) return pack._skinFields;
        const an = Outfit.anatomy(pack);
        const Body = root.RRHumanBody || require('./HumanBody.js');
        const normals = Body.vertexNormals(pack, an.rest);
        const lips = regionOf(pack, ['shape/upperLip-incr', 'shape/lowerLip-incr']);
        const lids = regionOf(pack, ['shape/eyeOpen-incr', 'shape/eyeFold-incr']);
        const cheeks = regionOf(pack, ['shape/cheeks-incr']);
        return (pack._skinFields = { an, normals, lips, lids, cheeks });
    }

    /** A texel's skin color (linear) from the skin settings and where it lies. */
    function shadeSkin(s, base, p) {
        const accent = Outfit.linear(s.color || '#5a4030'), belly = s.belly ? Outfit.linear(s.belly) : null;
        let rgb = base;
        const [x, y, z] = p.rest;
        // Skin's own unevenness.
        const n = noise3(x * 90, y * 90, z * 90) * 0.6 + noise3(x * 13, y * 13, z * 13) * 0.4;
        rgb = rgb.map(c => c * (0.94 + 0.1 * n));
        // A paler front: the belly, the throat, the insides of the limbs.
        if (belly) {
            const front = p.fam === 0 ? smooth(0.35, 0.85, p.n[2]) * smooth(-0.4, 0.2, p.s) * (1 - smooth(4.4, 4.9, p.s)) : smooth(0.2, 0.9, -p.n[1]) * 0.8;
            rgb = mix(rgb, belly, front * s.amount);
        }
        const k = s.scale;
        let t = 0;
        switch (s.type) {
            case 'freckles': {
                const [d1] = cells(x, y, z, 0.006 / k);
                const where = p.fam === 0 ? smooth(4.6, 5.0, p.s) * smooth(0.3, 0.8, p.n[2]) + smooth(3.3, 3.8, p.s) * (1 - smooth(4.0, 4.2, p.s)) * 0.6 : 0.3;
                t = d1 < 0.22 && hash3(Math.floor(x * 500), Math.floor(y * 500), Math.floor(z * 500)) > 0.4 ? where : 0;
                break;
            }
            case 'scales': case 'feathers': {
                const size = (s.type === 'feathers' ? 0.022 : 0.012) / k;
                const [d1, d2] = cells(x, y * (s.type === 'feathers' ? 0.7 : 1), z, size);
                const edge = 1 - smooth(0.0, 0.12, d2 - d1);
                t = edge * 0.85 + d1 * 0.25;
                break;
            }
            case 'stripes': {
                const along = p.fam === 0 ? y * 9 : p.s * 2.2;
                const wob = noise3(x * 8, y * 8, z * 8) * 0.9;
                const v = Math.abs(Math.sin((along * k + wob) * Math.PI));
                const side = p.fam === 0 ? 1 - smooth(0.4, 0.9, p.n[2]) * 0.8 : 1;
                t = smooth(0.82, 0.92, v) * side;
                break;
            }
            case 'spots': {
                const [d1] = cells(x, y, z, 0.035 / k);
                t = (d1 > 0.18 && d1 < 0.34 ? 1 : d1 < 0.12 ? 0.6 : 0);
                break;
            }
            case 'fur': {
                const streak = noise3(x * 40, y * 220, z * 40);
                const back = p.fam === 0 ? smooth(0.1, -0.8, p.n[2]) : smooth(-0.2, 0.6, p.n[1]);
                t = back * 0.75 + (streak - 0.5) * 0.35;
                break;
            }
            case 'decay': {
                const blot = noise3(x * 11, y * 11, z * 11) + noise3(x * 31, y * 31, z * 31) * 0.5;
                const vein = Math.abs(noise3(x * 45, y * 45, z * 45) - 0.5) < 0.025 ? 1 : 0;
                t = Math.max(smooth(0.85, 1.15, blot), vein * 0.8);
                break;
            }
            case 'panels': {
                const along = p.fam === 0 ? y * 5 : p.s * 1.5;
                const line = Math.abs(fract(along * k) - 0.5) > 0.48 || Math.abs(Math.abs(p.ang) - Math.PI / 2) < 0.012;
                t = line ? 1 : 0;
                break;
            }
            case 'tribal': {
                // Bands round the upper arms and forearms, a chevron on the chest.
                if (p.fam === 1 || p.fam === 2) t = (Math.abs(p.s - 1.55) < 0.06 || Math.abs(p.s - 1.72) < 0.03 || Math.abs(p.s - 2.6) < 0.05) ? 1 : 0;
                else if (p.fam === 0 && p.n[2] > 0.3) { const v = p.s - 3.0 + Math.abs(x) * 6; t = Math.abs(v) < 0.08 || Math.abs(v - 0.25) < 0.04 ? 1 : 0; }
                break;
            }
            case 'vitiligo': {
                const v = noise3(x * 7, y * 7, z * 7) + noise3(x * 19, y * 19, z * 19) * 0.4;
                t = smooth(0.92, 0.97, v);
                break;
            }
        }
        if (s.type !== 'none') rgb = mix(rgb, s.type === 'vitiligo' ? Outfit.linear('#f2e6dc') : accent, Math.max(0, Math.min(1, t)) * s.amount);
        // Blush, lips and eye shadow on the face.
        if (s.blush) rgb = mix(rgb, mix(rgb, Outfit.linear('#c0484a'), 0.6), p.cheeks * s.blush * 0.6);
        if (p.lips > 0.25) {
            const lip = s.lips ? Outfit.linear(s.lips) : rgb.map((c, i) => c * [0.82, 0.62, 0.62][i]);
            rgb = mix(rgb, lip, smooth(0.25, 0.55, p.lips));
        }
        if (s.eyeshadow && p.lids > 0.2) rgb = mix(rgb, Outfit.linear(s.eyeshadow), smooth(0.2, 0.6, p.lids) * s.shadowAmount);
        return rgb;
    }

    /** The skin picture: { width, height, data (RGBA bytes), name }. */
    function paint(pack, skinHex, settings, options) {
        const s = normalizeSkin(settings);
        const size = (options && options.size) || 1024;
        const F = fields(pack), an = F.an, R = an.rest, N = F.normals;
        const base = Outfit.linear(skinHex || '#c69c7f');
        const data = new Uint8Array(size * size * 4), filled = new Uint8Array(size * size);
        const body = pack.body;
        const p = { rest: [0, 0, 0], n: [0, 0, 0], s: 0, ang: 0, fam: 0, lips: 0, lids: 0, cheeks: 0 };
        const famOf = v => { let best = 0; for (let fi = 1; fi < 5; fi++) if (an.member[v * 5 + fi] > an.member[v * 5 + best]) best = fi; return best; };
        for (let t = 0; t < body.index.length; t += 3) {
            const r = [body.index[t], body.index[t + 1], body.index[t + 2]];
            const v = r.map(i => body.source[i]);
            const fam = famOf(v[0]);
            const px = r.map(i => body.uv[i * 2] * size), py = r.map(i => body.uv[i * 2 + 1] * size);
            const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
            if (Math.abs(area) < 1e-9) continue;
            let angs = v.map(q => an.angle[q * 5 + fam]);
            if (Math.max(...angs) - Math.min(...angs) > Math.PI) angs = angs.map(a => (a < 0 ? a + Math.PI * 2 : a));
            const x0 = Math.max(0, Math.floor(Math.min(...px)) - 1), x1 = Math.min(size - 1, Math.ceil(Math.max(...px)) + 1);
            const y0 = Math.max(0, Math.floor(Math.min(...py)) - 1), y1 = Math.min(size - 1, Math.ceil(Math.max(...py)) + 1);
            const tol = -0.75 / Math.sqrt(Math.abs(area));
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const cx = x + 0.5, cy = y + 0.5;
                let w0 = ((px[1] - cx) * (py[2] - cy) - (px[2] - cx) * (py[1] - cy)) / area;
                let w1 = ((px[2] - cx) * (py[0] - cy) - (px[0] - cx) * (py[2] - cy)) / area;
                let w2 = 1 - w0 - w1;
                if (w0 < tol || w1 < tol || w2 < tol) continue;
                const o = y * size + x;
                if (filled[o] === 2) continue;
                const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
                w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
                const ws = w0 + w1 + w2; w0 /= ws; w1 /= ws; w2 /= ws;
                const W = [w0, w1, w2];
                for (let k = 0; k < 3; k++) {
                    p.rest[k] = R[v[0] * 3 + k] * w0 + R[v[1] * 3 + k] * w1 + R[v[2] * 3 + k] * w2;
                    p.n[k] = N[v[0] * 3 + k] * w0 + N[v[1] * 3 + k] * w1 + N[v[2] * 3 + k] * w2;
                }
                p.fam = fam;
                p.s = W.reduce((sum, w, k) => sum + w * an.s[v[k] * 5 + fam], 0);
                p.ang = W.reduce((sum, w, k) => sum + w * angs[k], 0);
                p.lips = W.reduce((sum, w, k) => sum + w * F.lips[v[k]], 0);
                p.lids = W.reduce((sum, w, k) => sum + w * F.lids[v[k]], 0);
                p.cheeks = W.reduce((sum, w, k) => sum + w * F.cheeks[v[k]], 0);
                const rgb = shadeSkin(s, base, p);
                data[o * 4] = toByte(rgb[0]); data[o * 4 + 1] = toByte(rgb[1]); data[o * 4 + 2] = toByte(rgb[2]); data[o * 4 + 3] = 255;
                filled[o] = inside ? 2 : 1;
            }
        }
        // Empty texels take the skin color, so filtering at a seam never reads black.
        const fill = base.map(toByte);
        for (let o = 0; o < size * size; o++) if (!filled[o]) { data[o * 4] = fill[0]; data[o * 4 + 1] = fill[1]; data[o * 4 + 2] = fill[2]; data[o * 4 + 3] = 255; }
        return { width: size, height: size, data, name: 'skin.png' };
    }

    // ── eyes ──────────────────────────────────────────────────────────────
    const PUPILS = [['round', 'Round'], ['slit', 'Slit'], ['goat', 'Bar'], ['none', 'None']];
    const DEFAULT_EYES = Object.freeze({ color: '#6a4a2a', pupil: 'round', sclera: '', size: 1 });
    // The picture holds two eyeballs; each iris is centered here, about 0.11 of the picture across.
    const IRIS = [[0.708, 0.259], [0.292, 0.671]], IRIS_R = 0.108, PUPIL_R = 0.042;

    function normalizeEyes(input) {
        const e = Object.assign({}, DEFAULT_EYES, input || {});
        if (!/^#[0-9a-f]{6}$/i.test(e.color || '')) e.color = DEFAULT_EYES.color;
        if (e.sclera && !/^#[0-9a-f]{6}$/i.test(e.sclera)) e.sclera = '';
        if (!PUPILS.some(p => p[0] === e.pupil)) e.pupil = 'round';
        e.size = Math.max(0.5, Math.min(1.6, +e.size || 1));
        return e;
    }

    /**
     * The eye picture recolored: `src` RGBA bytes of MakeHuman's brown eye
     * (any square size). The iris takes the new color by the picture's own
     * lightness, the pupil is redrawn, the white of the eye may be tinted.
     */
    function paintEyes(src, size, settings) {
        const e = normalizeEyes(settings);
        const out = Uint8Array.from(src);
        const iris = Outfit.linear(e.color), sclera = e.sclera ? Outfit.linear(e.sclera) : null;
        const irisR = IRIS_R * e.size;
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
            const o = (y * size + x) * 4;
            if (src[o + 3] < 128) continue;
            const u = (x + 0.5) / size, v = (y + 0.5) / size;
            let best = 9, du = 0, dv = 0;
            for (const [cu, cv] of IRIS) { const d = Math.hypot(u - cu, v - cv); if (d < best) { best = d; du = u - cu; dv = v - cv; } }
            const lum = (srgb(src[o] / 255) * 0.3 + srgb(src[o + 1] / 255) * 0.5 + srgb(src[o + 2] / 255) * 0.2);
            let rgb = null;
            if (best < irisR * 1.08) {
                // Iris: its fibers from the picture's lightness, on the new color; a dark ring at its edge.
                const r = best / irisR;
                const detail = Math.min(1.6, 0.35 + lum * 9);
                rgb = iris.map(c => c * detail * (r > 0.88 ? 0.55 : 1));
                // The pupil.
                const pr = PUPIL_R * e.size;
                let inPupil = false;
                if (e.pupil === 'round') inPupil = best < pr;
                else if (e.pupil === 'slit') inPupil = Math.abs(du) < pr * 0.28 * Math.sqrt(Math.max(0, 1 - (dv / (irisR * 0.95)) ** 2));
                else if (e.pupil === 'goat') inPupil = Math.abs(dv) < pr * 0.35 && Math.abs(du) < irisR * 0.75;
                if (inPupil) rgb = [0.005, 0.005, 0.005];
                if (r > 1) rgb = mix(rgb, sclera || [srgb(src[o] / 255), srgb(src[o + 1] / 255), srgb(src[o + 2] / 255)], (r - 1) / 0.08);
            } else if (sclera) {
                rgb = sclera.map(c => c * Math.min(1.2, 0.4 + lum * 1.2));
            }
            if (!rgb) continue;
            out[o] = toByte(rgb[0]); out[o + 1] = toByte(rgb[1]); out[o + 2] = toByte(rgb[2]);
        }
        return out;
    }

    const api = { PATTERNS, PUPILS, DEFAULT_SKIN, DEFAULT_EYES, normalizeSkin, normalizeEyes, paint, paintEyes, shadeSkin, regionOf };
    root.RRCharacterSkin = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

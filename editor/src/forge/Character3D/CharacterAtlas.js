/**
 * RRCharacterAtlas - one painted texture for a whole outfit.
 *
 * A laid garment piece (RRCharacterOutfit.lay) is split into charts, one per
 * body chain it covers (trunk, each arm and leg, the skirt). A chart lies
 * flat by the chain's own measure: around the chain (its angle, times the
 * chain's radius) by along it (its position, times the chain's step), both
 * in meters, so every chart has the same texel size. The charts of every
 * piece are packed into one picture, and each texel is painted from where
 * it lies on the body: a stripe is a height on the trunk, a ring of mail a
 * few millimeters of chart, a trim a distance from the cut line. Pieces of
 * one finish are merged into one part, all sharing the picture.
 *
 * The picture depends on the outfit only, never on the body's shape: the
 * builder keeps it while sliders move.
 */
(function(root) {
    'use strict';

    const Outfit = root.RRCharacterOutfit || (typeof require === 'function' ? require('./CharacterOutfit.js') : null);
    const TAU = Math.PI * 2;
    const toByte = c => Math.max(0, Math.min(255, Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255)));
    const fract = x => x - Math.floor(x);
    const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
    function noise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
        const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    /** The values of one piece vertex on chain `fam`: its position along it and angle about it. */
    function chainValue(an, laid, i, fam) {
        const { a, b, t } = laid.piece.verts[laid.origin[i]];
        let ga = an.angle[a * 5 + fam], gb = an.angle[b * 5 + fam];
        if (gb - ga > Math.PI) gb -= TAU; else if (ga - gb > Math.PI) gb += TAU;
        return {
            s: an.s[a * 5 + fam] * (1 - t) + an.s[b * 5 + fam] * t,
            ang: ga * (1 - t) + gb * t,
            u: an.skirtU[a] * (1 - t) + an.skirtU[b] * t,
            rest: [0, 1, 2].map(k => an.rest[a * 3 + k] * (1 - t) + an.rest[b * 3 + k] * t)
        };
    }

    /**
     * Charts of one laid piece: triangles grouped by the chain most of their
     * corners belong to, each corner given flat chart coordinates in meters.
     */
    function charts(an, laid, skirt) {
        const byKey = new Map();
        const I = laid.index;
        for (let t = 0; t < I.length; t += 3) {
            const c = [I[t], I[t + 1], I[t + 2]];
            let fam;
            if (skirt) fam = 5;
            else {
                const count = [0, 0, 0, 0, 0];
                for (const v of c) count[laid.field[v].fam]++;
                fam = count.indexOf(Math.max(...count));
            }
            const values = c.map(v => chainValue(an, laid, v, fam === 5 ? 0 : fam));
            // A triangle across the seam behind: carried round so its corners sit together.
            const angs = values.map(x => x.ang);
            if (Math.max(...angs) - Math.min(...angs) > Math.PI) values.forEach(x => { if (x.ang < 0) x.ang += TAU; });
            const R = an.radius[fam] * (fam === 0 ? 1.35 : 1.15), U = an.unit[fam];
            const corners = values.map((x, k) => ({
                v: c[k], cu: x.ang * R, cv: (fam === 5 ? x.u : x.s) * U, s: x.s, ang: x.ang, rest: x.rest,
                y: x.rest[1], val: laid.vals[c[k]], fam: fam === 5 ? 0 : fam, u: x.u
            }));
            let chart = byKey.get(fam);
            if (!chart) byKey.set(fam, chart = { fam, tris: [], min: [Infinity, Infinity], max: [-Infinity, -Infinity] });
            chart.tris.push(corners);
            for (const k of corners) {
                chart.min[0] = Math.min(chart.min[0], k.cu); chart.min[1] = Math.min(chart.min[1], k.cv);
                chart.max[0] = Math.max(chart.max[0], k.cu); chart.max[1] = Math.max(chart.max[1], k.cv);
            }
        }
        return [...byKey.values()];
    }

    /** Shelf packing at `scale` texels per meter, `pad` texels around each chart; false when it does not fit. */
    function pack(list, size, scale, pad) {
        const order = list.slice().sort((p, q) => (q.max[1] - q.min[1]) - (p.max[1] - p.min[1]));
        let x = 0, y = 0, rowH = 0;
        for (const c of order) {
            const w = Math.ceil((c.max[0] - c.min[0]) * scale) + pad * 2, h = Math.ceil((c.max[1] - c.min[1]) * scale) + pad * 2;
            if (w > size || h > size) return false;
            if (x + w > size) { x = 0; y += rowH; rowH = 0; }
            if (y + h > size) return false;
            c.at = [x + pad, y + pad];
            x += w; rowH = Math.max(rowH, h);
        }
        return true;
    }

    // ── painting ──────────────────────────────────────────────────────────
    /** A texel's linear color for a look at a point described by `p` (chart and body values). */
    function shade(look, colors, p) {
        const [c1, c2, trim] = colors;
        let t = 0;
        const s = (p.fam === 0 ? p.y * 7.3 : p.s * 1.2) * (look.scale || 1), a = p.ang;
        switch (look.pattern) {
            case 'stripes': t = fract(s * 2) < 0.5 ? 1 : 0; break;
            case 'pinstripes': t = fract(s * 6) < 0.12 ? 1 : 0; break;
            case 'vstripes': t = fract(p.cu * 12 * (look.scale || 1)) < 0.5 ? 1 : 0; break;
            case 'checker': t = (Math.floor(s * 2) + Math.floor(p.cu * 12 * (look.scale || 1))) & 1; break;
            case 'plaid': {
                const u = fract(s * 1.6), v = fract(p.cu * 9 * (look.scale || 1));
                t = (u < 0.28 ? 0.5 : 0) + (v < 0.28 ? 0.5 : 0) + (fract(s * 6.4) < 0.08 || fract(p.cu * 36) < 0.08 ? 0.25 : 0);
                t = Math.min(1, t);
                break;
            }
            case 'gradient': { const k = Math.max(0, Math.min(1, (p.s - (look.from ?? 0)) / ((look.to ?? 4) - (look.from ?? 0)))); t = k * k * (3 - 2 * k); break; }
            case 'halves': t = p.rest[0] < 0 ? 1 : 0; break;
            case 'camo': {
                const v = noise(p.rest[0] * 9 + 3.1, p.rest[1] * 9 + p.rest[2] * 4) + 0.6 * noise(p.rest[2] * 13 - 7, p.rest[1] * 11 + p.rest[0] * 3);
                t = v > 1.05 ? 1 : v < 0.55 ? 0.5 : 0;
                break;
            }
            case 'panels': {
                const line = Math.abs(fract(s * 1.5) - 0.5) > 0.47 || Math.abs(Math.abs(a) - Math.PI / 2) < 0.025;
                t = line ? 1 : 0;
                break;
            }
            case 'mail': {
                // Rows of rings, every other row offset by half a ring.
                const rx = p.cu / 0.014, ry = p.cv / 0.011;
                const row = Math.floor(ry), fx = fract(rx + (row & 1) * 0.5) - 0.5, fy = fract(ry) - 0.5;
                const r = Math.hypot(fx, fy * 1.2);
                t = r > 0.28 && r < 0.48 ? 0 : 1;
                break;
            }
            case 'scales': {
                const rx = p.cu / 0.016, ry = p.cv / 0.012;
                const row = Math.floor(ry), fx = fract(rx + (row & 1) * 0.5) - 0.5, fy = fract(ry);
                t = Math.min(1, Math.hypot(fx, fy - 0.1) * 1.6);
                break;
            }
            case 'quilted': {
                const q = Math.abs(fract((p.cu + p.cv) / 0.04) - 0.5) < 0.04 || Math.abs(fract((p.cu - p.cv) / 0.04) - 0.5) < 0.04;
                t = q ? 1 : 0;
                break;
            }
            case 'sole': t = p.y < 0.03 ? 2 : (p.ang > 0.6 && p.ang < 2.4 && p.s > 2.3 ? 1 : 0); break;
            case 'visor': t = p.fam === 0 && Math.abs(a) < 1.0 && p.s > 5.0 && p.s < 5.62 ? 1 : 0; break;
            case 'studs': {
                const fx = fract(p.cu / 0.03) - 0.5, fy = fract(p.cv / 0.03) - 0.5;
                t = Math.hypot(fx, fy) < 0.18 ? 2 : 0;
                break;
            }
            default: t = 0;
        }
        let rgb = t >= 2 ? trim : t <= 0 ? c1 : t >= 1 ? c2 : [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
        if (look.trimWidth && p.val >= 0 && p.val < look.trimWidth) rgb = trim;
        // The cloth's own grain: a slight unevenness, finer for metal.
        const grain = look.material === 'metal' || look.material === 'gold'
            ? 0.94 + 0.08 * noise(p.cu * 60, p.cv * 6)
            : 0.92 + 0.1 * noise(p.cu * 140, p.cv * 140) + 0.04 * noise(p.cu * 9, p.cv * 9);
        // The rim's inner face, toward the body, in shadow.
        const k = (p.val < 0 ? 0.6 : 1) * grain;
        return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
    }

    /**
     * The layout of an outfit's pieces: charts packed into one picture,
     * painted, and each merged part's vertices as references back into the
     * laid pieces. `entries` [{ laid, look, skirt, name, roughness,
     * metalness, doubleSided }]. Depends on the outfit only.
     */
    function layout(pack, entries, options) {
        const an = Outfit.anatomy(pack);
        const size = (options && options.size) || 1024, pad = 3;
        const all = [];
        entries.forEach((e, ei) => {
            for (const c of charts(an, e.laid, e.skirt)) { c.entry = ei; all.push(c); }
        });
        let area = 0;
        for (const c of all) area += (c.max[0] - c.min[0] + 0.01) * (c.max[1] - c.min[1] + 0.01);
        let scale = Math.min(450, Math.sqrt(size * size * 0.62 / Math.max(area, 1e-6)));
        while (scale > 8 && !pack_(all, size, scale, pad)) scale *= 0.92;

        const data = new Uint8Array(size * size * 4);
        const filled = new Uint8Array(size * size);
        const groups = new Map();
        for (const c of all) {
            const e = entries[c.entry];
            const colors = [Outfit.linear(e.look.color), Outfit.linear(e.look.color2 || e.look.color), Outfit.linear(e.look.trim || e.look.color2 || e.look.color)];
            const key = [e.roughness, e.metalness, !!e.doubleSided].join('|');
            let g = groups.get(key);
            if (!g) groups.set(key, g = { e, names: new Set(), refs: [], uvs: [], index: [], map: new Map() });
            g.names.add(e.name);
            const vertexFor = corner => {
                const k = c.entry + ':' + c.fam + ':' + corner.v + ':' + (corner.ang > Math.PI + 1e-6 ? 1 : 0);
                let i = g.map.get(k);
                if (i !== undefined) return i;
                i = g.refs.length / 2;
                g.map.set(k, i);
                g.refs.push(c.entry, corner.v);
                g.uvs.push((c.at[0] + (corner.cu - c.min[0]) * scale) / size, (c.at[1] + (corner.cv - c.min[1]) * scale) / size);
                return i;
            };
            for (const tri of c.tris) {
                g.index.push(vertexFor(tri[0]), vertexFor(tri[1]), vertexFor(tri[2]));
                raster(tri, c, scale, size, data, filled, p => shade(e.look, colors, p));
            }
        }
        dilate(data, filled, size, pad + 1);
        return {
            groups: [...groups.values()].map(g => ({ name: [...g.names].join(', ').slice(0, 60) || 'Outfit', refs: Uint32Array.from(g.refs), uvs: Float32Array.from(g.uvs), index: Uint32Array.from(g.index),
                roughness: g.e.roughness, metalness: g.e.metalness, doubleSided: g.e.doubleSided })),
            texture: { width: size, height: size, data, name: 'outfit.png' },
            scale
        };
    }

    /** The parts of a layout on the pieces as laid now (the same outfit on any body). */
    function apply(lay, entries) {
        return lay.groups.map(g => {
            const n = g.refs.length / 2;
            const positions = new Float32Array(n * 3), normals = new Float32Array(n * 3), joints = new Uint8Array(n * 4), weights = new Float32Array(n * 4);
            for (let i = 0; i < n; i++) {
                const L = entries[g.refs[i * 2]].laid, v = g.refs[i * 2 + 1];
                positions[i * 3] = L.positions[v * 3]; positions[i * 3 + 1] = L.positions[v * 3 + 1]; positions[i * 3 + 2] = L.positions[v * 3 + 2];
                normals[i * 3] = L.normals[v * 3]; normals[i * 3 + 1] = L.normals[v * 3 + 1]; normals[i * 3 + 2] = L.normals[v * 3 + 2];
                for (let q = 0; q < 4; q++) { joints[i * 4 + q] = L.joints[v * 4 + q]; weights[i * 4 + q] = L.weights[v * 4 + q]; }
            }
            return { name: g.name, positions, normals, uvs: g.uvs, joints, weights, index: g.index, roughness: g.roughness, metalness: g.metalness, doubleSided: g.doubleSided, texture: lay.texture.name };
        });
    }

    /** Pieces into textured parts: { parts, texture }. */
    function build(pack, entries, options) {
        const lay = layout(pack, entries, options);
        return { parts: apply(lay, entries), texture: lay.texture, layout: lay };
    }
    const pack_ = pack;

    /** Paints one chart triangle's texels. */
    function raster(tri, chart, scale, size, data, filled, color) {
        const px = tri.map(k => chart.at[0] + (k.cu - chart.min[0]) * scale), py = tri.map(k => chart.at[1] + (k.cv - chart.min[1]) * scale);
        const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
        if (Math.abs(area) < 1e-9) return;
        const x0 = Math.max(0, Math.floor(Math.min(...px)) - 1), x1 = Math.min(size - 1, Math.ceil(Math.max(...px)) + 1);
        const y0 = Math.max(0, Math.floor(Math.min(...py)) - 1), y1 = Math.min(size - 1, Math.ceil(Math.max(...py)) + 1);
        const p = { fam: tri[0].fam, s: 0, ang: 0, cu: 0, cv: 0, y: 0, val: 0, u: 0, rest: [0, 0, 0] };
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const cx = x + 0.5, cy = y + 0.5;
            let w0 = ((px[1] - cx) * (py[2] - cy) - (px[2] - cx) * (py[1] - cy)) / area;
            let w1 = ((px[2] - cx) * (py[0] - cy) - (px[0] - cx) * (py[2] - cy)) / area;
            let w2 = 1 - w0 - w1;
            // Half a texel past the edge too, so neighboring triangles meet without a gap.
            const tol = -0.75 / Math.sqrt(Math.abs(area));
            if (w0 < tol || w1 < tol || w2 < tol) continue;
            const o = y * size + x;
            if (filled[o] === 2) continue;
            const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
            w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
            const ws = w0 + w1 + w2; w0 /= ws; w1 /= ws; w2 /= ws;
            const k = (name) => tri[0][name] * w0 + tri[1][name] * w1 + tri[2][name] * w2;
            p.s = k('s'); p.ang = k('ang'); p.cu = k('cu'); p.cv = k('cv'); p.y = k('y'); p.val = k('val'); p.u = k('u');
            for (let q = 0; q < 3; q++) p.rest[q] = tri[0].rest[q] * w0 + tri[1].rest[q] * w1 + tri[2].rest[q] * w2;
            const rgb = color(p);
            data[o * 4] = toByte(rgb[0]); data[o * 4 + 1] = toByte(rgb[1]); data[o * 4 + 2] = toByte(rgb[2]); data[o * 4 + 3] = 255;
            filled[o] = inside ? 2 : 1;
        }
    }

    /** Grows painted texels into the empty ones around them, `passes` texels deep (so filtering never reads black). */
    function dilate(data, filled, size, passes) {
        for (let p = 0; p < passes; p++) {
            const next = [];
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const o = y * size + x;
                if (filled[o]) continue;
                let r = 0, g = 0, b = 0, n = 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const X = x + dx, Y = y + dy;
                    if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
                    const q = Y * size + X;
                    if (!filled[q]) continue;
                    r += data[q * 4]; g += data[q * 4 + 1]; b += data[q * 4 + 2]; n++;
                }
                if (n) next.push([o, r / n, g / n, b / n]);
            }
            for (const [o, r, g, b] of next) { data[o * 4] = r; data[o * 4 + 1] = g; data[o * 4 + 2] = b; data[o * 4 + 3] = 255; filled[o] = 1; }
        }
    }

    const api = { build, layout, apply, charts, shade, noise };
    root.RRCharacterAtlas = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

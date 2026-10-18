/**
 * RRPropPaint - pictures for props, painted in plain JavaScript (RGBA
 * Uint8Array, row 0 at the top), so the editor and node tests paint alike.
 *
 * Shapes are tested per sample in their own frame ([-1, 1] on each axis,
 * y down); a picture is smoothed by sampling each pixel several times.
 * Weaves are height fields repeating every few pixels; a normal map is
 * the slope of a height field.
 */
(function(root) {
    'use strict';

    const hex = h => {
        const s = String(h || '#808080').replace('#', '');
        const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s.slice(0, 6), 16);
        return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
    };

    function random(seed) {
        let s = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0 || 1;
        return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    }

    /** Smooth value noise in [0, 1], wrapping every `cells` along each axis. */
    function noise(seed, cells) {
        const rand = random(seed), n = cells, g = new Float32Array(n * n);
        for (let i = 0; i < g.length; i++) g[i] = rand();
        return (x, y) => {
            const fx = x * n, fy = y * n, ix = Math.floor(fx), iy = Math.floor(fy);
            let u = fx - ix, v = fy - iy;
            u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
            const at = (a, b) => g[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
            const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
            return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
        };
    }

    /** Several octaves of `noise`, in [0, 1]. */
    function fractal(seed, cells, octaves) {
        const layers = Array.from({ length: octaves }, (_, k) => noise(seed + k * 101, cells << k));
        return (x, y) => {
            let s = 0, w = 0.5, total = 0;
            for (const f of layers) { s += f(x, y) * w; total += w; w *= 0.5; }
            return s / total;
        };
    }

    function pointInPolygon(poly, x, y) {
        let inside = false;
        for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
            const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    /** A regular star of `points` (outer radius 1, inner `inner`), one point straight up. */
    function starPolygon(points, inner) {
        const out = [];
        for (let k = 0; k < points * 2; k++) {
            const r = k % 2 ? inner : 1, a = -Math.PI / 2 + k * Math.PI / points;
            out.push(Math.cos(a) * r, Math.sin(a) * r);
        }
        return out;
    }

    const STAR = starPolygon(5, 0.382);
    // An eagle with raised wings, from the front, for a pole's top: drawn in a 100 x 100 box.
    const EAGLE = [
        50, 30, 54, 34, 58, 40, 66, 30, 74, 18, 86, 6, 96, 2, 92, 14, 98, 18, 88, 28, 94, 34,
        82, 40, 88, 46, 74, 50, 62, 56, 60, 66, 66, 76, 60, 80, 56, 90, 50, 86, 44, 90, 40, 80,
        34, 76, 40, 66, 38, 56, 26, 50, 12, 46, 18, 40, 6, 34, 12, 28, 2, 18, 8, 14, 4, 2,
        14, 6, 26, 18, 34, 30, 42, 40, 46, 34
    ].map(v => v / 50 - 1);

    /** Built-in emblems, each a test of a point in its own [-1, 1] box (y down). */
    const EMBLEMS = {
        star: (x, y) => pointInPolygon(STAR, x, y * 1.05 - 0.05),
        circle: (x, y) => x * x + y * y <= 1,
        crescent: (x, y) => x * x + y * y <= 1 && (x - 0.36) * (x - 0.36) + y * y > 0.78 * 0.78,
        shield: (x, y) => {
            // A heater shield: straight sides, then curving in to a point.
            if (y < -0.92 || y > 1 || Math.abs(x) > 0.8) return false;
            if (y <= 0.05) return true;
            const t = (y - 0.05) / 0.95;
            return Math.abs(x) <= 0.8 * Math.pow(Math.cos(t * Math.PI / 2), 0.7) * (1 - 0.15 * t);
        },
        sun: (x, y) => {
            const r = Math.hypot(x, y), a = Math.atan2(y, x);
            return r <= 0.52 || (r <= 1 && r >= 0.6 && Math.cos(a * 12) > 0.35 + (r - 0.6) * 1.2);
        },
        eagle: (x, y) => pointInPolygon(EAGLE, x, y)
    };

    /**
     * A picture of `width` x `height`, each pixel the average of `ss` x `ss`
     * samples of `color(u, v, out)` (u, v in [0, 1], out an RGBA array of
     * 0..255). Returns { width, height, data }.
     */
    function paint(width, height, color, ss) {
        const data = new Uint8Array(width * height * 4), out = [0, 0, 0, 255], n = ss || 2, inv = 1 / (n * n);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0, a = 0;
            for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
                out[3] = 255;
                color((x + (sx + 0.5) / n) / width, (y + (sy + 0.5) / n) / height, out);
                r += out[0] * out[3]; g += out[1] * out[3]; b += out[2] * out[3]; a += out[3];
            }
            const o = (y * width + x) * 4;
            if (a > 0) { data[o] = r / a; data[o + 1] = g / a; data[o + 2] = b / a; }
            data[o + 3] = a * inv;
        }
        return { width, height, data };
    }

    /** A source picture ({ width, height, data }) read at (u, v) in [0, 1], smoothly, into `out`. */
    function sampleImage(img, u, v, out) {
        const x = Math.max(0, Math.min(img.width - 1, u * img.width - 0.5)), y = Math.max(0, Math.min(img.height - 1, v * img.height - 0.5));
        const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1), fx = x - x0, fy = y - y0;
        const d = img.data;
        for (let k = 0; k < 4; k++) {
            const a = d[(y0 * img.width + x0) * 4 + k], b = d[(y0 * img.width + x1) * 4 + k], c = d[(y1 * img.width + x0) * 4 + k], e = d[(y1 * img.width + x1) * 4 + k];
            out[k] = (a + (b - a) * fx) * (1 - fy) + (c + (e - c) * fx) * fy;
        }
        return out;
    }

    /**
     * Woven cloth as height (0..1) at a thread position (x along the weft,
     * y along the warp, one unit per thread). Plain: one over one under.
     * Twill: two over two under, stepping each row (diagonal ribs). Satin:
     * four over one under (long smooth floats).
     */
    function weaveHeight(kind, x, y) {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        let warpUp;
        if (kind === 'twill') warpUp = ((ix + iy) % 4 + 4) % 4 < 2;
        else if (kind === 'satin') warpUp = ((ix * 2 + iy) % 5 + 5) % 5 !== 0;
        else warpUp = ((ix + iy) & 1) === 0;
        // Each thread is round across and dips where it passes under its neighbor.
        const across = Math.sin(Math.PI * (warpUp ? fx : fy));
        const along = 0.75 + 0.25 * Math.sin(Math.PI * (warpUp ? fy : fx));
        return warpUp ? 0.55 + 0.45 * across * along : 0.5 * across * along;
    }

    /**
     * A normal map (glTF: +x right, +y up, +z out) from a height function
     * `h(px, py)` in pixels, slopes scaled by `strength`.
     */
    function normalMap(width, height, h, strength) {
        const data = new Uint8Array(width * height * 4), H = new Float32Array(width * height);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) H[y * width + x] = h(x, y);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const l = H[y * width + Math.max(0, x - 1)], r = H[y * width + Math.min(width - 1, x + 1)];
            const u = H[Math.max(0, y - 1) * width + x], d = H[Math.min(height - 1, y + 1) * width + x];
            const nx = -(r - l) * 0.5 * strength, ny = (d - u) * 0.5 * strength, len = Math.hypot(nx, ny, 1);
            const o = (y * width + x) * 4;
            data[o] = Math.round((nx / len * 0.5 + 0.5) * 255);
            data[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
            data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
            data[o + 3] = 255;
        }
        return { width, height, data };
    }

    const api = { hex, random, noise, fractal, pointInPolygon, starPolygon, EMBLEMS, EAGLE, paint, sampleImage, weaveHeight, normalMap };
    root.RRPropPaint = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

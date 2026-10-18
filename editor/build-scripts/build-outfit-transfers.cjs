#!/usr/bin/env node
/**
 * Builds the Character Builder's outfits taken from the Demo's Star Shift
 * actors (RRCharacterOutfitTransfer).
 *
 *   node editor/build-scripts/build-outfit-transfers.cjs [id ...]
 *
 * Reads each actor's GLB from template/Demo/3d/Actors and writes
 * src/forge/Character3D/data/outfits/<id>.json (layout, colors, parts),
 * <id>.bin (bound points and triangles) and <id>.jpg (the picture, with
 * texels no triangle shows made one flat color). Needs ImageMagick
 * (`magick`) on the PATH to read and write the JPEG pictures. The body pack
 * (human.json/.bin) must be built first.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'src', 'forge', 'Character3D', 'data', 'outfits');
const ACTORS = path.join(ROOT, 'template', 'Demo', '3d', 'Actors');
const Body = require('../src/forge/Character3D/HumanBody.js');
const Transfer = require('../src/forge/Character3D/CharacterOutfitTransfer.js');

const clamp = x => Math.max(-2, Math.min(2, x));
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sat = c => { const mx = Math.max(...c), mn = Math.min(...c); return mx > 0 ? (mx - mn) / mx : 0; };
/** Banded part scores along the legs: boots below `boot`, leg armor from the hip to there, the rest the trunk's. */
const armorParts = (boot, drop) => [
    { id: null, test: drop },
    { id: 'boots', score: i => clamp((i.leg - boot) * 10) },
    { id: 'legs', score: i => clamp(Math.min(i.leg - 0.15, boot - i.leg) * 10) },
    { id: 'armor', score: () => 0 }
];

/**
 * Each outfit: its model, the body it is measured on (the model's own
 * build), how close its clothes sit (gap, reach, swell: a tight uniform is
 * drawn in further than armor), what is left out, and its parts.
 */
const OUTFITS = {
    carol: {
        file: 'Captain_Carol_Everson_Reduced/source/Captain_Carol_Everson_Reduced.glb', label: "Captain's Uniform (Carol Everson)",
        options: { recipe: { gender: 0 }, gap: 0.004, reach: 0.015, swell: 0.02, triangles: 32000,
            // Her heeled boots and gloves are left to the builder's own, on a body that stands flat.
            parts: [{ id: null, test: i => i.leg > 1.74 || i.arm > 2.98 }, { id: 'uniform' }] }
    },
    jolt: {
        file: 'Jolt Eagle/source/Jolt Eagle.glb', label: 'Power Armor (Jolt Eagle)',
        options: { recipe: { gender: 1, muscle: 0.5 }, gap: 0.004, reach: 0.003, swell: 0, triangles: 30000, headClear: 1, skinCut: false, repaint: false, hang: false,
            // The eagle's white ruff at the neck and the clawed gauntlets are his own.
            parts: armorParts(1.8, i => (i.spine > 3.0 && lum(i.color) > 0.4 && sat(i.color) < 0.2 && i.arm < 0) || i.arm > 2.95) }
    },
    max: {
        file: 'Max Triton/source/Max-Triton.glb', label: 'Power Armor (Max Triton)',
        options: { recipe: { gender: 1, muscle: 0.5 }, gap: 0.004, reach: 0.003, swell: 0, triangles: 30000, headClear: 1, hang: false,
            parts: armorParts(1.8, i => i.arm > 2.95) }
    },
    vay: {
        file: 'Vay Drokan/source/Vay Drokan.glb', label: 'Royal Robes (Vay Drokan)',
        options: { recipe: { gender: 1, muscle: 0.5 }, gap: 0.004, reach: 0.006, swell: 0.005, triangles: 30000, headClear: 1,
            parts: [{ id: null, test: i => i.arm > 2.95 || /Hand$/.test(i.role) }, { id: 'boots', score: i => (i.loose ? -2 : clamp((i.leg - 1.8) * 10)) }, { id: 'robes', score: () => 0 }] }
    }
};

function decodeJpeg(bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-outfit-'));
    try {
        fs.writeFileSync(path.join(dir, 'in.jpg'), bytes);
        cp.execFileSync('magick', [path.join(dir, 'in.jpg'), path.join(dir, 'out.png')]);
        const png = PNG.sync.read(fs.readFileSync(path.join(dir, 'out.png')));
        return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length) };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeJpeg(pic, file) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-outfit-'));
    try {
        fs.writeFileSync(path.join(dir, 'in.png'), PNG.sync.write({ width: pic.width, height: pic.height, data: Buffer.from(pic.data) }, { colorType: 6 }));
        cp.execFileSync('magick', [path.join(dir, 'in.png'), '-quality', '88', '-sampling-factor', '4:2:0', '-strip', file]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Texels no part's triangle shows (a few past each edge kept for the smaller mip levels) made the mean color. */
function flatten(pic, outfit) {
    const W = pic.width, H = pic.height, used = new Uint8Array(W * H), U = outfit.render.uvs;
    for (const part of outfit.parts) for (let t = 0; t < part.index.length; t += 3) {
        const px = [0, 1, 2].map(k => U[part.index[t + k] * 2] * W), py = [0, 1, 2].map(k => U[part.index[t + k] * 2 + 1] * H);
        const area = (px[1] - px[0]) * (py[2] - py[0]) - (px[2] - px[0]) * (py[1] - py[0]);
        if (Math.abs(area) < 1e-9) continue;
        const tol = -3 / Math.sqrt(Math.abs(area));
        for (let y = Math.max(0, Math.floor(Math.min(...py)) - 4); y <= Math.min(H - 1, Math.ceil(Math.max(...py)) + 4); y++)
            for (let x = Math.max(0, Math.floor(Math.min(...px)) - 4); x <= Math.min(W - 1, Math.ceil(Math.max(...px)) + 4); x++) {
                const cx = x + 0.5, cy = y + 0.5;
                const w0 = ((px[1] - cx) * (py[2] - cy) - (px[2] - cx) * (py[1] - cy)) / area, w1 = ((px[2] - cx) * (py[0] - cy) - (px[0] - cx) * (py[2] - cy)) / area;
                if (w0 >= tol && w1 >= tol && 1 - w0 - w1 >= tol) used[y * W + x] = 1;
            }
    }
    const mean = [0, 0, 0];
    let n = 0;
    for (let q = 0; q < W * H; q++) if (used[q]) { mean[0] += pic.data[q * 4]; mean[1] += pic.data[q * 4 + 1]; mean[2] += pic.data[q * 4 + 2]; n++; }
    const data = Uint8Array.from(pic.data);
    for (let q = 0; q < W * H; q++) if (!used[q]) { data[q * 4] = mean[0] / n; data[q * 4 + 1] = mean[1] / n; data[q * 4 + 2] = mean[2] / n; data[q * 4 + 3] = 255; }
    return { width: W, height: H, data, used: n / (W * H) };
}

(async () => {
    const pack = await Body.loadPack();
    fs.mkdirSync(OUT, { recursive: true });
    const only = process.argv.slice(2);
    for (const [id, cfg] of Object.entries(OUTFITS)) {
        if (only.length && !only.includes(id)) continue;
        const started = Date.now();
        const model = Transfer.readModel(fs.readFileSync(path.join(ACTORS, cfg.file)));
        const picture = decodeJpeg(model.image.bytes);
        const outfit = Transfer.transfer(pack, model, Object.assign({ picture }, cfg.options));
        const pic = flatten(outfit.picture || picture, outfit);
        outfit.keys = Transfer.colorKeys(outfit, pic);
        const { json, bytes } = Transfer.encode(outfit, {
            id, label: cfg.label, picture: id + '.jpg', size: [pic.width, pic.height],
            source: 'template/Demo/3d/Actors/' + cfg.file, recipe: cfg.options.recipe
        });
        fs.writeFileSync(path.join(OUT, id + '.json'), JSON.stringify(json));
        fs.writeFileSync(path.join(OUT, id + '.bin'), bytes);
        writeJpeg(pic, path.join(OUT, id + '.jpg'));
        const tris = outfit.parts.reduce((s, p) => s + p.index.length / 3, 0);
        console.log(id, 'points', outfit.count, 'triangles', tris, 'parts', outfit.parts.map(p => p.id + ':' + p.index.length / 3).join(' '),
            'picture', pic.width + 'x' + pic.height, 'used', (pic.used * 100).toFixed(0) + '%', 'bin', bytes.length, 'jpg', fs.statSync(path.join(OUT, id + '.jpg')).size, 'ms', Date.now() - started);
    }
})().catch(error => { console.error(error); process.exit(1); });

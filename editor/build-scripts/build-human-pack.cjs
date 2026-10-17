#!/usr/bin/env node
/**
 * Builds the Character Builder's human body pack from MakeHuman's CC0 data.
 *
 *   node editor/build-scripts/build-human-pack.cjs <makehuman/data folder>
 *
 * Writes src/forge/Character3D/data/human.json (layout, bones, sliders) and
 * human.bin (base mesh, skin, shape targets, eyes), plus the eye picture.
 * The source is the makehuman repository's makehuman/data folder
 * (github.com/makehumancommunity/makehuman, assets CC0 since 2020).
 *
 * Kept: the base mesh with every vertex (helpers included, since fitted
 * pieces such as the eyes ride on them), the body faces only, the macro
 * targets for child to old ages, height and cup targets for the average
 * build, and a handful of face and body shape targets. Skeleton: MakeHuman's
 * default rig reduced to Mixamo's humanoid bones, the dropped bones' weights
 * handed to the nearest kept ancestor.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA = process.argv[2];
if (!DATA || !fs.existsSync(path.join(DATA, '3dobjs', 'base.obj'))) {
    console.error('usage: build-human-pack.cjs <makehuman/data folder>');
    process.exit(1);
}
const OUT = path.join(__dirname, '..', 'src', 'forge', 'Character3D', 'data');
const UNIT = 0.1; // MakeHuman works in decimeters.

// ── base mesh ──────────────────────────────────────────────────────────────
function readObj(file, groupFilter) {
    const positions = [], uvs = [], faces = [];
    let group = '';
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (line.startsWith('v ')) { const p = line.split(/\s+/); positions.push(+p[1], +p[2], +p[3]); }
        else if (line.startsWith('vt ')) { const p = line.split(/\s+/); uvs.push(+p[1], +p[2]); }
        else if (line.startsWith('g ')) group = line.slice(2).trim();
        else if (line.startsWith('f ') && (!groupFilter || groupFilter(group))) {
            faces.push(line.trim().split(/\s+/).slice(1).map(c => { const [v, t] = c.split('/'); return [+v - 1, t ? +t - 1 : -1]; }));
        }
    }
    return { positions, uvs, faces };
}

/** Vertices split at UV seams: one render vertex per (vertex, uv) pair. */
function renderMesh(obj) {
    const key = new Map(), src = [], uv = [], index = [];
    const at = ([v, t]) => {
        const k = v * 65536 + t;
        let i = key.get(k);
        if (i === undefined) { i = src.length; key.set(k, i); src.push(v); uv.push(obj.uvs[t * 2], 1 - obj.uvs[t * 2 + 1]); }
        return i;
    };
    for (const face of obj.faces) {
        const ids = face.map(at);
        for (let k = 1; k + 1 < ids.length; k++) index.push(ids[0], ids[k], ids[k + 1]);
    }
    return { src, uv, index };
}

const base = readObj(path.join(DATA, '3dobjs', 'base.obj'), g => g === 'body');
const vertexCount = base.positions.length / 3;
const body = renderMesh(base);

// ── targets ────────────────────────────────────────────────────────────────
function readTarget(file) {
    const idx = [], d = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line || line[0] === '#') continue;
        const p = line.trim().split(/\s+/);
        if (p.length < 4) continue;
        idx.push(+p[0]); d.push(+p[1] * UNIT, +p[2] * UNIT, +p[3] * UNIT);
    }
    return { idx, d };
}
function mergeTargets(list) {
    const sum = new Map();
    for (const t of list) t.idx.forEach((v, i) => {
        const s = sum.get(v) || [0, 0, 0];
        s[0] += t.d[i * 3]; s[1] += t.d[i * 3 + 1]; s[2] += t.d[i * 3 + 2];
        sum.set(v, s);
    });
    const idx = [...sum.keys()].sort((a, b) => a - b);
    return { idx, d: idx.flatMap(v => sum.get(v)) };
}

const T = path.join(DATA, 'targets');
const targets = [];
const addTarget = (name, files) => {
    const present = files.map(f => path.join(T, f)).filter(f => fs.existsSync(f));
    if (!present.length) { console.warn('missing target', name, files); return; }
    const t = mergeTargets(present.map(readTarget));
    if (t.idx.length) targets.push({ name, ...t });
};

const GENDERS = ['female', 'male'], AGES = ['child', 'young', 'old'], LEVELS = ['min', 'average', 'max'];
for (const g of GENDERS) for (const a of AGES) for (const m of LEVELS) for (const w of LEVELS) {
    addTarget(`macro/${g}-${a}-${m}muscle-${w}weight`, [`macrodetails/universal-${g}-${a}-${m}muscle-${w}weight.target`]);
}
for (const r of ['african', 'asian', 'caucasian']) for (const g of GENDERS) for (const a of AGES) {
    addTarget(`race/${r}-${g}-${a}`, [`macrodetails/${r}-${g}-${a}.target`]);
}
for (const g of GENDERS) for (const a of AGES) for (const h of ['min', 'max']) {
    addTarget(`height/${g}-${a}-${h}`, [`macrodetails/height/${g}-${a}-averagemuscle-averageweight-${h}height.target`]);
}
for (const a of AGES) for (const c of ['min', 'max']) {
    addTarget(`cup/female-${a}-${c}`, [`breast/female-${a}-averagemuscle-averageweight-${c}cup-averagefirmness.target`]);
}
// Paired sliders: name → [decrease files, increase files].
const PAIRS = {
    'headFat': ['head/head-fat-decr', 'head/head-fat-incr'],
    'headWidth': ['head/head-scale-horiz-decr', 'head/head-scale-horiz-incr'],
    'headHeight': ['head/head-scale-vert-decr', 'head/head-scale-vert-incr'],
    'noseWidth': ['nose/nose-scale-horiz-decr', 'nose/nose-scale-horiz-incr'],
    'noseLength': ['nose/nose-scale-vert-decr', 'nose/nose-scale-vert-incr'],
    'noseHump': ['nose/nose-hump-decr', 'nose/nose-hump-incr'],
    'earSize': [['ears/l-ear-scale-decr', 'ears/r-ear-scale-decr'], ['ears/l-ear-scale-incr', 'ears/r-ear-scale-incr']],
    'shoulders': ['torso/torso-scale-horiz-decr', 'torso/torso-scale-horiz-incr'],
    'belly': ['stomach/stomach-pregnant-decr', 'stomach/stomach-pregnant-incr'],
    'hips': ['hip/hip-scale-horiz-decr', 'hip/hip-scale-horiz-incr'],
    'neck': ['neck/neck-scale-horiz-decr', 'neck/neck-scale-horiz-incr']
};
const files = x => (Array.isArray(x) ? x : [x]).map(f => f + '.target');
for (const [name, [down, up]] of Object.entries(PAIRS)) {
    addTarget(`shape/${name}-decr`, files(down));
    addTarget(`shape/${name}-incr`, files(up));
}
addTarget('shape/earsPointed', ['ears/l-ear-shape-pointed.target', 'ears/r-ear-shape-pointed.target']);

// ── skeleton ───────────────────────────────────────────────────────────────
const skel = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs', 'default.mhskel'), 'utf8'));
const weightsFile = JSON.parse(fs.readFileSync(path.join(DATA, 'rigs', 'default_weights.mhw'), 'utf8')).weights;
const KEEP = {
    'root': 'Hips', 'spine04': 'Spine', 'spine03': 'Spine1', 'spine02': 'Spine2', 'neck01': 'Neck', 'head': 'Head'
};
for (const [s, side] of [['L', 'Left'], ['R', 'Right']]) {
    Object.assign(KEEP, {
        [`clavicle.${s}`]: `${side}Shoulder`, [`upperarm01.${s}`]: `${side}Arm`, [`lowerarm01.${s}`]: `${side}ForeArm`,
        [`wrist.${s}`]: `${side}Hand`, [`upperleg01.${s}`]: `${side}UpLeg`, [`lowerleg01.${s}`]: `${side}Leg`,
        [`foot.${s}`]: `${side}Foot`, [`toe3-1.${s}`]: `${side}ToeBase`
    });
    ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((finger, i) => {
        for (let k = 1; k <= 3; k++) KEEP[`finger${i + 1}-${k}.${s}`] = `${side}Hand${finger}${k}`;
    });
}
const mhBones = skel.bones;
const keptOf = name => { let n = name; while (n && !KEEP[n]) n = mhBones[n].parent; return n; };
const bones = [];
const boneIndex = new Map();
// Parents before children: walk MakeHuman's tree depth-first.
const children = {};
for (const [n, b] of Object.entries(mhBones)) (children[b.parent] = children[b.parent] || []).push(n);
const walk = n => {
    if (KEEP[n]) {
        const parent = mhBones[n].parent ? keptOf(mhBones[n].parent) : null;
        boneIndex.set(n, bones.length);
        bones.push({ name: KEEP[n], parent: parent ? boneIndex.get(parent) : -1, head: skel.joints[mhBones[n].head], tail: skel.joints[mhBones[n].tail] });
    }
    for (const c of (children[n] || []).sort()) walk(c);
};
walk('root');

// Per-vertex top four influences after merging dropped bones upward.
const influence = Array.from({ length: vertexCount }, () => new Map());
for (const [bone, list] of Object.entries(weightsFile)) {
    const kept = keptOf(bone);
    if (!kept) continue;
    const j = boneIndex.get(kept);
    for (const [v, w] of list) influence[v].set(j, (influence[v].get(j) || 0) + w);
}
const skinJoints = new Uint8Array(vertexCount * 4), skinWeights = new Float32Array(vertexCount * 4);
for (let v = 0; v < vertexCount; v++) {
    const top = [...influence[v].entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0) || 1;
    if (!top.length) top.push([0, 1]);
    top.forEach(([j, w], k) => { skinJoints[v * 4 + k] = j; skinWeights[v * 4 + k] = w / total; });
}

// ── eyes (a fitted piece) ──────────────────────────────────────────────────
function readFitting(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const meta = { scale: {} }, refs = [], weights = [], offsets = [];
    let inVerts = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        const p = line.split(/\s+/);
        if (inVerts) {
            if (p.length === 1) { refs.push(+p[0], +p[0], +p[0]); weights.push(1, 0, 0); offsets.push(0, 0, 0); continue; }
            if (p.length < 9) { inVerts = false; continue; }
            refs.push(+p[0], +p[1], +p[2]); weights.push(+p[3], +p[4], +p[5]); offsets.push(+p[6], +p[7], +p[8]);
            continue;
        }
        if (p[0] === 'verts') { inVerts = true; continue; }
        if (/^[xyz]_scale$/.test(p[0])) meta.scale[p[0][0]] = [+p[1], +p[2], +p[3]];
        else if (p[0] === 'obj_file') meta.obj = p[1];
    }
    return { meta, refs, weights, offsets };
}
const eyeDir = path.join(DATA, 'eyes', 'high-poly');
const eyeFit = readFitting(path.join(eyeDir, 'high-poly.mhclo'));
const eyeObj = readObj(path.join(eyeDir, eyeFit.meta.obj));
const eyes = renderMesh(eyeObj);

// ── write ──────────────────────────────────────────────────────────────────
const chunks = [];
let offset = 0;
const put = (typed) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const at = offset;
    chunks.push(bytes); offset += bytes.length;
    return [at, typed.length];
};
const layout = {};
layout.positions = put(Float32Array.from(base.positions, x => x * UNIT));
layout.bodySource = put(Uint16Array.from(body.src));
layout.bodyUV = put(Float32Array.from(body.uv));
layout.bodyIndex = put(Uint32Array.from(body.index));
layout.skinJoints = put(skinJoints);
layout.skinWeights = put(skinWeights);
const targetMeta = targets.map(t => {
    let max = 0;
    for (const x of t.d) max = Math.max(max, Math.abs(x));
    const scale = (max || 1) / 32767;
    return { name: t.name, scale, index: put(Uint16Array.from(t.idx)), delta: put(Int16Array.from(t.d, x => Math.round(x / scale))) };
});
const eyeScale = {};
for (const axis of ['x', 'y', 'z']) { const [a, b, dist] = eyeFit.meta.scale[axis]; eyeScale[axis] = [a, b, dist * UNIT]; }
layout.eyes = {
    refs: put(Uint16Array.from(eyeFit.refs)), weights: put(Float32Array.from(eyeFit.weights)),
    offsets: put(Float32Array.from(eyeFit.offsets, x => x * UNIT)),
    source: put(Uint16Array.from(eyes.src)), uv: put(Float32Array.from(eyes.uv)), index: put(Uint32Array.from(eyes.index)),
    scale: eyeScale, texture: 'eye-brown.png'
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'human.bin'), Buffer.concat(chunks));
fs.copyFileSync(path.join(DATA, 'eyes', 'materials', 'brown_eye.png'), path.join(OUT, 'eye-brown.png'));
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify({
    format: 1,
    source: 'MakeHuman hm08 base mesh, targets, default rig and high-poly eyes (CC0 1.0, makehumancommunity.org)',
    vertexCount,
    layout,
    bones: bones.map(b => ({ name: b.name, parent: b.parent, head: b.head, tail: b.tail })),
    targets: targetMeta
}));
console.log(`vertices ${vertexCount}, body render vertices ${body.src.length}, triangles ${body.index.length / 3}, bones ${bones.length}, targets ${targets.length}, bin ${(offset / 1048576).toFixed(1)} MB`);

'use strict';
// Forge › Prop Builder: one recipe builds a prop; a flag's cloth is simulated in the tool and baked into a looping
// "Wave" clip on a grid of bones (RRPropCloth), which Save writes into a skinned GLB with its model.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
global.THREE = require(path.join(root, 'node_modules', 'three'));
const props = path.join(root, 'src', 'forge', 'Props');
const Cloth = require(path.join(props, 'PropCloth.js'));
const Flag = require(path.join(props, 'FlagProp.js'));
const Model = require(path.join(props, 'PropModel.js'));
const Optimizer = require(path.join(root, 'src', 'utils', 'GlbOptimizer.js'));
const { PNG } = require(path.join(root, 'node_modules', 'pngjs'));

const encode = t => { const p = new PNG({ width: t.width, height: t.height }); p.data = Buffer.from(t.data); return PNG.sync.write(p); };
const finite = (list, what) => { for (let i = 0; i < list.length; i++) assert.ok(Number.isFinite(list[i]), `${what}[${i}] = ${list[i]}`); };

/** An accessor's numbers out of a parsed GLB. */
function accessorData(json, bin, index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType];
    return new Type(bin.buffer.slice(bin.byteOffset + v.byteOffset + (a.byteOffset || 0), bin.byteOffset + v.byteOffset + (a.byteOffset || 0) + a.count * size * Type.BYTES_PER_ELEMENT));
}

/** A flag built, its loop baked, built again with the loop. */
function baked(recipe) {
    const first = Model.build(Object.assign({ kind: 'flag' }, recipe), {}, { textureSize: 512 });
    const loop = Model.bake(first);
    return Model.build(Object.assign({ kind: 'flag' }, recipe), {}, { textureSize: 512, loop });
}

test('a flag recipe is completed and kept in range', () => {
    const r = Model.normalize({ kind: 'flag', pole: { type: 'metal', height: 99, finial: 'gargoyle' }, cloth: { width: -3, aspect: '1:2', fabric: 'denim' }, wind: { strength: 7, direction: 500 }, design: { layout: 'tartan', colors: ['red', '#123456'] } });
    assert.equal(r.kind, 'flag');
    assert.equal(r.pole.height, 14);
    assert.equal(r.pole.finial, 'ball');
    assert.equal(r.cloth.width, 0.3);
    assert.equal(r.cloth.height, 0.15, 'a shape sets the height from the width');
    assert.equal(r.cloth.fabric, 'cotton');
    assert.equal(r.wind.strength, 1);
    assert.equal(r.wind.direction, 90);
    assert.equal(r.design.layout, Flag.DEFAULT.design.layout);
    assert.equal(r.design.colors[0], Flag.DEFAULT.design.colors[0], 'a color that is not one stays the default');
    assert.equal(r.design.colors[1], '#123456');
    // An empty recipe is the default flag, and normalizing twice changes nothing.
    assert.deepEqual(Model.normalize({}), Model.normalize(Model.normalize({})));
    assert.equal(Model.normalize({}).design.emblem.shape, Flag.DEFAULT.design.emblem.shape);
    // A height of its own is kept only with the Custom shape.
    assert.equal(Model.normalize({ kind: 'flag', cloth: { width: 1, aspect: 'custom', height: 1.7 } }).cloth.height, 1.7);
    // Each pole type starts from its own height, cloth and finial.
    for (const p of Flag.POLES) {
        const w = Flag.withPole({}, p.id);
        assert.equal(w.pole.type, p.id);
        assert.equal(w.pole.height, p.height[2]);
        assert.equal(w.cloth.width, p.width);
    }
});

test('every pole type, finial, fabric and design builds whole, within budget', () => {
    const recipes = [];
    for (const p of Flag.POLES) for (const [finial] of Flag.FINIALS) recipes.push({ pole: { type: p.id, finial } });
    for (const [fabric] of Flag.FABRICS) recipes.push({ cloth: { fabric, wear: 1 } });
    for (const l of Flag.LAYOUTS) for (const [shape] of Flag.EMBLEMS) recipes.push({ design: { layout: l.id, emblem: { shape, place: 'canton' } } });
    for (const aspect of Flag.ASPECTS.map(a => a[0])) recipes.push({ cloth: { aspect, width: 3 } });
    const cache = {};
    for (const recipe of recipes) {
        const result = Model.build(Object.assign({ kind: 'flag' }, recipe), cache, { textureSize: 256 });
        const what = JSON.stringify(recipe);
        const s = Model.stats(result);
        assert.ok(s.triangles <= 3000, what + ': ' + s.triangles + ' triangles');
        assert.ok(s.bones <= 128, what + ': ' + s.bones + ' bones');
        for (const part of result.parts) {
            const n = part.positions.length / 3;
            finite(part.positions, what + ' ' + part.name + ' positions');
            finite(part.normals, what + ' ' + part.name + ' normals');
            assert.equal(part.normals.length, n * 3);
            assert.equal(part.joints.length, n * 4);
            for (let v = 0; v < n; v++) {
                const w = part.weights[v * 4] + part.weights[v * 4 + 1] + part.weights[v * 4 + 2] + part.weights[v * 4 + 3];
                assert.ok(Math.abs(w - 1) < 1e-5, what + ' weights of ' + v);
                for (let k = 0; k < 4; k++) assert.ok(part.joints[v * 4 + k] < result.bones.length);
            }
            for (const i of part.index) assert.ok(i < n);
        }
        // The pole stands on the ground (the bracket's wall plate is up its wall).
        if (result.recipe.pole.type !== 'bracket') {
            let low = Infinity;
            for (const p of result.parts.slice(1)) for (let i = 1; i < p.positions.length; i += 3) low = Math.min(low, p.positions[i]);
            assert.ok(Math.abs(low) < 1e-6, what + ' foot at ' + low);
        }
    }
});

test('the cloth picture shows the design, its emblem and, worn, its holes; pictures stay at 1024 or less', () => {
    const r = Model.build({ kind: 'flag', design: { layout: 'solid', colors: ['#202080'], emblem: { shape: 'circle', color: '#e0e020', size: 0.6, place: 'center' } } }, {}, {});
    const pic = r.textures['cloth.png'];
    assert.ok(pic.width <= 1024 && pic.height <= 1024 && r.textures['cloth_normal.png'].width <= 1024);
    const at = (u, v) => { const o = (Math.floor(v * pic.height) * pic.width + Math.floor(u * pic.width)) * 4; return [pic.data[o], pic.data[o + 1], pic.data[o + 2], pic.data[o + 3]]; };
    const middle = at(0.5, 0.5), field = at(0.8, 0.2);
    assert.ok(middle[0] > 150 && middle[2] < 100, 'the emblem is yellow: ' + middle);
    assert.ok(field[2] > field[0] + 40, 'the field is blue: ' + field);
    assert.ok(field[3] === 255 && !r.parts[0].cutout, 'sound cloth is solid');
    const worn = Model.build({ kind: 'flag', cloth: { fabric: 'tattered', wear: 1 } }, {}, { textureSize: 512 });
    const wp = worn.textures['cloth.png'];
    let clear = 0;
    for (let i = 3; i < wp.data.length; i += 4) if (wp.data[i] < 128) clear++;
    assert.ok(clear > wp.data.length / 4 * 0.02, 'holes and a frayed fly: ' + clear);
    assert.ok(worn.parts[0].cutout);
    assert.ok(worn.cloth.setup.holes.some(h => h), 'the air goes through the holes');
    // A picture from the project is the whole design, stretched over the cloth.
    const image = { width: 2, height: 2, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]) };
    const pictured = Model.build({ kind: 'flag', design: { layout: 'image', image: 'Kingdom' } }, {}, { textureSize: 256, images: { Kingdom: image } });
    const pp = pictured.textures['cloth.png'], top = (Math.floor(pp.height * 0.1) * pp.width + Math.floor(pp.width * 0.9)) * 4;
    assert.ok(pp.data[top + 1] > 150 && pp.data[top] < 100, 'the picture\'s upper right is green');
    assert.equal(Model.build({ kind: 'flag', design: { layout: 'image', image: 'Missing' } }, {}, { textureSize: 256 }).imageMissing, true);
});

test('the cloth flies out in a wind and hangs in a calm, with nothing undefined', () => {
    const spread = recipe => {
        const r = Model.build(Object.assign({ kind: 'flag' }, recipe), {}, { textureSize: 128 });
        const sim = Cloth.create(r.cloth.setup);
        Cloth.advance(sim, 3);
        finite(sim.pos, 'positions');
        let far = 0;
        for (let i = 0; i < sim.pos.length; i += 3) far = Math.max(far, sim.pos[i]);
        return far;
    };
    const storm = spread({ wind: { strength: 0.9 } }), calm = spread({ wind: { strength: 0 } });
    assert.ok(storm > 1.3, 'a storm holds the fly out: ' + storm);
    assert.ok(calm < 0.9, 'a calm lets it hang: ' + calm);
});

test('the baked loop closes on itself, keeps the hoist pinned, and plays in the GLB as Wave', async () => {
    for (const recipe of [{ wind: { strength: 0.45, gust: 0.6 } }, { pole: { type: 'crossbar' }, cloth: { fabric: 'silk' } }]) {
        const result = baked(recipe);
        const loop = result.loop, grid = result.cloth.grid, F = loop.times.length;
        assert.equal(F, Flag.LOOP * 30 + 1);
        assert.ok(Math.abs(loop.times[F - 1] - Flag.LOOP) < 1e-6);
        for (let b = 0; b < grid.count; b++) {
            finite(loop.T[b], 'translation ' + b); finite(loop.Q[b], 'rotation ' + b);
            for (let k = 0; k < 3; k++) assert.equal(loop.T[b][k], loop.T[b][(F - 1) * 3 + k]);
            for (let k = 0; k < 4; k++) assert.equal(loop.Q[b][k], loop.Q[b][(F - 1) * 4 + k]);
        }
        // Skinned as the game skins it, the pinned edge stays where it is fixed all through the loop.
        const part = result.parts[0], pinned = result.cloth.setup.pinned, joints = part.joints.map(j => j - 1);
        const T = new Float32Array(grid.count * 3), Q = new Float32Array(grid.count * 4), out = new Float32Array(part.positions.length);
        let worst = 0, step = 0;
        for (let s = 0; s < 24; s++) {
            Cloth.sample(loop, Flag.LOOP * s / 24, T, Q);
            Cloth.skin(part.positions, joints, part.weights, result.cloth.restBones, T, Q, out);
            finite(out, 'skinned');
            for (let v = 0; v < pinned.length; v++) if (pinned[v]) worst = Math.max(worst, Math.hypot(out[v * 3] - part.positions[v * 3], out[v * 3 + 1] - part.positions[v * 3 + 1], out[v * 3 + 2] - part.positions[v * 3 + 2]));
        }
        assert.ok(worst < 0.005, 'the hoist moved ' + worst + ' m');
        // From the last key into the first, no jump larger than the loop's own steps.
        for (let f = 1; f < F; f++) for (let b = 0; b < grid.count; b++) step = Math.max(step, Math.hypot(loop.T[b][f * 3] - loop.T[b][(f - 1) * 3], loop.T[b][f * 3 + 1] - loop.T[b][(f - 1) * 3 + 1], loop.T[b][f * 3 + 2] - loop.T[b][(f - 1) * 3 + 2]));
        assert.ok(step < 0.6, 'largest step ' + step);

        const glb = await Model.toGlb(result, 'Flag', encode);
        const { json, bin } = Optimizer.parseGlb(glb);
        assert.equal(json.animations.length, 1);
        const anim = json.animations[0];
        assert.equal(anim.name, 'Wave');
        assert.equal(anim.channels.length, grid.count * 2);
        assert.ok(anim.channels.some(c => c.target.path === 'translation') && anim.channels.some(c => c.target.path === 'rotation'));
        for (const ch of anim.channels) {
            const sampler = anim.samplers[ch.sampler];
            assert.equal(sampler.interpolation, 'LINEAR');
            const values = accessorData(json, bin, sampler.output), size = ch.target.path === 'translation' ? 3 : 4, n = values.length / size;
            for (let k = 0; k < size; k++) assert.equal(values[k], values[(n - 1) * size + k], 'first and last keys of ' + json.nodes[ch.target.node].name);
        }
        const times = accessorData(json, bin, anim.samplers[0].input);
        assert.equal(times[0], 0);
        assert.ok(Math.abs(times[times.length - 1] - Flag.LOOP) < 1e-6);
        // Skinned on its own skeleton; the cloth's picture and relief inside; the cloth is double-sided.
        assert.equal(json.skins[0].joints.length, result.bones.length);
        const clothMaterial = json.materials[json.meshes[0].primitives[0].material];
        assert.ok(clothMaterial.doubleSided && clothMaterial.pbrMetallicRoughness.baseColorTexture && clothMaterial.normalTexture);
        assert.equal(json.images.length, 2);
        // model.json plays it always, and puts the pole's foot where the prop is placed.
        const side = Model.sidecar(result);
        assert.deepEqual(side.animations, [{ type: 'clip', trigger: 'always', name: 'Wave', clip: 'Wave', part: '' }]);
        side.transform.offset.forEach(v => assert.ok(Number.isFinite(v)));
        if (result.recipe.pole.type === 'metal') assert.ok(side.transform.offset[0] > 0.3, 'the box leans to the fly: ' + side.transform.offset);
    }
});

test('the Prop Builder is on the Forge sidebar, in the Forge menu and loaded by the editor page', () => {
    const forge = fs.readFileSync(path.join(root, 'src', 'forge', 'ForgeManager.js'), 'utf8');
    assert.match(forge, /id: 'prop-builder'[\s\S]*?new PropBuilder\(\)/);
    const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const order = ['PropCloth.js', 'PropPaint.js', 'PropMesh.js', 'FlagProp.js', 'PropModel.js', 'PropBuilder.js'].map(f => page.indexOf(`src/forge/Props/${f}`));
    order.forEach(i => assert.ok(i > 0));
    assert.deepEqual(order, order.slice().sort((a, b) => a - b), 'loaded in order');
    assert.ok(page.indexOf('src/forge/Character3D/CharacterGlb.js') < order[0], 'after the GLB writer');
    assert.ok(page.includes('data-action="forge-prop-builder"'));
    assert.match(fs.readFileSync(path.join(root, 'src', 'UIManager.js'), 'utf8'), /case 'forge-prop-builder':[\s\S]*?openForgeTool\('prop-builder'\)/);
});

// ── From picture ───────────────────────────────────────────────────────────
const Picture = require(path.join(props, 'PictureProp.js'));

/** A picture painted by `solid(x, y)` (in [0, 1]): solid pixels `color`, the rest clear or `background`. */
function picture(w, h, solid, background, color) {
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, on = solid((x + 0.5) / w, (y + 0.5) / h);
        const c = on ? (color || [200, 60, 40, 255]) : (background || [0, 0, 0, 0]);
        data.set(c, o);
    }
    return { width: w, height: h, data };
}
const ring = (x, y) => { const d = Math.hypot(x - 0.5, y - 0.5); return d < 0.42 && d > 0.2; };
const twoHoles = (x, y) => x > 0.1 && x < 0.9 && y > 0.1 && y < 0.9 && Math.hypot(x - 0.3, y - 0.5) > 0.12 && Math.hypot(x - 0.7, y - 0.5) > 0.12;

/** Each edge of a closed solid is shared by exactly two triangles, its points welded by place. */
function watertight(mesh) {
    const P = mesh.positions, key = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]].map(v => Math.round(v * 1e5)).join(',');
    const ids = new Map(), id = i => { const k = key(i); if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k); };
    const edges = new Map();
    for (let t = 0; t < mesh.index.length; t += 3) {
        const v = [id(mesh.index[t]), id(mesh.index[t + 1]), id(mesh.index[t + 2])];
        if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
        for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3], e = a < b ? a + ':' + b : b + ':' + a; edges.set(e, (edges.get(e) || 0) + 1); }
    }
    return [...edges.values()].filter(n => n !== 2).length;
}

const frontCovers = (mesh, x, y) => {
    const P = mesh.positions, I = mesh.index;
    for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const d = (P[b + 1] - P[c + 1]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 1] - P[c + 1]);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((P[b + 1] - P[c + 1]) * (x - P[c]) + (P[c] - P[b]) * (y - P[c + 1])) / d, l2 = ((P[c + 1] - P[a + 1]) * (x - P[c]) + (P[a] - P[c]) * (y - P[c + 1])) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) return true;
    }
    return false;
};

test('a picture recipe is completed and kept in range', () => {
    const r = Model.normalize({ kind: 'picture', mode: 'sculpt', cutout: { thickness: 9, edge: 'wavy' }, turned: { segments: 400, profile: [[2, 0.5], [0.1, 0]] }, framed: { object: 'piano' } });
    assert.equal(r.kind, 'picture');
    assert.equal(r.mode, 'cutout');
    assert.equal(r.cutout.thickness, 0.5);
    assert.equal(r.cutout.edge, 'bevel');
    assert.equal(r.turned.segments, 48);
    assert.deepEqual(r.turned.profile, [[0.1, 0], [0.6, 0.5]], 'points sorted up the height, radii in range');
    assert.equal(r.framed.object, 'painting');
    assert.deepEqual(Model.normalize(r), r);
});

test('a traced outline keeps its holes as holes', () => {
    for (const [solid, holes] of [[ring, 1], [twoHoles, 2]]) {
        const mask = Picture.maskOf(picture(120, 120, solid), 'alpha', 0, 256);
        const list = Picture.shapes(mask, 400);
        assert.equal(list.length, 1, 'one piece');
        assert.equal(list[0].holes.length, holes, 'its holes');
        const r = Model.build({ kind: 'picture', mode: 'cutout', image: 'p', cutout: { size: 1, edge: 'square' } }, {}, { images: { p: picture(120, 120, solid) } });
        const front = r.parts.find(p => p.name === 'Front');
        // Made solid, a hole has no cloth of the front over it; the solid part has.
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < front.positions.length; i += 3) { minX = Math.min(minX, front.positions[i]); maxX = Math.max(maxX, front.positions[i]); minY = Math.min(minY, front.positions[i + 1]); maxY = Math.max(maxY, front.positions[i + 1]); }
        const at = (u, v) => [minX + (maxX - minX) * u, maxY - (maxY - minY) * v];
        if (holes === 1) { assert.ok(!frontCovers(front, ...at(0.5, 0.5)), 'the ring is open in the middle'); assert.ok(frontCovers(front, ...at(0.5, 0.11))); }
        else { assert.ok(!frontCovers(front, ...at(0.25, 0.5)) && !frontCovers(front, ...at(0.75, 0.5)), 'both holes open'); assert.ok(frontCovers(front, ...at(0.5, 0.5))); }
    }
    // A background color taken away from the border in, the picture's own pixels of that color inside kept.
    const boxed = picture(100, 100, (x, y) => x > 0.2 && x < 0.8 && y > 0.2 && y < 0.8 && !(x > 0.45 && x < 0.55 && y > 0.45 && y < 0.55), [255, 255, 255, 255], [30, 30, 160, 255]);
    const m = Picture.maskOf(boxed, 'color', 0.2, 256);
    assert.equal(m.mode, 'color');
    assert.equal(m.m[2 * m.w + 2], 0, 'the border background is gone');
    assert.equal(m.m[50 * m.w + 50], 1, 'a white middle the background never reaches stays');
});

test('a busy picture keeps to the triangle budget; every mode builds whole, the turned body watertight', () => {
    const rand = (() => { let s = 7; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
    const blobs = Array.from({ length: 60 }, () => [rand(), rand(), 0.02 + rand() * 0.08]);
    const busy = picture(300, 240, (x, y) => blobs.some(([bx, by, r]) => Math.hypot(x - bx, y - by) < r) || (Math.sin(x * 60) > 0.6 && y > 0.4 && y < 0.6));
    const vase = picture(100, 160, (x, y) => Math.abs(x - 0.5) < 0.18 + 0.2 * Math.sin(Math.PI * Math.min(1, (1 - y) * 1.3)) && y > 0.05 && y < 0.95);
    const images = { busy, vase };
    const recipes = [];
    for (const [edge] of Picture.EDGES) for (const [back] of Picture.BACKS) for (const [stand] of Picture.STANDS) recipes.push({ mode: 'cutout', image: 'busy', cutout: { edge, back, stand } });
    for (const [surface] of Picture.SURFACES) for (const top of ['open', 'closed']) for (const wall of [0, 0.02]) recipes.push({ mode: 'turned', image: 'vase', turned: { surface, top, wall } });
    recipes.push({ mode: 'turned', turned: { fromPicture: false, segments: 48 } });
    for (const [object] of Picture.OBJECTS) for (const [frame] of Picture.FRAMES) recipes.push({ mode: 'framed', image: 'vase', framed: { object, frame } });
    recipes.push({ mode: 'cutout' }, { mode: 'framed' });
    for (const recipe of recipes) {
        const what = JSON.stringify(recipe);
        const r = Model.build(Object.assign({ kind: 'picture' }, recipe), {}, { images, textureSize: 256 });
        const s = Model.stats(r);
        assert.ok(s.triangles <= 5000, what + ': ' + s.triangles + ' triangles');
        for (const [w, h] of s.textures) assert.ok(w <= 1024 && h <= 1024, what + ' picture ' + w + 'x' + h);
        for (const p of r.parts) {
            finite(p.positions, what + ' ' + p.name); finite(p.normals, what + ' ' + p.name + ' normals');
            if (p.uvs) finite(p.uvs, what + ' ' + p.name + ' uvs');
            for (const i of p.index) assert.ok(i < p.positions.length / 3);
        }
        if (recipe.mode === 'turned') assert.equal(watertight(r.parts[0]), 0, what + ' open edges');
        // A still prop keeps its form in its vertex colors (the game lights by place, not by facing).
        if (!r.cloth) for (const p of r.parts) { assert.equal(p.colors.length, p.positions.length, what + ' ' + p.name + ' colors'); finite(p.colors, what + ' colors'); }
    }
    // The turned body follows the picture's silhouette: widest where the picture is.
    const t = Model.build({ kind: 'picture', mode: 'turned', image: 'vase', turned: { height: 1, wall: 0 } }, {}, { images });
    const widthAt = y => { let w = 0; const P = t.parts[0].positions; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - y) < 0.04) w = Math.max(w, Math.hypot(P[i], P[i + 2])); return w; };
    assert.ok(widthAt(0.62) > widthAt(0.1) + 0.05, 'the belly is wider than the foot');
    assert.ok(Math.abs(widthAt(0.62) - (0.18 + 0.2) * 100 / 160 * (1 / 0.9)) < 0.08, 'the belly as wide as the picture\'s: ' + widthAt(0.62));
});

test('a picture prop saves as a GLB with its picture inside; a hanging banner flies on the Flag\'s cloth', async () => {
    const sign = picture(64, 48, ring, null, [20, 120, 220, 255]);
    const r = Model.build({ kind: 'picture', mode: 'cutout', image: 'sign', cutout: { back: 'mirror' } }, {}, { images: { sign } });
    const { json } = Optimizer.parseGlb(await Model.toGlb(r, 'Sign', encode));
    assert.ok(json.images.length >= 1);
    const front = json.materials[json.meshes[0].primitives[0].material];
    assert.ok(front.pbrMetallicRoughness.baseColorTexture, 'the face shows the picture');
    assert.ok(!json.animations, 'a still prop has no clip');
    assert.ok(!Model.sidecar(r).animations);
    const banner = Model.build({ kind: 'picture', mode: 'framed', image: 'sign', framed: { object: 'banner', size: 0.8 } }, {}, { images: { sign }, textureSize: 256 });
    assert.ok(banner.cloth && banner.recipe.kind === 'picture');
    assert.equal(banner.cloth.setup.pinned[0], 1);
    const loop = Model.bake(banner);
    const flying = Model.build({ kind: 'picture', mode: 'framed', image: 'sign', framed: { object: 'banner', size: 0.8 } }, {}, { images: { sign }, textureSize: 256, loop });
    const glb = Optimizer.parseGlb(await Model.toGlb(flying, 'Banner', encode)).json;
    assert.equal(glb.animations[0].name, 'Wave');
});

test('real pictures: the Demo minimap frame keeps its window open; the logo cuts into its pieces within budget', () => {
    const read = name => {
        const file = path.join(root, '..', 'template', 'Demo', 'img', 'pictures', name);
        if (!fs.existsSync(file)) return null;
        const png = PNG.sync.read(fs.readFileSync(file));
        return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
    };
    const frame = read('Minimap-Frame.png'), logo = read('Psychronic-logo-1.png');
    if (!frame || !logo) return;
    const framed = Picture.shapes(Picture.maskOf(frame, 'auto', 0.25, 256), 400);
    assert.equal(framed.length, 1);
    assert.equal(framed[0].holes.length, 1, 'the window is a hole');
    // The logo on black: the black taken away, the skull and each letter a piece of its own.
    const pieces = Picture.shapes(Picture.maskOf(logo, 'auto', 0.25, 256), 400);
    assert.ok(pieces.length >= 10, 'the skull and the letters: ' + pieces.length);
    for (const edge of ['square', 'bevel', 'round']) {
        const r = Model.build({ kind: 'picture', mode: 'cutout', image: 'logo', cutout: { edge } }, {}, { images: { logo } });
        assert.ok(Model.stats(r).triangles <= 5000, edge + ' ' + Model.stats(r).triangles);
    }
});

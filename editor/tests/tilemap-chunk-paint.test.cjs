const assert = require('node:assert/strict');
const test = require('node:test');
const { loadRuntimeTilemap, makeTilemap, PIXI } = require('./helpers/runtime-tilemap.cjs');

// A map with every kind of tile the paint treats differently: water and
// waterfalls (A1), table tiles and their edges (A2), walls (A3/A4), A5,
// upper (star) tiles, shadows, and tiles against the map's edges.
function testMap(width = 40, height = 30, seed = 7) {
    let s = seed;
    const rand = n => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
    const data = new Array(width * height * 6).fill(0);
    const at = (x, y, z) => (z * height + y) * width + x;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const area = (Math.floor(x / 7) + Math.floor(y / 6) * 3) % 6;
            let ground;
            // Shapes as each autotile table allows: 48 floor, 16 wall, 4 waterfall.
            if (area === 0) ground = 2048 + rand(4) * 48 + rand(48);                   // still water, deep water, rocks
            else if (area === 1) {                                                     // water and waterfall kinds
                const kind = 4 + rand(12);
                ground = 2048 + kind * 48 + rand(kind % 2 ? 4 : 48);
            } else if (area === 2) ground = 2816 + rand(32) * 48 + rand(48);           // A2 ground and tables
            else if (area === 3) ground = 4352 + rand(32) * 48 + rand(16);              // A3 roofs and walls
            else if (area === 4) {                                                     // A4 tops and walls
                const kind = rand(48);
                ground = 5888 + kind * 48 + rand(Math.floor(kind / 8) % 2 ? 16 : 48);
            } else ground = 1536 + rand(128);                                          // A5
            data[at(x, y, 0)] = ground;
            if (rand(4) === 0) data[at(x, y, 1)] = 2816 + rand(32) * 48 + rand(48);
            if (rand(3) === 0) data[at(x, y, 2)] = 1 + rand(255);
            if (rand(5) === 0) data[at(x, y, 3)] = 256 + rand(512);
            data[at(x, y, 4)] = rand(16);
        }
    }
    const flags = new Array(8192).fill(0);
    for (let id = 0; id < 8192; id++) {
        if (id % 7 === 0) flags[id] |= 0x10;
        if (id >= 2816 && id < 4352 && Math.floor((id - 2816) / 48) % 3 === 0) flags[id] |= 0x80;
    }
    return { width, height, data, flags };
}

function quadsOf(positions, uvs, count, offsetX, offsetY, into) {
    for (let n = 0; n < count; n++) {
        const p = n * 8;
        const x0 = positions[p] + offsetX, y0 = positions[p + 1] + offsetY;
        const x1 = positions[p + 4] + offsetX, y1 = positions[p + 5] + offsetY;
        if (x1 === x0 && y1 === y0) continue;
        into.push([x0, y0, x1, y1, uvs[p], uvs[p + 1], uvs[p + 4], uvs[p + 5]].map(v => Math.round(v * 1e6) / 1e6));
    }
    return into;
}

// Each cell's quads, in drawing order, in the layer's own space.
function cells(quads, tileWidth, tileHeight, cols, rows) {
    const out = new Map();
    for (const q of quads) {
        const cx = Math.floor(q[0] / tileWidth), cy = Math.floor(q[1] / tileHeight);
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        const key = cx + ',' + cy;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(q.join(' '));
    }
    return out;
}

function stockQuads(tilemap, combined) {
    const quads = [];
    for (const layer of combined.children) {
        if (layer._v8Quads && layer._v8Mesh && layer._v8Mesh.visible) {
            quadsOf(layer._v8Quads.positions, layer._v8Quads.uvs, layer._v8Quads.used, 0, 0, quads);
        }
    }
    return quads;
}

function chunkQuads(tilemap, root) {
    const quads = [];
    for (const mesh of root.children) {
        if (!mesh.visible) continue;
        const geometry = mesh.geometry;
        const count = geometry.positions.length / 8;
        quadsOf(geometry.positions, geometry.uvs, count, root.x + mesh.x, root.y + mesh.y, quads);
    }
    return quads;
}

function viewOf(tilemap) {
    return {
        cols: Math.ceil((tilemap.width + tilemap._margin * 2) / tilemap.tileWidth) + 1,
        rows: Math.ceil((tilemap.height + tilemap._margin * 2) / tilemap.tileHeight) + 1
    };
}

function pair(map = testMap()) {
    const stock = loadRuntimeTilemap();
    stock.Tilemap.ChunkPaint.enabled = false;
    const chunked = loadRuntimeTilemap();
    const a = makeTilemap(stock, map);
    const b = makeTilemap(chunked, map);
    return { stock, chunked, a, b };
}

function step(context, tilemap, x, y) {
    tilemap.origin.x = x;
    tilemap.origin.y = y;
    context.Graphics.frameCount++;
    tilemap.update();
}

test('chunked painting draws the same quads, cell by cell and in order, as the full paint', () => {
    const { stock, chunked, a, b } = pair();
    assert.equal(chunked.$reactorTilemapStats.chunkFallback, '');
    // A walk over the map, through every water frame, past the edges.
    const path = [];
    for (let f = 0; f < 260; f++) path.push([-30 + f * 7, 10 + f * 3]);
    let compared = 0;
    for (const [x, y] of path) {
        step(stock, a, x, y);
        step(chunked, b, x, y);
        assert.equal(chunked.$reactorTilemapStats.chunked, true);
        if (a.animationCount % 17 !== 0 && a.animationCount % 30 !== 1) continue;
        const { cols, rows } = viewOf(a);
        for (const [stockLayer, root] of [[a._lowerLayer, b._rrChunks.lowerRoot], [a._upperLayer, b._rrChunks.upperRoot]]) {
            const want = cells(stockQuads(a, stockLayer), a.tileWidth, a.tileHeight, cols, rows);
            const got = cells(chunkQuads(b, root), b.tileWidth, b.tileHeight, cols, rows);
            assert.ok(want.size > 0);
            for (const [key, list] of want) assert.deepEqual(got.get(key), list, `cell ${key} at frame ${a.animationCount}`);
            for (const key of got.keys()) assert.ok(want.has(key), `extra cell ${key}`);
        }
        compared++;
    }
    assert.ok(compared > 10);
    const stats = chunked.$reactorTilemapStats;
    assert.ok(stats.animPatches > 0, 'water moved by UV offset');
    assert.equal(stats.meshBuilds, 0, 'the full-view mesh was never built');
    assert.ok(stock.$reactorTilemapStats.meshBuilds > 40, 'the full paint rebuilt as the view moved');
});

test('walking builds blocks ahead of the view, not whole views', () => {
    const { chunked, b } = pair(testMap(120, 120));
    const stats = chunked.$reactorTilemapStats;
    step(chunked, b, 40 * 48, 40 * 48);
    const first = stats.chunkSyncBuilds;
    assert.ok(first > 0);
    for (let f = 0; f < 400; f++) step(chunked, b, 40 * 48 + f * 3, 40 * 48);
    assert.equal(stats.chunkSyncBuilds, first, 'every block the view reached was already built');
    assert.ok(stats.chunkBuilds > first, 'blocks were built ahead');
    assert.ok(stats.chunksLive < 60, 'blocks far behind are let go');
    assert.ok(b._rrChunks.pool.length > 0, 'and their meshes kept for reuse');
});

test('a plugin hook on the painting path keeps the full paint, and the hook runs', () => {
    const { chunked, b } = pair();
    step(chunked, b, 100, 100);
    assert.equal(chunked.$reactorTilemapStats.chunked, true);
    const lowerRoot = b._rrChunks.lowerRoot;
    let calls = 0;
    const original = chunked.Tilemap.prototype._addSpot;
    chunked.Tilemap.prototype._addSpot = function() { calls++; return original.apply(this, arguments); };
    step(chunked, b, 100, 100);
    assert.equal(chunked.$reactorTilemapStats.chunked, false);
    assert.match(chunked.$reactorTilemapStats.chunkFallback, /_addSpot/);
    assert.equal(b._rrChunks, null);
    assert.equal(lowerRoot.parent, null, 'the blocks are gone from the layer');
    assert.ok(calls > 100, 'the full paint ran through the plugin hook');
    assert.ok(b._lowerLayer.children[0]._v8Mesh.visible, 'and drew');
    chunked.Tilemap.prototype._addSpot = original;
    step(chunked, b, 100, 100);
    assert.equal(chunked.$reactorTilemapStats.chunked, true, 'back once the hook is gone');
    assert.equal(b._lowerLayer.children[0]._v8Mesh.visible, false, 'the full-view mesh hides');
});

test('layer hooks, plugin tile layers, tile frames and the switch keep the full paint', () => {
    const cases = {
        'Layer.addRect': c => { const o = c.Tilemap.Layer.prototype.addRect; c.Tilemap.Layer.prototype.addRect = function() { return o.apply(this, arguments); }; },
        'plugin layer': (c, t) => { const layer = new c.Tilemap.Layer(); t.addChild(layer); },
        'tile frames': (c, t) => { t._rrTileFrames = { 5: [5, 6] }; },
        'switch': c => { c.Tilemap.ChunkPaint.enabled = false; },
        'UltraMode7': c => { c.UltraMode7 = { isActive: () => false }; },
        'updateTransform': (c, t) => { const o = t.updateTransform; t.updateTransform = function() { return o.apply(this, arguments); }; }
    };
    for (const [name, apply] of Object.entries(cases)) {
        const { chunked, b } = pair();
        step(chunked, b, 0, 0);
        apply(chunked, b);
        b.updateTransform();
        assert.equal(chunked.$reactorTilemapStats.chunked, false, name);
        assert.equal(b._rrChunks, null, name);
    }
});

test('a profiler-timed paint method still paints in chunks', () => {
    const { chunked, b } = pair();
    const original = chunked.Tilemap.prototype._addAllSpots;
    const timed = function() { return original.apply(this, arguments); };
    timed.__rrProfilerOriginal = original;
    chunked.Tilemap.prototype._addAllSpots = timed;
    step(chunked, b, 0, 0);
    assert.equal(chunked.$reactorTilemapStats.chunked, true);
});

test('map data written without refresh shows within a pass of the block check; refresh rebuilds at once', () => {
    const map = testMap();
    const { chunked, b } = pair(map);
    step(chunked, b, 0, 0);
    const chunk = b._rrChunks.chunks.get(chunked.Tilemap._rrChunkKey(0, 0));
    const before = chunk.lower.quads.uvs.slice(0, 8);
    map.data[0] = 2; // tile (0,0), layer 0: a B tile instead of the ground autotile
    for (let f = 0; f < b._rrChunks.live.length + 1; f++) step(chunked, b, 0, 0);
    const after = b._rrChunks.chunks.get(chunked.Tilemap._rrChunkKey(0, 0));
    assert.notDeepEqual(Array.from(after.lower.quads.uvs.slice(0, 8)), Array.from(before));
    const builds = chunked.$reactorTilemapStats.chunkSyncBuilds;
    b.refresh();
    step(chunked, b, 0, 0);
    assert.ok(chunked.$reactorTilemapStats.chunkSyncBuilds > builds);
});

test('a hidden tilemap (a 3D map) builds no blocks and holds no atlas', () => {
    const { chunked, b } = pair();
    b._lowerLayer.visible = false;
    b._upperLayer.visible = false;
    step(chunked, b, 0, 0);
    assert.ok(!b._rrChunks);
    assert.equal(chunked.$reactorTilemapStats.chunkBuilds, 0);
    assert.equal(chunked.atlasRequests, 0);
});

test('the tile atlas packs MZ sheets well under the old fixed size, sheets apart', () => {
    const { Tilemap } = loadRuntimeTilemap();
    const sizes = [[768, 576], [768, 576], [768, 384], [768, 720], [384, 768], [768, 768], [768, 768], [768, 768], [768, 768]];
    const images = Array.from({ length: 11 }, (_, i) => sizes[i] ? { width: sizes[i][0], height: sizes[i][1] } : null);
    const packed = Tilemap.Layer._v8AtlasLayout(images, 4096);
    assert.ok(packed.width * packed.height <= 0.4 * 4096 * 3072, `${packed.width}x${packed.height}`);
    const rects = sizes.map((s, i) => [packed.ox[i], packed.oy[i], s[0], s[1]]);
    rects.push([packed.shadowX, packed.shadowY, 2, 2]);
    for (const [x, y, w, h] of rects) assert.ok(x >= 0 && y >= 0 && x + w <= packed.width && y + h <= packed.height);
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const [ax, ay, aw, ah] = rects[i], [bx, by, bw, bh] = rects[j];
            assert.ok(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay, `sheets ${i} and ${j} overlap`);
        }
    }
    assert.throws(() => Tilemap.Layer._v8AtlasLayout(images, 2048), /texture limit/, 'past the GPU limit: the sprite fallback takes over');
    Tilemap.Layer.v8AtlasPacked = false;
    const fixed = Tilemap.Layer._v8AtlasLayout(images, 4096);
    assert.deepEqual([fixed.width, fixed.height, fixed.ox[5], fixed.oy[5]], [4096, 3072, 1024, 1024]);
});

test('a tile rect past its sheet edge is clipped; one wholly past it draws nothing', () => {
    const { Tilemap } = loadRuntimeTilemap();
    const atlas = { width: 1000, height: 1000, shadowX: 0, shadowY: 0,
        ox: [100], oy: [200], rw: [96], rh: [96] };
    const positions = new Float32Array(16), uvs = new Float32Array(16);
    Tilemap.Layer._writeV8Quad(atlas, positions, uvs, 0, 0, 72, 0, 10, 20, 48, 48);
    assert.deepEqual(Array.from(positions.slice(0, 8)), [10, 20, 34, 20, 34, 68, 10, 68], 'the 24px inside the sheet');
    assert.ok(uvs[2] * 1000 < 100 + 96 && uvs[2] * 1000 > 100 + 95.9);
    Tilemap.Layer._writeV8Quad(atlas, positions, uvs, 1, 0, 96, 0, 10, 20, 48, 48);
    assert.ok(positions.slice(8).every(v => v === 0));
});

test('the atlas lets its CPU copy go once the GPU holds it, and draws it again when the GPU loses it', () => {
    const context = loadRuntimeTilemap();
    const { Tilemap } = context;
    let paints = 0;
    Tilemap.Layer._paintV8Atlas = entry => { paints++; entry.canvas.width = entry.width; entry.canvas.height = entry.height; entry.dropped = false; };
    const gl = { isContextLost: () => false };
    context.Graphics.app = { renderer: { uid: 3, gl } };
    const entry = { width: 64, height: 32, canvas: { width: 64, height: 32 }, source: { _gpuData: {} }, dropped: false };
    Tilemap.Layer._keepV8AtlasPixels(entry);
    assert.equal(entry.dropped, false, 'not before the upload');
    entry.source._gpuData[3] = { width: 64, height: 32 };
    Tilemap.Layer._keepV8AtlasPixels(entry);
    assert.equal(entry.dropped, true);
    assert.deepEqual([entry.canvas.width, entry.canvas.height], [1, 1]);
    entry.source._gpuData[3] = null; // texture GC or a lost context
    Tilemap.Layer._keepV8AtlasPixels(entry);
    assert.equal(paints, 1);
    assert.equal(entry.dropped, false);
    assert.equal(entry.canvas.width, 64);
    Tilemap.Layer.v8AtlasDropsCanvas = false;
    entry.source._gpuData[3] = { width: 64, height: 32 };
    Tilemap.Layer._keepV8AtlasPixels(entry);
    assert.equal(entry.dropped, false, 'kept with the switch off');
});

test('the full paint reuses its arrays between paints', () => {
    const { stock, a } = pair();
    const layer = a._lowerLayer.children[0];
    const arrays = new Set();
    for (let f = 0; f < 200; f++) {
        step(stock, a, f * 5, 0);
        arrays.add(layer._v8Geometry.positions);
    }
    assert.ok(stock.$reactorTilemapStats.meshBuilds > 10);
    assert.ok(arrays.size <= 3, `the same arrays, uploaded again (${arrays.size} made)`);
    assert.ok(PIXI);
});

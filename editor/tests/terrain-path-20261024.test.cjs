'use strict';
// Roads painted on the ground (2026-10-24): the Path tool lays a road as wide as asked along a drag, with no gaps
// however fast the pointer went, or straight from end to end; the road is a ground type made once by its name.
// The Ground brush lays its dabs all the way along a stroke too. And a floor in hand lays a square of tiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const editorRoot = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(editorRoot, p), 'utf8');
const quiet = { log() {}, warn() {}, error() {}, debug() {} };

function terrainOn(map) {
    const context = { console: quiet, setTimeout, clearTimeout,
        document: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, getElementById: () => null },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
    context.window = context;
    for (const file of ['MapElevation.js', 'MapFoliage.js', 'MapGround.js']) vm.runInNewContext(read('src/utils/' + file), context);
    vm.runInNewContext(read('src/TerrainManager.js') + '\nwindow.TerrainManager = TerrainManager;', context);
    const terrain = new context.TerrainManager({ getTilemapManager: () => ({ currentMap: map }) });
    return { terrain, G: context.RRMapGround };
}
const mapOf = (w, h) => ({ id: 1, width: w, height: h, data: new Array(w * h * 6).fill(0), events: [], reactor3d: { version: 1, mode: '3d', room: { floor: 'Grass' } } });

test('a road dragged fast is one road, as wide as asked, with nothing missing between the pointer\'s steps', () => {
    const map = mapOf(40, 20); const { terrain, G } = terrainOn(map);
    terrain.setMode('path'); terrain.pathWidth = 3; terrain.pathSurface = 1;
    // The pointer seen only three times across thirty tiles.
    terrain.beginStroke({ x: 2, y: 9 }); terrain.paintAt({ x: 18, y: 9 }); terrain.paintAt({ x: 34, y: 9 }); terrain.endStroke();
    const types = G.types(map);
    assert.equal(types.length, 1);
    assert.equal(types[0].name, 'Cobblestone', 'the road made as a ground of its own name');
    assert.equal(types[0].bare, true, 'nothing grows on it');
    const levels = G.levelsOf(map, 0);
    for (let x = 3; x <= 34; x++) assert.ok(levels[9 * 40 + x] >= 8, 'painted at ' + x);
    assert.ok(levels[8 * 40 + 20] >= 8 && levels[10 * 40 + 20] >= 8, 'three tiles wide');
    assert.equal(levels[5 * 40 + 20], 0, 'and no wider');
    assert.equal(terrain.undoStack.length, 2, 'the new ground, then the stroke: each an undo step');
    // The same road again: no second ground of that name.
    terrain.beginStroke({ x: 2, y: 15 }); terrain.paintAt({ x: 10, y: 15 }); terrain.endStroke();
    assert.equal(G.types(map).length, 1);
});

test('a Line road runs straight from where the drag began to where it ended, whatever the pointer did between', () => {
    const map = mapOf(30, 30); const { terrain, G } = terrainOn(map);
    terrain.setMode('path'); terrain.pathShape = 'line'; terrain.pathWidth = 2;
    terrain.beginStroke({ x: 2, y: 2 }); terrain.paintAt({ x: 25, y: 5 }); terrain.paintAt({ x: 20, y: 20 }); terrain.endStroke();
    const levels = G.levelsOf(map, 0);
    for (let t = 0; t <= 18; t++) assert.ok(levels[(2 + t) * 30 + (2 + t)] >= 8, 'on the diagonal at ' + (2 + t));
    assert.equal(levels[5 * 30 + 25], 0, 'nothing where the pointer only passed');
});

test('the Ground brush lays its dabs all along a fast stroke too', () => {
    const map = mapOf(40, 10); const { terrain, G } = terrainOn(map);
    terrain.setMode('ground'); terrain.addGroundType({ name: 'Sand', material: 'Sand' }); terrain.radius = 1; terrain.strength = 1;
    terrain.beginStroke({ x: 2, y: 4 }); terrain.paintAt({ x: 36, y: 4 }); terrain.endStroke();
    const levels = G.levelsOf(map, 0);
    for (let x = 3; x <= 36; x++) assert.ok(levels[4 * 40 + x] > 0, 'painted at ' + x);
});

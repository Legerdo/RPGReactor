'use strict';
// The Build bar made plain (2026-10-24): drawing modes on the panel (a brush, a straight line, a rectangle filled or
// outlined), the level of what is in hand and of what is placed, floors and blocks at quarter levels, and walls,
// panes and pillars at a height of their own, drawn, stood against and hidden by that height.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const repoRoot = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(repoRoot, p), 'utf8');
global.self = global; global.window = global;
require(path.join(repoRoot, 'runtime/libs/three.js'));
const R = require(path.join(repoRoot, 'runtime/reactor_3d.js'));
global.Reactor3D = R;
function builderOn(map) {
    const context = { console, JSON, Math, Object, Array, Number, String, Set, Map,
        document: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
        CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } } };
    context.window = context;
    context.reactor = { buildHotbar: { visible: true, flash() {}, hide() {} } };
    vm.runInNewContext(read('editor/src/utils/MapElevation.js'), context);
    vm.runInNewContext(read('editor/src/utils/StructurePlan.js'), context);
    vm.runInNewContext(read('editor/src/PieceBuilderManager.js') + '\nwindow.PieceBuilderManager = PieceBuilderManager;', context);
    const manager = new context.PieceBuilderManager({ getTilemapManager: () => ({ currentMap: map }) });
    manager.announce = () => {};
    return { manager, E: context.RRMapElevation, P: context.PieceBuilderManager };
}
const freshMap = () => ({ id: 1, width: 20, height: 20, reactor3d: { version: 1 } });
const cells = (E, map, kind) => Array.from(E.pieces(map).filter(p => p.kind === kind), p => p.x + ',' + p.y).sort();
const stroke = (manager, from, to) => { manager.beginStroke(from); manager.paintAt(to); manager.endStroke(); };

test('a line is a straight run from where the drag began, every cell sharing a side with the last', () => {
    const { manager, E, P } = builderOn(freshMap());
    assert.equal(JSON.stringify(P.lineCells({ x: 0, y: 0 }, { x: 3, y: 2 }).map(c => [c.x, c.y])), '[[0,0],[1,0],[1,1],[2,1],[2,2],[3,2]]');
    for (const [a, b] of [[{ x: 1, y: 1 }, { x: 8, y: 5 }], [{ x: 9, y: 9 }, { x: 2, y: 12 }]]) {
        const line = P.lineCells(a, b);
        assert.deepEqual([line[0].x, line[0].y, line.at(-1).x, line.at(-1).y], [a.x, a.y, b.x, b.y]);
        for (let i = 1; i < line.length; i++) assert.equal(Math.abs(line[i].x - line[i - 1].x) + Math.abs(line[i].y - line[i - 1].y), 1, 'no corner-to-corner gap');
    }
    const map = freshMap(); const built = builderOn(map);
    built.manager.setKind('wall'); built.manager.setDrawShape('line');
    // The drag wanders: only where it ends counts, and the run is laid again from its start each move.
    built.manager.beginStroke({ x: 2, y: 2, z: 0 }); built.manager.paintAt({ x: 9, y: 9, z: 0 }); built.manager.paintAt({ x: 6, y: 2, z: 0 }); built.manager.endStroke();
    assert.deepEqual(cells(built.E, map, 'wall'), ['2,2', '3,2', '4,2', '5,2', '6,2']);
    assert.equal(built.manager.undoStack.length, 1, 'one undo step');
});

test('a rectangle outlines a room of walls and fills a floor, unless the panel says otherwise', () => {
    const map = freshMap(); const { manager, E } = builderOn(map);
    manager.setDrawShape('rect');
    manager.setKind('wall'); stroke(manager, { x: 2, y: 2, z: 0 }, { x: 5, y: 4, z: 0 });
    assert.equal(cells(E, map, 'wall').length, 10, 'the edge of a 4 by 3 room');
    manager.setKind('floor'); stroke(manager, { x: 10, y: 10, z: 0 }, { x: 12, y: 11, z: 0 });
    assert.equal(cells(E, map, 'floor').length, 6, 'a floor fills');
    manager.setRectFill('fill'); manager.setKind('wall'); stroke(manager, { x: 14, y: 14, z: 0 }, { x: 15, y: 15, z: 0 });
    assert.equal(cells(E, map, 'wall').length, 14, 'Filled: walls fill too');
    manager.setRectFill('edge'); manager.setKind('floor'); stroke(manager, { x: 1, y: 14, z: 0 }, { x: 3, y: 16, z: 0 });
    assert.equal(cells(E, map, 'floor').length, 6 + 8, 'Outline: a floor lines its edge');
});

test('a floor stands at a quarter level and is raised and lowered by a step; a wall keeps whole levels', () => {
    const map = freshMap(); const { manager, E } = builderOn(map);
    manager.setKind('floor'); manager.setLevel(0.5);
    assert.equal(manager.level, 0.5);
    manager.setDrawShape('brush'); manager.beginStroke({ x: 3, y: 3, z: manager.level }); manager.endStroke();
    const floor = E.pieces(map).find(p => p.kind === 'floor');
    assert.equal(floor.z, 0.5, 'kept at its quarter level');
    manager.selected = floor.id;
    assert.equal(manager.raiseSelection(0.25), true);
    assert.equal(E.pieces(map).find(p => p.kind === 'floor').z, 0.75);
    manager.raiseSelection(-5);
    assert.equal(E.pieces(map).find(p => p.kind === 'floor').z, 0, 'never below the ground');
    // A wall in hand comes down to a whole level.
    manager.setLevel(1.5); manager.setKind('wall');
    assert.equal(manager.level, 1);
    assert.equal(E.normalizePiece({ kind: 'wall', x: 1, y: 1, z: 2.5 }).z, 2);
    assert.equal(R.normalizePiece({ kind: 'block', x: 1, y: 1, z: 2.5 }).z, 2.5, 'the game reads a block at its quarter level');
});

test('a wall, a pane and a pillar take a height of their own: laid, drawn, stood against and hidden by it', () => {
    const map = freshMap(); const { manager, E } = builderOn(map);
    manager.setKind('wall'); manager.setHeight('wall', 2);
    manager.setDrawShape('brush'); manager.beginStroke({ x: 4, y: 4, z: 0 }); manager.endStroke();
    const wall = E.pieces(map).find(p => p.kind === 'wall');
    assert.equal(wall.height, 2);
    assert.equal(R.normalizePiece(wall).height, 2, 'the game keeps it');
    assert.equal(R.normalizePiece({ kind: 'wall', x: 0, y: 0, z: 0, height: 5 }).height, undefined, 'a storey is no height of its own');
    assert.equal(R.normalizePiece({ kind: 'floor', x: 0, y: 0, z: 0, height: 3 }).height, undefined, 'only walls, panes and pillars');
    assert.equal(R.pieceHeight('wall', wall), 2);
    assert.equal(R.pieceHeight('wall'), R.PIECE_STOREY);
    assert.deepEqual(R.pieceShapes('wall', wall)[0].box, [0, 0, 0, 1, 2, 1], 'drawn two tiles tall');
    assert.equal(R.pieceTop(wall, 0.5, 0.5), 2, 'its top is where it stops');
    // A tall wall beside a low one shows its face above the low one: they do not hide each other.
    const tall = R.normalizePiece({ id: 9, kind: 'wall', x: 5, y: 4, z: 0, material: '' });
    const data = { width: 20, height: 20, reactor3d: { version: 1, pieces: [wall, tall] } };
    const faces = R.hiddenFacesOf(R.normalizePiece(tall), data);
    assert.equal(faces.west, false);
    const twin = { width: 20, height: 20, reactor3d: { version: 1, pieces: [wall, Object.assign({}, wall, { id: 10, x: 5 })] } };
    assert.equal(R.hiddenFacesOf(R.normalizePiece(Object.assign({}, wall, { id: 10, x: 5 })), twin).west, true, 'two walls of one height hide the face between them');
    // Placed: the height is changed on the piece.
    manager.selected = wall.id;
    manager.updateSelected({ height: 3.5 });
    assert.equal(E.pieces(map).find(p => p.kind === 'wall').height, 3.5);
});

test('a wall line off the grid is one straight wall from end to end; Stepped keeps the staircase of cells', () => {
    const map = freshMap(); const { manager, E } = builderOn(map);
    manager.setKind('wall'); manager.setDrawShape('line'); manager.setHeight('wall', 4); manager.material = 'Stone';
    manager.setDiagonal('straight');
    stroke(manager, { x: 2, y: 2, z: 0 }, { x: 8, y: 6, z: 0 });
    const boxes = E.pieces(map).filter(p => p.kind === 'box');
    assert.equal(boxes.length, 1, 'one wall, not a staircase');
    assert.equal(E.pieces(map).filter(p => p.kind === 'wall').length, 0);
    const wall = boxes[0];
    assert.equal(wall.angle, Math.round(Math.atan2(4, 6) * 180 / Math.PI));
    assert.equal(wall.size[1], 4, 'as tall as the wall in hand');
    assert.equal(wall.size[2], 1, 'a tile thick');
    assert.ok(Math.abs(wall.size[0] - (Math.hypot(6, 4) + 1)) < 0.01, 'end to end, both end cells in it');
    assert.equal(wall.material, 'Stone');
    // It blocks the cells along its line, as the game walks against it.
    const feet = R.pieceFootprint(R.normalizePiece(wall)).map(c => c.join(','));
    for (const cell of ['2,2', '5,4', '8,6']) assert.ok(feet.includes(cell), 'blocks ' + cell);
    // Along a row it is still wall cells (they join with the rest of a room).
    const row = freshMap(); const b = builderOn(row);
    b.manager.setKind('wall'); b.manager.setDrawShape('line'); b.manager.setDiagonal('straight');
    stroke(b.manager, { x: 1, y: 1, z: 0 }, { x: 5, y: 1, z: 0 });
    assert.equal(b.E.pieces(row).filter(p => p.kind === 'wall').length, 5);
    // Stepped: the cells.
    const steps = freshMap(); const c = builderOn(steps);
    c.manager.setKind('wall'); c.manager.setDrawShape('line'); c.manager.setDiagonal('stepped');
    stroke(c.manager, { x: 2, y: 2, z: 0 }, { x: 8, y: 6, z: 0 });
    assert.equal(c.E.pieces(steps).filter(p => p.kind === 'box').length, 0);
    assert.equal(c.E.pieces(steps).filter(p => p.kind === 'wall').length, 11);
});

test('the Height slider is handled with the panel\'s other sliders, so a drag sets the height instead of moving the piece', () => {
    const source = read('editor/src/BuildHotbar.js');
    // The sliders' shared handler took a Height drag on a placed wall for a move and the panel then showed 5 again.
    assert.match(source, /if \(kind === 'rr-build-height'\) \{ applyHeight\(v, false\); return; \}/);
    assert.ok(source.indexOf("if (kind === 'rr-build-height')") < source.indexOf("else if (!placed) return;"), 'before the placed-only branches');
    assert.match(source, /querySelectorAll\('input\[type=number\]\.rr-build-height'\)/, 'the number box when typed');
});

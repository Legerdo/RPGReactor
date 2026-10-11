'use strict';
// A neighboring map shown past the border and entered without a break (Reactor3D.Neighbors,
// runtime/reactor_3d_surround.js): where it lies, when it is read, how its world stands in the
// scene and is taken over, and how the party arrives (reactor_objects_map.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { followerWorld } = require('./helpers/follower-world.cjs');

const root = path.resolve(__dirname, '..', '..');
const R = require(path.join(root, 'runtime/reactor_3d.js'));
const plain = value => JSON.parse(JSON.stringify(value));

test('where a neighbor lies, and how far a place is from each side', () => {
    const N = R.Neighbors, map = { width: 120, height: 80 };
    assert.deepEqual(N.offsetOf(map, 'north', { map: 2 }, 100, 60), { x: 0, z: -60 });
    assert.deepEqual(N.offsetOf(map, 'south', { map: 2, shift: 5 }, 100, 60), { x: 5, z: 80 });
    assert.deepEqual(N.offsetOf(map, 'west', { map: 2, shift: -3 }, 100, 60), { x: -100, z: -3 });
    assert.deepEqual(N.offsetOf(map, 'east', { map: 2 }, 100, 60), { x: 120, z: 0 });
    assert.deepEqual(['north', 'south', 'west', 'east'].map(side => N.sideDistance(map, 10, 30, side)), [30, 49, 10, 109]);
});

function flatMap(W = 40, H = 30, surround = { style: 'continue' }) {
    return { width: W, height: H, note: '', reactor3d: { terrain: new Array((W + 1) * (H + 1)).fill(2), terrainWidth: W, surround } };
}

test('a side a neighbor\'s world stands on has no land, and no corner turns toward it', () => {
    const map = flatMap();
    const whole = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0 });
    const cut = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, none: { east: true } });
    const east = g => { let n = 0; for (let i = 0; i < g.ground.positions.length; i += 3) if (g.ground.positions[i] > map.width + 0.5) n++; return n; };
    assert.ok(east(whole) > 100);
    assert.equal(east(cut), 0, 'nothing past the east border, the corners included');
    assert.ok(cut.ground.index.length > 0 && cut.ground.index.length < whole.ground.index.length);
    // Every side: nothing at all.
    const none = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, none: { north: true, east: true, south: true, west: true } });
    assert.equal(none.ground.index.length, 0);
});

test('a neighbor shorter than the side leaves this map its land along the rest of it', () => {
    const N = R.Neighbors;
    assert.equal(N.covered(200, 0, 200), true);
    assert.equal(N.covered(120, -40, 200), true, 'a longer neighbor covers it all');
    assert.deepEqual(N.covered(200, 0, 120), { from: 0, to: 120 });
    assert.deepEqual(N.covered(200, 30, 120), { from: 30, to: 150 });
    assert.equal(N.covered(200, 200, 120), null, 'beside none of it');
    const map = flatMap();
    const W = map.width, H = map.height;
    const part = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, none: { east: { from: 0, to: 18 } } });
    const p = part.ground.positions;
    let above = 0, below = 0, north = 0;
    for (let i = 0; i < p.length; i += 3) {
        if (p[i] <= W + 0.5) continue;
        if (p[i + 2] < 0) north++; else if (p[i + 2] < 18 - 1e-6) above++; else if (p[i + 2] <= H) below++;
    }
    assert.equal(above, 0, 'none where the neighbor stands');
    assert.equal(north, 0, 'and no corner turned toward it');
    assert.ok(below > 30, 'land past the rest of the side');
    // It is whole ground out to the rim there, the southeast corner included: triangles, not loose points.
    const inPart = v => p[v * 3] > W + 0.5 && p[v * 3 + 2] >= 18 - 1e-6;
    let faces = 0, far = 0;
    for (let t = 0; t < part.ground.index.length; t += 3) {
        const [a, b, c] = [part.ground.index[t], part.ground.index[t + 1], part.ground.index[t + 2]];
        if (inPart(a) && inPart(b) && inPart(c)) { faces++; far = Math.max(far, p[a * 3] - W, p[b * 3] - W, p[c * 3] - W); }
    }
    assert.ok(faces > 30 && far > part.info.distance * 0.9, faces + ' faces out to ' + far);
    const cut = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, none: { east: true } });
    assert.ok(part.ground.index.length > cut.ground.index.length);
    // A neighbor in the middle of the side: land above it and below it, both corners kept.
    const mid = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, none: { east: { from: 10, to: 20 } } });
    const q = mid.ground.positions;
    let inside = 0, corner = 0;
    for (let i = 0; i < q.length; i += 3) {
        if (q[i] <= W + 0.5) continue;
        if (q[i + 2] > 10 + 1e-6 && q[i + 2] < 20 - 1e-6) inside++;
        if (q[i + 2] < 0) corner++;
    }
    assert.deepEqual([inside, corner > 0], [0, true]);
});

test('two maps side by side have the same hills where their lands meet: the hills are the world\'s', () => {
    const map = flatMap(40, 30, { style: 'continue', rough: 1 });
    const heightAt = (origin, x, z) => {
        const g = R.surroundGeometry(map, R.surroundOf(map), { floorY: 0, origin });
        const p = g.ground.positions;
        for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i] - x) < 1e-6 && Math.abs(p[i + 2] - z) < 1e-6) return p[i + 1];
        return null;
    };
    // The same place of the world, seen from a map 8 tiles further east of it (far rings keep every eighth ray).
    const here = heightAt({ x: 0, z: 0 }, 16, -16), there = heightAt({ x: -8, z: 0 }, 24, -16);
    assert.ok(here !== null && there !== null);
    assert.ok(Math.abs(here - there) < 1e-4, `${here} and ${there}`);
    assert.ok(Math.abs(here - heightAt({ x: 500, z: 0 }, 16, -16)) > 0.05, 'another place of the world, other hills');
});

test('a neighbor\'s world stands in the scene under one group at its place, and comes out as it went in', () => {
    const w = followerWorld({ flat: false, party: [1] });
    const N = w.Reactor3D.Neighbors, T = w.THREE;
    const sceneOf = names => { const s = { _scene: new T.Scene(), _sky: new T.Object3D() }; for (const name of names) { const o = new T.Object3D(); o.name = name; s._scene.add(o); } s._scene.add(s._sky); return s; };
    const main = sceneOf(['floor']), body = sceneOf(['below', 'pieces']);
    // (A scene that was a map's own: the viewport held its place in the world still.)
    body._scene.matrixWorldAutoUpdate = false;
    const record = N.attach(main, 'east', body, 9, { x: 120, z: 0 });
    assert.equal(record.mapId, 9);
    assert.equal(record.group.parent, main._scene);
    assert.equal(body._scene.parent, record.group, 'the scene itself, so what it lays later stands there too');
    assert.deepEqual([record.group.position.x, record.group.position.z], [120, 0]);
    assert.equal(body._sky.visible, false, 'one sky: the map\'s own');
    // Laid after it was stood there (plants as the eye nears, models as they load): in its place.
    const late = new T.Object3D(); late.position.set(3, 0, 4); body._scene.add(late);
    main._scene.updateMatrixWorld(true);
    assert.deepEqual([late.matrixWorld.elements[12], late.matrixWorld.elements[14]], [123, 4]);
    assert.equal(N.detach(main, 'east'), record);
    assert.equal(body._scene.parent, null);
    assert.deepEqual(Array.from(body._scene.children, o => o.name), ['below', 'pieces', '', '']);
    assert.equal(record.group.parent, null);
    assert.equal(main._neighborBodies.east, undefined);
});

test('the party\'s models go with it into the map entered; everybody else stays', () => {
    const w = followerWorld({ flat: false, party: [1] });
    const N = w.Reactor3D.Neighbors, T = w.THREE;
    const group = new T.Group();
    const holder = () => ({ object: new T.Object3D() });
    const from = { _modelInstances: new Map([['p', holder()], ['f0', holder()], ['f1', holder()], ['e12', holder()], ['e10003', holder()]]) };
    const to = { _modelInstances: new Map([['e10003', holder()]]), modelsGroup: () => group };
    const leader = from._modelInstances.get('p');
    // The leader rides event 12, which is event 31 on the map entered.
    const bike = from._modelInstances.get('e12');
    N.carryParty(from, to, 'e12', 'e31');
    assert.deepEqual(Array.from(from._modelInstances.keys()), ['e10003']);
    assert.deepEqual(Array.from(to._modelInstances.keys()).sort(), ['e10003', 'e31', 'f0', 'f1', 'p']);
    assert.equal(to._modelInstances.get('e31'), bike, 'what it rides, as it is');
    assert.equal(to._modelInstances.get('p'), leader, 'the same model, as it is');
    assert.equal(leader.object.parent, group);
});

function crossingWorld() {
    const w = followerWorld({ width: 12, height: 10, start: [5, 0], party: [1, 2, 3],
        prepare(map, c) {
            map.reactor3d = Object.assign(map.reactor3d || {}, { surround: { style: 'none', neighbors: { north: { map: 2, shift: 2 } } } });
            c.$dataMapInfos = [null, { id: 1, name: 'Here' }, { id: 2, name: 'North' }];
        } });
    const N = w.Reactor3D.Neighbors;
    // The map past the north border stands built, 20 by 16, and is read.
    N.records.clear();
    N.records.set(2, { mapId: 2, state: 'ready', text: ['{}', null], map: { width: 20, height: 16 }, copy: { id: 'the copy' }, used: 1 });
    N.live = { scene: { _scene: {}, _neighborBodies: { north: { mapId: 2, stage: 0, offset: { x: 2, z: -16 } } } } };
    N.crossing = null;
    return w;
}

test('a border whose neighbor stands built is walked over with no fade; one that is not ready fades as any transfer does', () => {
    const w = crossingWorld(), N = w.Reactor3D.Neighbors, p = w.$gamePlayer;
    w.hold(8); w.run(1); w.hold(0);
    assert.equal(p.isTransferring(), true);
    assert.equal(p.fadeType(), 2);
    assert.deepEqual(plain(N.crossing), { from: 1, to: 2, side: 'north', offset: { x: 2, z: -16 } });
    assert.equal(N.take(2).id, 'the copy', 'the game is handed the map read as the player came near');
    assert.equal(N.take(3), null);
    // An event's transfer reserved on top of it is a transfer like any other.
    p.reserveTransfer(1, 3, 3, 2, 0);
    assert.equal(N.crossing, null);
    assert.equal(N.take(2), null, 'only a crossing is handed a map this way');

    const late = crossingWorld(), Nl = late.Reactor3D.Neighbors;
    Nl.live.scene._neighborBodies = {};
    late.hold(8); late.run(1); late.hold(0);
    assert.equal(late.$gamePlayer.isTransferring(), true);
    assert.equal(late.$gamePlayer.fadeType(), 0);
    assert.equal(Nl.crossing, null);
    Nl.enabled = false;
});

test('the party arrives where it was, in the entered map\'s tiles: the leader walks on from the border, nobody is gathered', () => {
    const w = crossingWorld(), N = w.Reactor3D.Neighbors, p = w.$gamePlayer;
    // The followers stand behind the leader, as they walked.
    const followers = p.followers()._data;
    followers[0].setPosition(5, 1); followers[1].setPosition(5, 2);
    w.hold(8); w.run(1); w.hold(0);
    const W = 20, H = 16, tiles = new Array(W * H * 6).fill(0);
    for (let i = 0; i < W * H; i++) tiles[i] = 1536;
    w.$dataMap = Object.assign(plain(w.$dataMap), { width: W, height: H, data: tiles, reactor3d: undefined });
    p.performTransfer();
    assert.equal(w.$gameMap.mapId(), 2);
    assert.deepEqual([p.x, p.y], [3, 15], 'the tile straight over the border (this map\'s x 5 is the neighbor\'s 3)');
    assert.deepEqual([p._realX, p._realY], [3, 16], 'drawn where it stood, so the step over the border is one walk');
    assert.deepEqual(plain(followers.map(f => [f.x, f.y])), [[3, 17], [3, 18], [3, 16]], 'the followers are where they were (the last on the leader\'s old tile), not gathered onto the leader');
    assert.equal(p.isTransferring(), false);
    // It walks in: one step later it stands on the border tile.
    w.run(40, () => !p.isMoving());
    assert.deepEqual([p._realX, p._realY], [3, 15]);
});

/**
 * What the editor's 3D view gives back. A map scene going away takes its
 * shadow casters out of Reactor3D.Shadows (the lists held every rebuilt
 * scene's models), so models are swept on a map change; and while a playtest
 * has had the GPU for a while the view gives its scene and models back and
 * builds them again when the editor is in front.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const editorRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(editorRoot, '..');
const mapSource = fs.readFileSync(path.join(editorRoot, 'src', 'MapEditor3D.js'), 'utf8');
const Reactor3D = require(path.join(repoRoot, 'runtime', 'reactor_3d.js'));

function mapEditorClass(context = {}) {
    return vm.runInNewContext(`${mapSource}\nMapEditor3D;`, {
        console, window: {}, performance: { now: () => 0 },
        document: { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
        require, setTimeout, clearTimeout, ...context
    });
}

test('forgetScene drops the casters under a scene, from both lists, and keeps the rest', () => {
    const shadows = Reactor3D.Shadows;
    const scene = { name: 'old', parent: null };
    const group = { parent: scene };
    const other = { name: 'next', parent: null };
    const prop = { parent: group }, walker = { parent: { parent: group } }, kept = { parent: other };
    try {
        shadows._static.add(prop);
        shadows._dynamic.add(walker);
        shadows._static.add(kept);
        const generation = shadows._generation;
        assert.equal(shadows.forgetScene(scene), 2);
        assert.ok(!shadows._static.has(prop) && !shadows._dynamic.has(walker), 'the old scene\'s casters are gone');
        assert.ok(shadows._static.has(kept), 'another scene\'s caster stays');
        assert.ok(shadows._generation > generation, 'the static rows are judged again');
        assert.equal(shadows.forgetScene(null), 0);
        assert.equal(shadows.forgetScene(scene), 0, 'nothing left to drop');
    } finally {
        shadows._static.clear();
        shadows._dynamic.clear();
    }
});

test('a map scene forgets its casters before clear() detaches its groups', () => {
    const order = [];
    const savedForget = Reactor3D.Shadows.forgetScene;
    Reactor3D.Shadows.forgetScene = scene => { order.push(['forget', scene]); return 0; };
    try {
        const fake = { _scene: { id: 1 }, clear() { order.push(['clear']); } };
        Reactor3D.MapScene.prototype.destroy.call(fake);
        assert.deepEqual(order.map(entry => entry[0]), ['forget', 'clear']);
        assert.equal(order[0][1].id, 1);
    } finally {
        Reactor3D.Shadows.forgetScene = savedForget;
    }
});

test('the editor view forgets its scene\'s casters first thing in clearScene, and sweeps models on a map change', () => {
    const body = mapSource.slice(mapSource.indexOf('    clearScene() {'));
    const forget = body.indexOf('Reactor3D.Shadows?.forgetScene?.(this.mapScene.scene())');
    assert.ok(forget > 0 && forget < body.indexOf('this.eventGroup.parent?.remove'), 'before the groups are taken out');
    assert.equal(mapEditorClass().SWEEP_MODELS_ON_MAP_CHANGE, true);
});

function parkableView(MapEditor3D, calls) {
    const view = Object.create(MapEditor3D.prototype);
    view.enabled = true;
    view.renderer = { info: { memory: {} }, getContext: () => null, resetState() { calls.push('resetState'); }, setRenderTarget() {}, clear() { calls.push('clear'); } };
    view.projectController = { app: { render() { calls.push('render2d'); } } };
    view._rebuildGeneration = 1;
    view.clearScene = () => calls.push('clearScene');
    view.releaseGraphics = () => { calls.push('releaseGraphics'); return {}; };
    view.unbindGraphics = () => calls.push('unbind');
    view.rebuild = () => { calls.push('rebuild'); return Promise.resolve(true); };
    return view;
}

test('a playtest with the GPU for PARK_AFTER_MS parks the view once; the editor in front builds it again', () => {
    const MapEditor3D = mapEditorClass();
    assert.equal(MapEditor3D.PARK_AFTER_MS, 5000);
    const calls = [];
    const view = parkableView(MapEditor3D, calls);
    view.parkForPlaytest(1000);
    view.parkForPlaytest(5999);
    assert.equal(view._parked, undefined, 'not before the delay');
    view.parkForPlaytest(6000);
    assert.equal(view._parked, true);
    assert.deepEqual(calls.slice(0, 4), ['clearScene', 'releaseGraphics', 'unbind', 'render2d']);
    assert.ok(calls.includes('clear'), 'the parked view shows its clear color');
    assert.equal(view._rebuildGeneration, 2, 'a rebuild in flight is dropped');
    const count = calls.length;
    view.parkForPlaytest(9000);
    assert.equal(calls.length, count, 'parked once');
    view.unpark();
    assert.equal(view._parked, false);
    assert.equal(calls[calls.length - 1], 'rebuild');
    assert.equal(view._playtestSince, null, 'the next playtest waits the full delay again');
});

test('PARK_AFTER_MS 0 keeps the view whole; a disabled view has nothing to park', () => {
    const MapEditor3D = mapEditorClass();
    const calls = [];
    const view = parkableView(MapEditor3D, calls);
    MapEditor3D.PARK_AFTER_MS = 0;
    view.parkForPlaytest(0);
    view.parkForPlaytest(60000);
    assert.equal(view._parked, undefined);
    MapEditor3D.PARK_AFTER_MS = 5000;
    view.enabled = false;
    assert.equal(view.park(), false);
    assert.deepEqual(calls, []);
});

test('the render loop parks under a playtest and unparks when the editor is back', () => {
    const loop = mapSource.slice(mapSource.indexOf('    startLoop() {'), mapSource.indexOf('    stopLoop() {'));
    assert.match(loop, /const playtest = MapEditor3D\.playtestRunning\(\);\s*if \(playtest\) this\.parkForPlaytest\(now\);\s*else this\._playtestSince = null;/);
    assert.match(loop, /if \(this\.suspended \|\| MapEditor3D\.coveredByDatabase\(\) \|\| playtest\) \{ this\._covered = true;/);
    assert.ok(loop.indexOf('if (this._parked) this.unpark();') > loop.indexOf('|| playtest)'), 'unparked only once uncovered');
});

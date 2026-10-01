'use strict';
// New things show once their shaders compiled on the driver's threads and
// their pictures uploaded under a budget; the frame never waits for them.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..', '..');
require(path.join(root, 'runtime', 'libs', 'three.js'));
const THREE = global.THREE;
const Reactor3D = require(path.join(root, 'runtime', 'reactor_3d.js'));
const W = Reactor3D.ShaderWarmup;

function fakeRenderer() {
    const props = new Map(), compiles = [], waiting = [];
    return {
        extensions: { has: name => name === 'KHR_parallel_shader_compile' },
        properties: { get: t => props.get(t) || (props.set(t, {}), props.get(t)) },
        compileAsync(mesh) {
            compiles.push(mesh);
            for (const m of [].concat(mesh.material)) this.properties.get(m).currentProgram = {};
            return new Promise(res => waiting.push(res));
        },
        initTexture(t) { const p = this.properties.get(t); p.__webglInit = true; p.__version = t.version; this.uploads = (this.uploads || 0) + 1; },
        draw(mesh) { for (const m of [].concat(mesh.material)) this.properties.get(m).__version = m.version; },
        finishCompiles() { while (waiting.length) waiting.shift()(); }, compiles
    };
}
const tick = () => new Promise(res => setTimeout(res, 0));

test('a mesh whose material was never compiled sits out the draw until its program is ready; the frame never waits', async () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    const r = fakeRenderer();
    const hidden = W.hide(r, scene, {});
    assert.deepEqual(hidden, [mesh]); assert.equal(mesh.visible, false, 'out of this draw');
    W.show(hidden); assert.equal(mesh.visible, true, 'and back for everything else');
    W.show(W.hide(r, scene, {}) || []);
    assert.equal(r.compiles.length, 1, 'compiled once, with the pass bound');
    r.finishCompiles(); await tick();
    assert.equal(W.hide(r, scene, {}), null, 'ready: drawn');
});

test('a material drawn before is never held, even after its version changes (a material that changes every frame stays)', () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    const r = fakeRenderer();
    r.properties.get(mesh.material).currentProgram = {}; r.draw(mesh);
    assert.equal(W.hide(r, scene, {}), null);
    mesh.material.needsUpdate = true;
    assert.equal(W.hide(r, scene, {}), null, 'a recompile is drawn the old way');
    assert.equal(r.compiles.length, 0);
});

test('pictures upload under a per-frame budget before the mesh shows; one always goes', async () => {
    W._queue.length = 0;
    const scene = new THREE.Scene();
    const textures = [0, 1, 2].map(() => { const t = new THREE.Texture({ width: 4000, height: 4000 }); t.needsUpdate = true; return t; });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: textures[0], alphaMap: textures[1], aoMap: textures[2] }));
    scene.add(mesh);
    const r = fakeRenderer();
    W.show(W.hide(r, scene, {}) || []);
    r.finishCompiles(); await tick();
    let frames = 0;
    while (frames < 10) { const h = W.hide(r, scene, {}); if (!h) break; W.show(h); frames++; }
    assert.equal(r.uploads, 3);
    assert.ok(frames >= 2, 'spread over frames (' + frames + ')');
});

test('without parallel compile nothing is held; a compile never answered is drawn after the timeout', () => {
    const scene = new THREE.Scene(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    assert.equal(W.hide({ extensions: { has: () => false } }, scene, {}), null);
    const r = fakeRenderer();
    W.show(W.hide(r, scene, {}) || []);
    W._materials.get(mesh.material).started -= W.TIMEOUT_MS + 1;
    assert.equal(W.hide(r, scene, {}), null, 'drawn anyway');
    W.enabled = false;
    try { const other = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(other); assert.equal(W.hide(r, scene, {}), null, 'the kill switch'); }
    finally { W.enabled = true; }
});

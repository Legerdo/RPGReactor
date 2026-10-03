'use strict';
// The floor on shaped ground: laid from the sides on slopes so its image does not stretch into
// streaks, and turned to a cliff material on steep ground. The room carries the choice
// (`cliff`, `cliffSlope`, `cliffTint`), stored only when it differs from Rock at 40 degrees.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..', '..');
require(path.join(root, 'runtime', 'libs', 'three.js'));
const THREE = global.THREE;
const Reactor3D = require(path.join(root, 'runtime', 'reactor_3d.js'));
require(path.join(root, 'runtime', 'reactor_3d_lighting.js'));
require(path.join(root, 'editor', 'src', 'utils', 'MapElevation.js'));
const Elevation = globalThis.RRMapElevation;

const room = values => Reactor3D.roomFor({ reactor3d: { room: Object.assign({ floor: '!Grass' }, values) } });

test('the game reads the cliff: Rock at 40 degrees unless the room says otherwise', () => {
    assert.deepEqual([room({}).cliff, room({}).cliffSlope, room({}).cliffTint], ['Rock', 40, '']);
    assert.equal(room({ cliff: '' }).cliff, '', 'none');
    assert.equal(room({ cliff: ' Moss ' }).cliff, 'Moss');
    assert.deepEqual([room({ cliffSlope: 5 }).cliffSlope, room({ cliffSlope: 99 }).cliffSlope, room({ cliffSlope: '33' }).cliffSlope, room({ cliffSlope: 'x' }).cliffSlope], [10, 80, 33, 40]);
    assert.deepEqual([room({ cliffTint: '#A99F93' }).cliffTint, room({ cliffTint: 'brown' }).cliffTint], ['#a99f93', '']);
});

test('the editor keeps the cliff in the room only when it differs from the default', () => {
    const map = { id: 7, width: 3, height: 2, note: '' };
    assert.equal(Elevation.setRoom(map, { height: 4, cliff: 'Rock', cliffSlope: '40', cliffTint: '#ffffff' }), false, 'all defaults: nothing written');
    assert.equal(map.reactor3d, undefined);
    assert.equal(Elevation.setRoom(map, { height: 4, floor: '!Grass', cliff: '', cliffSlope: 55, cliffTint: '#A99F93' }), true);
    assert.deepEqual({ ...map.reactor3d.room }, { height: 4, floor: '!Grass', walls: '', ceiling: '', sky: '', skyScrollX: 0, skyScrollY: 0, cliff: '', cliffSlope: 55, cliffTint: '#a99f93' });
    assert.deepEqual(Elevation.roomCliff(Elevation.room(map)), { name: '', slope: 55, tint: '#a99f93' });
    assert.deepEqual(Elevation.roomCliff(Elevation.room({})), { name: 'Rock', slope: 40, tint: '' });
    // What the editor writes, the game reads the same.
    const read = Reactor3D.roomFor(map);
    assert.deepEqual([read.cliff, read.cliffSlope, read.cliffTint], ['', 55, '#a99f93']);
    assert.equal(Elevation.setRoom(map, { height: 4 }), true, 'back to the defaults');
    assert.equal('room' in map.reactor3d, false);
});

test('the floor material samples by facing and blends to the cliff, keeping the lit injections', () => {
    const material = Reactor3D.litMaterial(new THREE.MeshBasicMaterial({ map: new THREE.Texture() }));
    const cliff = new THREE.Texture();
    Reactor3D.groundSlopeMaterial(material, 50, 50, cliff, 40, '#a99f93');
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
    material.onBeforeCompile(shader, {});
    assert.ok(!shader.fragmentShader.includes('#include <map_fragment>'), 'the plain lookup is replaced');
    assert.match(shader.fragmentShader, /textureGrad\(map, vRRGroundPos\.zy/, 'laid from the side with explicit gradients');
    assert.match(shader.fragmentShader, /textureGrad\(rrCliffMap/);
    assert.match(shader.fragmentShader, /rrBlend/, 'the lit material\'s own injections stay');
    assert.match(shader.vertexShader, /vRRGroundN = normalize\(mat3\(modelMatrix\) \* normal\)/);
    assert.equal(shader.uniforms.rrCliffOn.value, 0, 'no cliff until its image arrives');
    cliff.image = { width: 4, height: 4 };
    assert.equal(shader.uniforms.rrCliffOn.value, 1, 'and on by itself once it has');
    assert.deepEqual(shader.uniforms.rrCliffTint.value.toArray().map(v => Math.round(v * 255)), [0xa9, 0x9f, 0x93]);
    const band = shader.uniforms.rrCliffBand.value;
    assert.ok(Math.abs(band.x - (1 - Math.cos(40 * Math.PI / 180))) < 1e-9 && band.y > band.x);
    assert.match(material.customProgramCacheKey(), /\|groundslope$/);
});

test('only the floor of a shaped map takes it, and the game asks the disk before loading a cliff', () => {
    const source = fs.readFileSync(path.join(root, 'runtime', 'reactor_3d.js'), 'utf8');
    assert.match(source, /if \(piece === "floor" && this\._terrainMap && Reactor3D\.GROUND_SLOPE\)/);
    assert.match(source, /Reactor3D\.materialFileExists\(name\) \? Reactor3D\.defaultMaterialLoader\(name\) : null/);
    assert.equal(Reactor3D.materialFileExists('Rock'), false, 'unknown outside a game: no cliff rather than a load error');
});

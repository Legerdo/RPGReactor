'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const cameras = require(path.join(repoRoot, 'runtime', 'reactor_3d.js')).Camera;

test('the map scene gives the mouse back when it stops, without calling the menu', () => {
    const canvas = {};
    let exits = 0;
    let stopped = 0;
    function Scene_Map() {}
    Scene_Map.prototype.stop = function() { stopped++; };
    const saved = { Scene_Map: globalThis.Scene_Map, Graphics: globalThis.Graphics, document: globalThis.document, SceneManager: globalThis.SceneManager };
    globalThis.Scene_Map = Scene_Map;
    globalThis.Graphics = { _canvas: canvas };
    globalThis.document = { pointerLockElement: canvas, exitPointerLock() { exits++; this.pointerLockElement = null; } };
    try {
        cameras.installHooks();
        cameras.held.add('forward');
        cameras.look.suppressMenuUntil = 0;
        new Scene_Map().stop();
        assert.equal(stopped, 1, 'the scene still stops');
        assert.equal(exits, 1, 'the pointer lock is released');
        assert.equal(cameras.held.size, 0, 'held look keys are let go');
        assert.ok(cameras.look.suppressMenuUntil > Date.now(), 'the release does not read as Escape');

        new Scene_Map().stop();
        assert.equal(exits, 1, 'nothing to release when the mouse is free');

        // A transfer stops this map for the next one: the look keeps the mouse.
        globalThis.document.pointerLockElement = canvas;
        globalThis.SceneManager = { _nextScene: new Scene_Map() };
        new Scene_Map().stop();
        assert.equal(exits, 1, 'kept through a transfer');
        globalThis.SceneManager = { _nextScene: {} };
        new Scene_Map().stop();
        assert.equal(exits, 2, 'released for a menu or a battle');
    } finally {
        Object.assign(globalThis, saved);
    }
});

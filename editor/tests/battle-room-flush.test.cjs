'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const read = p => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');

test('the battle room is drawn once for the frame shown, not once per update, and without MSAA', () => {
    const core = read('runtime/reactor_core.js'), presentation = read('runtime/reactor_battle_presentation.js'), room = read('runtime/reactor_battle_room.js');
    // The game loop runs its before-render hooks once, just before the frame is drawn.
    assert.match(core, /Graphics\._reactorBeforeRender = Graphics\._reactorBeforeRender \|\| new Set\(\);/);
    assert.match(core, /for \(const hook of this\._reactorBeforeRender\) \{\n\s+try \{ hook\(\); \} catch \(e\) \{[^\n]+\}\n\s+\}\n\s+this\._app\.render\(\);/);
    // An update marks the room; the hook renders and copies it; with no game loop it draws at once.
    assert.match(presentation, /ss\._reactorRoomDirty=true;if\(!\(typeof Graphics!=='undefined'&&Graphics\._reactorBeforeRender\)\)P\.flushRoom\(ss\);/);
    assert.match(presentation, /P\.flushRoom=function\(ss\)\{\n\s+const room=ss\._reactorRoom;if\(!room\|\|room\.disposed\|\|!ss\._reactorRoomDirty\|\|!ss\._reactorRoomSprite\)return;ss\._reactorRoomDirty=false;\n\s+room\.render\(\);/);
    assert.match(presentation, /Graphics\._reactorBeforeRender\.add\(\(\)=>\{const ss=[^\n]+if\(ss&&ss\._reactorRoom\)P\.flushRoom\(ss\);\}\);/);
    assert.doesNotMatch(presentation.slice(presentation.indexOf('P.updateRoom=function'), presentation.indexOf('P.flushRoom=function')), /room\.render\(\)/, 'no render in the update itself');
    assert.match(room, /new T\.WebGLRenderer\(\{ antialias: false, alpha: false, preserveDrawingBuffer: true \}\)/);
});

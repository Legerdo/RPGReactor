'use strict';
// The event editor popped out into a window of its own (another monitor) runs the same code
// as in the editor window. PopoutBridge makes the main document reach into the pop-out while it
// is attached: lookups, input listeners added before or after, the focused element, and dialogs
// appended while the pop-out has the focus. Detached, the main document is itself again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'PopoutBridge.js'), 'utf8');

function fakeTarget() {
    const listeners = [];
    return {
        listeners,
        addEventListener(type, listener) { listeners.push([type, listener]); },
        removeEventListener(type, listener) {
            const at = listeners.findIndex(([t, l]) => t === type && l === listener);
            if (at >= 0) listeners.splice(at, 1);
        },
        fire(type, event = {}) { for (const [t, l] of listeners.slice()) if (t === type) l(event); }
    };
}

function fakeDocument(name, ids) {
    const doc = fakeTarget();
    const body = { children: [], appendChild(node) { this.children.push(node); return node; }, append(...nodes) { this.children.push(...nodes); } };
    Object.assign(doc, {
        name, body, focused: false, activeElement: null,
        documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {} },
        head: { appendChild() {} },
        hasFocus() { return this.focused; }
    });
    return { doc, ids };
}

function bridgeWorld() {
    const main = fakeDocument('main', { mainOnly: { id: 'mainOnly' } });
    const child = fakeDocument('child', { 'event-editor-modal': { id: 'event-editor-modal' } });
    class Document {}
    Object.defineProperty(Document.prototype, 'activeElement', { configurable: true, get() { return this._active || null; } });
    Object.setPrototypeOf(main.doc, Document.prototype);
    delete main.doc.activeElement;
    main.doc._active = { id: 'map-canvas' };
    Document.prototype.getElementById = function(id) { return main.ids[id] || null; };
    Document.prototype.querySelector = function(selector) { return selector === '.in-main' ? { where: 'main' } : null; };
    Document.prototype.querySelectorAll = function(selector) { return selector === '.overlay' ? [{ where: 'main' }] : []; };
    child.doc.getElementById = id => child.ids[id] || null;
    child.doc.querySelector = selector => (selector === '.in-child' ? { where: 'child' } : null);
    child.doc.querySelectorAll = selector => (selector === '.overlay' ? [{ where: 'child' }] : []);
    child.doc.activeElement = { id: 'event-name-field' };
    const window = fakeTarget();
    const context = { window, document: main.doc, Document, console };
    window.window = window;
    vm.createContext(context);
    vm.runInContext(source, context);
    const childWindow = fakeTarget();
    childWindow.document = child.doc;
    return { bridge: window.RRPopoutBridge, main: main.doc, child: child.doc, window, childWindow };
}

test('input listeners added before and after the pop-out opens hear it, and only while attached', () => {
    const { bridge, main, child, window, childWindow } = bridgeWorld();
    const heard = [];
    main.addEventListener('keydown', event => heard.push(['doc', event.key]));
    main.addEventListener('scroll', () => heard.push(['scroll']));
    window.addEventListener('pointerdown', () => heard.push(['win']));
    bridge.attach(childWindow);
    main.addEventListener('keyup', event => heard.push(['late', event.key]));
    child.fire('keydown', { key: 'Delete' });
    child.fire('keyup', { key: 'a' });
    child.fire('scroll');
    childWindow.fire('pointerdown');
    assert.deepEqual(heard, [['doc', 'Delete'], ['late', 'a'], ['win']], 'input events only; scroll is not one');
    bridge.detach();
    child.fire('keydown', { key: 'x' });
    assert.equal(heard.length, 3, 'detached: nothing reaches across');
});

test('lookups, the focused element and new dialogs reach the pop-out while it is attached', () => {
    const { bridge, main, child, childWindow } = bridgeWorld();
    bridge.attach(childWindow);
    assert.equal(main.getElementById('event-editor-modal').id, 'event-editor-modal', 'found in the pop-out');
    assert.equal(main.getElementById('mainOnly').id, 'mainOnly', 'the main document first');
    assert.equal(main.querySelector('.in-child').where, 'child');
    assert.deepEqual(Array.from(main.querySelectorAll('.overlay'), e => e.where), ['main', 'child'], 'both, main first');

    assert.equal(main.activeElement.id, 'map-canvas', 'the main window has the focus');
    main.body.appendChild({ dialog: 1 });
    assert.equal(main.body.children.length, 1, 'a dialog opened from the map stays in the main window');
    child.focused = true;
    assert.equal(main.activeElement.id, 'event-name-field', 'the pop-out has the focus');
    main.body.appendChild({ dialog: 2 });
    assert.equal(child.body.children.length, 1, 'a dialog opened from the pop-out goes there');

    bridge.detach();
    assert.equal(main.getElementById('event-editor-modal'), null, 'detached: the main document alone');
    assert.equal(main.activeElement.id, 'map-canvas');
    main.body.appendChild({ dialog: 3 });
    assert.equal(main.body.children.length, 2);
});

test('the editor offers the pop-out, ships its page, and comes back wired after its window is destroyed', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const index = read('index.html');
    const firstScript = index.match(/<script[^>]*>/)[0];
    assert.match(firstScript, /src\/utils\/PopoutBridge\.js/, 'the bridge is the first script, before any listener');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'event-editor-panel.html')));
    assert.match(read('build-scripts/dist-editor-worker.js'), /'event-editor-panel\.html'/, 'a released editor carries the page');
    const window = read('src/event/EventEditorWindow.js');
    assert.doesNotMatch(window, /rr-event-editor-popout-btn|Back to the editor window/, 'no button to pop out or back: its own window is the way it opens');
    assert.match(window, /frame: false/, 'no title bar but its own header');
    assert.match(read('css/styles.css'), /rr-event-editor-popped > \.rr-modal > \.rr-modal-header \{[^}]*-webkit-app-region: drag;/, 'the header drags it');
    assert.match(window, /win\.on\('close', \(\) => \{[\s\S]{0,160}closeFromFrame\(state\)/, 'closed another way than its × (Alt+F4), it closes the editor');
    assert.match(window, /win\.on\('closed', \(\) => \{\s*if \(popped === state && !state\.closing\) dock\(\{ windowGone: true \}\)/);
    assert.match(read('src/EventManager.js'), /rr-event-editor-docked[\s\S]{0,120}windowGone\) this\.setupEventEditorModal\(\)/);
    assert.match(read('src/event/EventEditor.js'), /rr-event-editor-docked[\s\S]{0,120}windowGone && this\.isOpen\(\)\) redraw\(\)/);
});

test('the editor\'s own window has themed dropdowns, rounded corners and the title strip', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const shim = read('src/utils/SelectThemingShim.js');
    assert.match(shim, /RRPopoutBridge\.onAttach\(childWindow => watch\(childWindow\.document\)\)/, 'selects added there by a redraw are themed');
    assert.match(shim, /const view = \(triggerEl\.ownerDocument && triggerEl\.ownerDocument\.defaultView\) \|\| window;/, 'a list is placed by the window it opens in');
    assert.match(shim, /\(triggerEl\.ownerDocument \|\| document\)\.body\.appendChild\(popup\)/);
    assert.match(read('src/event/EventEditorWindow.js'), /frame: false, transparent: true/, 'transparent around the rounded panel');
    const css = read('css/styles.css');
    assert.match(css, /rr-event-editor-popped > \.rr-modal \{[^}]*border-radius: var\(--radius-lg\);/);
    assert.match(css, /#event-editor-modal > \.rr-modal > \.rr-modal-header \{\s*border-left: 3px solid var\(--color-accent\);/);
});

test('an attach hook runs for each pop-out and its cleanup on detach', () => {
    const { bridge, childWindow } = bridgeWorld();
    const seen = [];
    bridge.onAttach(win => { seen.push('attach'); return () => seen.push('detach'); });
    bridge.attach(childWindow);
    bridge.detach();
    bridge.attach(childWindow);
    assert.deepEqual(seen, ['attach', 'detach', 'attach']);
});


test('a library\'s own listeners hear only their window; the editor\'s own hear the pop-out too', () => {
    const { bridge, main, child, childWindow } = bridgeWorld();
    const heard = [];
    main.addEventListener('pointermove', () => heard.push('editor'));
    // PIXI's event system, injected as script text: its frames read "<anonymous>".
    new Function('doc', 'heard', 'doc.addEventListener("pointermove", () => heard.push("pixi"));')(main, heard);
    bridge.attach(childWindow);
    child.fire('pointermove');
    assert.deepEqual(heard, ['editor'], 'the map does not follow the mouse in the editor\'s window');
    main.fire('pointermove');
    assert.deepEqual(heard, ['editor', 'editor', 'pixi'], 'in its own window it does');
});

test('the edited event stays outlined in either mode, and the preview keeps its proportions', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const manager = read('src/EventManager.js');
    assert.match(manager, /updateEditingHighlight\(\) \{[\s\S]{0,800}editor\.isOpen\(\) \? editor\.sourceEvent : null/, 'drawn for the open editor\'s event, not the selection');
    assert.match(manager, /updateEditingHighlight\(\) \{[\s\S]{0,300}map3d\.syncEditingEvent\?\.\(\)/, 'and lit in the 3D view');
    const view = read('src/MapEditor3D.js');
    assert.match(view, /on = on \|\| \(this\._editingEventId != null && mesh\.userData\.event\?\.id === this\._editingEventId\);/, 'its box lit as a selected one\'s');
    assert.ok((view.match(/this\.syncEditingEvent\(\);/g) || []).length >= 3, 'lit again after a diff rebuild and a full build');
    assert.doesNotMatch(manager.slice(manager.indexOf('updateEditingHighlight() {'), manager.indexOf('updateEditingHighlight() {') + 900), /eventMode/, 'whatever the mode');
    assert.match(read('src/event/EventEditor.js'), /this\.mapManager\?\.updateEditingHighlight\?\.\(\);/, 'gone when the window closes');
    const page = read('src/event/EventPageEditor.js');
    assert.match(page, /class="character-preview-canvas"[\s\S]{0,300}object-fit: contain;/);
    assert.match(page, /_redrawOnResize\(canvas, \(\) => \{/);
});

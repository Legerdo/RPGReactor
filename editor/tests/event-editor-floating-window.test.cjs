'use strict';
// The event editor floats over a live map (owner, 2026-10-16, from a GitHub request): no backdrop,
// dragged by its title bar, sized from its corner, kept reachable on screen; opening another
// event or changing maps asks about edits not yet applied; a move or delete on the map reaches
// the open event; map keys work after a click on the map and stay with the window inside it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const editorRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(editorRoot, relative), 'utf8');
const quiet = { log() {}, debug() {}, warn() {}, error() {}, info() {} };
const Window = require('../src/event/EventEditorWindow.js');

test('the window stays wholly on screen, at least its minimum size, so OK and Apply stay in reach', () => {
    const view = { width: 1600, height: 900 };
    assert.deepEqual(Window.clamp({ left: 100, top: 50, width: 1000, height: 700 }, view), { left: 100, top: 50, width: 1000, height: 700 });
    assert.deepEqual(Window.clamp({ left: 1590, top: 2000, width: 1000, height: 700 }, view), { left: 600, top: 200, width: 1000, height: 700 },
        'dragged off the right and bottom: back against those edges');
    assert.deepEqual(Window.clamp({ left: -5000, top: -40, width: 300, height: 100 }, view), { left: 0, top: 0, width: 860, height: 480 },
        'off the left and top, and too small: minimum size, in the corner');
    assert.deepEqual(Window.clamp({ left: 0, top: 0, width: 4000, height: 4000 }, view), { left: 0, top: 0, width: 1600, height: 900 }, 'never larger than the screen');
    assert.deepEqual(Window.defaultRect({ width: 1600, height: 1000 }), { left: 100, top: 15, width: 1400, height: 970 }, "today's dialog size, centered");
});

function fakeDocument() {
    const elements = new Map();
    const overlay = {
        id: 'event-editor-modal', style: { display: 'flex' },
        contains: node => node && node.inside === true,
        querySelector: () => null
    };
    elements.set('event-editor-modal', overlay);
    for (const id of ['event-position-x', 'event-position-y', 'event-position-z', 'event-size-w', 'event-size-h']) elements.set(id, { value: '' });
    return { elements, overlay, getElementById: id => elements.get(id) || null, querySelector: () => null, querySelectorAll: () => [] };
}

function editorWith(document, decision) {
    const prompts = [];
    const window = { reactor: { uiManager: { promptUnsavedChanges: async (subject, options) => { prompts.push([subject, options && options.saveLabel]); return decision; } } }, I18n: { t: key => key === 'common.apply' ? 'Apply' : key } };
    const EventEditor = vm.runInNewContext(`${read('src/event/EventEditor.js')}\nEventEditor;`, { console: quiet, document, window });
    const map = { width: 20, height: 15, events: [] };
    const event = { id: 3, name: 'Guard', x: 4, y: 5, pages: [{ list: [] }] };
    const editor = Object.create(EventEditor.prototype);
    Object.assign(editor, {
        projectController: { getTilemapManager: () => ({ currentMap: map }) },
        sourceEvent: event, currentEvent: JSON.parse(JSON.stringify(event)), cancelBaseline: JSON.parse(JSON.stringify(event)),
        needsInitialCommit: false, pendingModels: [], pendingModelsBaseline: [], pendingZ: 0, pendingZBaseline: 0,
        pendingSize: [1, 1], pendingSizeBaseline: '1x1', currentPageIndex: 0
    });
    editor._eventZ = () => 0;
    editor._sizeState = () => '1x1';
    editor.committed = [];
    editor.applyChanges = function() { this.committed.push(this._clone(this.currentEvent)); this.cancelBaseline = this._clone(this.currentEvent); return true; };
    document.elements.get('event-position-x').value = '4';
    document.elements.get('event-position-y').value = '5';
    document.elements.get('event-position-z').value = '0';
    return { editor, event, prompts };
}

test('an edit not yet applied is seen as Apply sees it', () => {
    const document = fakeDocument();
    const { editor } = editorWith(document, 'cancel');
    assert.equal(editor.hasUncommittedChanges(), false, 'nothing changed');
    editor.currentEvent.name = 'Captain';
    assert.equal(editor.hasUncommittedChanges(), true, 'a field');
    editor.currentEvent.name = 'Guard';
    document.elements.get('event-position-x').value = '7';
    assert.equal(editor.hasUncommittedChanges(), true, 'a position typed in its field');
    document.elements.get('event-position-x').value = '4';
    editor.needsInitialCommit = true;
    assert.equal(editor.hasUncommittedChanges(), true, 'a new event not yet placed');
    document.overlay.style.display = 'none';
    assert.equal(editor.hasUncommittedChanges(), false, 'a closed window holds nothing');
});

test('leaving an event with unapplied edits asks Apply, Discard or Cancel, by the event\'s name', async () => {
    for (const [decision, leaves, applied] of [['save', true, 1], ['discard', true, 0], ['cancel', false, 0]]) {
        const document = fakeDocument();
        const { editor, prompts } = editorWith(document, decision);
        editor.currentEvent.name = 'Captain';
        editor.cancelChanges = function() { this.discarded = true; this.currentEvent = this._clone(this.cancelBaseline); document.overlay.style.display = 'none'; };
        assert.equal(await editor.resolvePendingChanges(), leaves, decision);
        assert.deepEqual(prompts, [['Captain', 'Apply']]);
        assert.equal(editor.committed.length, applied, `${decision}: applied ${applied}`);
        assert.equal(!!editor.discarded, decision === 'discard');
    }
});

test('a map change closes the window, asking only when there is something to keep', async () => {
    const document = fakeDocument();
    const { editor, prompts } = editorWith(document, 'cancel');
    editor.cancelChanges = function() { document.overlay.style.display = 'none'; };
    assert.equal(await editor.closeForMapChange(), true, 'nothing unapplied: closes without asking');
    assert.equal(prompts.length, 0);
    assert.equal(document.overlay.style.display, 'none');

    document.overlay.style.display = 'flex';
    editor.currentEvent.name = 'Captain';
    assert.equal(await editor.closeForMapChange(), false, 'Cancel keeps the map and the window');
    assert.equal(document.overlay.style.display, 'flex');
    assert.equal(await editor.closeForMapChange({ ask: false }), true, 'a load that skips the checks closes it');
});

test('the open event dragged on the map shows its new place in the window', () => {
    const document = fakeDocument();
    const { editor, event } = editorWith(document, 'cancel');
    event.x = 9; event.y = 2;
    editor.followMapMove(event);
    assert.deepEqual([editor.currentEvent.x, editor.currentEvent.y], [9, 2]);
    assert.deepEqual([editor.cancelBaseline.x, editor.cancelBaseline.y], [9, 2], 'the move is the map\'s, not an edit to apply');
    assert.equal(document.elements.get('event-position-x').value, '9');
    assert.equal(editor.hasUncommittedChanges(), false);
    editor.followMapMove({ id: 8, x: 1, y: 1 });
    assert.equal(editor.currentEvent.x, 9, 'another event moving changes nothing');
});

test('the map and the event manager defer to the window only where it is open and in use', () => {
    const manager = read('src/EventManager.js');
    assert.match(manager, /this\.eventEditor\.hasUncommittedChanges\(\)\) \{\s*this\.eventEditor\.resolvePendingChanges\(\)/, 'opening another event asks first');
    assert.match(manager, /this\.eventEditor\.sourceEvent === event\) \{\s*this\.eventEditor\.cancelChanges\(\);/, 'deleting the open event closes the window');
    assert.match(manager, /followMapMove\?\.\(this\.draggedEvent\)/, 'a drag reaches the window');
    assert.match(read('src/ProjectController.js'), /closeForMapChange\(\{ ask: !options\.skipDirtyCheck \}\)/);
    const ui = read('src/UIManager.js');
    assert.equal((ui.match(/this\.eventEditorHasKeys\(\)/g) || []).length, 4, 'copy, cut, paste and delete follow the key owner');
    assert.doesNotMatch(ui, /ctxModal|pasteModal|delModal/);
    assert.match(read('index.html'), /src\/event\/EventEditorWindow\.js[\s\S]*src\/event\/EventEditor\.js/);
});

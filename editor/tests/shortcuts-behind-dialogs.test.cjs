/**
 * A dialog on screen keeps the map's shortcuts from acting behind it: Delete
 * with File › Import Project up deleted the selected event, and Ctrl+Z with
 * the event editor open swapped the map's events for copies, so the editor's
 * OK landed on a detached event. Escape lets go of the map selection again
 * (the always-present, hidden event editor overlay blocked it for good).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const editorRoot = path.resolve(__dirname, '..');

function setup({ overlays = [], eventEditorShown = false } = {}) {
    const source = fs.readFileSync(path.join(editorRoot, 'src', 'UIManager.js'), 'utf8');
    let keydown = null;
    const element = (id, shown) => ({ id, style: { display: shown ? 'flex' : 'none' }, getClientRects: () => (shown ? [{}] : []) });
    const editor = element('event-editor-modal', eventEditorShown);
    const all = [editor, ...overlays.map(id => element(id, true))];
    const document = {
        activeElement: { tagName: 'BUTTON' },
        getElementById: id => all.find(el => el.id === id) || null,
        querySelector: () => null,
        querySelectorAll: () => all,
        addEventListener() {}, removeEventListener() {}
    };
    const context = { console, document, window: { addEventListener(type, handler) { if (type === 'keydown') keydown = handler; } } };
    const UIManager = vm.runInNewContext(`${source}\nUIManager;`, context);
    const calls = [];
    const eventManager = {
        eventMode: true, selectedEvent: { id: 1 },
        canUndo: () => true, canRedo: () => true,
        undo: () => calls.push('undo'), redo: () => calls.push('redo'),
        deleteEvent: () => calls.push('delete')
    };
    const mapEditor = { canUndo: () => true, canRedo: () => true, undo: () => calls.push('map undo'), redo: () => calls.push('map redo') };
    const manager = new UIManager({ getEventManager: () => eventManager, getMapEditor: () => mapEditor, getBuildHistory: () => null });
    manager.setupKeyboardShortcuts();
    const press = (key, ctrlKey = false) => keydown({ key, ctrlKey, metaKey: false, altKey: false, shiftKey: false, target: document.activeElement, preventDefault() {}, stopPropagation() {} });
    return { manager, press, calls, eventManager };
}

test('no dialog up: Delete and Ctrl+Z reach the map', () => {
    const { manager, press, calls } = setup();
    assert.equal(manager.isEditorModalOpenForGlobalShortcuts(), false, 'the hidden event editor overlay does not count');
    press('Delete'); press('z', true);
    assert.deepEqual(calls, ['delete', 'undo']);
});

test('the Import Project dialog up: nothing happens behind it', () => {
    const { manager, press, calls } = setup({ overlays: ['rr-legacy-import-dialog'] });
    assert.equal(manager.isEditorModalOpenForGlobalShortcuts(), true);
    press('Delete'); press('z', true); press('y', true);
    assert.deepEqual(calls, []);
});

test('the event editor open: Ctrl+Z and Ctrl+Y leave the map\'s events alone', () => {
    const { press, calls } = setup({ eventEditorShown: true });
    press('z', true); press('y', true);
    assert.deepEqual(calls, []);
});

test('Escape to deselect counts only an overlay on screen', () => {
    const main = fs.readFileSync(path.join(editorRoot, 'src', 'main.js'), 'utf8');
    assert.match(main, /Array\.from\(document\.querySelectorAll\('\.modal-overlay, \.rr-modal-overlay, #database-modal'\)\)\s*\.some\(el => el\.getClientRects\(\)\.length > 0\)\) return;/);
    assert.doesNotMatch(main, /if \(document\.querySelector\('\.modal-overlay, \.rr-modal-overlay, #database-modal'\)\) return;/);
});

test('event mode with nothing to undo there leaves the tiles alone', () => {
    const { press, calls, eventManager } = setup();
    eventManager.canUndo = () => false; eventManager.canRedo = () => false;
    press('z', true); press('y', true);
    assert.deepEqual(calls, [], 'the map editor\'s stroke is not undone from event mode');
    eventManager.eventMode = false;
    press('z', true);
    assert.deepEqual(calls, ['map undo']);
});

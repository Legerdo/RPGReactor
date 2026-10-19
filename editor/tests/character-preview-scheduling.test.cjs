'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/forge/Character3D/Character3DBuilder.js'), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function builder(extra = {}) {
    const scope = { window: { innerWidth: 1000, innerHeight: 800 }, console, setTimeout, clearTimeout,
        CSS: { escape: s => s }, ...extra };
    vm.runInNewContext(source, scope);
    const b = Object.create(scope.window.Character3DBuilder.prototype);
    Object.assign(b, { recipe: {}, cache: {}, _thumbs: new Map(), _thumbQueue: [], _thumbEpoch: 0,
        _lastChange: 0, _view: {}, _result: {}, pack: {}, _project: () => ({ path: '/project' }) });
    return b;
}
function tile(key, top = 20) {
    return { dataset: { thumb: key }, innerHTML: '', getBoundingClientRect: () => ({ left: 20, right: 100, top, bottom: top + 80, width: 80, height: 80 }) };
}
function mount(b, tiles) {
    const panel = { getBoundingClientRect: () => ({ top: 0, bottom: 200, left: 0, right: 200 }), querySelectorAll: () => tiles };
    b.root = { isConnected: true, querySelector: () => panel,
        querySelectorAll: selector => selector.includes('="') ? tiles.filter(t => selector.includes('="' + t.dataset.thumb + '"')) : tiles };
    return panel;
}
test('the scheduler excludes clipped tiles and does no hidden background work', async () => {
    const b = builder(), visible = tile('species:human'), hidden = tile('species:minotaur', 220);
    mount(b, [visible, hidden]);
    const built = [];
    b._storedThumb = async () => null;
    b._makeThumb = async item => { built.push(item.key); return 'data:image/webp;base64,AAA'; };
    b._storeThumb = () => {};
    b._wantThumb('species', 'minotaur'); b._wantThumb('species', 'human');
    await pause(65);
    assert.deepEqual(built, ['species:human']);
    assert.match(visible.innerHTML, /<img/);
    assert.equal(hidden.innerHTML, '');
    assert.equal(b._thumbTimer, 0, 'offscreen work does not keep polling');
    b._stopThumbs();
});
test('visible builds run serially and a cached picture bypasses geometry generation', async () => {
    const b = builder(), a = tile('dress:a'), cached = tile('dress:b'), c = tile('dress:c');
    mount(b, [a, cached, c]);
    let finish, active = 0, max = 0;
    const built = [];
    b._storedThumb = async key => key === 'dress:b' ? 'data:image/webp;base64,CACHE' : null;
    b._makeThumb = item => { built.push(item.key); active++; max = Math.max(max, active); return new Promise(resolve => { finish = () => { active--; resolve('data:image/webp;base64,NEW'); }; }); };
    b._storeThumb = () => {};
    for (const id of ['a', 'b', 'c']) b._wantThumb('dress', id);
    await pause(35);
    assert.deepEqual(built, ['dress:a']);
    finish(); await pause(55);
    assert.deepEqual(built, ['dress:a', 'dress:c']);
    assert.match(cached.innerHTML, /CACHE/);
    assert.equal(max, 1);
    finish(); await pause(25); b._stopThumbs();
});
test('scrolling away cancels obsolete work while reusing one worker and ignores its late result', async () => {
    const b = builder(), old = tile('species:human');
    const tiles = [old]; mount(b, tiles);
    const pending = new Map(); let disposed = 0, canceled = 0;
    const pool = b._previewWorker = { dispose() { disposed++; }, cancelAll() { canceled++; } };
    b._storedThumb = async () => null;
    b._storeThumb = () => {};
    b._makeThumb = item => new Promise(resolve => pending.set(item.key, resolve));
    b._wantThumb('species', 'human'); await pause(30);
    const current = tile('dress:knight'); tiles.splice(0, tiles.length, current);
    b._refreshThumbs(); await pause(30);
    assert.equal(disposed, 0, 'switching choices does not churn native worker allocations');
    assert.equal(canceled, 1);
    assert.equal(b._previewWorker, pool);
    assert.equal(b._thumbJob.key, 'dress:knight');
    pending.get('species:human')('data:image/webp;base64,OLD'); await pause(5);
    assert.equal(current.innerHTML, '');
    pending.get('dress:knight')('data:image/webp;base64,CURRENT'); await pause(25);
    assert.match(current.innerHTML, /CURRENT/);
    assert.equal(b._thumbs.has('species:human'), false);
    b._stopThumbs();
    assert.equal(disposed, 1, 'teardown still releases the worker');
});
test('teardown cancels worker/cache work before a view exists', () => {
    const b = builder(); let disposed = 0;
    b._view = null; b._closeOutfitImport = () => {};
    b._previewWorker = { dispose() { disposed++; } };
    b._thumbJob = { key: 'dress:a' };
    b._thumbQueue = [{ key: 'dress:b' }];
    b.detach();
    assert.equal(disposed, 1);
    assert.equal(b._thumbJob, null);
    assert.equal(b._thumbQueue.length, 0);
});
test('preview signatures track head, eyes and body hair but exclude an outfit not shown in a garment picture', () => {
    const b = builder();
    b.recipe = { head: { kind: 'rabbit' }, eyes: { color: '#ffffff' }, bodyHair: { density: 0 }, outfit: [{ id: 'robe' }] };
    const initial = b._thumbSig('garment');
    b.recipe = { ...b.recipe, outfit: [{ id: 'jeans' }] };
    assert.equal(b._thumbSig('garment'), initial);
    for (const patch of [{ head: { kind: 'cat' } }, { eyes: { color: '#000000' } }, { bodyHair: { density: 1 } }]) {
        b.recipe = { ...b.recipe, ...patch };
        assert.notEqual(b._thumbSig('garment'), initial);
    }
});
test('thumbnail build requests use the worker and never call the main-thread character generator', async () => {
    const b = builder({ RRCharacterModel: { build() { assert.fail('main-thread build'); } } });
    mount(b, []);
    const result = { parts: [], textures: {}, height: 1 }, requests = [];
    const pool = { build: async request => { requests.push(request); return result; } };
    b._previewWorker = pool; b._previewPool = () => pool;
    b._configurePreview = async () => {};
    b._thumbRecipe = () => ({ recipe: { species: 'human' }, frame: 'body' });
    const made = await b._thumbParts({ key: 'species:human', sig: 'shape', kind: 'species' });
    assert.equal(made.result, result);
    assert.equal(requests[0].key, 'species:human|shape');
});

test('Node worker render arrays become zero-copy page-realm views for WebGL', () => {
    const b = builder();
    for (const name of ['Float32Array', 'Uint32Array', 'Uint16Array', 'Uint8Array']) {
        const remote = vm.runInNewContext('new ' + name + '([1,2,3])');
        const local = b._previewArray(remote);
        assert.equal(local.constructor.name, name);
        assert.equal(local.buffer, remote.buffer, 'no geometry copy on the page');
        assert.deepEqual(Array.from(local), [1,2,3]);
        assert.equal(b._previewArray(local), local, 'already local views are reused');
    }
});

test('a changed recipe discards a late direct/import thumbnail before GPU work', async () => {
    const b = builder({ requestAnimationFrame: callback => setTimeout(callback, 0) });
    mount(b, []); let finish;
    b._thumbParts = () => new Promise(resolve => { finish = resolve; });
    b._renderThumb = () => assert.fail('a stale direct preview reached the GPU');
    const pending = b._makeThumb({ key: 'dress:imported', kind: 'dress', sig: b._thumbSig('dress') });
    b.recipe = { gender: 1 };
    finish({ result: { parts: [] }, frame: 'body' });
    await assert.rejects(pending, { name: 'AbortError' });
});

test('hidden windows suspend visible-tile work and remove the visibility listener on teardown', async () => {
    const b = builder(), shown = tile('species:human'); mount(b, [shown]);
    const listeners = new Set();
    b.root.ownerDocument = { hidden: true, defaultView: { innerWidth: 1000, innerHeight: 800 },
        addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
    let built = 0, disposed = 0;
    b._previewWorker = { dispose() { disposed++; } };
    b._storedThumb = async () => null; b._storeThumb = () => {};
    b._makeThumb = async () => { built++; return 'data:image/webp;base64,READY'; };
    b._wantThumb('species', 'human'); b._refreshThumbs();
    await pause(30);
    assert.equal(built, 0);
    assert.equal(b._thumbTimer, 0);
    assert.equal(listeners.size, 1);
    assert.equal(disposed, 1, 'a hidden window releases even an idle worker and its model caches');
    assert.equal(b._previewWorker, null);
    b.root.ownerDocument.hidden = false;
    for (const fn of listeners) fn();
    await pause(35);
    assert.equal(built, 1);
    b._stopThumbs(); assert.equal(listeners.size, 0);
});

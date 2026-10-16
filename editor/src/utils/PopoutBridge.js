/**
 * PopoutBridge - lets editor UI built for the main window live in a second OS window (another
 * monitor) unchanged. The event editor and its command dialogs find their fields through the
 * main `document`, open dialogs on `document.body`, and hear keys through listeners on
 * `document` and `window`. While a pop-out is attached:
 *
 *   - getElementById / querySelector / querySelectorAll on the main document also search it;
 *   - document and window listeners for input events also hear it (recorded from load, so the
 *     ones added before the pop-out opened are there too);
 *   - document.activeElement is its focused element while it has the focus;
 *   - an element appended to the main body while it has the focus (a dialog, a picker, a menu)
 *     goes to its body instead, so a dialog opens where the person is working.
 *
 * Load this before any other script that adds listeners.
 *
 *   RRPopoutBridge.attach(childWindow)   start bridging to that window
 *   RRPopoutBridge.detach()              stop; the main window is itself again
 *   RRPopoutBridge.inPopout(task)        run task with the pop-out taken as the window in use
 *   RRPopoutBridge.active()              the attached window, or null
 */
(function(root) {
    'use strict';
    if (typeof document === 'undefined' || root.RRPopoutBridge) return;

    const INPUT_EVENTS = new Set(['keydown', 'keyup', 'keypress', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
        'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel', 'focusin', 'focusout',
        'input', 'change', 'copy', 'cut', 'paste', 'dragover', 'drop']);
    const recorded = { document: [], window: [] };
    // Work other modules do for each pop-out (the select shim themes its dropdowns): run on attach,
    // their returned cleanups on detach.
    const attachHooks = [];
    let cleanups = [];
    let child = null;

    function record(kind, target) {
        const add = target.addEventListener, remove = target.removeEventListener;
        target.addEventListener = function(type, listener, options) {
            // A library's own listeners (PIXI's pointer tracking for the map, three's controls) hear
            // only the window they were made for: relayed, the editor window's moves and clicks
            // moved the map's tile cursor and clicked the map.
            if (INPUT_EVENTS.has(type) && listener && !fromLibrary()) {
                recorded[kind].push({ type, listener, options });
                if (child) mirrorTarget(kind).addEventListener(type, listener, options);
            }
            return add.call(this, type, listener, options);
        };
        target.removeEventListener = function(type, listener, options) {
            if (INPUT_EVENTS.has(type)) {
                const list = recorded[kind];
                const at = list.findIndex(entry => entry.type === type && entry.listener === listener && capture(entry.options) === capture(options));
                if (at >= 0) list.splice(at, 1);
                if (child) mirrorTarget(kind).removeEventListener(type, listener, options);
            }
            return remove.call(this, type, listener, options);
        };
    }
    const capture = options => !!(typeof options === 'boolean' ? options : options && options.capture);
    // The registering code is a bundled library when the frame that called addEventListener is one:
    // a file under node_modules or libs, or code injected as script text (the editor loads PIXI so,
    // and its frames read "<anonymous>"). The editor's own scripts all load from files.
    const LIBRARY = /[\\/](node_modules|libs)[\\/]|<anonymous>:\d/;
    function fromLibrary() {
        const stack = String(new Error().stack || '').split('\n');
        // [0] "Error", [1] this function, [2] the addEventListener wrapper, [3] its caller.
        return LIBRARY.test(stack[3] || '');
    }
    const mirrorTarget = kind => (kind === 'document' ? child.document : child);
    record('document', document);
    record('window', root);

    const native = {
        getElementById: document.getElementById,
        querySelector: document.querySelector,
        querySelectorAll: document.querySelectorAll
    };
    const nativeActive = Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement');

    // While set, the pop-out counts as the window being worked in, whatever has the focus: a
    // question its own frame raises (its close button) opens there.
    let preferChild = 0;

    function childHasFocus() {
        if (child && preferChild > 0) return true;
        try { return !!child && child.document.hasFocus(); } catch (error) { return false; }
    }

    /** Run `task` (sync or async) with the pop-out taken as the window being worked in. */
    async function inPopout(task) {
        preferChild++;
        try { return await task(); } finally { preferChild--; }
    }

    function patchDocument() {
        const childDoc = child.document;
        document.getElementById = function(id) {
            return native.getElementById.call(document, id) || childDoc.getElementById(id);
        };
        document.querySelector = function(selector) {
            return native.querySelector.call(document, selector) || childDoc.querySelector(selector);
        };
        document.querySelectorAll = function(selector) {
            return Array.from(native.querySelectorAll.call(document, selector)).concat(Array.from(childDoc.querySelectorAll(selector)));
        };
        Object.defineProperty(document, 'activeElement', {
            configurable: true,
            get() { return childHasFocus() ? childDoc.activeElement : nativeActive.get.call(document); }
        });
        const body = document.body;
        for (const method of ['appendChild', 'append']) {
            const original = body[method];
            body['__rrPopout_' + method] = { original, own: Object.prototype.hasOwnProperty.call(body, method) };
            body[method] = function(...nodes) {
                if (childHasFocus()) return childDoc.body[method](...nodes);
                return original.apply(body, nodes);
            };
        }
    }

    function unpatchDocument() {
        delete document.getElementById;
        delete document.querySelector;
        delete document.querySelectorAll;
        delete document.activeElement;
        const body = document.body;
        for (const method of ['appendChild', 'append']) {
            const saved = body['__rrPopout_' + method];
            if (!saved) continue;
            if (saved.own) body[method] = saved.original; else delete body[method];
            delete body['__rrPopout_' + method];
        }
    }

    function attach(childWindow) {
        if (child) detach();
        child = childWindow;
        for (const kind of ['document', 'window']) {
            for (const { type, listener, options } of recorded[kind]) mirrorTarget(kind).addEventListener(type, listener, options);
        }
        patchDocument();
        for (const hook of attachHooks) {
            try {
                const cleanup = hook(childWindow);
                if (typeof cleanup === 'function') cleanups.push(cleanup);
            } catch (error) { console.warn('PopoutBridge: an attach hook failed', error); }
        }
    }

    /** Run `hook(childWindow)` for each pop-out as it attaches (and now, for one already attached); a function it returns runs on detach. */
    function onAttach(hook) {
        attachHooks.push(hook);
        if (child) {
            const cleanup = hook(child);
            if (typeof cleanup === 'function') cleanups.push(cleanup);
        }
    }

    function detach() {
        if (!child) return;
        for (const cleanup of cleanups) { try { cleanup(); } catch (error) { /* the window is gone */ } }
        cleanups = [];
        try {
            for (const kind of ['document', 'window']) {
                for (const { type, listener, options } of recorded[kind]) mirrorTarget(kind).removeEventListener(type, listener, options);
            }
        } catch (error) { /* the window is already gone */ }
        unpatchDocument();
        child = null;
    }

    /** The main window's stylesheets, theme and language in a new window's document. */
    function dressLike(childDoc) {
        for (const link of native.querySelectorAll.call(document, 'link[rel="stylesheet"], style')) {
            childDoc.head.appendChild(link.cloneNode(true));
        }
        for (const name of ['data-theme', 'lang', 'dir']) {
            const value = document.documentElement.getAttribute(name);
            if (value) childDoc.documentElement.setAttribute(name, value);
        }
        // The theme follows the main window while the pop-out is open.
        if (typeof MutationObserver === 'function') {
            new MutationObserver(() => {
                const theme = document.documentElement.getAttribute('data-theme');
                if (theme) childDoc.documentElement.setAttribute('data-theme', theme);
                else childDoc.documentElement.removeAttribute('data-theme');
            }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        }
    }

    root.RRPopoutBridge = { attach, detach, dressLike, inPopout, onAttach, active: () => child, recordedCount: () => recorded.document.length + recorded.window.length };
})(typeof window !== 'undefined' ? window : globalThis);

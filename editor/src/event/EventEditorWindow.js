/**
 * The event editor as a window over the map rather than a dialog in front of it: no backdrop,
 * the map stays live behind it, the title bar drags it, the corner resizes it, and where it was
 * left is remembered for this viewer. Keys go where the person last worked: inside the window,
 * the editor's; on the map, the map's.
 *
 *   RREventEditorWindow.install(overlay)   once, on the #event-editor-modal overlay
 *   RREventEditorWindow.place(overlay)     each time it opens: the remembered place, or centered
 *   RREventEditorWindow.isOpen()           the window is showing
 *   RREventEditorWindow.ownsKeys()         open, and the last click or focus landed inside it
 *   RREventEditorWindow.clamp(rect, view)  a rectangle kept wholly on screen
 *   RREventEditorWindow.popOut()           move it into a window of its own (another monitor)
 *   RREventEditorWindow.dock()             bring it back into the editor window
 *   RREventEditorWindow.isPoppedOut()      it lives in its own window now
 *
 * Popped out, the window's own title bar and frame move and size it; its close button closes
 * the editor (Cancel, asking about unapplied edits) and the window waits hidden for the next
 * event, on that screen. The title-bar button brings the editor back into the editor window.
 */
(function(root) {
    'use strict';

    const STORAGE_KEY = 'rr-event-editor-window';
    const POPOUT_KEY = 'rr-event-editor-popout';
    let popped = null;
    let sizeObserver = null;
    let globalsInstalled = false;
    const MIN_WIDTH = 860;
    const MIN_HEIGHT = 480;

    // The last place the person worked: a click, or focus arriving by keyboard (Tab). A click on the
    // map canvas moves no focus, so the focus alone would keep claiming keys for the window.
    let lastWorkedTarget = null;

    function overlayElement() {
        return typeof document !== 'undefined' ? document.getElementById('event-editor-modal') : null;
    }

    function panelOf(overlay) {
        return overlay && overlay.querySelector('.rr-modal');
    }

    /**
     * A rectangle kept wholly on screen, so its OK and Apply stay in reach; it is made smaller
     * from its corner to uncover more of the map.
     */
    function clamp(rect, view) {
        const width = Math.min(view.width, Math.max(MIN_WIDTH, Math.round(rect.width)));
        const height = Math.min(view.height, Math.max(MIN_HEIGHT, Math.round(rect.height)));
        const left = Math.max(0, Math.min(Math.round(rect.left), view.width - width));
        const top = Math.max(0, Math.min(Math.round(rect.top), view.height - height));
        return { left, top, width, height };
    }

    /** Today's dialog size, centered: what the window is before it has been moved. */
    function defaultRect(view) {
        const width = Math.min(1400, Math.round(view.width * 0.95));
        const height = Math.min(1000, Math.round(view.height * 0.97));
        return { left: Math.round((view.width - width) / 2), top: Math.round((view.height - height) / 2), width, height };
    }

    function viewport() {
        return { width: root.innerWidth || 1280, height: root.innerHeight || 720 };
    }

    function remembered() {
        try {
            const value = JSON.parse(root.localStorage.getItem(STORAGE_KEY) || 'null');
            return value && ['left', 'top', 'width', 'height'].every(key => Number.isFinite(value[key])) ? value : null;
        } catch (error) {
            return null;
        }
    }

    function remember(rect) {
        try { root.localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch (error) { /* a convenience only */ }
    }

    function apply(panel, rect) {
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.width = rect.width + 'px';
        panel.style.height = rect.height + 'px';
    }

    function current(panel) {
        const box = panel.getBoundingClientRect();
        return { left: box.left, top: box.top, width: box.width, height: box.height };
    }

    function place(overlay = overlayElement()) {
        const panel = panelOf(overlay);
        if (!panel || popped) return;
        const view = viewport();
        apply(panel, clamp(remembered() || defaultRect(view), view));
    }

    function startDrag(overlay, event) {
        const panel = panelOf(overlay);
        if (!panel || event.button !== 0 || event.target.closest('button, input, select, textarea, a')) return;
        event.preventDefault();
        const start = current(panel);
        const originX = event.clientX, originY = event.clientY;
        const move = moveEvent => {
            apply(panel, clamp({ ...start, left: start.left + moveEvent.clientX - originX, top: start.top + moveEvent.clientY - originY }, viewport()));
        };
        const end = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            remember(current(panel));
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
    }

    function rememberedPopout() {
        try {
            const value = JSON.parse(root.localStorage.getItem(POPOUT_KEY) || 'null');
            return value && value.on ? value : null;
        } catch (error) {
            return null;
        }
    }

    function rememberPopout(value) {
        try { root.localStorage.setItem(POPOUT_KEY, JSON.stringify(value)); } catch (error) { /* a convenience only */ }
    }

    function canPopOut() {
        return typeof nw !== 'undefined' && !!(nw.Window && nw.Window.open) && !!root.RRPopoutBridge;
    }

    function isPoppedOut() {
        return !!popped;
    }

    function popButtonOf(overlay) {
        return overlay && overlay.querySelector('.rr-event-editor-popout-btn');
    }

    /** Move the editor into a window of its own, where the person's screens allow. */
    function popOut(overlay = overlayElement()) {
        const panel = panelOf(overlay);
        if (popped || !panel || !canPopOut()) return false;
        const title = (panel.querySelector('.rr-modal-title') || {}).textContent || 'Event Editor';
        const saved = rememberedPopout();
        const size = saved || current(panel);
        const options = { width: Math.round(size.width), height: Math.round(size.height), frame: true, show: true, resizable: true, icon: 'images/icon.png', title };
        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { options.x = saved.x; options.y = saved.y; }
        const state = { win: null, panelStyle: panel.style.cssText, closing: false, overlay };
        if (sizeObserver) sizeObserver.disconnect();
        popped = state;
        // Not shown here while its window opens: it appears there, not first in the middle of the map.
        overlay.style.visibility = 'hidden';
        nw.Window.open('event-editor-panel.html', options, win => {
            if (!win) { popped = null; overlay.style.visibility = ''; return; }
            state.win = win;
            const mount = () => {
                if (popped !== state) return;
                const doc = win.window.document;
                root.RRPopoutBridge.dressLike(doc);
                doc.title = title;
                doc.body.style.cssText = 'margin:0;height:100vh;overflow:hidden;background:var(--color-bg-base);';
                root.RRPopoutBridge.attach(win.window);
                overlay.classList.add('rr-event-editor-popped');
                panel.style.cssText = '';
                doc.body.appendChild(overlay);
                overlay.style.visibility = '';
                labelPopButton(overlay);
                rememberPopout({ on: true, x: win.x, y: win.y, width: win.width, height: win.height });
                // The window manager settles a new window's size after it shows.
                setTimeout(() => { try { if (popped === state) win.resizeTo(options.width, options.height); } catch (error) { /* kept as shown */ } }, 300);
            };
            const ready = () => win.window && win.window.document && win.window.document.readyState === 'complete';
            if (ready()) mount(); else win.on('loaded', mount);
            const keepPlace = () => { if (popped === state) rememberPopout({ on: true, x: win.x, y: win.y, width: win.width, height: win.height }); };
            win.on('move', keepPlace);
            win.on('resize', keepPlace);
            // Its frame's close button closes the editor, as Cancel does (asking first about
            // unapplied edits); the window only hides, to show again on that screen for the next event.
            // 'closed' covers a window destroyed without asking (a crash, the session ending).
            win.on('close', () => {
                if (popped === state && !state.closing) {
                    keepPlace();
                    closeFromFrame(state);
                } else {
                    try { win.close(true); } catch (error) { /* gone */ }
                }
            });
            win.on('closed', () => {
                if (popped === state && !state.closing) dock({ keepPoppedOut: false, windowGone: true });
            });
        });
        return true;
    }

    /**
     * Bring the editor back into the editor window. `keepPoppedOut`: it opens popped out again
     * next time (the editor closed by OK or Cancel), rather than here (its window was closed).
     */
    function dock({ keepPoppedOut = true, windowGone = false } = {}) {
        const state = popped;
        if (!state) return;
        // Held from the pop-out: a window closed under it can no longer be searched.
        const overlay = state.overlay;
        popped = null;
        state.closing = true;
        if (root.RRPopoutBridge) root.RRPopoutBridge.detach();
        if (overlay) {
            overlay.classList.remove('rr-event-editor-popped');
            const panel = panelOf(overlay);
            if (panel) panel.style.cssText = state.panelStyle;
            document.body.appendChild(overlay);
            labelPopButton(overlay);
            if (isOpen() && panel) apply(panel, clamp(current(panel), viewport()));
            // Watched again once the move has settled, not in the middle of its layout.
            if (sizeObserver && panel) (root.requestAnimationFrame || setTimeout)(() => sizeObserver.observe(panel));
        }
        if (!keepPoppedOut) {
            const saved = rememberedPopout() || {};
            rememberPopout({ ...saved, on: false });
        }
        try { if (state.win) state.win.close(true); } catch (error) { /* already closed */ }
        // Back from a window destroyed under it (closed without asking), the editor's elements have
        // lost their handlers: its frame is wired again here, and the editor and its manager wire
        // theirs (rr-event-editor-docked). The editor draws itself over its edits, as for a language change.
        if (windowGone && overlay) {
            const stale = popButtonOf(overlay);
            if (stale) stale.remove();
            overlay.__rrFloating = false;
            install(overlay);
        }
        if (typeof root.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            root.dispatchEvent(new CustomEvent('rr-event-editor-docked', { detail: { windowGone } }));
        }
    }

    async function closeFromFrame(state) {
        const editor = root.reactor && root.reactor.eventManager && root.reactor.eventManager.eventEditor;
        if (editor && editor.isOpen && editor.isOpen()) {
            // Asked in the pop-out, whose close button raised it.
            const resolve = () => editor.resolvePendingChanges({ closing: true });
            const leave = root.RRPopoutBridge ? await root.RRPopoutBridge.inPopout(resolve) : await resolve();
            if (!leave) return;
            if (editor.isOpen()) editor.cancelChanges();
        }
        hidePopout(state);
    }

    /** The editor closed while popped out: its window hides and keeps its place for the next event. */
    function hidePopout(state = popped) {
        if (!state || state !== popped || !state.win) return;
        try { state.win.hide(); } catch (error) { /* gone */ }
    }

    /** An event opens while the editor lives in its window: that window comes back where it was. */
    function showPopout() {
        if (!popped || !popped.win) return;
        try { popped.win.show(); popped.win.focus(); } catch (error) { /* gone */ }
    }

    /** The title-bar button: out to a window of its own, or, popped out, back into the editor window. */
    function labelPopButton(overlay) {
        const button = popButtonOf(overlay);
        if (!button) return;
        const label = popped ? 'Back to the editor window' : 'Open in a separate window';
        button.title = root.I18n && root.I18n.tText ? root.I18n.tText(label) : label;
        button.hidden = !canPopOut();
    }

    /** The pop-out's NW window while there is one (tests close it the way its frame does). */
    function popoutWindow() {
        return popped ? popped.win : null;
    }

    /** Whether the editor should reopen in its own window: it was left popped out. */
    function wantsPopOut() {
        return canPopOut() && !!rememberedPopout();
    }

    function install(overlay = overlayElement()) {
        const panel = panelOf(overlay);
        if (!overlay || !panel || overlay.__rrFloating) return;
        overlay.__rrFloating = true;
        overlay.classList.add('rr-event-editor-floating');
        const header = panel.querySelector('.rr-modal-header');
        if (header) header.addEventListener('pointerdown', event => { if (!popped) startDrag(overlay, event); });
        // A window of its own, for another monitor: beside the close button, as the Media Surface panel has it.
        const close = header && header.querySelector('.rr-modal-close');
        if (close && !popButtonOf(overlay)) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'rr-modal-close rr-event-editor-popout-btn';
            button.textContent = '\u29c9';
            button.style.marginLeft = 'auto';
            button.style.marginRight = '4px';
            button.addEventListener('click', () => { if (popped) dock({ keepPoppedOut: false }); else popOut(overlay); });
            header.insertBefore(button, close);
            labelPopButton(overlay);
        }
        // The corner grip resizes (CSS resize); the size it leaves is the one remembered.
        if (typeof ResizeObserver === 'function') {
            if (sizeObserver) sizeObserver.disconnect();
            let settle = null;
            sizeObserver = new ResizeObserver(() => {
                if (!isOpen()) return;
                clearTimeout(settle);
                settle = setTimeout(() => remember(current(panel)), 200);
            });
            sizeObserver.observe(panel);
        }
        if (!globalsInstalled) {
            globalsInstalled = true;
            root.addEventListener('resize', () => {
                const shown = panelOf(overlayElement());
                if (isOpen() && shown && !popped) apply(shown, clamp(current(shown), viewport()));
            });
            document.addEventListener('pointerdown', event => { lastWorkedTarget = event.target; }, true);
            document.addEventListener('focusin', event => { lastWorkedTarget = event.target; }, true);
        }
    }

    function isOpen() {
        const overlay = overlayElement();
        return !!overlay && overlay.style.display !== 'none' && overlay.style.display !== '';
    }

    function ownsKeys() {
        const overlay = overlayElement();
        if (!overlay || !isOpen()) return false;
        const target = lastWorkedTarget && lastWorkedTarget.isConnected !== false ? lastWorkedTarget : document.activeElement;
        return !!target && overlay.contains(target);
    }

    const api = { install, place, isOpen, ownsKeys, clamp, defaultRect, popOut, dock, isPoppedOut, wantsPopOut, popoutWindow, hidePopout, showPopout, MIN_WIDTH, MIN_HEIGHT, STORAGE_KEY, POPOUT_KEY };
    root.RREventEditorWindow = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

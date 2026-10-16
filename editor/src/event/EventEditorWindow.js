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
 *   RREventEditorWindow.clamp(rect, view)  a rectangle kept where its title bar can be reached
 */
(function(root) {
    'use strict';

    const STORAGE_KEY = 'rr-event-editor-window';
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
        if (!panel) return;
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

    function install(overlay = overlayElement()) {
        const panel = panelOf(overlay);
        if (!overlay || !panel || overlay.__rrFloating) return;
        overlay.__rrFloating = true;
        overlay.classList.add('rr-event-editor-floating');
        const header = panel.querySelector('.rr-modal-header');
        if (header) header.addEventListener('pointerdown', event => startDrag(overlay, event));
        // The corner grip resizes (CSS resize); the size it leaves is the one remembered.
        if (typeof ResizeObserver === 'function') {
            let settle = null;
            new ResizeObserver(() => {
                if (!isOpen()) return;
                clearTimeout(settle);
                settle = setTimeout(() => remember(current(panel)), 200);
            }).observe(panel);
        }
        root.addEventListener('resize', () => {
            if (isOpen()) apply(panel, clamp(current(panel), viewport()));
        });
        document.addEventListener('pointerdown', event => { lastWorkedTarget = event.target; }, true);
        document.addEventListener('focusin', event => { lastWorkedTarget = event.target; }, true);
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

    const api = { install, place, isOpen, ownsKeys, clamp, defaultRect, MIN_WIDTH, MIN_HEIGHT, STORAGE_KEY };
    root.RREventEditorWindow = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Character3DBuilder - Forge › 3D Character Builder.
 *
 * One recipe (RRCharacterModel) describes the character: a human body with
 * its species, face, hair, outfit, accessories and colors, or a four-legged
 * creature. Every control edits the recipe; the view rebuilds from it,
 * skinned on its own skeleton, standing in its A-pose or playing its Idle.
 * Save to Project writes the GLB (pictures inside) to
 * <project>/3d/Characters/<name>/source/, the recipe beside it
 * (character.json) and a thumbnail, so Open lists it and edits it again, and
 * Database › 3D Models shows it like an imported model.
 */
class Character3DBuilder {
    constructor() {
        this.projectController = null;
        this.root = null;
        this.recipe = RRCharacterModel.normalize({});
        this.name = '';
        this.pack = null;
        this.cache = {};
        this.eyeSource = null;
        this.tab = 'species';
        this.extreme = false;
        this.pose = 'idle';
        this.randomScope = 'all';
        this._view = null;
        this._pending = 0;
        this._undo = [];
        this._redo = [];
        this._committed = JSON.stringify(this.recipe);
        this.openPicker = null;
        this.folded = {};
        this._thumbs = new Map();
        this._thumbQueue = [];
        this._thumbCache = {};
        this._lastChange = 0;
    }

    _t(text, params) {
        let out = window.I18n ? window.I18n.tText(text) : text;
        if (params) for (const k in params) out = out.split('{' + k + '}').join(params[k]);
        return out;
    }

    _project() {
        const project = this.projectController?.getCurrentProject?.() || this.projectController?.currentProject;
        return project && project.path ? project : null;
    }

    holdsWork() { return false; }

    renderInto(containerEl, projectController) {
        this.projectController = projectController;
        this.root = containerEl;
        if (!this._project()) {
            this.root.innerHTML = `<div class="rr-c3d-empty">${this._t('Open a project to use Forge tools.')}</div>`;
            return;
        }
        this._renderPage();
        this._start();
    }

    detach() {
        const view = this._view;
        if (!view) return;
        cancelAnimationFrame(view.frame);
        cancelAnimationFrame(view.loop);
        view.resize?.disconnect();
        this._clearModel();
        for (const t of view.textures.values()) t.texture.dispose();
        if (this._worker) { this._worker.terminate(); this._worker = undefined; }
        if (this._skinWorkerRef) { this._skinWorkerRef.terminate(); this._skinWorkerRef = undefined; this._painter = null; }
        for (const t of this._envTargets || []) t.dispose();
        this._envTargets = [];
        if (this._thumbView) { this._thumbView.renderer.dispose(); this._thumbView.renderer.forceContextLoss?.(); this._thumbView = null; }
        clearTimeout(this._shadeTimer);
        view.renderer.dispose();
        view.renderer.forceContextLoss?.();
        this._view = null;
    }

    get human() { return this.recipe.plan !== 'quadruped'; }

    // ── recipe editing ─────────────────────────────────────────────────────
    _get(path) {
        return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.recipe);
    }

    _set(path, value) {
        const next = JSON.parse(JSON.stringify(this.recipe));
        const keys = path.split('.');
        let o = next;
        for (let i = 0; i < keys.length - 1; i++) {
            if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
            o = o[keys[i]];
        }
        o[keys[keys.length - 1]] = value;
        // Ancestry is a mix: moving one slider rebalances the other two.
        if (keys[0] === 'ancestry') {
            const others = RRHumanBody.ANCESTRY.filter(a => a !== keys[1]);
            const rest = others.reduce((s, a) => s + next.ancestry[a], 0);
            others.forEach(a => { next.ancestry[a] = rest > 0 ? next.ancestry[a] / rest * (1 - value) : (1 - value) / 2; });
        }
        this.recipe = RRCharacterModel.normalize(next);
    }

    /** Remembers the recipe as a step to undo back to (after a slider is let go, a choice, an action). */
    _commit() {
        const now = JSON.stringify(this.recipe);
        if (now === this._committed) return;
        this._undo.push(this._committed);
        if (this._undo.length > 80) this._undo.shift();
        this._redo = [];
        this._committed = now;
        this._syncHistory();
    }

    _replace(recipe, rerender = true) {
        this.recipe = RRCharacterModel.normalize(recipe);
        this._commit();
        if (rerender) this._renderPanel();
        this._queueRebuild();
    }

    _history(direction) {
        const from = direction < 0 ? this._undo : this._redo, to = direction < 0 ? this._redo : this._undo;
        if (!from.length) return;
        to.push(this._committed);
        this._committed = from.pop();
        this.recipe = RRCharacterModel.normalize(JSON.parse(this._committed));
        this._syncHistory();
        this._renderPanel();
        this._queueRebuild();
    }

    _syncHistory() {
        if (!this.root) return;
        const undo = this.root.querySelector('.rr-c3d-undo'), redo = this.root.querySelector('.rr-c3d-redo');
        if (undo) undo.disabled = !this._undo.length;
        if (redo) redo.disabled = !this._redo.length;
    }

    // ── page ───────────────────────────────────────────────────────────────
    _tabs() {
        return this.human
            ? [['species', 'Species'], ['body', 'Body'], ['face', 'Face'], ['hair', 'Hair'], ['outfit', 'Outfit'], ['props', 'Accessories'], ['colors', 'Colors']]
            : [['species', 'Species'], ['body', 'Body'], ['colors', 'Colors']];
    }

    _renderPage() {
        this.root.innerHTML = `
            <div class="rr-c3d">
                <div class="rr-c3d-toolbar">
                    <label class="rr-c3d-name"><span>${this._t('Name')}</span><input type="text" class="rr-c3d-name-input rr-input" maxlength="48" placeholder="${this._t('Villager')}" value="${rrEscapeHtml(this.name)}"></label>
                    <button class="rr-btn-chip rr-c3d-undo" title="${this._t('Undo')}" disabled>↶</button>
                    <button class="rr-btn-chip rr-c3d-redo" title="${this._t('Redo')}" disabled>↷</button>
                    <span class="rr-c3d-group">
                        <button class="rr-btn-chip rr-c3d-random" title="${this._t('Roll something new for the part chosen beside it')}">🎲 ${this._t('Randomize')}</button>
                        <select class="rr-c3d-random-scope rr-select" title="${this._t('What Randomize changes')}"></select>
                    </span>
                    <button class="rr-btn-chip rr-c3d-reset">↻ ${this._t('Reset')}</button>
                    <button class="rr-btn-chip rr-c3d-open">${this._t('Open…')}</button>
                    <span class="rr-c3d-spacer"></span>
                    <span class="rr-c3d-status" aria-live="polite"></span>
                    <button class="rr-btn-chip rr-c3d-save">${this._t('Save to Project')}</button>
                </div>
                <div class="rr-c3d-body">
                    <div class="rr-c3d-side">
                        <div class="rr-c3d-tabs" role="tablist"></div>
                        <div class="rr-c3d-panel"></div>
                    </div>
                    <div class="rr-c3d-view">
                        <canvas class="rr-c3d-canvas"></canvas>
                        <div class="rr-c3d-readout"></div>
                        <div class="rr-c3d-poses" role="group" aria-label="${this._t('Pose')}">
                            <div class="rr-c3d-poses-title">${this._t('Pose')}</div>
                            ${[['apose', 'A-pose'], ['idle', 'Idle']].concat(RRCharacterPoses.POSES.map(p => [p.id, p.label])).map(([id, label]) => `<button class="rr-btn-chip rr-c3d-pose" data-pose="${id}">${this._t(label)}</button>`).join('')}
                        </div>
                        <div class="rr-c3d-viewbar">
                            <button class="rr-btn-chip rr-c3d-frame" data-frame="body">${this._t('Whole body')}</button>
                            <button class="rr-btn-chip rr-c3d-frame" data-frame="face">${this._t('Face')}</button>
                        </div>
                        <div class="rr-c3d-hint">${this._t('Drag to turn, wheel to zoom')}</div>
                        <div class="rr-c3d-gallery" hidden></div>
                    </div>
                </div>
            </div>`;
        const q = sel => this.root.querySelector(sel);
        q('.rr-c3d-name-input').addEventListener('input', e => { this.name = e.target.value; });
        q('.rr-c3d-undo').addEventListener('click', () => this._history(-1));
        q('.rr-c3d-redo').addEventListener('click', () => this._history(1));
        q('.rr-c3d-random').addEventListener('click', () => this._randomize());
        q('.rr-c3d-random-scope').addEventListener('change', e => { this.randomScope = e.target.value; });
        // Reset: back to the species' (or the creature kind's) own starting point.
        q('.rr-c3d-reset').addEventListener('click', () => this._replace(this.human ? RRCharacterModel.withSpecies({}, this.recipe.species) : Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe(this.recipe.kind))));
        q('.rr-c3d-open').addEventListener('click', () => this._showGallery());
        q('.rr-c3d-save').addEventListener('click', () => this.save());
        this.root.querySelectorAll('.rr-c3d-pose').forEach(b => b.addEventListener('click', () => { this.pose = b.dataset.pose; this._syncPose(); }));
        this.root.querySelectorAll('.rr-c3d-frame').forEach(b => b.addEventListener('click', () => this._frame(b.dataset.frame)));
        this.root.querySelector('.rr-c3d-tabs').addEventListener('click', e => {
            const b = e.target.closest('[data-tab]');
            if (!b) return;
            this.tab = b.dataset.tab;
            this._renderPanel();
        });
        const panel = q('.rr-c3d-panel');
        panel.addEventListener('input', e => this._onInput(e, false));
        panel.addEventListener('change', e => this._onInput(e, true));
        panel.addEventListener('click', e => this._onClick(e));
        this._renderPanel();
        this._syncHistory();
    }

    _renderPanel() {
        this._shownSex = RRHumanBody.sexOf(this.recipe);
        if (!this.root) return;
        const tabs = this._tabs();
        if (!tabs.some(t => t[0] === this.tab)) this.tab = 'species';
        this.root.querySelector('.rr-c3d-tabs').innerHTML = tabs.map(([id, label]) =>
            `<button class="rr-c3d-tab${id === this.tab ? ' is-active' : ''}" role="tab" aria-selected="${id === this.tab}" data-tab="${id}">${this._t(label)}</button>`).join('');
        const scopes = this.human
            ? [['all', 'Everything'], ['body', 'Body'], ['face', 'Face'], ['hair', 'Hair'], ['outfit', 'Outfit'], ['colors', 'Colors']]
            : [['all', 'Everything'], ['colors', 'Colors']];
        if (!scopes.some(s => s[0] === this.randomScope)) this.randomScope = 'all';
        this.root.querySelector('.rr-c3d-random-scope').innerHTML = scopes.map(([id, label]) => `<option value="${id}"${id === this.randomScope ? ' selected' : ''}>${this._t(label)}</option>`).join('');
        const panel = this.root.querySelector('.rr-c3d-panel');
        const top = panel.scrollTop;
        const make = {
            species: () => this._speciesTab(), body: () => this._bodyTab(), face: () => this._faceTab(), hair: () => this._hairTab(),
            outfit: () => this._outfitTab(), props: () => this._propsTab(), colors: () => this._colorsTab()
        }[this.tab];
        panel.innerHTML = make();
        this._cardify(panel);
        panel.scrollTop = top;
        this._syncSliders();
    }

    // ── controls ───────────────────────────────────────────────────────────
    _section(label) {
        return `<div class="rr-c3d-section" data-title="${rrEscapeHtml(label)}"><span>${this._t(label)}</span></div>`;
    }

    /**
     * Each section in a card of the app's own kind: the accent-strip header
     * (it folds the section; the fold is remembered per tab), the controls in
     * the card's body.
     */
    _cardify(panel) {
        let body = null;
        for (const el of [...panel.children]) {
            if (!el.classList.contains('rr-c3d-section')) { if (body) body.appendChild(el); continue; }
            const key = this.tab + ':' + el.dataset.title, folded = !!this.folded[key];
            const card = document.createElement('div');
            card.className = 'lit-section rr-c3d-card-sec' + (folded ? ' is-collapsed' : '');
            const head = document.createElement('div');
            head.className = 'lit-section-header rr-c3d-sechead';
            head.dataset.act = 'fold';
            head.dataset.key = key;
            head.tabIndex = 0;
            head.setAttribute('role', 'button');
            head.setAttribute('aria-expanded', String(!folded));
            head.innerHTML = `<span class="r3d-sec-toggle">${folded ? '▸' : '▾'}</span>`;
            for (const child of [...el.childNodes]) head.appendChild(child);
            const title = head.children[1];
            if (title) title.classList.add('r3d-sec-title');
            body = document.createElement('div');
            body.className = 'lit-section-body rr-c3d-secbody';
            card.append(head, body);
            panel.insertBefore(card, el);
            el.remove();
        }
        if (!panel._foldKeys) {
            panel._foldKeys = true;
            panel.addEventListener('keydown', e => {
                const head = e.target.closest && e.target.closest('.rr-c3d-sechead');
                if (head && (e.key === 'Enter' || e.key === ' ') && e.target === head) { e.preventDefault(); this._fold(head); }
            });
        }
    }

    _fold(head) {
        const key = head.dataset.key, card = head.parentElement;
        this.folded[key] = !this.folded[key];
        card.classList.toggle('is-collapsed', this.folded[key]);
        head.setAttribute('aria-expanded', String(!this.folded[key]));
        head.querySelector('.r3d-sec-toggle').textContent = this.folded[key] ? '▸' : '▾';
    }

    /**
     * A slider over a recipe path. `natural` is the everyday range; with
     * Extreme on the slider reaches `extreme`, the natural band shaded.
     */
    _slider(s) {
        const range = this.extreme && s.extreme ? s.extreme : s.natural;
        const [min, max] = range;
        const v = this._get(s.path);
        const lo = ((s.natural[0] - min) / (max - min)) * 100, hi = ((s.natural[1] - min) / (max - min)) * 100;
        const ends = s.ends ? `<div class="rr-c3d-ends"><span>${this._t(s.ends[0])}</span><span>${this._t(s.ends[1])}</span></div>` : '';
        return `<label class="rr-c3d-row" title="${rrEscapeHtml(this._t(s.label))}"><span class="rr-c3d-label">${this._t(s.label)}</span>
            <input type="range" data-path="${s.path}" data-format="${s.format || ''}" min="${min}" max="${max}" step="${s.step || 0.01}" value="${v}" style="--rr-nat-lo:${lo}%;--rr-nat-hi:${hi}%">
            <span class="rr-c3d-value" data-value="${s.path}">${this._format(s, v)}</span>${ends}</label>`;
    }

    _format(s, v) {
        const f = typeof s === 'string' ? s : s.format;
        if (v == null || Number.isNaN(+v)) return '';
        if (f === 'years') return this._t('{n} years', { n: Math.round(v) });
        if (f === 'signed') return (v > 0 ? '+' : '') + Math.round(v * 100);
        if (f === 'deg') return Math.round(v) + '°';
        if (f === 'm') return (+v).toFixed(2) + ' m';
        if (f === 'x') return '×' + (+v).toFixed(2);
        return Math.round(v * 100) + '%';
    }

    _select(path, label, choices, value) {
        const v = value ?? this._get(path);
        const opts = choices.map(c => {
            if (c.group) return `<optgroup label="${rrEscapeHtml(this._t(c.group))}">${c.items.map(([id, l]) => `<option value="${rrEscapeHtml(id)}"${id === v ? ' selected' : ''}>${rrEscapeHtml(this._t(l))}</option>`).join('')}</optgroup>`;
            return `<option value="${rrEscapeHtml(c[0])}"${c[0] === v ? ' selected' : ''}>${rrEscapeHtml(this._t(c[1]))}</option>`;
        }).join('');
        return `<label class="rr-c3d-row rr-c3d-choice"><span class="rr-c3d-label">${this._t(label)}</span><select class="rr-select" data-path="${path}">${opts}</select></label>`;
    }

    _color(path, label, swatches, clearable) {
        const v = this._get(path) || '';
        const sw = (swatches || []).map(c => `<button class="rr-c3d-swatch" data-act="swatch" data-path="${path}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('');
        const clear = clearable ? `<button class="rr-c3d-clear" data-act="clear" data-path="${path}" title="${this._t('None')}">✕</button>` : '';
        return `<div class="rr-c3d-row rr-c3d-colorrow"><span class="rr-c3d-label">${this._t(label)}</span>
            <div class="rr-c3d-swatches">${sw}</div>
            <span class="rr-c3d-colorpick"><button type="button" class="rr-c3d-color" data-act="color" data-path="${path}" style="--rr-c3d-swatch:${v || 'transparent'}"${v ? '' : ' data-empty="1"'} title="${rrEscapeHtml(v || this._t('None'))}"></button>${clear}</span></div>`;
    }

    _check(path, label) {
        return `<label class="rr-c3d-row rr-c3d-check"><span class="rr-c3d-label">${this._t(label)}</span><input type="checkbox" data-path="${path}"${this._get(path) ? ' checked' : ''}></label>`;
    }

    _cards(items, act) {
        return items.map(({ id, label, html }) => `<div class="rr-c3d-card"><div class="rr-c3d-card-head"><span>${this._t(label)}</span><button class="rr-c3d-remove" data-act="${act}" data-id="${id}" title="${this._t('Remove')}">✕</button></div>${html}</div>`).join('');
    }

    _onInput(event, committed) {
        const el = event.target;
        const path = el.dataset && el.dataset.path;
        if (!path) return;
        let value;
        if (el.type === 'range') value = +el.value;
        else if (el.type === 'checkbox') value = el.checked;
        else if (el.type === 'color') { value = el.value; delete el.dataset.empty; }
        else value = el.value;
        // A select is a choice: committed once, and it may change which controls show.
        if (el.tagName === 'SELECT') {
            if (!committed) return;
            if (path === 'eyeStyle') { this._applyEyeStyle(value); return; }
            // A body hair pattern sets every region to its own values.
            // On a woman, Natural and Light are a woman's own patterns.
            if (path === 'bodyHair.pattern' && value !== 'custom') {
                const female = RRHumanBody.sexOf(this.recipe) === 'female', P = RRCharacterSkin.HAIR_PRESETS;
                this._set('bodyHair.regions', Object.assign({}, (female && P[value + 'Female']) || P[value]));
            }
            this._set(path, value);
            this._commit();
            this._renderPanel();
            this._queueRebuild();
            return;
        }
        if (el.type === 'color' && !committed && event.type === 'input') { this._set(path, value); this._queueRebuild(); return; }
        // A checkbox may show or hide controls under it (Anatomical detail): the panel follows.
        if (el.type === 'checkbox') {
            if (!committed) return;
            this._set(path, value);
            this._commit();
            this._renderPanel();
            this._queueRebuild();
            return;
        }
        this._set(path, value);
        // Moving a region by hand makes the pattern Custom (the select says so once the slider is let go).
        if (path.startsWith('bodyHair.regions.')) {
            const was = this.recipe.bodyHair.pattern;
            if (was !== 'custom') this._set('bodyHair.pattern', 'custom');
            const select = this.root.querySelector('select[data-path="bodyHair.pattern"]');
            if (committed && select && select.value !== 'custom') this._renderPanel();
        }
        if (el.type === 'range') this._syncSliders();
        if (committed) this._commit();
        // Gender carried across the middle: the sex the body shows changes, and the controls for it (genitals,
        // a woman's own hair patterns) with it.
        if (committed && path === 'gender' && RRHumanBody.sexOf(this.recipe) !== this._shownSex) this._renderPanel();
        // A body slider moving: the fast path while the drag lasts, the whole character when it ends.
        if (el.type === 'range' && Character3DBuilder.bodyPath(path) && this.human) {
            if (!committed && this._fastShape()) { clearTimeout(this._settle); this._settle = setTimeout(() => this._queueRebuild(), 220); return; }
            this._fast = null;
        }
        this._queueRebuild();
    }

    _onClick(event) {
        const b = event.target.closest('[data-act]');
        if (!b) return;
        event.preventDefault();
        const act = b.dataset.act, r = JSON.parse(JSON.stringify(this.recipe));
        if (act === 'fold') { this._fold(b); return; }
        if (act === 'extreme') { this.extreme = !this.extreme; this._renderPanel(); return; }
        if (act === 'plan') {
            if ((b.dataset.plan === 'quadruped') === !this.human) return;
            this._replace(b.dataset.plan === 'quadruped' ? Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe('dog')) : { plan: 'human' });
            return;
        }
        if (act === 'species') { this._replace(RRCharacterModel.withSpecies(this.recipe, b.dataset.id)); return; }
        if (act === 'kind') { this._replace(Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe(b.dataset.id))); return; }
        if (act === 'color') {
            // The editor's own color picker, live while dragging; one undo step when let go.
            const path = b.dataset.path;
            RRColorPopover.open(b, {
                value: this._get(path) || '#808080',
                onInput: hex => {
                    this._set(path, hex); b.style.setProperty('--rr-c3d-swatch', hex); delete b.dataset.empty;
                    // The skin while dragging: the body tinted at once from the painted skin toward the new color;
                    // the new skin is painted once the color rests.
                    if (path === 'skin' && this._tintSkin(hex)) return;
                    this._queueRebuild();
                },
                onChange: hex => { this._set(path, hex); b.style.setProperty('--rr-c3d-swatch', hex); b.title = hex; this._commit(); this._queueRebuild(); }
            });
            return;
        }
        if (act === 'swatch') { this._set(b.dataset.path, b.dataset.color); this._commit(); this._renderPanel(); this._queueRebuild(); return; }
        if (act === 'clear') { this._set(b.dataset.path, ''); this._commit(); this._renderPanel(); this._queueRebuild(); return; }
        if (act === 'dress') {
            const preset = RRCharacterWardrobe.PRESETS.find(p => p.id === b.dataset.id);
            if (preset) { r.outfit = JSON.parse(JSON.stringify(RRCharacterWardrobe.dressFor(preset.items, RRHumanBody.sexOf(r) === 'female'))); this._replace(r); }
            return;
        }
        if (act === 'remove-garment') { r.outfit = r.outfit.filter(i => i.id !== b.dataset.id); this._replace(r); return; }
        if (act === 'remove-prop') { r.props = r.props.filter(i => i.id !== b.dataset.id); this._replace(r); return; }
        if (act === 'picker') { this.openPicker = this.openPicker === b.dataset.id ? null : b.dataset.id; this._renderPanel(); return; }
        if (act === 'pick') { this._set(b.dataset.path, b.dataset.id); this._commit(); this._renderPanel(); this._queueRebuild(); return; }
        if (act === 'add-garment' || act === 'add-prop') {
            const id = b.dataset.id;
            if (!id) return;
            if (act === 'add-garment') r.outfit = r.outfit.concat([{ id }]); else r.props = r.props.concat([{ id }]);
            this.openPicker = null;
        this.folded = {};
            this._replace(r);
        }
    }

    _syncSliders() {
        if (!this.root) return;
        this.root.querySelectorAll('.rr-c3d-panel input[type="range"]').forEach(input => {
            const v = this._get(input.dataset.path);
            if (v == null) return;
            if (+input.value !== v) input.value = v;
            input.style.setProperty('--rr-fill', ((Math.max(+input.min, Math.min(+input.max, v)) - input.min) / (input.max - input.min) * 100) + '%');
            const label = this.root.querySelector(`[data-value="${input.dataset.path}"]`);
            if (label) label.textContent = this._format(input.dataset.format, v);
        });
    }

    // ── tabs ───────────────────────────────────────────────────────────────
    _speciesTab() {
        const plan = `<div class="rr-c3d-plan">
            <button class="rr-btn-chip${this.human ? ' is-active' : ''}" data-act="plan" data-plan="human">${this._t('Humanoid')}</button>
            <button class="rr-btn-chip${this.human ? '' : ' is-active'}" data-act="plan" data-plan="quadruped">${this._t('Four-legged')}</button></div>`;
        if (!this.human) {
            const kinds = RRCreatureBody.KINDS.map(k => this._tile('kind', k.kind, k.label || this._cap(k.kind), 'kind', k.kind === this.recipe.kind)).join('');
            const options = RRCreatureBody.OPTIONS.filter(o => o.key !== 'pattern').map(o => this._select(o.key, o.label, o.choices.map(c => [c.id, c.label]))).join('');
            return plan + this._section('Kind') + `<div class="rr-c3d-tiles">${kinds}</div>` + this._section('Features') + options;
        }
        const groups = [...new Set(RRCharacterSpecies.SPECIES.map(s => s.group))];
        const tiles = groups.map(g => `<div class="rr-c3d-subhead">${this._t(g)}</div><div class="rr-c3d-tiles">${RRCharacterSpecies.SPECIES.filter(s => s.group === g)
            .map(s => this._tile('species', s.id, s.label, 'species', s.id === this.recipe.species)).join('')}</div>`).join('');
        const features = Object.entries(RRCharacterSpecies.FEATURES).map(([key, def]) => {
            const f = this.recipe.features[key];
            let html = this._select(`features.${key}.type`, def.label, def.types);
            if (f.type !== 'none') {
                html += this._slider({ path: `features.${key}.size`, label: 'Size', natural: [0.5, 1.6], extreme: [0.2, 3], format: 'x' });
                if (key === 'tail') html += this._slider({ path: 'features.tail.length', label: 'Length', natural: [0.5, 1.6], extreme: [0.2, 3], format: 'x' });
                html += this._color(`features.${key}.color`, 'Color', []);
                if (def.defaults.color2) html += this._color(`features.${key}.color2`, key === 'tail' || key === 'wings' ? 'Underside' : 'Tip color', []);
            }
            return html;
        }).join('');
        return plan + this._section('Species') + `<p class="rr-c3d-note">${this._t('A species sets the body, face, skin and features to start from. Everything stays editable.')}</p>` + tiles + this._section('Features') + features;
    }

    _cap(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }

    /** The tab's switches, above its sections: Extreme proportions, and on the Body tab Anatomical detail. */
    _extremeToggle(anatomy) {
        const extreme = `<label class="rr-c3d-extreme"><input type="checkbox" data-act="extreme"${this.extreme ? ' checked' : ''}><span>${this._t('Extreme proportions')}</span></label>`;
        const detail = anatomy ? `<label class="rr-c3d-extreme"><input type="checkbox" data-path="anatomy.detail"${this.recipe.anatomy.detail ? ' checked' : ''}><span>${this._t('Anatomical detail')}</span></label>` : '';
        return `<div class="rr-c3d-switches">${extreme}${detail}</div>`;
    }

    /** Each section with all its sliders (a section folds by its header); `extra` adds controls at a section's top or end. */
    _shapeSliders(sections, extra = {}) {
        return sections.map(section => {
            const list = RRHumanBody.SLIDERS.filter(s => s.section === section);
            const more = extra[section] || {};
            return this._section(section) + (more.before || '') + list.map(s => this._slider({
                path: `shapes.${s.key}`, label: s.label, natural: s.paired ? [-1, 1] : [0, 1], extreme: s.paired ? [-s.extreme, s.extreme] : [0, s.extreme], format: s.paired ? 'signed' : ''
            })).join('') + (more.after || '');
        }).join('');
    }

    _bodyTab() {
        if (!this.human) {
            const sections = [...new Set(RRCreatureBody.SLIDERS.map(s => s.section))].filter(s => s !== 'Coat');
            return this._extremeToggle() + sections.map(sec => this._section(sec) + RRCreatureBody.SLIDERS.filter(s => s.section === sec).map(s => this._slider({
                path: s.key, label: s.label, natural: s.natural || [s.min, s.max], extreme: [s.min, s.max], step: s.step, format: s.unit === 'm' ? 'm' : s.unit === 'deg' || /Angle|Pitch/.test(s.key) ? 'deg' : 'x'
            })).join('')).join('');
        }
        const M = RRHumanBody.MACRO_RANGES;
        const macro = [
            { path: 'gender', label: 'Gender', natural: [0, 1], ends: ['Female', 'Male'] },
            { path: 'age', label: 'Age', natural: [RRHumanBody.MIN_AGE, RRHumanBody.MAX_AGE], step: 1, format: 'years' },
            { path: 'height', label: 'Height', natural: M.height.natural, extreme: M.height.extreme },
            { path: 'weight', label: 'Weight', natural: M.weight.natural, extreme: M.weight.extreme, ends: ['Thin', 'Heavy'] },
            { path: 'muscle', label: 'Muscle', natural: M.muscle.natural, extreme: M.muscle.extreme },
            { path: 'proportions', label: 'Proportions', natural: M.proportions.natural, extreme: M.proportions.extreme, ends: ['Average', 'Ideal'] },
            { path: 'headSize', label: 'Head size', natural: [0.8, 1.25], extreme: [0.5, 2.2], format: 'x' }
        ];
        const a = this.recipe.anatomy, detail = a.detail, male = RRHumanBody.sexOf(this.recipe) === 'male';
        const shownAs = detail ? this._select('anatomy.sex', 'Shown as', [['auto', 'By gender'], ['male', 'Male'], ['female', 'Female']]) : '';
        const bustTop = this._slider({ path: 'cup', label: 'Bust size', natural: M.cup.natural, extreme: M.cup.extreme })
            + this._slider({ path: 'firmness', label: 'Firmness', natural: M.firmness.natural, extreme: M.firmness.extreme });
        const nipples = detail ? this._slider({ path: 'anatomy.areola', label: 'Areola size', natural: [0.6, 1.6], extreme: [0.4, 2.5], format: 'x' })
            + this._slider({ path: 'anatomy.nipple', label: 'Nipple size', natural: [0.3, 2], extreme: [0, 3], format: 'x' })
            + this._color('anatomy.areolaColor', 'Areola color', ['#c08070', '#a0605a', '#7a4a3a', '#4a2a22'], true) : '';
        const toes = this._slider({ path: 'morph.toes', label: 'Toe length', natural: [0.7, 1.5], extreme: [0.4, 3], format: 'x' });
        let genitals = '';
        if (detail) {
            genitals = this._section('Genitals') + (male
                ? [['length', 'Length'], ['girth', 'Girth'], ['testicles', 'Testicles']].map(([k, label]) => this._slider({ path: `anatomy.${k}`, label, natural: [-1, 1], extreme: [-1, 2], format: 'signed' })).join('')
                : this._slider({ path: 'anatomy.mons', label: 'Mons', natural: [0, 2], extreme: [0, 3], format: 'x' })
                    + this._slider({ path: 'anatomy.labia', label: 'Labia', natural: [0, 2], extreme: [0, 3], format: 'x' })
                    + this._slider({ path: 'anatomy.fold', label: 'Fold depth', natural: [0, 2], format: 'x' }));
        }
        return this._extremeToggle(true) + this._section('Build') + macro.map(s => this._slider(s)).join('') + shownAs
            + this._shapeSliders(['Proportions', 'Torso', 'Bust', 'Arms and legs'], { Bust: { before: bustTop, after: nipples }, 'Arms and legs': { after: toes } })
            + genitals + this._bodyHairSection();
    }

    /** Body hair: how much, by pattern or region by region, its color, and fur over it. */
    _bodyHairSection() {
        const b = this.recipe.bodyHair, K = RRCharacterSkin;
        let html = this._section('Body hair') + this._slider({ path: 'bodyHair.amount', label: 'Amount', natural: [0, 1] })
            + this._select('bodyHair.pattern', 'Pattern', K.BODY_HAIR_PATTERNS)
            + K.HAIR_REGIONS.map(([key, label]) => this._slider({ path: `bodyHair.regions.${key}`, label, natural: [0, 1] })).join('');
        html += this._color('bodyHair.color', 'Color', ['#0e0c0b', '#2a1d15', '#6a4428', '#b8632a', '#d8b070', '#8a8a8a'], true)
            + this._slider({ path: 'bodyHair.fur', label: 'Fur', natural: [0, 1] });
        if (b.fur > 0) html += this._slider({ path: 'bodyHair.length', label: 'Fur length', natural: [0.5, 1.6], extreme: [0.3, 3], format: 'x' });
        return html;
    }

    /** Eye styles: a set of eye size, shape, iris, pupil and catchlights. */
    static get EYE_STYLES() {
        return {
            natural: { shapes: { eyeSize: 0 }, morph: { eyeWide: 1, eyeTall: 1 }, eyes: { size: 1, pupilSize: 1, catchlight: false } },
            anime: { shapes: { eyeSize: 2.4 }, morph: { eyeWide: 1.1, eyeTall: 1.55 }, eyes: { size: 1.45, pupilSize: 1.15, catchlight: true } },
            beady: { shapes: { eyeSize: -1.2 }, morph: { eyeWide: 0.85, eyeTall: 0.85 }, eyes: { size: 0.85, pupilSize: 1.3, catchlight: false } }
        };
    }

    _eyeStyle() {
        const r = this.recipe;
        for (const [id, st] of Object.entries(Character3DBuilder.EYE_STYLES)) {
            if (Math.abs(r.shapes.eyeSize - st.shapes.eyeSize) < 0.01 && Math.abs(r.morph.eyeWide - st.morph.eyeWide) < 0.01 && Math.abs(r.morph.eyeTall - st.morph.eyeTall) < 0.01
                && Math.abs(r.eyes.size - st.eyes.size) < 0.01 && !!r.eyes.catchlight === st.eyes.catchlight) return id;
        }
        return 'custom';
    }

    _applyEyeStyle(id) {
        const st = Character3DBuilder.EYE_STYLES[id];
        if (!st) { this._renderPanel(); return; }
        if (!this.extreme && (st.shapes.eyeSize > 1 || st.shapes.eyeSize < -1)) this.extreme = true;
        const r = JSON.parse(JSON.stringify(this.recipe));
        Object.assign(r.shapes, st.shapes); Object.assign(r.morph, st.morph); r.eyes = Object.assign({}, r.eyes, st.eyes);
        this._replace(r);
    }

    _faceTab() {
        const morph = [
            { path: 'morph.snout', label: 'Snout', natural: [0, 1], extreme: [0, 1.5] },
            { path: 'morph.muzzle', label: 'Muzzle narrow', natural: [0, 1] },
            { path: 'morph.flat', label: 'Flat face', natural: [0, 1] },
            { path: 'morph.earsAway', label: 'Hide ears', natural: [0, 1] }
        ].concat(this.recipe.morph.earsAway > 0.6 ? [{ path: 'morph.earHoles', label: 'Ear holes', natural: [0, 2] }] : []);
        const eyeStyle = this._select('eyeStyle', 'Eye style', [['natural', 'Natural'], ['anime', 'Anime'], ['beady', 'Small'], ['custom', 'Custom']], this._eyeStyle());
        const eyeShape = [
            { path: 'morph.eyeWide', label: 'Eye width', natural: [0.7, 1.4], extreme: [0.5, 2.5], format: 'x' },
            { path: 'morph.eyeTall', label: 'Eye tallness', natural: [0.7, 1.4], extreme: [0.5, 2.5], format: 'x' }
        ];
        const ancestry = RRHumanBody.ANCESTRY.map(a => this._slider({ path: `ancestry.${a}`, label: { african: 'African', asian: 'Asian', caucasian: 'European' }[a], natural: [0, 1] })).join('');
        return this._extremeToggle() + this._shapeSliders(['Head and neck', 'Head shape', 'Forehead and brows', 'Eyes']) + eyeStyle + eyeShape.map(s => this._slider(s)).join('')
            + this._shapeSliders(['Nose', 'Mouth and jaw', 'Ears'])
            + this._section('Muzzle and face') + morph.map(s => this._slider(s)).join('') + this._section('Ancestry') + ancestry;
    }

    _hairTab() {
        const H = RRCharacterHair;
        const colors = ['#0e0c0b', '#2a1d15', '#3b2a1e', '#6a4428', '#8a3a1c', '#b8632a', '#d8b070', '#efe2b8', '#8a8a8a', '#e8e8e8', '#2a4ab0', '#2a8a4a', '#d84a9a', '#7a3ab8', '#c02020'];
        const h = this.recipe.hair;
        const options = list => list.map(x => ({ id: x.id, label: x.label, group: x.group }));
        let out = this._section('Hair') + this._picker('hair.style', 'Style', options(H.STYLES), 'hair') + this._color('hair.color', 'Color', colors) + this._color('hair.tipColor', 'Tip color', [], true);
        if (h.style !== 'bald') {
            out += [
                { path: 'hair.length', label: 'Length', natural: [0.3, 2.5], format: 'x' },
                { path: 'hair.volume', label: 'Volume', natural: [0, 1] },
                { path: 'hair.curl', label: 'Curl', natural: [0, 1] },
                { path: 'hair.fringe', label: 'Bangs', natural: [0, 1] },
                { path: 'hair.hairline', label: 'Receding', natural: [0, 1] },
                { path: 'hair.highlights', label: 'Highlights', natural: [0, 1] }
            ].map(s => this._slider(s)).join('') + this._select('hair.part', 'Part', (H.PARTS || ['center', 'left', 'right', 'none']).map(p => [p, this._cap(p === 'none' ? 'None' : p)]));
        }
        out += this._section('Facial hair') + this._picker('hair.facial.style', 'Style', options(H.FACIAL), 'facial');
        if (h.facial.style !== 'none') {
            out += this._color('hair.facial.color', 'Color', colors.slice(0, 10), true)
                + this._slider({ path: 'hair.facial.length', label: 'Length', natural: [0.3, 2.5], format: 'x' })
                + this._slider({ path: 'hair.facial.volume', label: 'Volume', natural: [0, 1] });
        }
        out += this._section('Brows and lashes') + this._picker('hair.brows.style', 'Brows', options(H.BROWS), 'brows');
        if (h.brows.style !== 'none') out += this._slider({ path: 'hair.brows.thickness', label: 'Thickness', natural: [0, 1] }) + this._color('hair.brows.color', 'Color', colors.slice(0, 10), true);
        return out + this._check('hair.lashes', 'Eyelashes');
    }

    _garmentChoices() {
        const W = RRCharacterWardrobe;
        return [...new Set(W.GARMENTS.map(g => g.group))].map(group => ({ group, items: W.GARMENTS.filter(g => g.group === group).map(g => [g.id, g.label]) }));
    }

    _outfitTab() {
        const W = RRCharacterWardrobe;
        const presets = [...new Set(W.PRESETS.map(p => p.group))].map(g => `<div class="rr-c3d-subhead">${this._t(g)}</div><div class="rr-c3d-tiles">${W.PRESETS.filter(p => p.group === g)
            .map(p => this._tile('dress', p.id, p.label, 'dress', false)).join('')}</div>`).join('');
        const add = this._addPicker('garment', 'Add a garment', W.GARMENTS.map(g => ({ id: g.id, label: g.label, group: g.group })), 'add-garment');
        const knobs = { sleeves: ['Sleeves', [0, 1]], length: ['Length', [0, 1], [0, 1.4]], fit: ['Looseness', [0, 1], [0, 1.5]], flare: ['Flare', [0, 1], [0, 1.5]], bell: ['Bell sleeves', [0, 1]], open: ['Open front', [0, 1]], face: ['Covers face', [0, 1]], bulk: ['Bulk', [0, 1], [0, 1.5]] };
        const items = this.recipe.outfit.map((item, i) => {
            const g = W.BY_ID.get(item.id);
            let html = this._color(`outfit.${i}.color`, 'Color', ['#f2f0ea', '#1f1f24', '#2f4468', '#7a3b3b', '#3e5a32', '#5a3d22', '#8a8e96', '#c9a35a']);
            html += this._color(`outfit.${i}.color2`, 'Second color', []) + this._color(`outfit.${i}.trim`, 'Trim', [], true);
            html += this._select(`outfit.${i}.pattern`, 'Pattern', W.PATTERNS.concat(item.pattern && !W.PATTERNS.some(p => p[0] === item.pattern) ? [[item.pattern, this._cap(item.pattern)]] : []));
            html += this._select(`outfit.${i}.material`, 'Material', Object.keys(W.MATERIAL).map(m => [m, this._cap(m)]));
            for (const k of g.knobs || Object.keys(knobs).filter(k => item[k] != null)) {
                if (k === 'neckline') { html += this._select(`outfit.${i}.neckline`, 'Neckline', W.NECKLINE_CHOICES); continue; }
                if (k === 'color2') continue;
                const [label, natural, extreme] = knobs[k] || [];
                if (label) html += this._slider({ path: `outfit.${i}.${k}`, label, natural, extreme: extreme || natural });
            }
            html += this._slider({ path: `outfit.${i}.trimWidth`, label: 'Trim width', natural: [0, 0.25] });
            return { id: item.id, label: g.label, html };
        });
        return this._section('Dress as') + presets + this._section('Garments') + add
            + (items.length ? this._cards(items, 'remove-garment') : `<p class="rr-c3d-note">${this._t('Nothing worn. Pick an outfit above or add garments one by one.')}</p>`);
    }

    _propsTab() {
        const P = RRCharacterProps;
        const add = this._addPicker('prop', 'Add an accessory', P.PROPS.map(p => ({ id: p.id, label: p.label, group: p.group })), 'add-prop');
        const knobs = { size: ['Size', [0.6, 1.5], [0.3, 3]], height: ['Height', [0.5, 1.6], [0.3, 3]], length: ['Length', [0, 1]], width: ['Width', [0.6, 1.5]], up: ['Raised', [0, 1]] };
        const items = this.recipe.props.map((item, i) => {
            const def = P.BY_ID.get(item.id);
            let html = this._color(`props.${i}.color`, 'Color', ['#141414', '#e0b84a', '#d8d8e0', '#8a1a2a', '#2e3f8a', '#5a4a3a']);
            if (def.defaults.color2) html += this._color(`props.${i}.color2`, 'Second color', []);
            if (def.shapes) html += this._select(`props.${i}.shape`, 'Shape', def.shapes);
            if (def.defaults.side) html += this._select(`props.${i}.side`, 'Side', [['left', 'Left'], ['right', 'Right']]);
            for (const [k, [label, natural, extreme]] of Object.entries(knobs)) if (def.defaults[k] != null) html += this._slider({ path: `props.${i}.${k}`, label, natural, extreme: extreme || natural, format: k === 'length' || k === 'up' ? '' : 'x' });
            return { id: item.id, label: def.label, html };
        });
        return this._section('Accessories') + add + (items.length ? this._cards(items, 'remove-prop') : `<p class="rr-c3d-note">${this._t('Glasses, hats, jewelry, capes and packs. Each fits the head and body as they are shaped.')}</p>`);
    }

    _colorsTab() {
        if (!this.human) {
            const pattern = RRCreatureBody.OPTIONS.find(o => o.key === 'pattern');
            return this._section('Coat') + (pattern ? this._select('pattern', pattern.label, pattern.choices.map(c => [c.id, c.label])) : '')
                + RRCreatureBody.SLIDERS.filter(s => s.section === 'Coat').map(s => this._slider({ path: s.key, label: s.label, natural: s.natural || [s.min, s.max], extreme: [s.min, s.max], step: s.step, format: 'x' })).join('')
                + RRCreatureBody.COLORS.map(c => this._color(`colors.${c.key}`, c.label, [])).join('');
        }
        const S = RRCharacterSkin;
        const tones = ['#f6e0d0', '#f1d3bd', '#e5b897', '#c69c7f', '#a8795a', '#8a5a3c', '#5e3b26', '#3f2618', '#6a8a4a', '#7a9a3a', '#b0463e', '#5e5470', '#9aa4a2', '#d8dce2'];
        const sp = this.recipe.skinPattern;
        let out = this._section('Skin') + this._color('skin', 'Skin color', tones) + this._select('skinPattern.type', 'Markings', S.PATTERNS);
        if (sp.type !== 'none') out += this._color('skinPattern.color', 'Marking color', []) + this._slider({ path: 'skinPattern.amount', label: 'Strength', natural: [0, 1] }) + this._slider({ path: 'skinPattern.scale', label: 'Scale', natural: [0.3, 3], format: 'x' });
        out += this._color('skinPattern.belly', 'Belly color', [], true);
        out += this._section('Makeup') + this._color('skinPattern.lips', 'Lips', ['#b02040', '#c8606a', '#8a2a4a', '#1a1a1a', '#6a3a8a'], true)
            + this._slider({ path: 'skinPattern.blush', label: 'Blush', natural: [0, 1] }) + this._color('skinPattern.eyeshadow', 'Eye shadow', ['#6a3a8a', '#2a4a8a', '#1a1a1a', '#8a5a3a'], true);
        if (sp.eyeshadow) out += this._slider({ path: 'skinPattern.shadowAmount', label: 'Shadow strength', natural: [0, 1] });
        out += this._section('Eyes') + this._color('eyes.color', 'Iris', ['#6a4a2a', '#3a2414', '#3a8ad8', '#4a8a4a', '#8a8a5a', '#5a6a7a', '#e0c030', '#d8302a', '#7a3ab8'])
            + this._select('eyes.pupil', 'Pupil', S.PUPILS) + this._slider({ path: 'eyes.size', label: 'Iris size', natural: [0.7, 1.3], extreme: [0.5, 1.6], format: 'x' })
            + this._slider({ path: 'eyes.pupilSize', label: 'Pupil size', natural: [0.5, 1.6], extreme: [0.3, 2.4], format: 'x' })
            + this._check('eyes.catchlight', 'Catchlights') + this._color('eyes.sclera', 'Whites', ['#1a0808', '#0a0a0e', '#f0e0a0'], true);
        return out;
    }

    // ── pickers with pictures ──────────────────────────────────────────────
    /** A tile with a picture of what it chooses (drawn on the character as it is), filled in when ready. */
    _tile(act, id, label, kind, active, extra = '') {
        const key = kind ? kind + ':' + id : '';
        if (kind) this._wantThumb(kind, id);
        const url = key && this._thumbs.get(key)?.url;
        return `<button class="rr-c3d-tile rr-c3d-thumbtile${active ? ' is-active' : ''}" data-act="${act}" data-id="${rrEscapeHtml(id)}"${extra} title="${rrEscapeHtml(this._t(label))}">`
            + `<span class="rr-c3d-thumb" data-thumb="${rrEscapeHtml(key)}">${url ? `<img src="${url}" alt="">` : ''}</span><span class="rr-c3d-tile-label">${rrEscapeHtml(this._t(label))}</span></button>`;
    }

    _grid(options, render) {
        const groups = [...new Set(options.map(o => o.group || ''))];
        return groups.map(g => (g && groups.length > 1 ? `<div class="rr-c3d-subhead">${this._t(g)}</div>` : '') + `<div class="rr-c3d-tiles">${options.filter(o => (o.group || '') === g).map(render).join('')}</div>`).join('');
    }

    /** One choice among pictures: the current one shown, the others opened under it. */
    _picker(path, label, options, kind) {
        const current = this._get(path), open = this.openPicker === path;
        const now = options.find(o => o.id === current) || options[0];
        let html = `<div class="rr-c3d-row rr-c3d-pickrow"><span class="rr-c3d-label">${this._t(label)}</span>
            <button class="rr-c3d-pickcurrent${open ? ' is-open' : ''}" data-act="picker" data-id="${path}">`
            + `<span class="rr-c3d-thumb" data-thumb="${kind}:${rrEscapeHtml(now.id)}">${this._thumbs.get(kind + ':' + now.id)?.url ? `<img src="${this._thumbs.get(kind + ':' + now.id).url}" alt="">` : ''}</span>`
            + `<span>${rrEscapeHtml(this._t(now.label))}</span><span class="rr-c3d-caret">${open ? '▴' : '▾'}</span></button></div>`;
        this._wantThumb(kind, now.id);
        if (open) html += `<div class="rr-c3d-pickgrid">${this._grid(options, o => this._tile('pick', o.id, o.label, kind, o.id === current, ` data-path="${path}"`))}</div>`;
        return html;
    }

    /** Pictures of things to add (garments, accessories), opened by a button. */
    _addPicker(kind, label, options, act) {
        const open = this.openPicker === 'add:' + kind;
        let html = `<button class="rr-btn-chip rr-c3d-addbtn${open ? ' is-active' : ''}" data-act="picker" data-id="add:${kind}">＋ ${this._t(label)}</button>`;
        if (open) html += `<div class="rr-c3d-pickgrid">${this._grid(options, o => this._tile(act, o.id, o.label, kind, false))}</div>`;
        return html;
    }

    /** What a kind of picture depends on: the recipe, less what the picture itself varies. */
    _thumbSig(kind) {
        const r = this.recipe;
        const pick = (o, keys) => JSON.stringify(keys.map(k => o[k]));
        const body = JSON.stringify([r.plan, r.gender, r.age, r.height, r.weight, r.muscle, r.cup, r.firmness, r.headSize, r.shapes, r.morph, r.ancestry, r.skin, r.skinPattern, r.species, r.features]);
        if (kind === 'hair' || kind === 'facial' || kind === 'brows') return body + pick(r.hair, ['color', 'tipColor', 'length', 'volume', 'curl', 'fringe', 'part']) + JSON.stringify(r.hair.facial) + JSON.stringify(r.hair.brows) + r.hair.style;
        if (kind === 'garment' || kind === 'prop') return body + JSON.stringify(r.hair);
        if (kind === 'dress') return body + JSON.stringify(r.hair) + JSON.stringify(r.props);
        if (kind === 'species') return JSON.stringify([r.gender, r.age, r.outfit, r.props]);
        return 'kind';
    }

    _wantThumb(kind, id) {
        if (!kind) return;
        const key = kind + ':' + id, sig = this._thumbSig(kind);
        const have = this._thumbs.get(key);
        if (have && have.sig === sig) return;
        // Drawn before, in this session or an earlier one: read back from the editor's own folder.
        const stored = this._storedThumb(key, sig);
        if (stored) { this._thumbs.set(key, { url: stored, sig }); return; }
        const queued = this._thumbQueue.find(q => q.key === key);
        if (queued) { queued.sig = sig; return; }
        this._thumbQueue.push({ key, kind, id, sig });
        this._pumpThumbs();
    }

    /**
     * Pictures kept on disk, in the editor's data folder, named by a hash of
     * everything they show: opening the builder again reuses every one, and a
     * picture is drawn again only when what it shows changes.
     */
    _thumbDir() {
        if (this._thumbFolder !== undefined) return this._thumbFolder;
        try {
            const path = require('path'), fs = require('fs'), os = require('os');
            const base = (typeof nw !== 'undefined' && nw.App && nw.App.dataPath) || os.tmpdir();
            const dir = path.join(base, 'character-builder-previews');
            fs.mkdirSync(dir, { recursive: true });
            this._thumbFolder = dir;
        } catch (error) { this._thumbFolder = null; }
        return this._thumbFolder;
    }

    _thumbFile(key, sig) {
        const dir = this._thumbDir();
        if (!dir) return null;
        // The pictures' look changes with the builder: a new version draws them again.
        const name = require('crypto').createHash('sha1').update(Character3DBuilder.PREVIEW_VERSION + '|' + key + '|' + sig).digest('hex');
        return require('path').join(dir, name + '.webp');
    }

    _storedThumb(key, sig) {
        try {
            const file = this._thumbFile(key, sig);
            if (!file) return null;
            const fs = require('fs');
            if (!fs.existsSync(file)) return null;
            return 'data:image/webp;base64,' + fs.readFileSync(file).toString('base64');
        } catch (error) { return null; }
    }

    _storeThumb(key, sig, url) {
        try {
            const file = this._thumbFile(key, sig);
            if (!file || !url.startsWith('data:image/webp;base64,')) return;
            require('fs').writeFile(file, Buffer.from(url.slice(23), 'base64'), () => {});
        } catch (error) { /* a picture not kept is drawn again next time */ }
    }

    /** One picture at a time, between frames, and only while the sliders rest. */
    _pumpThumbs() {
        if (this._thumbTimer || !this._thumbQueue.length) return;
        this._thumbTimer = setTimeout(() => {
            this._thumbTimer = 0;
            if (!this.root) return;
            // Asked for before the view was up (the first tab draws first): wait for it.
            if (!this._view || !this.pack || !this._result) { this._pumpThumbs(); return; }
            if (Date.now() - this._lastChange < 700) { this._pumpThumbs(); return; }
            // Only when the page is idle: a picture costs a build, never a frame the user is waiting on.
            // Between frames when the page has time to spare; when it never has (the Idle playing on a fast
            // screen), after a short wait anyway, so the pictures always come.
            if (typeof requestIdleCallback === 'function' && !this._idleOk) {
                requestIdleCallback(deadline => { this._idleOk = true; this._pumpThumbs(); }, { timeout: 250 });
                return;
            }
            this._idleOk = false;
            // The tiles on screen first.
            const visible = new Set([...this.root.querySelectorAll('.rr-c3d-thumb[data-thumb]')].map(e => e.dataset.thumb));
            this._thumbQueue = this._thumbQueue.filter(q => visible.has(q.key));
            const item = this._thumbQueue.shift();
            if (item) {
                try {
                    const url = this._makeThumb(item);
                    if (url) {
                        this._thumbs.set(item.key, { url, sig: item.sig });
                        this._storeThumb(item.key, item.sig, url);
                        this.root.querySelectorAll(`.rr-c3d-thumb[data-thumb="${CSS.escape(item.key)}"]`).forEach(el => { el.innerHTML = `<img src="${url}" alt="">`; });
                    }
                } catch (error) {
                    // One more try later; a second failure leaves the tile as its name.
                    console.warn('[Character3DBuilder] preview', item.key, error);
                    if (item.tries) this._thumbs.set(item.key, { url: '', sig: item.sig });
                    else this._thumbQueue.push(Object.assign(item, { tries: 1 }));
                }
            }
            this._pumpThumbs();
        }, this._view && this._result ? 60 : 200);
    }

    /** The parts a picture shows, and how it is framed. */
    _thumbParts(item) {
        const r = this.recipe, pack = this.pack;
        const preview = { quality: 'preview', skinSize: 256, atlasSize: 256, eyeSource: this.eyeSource };
        if (item.kind === 'kind') return { result: RRCharacterModel.build(pack, Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe(item.id)), {}, preview), frame: 'side' };
        if (item.kind === 'species') return { result: RRCharacterModel.build(pack, RRCharacterModel.withSpecies(r, item.id), this._thumbCache.species || (this._thumbCache.species = {}), preview), frame: 'body' };
        if (item.kind === 'dress') {
            const preset = RRCharacterWardrobe.PRESETS.find(p => p.id === item.id);
            return { result: RRCharacterModel.build(pack, Object.assign({}, r, { outfit: RRCharacterWardrobe.dressFor(preset.items, RRHumanBody.sexOf(r) === 'female') }), this._thumbCache.dress || (this._thumbCache.dress = {}), preview), frame: 'body' };
        }
        // The rest show one thing on the character as it stands, without its outfit or other accessories.
        const base = Object.assign({}, r, { outfit: [], props: [] });
        if (item.kind === 'hair') base.hair = Object.assign({}, r.hair, { style: item.id });
        if (item.kind === 'facial') base.hair = Object.assign({}, r.hair, { facial: Object.assign({}, r.hair.facial, { style: item.id }) });
        if (item.kind === 'brows') base.hair = Object.assign({}, r.hair, { brows: Object.assign({}, r.hair.brows, { style: item.id }) });
        if (item.kind === 'garment') base.outfit = [{ id: item.id }];
        if (item.kind === 'prop') base.props = [{ id: item.id }];
        const result = RRCharacterModel.build(pack, base, this._thumbCache[item.kind] || (this._thumbCache[item.kind] = {}), preview);
        let frame = 'body';
        if (item.kind === 'hair' || item.kind === 'facial') frame = 'head';
        if (item.kind === 'brows') frame = 'face';
        if (item.kind === 'prop') { const g = RRCharacterProps.BY_ID.get(item.id).group; frame = g === 'Back' ? 'back' : g === 'Jewelry' && item.id === 'bracelets' ? 'body' : 'head'; }
        if (item.kind === 'garment') { const slot = RRCharacterWardrobe.BY_ID.get(item.id).slot; frame = slot === 'head' ? 'head' : slot === 'feet' ? 'feet' : 'body'; }
        return { result, frame };
    }

    _makeThumb(item) {
        if (!this._thumbView) {
            const size = 96, canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
            renderer.setPixelRatio(1);
            renderer.setSize(size, size, false);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;
            renderer.setClearColor(0x000000, 0);
            const scene = new THREE.Scene();
            scene.environment = this._studio(renderer);
            scene.environmentIntensity = 0.75;
            scene.add(new THREE.HemisphereLight(0xfff4e8, 0x3a3430, 0.45));
            const key = new THREE.DirectionalLight(0xfff0e0, 2.4); key.position.set(1.6, 3.2, 2.4); scene.add(key);
            const rim = new THREE.DirectionalLight(0xc8d8ff, 1.4); rim.position.set(-1.2, 2.4, -2.8); scene.add(rim);
            this._thumbView = { renderer, scene, camera: new THREE.PerspectiveCamera(28, 1, 0.02, 60), canvas };
        }
        const tv = this._thumbView;
        const { result, frame } = this._thumbParts(item);
        const group = new THREE.Group(), made = [], textures = new Map();
        const textureFor = (name, tex) => {
            if (!textures.has(name)) {
                const t = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat);
                t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
                textures.set(name, t);
            }
            return textures.get(name);
        };
        const box = new THREE.Box3();
        for (const part of result.parts) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
            g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
            if (part.uvs) g.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
            if (part.colors) g.setAttribute('color', new THREE.BufferAttribute(part.colors, 3));
            g.setIndex(new THREE.BufferAttribute(part.index, 1));
            const mesh = new THREE.Mesh(g, this._material(part, result, textureFor, this._thumbView && this._thumbView.scene));
            group.add(mesh);
            made.push(mesh);
            g.computeBoundingBox();
            box.union(g.boundingBox);
        }
        tv.scene.add(group);
        // Framing: the head, the face, the feet, the back, the whole body, or a creature from its side.
        const h = result.bodyHeight || result.height, cam = tv.camera;
        let target, distance, yaw = 0.45, pitch = 0.05;
        const size = box.getSize(new THREE.Vector3());
        if (frame === 'head') { target = new THREE.Vector3(0, h * 0.92, 0); distance = h * 0.36; }
        else if (frame === 'face') { target = new THREE.Vector3(0, h * 0.935, 0.02); distance = h * 0.2; yaw = 0.25; }
        else if (frame === 'feet') { target = new THREE.Vector3(0, h * 0.12, 0); distance = h * 0.5; pitch = 0.25; }
        else if (frame === 'back') { target = new THREE.Vector3(0, h * 0.6, 0); distance = h * 1.7; yaw = Math.PI - 0.6; }
        else if (frame === 'side') { target = box.getCenter(new THREE.Vector3()); distance = Math.max(size.x, size.y, size.z) * 1.9; yaw = 1.0; pitch = 0.15; }
        else { target = new THREE.Vector3(0, h * 0.52, 0); distance = Math.max(h, size.x) * 2.15; }
        cam.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * distance, target.y + Math.sin(pitch) * distance, target.z + Math.cos(yaw) * Math.cos(pitch) * distance);
        cam.lookAt(target);
        tv.renderer.render(tv.scene, cam);
        const url = tv.canvas.toDataURL('image/webp', 0.85);
        tv.scene.remove(group);
        for (const m of made) { m.geometry.dispose(); m.material.dispose(); }
        for (const t of textures.values()) t.dispose();
        return url;
    }

    // ── randomize ──────────────────────────────────────────────────────────
    _randomize() {
        const seed = (Math.random() * 4294967296) >>> 0;
        const r = JSON.parse(JSON.stringify(this.recipe));
        if (!this.human) {
            if (this.randomScope === 'colors') { const n = RRCreatureBody.randomRecipe(seed, r.kind); r.colors = n.colors; r.pattern = n.pattern; }
            else Object.assign(r, RRCreatureBody.randomRecipe(seed, r.kind), { plan: 'quadruped' });
            this._replace(r);
            return;
        }
        const roll = RRCharacterModel.random(seed, { species: r.species });
        const faceSections = new Set(['Head and neck', 'Head shape', 'Forehead and brows', 'Eyes', 'Nose', 'Mouth and jaw', 'Ears']);
        switch (this.randomScope) {
            case 'body':
                for (const k of ['gender', 'age', 'height', 'weight', 'muscle', 'cup', 'firmness']) r[k] = roll[k];
                for (const s of RRHumanBody.SLIDERS) if (!faceSections.has(s.section)) r.shapes[s.key] = roll.shapes[s.key];
                break;
            case 'face':
                for (const s of RRHumanBody.SLIDERS) if (faceSections.has(s.section)) r.shapes[s.key] = roll.shapes[s.key];
                r.ancestry = roll.ancestry;
                break;
            case 'hair': r.hair = RRCharacterHair.randomHair(seed, { gender: r.gender > 0.5 ? 'male' : 'female' }); break;
            case 'outfit': r.outfit = roll.outfit; r.props = roll.props; break;
            case 'colors':
                if (r.species === 'human') r.skin = roll.skin;
                r.eyes = Object.assign({}, r.eyes, { color: roll.eyes.color });
                r.hair = Object.assign({}, r.hair, { color: roll.hair.color, tipColor: roll.hair.tipColor });
                r.outfit = r.outfit.map((item, k) => Object.assign({}, item, roll.outfit[k % Math.max(1, roll.outfit.length)] ? { color: roll.outfit[k % roll.outfit.length].color } : {}));
                break;
            default: Object.assign(r, roll, { anatomy: r.anatomy });
        }
        this._replace(r);
    }

    _status(text, kind) {
        const el = this.root && this.root.querySelector('.rr-c3d-status');
        if (!el) return;
        el.textContent = text || '';
        el.dataset.kind = kind || '';
    }

    // ── 3D view ────────────────────────────────────────────────────────────
    async _start() {
        this._status(this._t('Loading…'));
        const ready = (window.THREE) || (this.projectController?.mapEditor3D?.ensureLibraries && await this.projectController.mapEditor3D.ensureLibraries());
        if (!ready || !window.THREE) { this._status(this._t('The 3D libraries could not be loaded.'), 'error'); return; }
        try {
            this.pack = this.pack || await RRHumanBody.loadPack();
            this.eyeSource = this.eyeSource || await this._loadEyeSource();
        } catch (error) {
            console.error('[Character3DBuilder] body pack', error);
            this._status(this._t('The body data could not be loaded.'), 'error');
            return;
        }
        if (!this.root || !this.root.querySelector('.rr-c3d-canvas')) return;
        this._makeView();
        this._rebuild();
        this._status('');
    }

    /** MakeHuman's eye picture as RGBA, at 512 (the eyes are small on screen and in a file). */
    _loadEyeSource() {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const size = 512, c = document.createElement('canvas');
                c.width = c.height = size;
                const g = c.getContext('2d');
                g.drawImage(img, 0, 0, size, size);
                resolve({ width: size, height: size, data: new Uint8Array(g.getImageData(0, 0, size, size).data.buffer) });
            };
            img.onerror = () => resolve(null);
            img.src = RRHumanBody.DATA_PATH + '/eye-brown.png';
        });
    }

    _makeView() {
        this.detach();
        const canvas = this.root.querySelector('.rr-c3d-canvas');
        const host = canvas.parentElement;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        // A weak GPU (integrated, software) draws simpler materials at one pixel per pixel, the Idle at 30 a second.
        this._weak = Character3DBuilder.weakGpu(renderer);
        renderer.setPixelRatio(this._weak ? 1 : Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        // A photographer's studio: filmic tone, a softbox environment, a warm key with soft shadows, a cool rim.
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        scene.environment = this._studio(renderer);
        scene.environmentIntensity = 0.8;
        const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
        scene.add(new THREE.HemisphereLight(0xfff4e8, 0x3a3430, 0.4));
        // The key a little softer than the room, so its shadows shade rather than black out.
        const key = new THREE.DirectionalLight(0xfff0e0, this._weak ? 2.4 : 2.0);
        key.position.set(1.6, 3.2, 2.4);
        scene.add(key, key.target);
        // Soft shadows from the key (the nose on the cheek, the brow over the eyes, the jaw on the neck)
        // where the GPU can afford them; the box they cover follows the character.
        if (!this._weak) {
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            key.castShadow = true;
            key.shadow.mapSize.set(2048, 2048);
            key.shadow.bias = -0.0003;
            key.shadow.normalBias = 0.012;
        }
        const fill = new THREE.DirectionalLight(0xdce8ff, 0.5);
        fill.position.set(-2.5, 1.4, 1.6);
        scene.add(fill);
        const rim = new THREE.DirectionalLight(0xdfe6f2, 1.3);
        rim.position.set(-1.2, 2.4, -2.8);
        scene.add(rim);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: 0x34373e, roughness: 0.95 }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
        // A soft contact shadow under the feet: a blurred disc, nearly free where a shadow map is not.
        const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ map: Character3DBuilder.blobTexture(), transparent: true, depthWrite: false, opacity: 0.75 }));
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 0.002;
        scene.add(blob);
        const group = new THREE.Group();
        scene.add(group);
        const view = this._view = { renderer, scene, camera, floor, blob, group, key, meshes: [], bones: [], textures: new Map(), yaw: 0.35, pitch: 0.08, distance: 4.2, target: new THREE.Vector3(0, 0.9, 0), frame: 0, loop: 0, clock: new THREE.Clock() };

        const size = () => {
            const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            this._draw();
        };
        view.resize = new ResizeObserver(size);
        view.resize.observe(host);
        size();

        let drag = null;
        canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; canvas.setPointerCapture(e.pointerId); });
        canvas.addEventListener('pointermove', e => {
            if (!drag) return;
            view.yaw = drag.yaw - (e.clientX - drag.x) * 0.01;
            view.pitch = Math.max(-0.6, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.006));
            this._draw();
        });
        const end = () => { drag = null; };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const h = view.height || 1.7;
            view.distance = Math.max(0.25 * h + 0.2, Math.min(h * 6 + 2, view.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
            this._aim();
            this._draw();
        }, { passive: false });
    }

    _frame(which) {
        const view = this._view;
        if (!view) return;
        const h = view.bodyHeight || view.height || 1.7;
        // The whole body by its largest extent: a creature is longer than it is tall, and seen from its side.
        view.distance = which === 'face' ? Math.max(0.5, h * 0.42) : Math.max(1.2, (view.extent || view.height || h) * 2.4 + 0.2);
        if (which !== 'face' && !this.human) view.yaw = 1.0;
        this._aim();
        this._draw();
    }

    _aim() {
        const view = this._view;
        if (!view) return;
        const h = view.height || 1.7, body = view.bodyHeight || h;
        // Closer in, the view rises to the face (a creature's head is at its front, low).
        const near = Math.max(0, Math.min(1, (h * 1.9 - view.distance) / (h * 1.4)));
        if (this.human) view.target.set(0, h * 0.52 + (body * 0.93 - h * 0.52) * near, 0);
        else view.target.set(0, h * 0.5, (view.depth || 0) * near * 0.4);
    }

    _draw() {
        const view = this._view;
        if (!view || view.frame) return;
        view.frame = requestAnimationFrame(() => { view.frame = 0; this._render(); });
    }

    _render() {
        const view = this._view;
        if (!view) return;
        const c = view.camera, t = view.target;
        c.position.set(t.x + Math.sin(view.yaw) * Math.cos(view.pitch) * view.distance, t.y + Math.sin(view.pitch) * view.distance, t.z + Math.cos(view.yaw) * Math.cos(view.pitch) * view.distance);
        c.lookAt(t);
        view.renderer.render(view.scene, c);
    }

    /**
     * The chosen pose plays (Idle or one of RRCharacterPoses, a creature has
     * Idle only); A-pose stands still, and the view draws only when asked.
     */
    _syncPose() {
        const view = this._view;
        if (!this.root) return;
        const human = !view || view.plan !== 'quadruped';
        if (!human && this.pose !== 'apose' && this.pose !== 'idle') this.pose = 'idle';
        this.root.querySelectorAll('.rr-c3d-pose').forEach(b => {
            b.classList.toggle('is-active', b.dataset.pose === this.pose);
            b.hidden = !human && b.dataset.pose !== 'apose' && b.dataset.pose !== 'idle';
        });
        if (!view) return;
        cancelAnimationFrame(view.loop);
        view.loop = 0;
        const time = view.action ? view.action.time : (view.resumeAt || 0);
        if (view.action) view.action.stop();
        for (const b of view.bones) { b.position.copy(b.userData.rest.p); b.quaternion.identity(); }
        view.group.position.y = 0;
        view.action = this.pose === 'apose' ? null : this._poseAction(this.pose);
        view.poseMeta = view.action ? view.actions.get(this.pose).meta : null;
        if (view.action) { view.action.time = time % (view.action.getClip().duration || 1); view.action.play(); }
        if (view.action && view.mixer) {
            view.clock.getDelta();
            let carried = 0;
            const tick = () => {
                view.loop = requestAnimationFrame(tick);
                const dt = Math.min(0.1, view.clock.getDelta());
                // A weak GPU draws every other frame, at 30 a second, the animation's time kept whole.
                carried += dt;
                if (this._weak && carried < 1 / 32) return;
                view.mixer.update(carried);
                carried = 0;
                this._plant();
                this._render();
            };
            view.loop = requestAnimationFrame(tick);
        } else this._draw();
    }

    /** A pose's action on this build's skeleton: Idle from the build, the others from RRCharacterPoses. */
    _poseAction(id) {
        const view = this._view;
        if (!view || !view.mixer || !view.bones.length) return null;
        if (view.actions.has(id)) return view.actions.get(id).action;
        const made = id === 'idle' ? view.idleClip : (view.plan === 'quadruped' ? null : RRCharacterPoses.clip(view.boneDefs, id));
        if (!made) return null;
        const tracks = made.tracks.map(t => new THREE.QuaternionKeyframeTrack(view.bones[t.bone].name + '.quaternion', Array.from(made.times), Array.from(t.values)));
        const action = view.mixer.clipAction(new THREE.AnimationClip(made.name || id, -1, tracks));
        view.actions.set(id, { action, meta: { plant: !!made.plant, lift: made.lift || null, skin: !!made.skin } });
        return action;
    }

    /** Where each joint stands at rest, for standing a pose on the floor; a new shape measures its skin again. */
    _restHeights(bones) {
        if (!this._view) return;
        this._view.boneRest = new Map(bones.map(b => [b.name, b.head[1]]));
        if (this._view.actions) for (const a of this._view.actions.values()) delete a.meta.skinFloor;
    }

    /**
     * Stands the pose on the floor: lowered or raised until the lowest of the
     * feet, knees, hips and seat is where it touches the floor (a foot at its
     * resting height, a knee or the seat a little above), then lifted by the
     * pose's own lift (a jump, a fall).
     */
    _plant() {
        const view = this._view, m = view && view.poseMeta;
        if (!view) return;
        view.group.position.y = 0;
        if (!m || (!m.plant && !m.lift)) return;
        let offset = 0;
        if (m.plant && view.boneRest) {
            const s = (view.bodyHeight || 1.7) / 1.7, at = new THREE.Vector3();
            const clear = { LeftLeg: 0.055 * s, RightLeg: 0.055 * s, LeftUpLeg: 0.09 * s, RightUpLeg: 0.09 * s, Hips: 0.1 * s };
            view.group.updateMatrixWorld(true);
            offset = -Infinity;
            for (const b of view.bones) {
                const c = clear[b.name] ?? (/^(Left|Right)(Foot|ToeBase)$/.test(b.name) ? view.boneRest.get(b.name) : undefined);
                if (c === undefined) continue;
                b.getWorldPosition(at);
                offset = Math.max(offset, c - at.y);
            }
            if (!Number.isFinite(offset)) offset = 0;
        }
        view.group.position.y = offset + (m.lift ? m.lift(view.action ? view.action.time : 0) : 0);
        // A pose lying, sitting or kneeling on the body itself: its lowest skin set on the floor, measured
        // once on the skinned body (a sample of its vertices) and kept while the shape stands.
        if (m.skin && view.meshes[0]) {
            if (m.skinFloor === undefined) {
                const mesh = view.meshes[0], at = new THREE.Vector3(), count = mesh.geometry.getAttribute('position').count;
                view.group.updateMatrixWorld(true);
                let low = Infinity;
                for (let i = 0; i < count; i += 7) { mesh.getVertexPosition(i, at); at.applyMatrix4(mesh.matrixWorld); low = Math.min(low, at.y); }
                m.skinFloor = Number.isFinite(low) ? -low : 0;
            }
            view.group.position.y += m.skinFloor;
        }
    }

    /**
     * The drag's fast path: only the body is shaped again (its targets and
     * swellings, a few milliseconds), and every other vertex (clothes, hair,
     * eyes, accessories, features) moves with the skin vertex under it, the
     * skeleton with the body's joints. No garment is cut, no hair grown, no
     * picture painted; the whole character is built once the slider rests.
     */
    _fastShape() {
        const view = this._view, result = this._result, pack = this.pack;
        if (!view || !result || result.plan !== 'human' || !result.built || !view.meshes.length || view.meshes.length !== result.parts.length) return false;
        if (!this._fast || this._fast.result !== result) this._fast = this._fastStart(result);
        const F = this._fast;
        const shaped = RRHumanBody.shape(pack, this.recipe);
        let floor = Infinity;
        for (const v of pack.body.source) floor = Math.min(floor, shaped[v * 3 + 1]);
        const lift = F.floor - floor;
        result.parts.forEach((part, k) => {
            const map = F.maps[k], base = F.bases[k], g = view.meshes[k].geometry, pos = g.getAttribute('position'), a = pos.array;
            for (let i = 0; i < map.length; i++) {
                const v = map[i] * 3;
                a[i * 3] = base[i * 3] + shaped[v] - F.shaped[v];
                a[i * 3 + 1] = base[i * 3 + 1] + shaped[v + 1] - F.shaped[v + 1] + lift;
                a[i * 3 + 2] = base[i * 3 + 2] + shaped[v + 2] - F.shaped[v + 2];
            }
            pos.needsUpdate = true;
            if (k === 0) {
                g.getAttribute('normal').array.set(RRHumanBody.normals(shaped, pack.body.source, pack.body.index, pack.vertexCount));
                g.getAttribute('normal').needsUpdate = true;
            }
        });
        // The skeleton: each joint by how far the body's own joint moved, bound again standing on the
        // floor, then the pose playing taken up again where it was (stopping it would start it over).
        const joints = RRHumanBody.joints(pack, shaped);
        view.group.position.y = 0;
        const heads = result.bones.map((b, i) => {
            const j = i < joints.length ? joints[i].head : null, o = i < F.joints.length ? F.joints[i] : null;
            const hip = joints[0].head, hip0 = F.joints[0];
            const d = j && o ? [j[0] - o[0], j[1] - o[1], j[2] - o[2]] : [hip[0] - hip0[0], hip[1] - hip0[1], hip[2] - hip0[2]];
            return [b.head[0] + d[0], b.head[1] + d[1] + lift, b.head[2] + d[2]];
        });
        result.bones.forEach((b, i) => {
            const parent = b.parent >= 0 ? heads[b.parent] : [0, 0, 0];
            view.bones[i].position.set(heads[i][0] - parent[0], heads[i][1] - parent[1], heads[i][2] - parent[2]);
            view.bones[i].quaternion.identity();
        });
        view.group.updateMatrixWorld(true);
        view.skeleton.calculateInverses();
        if (view.actions) for (const a of view.actions.values()) delete a.meta.skinFloor;
        this._resumePose();
        this._lastChange = Date.now();
        this._draw();
        return true;
    }

    /** What the fast path moves by: each part vertex's skin vertex, and where everything stood. */
    _fastStart(result) {
        const pack = this.pack, built = result.built, P = built.shaped;
        const body = [...new Set(pack.body.source)];
        const cell = 0.03, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
        for (const v of body) {
            const k = key(Math.floor(P[v * 3] / cell), Math.floor(P[v * 3 + 1] / cell), Math.floor(P[v * 3 + 2] / cell));
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(v);
        }
        // The model may stand higher than the body (boots): every part's own lift off the body.
        let floorModel = Infinity, floorBody = Infinity;
        for (const p of result.parts) for (let i = 1; i < p.positions.length; i += 3) floorModel = Math.min(floorModel, p.positions[i]);
        for (const v of pack.body.source) floorBody = Math.min(floorBody, P[v * 3 + 1]);
        const shift = Math.max(0, -floorModel);
        const nearest = (x, y, z) => {
            const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
            let best = body[0], bd = Infinity;
            for (let r = 1; r <= 6; r++) {
                for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
                    if (Math.max(Math.abs(i), Math.abs(j), Math.abs(k)) !== r && r > 1) continue;
                    for (const u of grid.get(key(cx + i, cy + j, cz + k)) || []) {
                        const d = (P[u * 3] - x) ** 2 + (P[u * 3 + 1] - y) ** 2 + (P[u * 3 + 2] - z) ** 2;
                        if (d < bd) { bd = d; best = u; }
                    }
                }
                if (bd < Infinity) break;
            }
            return best;
        };
        const maps = result.parts.map((part, k) => {
            const n = part.positions.length / 3;
            if (k === 0) return Int32Array.from(pack.body.source);
            if (part.name === 'Genitals') return Int32Array.from(pack.helpers.genital.source);
            // Parts that know the skin vertex each of theirs rides on (areolas, body hair).
            if (part.source && part.source.length === n) return Int32Array.from(part.source);
            const m = new Int32Array(n);
            for (let i = 0; i < n; i++) m[i] = nearest(part.positions[i * 3], part.positions[i * 3 + 1] - shift, part.positions[i * 3 + 2]);
            return m;
        });
        return {
            result, maps, shaped: Float32Array.from(P), floor: floorBody,
            bases: result.parts.map(p => Float32Array.from(p.positions)),
            joints: RRHumanBody.joints(pack, P).map(j => j.head.slice())
        };
    }

    _queueRebuild() {
        this._lastChange = Date.now();
        if (this._pending) return;
        this._pending = requestAnimationFrame(() => { this._pending = 0; this._rebuild(); });
    }

    _rebuild() {
        const view = this._view;
        if (!view || !this.pack) return;
        let result;
        try {
            result = RRCharacterModel.build(this.pack, this.recipe, this.cache, { quality: 'preview', eyeSource: this.eyeSource, paintSkin: (key, args) => this._paintSkin(key, args), hairBudget: this._weak ? 0.45 : 1 });
        } catch (error) {
            console.error('[Character3DBuilder] build', error);
            this._status(this._t('This character could not be built.'), 'error');
            return;
        }
        this._result = result;
        this._show(result);
        this._queueShading();
        const readout = this.root.querySelector('.rr-c3d-readout');
        if (readout) {
            const tris = result.parts.reduce((s, p) => s + p.index.length / 3, 0);
            readout.textContent = this._t('Height {m} m', { m: result.height.toFixed(2) }) + ' · ' + this._t('{n} triangles', { n: Math.round(tris).toLocaleString() });
        }
    }

    /** New pictures into the materials that show them, in place: nothing else is made again. */
    _swapTextures(result) {
        const view = this._view;
        for (const [name, tex] of Object.entries(result.textures || {})) {
            const kept = view.textures.get(name);
            if (!kept || kept.data === tex.data) continue;
            const old = kept.texture;
            if (old.image.width === tex.width && old.image.height === tex.height) {
                old.image.data = tex.data;
                old.needsUpdate = true;
                kept.data = tex.data;
                continue;
            }
            view.textures.delete(name);
            const fresh = this._texture(name, tex);
            for (const m of view.meshes) {
                if (m.material.map === old) { m.material.map = fresh; m.material.needsUpdate = true; }
                if (m.material.sheenColorMap === old) { m.material.sheenColorMap = fresh; m.material.needsUpdate = true; }
            }
            old.dispose();
        }
        // The painted skin is in: no tint stands in for it any more.
        const body = view.meshes[0];
        if (body && body.material.userData.tinted && this.cache.skinKey !== body.material.userData.tintFrom) {
            body.material.color.set(0xffffff); body.material.userData.tinted = false;
        }
    }

    /** Whether the pictures a build shows are the ones the meshes already carry. */
    _sameTextures(result) {
        const view = this._view;
        for (const [name, tex] of Object.entries(result.textures || {})) {
            const kept = view.textures.get(name);
            if (!kept || kept.data !== tex.data) return false;
        }
        return true;
    }

    _clearModel() {
        const view = this._view;
        if (!view) return;
        if (view.mixer) { view.mixer.stopAllAction(); view.mixer.uncacheRoot(view.group); }
        for (const m of view.meshes) { m.geometry.dispose(); m.material.dispose(); view.group.remove(m); }
        for (const b of view.bones) if (b.parent === view.group) view.group.remove(b);
        if (view.skeleton) view.skeleton.dispose();
        view.meshes = []; view.bones = []; view.skeleton = null; view.mixer = null; view.action = null;
        view.group.position.y = 0;
        view.structure = null;
    }

    _texture(name, tex) {
        const view = this._view;
        const kept = view.textures.get(name);
        if (kept && kept.data === tex.data) return kept.texture;
        if (kept) kept.texture.dispose();
        const t = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat);
        t.colorSpace = THREE.SRGBColorSpace;
        t.flipY = false;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        t.needsUpdate = true;
        view.textures.set(name, { data: tex.data, texture: t });
        return t;
    }

    /** A small studio, filtered into an environment light: two softboxes, a floor bounce, dark walls. */
    _studio(renderer) {
        const room = new THREE.Scene();
        const box = (w, h, d, color, x, y, z, intensity) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.BackSide }));
            m.position.set(x, y, z);
            room.add(m);
            return m;
        };
        box(14, 8, 14, '#2a2c32', 0, 3, 0, 1);
        const soft = (w, h, x, y, z, intensity, color) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
            m.position.set(x, y, z);
            m.lookAt(0, 1, 0);
            room.add(m);
        };
        soft(3, 2, 3, 4, 4, 9, '#fff2e4');
        soft(2, 3, -4, 2.5, 2, 3.5, '#dfe8ff');
        soft(4, 1, -1, 3, -5, 6, '#e8eeff');
        soft(8, 8, 0, -0.9, 0, 0.6, '#8a7a6a');
        const pmrem = new THREE.PMREMGenerator(renderer);
        const target = pmrem.fromScene(room, 0.03);
        pmrem.dispose();
        room.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        (this._envTargets = this._envTargets || []).push(target);
        return target.texture;
    }

    /** The view's material for a part, by what it is: skin with a warm sheen, cloth, metal, hair, wet eyes, glass. */
    _material(part, result, textureFor, scene) {
        const tex = part.texture && result.textures[part.texture];
        const opaque = !(part.opacity != null && part.opacity < 1);
        const kind = part.kind || (part.metalness > 0.5 ? 'metal' : 'prop');
        const m = new (this._weak ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial)({
            color: tex || part.colors ? 0xffffff : new THREE.Color(part.color || '#bbbbbb'),
            map: tex ? (textureFor ? textureFor(part.texture, tex) : this._texture(part.texture, tex)) : null,
            vertexColors: !!part.colors,
            roughness: part.roughness ?? 0.6, metalness: part.metalness ?? 0,
            side: part.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: !opaque, opacity: part.opacity ?? 1,
            alphaTest: part.cutout ? (part.alphaCutoff ?? 0.5) : 0, depthWrite: opaque
        });
        // Cut-out strands (hair, lashes, fur) get soft edges from the antialiasing itself.
        if (part.cutout && kind === 'hair') { m.alphaToCoverage = true; m.alphaTest = Math.min(m.alphaTest, 0.3); }
        // Hair: matte, warm, hardly a reflection of the room.
        if (kind === 'hair') { m.roughness = 0.78; m.metalness = 0; m.envMapIntensity = 0.55; }
        // Body hair and fur take the room's light as the skin under them does, so hair of the skin's tint
        // matches it instead of showing as dark specks.
        // Their hairs are finer than a pixel from afar: a low cut keeps them as the picture shrinks.
        if (kind === 'hair' && part.onSkin) { m.envMapIntensity = 0.85; if (part.cutout) m.alphaTest = 0.12; }
        // three gives every material the scene's own environment strength unless the material holds the map
        // itself: a part reflecting more or less of the room than the rest holds it.
        const ownRoom = () => {
            if (part.envMapIntensity != null) m.envMapIntensity = part.envMapIntensity;
            if (scene && scene.environment && m.envMapIntensity !== 1) { m.envMap = scene.environment; m.envMapIntensity *= scene.environmentIntensity; }
            return m;
        };
        if (this._weak) { if (kind === 'eye' || kind === 'glass') m.roughness = 0.08; return ownRoom(); }
        // Skin: a soft sheen in the skin's own color (from its picture), so it warms skin and stays dark on a
        // painted scalp, stubble or markings.
        if (kind === 'skin') {
            m.roughness = 0.52; m.sheen = 0.3; m.sheenRoughness = 0.55; m.sheenColor = new THREE.Color(0.9, 0.7, 0.62); if (m.map) m.sheenColorMap = m.map; m.specularIntensity = 0.4;
            // Pores and fine lines, tiled small over the skin: the light breaks up on it as on real skin.
            if (m.map) { m.normalMap = Character3DBuilder.skinDetail(); m.normalScale = new THREE.Vector2(0.3, 0.3); }
        }
        // Cloth: a soft sheen in the cloth's own color at grazing angles (from its picture), so it reads as fabric
        // without a white film washing its color out.
        else if (kind === 'cloth') { m.sheen = 0.3; m.sheenRoughness = 0.85; m.sheenColor = new THREE.Color(0.8, 0.8, 0.8); if (m.map) m.sheenColorMap = m.map; m.roughness = Math.max(m.roughness, 0.8); m.specularIntensity = 0.12; }
        else if (kind === 'metal') { m.metalness = Math.max(0.85, m.metalness); m.roughness = Math.min(0.4, m.roughness); m.clearcoat = 0.3; }
        // Hair: matte, its soft highlight in its own color; no sheen and no anisotropic band, which both
        // read as grey panels over dark hair.
        else if (kind === 'hair') {
            m.sheen = 0; m.specularIntensity = 0.2;
            const own = part.colors ? new THREE.Color(part.colors[0], part.colors[1], part.colors[2]) : new THREE.Color(0x444444);
            m.specularColor = own.clone().lerp(new THREE.Color(0xffffff), 0.35);
        }
        else if (kind === 'eye') { m.roughness = 0.08; m.clearcoat = 1; m.clearcoatRoughness = 0.03; }
        else if (kind === 'glass') { m.roughness = 0.02; m.metalness = 0; m.clearcoat = 1; m.envMapIntensity = 2; }
        // A part may hold how much of the room it reflects (a grey's black lenses, the floor kept out of them).
        return ownRoom();
    }

    /** The build in the view: a skeleton from its bones, a skinned mesh per part, its Idle ready to play. */
    /** What the meshes in the view are made of: the same structure can be updated in place. */
    _structure(result) {
        return result.plan + '|' + result.bones.length + '|' + result.parts.map(p => [p.name, p.positions.length, p.index.length, p.texture || '', p.kind || '', p.doubleSided ? 1 : 0, p.opacity ?? 1].join(':')).join(';');
    }

    /**
     * A slider moved and nothing was added or taken away: the same meshes take
     * the new positions and normals, the skeleton its new joints. No buffers,
     * materials or programs are made, so dragging stays smooth.
     */
    _update(result) {
        const view = this._view;
        view.group.position.y = 0;
        result.bones.forEach((b, i) => {
            const parent = b.parent >= 0 ? result.bones[b.parent].head : [0, 0, 0];
            const bone = view.bones[i];
            bone.position.set(b.head[0] - parent[0], b.head[1] - parent[1], b.head[2] - parent[2]);
            bone.quaternion.identity();
            bone.userData.rest.p.copy(bone.position);
        });
        view.group.updateMatrixWorld(true);
        view.skeleton.calculateInverses();
        result.parts.forEach((part, k) => {
            const g = view.meshes[k].geometry;
            g.getAttribute('position').array.set(part.positions); g.getAttribute('position').needsUpdate = true;
            g.getAttribute('normal').array.set(part.normals); g.getAttribute('normal').needsUpdate = true;
            const c = g.getAttribute('color');
            // Shading worked out for the last shape stays until this one's comes: it hardly differs.
            if (c && part.colors && part.colors.length === c.array.length && !part.texture) { c.array.set(part.colors); c.needsUpdate = true; }
            g.computeBoundingSphere();
        });
        this._restHeights(result.bones);
        const box = new THREE.Box3().setFromObject(view.group);
        view.height = Math.max(0.2, result.height);
        view.bodyHeight = result.bodyHeight || result.height;
        view.depth = box.max.z;
        view.extent = Math.max(view.height, box.max.x - box.min.x, box.max.z - box.min.z);
        view.blob.scale.set(Math.max(0.25, (box.max.x - box.min.x) * 0.55), Math.max(0.25, (box.max.z - box.min.z) * 0.75 + 0.08), 1);
        this._resumePose();
        this._aim();
        this._draw();
    }

    /** The pose playing laid on the skeleton at its current time and stood on the floor, before a draw. */
    _resumePose() {
        const view = this._view;
        if (!view || !view.action || !view.mixer) return;
        view.mixer.update(0);
        this._plant();
    }

    _show(result) {
        const view = this._view;
        // The same structure as what is shown: moved in place.
        const structure = this._structure(result);
        if (view.structure === structure && view.meshes.length) { this._swapTextures(result); this._update(result); return; }
        view.structure = structure;
        const time = view.action ? view.action.time : 0;
        this._clearModel();
        const bones = result.bones.map(b => { const bone = new THREE.Bone(); bone.name = b.name; return bone; });
        result.bones.forEach((b, i) => {
            const parent = b.parent >= 0 ? result.bones[b.parent].head : [0, 0, 0];
            bones[i].position.set(b.head[0] - parent[0], b.head[1] - parent[1], b.head[2] - parent[2]);
            bones[i].userData.rest = { p: bones[i].position.clone() };
            if (b.parent >= 0) bones[b.parent].add(bones[i]); else view.group.add(bones[i]);
        });
        view.group.updateMatrixWorld(true);
        const skeleton = new THREE.Skeleton(bones);
        for (const part of result.parts) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(part.positions), 3));
            g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(part.normals), 3));
            if (part.uvs) g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(part.uvs), 2));
            if (part.colors) g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(part.colors), 3));
            // The strand's direction, for highlights that run along the hair.
            if (part.tangents && part.tangents.length === part.positions.length) {
                const t4 = new Float32Array(part.positions.length / 3 * 4);
                for (let i = 0; i < t4.length / 4; i++) { t4[i * 4] = part.tangents[i * 3]; t4[i * 4 + 1] = part.tangents[i * 3 + 1]; t4[i * 4 + 2] = part.tangents[i * 3 + 2]; t4[i * 4 + 3] = 1; }
                g.setAttribute('tangent', new THREE.BufferAttribute(t4, 4));
            }
            g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(part.joints), 4));
            g.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(part.weights), 4));
            g.setIndex(new THREE.BufferAttribute(Uint32Array.from(part.index), 1));
            const mesh = new THREE.SkinnedMesh(g, this._material(part, result, null, view.scene));
            mesh.frustumCulled = false;
            // Hair finer than the shadow's own texels (body hair, brows, lashes) casts none.
            mesh.castShadow = !part.onSkin && part.name !== 'Lashes';
            mesh.receiveShadow = true;
            mesh.bind(skeleton);
            view.group.add(mesh);
            view.meshes.push(mesh);
        }
        view.bones = bones;
        view.skeleton = skeleton;
        // The poses' clips are made when first chosen (_poseAction); the one playing carries on from its time.
        view.mixer = new THREE.AnimationMixer(view.group);
        view.idleClip = (result.clips && result.clips[0]) || null;
        view.boneDefs = result.bones;
        view.actions = new Map();
        view.resumeAt = time;
        this._restHeights(result.bones);
        // Frame what was built: its height, and for a creature its length.
        const box = new THREE.Box3().setFromObject(view.group);
        // A new body plan, or a body far bigger or smaller than the last, is framed afresh.
        const firstFrame = !view.height || view.plan !== result.plan || Math.abs(Math.log(Math.max(0.2, result.height) / view.height)) > 0.35;
        view.plan = result.plan;
        view.height = Math.max(0.2, result.height);
        view.bodyHeight = result.bodyHeight || result.height;
        view.depth = box.max.z;
        view.extent = Math.max(view.height, box.max.x - box.min.x, box.max.z - box.min.z);
        view.floor.scale.setScalar(Math.max(0.7, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.75));
        if (firstFrame) this._frame('body');
        if (view.key.castShadow) {
            const c = view.key.shadow.camera, r = view.extent * 0.75 + 0.2, mid = new THREE.Vector3(0, view.height / 2, 0);
            view.key.target.position.copy(mid);
            view.key.position.copy(mid).add(new THREE.Vector3(1.6, 3.2, 2.4).normalize().multiplyScalar(r * 3));
            c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 0.1; c.far = r * 6;
            c.updateProjectionMatrix();
        }
        // The contact shadow as wide as what stands on it.
        view.blob.scale.set(Math.max(0.25, (box.max.x - box.min.x) * 0.55), Math.max(0.25, (box.max.z - box.min.z) * 0.75 + 0.08), 1);
        view.blob.position.x = (box.max.x + box.min.x) / 2; view.blob.position.z = (box.max.z + box.min.z) / 2;
        this._aim();
        this._syncPose();
    }

    /**
     * Shading (occlusion baked into the colors) waits until the sliders rest:
     * a fraction of a second, too long for every frame of a drag.
     */
    _queueShading() {
        clearTimeout(this._shadeTimer);
        this._shadeTimer = setTimeout(() => {
            const result = this._result, view = this._view;
            if (!result || !view || result.shaded) return;
            const apply = ao => {
                if (this._result !== result || !this._view) return;
                result.parts.forEach((p, k) => { if (p.kind === 'eye' || p.name === 'Eyes') delete ao[k]; });
                const shaded = RRCharacterShading.applyOcclusion(result.parts, ao);
                shaded.forEach((part, k) => {
                    result.parts[k] = part;
                    const mesh = view.meshes[k];
                    if (!mesh || !part.colors) return;
                    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(part.colors), 3));
                    if (!mesh.material.vertexColors) { mesh.material.vertexColors = true; mesh.material.needsUpdate = true; }
                });
                result.shaded = true;
                this._draw();
            };
            // In a worker, so the page never stops while the shading is worked out.
            const worker = this._shadingWorker();
            if (!worker) { apply(RRCharacterShading.ambientOcclusion(result.parts)); return; }
            const id = (this._shadeJob = (this._shadeJob || 0) + 1);
            const parts = result.parts.map(p => (p.noShade ? { positions: new Float32Array(0), normals: new Float32Array(0), index: new Uint32Array(0) } : { positions: Float32Array.from(p.positions), normals: Float32Array.from(p.normals), index: Uint32Array.from(p.index), doubleSided: !!p.doubleSided }));
            worker.onmessage = e => { if (e.data.id === id) apply(e.data.ao); };
            worker.postMessage({ id, parts });
        }, 300);
    }

    /** Tints the body's material from the skin it shows toward `hex`; false when there is nothing to tint. */
    _tintSkin(hex) {
        const view = this._view, mesh = view && view.meshes[0], painted = this._result && this._result.recipe.skin;
        if (!mesh || !painted || this.recipe.plan === 'quadruped') return false;
        const a = new THREE.Color(painted), b = new THREE.Color(hex);
        mesh.material.color.setRGB(Math.min(4, b.r / Math.max(0.02, a.r)), Math.min(4, b.g / Math.max(0.02, a.g)), Math.min(4, b.b / Math.max(0.02, a.b)));
        if (!mesh.material.userData.tinted) mesh.material.userData.tintFrom = this.cache.skinKey;
        mesh.material.userData.tinted = true;
        this._draw();
        return true;
    }

    /**
     * The skin is painted off the page: a picture is a second or more of work
     * at full size. Asked for a skin it has, the painter hands it over;
     * otherwise it starts on it (the latest asked for only) and the view is
     * built again when it is done.
     */
    _paintSkin(key, args) {
        const P = this._painter || (this._painter = { ready: new Map(), busy: null, next: null });
        if (P.ready.has(key)) return P.ready.get(key);
        const worker = this._skinWorker();
        if (!worker) return null;
        P.next = { key, args };
        this._pumpPainter();
        return null;
    }

    _pumpPainter() {
        const P = this._painter, worker = this._skinWorker();
        if (!P || P.busy || !P.next || !worker) return;
        const job = P.busy = P.next;
        P.next = null;
        worker.onmessage = e => {
            const { key, width, height, data } = e.data;
            P.busy = null;
            // Only the newest few are kept.
            P.ready.set(key, { width, height, data: new Uint8Array(data), name: 'skin.png' });
            while (P.ready.size > 4) P.ready.delete(P.ready.keys().next().value);
            if (P.next) this._pumpPainter();
            else this._queueRebuild();
        };
        worker.postMessage({ key: job.key, args: job.args });
    }

    /** One skin painted by a painter of its own, for Save (the view's painter keeps its queue). */
    _paintSkinNow(args) {
        return new Promise(resolve => {
            const keep = this._skinWorkerRef;
            this._skinWorkerRef = undefined;
            const worker = this._skinWorker();
            this._skinWorkerRef = keep;
            if (!worker) { resolve(null); return; }
            worker.onmessage = e => { resolve({ width: e.data.width, height: e.data.height, data: new Uint8Array(e.data.data), name: 'skin.png' }); worker.terminate(); };
            worker.onerror = () => { resolve(null); worker.terminate(); };
            worker.postMessage({ key: 'save', args });
        });
    }

    /** The skin painter: the body's own modules and data, loaded into a worker once. */
    _skinWorker() {
        if (this._skinWorkerRef !== undefined) return this._skinWorkerRef;
        try {
            const fs = require('fs'), path = require('path');
            const dir = path.join(RRHumanBody.dataFolder(), '..');
            const code = ['HumanTargets', 'HumanBody', 'CharacterOutfit', 'CharacterSkin'].map(f => fs.readFileSync(path.join(dir, f + '.js'), 'utf8')).join('\n;\n') + `
                let pack = null;
                self.onmessage = e => {
                    if (e.data.init) { pack = self.RRHumanBody.openPack(e.data.json, new Uint8Array(e.data.bin)); return; }
                    const a = e.data.args, t = self.RRCharacterSkin.paint(pack, a.skin, a.pattern, a.options);
                    self.postMessage({ key: e.data.key, width: t.width, height: t.height, data: t.data.buffer }, [t.data.buffer]);
                };`;
            const worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
            const data = RRHumanBody.dataFolder();
            const bin = fs.readFileSync(path.join(data, 'human.bin'));
            const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
            worker.postMessage({ init: true, json: JSON.parse(fs.readFileSync(path.join(data, 'human.json'), 'utf8')), bin: buffer }, [buffer]);
            this._skinWorkerRef = worker;
        } catch (error) {
            console.warn('[Character3DBuilder] skin painter', error);
            this._skinWorkerRef = null;
        }
        return this._skinWorkerRef;
    }

    /** The shading worker: CharacterShading.js itself, run off the page. */
    _shadingWorker() {
        if (this._worker !== undefined) return this._worker;
        try {
            const fs = require('fs'), path = require('path');
            const file = [path.join(RRHumanBody.dataFolder(), '..', 'CharacterShading.js')].find(f => fs.existsSync(f));
            const source = fs.readFileSync(file, 'utf8') + `
                self.onmessage = e => { const ao = self.RRCharacterShading.ambientOcclusion(e.data.parts); self.postMessage({ id: e.data.id, ao }); };`;
            this._worker = new Worker(URL.createObjectURL(new Blob([source.replace("typeof window !== 'undefined' ? window : globalThis", 'self')], { type: 'text/javascript' })));
        } catch (error) {
            console.warn('[Character3DBuilder] shading worker', error);
            this._worker = null;
        }
        return this._worker;
    }

    // ── files ──────────────────────────────────────────────────────────────
    _folderName(name) {
        return String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 48);
    }

    _charactersDir() {
        const project = this._project();
        return project ? require('path').join(project.path, '3d', 'Characters') : null;
    }

    _savedNames() {
        const fs = require('fs'), path = require('path');
        const dir = this._charactersDir();
        if (!dir || !fs.existsSync(dir)) return [];
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'character.json')))
            .map(e => e.name).sort((a, b) => a.localeCompare(b));
    }

    /** Saved characters as pictures to pick from. */
    _showGallery() {
        const fs = require('fs'), path = require('path');
        const box = this.root.querySelector('.rr-c3d-gallery');
        const names = this._savedNames();
        const cards = names.map(name => {
            const thumb = path.join(this._charactersDir(), name, 'thumbnail.png');
            const src = fs.existsSync(thumb) ? 'data:image/png;base64,' + fs.readFileSync(thumb).toString('base64') : '';
            return `<button class="rr-c3d-saved" data-name="${rrEscapeHtml(name)}">${src ? `<img src="${src}" alt="">` : '<span class="rr-c3d-nothumb">?</span>'}<span>${rrEscapeHtml(name)}</span></button>`;
        }).join('');
        box.innerHTML = `<div class="rr-c3d-gallery-head"><span>${this._t('Open a saved character')}</span><button class="rr-c3d-remove" data-close title="${this._t('Close')}">✕</button></div>
            <div class="rr-c3d-gallery-grid">${cards || `<p class="rr-c3d-note">${this._t('No characters saved in this project yet. Save to Project puts one here.')}</p>`}</div>`;
        box.hidden = false;
        const close = () => { box.hidden = true; document.removeEventListener('keydown', onKey, true); };
        const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
        document.addEventListener('keydown', onKey, true);
        box.onclick = e => {
            if (e.target.closest('[data-close]')) { close(); return; }
            const card = e.target.closest('.rr-c3d-saved');
            if (!card) return;
            close();
            this._openSaved(card.dataset.name);
        };
    }

    _openSaved(name) {
        const fs = require('fs'), path = require('path');
        try {
            const data = JSON.parse(fs.readFileSync(path.join(this._charactersDir(), name, 'character.json'), 'utf8'));
            this.name = name;
            const input = this.root.querySelector('.rr-c3d-name-input');
            if (input) input.value = name;
            const recipe = RRCharacterModel.normalize(data.recipe || data);
            // A recipe past the natural ranges opens with Extreme on, so its sliders reach its values.
            this.extreme = this.extreme || JSON.stringify(RRHumanBody.naturalRecipe ? RRHumanBody.naturalRecipe(recipe) : recipe) !== JSON.stringify(RRHumanBody.normalizeRecipe(recipe));
            this._replace(recipe);
            this._status(this._t('Opened {name}.', { name }), 'ok');
        } catch (error) {
            console.error('[Character3DBuilder] open', error);
            this._status(this._t('{name} could not be opened.', { name }), 'error');
        }
    }

    /** A picture as PNG bytes. */
    _png(tex) {
        const c = document.createElement('canvas');
        c.width = tex.width; c.height = tex.height;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tex.data.buffer.slice(tex.data.byteOffset, tex.data.byteOffset + tex.data.byteLength)), tex.width, tex.height), 0, 0);
        return new Promise((resolve, reject) => c.toBlob(b => (b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a)), reject) : reject(new Error('png'))), 'image/png'));
    }

    /** A square picture of the view as it stands now. */
    _thumbnail() {
        const view = this._view;
        if (!view) return null;
        this._render();
        const src = view.renderer.domElement, size = 256;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const s = Math.min(src.width, src.height);
        c.getContext('2d').drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
        return Buffer.from(c.toDataURL('image/png').split(',')[1], 'base64');
    }

    async save() {
        const project = this._project();
        if (!project || !this.pack) return;
        let name = this._folderName(this.name);
        if (!name) {
            name = this._folderName(await RRDialog.prompt(this._t('Name this character:'), { title: this._t('Save to Project'), value: this._t('Villager') }));
            if (!name) return;
            this.name = name;
            const input = this.root.querySelector('.rr-c3d-name-input');
            if (input) input.value = name;
        }
        const fs = require('fs'), path = require('path');
        const folder = path.join(this._charactersDir(), name);
        const file = path.join(folder, 'source', name + '.glb');
        if (fs.existsSync(file) && !await RRDialog.confirm(this._t('Replace the saved character {name}?', { name }), { title: this._t('Save to Project'), ok: this._t('Replace'), danger: true })) return;
        this._status(this._t('Saving…'));
        try {
            // The file at full quality: its own build, the outfit's picture shared with the view's.
            // The full-size skin painted off the page first, then the file built with it.
            let wanted = null;
            const probe = { wardrobe: this.cache.wardrobe };
            RRCharacterModel.build(this.pack, this.recipe, probe, { quality: 'save', eyeSource: this.eyeSource, paintSkin: (key, args) => { wanted = { key, args }; return null; } });
            const skin = wanted ? await this._paintSkinNow(wanted.args) : null;
            const result = RRCharacterModel.build(this.pack, this.recipe, { wardrobe: this.cache.wardrobe }, { quality: 'save', eyeSource: this.eyeSource, paintSkin: skin ? () => skin : undefined });
            const glb = await RRCharacterModel.toGlb(result, name, tex => this._png(tex));
            // Written whole or not at all: a save cut short leaves the last good file.
            const atomic = window.RRWriteFileAtomicSync || ((io, target, data) => io.writeFileSync(target, data));
            fs.mkdirSync(path.dirname(file), { recursive: true });
            atomic(fs, file, glb);
            atomic(fs, path.join(folder, 'character.json'), JSON.stringify({ builder: 'character3d', version: 2, recipe: this.recipe }, null, 2) + '\n');
            const thumb = this._thumbnail();
            if (thumb) atomic(fs, path.join(folder, 'thumbnail.png'), thumb);
            if (result.sidecar) {
                // A creature's rig goes in its model.json; what else the 3D Models page keeps there stays.
                const sidecarFile = path.join(folder, 'model.json');
                let kept = {};
                try { kept = JSON.parse(fs.readFileSync(sidecarFile, 'utf8')); } catch (_) { kept = {}; }
                atomic(fs, sidecarFile, JSON.stringify(Object.assign(kept, result.sidecar), null, 2) + '\n');
            }
            this._status(this._t('Saved to 3D Models › Characters/{name}.', { name }), 'ok');
            window.dispatchEvent(new CustomEvent('rr-models-changed', { detail: { name: 'Characters/' + name } }));
        } catch (error) {
            console.error('[Character3DBuilder] save', error);
            this._status(this._t('{name} could not be saved.', { name }), 'error');
        }
    }
}

/** Integrated and software GPUs, by the renderer's own name. */
Character3DBuilder.weakGpu = function(renderer) {
    try {
        const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        return /intel|llvmpipe|swiftshader|software|mali|adreno|apple gpu|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics|ryzen/i.test(name)
            && !/nvidia|geforce|rtx|radeon rx|radeon pro/i.test(name);
    } catch (error) { return false; }
};

/** A soft round shadow, dark in the middle, gone at the edge. */
Character3DBuilder.blobTexture = function() {
    if (Character3DBuilder._blob) return Character3DBuilder._blob;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)'); grad.addColorStop(0.5, 'rgba(0,0,0,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (Character3DBuilder._blob = t);
};

/**
 * Skin's fine detail as a tiling normal map: pores (small soft pits, a few
 * to a millimeter's spacing at the tiling the skin uses) over a faint grain.
 */
Character3DBuilder.skinDetail = function() {
    if (Character3DBuilder._skinDetail) return Character3DBuilder._skinDetail;
    const n = 256, h = new Float32Array(n * n);
    let seed = 7;
    const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    // The grain: a few octaves of value noise, wrapping at the edge so the tiles meet.
    for (const [cells, amp] of [[16, 0.35], [32, 0.25], [64, 0.15]]) {
        const g = Array.from({ length: cells * cells }, rand), at = (x, y) => g[((y + cells) % cells) * cells + (x + cells) % cells];
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            const fx = x / n * cells, fy = y / n * cells, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
            const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
            h[y * n + x] += amp * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
        }
    }
    // The pores.
    for (let k = 0; k < 900; k++) {
        const cx = rand() * n, cy = rand() * n, r = 1.2 + rand() * 1.6, depth = 0.5 + rand() * 0.5;
        for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
            const d = Math.hypot(x - cx, y - cy) / r;
            if (d < 1) h[((y + n) % n) * n + (x + n) % n] -= depth * (1 - d * d) ** 2;
        }
    }
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = h[y * n + (x + 1) % n] - h[y * n + (x + n - 1) % n], dy = h[((y + 1) % n) * n + x] - h[((y + n - 1) % n) * n + x];
        const l = Math.hypot(dx, dy, 0.5), o = (y * n + x) * 4;
        data[o] = Math.round((-dx / l * 0.5 + 0.5) * 255); data[o + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); data[o + 2] = Math.round((0.5 / l * 0.5 + 0.5) * 255); data[o + 3] = 255;
    }
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(40, 40);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return (Character3DBuilder._skinDetail = t);
};

/** Sliders that only reshape the body: the drag's fast path can follow them. */
Character3DBuilder.bodyPath = function(path) {
    return /^(shapes\.|morph\.|anatomy\.(length|girth|testicles|mons|labia|fold|nipple)$|gender$|age$|height$|weight$|muscle$|cup$|firmness$|proportions$|headSize$)/.test(path);
};

/** Bumped when the previews' look changes, so pictures kept on disk are drawn again. */
Character3DBuilder.PREVIEW_VERSION = 6;

if (typeof window !== 'undefined') window.Character3DBuilder = Character3DBuilder;

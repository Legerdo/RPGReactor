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
        this.more = {};
        this.pose = 'idle';
        this.randomScope = 'all';
        this._view = null;
        this._pending = 0;
        this._undo = [];
        this._redo = [];
        this._committed = JSON.stringify(this.recipe);
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
                        <div class="rr-c3d-viewbar">
                            <button class="rr-btn-chip rr-c3d-pose" data-pose="apose">${this._t('A-pose')}</button>
                            <button class="rr-btn-chip rr-c3d-pose" data-pose="idle">${this._t('Idle')}</button>
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
        panel.scrollTop = top;
        this._syncSliders();
    }

    // ── controls ───────────────────────────────────────────────────────────
    _section(label, more) {
        const toggle = more ? `<button class="rr-c3d-more" data-act="more" data-section="${rrEscapeHtml(more)}">${this.more[more] ? this._t('Fewer') : this._t('More')}</button>` : '';
        return `<div class="rr-c3d-section"><span>${this._t(label)}</span>${toggle}</div>`;
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
            <span class="rr-c3d-colorpick"><input type="color" class="rr-c3d-color" data-path="${path}" value="${v || '#808080'}"${v ? '' : ' data-empty="1"'}>${clear}</span></div>`;
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
            this._set(path, value);
            this._commit();
            this._renderPanel();
            this._queueRebuild();
            return;
        }
        if (el.type === 'color' && !committed && event.type === 'input') { this._set(path, value); this._queueRebuild(); return; }
        this._set(path, value);
        if (el.type === 'range') this._syncSliders();
        if (committed) this._commit();
        this._queueRebuild();
    }

    _onClick(event) {
        const b = event.target.closest('[data-act]');
        if (!b) return;
        event.preventDefault();
        const act = b.dataset.act, r = JSON.parse(JSON.stringify(this.recipe));
        if (act === 'more') { this.more[b.dataset.section] = !this.more[b.dataset.section]; this._renderPanel(); return; }
        if (act === 'extreme') { this.extreme = !this.extreme; this._renderPanel(); return; }
        if (act === 'plan') {
            if ((b.dataset.plan === 'quadruped') === !this.human) return;
            this._replace(b.dataset.plan === 'quadruped' ? Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe('dog')) : { plan: 'human' });
            return;
        }
        if (act === 'species') { this._replace(RRCharacterModel.withSpecies(this.recipe, b.dataset.id)); return; }
        if (act === 'kind') { this._replace(Object.assign({ plan: 'quadruped' }, RRCreatureBody.kindRecipe(b.dataset.id))); return; }
        if (act === 'swatch') { this._set(b.dataset.path, b.dataset.color); this._commit(); this._renderPanel(); this._queueRebuild(); return; }
        if (act === 'clear') { this._set(b.dataset.path, ''); this._commit(); this._renderPanel(); this._queueRebuild(); return; }
        if (act === 'dress') {
            const preset = RRCharacterWardrobe.PRESETS.find(p => p.id === b.dataset.id);
            if (preset) { r.outfit = JSON.parse(JSON.stringify(preset.items)); this._replace(r); }
            return;
        }
        if (act === 'remove-garment') { r.outfit = r.outfit.filter(i => i.id !== b.dataset.id); this._replace(r); return; }
        if (act === 'remove-prop') { r.props = r.props.filter(i => i.id !== b.dataset.id); this._replace(r); return; }
        if (act === 'add-garment' || act === 'add-prop') {
            const select = this.root.querySelector(act === 'add-garment' ? '.rr-c3d-add-garment' : '.rr-c3d-add-prop');
            const id = select && select.value;
            if (!id) return;
            if (act === 'add-garment') r.outfit = r.outfit.concat([{ id }]); else r.props = r.props.concat([{ id }]);
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
            const kinds = RRCreatureBody.KINDS.map(k => `<button class="rr-c3d-tile${k.kind === this.recipe.kind ? ' is-active' : ''}" data-act="kind" data-id="${k.kind}">${this._t(k.label || this._cap(k.kind))}</button>`).join('');
            const options = RRCreatureBody.OPTIONS.filter(o => o.key !== 'pattern').map(o => this._select(o.key, o.label, o.choices.map(c => [c.id, c.label]))).join('');
            return plan + this._section('Kind') + `<div class="rr-c3d-tiles">${kinds}</div>` + this._section('Features') + options;
        }
        const groups = [...new Set(RRCharacterSpecies.SPECIES.map(s => s.group))];
        const tiles = groups.map(g => `<div class="rr-c3d-subhead">${this._t(g)}</div><div class="rr-c3d-tiles">${RRCharacterSpecies.SPECIES.filter(s => s.group === g)
            .map(s => `<button class="rr-c3d-tile${s.id === this.recipe.species ? ' is-active' : ''}" data-act="species" data-id="${s.id}">${this._t(s.label)}</button>`).join('')}</div>`).join('');
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

    _extremeToggle() {
        return `<label class="rr-c3d-extreme"><input type="checkbox" data-act="extreme"${this.extreme ? ' checked' : ''}><span>${this._t('Extreme proportions')}</span></label>`;
    }

    _shapeSliders(sections) {
        return sections.map(section => {
            const list = RRHumanBody.SLIDERS.filter(s => s.section === section);
            const shown = this.more[section] ? list : list.filter(s => s.basic || Math.abs(this.recipe.shapes[s.key]) > 0.005);
            const hidden = list.length > shown.length || this.more[section];
            return this._section(section, hidden ? section : null) + shown.map(s => this._slider({
                path: `shapes.${s.key}`, label: s.label, natural: s.paired ? [-1, 1] : [0, 1], extreme: s.paired ? [-s.extreme, s.extreme] : [0, s.extreme], format: s.paired ? 'signed' : ''
            })).join('');
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
            { path: 'headSize', label: 'Head size', natural: [0.8, 1.25], extreme: [0.5, 2.2], format: 'x' },
            { path: 'cup', label: 'Bust', natural: M.cup.natural, extreme: M.cup.extreme },
            { path: 'firmness', label: 'Firmness', natural: M.firmness.natural, extreme: M.firmness.extreme }
        ];
        return this._extremeToggle() + this._section('Build') + macro.map(s => this._slider(s)).join('') + this._shapeSliders(['Proportions', 'Torso', 'Bust', 'Arms and legs']);
    }

    _faceTab() {
        const morph = [
            { path: 'morph.snout', label: 'Snout', natural: [0, 1], extreme: [0, 1.5] },
            { path: 'morph.muzzle', label: 'Muzzle narrow', natural: [0, 1] },
            { path: 'morph.flat', label: 'Flat face', natural: [0, 1] },
            { path: 'morph.earsAway', label: 'Hide ears', natural: [0, 1] }
        ];
        const ancestry = RRHumanBody.ANCESTRY.map(a => this._slider({ path: `ancestry.${a}`, label: { african: 'African', asian: 'Asian', caucasian: 'European' }[a], natural: [0, 1] })).join('');
        return this._extremeToggle() + this._shapeSliders(['Head and neck', 'Head shape', 'Forehead and brows', 'Eyes', 'Nose', 'Mouth and jaw', 'Ears'])
            + this._section('Muzzle and face') + morph.map(s => this._slider(s)).join('') + this._section('Ancestry') + ancestry;
    }

    _hairTab() {
        const H = RRCharacterHair;
        const grouped = list => [...new Set(list.map(s => s.group || ''))].map(g => ({ group: g || 'Styles', items: list.filter(s => (s.group || '') === g).map(s => [s.id, s.label]) }));
        const colors = ['#0e0c0b', '#2a1d15', '#3b2a1e', '#6a4428', '#8a3a1c', '#b8632a', '#d8b070', '#efe2b8', '#8a8a8a', '#e8e8e8', '#2a4ab0', '#2a8a4a', '#d84a9a', '#7a3ab8', '#c02020'];
        const h = this.recipe.hair;
        let out = this._section('Hair') + this._select('hair.style', 'Style', grouped(H.STYLES)) + this._color('hair.color', 'Color', colors) + this._color('hair.tipColor', 'Tip color', [], true);
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
        out += this._section('Facial hair') + this._select('hair.facial.style', 'Style', grouped(H.FACIAL));
        if (h.facial.style !== 'none') {
            out += this._color('hair.facial.color', 'Color', colors.slice(0, 10), true)
                + this._slider({ path: 'hair.facial.length', label: 'Length', natural: [0.3, 2.5], format: 'x' })
                + this._slider({ path: 'hair.facial.volume', label: 'Volume', natural: [0, 1] });
        }
        out += this._section('Brows and lashes') + this._select('hair.brows.style', 'Brows', H.BROWS.map(b => [b.id, b.label]));
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
            .map(p => `<button class="rr-c3d-tile" data-act="dress" data-id="${p.id}">${this._t(p.label)}</button>`).join('')}</div>`).join('');
        const add = `<div class="rr-c3d-add"><select class="rr-select rr-c3d-add-garment">${this._garmentChoices().map(g => `<optgroup label="${rrEscapeHtml(this._t(g.group))}">${g.items.map(([id, l]) => `<option value="${id}">${rrEscapeHtml(this._t(l))}</option>`).join('')}</optgroup>`).join('')}</select>
            <button class="rr-btn-chip" data-act="add-garment">${this._t('Add')}</button></div>`;
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
        const choices = [...new Set(P.PROPS.map(p => p.group))].map(group => `<optgroup label="${rrEscapeHtml(this._t(group))}">${P.PROPS.filter(p => p.group === group).map(p => `<option value="${p.id}">${rrEscapeHtml(this._t(p.label))}</option>`).join('')}</optgroup>`).join('');
        const add = `<div class="rr-c3d-add"><select class="rr-select rr-c3d-add-prop">${choices}</select><button class="rr-btn-chip" data-act="add-prop">${this._t('Add')}</button></div>`;
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
            + this._select('eyes.pupil', 'Pupil', S.PUPILS) + this._slider({ path: 'eyes.size', label: 'Iris size', natural: [0.7, 1.3], extreme: [0.5, 1.6], format: 'x' }) + this._color('eyes.sclera', 'Whites', ['#1a0808', '#0a0a0e', '#f0e0a0'], true);
        return out;
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
            default: Object.assign(r, roll);
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
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        const css = getComputedStyle(this.root);
        scene.background = new THREE.Color(css.getPropertyValue('--color-bg-deep').trim() || '#1d1f24');
        const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 80);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x50463c, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(1.5, 2.5, 2.5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xb8c8ff, 0.9);
        rim.position.set(-2, 1.8, -2);
        scene.add(rim);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
        const group = new THREE.Group();
        scene.add(group);
        const view = this._view = { renderer, scene, camera, floor, group, meshes: [], bones: [], textures: new Map(), yaw: 0.35, pitch: 0.08, distance: 4.2, target: new THREE.Vector3(0, 0.9, 0), frame: 0, loop: 0, clock: new THREE.Clock() };

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

    /** The Idle plays while the pose says so; otherwise the view draws only when asked. */
    _syncPose() {
        const view = this._view;
        if (!this.root) return;
        this.root.querySelectorAll('.rr-c3d-pose').forEach(b => b.classList.toggle('is-active', b.dataset.pose === this.pose));
        if (!view) return;
        cancelAnimationFrame(view.loop);
        view.loop = 0;
        if (view.action) {
            if (this.pose === 'idle') view.action.play(); else { view.action.stop(); view.mixer.setTime(0); for (const b of view.bones) { b.position.copy(b.userData.rest.p); b.quaternion.identity(); } }
        }
        if (this.pose === 'idle' && view.mixer) {
            view.clock.getDelta();
            const tick = () => {
                view.loop = requestAnimationFrame(tick);
                view.mixer.update(Math.min(0.05, view.clock.getDelta()));
                this._render();
            };
            view.loop = requestAnimationFrame(tick);
        } else this._draw();
    }

    _queueRebuild() {
        if (this._pending) return;
        this._pending = requestAnimationFrame(() => { this._pending = 0; this._rebuild(); });
    }

    _rebuild() {
        const view = this._view;
        if (!view || !this.pack) return;
        let result;
        try {
            result = RRCharacterModel.build(this.pack, this.recipe, this.cache, { quality: 'preview', eyeSource: this.eyeSource });
        } catch (error) {
            console.error('[Character3DBuilder] build', error);
            this._status(this._t('This character could not be built.'), 'error');
            return;
        }
        this._result = result;
        this._show(result);
        const readout = this.root.querySelector('.rr-c3d-readout');
        if (readout) {
            const tris = result.parts.reduce((s, p) => s + p.index.length / 3, 0);
            readout.textContent = this._t('Height {m} m', { m: result.height.toFixed(2) }) + ' · ' + this._t('{n} triangles', { n: Math.round(tris).toLocaleString() });
        }
    }

    _clearModel() {
        const view = this._view;
        if (!view) return;
        if (view.mixer) { view.mixer.stopAllAction(); view.mixer.uncacheRoot(view.group); }
        for (const m of view.meshes) { m.geometry.dispose(); m.material.dispose(); view.group.remove(m); }
        for (const b of view.bones) if (b.parent === view.group) view.group.remove(b);
        if (view.skeleton) view.skeleton.dispose();
        view.meshes = []; view.bones = []; view.skeleton = null; view.mixer = null; view.action = null;
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

    /** The build in the view: a skeleton from its bones, a skinned mesh per part, its Idle ready to play. */
    _show(result) {
        const view = this._view;
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
            if (part.colors && !part.texture) g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(part.colors), 3));
            g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(part.joints), 4));
            g.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(part.weights), 4));
            g.setIndex(new THREE.BufferAttribute(Uint32Array.from(part.index), 1));
            const tex = part.texture && result.textures[part.texture];
            const material = new THREE.MeshStandardMaterial({
                color: tex || part.colors ? 0xffffff : new THREE.Color(part.color || '#bbbbbb'),
                map: tex ? this._texture(part.texture, tex) : null,
                vertexColors: !!(part.colors && !tex),
                roughness: part.roughness ?? 0.6, metalness: part.metalness ?? 0,
                side: part.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
                transparent: part.opacity != null && part.opacity < 1, opacity: part.opacity ?? 1,
                alphaTest: part.cutout ? 0.5 : 0, depthWrite: !(part.opacity != null && part.opacity < 1)
            });
            const mesh = new THREE.SkinnedMesh(g, material);
            mesh.frustumCulled = false;
            mesh.bind(skeleton);
            view.group.add(mesh);
            view.meshes.push(mesh);
        }
        view.bones = bones;
        view.skeleton = skeleton;
        const clip = result.clips && result.clips[0];
        if (clip) {
            view.mixer = new THREE.AnimationMixer(view.group);
            const tracks = clip.tracks.map(t => new THREE.QuaternionKeyframeTrack(bones[t.bone].name + '.quaternion', Array.from(clip.times), Array.from(t.values)));
            view.action = view.mixer.clipAction(new THREE.AnimationClip(clip.name || 'Idle', -1, tracks));
            view.action.time = time % (view.action.getClip().duration || 1);
        }
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
        this._aim();
        this._syncPose();
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
            const result = RRCharacterModel.build(this.pack, this.recipe, { wardrobe: this.cache.wardrobe }, { quality: 'save', eyeSource: this.eyeSource });
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

if (typeof window !== 'undefined') window.Character3DBuilder = Character3DBuilder;

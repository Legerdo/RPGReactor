/**
 * Character3DBuilder - Forge › 3D Character Builder.
 *
 * Sliders shape one body (RRHumanBody) live in a 3D view; Save to Project
 * writes a skinned GLB to <project>/3d/Characters/<name>/source/ and the
 * recipe beside it (character.json), so the character opens here again
 * for edits and shows in Database › 3D Models like any imported model.
 * Randomize rolls a seeded recipe; the seed is kept in the recipe.
 */
class Character3DBuilder {
    constructor() {
        this.projectController = null;
        this.root = null;
        this.recipe = RRHumanBody.normalizeRecipe(RRHumanBody.DEFAULT_RECIPE);
        this.name = '';
        this.pack = null;
        this._view = null;
        this._pending = 0;
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

    /** How far off vertical the arms hang at rest: wider for a heavier or more muscled body. */
    static armAngle(recipe) {
        return 0.16 + 0.22 * recipe.weight + 0.1 * recipe.muscle;
    }

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
        if (this._view) {
            cancelAnimationFrame(this._view.frame);
            this._view.resize?.disconnect();
            this._view.renderer.dispose();
            this._view.renderer.forceContextLoss?.();
            this._view = null;
        }
    }

    // ── page ───────────────────────────────────────────────────────────────
    _sliders() {
        return [
            { section: 'Body' },
            { key: 'gender', label: 'Gender', min: 0, max: 1, step: 0.01, ends: ['Female', 'Male'] },
            { key: 'age', label: 'Age', min: RRHumanBody.MIN_AGE, max: RRHumanBody.MAX_AGE, step: 1, unit: 'years' },
            { key: 'height', label: 'Height', min: 0, max: 1, step: 0.01 },
            { key: 'weight', label: 'Weight', min: 0, max: 1, step: 0.01, ends: ['Thin', 'Heavy'] },
            { key: 'muscle', label: 'Muscle', min: 0, max: 1, step: 0.01 },
            { key: 'cup', label: 'Bust', min: 0, max: 1, step: 0.01 },
            { key: 'shapes.shoulders', label: 'Shoulders', min: -1, max: 1, step: 0.01, ends: ['Narrow', 'Broad'] },
            { key: 'shapes.hips', label: 'Hips', min: -1, max: 1, step: 0.01, ends: ['Narrow', 'Wide'] },
            { key: 'shapes.belly', label: 'Belly', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.neck', label: 'Neck', min: -1, max: 1, step: 0.01, ends: ['Thin', 'Thick'] },
            { section: 'Face' },
            { key: 'shapes.headFat', label: 'Face fullness', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.headWidth', label: 'Head width', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.headHeight', label: 'Head height', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.noseWidth', label: 'Nose width', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.noseLength', label: 'Nose length', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.noseHump', label: 'Nose bridge', min: -1, max: 1, step: 0.01 },
            { key: 'shapes.earSize', label: 'Ear size', min: -1, max: 1, step: 0.01 },
            { key: 'earsPointed', label: 'Pointed ears', min: 0, max: 1, step: 0.01 },
            { section: 'Ancestry' },
            { key: 'ancestry.african', label: 'African', min: 0, max: 1, step: 0.01 },
            { key: 'ancestry.asian', label: 'Asian', min: 0, max: 1, step: 0.01 },
            { key: 'ancestry.caucasian', label: 'European', min: 0, max: 1, step: 0.01 }
        ];
    }

    _get(key) { return key.split('.').reduce((o, k) => (o ? o[k] : undefined), this.recipe); }

    _set(key, value) {
        const path = key.split('.');
        const next = JSON.parse(JSON.stringify(this.recipe));
        let o = next;
        for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
        o[path[path.length - 1]] = value;
        // Ancestry is a mix: moving one slider rebalances the other two.
        if (path[0] === 'ancestry') {
            const others = RRHumanBody.ANCESTRY.filter(a => a !== path[1]);
            const rest = others.reduce((s, a) => s + next.ancestry[a], 0);
            others.forEach(a => { next.ancestry[a] = rest > 0 ? next.ancestry[a] / rest * (1 - value) : (1 - value) / 2; });
        }
        delete next.seed;
        this.recipe = RRHumanBody.normalizeRecipe(next);
    }

    _sliderValue(s) {
        const v = this._get(s.key);
        if (s.unit === 'years') return this._t('{n} years', { n: Math.round(v) });
        if (s.key.startsWith('ancestry.')) return Math.round(v * 100) + '%';
        if (s.min < 0) return (v > 0 ? '+' : '') + Math.round(v * 100);
        return Math.round(v * 100) + '%';
    }

    _renderPage() {
        const rows = this._sliders().map(s => {
            if (s.section) return `<div class="rr-c3d-section">${this._t(s.section)}</div>`;
            const v = this._get(s.key);
            const ends = s.ends ? `<div class="rr-c3d-ends"><span>${this._t(s.ends[0])}</span><span>${this._t(s.ends[1])}</span></div>` : '';
            return `<label class="rr-c3d-row"><span class="rr-c3d-label">${this._t(s.label)}</span>
                <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}">
                <span class="rr-c3d-value" data-value="${s.key}">${this._sliderValue(s)}</span>${ends}</label>`;
        }).join('');
        const tones = ['#f1d3bd', '#e5b897', '#c69c7f', '#a8795a', '#8a5a3c', '#5e3b26', '#3f2618'];
        this.root.innerHTML = `
            <div class="rr-c3d">
                <div class="rr-c3d-toolbar">
                    <label class="rr-c3d-name"><span>${this._t('Name')}</span><input type="text" class="rr-c3d-name-input rr-input" maxlength="48" placeholder="${this._t('Villager')}" value="${rrEscapeHtml(this.name)}"></label>
                    <button class="rr-btn-chip rr-c3d-random" title="${this._t('A new random body')}">🎲 ${this._t('Randomize')}</button>
                    <button class="rr-btn-chip rr-c3d-reset">↻ ${this._t('Reset')}</button>
                    <select class="rr-c3d-open rr-select" title="${this._t('Open a character saved from here')}"></select>
                    <span class="rr-c3d-spacer"></span>
                    <span class="rr-c3d-status" aria-live="polite"></span>
                    <button class="rr-btn-chip rr-c3d-save">${this._t('Save to Project')}</button>
                </div>
                <div class="rr-c3d-body">
                    <div class="rr-c3d-panel">
                        ${rows}
                        <div class="rr-c3d-section">${this._t('Skin')}</div>
                        <div class="rr-c3d-row rr-c3d-skin">
                            <span class="rr-c3d-label">${this._t('Skin color')}</span>
                            <div class="rr-c3d-swatches">${tones.map(c => `<button class="rr-c3d-swatch" data-tone="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
                            <input type="color" class="rr-c3d-skin-input" value="${this.recipe.skin}">
                        </div>
                    </div>
                    <div class="rr-c3d-view">
                        <canvas class="rr-c3d-canvas"></canvas>
                        <div class="rr-c3d-readout"></div>
                        <div class="rr-c3d-hint">${this._t('Drag to turn, wheel to zoom')}</div>
                    </div>
                </div>
            </div>`;
        this._fillOpenList();
        const panel = this.root.querySelector('.rr-c3d-panel');
        panel.addEventListener('input', event => {
            const input = event.target;
            if (input.matches('input[type="range"]')) {
                this._set(input.dataset.key, +input.value);
                this._syncSliders();
                this._queueRebuild();
            } else if (input.matches('.rr-c3d-skin-input')) {
                this._set('skin', input.value);
                this._paintSkin();
            }
        });
        panel.addEventListener('click', event => {
            const swatch = event.target.closest('.rr-c3d-swatch');
            if (!swatch) return;
            this._set('skin', swatch.dataset.tone);
            this.root.querySelector('.rr-c3d-skin-input').value = this.recipe.skin;
            this._paintSkin();
        });
        this.root.querySelector('.rr-c3d-name-input').addEventListener('input', e => { this.name = e.target.value; });
        this.root.querySelector('.rr-c3d-random').addEventListener('click', () => {
            this.recipe = RRHumanBody.randomRecipe((Math.random() * 4294967296) >>> 0);
            this._afterRecipeChange();
        });
        this.root.querySelector('.rr-c3d-reset').addEventListener('click', () => {
            this.recipe = RRHumanBody.normalizeRecipe(RRHumanBody.DEFAULT_RECIPE);
            this._afterRecipeChange();
        });
        this.root.querySelector('.rr-c3d-open').addEventListener('change', e => {
            const name = e.target.value;
            e.target.value = '';
            if (name) this._openSaved(name);
        });
        this.root.querySelector('.rr-c3d-save').addEventListener('click', () => this.save());
    }

    _afterRecipeChange() {
        this._syncSliders();
        const skin = this.root.querySelector('.rr-c3d-skin-input');
        if (skin) skin.value = this.recipe.skin;
        this._paintSkin();
        this._queueRebuild();
    }

    _syncSliders() {
        for (const s of this._sliders()) {
            if (s.section) continue;
            const input = this.root.querySelector(`input[data-key="${s.key}"]`);
            if (input && +input.value !== this._get(s.key)) input.value = this._get(s.key);
            if (input) input.style.setProperty('--rr-fill', ((this._get(s.key) - s.min) / (s.max - s.min) * 100) + '%');
            const label = this.root.querySelector(`[data-value="${s.key}"]`);
            if (label) label.textContent = this._sliderValue(s);
        }
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
        } catch (error) {
            console.error('[Character3DBuilder] body pack', error);
            this._status(this._t('The body data could not be loaded.'), 'error');
            return;
        }
        if (!this.root || !this.root.querySelector('.rr-c3d-canvas')) return;
        this._makeView();
        this._syncSliders();
        this._rebuild();
        this._status('');
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
        const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x50463c, 1.1));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(1.5, 2.5, 2.5);
        scene.add(key);
        const rim = new THREE.DirectionalLight(0xb8c8ff, 0.9);
        rim.position.set(-2, 1.8, -2);
        scene.add(rim);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(0.7, 48), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);
        const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.recipe.skin), roughness: 0.62, metalness: 0 });
        const eyeTexture = new THREE.TextureLoader().load(RRHumanBody.DATA_PATH + '/eye-brown.png', () => this._draw());
        eyeTexture.colorSpace = THREE.SRGBColorSpace;
        // The pack's UVs run top-down, as a glTF file stores them.
        eyeTexture.flipY = false;
        // The cornea shell is see-through in the picture: cut it out.
        const eyes = new THREE.MeshStandardMaterial({ map: eyeTexture, roughness: 0.25, alphaTest: 0.5 });
        const body = new THREE.Mesh(new THREE.BufferGeometry(), skin);
        const eyeMesh = new THREE.Mesh(new THREE.BufferGeometry(), eyes);
        scene.add(body, eyeMesh);
        const view = this._view = { renderer, scene, camera, body, eyeMesh, skin, yaw: 0.35, pitch: 0.08, distance: 4.2, target: new THREE.Vector3(0, 0.9, 0), frame: 0 };

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
            view.distance = Math.max(0.6, Math.min(9, view.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
            // Closer in, the view centers on the face.
            this._aim();
            this._draw();
        }, { passive: false });
    }

    _aim() {
        const view = this._view;
        if (!view) return;
        const h = view.height || 1.7;
        const near = Math.max(0, Math.min(1, (3.2 - view.distance) / 2.4));
        view.target.set(0, h * (0.52 + 0.4 * near), 0);
    }

    _draw() {
        const view = this._view;
        if (!view || view.frame) return;
        view.frame = requestAnimationFrame(() => {
            view.frame = 0;
            const c = view.camera, t = view.target;
            c.position.set(t.x + Math.sin(view.yaw) * Math.cos(view.pitch) * view.distance, t.y + Math.sin(view.pitch) * view.distance, t.z + Math.cos(view.yaw) * Math.cos(view.pitch) * view.distance);
            c.lookAt(t);
            view.renderer.render(view.scene, c);
        });
    }

    _queueRebuild() {
        if (this._pending) return;
        this._pending = requestAnimationFrame(() => { this._pending = 0; this._rebuild(); });
    }

    _rebuild() {
        const view = this._view;
        if (!view || !this.pack) return;
        const built = RRHumanBody.build(this.pack, this.recipe);
        const apply = (mesh, part) => {
            const g = mesh.geometry;
            const pos = g.getAttribute('position');
            if (pos && pos.count * 3 === part.positions.length) {
                pos.array.set(part.positions); pos.needsUpdate = true;
                const n = g.getAttribute('normal'); n.array.set(part.normals); n.needsUpdate = true;
            } else {
                g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(part.positions), 3));
                g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(part.normals), 3));
                g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(part.uvs), 2));
                g.setIndex(new THREE.BufferAttribute(Uint32Array.from(part.index), 1));
            }
            g.computeBoundingSphere();
        };
        apply(view.body, built.parts[0]);
        apply(view.eyeMesh, built.parts[1]);
        view.height = built.height;
        this._aim();
        const readout = this.root.querySelector('.rr-c3d-readout');
        if (readout) readout.textContent = this._t('Height {m} m', { m: built.height.toFixed(2) });
        this._draw();
    }

    _paintSkin() {
        if (!this._view) return;
        this._view.skin.color.set(this.recipe.skin);
        this._draw();
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

    _fillOpenList() {
        const select = this.root.querySelector('.rr-c3d-open');
        if (!select) return;
        const names = this._savedNames();
        select.innerHTML = `<option value="">${this._t('Open saved…')}</option>` + names.map(n => `<option value="${rrEscapeHtml(n)}">${rrEscapeHtml(n)}</option>`).join('');
        select.disabled = !names.length;
    }

    _openSaved(name) {
        const fs = require('fs'), path = require('path');
        try {
            const data = JSON.parse(fs.readFileSync(path.join(this._charactersDir(), name, 'character.json'), 'utf8'));
            this.recipe = RRHumanBody.normalizeRecipe(data.recipe || data);
            this.name = name;
            const input = this.root.querySelector('.rr-c3d-name-input');
            if (input) input.value = name;
            this._afterRecipeChange();
            this._status(this._t('Opened {name}.', { name }));
        } catch (error) {
            console.error('[Character3DBuilder] open', error);
            this._status(this._t('{name} could not be opened.', { name }), 'error');
        }
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
        try {
            const built = RRHumanBody.build(this.pack, this.recipe);
            built.parts[0].color = this.recipe.skin;
            built.parts[0].roughness = 0.62;
            built.parts[1].roughness = 0.25;
            built.parts[1].cutout = true;
            const eyePicture = fs.readFileSync(path.join(RRHumanBody.dataFolder(), built.parts[1].texture));
            const glb = RRCharacterGlb.toGlb(built, { name, idle: { armAngle: Character3DBuilder.armAngle(this.recipe) }, images: { [built.parts[1].texture]: new Uint8Array(eyePicture) } });
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, glb);
            fs.writeFileSync(path.join(folder, 'character.json'), JSON.stringify({ builder: 'character3d', version: 1, recipe: this.recipe }, null, 2) + '\n');
            this._fillOpenList();
            this._status(this._t('Saved to 3D Models › Characters/{name}.', { name }), 'ok');
            window.dispatchEvent(new CustomEvent('rr-models-changed', { detail: { name: 'Characters/' + name } }));
        } catch (error) {
            console.error('[Character3DBuilder] save', error);
            this._status(this._t('{name} could not be saved.', { name }), 'error');
        }
    }
}

if (typeof window !== 'undefined') window.Character3DBuilder = Character3DBuilder;

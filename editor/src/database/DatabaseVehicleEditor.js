/** Reactor vehicle types. Optional data; browsing never normalizes or writes a record. */
class DatabaseVehicleEditor {
    constructor(databaseManager, projectManager, parentEditor) {
        this.databaseManager = databaseManager;
        this.projectManager = projectManager;
        this.parentEditor = parentEditor;
        this.generation = 0;
    }
    t(key) { return window.I18n ? window.I18n.t(key) : key; }
    tt(text) { return window.I18n ? window.I18n.tText(text) : text; }
    dispose() { this.generation++; }
    changed() { this.databaseManager.mutationGeneration++; }
    static listEntries(manager) {
        const tt = text => typeof window !== 'undefined' && window.I18n ? window.I18n.tText(text) : text;
        // View rows address the original System records; custom type IDs never move.
        return [
            { id: -3, name: tt('Boat'), stockVehicle: 'boat' },
            { id: -2, name: tt('Ship'), stockVehicle: 'ship' },
            { id: -1, name: tt('Airship'), stockVehicle: 'airship' },
            ...manager.getVehicles()
        ];
    }
    static modelValue(picked, previous = {}) {
        if (!picked?.name) return { name: '', size: Number(previous.size) || 3.5 };
        const model = {};
        for (const key of ['name', 'file', 'ext', 'size', 'scale', 'variant', 'texture', 'offset']) {
            if (picked[key] !== undefined) model[key] = picked[key];
        }
        return model;
    }
    static classSlotsSection(record, manager) {
        const section = document.createElement('div'); section.className = 'database-section';
        const t = key => window.I18n ? window.I18n.t(key) : key;
        const types = manager.getSystem()?.equipTypes || [];
        section.innerHTML = `<div class="database-section-header" data-section-key="vehicle-equipment-slots">${rrEscapeHtml(t('vehicle.classSlots'))}</div><div class="database-section-content"><p class="vehicle-hint">${rrEscapeHtml(t('vehicle.slotHelp'))}</p><label><input class="vehicle-custom-slots" type="checkbox" ${Array.isArray(record.rrVehicleSlots) ? 'checked' : ''}> ${rrEscapeHtml(t('vehicle.customSlots'))}</label><div class="vehicle-class-slot-rows"></div><button type="button" class="vehicle-add-slot rr-btn-secondary">+ ${rrEscapeHtml(t('vehicle.slot'))}</button></div>`;
        const changed = () => { manager.mutationGeneration++; };
        const render = () => {
            const custom = Array.isArray(record.rrVehicleSlots);
            const host = section.querySelector('.vehicle-class-slot-rows'); host.innerHTML = '';
            section.querySelector('.vehicle-add-slot').disabled = !custom || types.length < 2;
            const slots = custom ? record.rrVehicleSlots : types.map((_, id) => id).slice(1);
            slots.forEach((id, index) => {
                const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:4px;margin-top:4px';
                row.innerHTML = `<select aria-label="${rrEscapeHtml(t('vehicle.slot'))} ${index + 1}" style="flex:1;min-width:0" ${custom ? '' : 'disabled'}>${types.map((name, value) => value > 0 ? `<option value="${value}" ${value === id ? 'selected' : ''}>${rrEscapeHtml(name)}</option>` : '').join('')}${!types[id] ? `<option value="${id}" selected>#${id}</option>` : ''}</select><button class="rr-btn-secondary" type="button" ${custom ? '' : 'disabled'} aria-label="${rrEscapeHtml(t('common.delete'))}">×</button>`;
                row.querySelector('select').onchange = e => { record.rrVehicleSlots[index] = Number(e.target.value); changed(); };
                row.querySelector('button').onclick = () => { record.rrVehicleSlots.splice(index, 1); changed(); render(); };
                host.appendChild(row);
            });
        };
        section.querySelector('.vehicle-custom-slots').onchange = e => {
            if (e.target.checked) record.rrVehicleSlots = types.map((_, id) => id).slice(1); else delete record.rrVehicleSlots;
            changed(); render();
        };
        section.querySelector('.vehicle-add-slot').onclick = () => { record.rrVehicleSlots.push(1); changed(); render(); };
        render(); return section;
    }

    // The metadata/handling module is pure until a model is supplied. Load it in an
    // isolated namespace so a flat project's database never needs WebGL or THREE.
    static rules(projectManager) {
        if (DatabaseVehicleEditor._rules) return DatabaseVehicleEditor._rules;
        const fs = require('fs'), path = require('path');
        const canonical = window.reactor?.projectManager?.getRuntimePath?.();
        const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : null;
        const candidates = [canonical, cwd && path.join(cwd, 'runtime'), cwd && path.join(cwd, '..', 'runtime'),
            path.join(projectManager.getCurrentProject().path, 'js')].filter(Boolean);
        const file = candidates.map(dir => path.join(dir, 'reactor_3d_vehicles.js')).find(file => fs.existsSync(file));
        if (!file) throw new Error('Vehicle rules are missing');
        const isolated = { Reactor3D: {} };
        new Function('globalThis', 'process', 'require', 'module', fs.readFileSync(file, 'utf8'))(isolated, undefined, undefined, undefined);
        return DatabaseVehicleEditor._rules = isolated.Reactor3D.Vehicles;
    }

    showStock(container, key) {
        const system = this.databaseManager.getSystem(), stock = system[key] || {};
        const label = {boat:'Boat',ship:'Ship',airship:'Airship'}[key];
        // A view draft: no extension is created just by selecting a vanilla row.
        const record = { name: this.tt(label), kind: key === 'ship' ? 'boat' : key,
            ...structuredClone(stock.reactorVehicle || {}), id: {boat:-3,ship:-2,airship:-1}[key],
            sheet: { characterName: stock.characterName || '', characterIndex: stock.characterIndex || 0 } };
        this.show(container, record, { stockKey:key, stock, save: () => {
            const {id, sheet, ...extension} = record;
            (system[key] ||= {}).reactorVehicle = structuredClone(extension);
            this.changed();
        }});
    }

    show(container, record, options = {}) {
        const gen = ++this.generation;
        const live = options.stockKey ? record : this.databaseManager.getVehicle(record.id) || record;
        const current = this.parentEditor.captureDetailContext();
        const valid = () => gen === this.generation && current() && container.isConnected;
        const save = () => { if (options.save) options.save(); else this.changed(); };
        const refresh = () => {
            if (!valid()) return;
            const entry = options.stockKey ? DatabaseVehicleEditor.listEntries(this.databaseManager).find(row => row.stockVehicle === options.stockKey) : live;
            this.parentEditor.showDatabaseDetail(entry, 'vehicles');
        };
        const engine = DatabaseVehicleEditor.rules(this.projectManager), typed = () => options.stockKey ? engine.stockTypeOf({...live}) : engine.typeOf({...live});
        const t = key => rrEscapeHtml(this.t(key)), tt = text => rrEscapeHtml(this.tt(text));
        const section = (key, title, body) => `<div class="database-section"><div class="database-section-header" data-section-key="${key}">${title}</div><div class="database-section-content vehicle-form">${body}</div></div>`;
        const field = (label, body) => `<label class="vehicle-field"><span>${label}</span>${body}</label>`;
        const kinds = {motorcycle:this.t('vehicle.motorcycle'),car:this.t('vehicle.car'),tank:this.t('vehicle.tank'),boat:this.tt('Boat'),airship:this.tt('Airship'),shuttle:this.t('vehicle.shuttle'),hover:this.t('vehicle.hover')};
        const classOptions = this.databaseManager.getClasses().map(entry => `<option value="${entry.id}" ${entry.id === live.classId ? 'selected' : ''}>${rrEscapeHtml(entry.name)}</option>`).join('');
        container.innerHTML = `<div class="database-detail-wrapper db-page vehicle-detail">
          <div class="database-sections-grid database-item-columns vehicle-columns">
            <div class="database-item-column vehicle-main-column">
              ${section('general',tt('General'), `<div class="vehicle-fields">${field(tt('Name'),`<input class="database-field-value vehicle-name" data-field="name" value="${rrEscapeHtml(live.name || '')}">`)}${field(t('vehicle.kind'),`<select class="vehicle-kind" ${options.stockKey ? 'disabled' : ''}>${Object.entries(kinds).map(([kind,label]) => `<option value="${kind}" ${kind === (live.kind || 'motorcycle') ? 'selected' : ''}>${rrEscapeHtml(label)}</option>`).join('')}</select>`)}${field(tt('Class'),`<select class="vehicle-class"><option value="0">${t('vehicle.noClass')}</option>${classOptions}</select>`)}${field(tt('Level'),`<input class="vehicle-level" type="number" min="1" max="999" value="${Number(live.initialLevel) || 1}">`)}</div><label class="vehicle-check"><input class="vehicle-ridable" type="checkbox" ${live.ridable !== false ? 'checked' : ''}> ${t('vehicle.ridable')}</label>`)}
              ${section('appearance',tt('Image'), `<div class="graphic-preview-box vehicle-graphic-slot"><div class="graphic-preview-label">${t('vehicle.sprite')}</div><div class="graphic-canvas-container"><canvas class="vehicle-sprite-preview" width="64" height="64"></canvas></div><div class="graphic-preview-name" data-rr-i18n-skip>${rrEscapeHtml(live.sheet?.characterName || '')}</div><button class="graphic-selector-button vehicle-image-browse rr-btn-browse" type="button">${tt('Change Image')}</button></div><div class="vehicle-model-settings">${field(t('vehicle.size'),`<input class="vehicle-size" type="number" min="0.1" max="100" step="0.1" value="${Number(live.model?.size) || engine.KINDS[live.kind || 'motorcycle']?.size || 3.5}">`)}</div>`)}
              ${options.stockKey ? section('location',tt('Location'),`<div class="vehicle-fields vehicle-location-fields">${['startMapId','startX','startY'].map((key,i) => field(tt(['Map','X','Y'][i]),`<input class="vehicle-stock-location" data-field="${key}" type="number" min="0" value="${Number(options.stock[key]) || 0}">`)).join('')}</div>`) : section('movement',tt('Movement'),`${field(t('vehicle.medium'),`<select class="vehicle-medium">${['ground','water','air'].map(medium => `<option value="${medium}" ${typed().medium === medium ? 'selected' : ''}>${t('vehicle.'+medium)}</option>`).join('')}</select>`)}<div class="vehicle-medium-settings"></div><details class="vehicle-handling-details"><summary>${t('vehicle.handling')}</summary><div class="vehicle-handling vehicle-fields"></div></details>`)}
              ${section('sound',t('vehicle.sound'),'<div class="vehicle-sound-rows"></div><details class="vehicle-effects-details"><summary>'+t('vehicle.effects')+'</summary><div class="vehicle-effect-rows"></div></details>')}
              ${section('note',tt('Note'),`<textarea class="vehicle-note database-field-value" rows="3">${rrEscapeHtml(live.note || '')}</textarea>`)}
            </div>
            <div class="database-item-column vehicle-rules-column">
              ${section('equipment',tt('Equipment'),'<div class="vehicle-equipment-rows"></div>')}
              <div class="vehicle-traits-host"></div><div class="vehicle-skills-host"></div>
              ${section('parameters',tt('Parameters'),'<div class="vehicle-base-stats"></div>')}
            </div>
          </div>
        </div>`;
        const find = selector => container.querySelector(selector);
        find('.vehicle-name').oninput = event => {
            live.name = event.target.value; save();
            if (!options.stockKey) this.parentEditor.refreshDatabaseListEntry?.(live,'vehicles');
        };
        find('.vehicle-kind').onchange = event => { live.kind = event.target.value; save(); find('.vehicle-medium').value = typed().medium; fillMovement(); };
        find('.vehicle-ridable').onchange = event => { live.ridable = event.target.checked; save(); };
        find('.vehicle-class').onchange = event => { live.classId = Number(event.target.value); save(); refresh(); };
        find('.vehicle-level').onchange = event => {
            const level = Number(event.target.value);
            if (!event.target.value.trim() || !Number.isInteger(level) || level < 1 || level > 999) { event.target.value = live.initialLevel || 1; return; }
            live.initialLevel = level; save(); fillEquipment();
        };
        find('.vehicle-note').oninput = event => { live.note = event.target.value; save(); };
        find('.vehicle-size').onchange = event => {
            const size = Number(event.target.value);
            if (!Number.isFinite(size) || size < 0.1 || size > 100) { event.target.value = typed().model?.size || 3.5; return; }
            live.model = {...(live.model || {}),size}; save();
        };
        const updateSheet = sheet => {
            live.sheet = sheet;
            if (options.stockKey) { Object.assign(options.stock,sheet); this.changed(); }
            else save();
            const tag = find('.graphic-preview-name');
            tag.textContent = sheet.characterName; tag.dataset.source2d = sheet.characterName;
            previewSheet();
        };
        find('.vehicle-image-browse').onclick = () => {
            const picker = new CharacterGraphicPicker(this.projectManager);
            picker.show(live.sheet?.characterName || '',live.sheet?.characterIndex || 0,1,2,result => {
                if (!valid() || !result) return;
                updateSheet({characterName:result.characterName || '',characterIndex:Number(result.characterIndex)||0});
            });
            if (picker.modal || picker._modal) this.parentEditor.registerDetailModal(picker.modal || picker._modal,()=>picker._close?.());
        };
        const previewSheet = () => {
            const canvas = find('.vehicle-sprite-preview'), ctx = canvas.getContext('2d'); ctx.clearRect(0,0,64,64);
            const sheet = live.sheet;
            if (!sheet?.characterName) return;
            const img = new Image(), name = sheet.characterName, index = sheet.characterIndex || 0;
            img.onload = () => {
                if (!valid()) return;
                const big = RRAssetFiles.isBigCharacter(name), frames = RRAssetFiles.characterFrameCount?.(name) || 3, cw = img.width / (big ? frames : frames*4), ch = img.height / (big ? 4 : 8);
                const size = Math.min(56/cw,56/ch,1), width = cw*size,height=ch*size;
                ctx.imageSmoothingEnabled=false; ctx.drawImage(img,(big?1:(index%4)*frames+1)*cw,(big?0:Math.floor(index/4)*4)*ch,cw,ch,(64-width)/2,(64-height)/2,width,height);
            };
            img.src = RRAssetFiles.imageUrlFor(require('path').join(this.projectManager.getCurrentProject().path,'img','characters'),name);
        };
        const graphic = RRDatabase3DBindings.decorateSlot(find('.vehicle-graphic-slot'), {
            projectManager:this.projectManager, id:live.id, slot:'character', label:this.t('vehicle.model'),
            getBound:() => valid() && live.graphic3d !== false && live.model?.name ? live.model : null,
            pickerValue:() => live.model,
            setBound:spec => {
                if (!valid()) return false;
                if (spec?.name) { live.model=DatabaseVehicleEditor.modelValue(spec,live.model); live.graphic3d=true; }
                else live.graphic3d=false;
                save(); return true;
            },
            thumbnail:spec => RRDatabase3DBindings.modelThumbnail(this.parentEditor.reactor3dEditor,spec),
            registerModal:(modal,dispose) => this.parentEditor.registerDetailModal(modal,dispose)
        });
        if (graphic) {
            graphic.afterSync=spec => { find('.vehicle-model-settings').hidden=!spec; find('.vehicle-size').value=spec?.size || Number(live.model?.size) || 3.5; };
            graphic.afterSync(graphic.bound());
        }
        previewSheet();
        if (options.stockKey) {
            container.querySelectorAll('.vehicle-stock-location').forEach(input => input.onchange = event => {
                const value = Number(event.target.value), key=event.target.dataset.field;
                if (!event.target.value.trim() || !Number.isInteger(value) || value < 0) { event.target.value=options.stock[key] || 0; return; }
                options.stock[key]=value; this.changed();
            });
        }
        const fillSounds = () => {
            const sounds=typed().sounds;
            for (const host of ['.vehicle-sound-rows','.vehicle-effect-rows']) find(host).replaceChildren();
            const slots={idle:'vehicle.idle',accelerate:'vehicle.soundAcceleration',slowdown:'vehicle.slowdown',bgm:'BGM',start:'vehicle.soundStart',stop:'vehicle.soundStop',bump:'vehicle.soundBump',land:'vehicle.soundLand',scrape:'vehicle.soundScrape',skid:'vehicle.soundSkid'};
            for (const [slot,key] of Object.entries(slots)) {
                if (options.stockKey && ['bump','land','scrape','skid'].includes(slot)) continue;
                const music=slot==='bgm',loop=['idle','accelerate','slowdown'].includes(slot);
                const sound=music ? options.stockKey?options.stock.bgm:live.bgm : slot==='idle' ? sounds.idle || sounds.engine : sounds[slot];
                const folder=music?'bgm':loop?'bgs':'se';
                const row=document.createElement('div'); row.className='vehicle-sound-row';
                const label=document.createElement('span'); label.textContent=music?'BGM':this.t(key);
                const button=document.createElement('button'); button.type='button'; button.className='rr-btn-secondary vehicle-sound-browse'; button.dataset.sound=slot;
                button.textContent=sound?.name ? (loop && sound.folder!=='bgs'?'SE · ':'')+sound.name : music?this.t('vehicle.musicUnchanged'):loop && slot!=='idle'?this.t('vehicle.useIdle'):this.tt('(None)');
                button.title=button.textContent;
                button.onclick=()=>{
                    const path=require('path'),dir=path.join(this.projectManager.getCurrentProject().path,'audio',folder);
                    const picker=RRAudioPickerModal.open({title:label.textContent,folderLabel:folder.toUpperCase(),files:RRAssetFiles.listUnique(dir,RRAssetFiles.AUDIO_EXTENSIONS),selected:loop && sound?.folder!=='bgs'?'':sound?.name || '',levels:sound || {volume:90,pitch:100,pan:0},loopDefault:music || loop,onOk:audio=>{
                        if (!valid()) return;
                        if (music && options.stockKey) { options.stock.bgm=audio; this.changed(); }
                        else if (music) { live.bgm=audio.name?audio:null; save(); }
                        else { live.sounds={...live.sounds,[slot]:audio.name?{...audio,...(loop?{folder:'bgs'}:{})}:null}; if(slot==='idle')live.sounds.engine=null; save(); }
                        fillSounds();
                    }});
                    if (picker?.modal) this.parentEditor.registerDetailModal(picker.modal,()=>picker.close?.());
                };
                row.append(label,button); find(loop || music?'.vehicle-sound-rows':'.vehicle-effect-rows').appendChild(row);
            }
        };
        const fillMovement = () => {
            if (options.stockKey) return;
            const type = typed(), host = find('.vehicle-medium-settings');
            host.innerHTML = type.medium === 'air' ? field(t('vehicle.flightHeight'),`<input class="vehicle-flight-height" type="number" min="0" max="99" step="0.1" value="${type.flight.height}">`) : type.medium === 'water' ? field(tt('Type'),`<select class="vehicle-passability"><option value="boat" ${type.passability === 'boat' ? 'selected' : ''}>${tt('Boat')}</option><option value="ship" ${type.passability === 'ship' ? 'selected' : ''}>${tt('Ship')}</option></select>`) : '';
            const flight = host.querySelector('input');
            if (flight) flight.onchange = event => { const height=Number(event.target.value); if (!event.target.value.trim() || !Number.isFinite(height) || height<0 || height>99) { event.target.value=type.flight.height; return; } live.flight={...live.flight,height}; save(); };
            const passability = host.querySelector('select');
            if (passability) passability.onchange = event => { live.passability=event.target.value; save(); };
            const handling = find('.vehicle-handling'); handling.innerHTML='';
            for (const [key,label] of Object.entries({speed:'vehicle.speed',toTopSpeed:'vehicle.acceleration',turnCircle:'vehicle.turn',brake:'vehicle.brake',coast:'vehicle.coast',reverse:'vehicle.reverse',lean:'vehicle.lean',jump:'vehicle.jump'})) {
                const [min,max]=engine.RANGES.handling[key];
                const row=document.createElement('div'); row.innerHTML=field(t(label),`<input class="vehicle-handling-input" data-handling="${key}" type="number" min="${min}" max="${max}" step="0.01" value="${type.handling[key]}">`);
                row.querySelector('input').onchange=event => { const value=Number(event.target.value); if (!event.target.value.trim() || !Number.isFinite(value) || value<min || value>max) { event.target.value=typed().handling[key]; return; } live.handling={...live.handling,[key]:value}; save(); };
                handling.appendChild(row);
            }
        };
        if (!options.stockKey) find('.vehicle-medium').onchange = event => { live.medium=event.target.value; save(); fillMovement(); };
        const fillEquipment = () => {
            const system=this.databaseManager.getSystem(), selected=this.databaseManager.getClass(live.classId);
            const slots=engine.equipmentSlots(selected || {},system.equipTypes), traits=[...(selected?.traits || []),...(live.traits || [])];
            const host=find('.vehicle-equipment-rows'); host.innerHTML='';
            const items=[];
            slots.forEach((etypeId,index) => {
                const weapon=etypeId===1, records=weapon?this.databaseManager.getWeapons():this.databaseManager.getArmors();
                const allowed=records.filter(item => item.etypeId===etypeId && traits.some(trait => trait.code===(weapon?51:52) && trait.dataId===(weapon?item.wtypeId:item.atypeId)) && !traits.some(trait => trait.code===54 && trait.dataId===etypeId));
                const equipped=Number(live.equips?.[index]) || 0; items[index]=allowed.find(item=>item.id===equipped);
                const label=system.equipTypes[etypeId]+(slots.filter(slot=>slot===etypeId).length>1 ? ' '+(slots.slice(0,index+1).filter(slot=>slot===etypeId).length) : '');
                const row=document.createElement('label'); row.className='vehicle-equipment-row';
                row.innerHTML=`<span>${rrEscapeHtml(label)}</span><select class="vehicle-equip" data-slot="${index}"><option value="0">${tt('(None)')}</option>${allowed.map(item => `<option value="${item.id}" ${item.id===equipped?'selected':''}>${rrEscapeHtml(item.name)}</option>`).join('')}${equipped && !items[index] ? `<option value="${equipped}" selected>#${equipped} (${t('vehicle.incompatible')})</option>` : ''}</select>`;
                row.querySelector('select').onchange=event => { live.equips=[...(live.equips || [])]; live.equips[index]=Number(event.target.value); save(); fillEquipment(); };
                host.appendChild(row);
            });
            const stats=find('.vehicle-base-stats'); stats.innerHTML='';
            if (!selected) { stats.textContent=this.t('vehicle.noClass'); return; }
            const names=typeof rrParamNames==='function' ? rrParamNames(text=>this.tt(text)) : ['HP','MP','ATK','DEF','MAT','MDF','AGI','LUK'];
            (selected.params || []).forEach((curve,param) => {
                const base=typeof rrClassParamAtLevel==='function' ? rrClassParamAtLevel(curve,live.initialLevel || 1) : Number(curve?.[live.initialLevel || 1]) || 0;
                const plus=items.reduce((sum,item)=>sum+(Number(item?.params?.[param])||0),0);
                const rate=[...traits,...items.flatMap(item=>item?.traits || [])].reduce((rate,trait)=>trait.code===21 && trait.dataId===param ? rate*trait.value : rate,1);
                const value=Math.round(Math.max(param===0?1:0,Math.max(0,base+plus)*rate));
                const row=document.createElement('div'); row.innerHTML=`<span>${rrEscapeHtml(names[param])}</span><strong>${value}</strong>`; stats.appendChild(row);
            });
        };
        const common = this.parentEditor.commonUI;
        const traits = new DatabaseActorEditor(this.databaseManager,this.projectManager,common,this.parentEditor);
        const traitView={...live,traits:structuredClone(live.traits || [])}; traits.currentActor=traitView;
        traits.recordOwner={save:entry=>{if(valid()){live.traits=entry.traits;save();}},refresh};
        find('.vehicle-traits-host').appendChild(traits.createTraitsSection(traitView));
        const skills = new DatabaseClassEditor(this.databaseManager,this.projectManager,common,this.parentEditor);
        const skillView={...live,learnings:structuredClone(live.learnings || [])}; skills.currentClass=skillView;
        skills.recordOwner={save:entry=>{if(valid()){live.learnings=entry.learnings;save();}},refresh};
        const skillsSection=skills.createLearnableSkillsSection(skillView);
        const selected=this.databaseManager.getClass(live.classId);
        if (selected?.learnings?.length) {
            const inherited=document.createElement('details'); inherited.className='vehicle-hint vehicle-inherited-skills';
            const summary=document.createElement('summary'); summary.textContent=this.tt('Class')+': '+selected.name; inherited.appendChild(summary);
            selected.learnings.forEach(learning=>{const row=document.createElement('div');row.textContent=`${learning.level} · ${this.databaseManager.getSkill(learning.skillId)?.name || '#'+learning.skillId}`;inherited.appendChild(row);});
            skillsSection.querySelector('.database-section-content').appendChild(inherited);
        }
        find('.vehicle-skills-host').appendChild(skillsSection);
        fillMovement(); fillEquipment(); fillSounds();
    }
}
if (typeof globalThis !== 'undefined') globalThis.DatabaseVehicleEditor = DatabaseVehicleEditor;
if (typeof module !== 'undefined' && module.exports) module.exports = DatabaseVehicleEditor;

/**
 * The on-map battle commands — Reactor commands stored as MZ plugin commands
 * (code 357, plugin "RPGReactor"), read by runtime/reactor_fight.js; a stock
 * MZ runtime ignores them.
 *
 *   ChangeBattleMode  the mode for the whole game, this map, or the next battle
 *   StartMapBattle    a battle on the map: troop, turns, goal, what a transfer does
 *   SpawnUnit         a new unit, as an event, at a cell, by an event or from variables
 *   RemoveUnit        a unit leaves the battle (no reward)
 *   EndMapBattle      ends it as a win, an escape or a loss
 */
class FightCommandEditor {
    static NAMES = ['ChangeBattleMode', 'StartMapBattle', 'SpawnUnit', 'RemoveUnit', 'EndMapBattle'];
    static LABELS = {
        ChangeBattleMode: 'Change Battle Mode', StartMapBattle: 'Start Battle on Map', SpawnUnit: 'Spawn Unit',
        RemoveUnit: 'Remove Unit', EndMapBattle: 'End Battle on Map'
    };
    static MODES = [['classic', 'Classic'], ['tactical', 'Tactical'], ['action', 'Action'], ['firstPerson', 'First Person']];
    static SCOPES = [['game', 'The whole game'], ['map', 'This map'], ['next', 'The next battle']];
    static RESULTS = [['win', 'Win'], ['escape', 'Escape'], ['lose', 'Lose']];

    constructor(databaseManager) {
        this.databaseManager = databaseManager;
    }

    static supports(name) {
        return FightCommandEditor.NAMES.includes(name);
    }

    static _t(text, params) {
        if (typeof window === 'undefined' || !window.I18n) {
            return params ? String(text).replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m)) : text;
        }
        return params ? window.I18n.formatText(text, params) : window.I18n.tText(text);
    }

    _t(text, params) {
        return FightCommandEditor._t(text, params);
    }

    _manager() {
        return this.databaseManager || (typeof window !== 'undefined' && window.reactor && window.reactor.databaseManager) || null;
    }

    /** A database list as [id, "0001: Name"]. */
    _records(kind) {
        const manager = this._manager();
        const list = manager && manager.data ? manager.data[kind] : null;
        return (Array.isArray(list) ? list : []).filter(entry => entry && entry.id > 0)
            .map(entry => [String(entry.id), String(entry.id).padStart(4, '0') + ': ' + (entry.name || '')]);
    }

    show(command, callback, nameHint) {
        const params = (command && command.parameters) || [];
        const name = FightCommandEditor.supports(params[1]) ? params[1] : (FightCommandEditor.supports(nameHint) ? nameHint : 'StartMapBattle');
        const args = (params[3] && typeof params[3] === 'object') ? params[3] : {};
        const escape = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const options = (list, current) => list.map(([value, label]) => `<option value="${escape(value)}"${String(value) === String(current) ? ' selected' : ''}>${escape(label)}</option>`).join('');
        const tr = list => list.map(([value, label]) => [value, this._t(label)]);
        const select = (cls, list, current) => `<select class="fc-${cls} database-field-value">${options(list, current)}</select>`;
        const number = (cls, value, min = 0, max = 9999) => `<input type="number" class="fc-${cls} database-field-value" value="${escape(value)}" min="${min}" max="${max}" step="1">`;
        const check = (cls, label, on) => `<label class="fc-check"><input type="checkbox" class="fc-${cls}"${on ? ' checked' : ''}> ${escape(this._t(label))}</label>`;
        const row = (label, inner, cls = '') => `<div class="fc-row${cls ? ' ' + cls : ''}"><span>${escape(this._t(label))}</span>${inner}</div>`;
        const asSet = [['', this._t('As set')]];
        let body = '';
        if (name === 'ChangeBattleMode') {
            body += row('Battle Mode', select('mode', tr(FightCommandEditor.MODES).concat([['default', this._t('As set')]]), args.mode || 'tactical'));
            body += row('Applies to', select('scope', tr(FightCommandEditor.SCOPES), args.scope || 'game'));
            body += `<div class="fc-hint">${escape(this._t('Classic is the separate battle screen; Tactical, Action and First Person fight on the map.'))}</div>`;
        } else if (name === 'StartMapBattle') {
            body += row('Battle Mode', select('mode', asSet.concat(tr(FightCommandEditor.MODES.slice(1))), args.mode || ''));
            body += row('Troop', select('troop', [['0', this._t('(Units on the map)')]].concat(this._records('troops')), String(args.troopId || 0)));
            body += row('Turn order', select('turns', asSet.concat(tr([['team', 'Team turns'], ['initiative', 'Initiative order']])), args.turns || ''));
            body += row('Goal', select('objective', tr([['defeatAll', 'Defeat every enemy'], ['survive', 'Survive a number of turns'], ['defeatUnit', 'Defeat one unit']]), args.objective || 'defeatAll'));
            body += row('Turns to survive', number('survive', args.turnsToSurvive || 5, 1, 999), 'fc-when-survive');
            body += row('Event', number('unit', args.unitEventId || 1, 1, 9999), 'fc-when-unit');
            body += row('If the party leaves the map', select('transfer', tr([['escape', 'End it as an escape'], ['keep', 'Keep it for their return']]), args.onTransfer || 'escape'));
            body += row('Music', select('bgm', tr([['battle', 'Battle music'], ['map', "Keep the map's music"]]), args.bgm || 'battle'));
            body += `<div class="fc-checks">${check('escape', 'Can Escape', args.canEscape !== false)}${check('lose', 'Can Lose', !!args.canLose)}${check('wait', 'Wait until it ends', !!args.wait)}</div>`;
            body += row('Result into variable', number('variable', args.resultVariable || 0, 0, 9999), 'fc-when-wait');
        } else if (name === 'SpawnUnit') {
            const record = args.record === 'actor' ? 'actor' : 'enemy';
            body += row('Who', `<div class="fc-pair">${select('record', tr([['enemy', 'Enemy'], ['actor', 'Actor']]), record)}<select class="fc-id database-field-value"></select></div>`);
            body += row('Team', select('team', tr([['enemy', 'Enemy'], ['ally', 'Ally'], ['neutral', 'Neutral']]), args.team || (record === 'actor' ? 'ally' : 'enemy')));
            body += row('Where', select('at', tr([['cell', 'At a cell'], ['event', 'Next to an event'], ['variables', 'From variables']]), args.at || 'cell'));
            body += row('Event', number('event', args.eventId || 0, 0, 9999), 'fc-when-event');
            body += `<div class="fc-hint fc-when-event">${escape(this._t('0 is this event.'))}</div>`;
            body += row('X', number('x', args.x || 0), 'fc-when-xy');
            body += row('Y', number('y', args.y || 0), 'fc-when-xy');
            body += row('Looks like event', number('template', args.template || 0, 0, 9999));
        } else if (name === 'RemoveUnit') {
            body += row('Event', number('event', args.eventId || 0, 0, 9999));
            body += `<div class="fc-hint">${escape(this._t('0 is this event.'))}</div>`;
            body += `<div class="fc-checks">${check('keep', 'Leave it on the map', !!args.keep)}</div>`;
        } else {
            body += row('Result', select('result', tr(FightCommandEditor.RESULTS), args.result || 'win'));
        }

        const modal = document.createElement('div');
        modal.className = 'rr-modal-overlay';
        modal.style.zIndex = '21000';
        const title = window.I18n && window.I18n.tEventCommandName
            ? window.I18n.tEventCommandName(FightCommandEditor.LABELS[name]) : FightCommandEditor.LABELS[name];
        modal.innerHTML = `
            <div class="rr-modal fc-modal" style="width:min(460px,92vw);display:flex;flex-direction:column;">
                <div class="rr-modal-header">
                    <div class="rr-modal-title">${escape(title)}</div>
                    <button type="button" class="rr-modal-close fc-cancel">&times;</button>
                </div>
                <div class="rr-modal-body fc-body">${body}</div>
                <div class="rr-modal-footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;">
                    <button type="button" class="rr-btn-secondary fc-cancel">${window.I18n ? window.I18n.t('common.cancel') : 'Cancel'}</button>
                    <button type="button" class="rr-button-primary fc-ok">${window.I18n ? window.I18n.t('common.ok') : 'OK'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const $ = cls => modal.querySelector('.fc-' + cls);

        // Rows that only matter for one choice show with it.
        const showWhen = (cls, on) => modal.querySelectorAll('.fc-when-' + cls).forEach(el => { el.style.display = on ? '' : 'none'; });
        const refresh = () => {
            if (name === 'StartMapBattle') {
                showWhen('survive', $('objective').value === 'survive');
                showWhen('unit', $('objective').value === 'defeatUnit');
                showWhen('wait', $('wait').checked);
            } else if (name === 'SpawnUnit') {
                showWhen('event', $('at').value === 'event');
                showWhen('xy', $('at').value !== 'event');
            }
        };
        if (name === 'SpawnUnit') {
            const fillIds = () => {
                const list = this._records($('record').value === 'actor' ? 'actors' : 'enemies');
                const current = String(args.id || (list[0] ? list[0][0] : 1));
                $('id').innerHTML = options(list.length ? list : [[current, current]], current);
            };
            fillIds();
            $('record').addEventListener('change', () => {
                fillIds();
                $('team').value = $('record').value === 'actor' ? 'ally' : 'enemy';
            });
            $('at').addEventListener('change', refresh);
        }
        if (name === 'StartMapBattle') {
            $('objective').addEventListener('change', refresh);
            $('wait').addEventListener('change', refresh);
        }
        refresh();

        const close = () => { if (modal.parentNode) modal.parentNode.removeChild(modal); };
        modal.querySelectorAll('.fc-cancel').forEach(button => button.addEventListener('click', () => { close(); callback(null); }));
        $('ok').addEventListener('click', () => {
            const value = cls => $(cls) ? $(cls).value : '';
            const int = cls => Math.max(0, Math.floor(Number(value(cls)) || 0));
            let built = {};
            if (name === 'ChangeBattleMode') built = { mode: value('mode'), scope: value('scope') };
            else if (name === 'StartMapBattle') {
                built = { mode: value('mode'), troopId: int('troop'), turns: value('turns'), objective: value('objective'),
                    onTransfer: value('transfer'), bgm: value('bgm'), canEscape: $('escape').checked, canLose: $('lose').checked, wait: $('wait').checked };
                if (built.objective === 'survive') built.turnsToSurvive = Math.max(1, int('survive'));
                if (built.objective === 'defeatUnit') built.unitEventId = Math.max(1, int('unit'));
                if (built.wait && int('variable') > 0) built.resultVariable = int('variable');
            } else if (name === 'SpawnUnit') {
                built = { record: value('record'), id: int('id'), team: value('team'), at: value('at'), template: int('template') };
                if (built.at === 'event') built.eventId = int('event');
                else { built.x = int('x'); built.y = int('y'); }
            } else if (name === 'RemoveUnit') built = { eventId: int('event'), keep: $('keep').checked };
            else built = { result: value('result') };
            close();
            callback(FightCommandEditor.build(name, built, (command && command.indent) || 0));
        });
    }

    /** The command as stored; params[2] is its label. */
    static build(name, args, indent = 0) {
        return {
            code: 357,
            indent,
            parameters: ['RPGReactor', name, FightCommandEditor.LABELS[name] || name, args]
        };
    }

    /** One line for the event list, in the editor's language. */
    static summary(name, args) {
        args = args || {};
        const t = FightCommandEditor._t;
        const label = (list, value) => { const hit = list.find(([v]) => v === value); return hit ? t(hit[1]) : ''; };
        const records = kind => {
            const manager = typeof window !== 'undefined' && window.reactor && window.reactor.databaseManager;
            return manager && manager.data ? manager.data[kind] : null;
        };
        const recordName = (kind, id) => {
            const list = records(kind);
            const entry = Array.isArray(list) ? list[id] : null;
            return String(id).padStart(4, '0') + (entry && entry.name ? ': ' + entry.name : '');
        };
        if (name === 'ChangeBattleMode') {
            const mode = args.mode === 'default' ? t('As set') : label(FightCommandEditor.MODES, args.mode);
            return `${mode} · ${label(FightCommandEditor.SCOPES, args.scope || 'game')}`;
        }
        if (name === 'StartMapBattle') {
            const parts = [args.troopId > 0 ? recordName('troops', args.troopId) : t('(Units on the map)')];
            if (args.mode) parts.push(label(FightCommandEditor.MODES, args.mode));
            if (args.objective === 'survive') parts.push(t('Survive {turns} turns', { turns: args.turnsToSurvive || 1 }));
            else if (args.objective === 'defeatUnit') parts.push(t('Defeat event {event}', { event: args.unitEventId || 0 }));
            if (args.wait) parts.push(t('Wait until it ends'));
            return parts.join(' · ');
        }
        if (name === 'SpawnUnit') {
            const unit = `${t(args.record === 'actor' ? 'Actor' : 'Enemy')} ${recordName(args.record === 'actor' ? 'actors' : 'enemies', args.id || 0)}`;
            if (args.at === 'event') return t('{unit} next to event {event}', { unit, event: args.eventId > 0 ? args.eventId : t('This event') });
            if (args.at === 'variables') return t('{unit} at the cell in variables {x} and {y}', { unit, x: args.x || 0, y: args.y || 0 });
            return t('{unit} at ({x}, {y})', { unit, x: args.x || 0, y: args.y || 0 });
        }
        if (name === 'RemoveUnit') return args.eventId > 0 ? t('Event {id}', { id: args.eventId }) : t('This event');
        if (name === 'EndMapBattle') return label(FightCommandEditor.RESULTS, args.result || 'win');
        return '';
    }
}

if (typeof globalThis !== 'undefined') globalThis.FightCommandEditor = FightCommandEditor;
if (typeof module !== 'undefined' && module.exports) module.exports = FightCommandEditor;

'use strict';
// The on-map battle commands from the editor's side: what FightCommandEditor
// writes is what reactor_fight.js reads, run through the real interpreter; the
// list rows say what each does; the System card and the event's Unit row and
// Battle hook write the shapes the runtime reads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fightWorld, event, page } = require('./helpers/fight-world.cjs');

const FightCommandEditor = require('../src/event/commands/FightCommandEditor.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const end = { code: 0, indent: 0, parameters: [] };

/** A world whose event 1 runs `commands` once, as an autorun. */
function runCommands(commands, options = {}) {
    const list = commands.concat([{ code: 123, indent: 0, parameters: ['A', 0] }, end]);
    const off = page({ conditions: Object.assign(page().conditions, { selfSwitchValid: true, selfSwitchCh: 'A' }) });
    return fightWorld(Object.assign({}, options, { events: [event(1, 18, 13, { pages: [page({ trigger: 3, priorityType: 0, list }), off] })].concat(options.events || []) }));
}

test('every command is a Reactor plugin command the event list names by what it does', () => {
    for (const name of FightCommandEditor.NAMES) {
        const built = FightCommandEditor.build(name, {}, 2);
        assert.equal(built.code, 357);
        assert.equal(built.indent, 2);
        assert.deepEqual(built.parameters.slice(0, 3), ['RPGReactor', name, FightCommandEditor.LABELS[name]]);
    }
    assert.equal(FightCommandEditor.summary('ChangeBattleMode', { mode: 'tactical', scope: 'next' }), 'Tactical · The next battle');
    assert.equal(FightCommandEditor.summary('SpawnUnit', { record: 'enemy', id: 2, at: 'cell', x: 12, y: 8 }), 'Enemy 0002 at (12, 8)');
    assert.equal(FightCommandEditor.summary('SpawnUnit', { record: 'actor', id: 3, at: 'event', eventId: 0 }), 'Actor 0003 next to event This event');
    assert.equal(FightCommandEditor.summary('StartMapBattle', { troopId: 0, objective: 'survive', turnsToSurvive: 3, wait: true }), '(Units on the map) · Survive 3 turns · Wait until it ends');
    assert.equal(FightCommandEditor.summary('RemoveUnit', { eventId: 0 }), 'This event');
    assert.equal(FightCommandEditor.summary('EndMapBattle', { result: 'lose' }), 'Lose');
    // Wired where the editor finds Reactor commands.
    assert.match(read('src/event/EventCommandList.js'), /FightCommandEditor\.supports\(name\)\) return this\.fightCommandEditor/);
    assert.match(read('src/event/EventCommandPicker.js'), /title: 'Battles on the Map'/);
    assert.match(read('index.html'), /src\/event\/commands\/FightCommandEditor\.js/);
});

test('Change Battle Mode as written sets the mode the runtime resolves', () => {
    const w = runCommands([FightCommandEditor.build('ChangeBattleMode', { mode: 'action', scope: 'map' }), FightCommandEditor.build('ChangeBattleMode', { mode: 'tactical', scope: 'next' })]);
    w.run(3);
    assert.equal(w.ReactorFight.resolveMode(1), 'tactical', 'the next battle');
    w.ReactorFight.changeMode('default', 'next');
    assert.equal(w.ReactorFight.resolveMode(1), 'action', 'then this map');
});

test('Start Battle on Map as written fights, waits and puts the result in its variable', () => {
    const start = FightCommandEditor.build('StartMapBattle', { mode: 'tactical', troopId: 1, turns: 'initiative', objective: 'defeatAll', onTransfer: 'escape', bgm: 'map', canEscape: true, canLose: true, wait: true, resultVariable: 1 });
    const after = { code: 121, indent: 0, parameters: [4, 4, 0] };
    const w = runCommands([start, after]);
    w.run(3);
    assert.ok(w.$gameFight.isActive());
    assert.equal(w.$gameFight._turns, 'initiative');
    assert.equal(w.$gameFight.mode(), 'tactical');
    assert.equal(w.$gameSwitches.value(4), false, 'the event waits for it');
    w.$gameVariables.setValue(1, 99);
    w.run(8000, () => w.$gameSwitches.value(4));
    assert.equal(w.$gameVariables.value(1), 0, 'a win is 0');
    assert.equal(w.$gameSwitches.value(4), true, 'and the event goes on');
});

test('the survive goal ends the battle as a win after its turns', () => {
    const w = runCommands([FightCommandEditor.build('StartMapBattle', { troopId: 0, objective: 'survive', turnsToSurvive: 2 })], { events: [event(2, 15, 10, { note: '<unit: enemy 1>' })] });
    w.$dataEnemies[1].params = [9999, 0, 1, 999, 5, 5, 1, 5];
    let turn = 0;
    w.run(8000, () => { if (w.$gameFight.isActive()) turn = w.$gameFight.turn(); return turn > 0 && !w.$gameFight.isActive(); });
    assert.equal(turn, 2);
    assert.ok(w.messages.some(text => /victorious/.test(text)));
});

test('Spawn Unit, Remove Unit and End Battle on Map as written', () => {
    const w = fightWorld({ events: [event(2, 15, 10, { note: '<unit: enemy 1>' })] });
    w.$dataEnemies[1].params[0] = 9999;
    w.$gameFight.start({ mode: 'tactical' });
    const interpreter = new w.Game_Interpreter();
    interpreter.setup([
        FightCommandEditor.build('SpawnUnit', { record: 'enemy', id: 2, team: 'enemy', at: 'cell', x: 10, y: 10, template: 0 }),
        FightCommandEditor.build('SpawnUnit', { record: 'actor', id: 3, team: 'ally', at: 'event', eventId: 2, template: 0 }),
        end
    ], 2);
    interpreter.update();
    const enemies = w.$gameFight.units({ team: 'enemy' }), allies = w.$gameFight.units({ team: 'ally' });
    assert.equal(enemies.length, 2, 'the Bat joined the enemies');
    const bat = enemies.find(unit => unit.enemy.enemyId() === 2);
    assert.deepEqual([w.$gameMap.event(bat.eventId).x, w.$gameMap.event(bat.eventId).y], [10, 10]);
    const guest = allies.find(unit => unit.actorId === 3 && !unit.party);
    const at = w.$gameMap.event(guest.eventId);
    assert.ok(Math.abs(at.x - 15) + Math.abs(at.y - 10) <= 2, 'next to event 2');
    assert.equal(w.$dataMap.events[guest.eventId].pages[0].image.characterName, 'Actor1', "an actor spawns in its own character");
    const remover = new w.Game_Interpreter();
    remover.setup([FightCommandEditor.build('RemoveUnit', { eventId: bat.eventId, keep: false }), FightCommandEditor.build('EndMapBattle', { result: 'escape' }), end], 2);
    remover.update();
    assert.ok(bat.gone && w.$gameMap.event(bat.eventId)._erased, 'removed and erased');
    w.run(300, () => !w.$gameFight.isActive());
    assert.equal(w.$gameFight.resultOf(w.$gameFight.serial()), w.ReactorFight.ESCAPE);
    assert.equal(w.$gameParty.gold(), 0, 'a removed unit gives no reward');
});

test("the editor's Unit row, Battle hook and System card write what the runtime reads", () => {
    const F = fightWorld().ReactorFight;
    // The shapes the editor writes (EventEditor.createUnitRow, EventPageEditor.createFightHookRow, the System 1 card).
    const unitWriter = read('src/event/EventEditor.js');
    assert.match(unitWriter, /const next = \{ team: team\.value, record: record\.value, id: Math\.floor\(Number\(id\.value\) \|\| 0\), move: /);
    assert.deepEqual({ ...F.unitSpecOf({ rrUnit: { team: 'enemy', record: 'enemy', id: 3, move: 5 } }, []) }, { team: 'enemy', record: 'enemy', id: 3, move: 5 });
    assert.deepEqual({ ...F.unitSpecOf({ rrUnit: { team: 'neutral', id: 0, move: 4 } }, []) }, { team: 'neutral', record: '', id: 0, move: 4 });
    const hookWriter = read('src/event/EventPageEditor.js');
    assert.match(hookWriter, /page\.rrFightHook = next;/);
    for (const raw of [{ on: 'battleStart' }, { on: 'turnStart', turn: 2, team: 'enemy' }, { on: 'turnEnd', turn: 0, team: 'any' }, { on: 'unitDefeated', unit: 'this' }, { on: 'unitEnters', region: 3, team: 'ally' }]) {
        assert.ok(F.normalizeHook(raw), `${raw.on} as the page writes it is a hook`);
    }
    const systemWriter = read('src/database/DatabaseSystem1Editor.js');
    assert.match(systemWriter, /system\.reactorBattle = \{ mode, turns \}/);
    const w = fightWorld({ system: { reactorBattle: { mode: 'firstPerson', turns: 'initiative' } } });
    assert.equal(w.ReactorFight.resolveMode(1), 'firstPerson');
    assert.equal(w.ReactorFight.resolveTurns(), 'initiative');
});

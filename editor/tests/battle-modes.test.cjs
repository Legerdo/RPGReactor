'use strict';
// Battles on the live map (runtime/reactor_fight.js, docs/DESIGN-BATTLE-MODES.md phase 1):
// the mode switch, units from cards, tags and PTBS comments, damage through the
// stock Game_Action, outcomes into Battle Processing's branches and rewards,
// hooks, the pause rules, save and load mid-fight, and Classic left alone.
const assert = require('node:assert/strict');
const test = require('node:test');
const { fightWorld, event, page } = require('./helpers/fight-world.cjs');

const battleProcessing = (troopId, canEscape = true, canLose = true) => [
    { code: 301, indent: 0, parameters: [0, troopId, canEscape, canLose] },
    { code: 601, indent: 0, parameters: [] }, { code: 121, indent: 1, parameters: [1, 1, 0] }, { code: 0, indent: 1, parameters: [] },
    { code: 602, indent: 0, parameters: [] }, { code: 121, indent: 1, parameters: [2, 2, 0] }, { code: 0, indent: 1, parameters: [] },
    { code: 603, indent: 0, parameters: [] }, { code: 121, indent: 1, parameters: [3, 3, 0] }, { code: 0, indent: 1, parameters: [] },
    { code: 604, indent: 0, parameters: [] },
    // Once: the autorun page turns itself off.
    { code: 123, indent: 0, parameters: ['A', 0] },
    { code: 0, indent: 0, parameters: [] }
];
const starter = (id, list) => event(id, 18, 13, { pages: [page({ trigger: 3, priorityType: 0, list }), page({ conditions: Object.assign(page().conditions, { selfSwitchValid: true, selfSwitchCh: 'A' }) })] });
const reactor = (name, args, indent = 0) => ({ code: 357, indent, parameters: ['RPGReactor', name, name, args] });
const outcome = w => [1, 2, 3].find(i => w.$gameSwitches.value(i)) || 0;
const done = w => () => outcome(w) > 0 && !w.$gameFight.isActive();

test('the mode comes from the next-battle command, then the troop, then the map, then the game, then System', () => {
    const w = fightWorld();
    const F = w.ReactorFight;
    assert.equal(F.resolveMode(1), 'classic', 'stock data plays Classic');
    w.$dataSystem.reactorBattle = { mode: 'action' };
    assert.equal(F.resolveMode(1), 'action');
    F.changeMode('firstPerson', 'game');
    assert.equal(F.resolveMode(1), 'firstPerson', 'a game-wide command beats System');
    w.$dataMap.note = '<battle mode: tactical>';
    assert.equal(F.resolveMode(1), 'tactical', 'the map beats the game');
    F.changeMode('action', 'map');
    assert.equal(F.resolveMode(1), 'action', "a command for this map beats the map's own");
    assert.equal(F.resolveMode(2), 'tactical', 'the troop beats the map');
    F.changeMode('classic', 'next');
    assert.equal(F.resolveMode(2), 'classic', 'the next battle beats the troop');
    F.changeMode('default', 'next');
    assert.equal(F.resolveMode(2), 'tactical', '"default" clears that scope');
    const saved = w.JsonEx.parse(w.JsonEx.stringify(w.$gameSystem));
    assert.equal(saved._rrBattle.game, 'firstPerson', 'the overrides are saved with Game_System');
    assert.equal(saved._rrBattle.maps[1], 'action');
});

test('events become units by card, note tag, page comment or PTBS comment', () => {
    const F = fightWorld().ReactorFight;
    assert.deepEqual({ ...F.parseUnitText('enemy 5') }, { team: 'enemy', record: 'enemy', id: 5, move: 4 });
    assert.deepEqual({ ...F.parseUnitText('actor 3 move 6') }, { team: 'ally', record: 'actor', id: 3, move: 6 });
    assert.deepEqual({ ...F.parseUnitText('ally 2') }, { team: 'ally', record: 'actor', id: 2, move: 4 });
    assert.deepEqual({ ...F.parseUnitText('ally enemy 4') }, { team: 'ally', record: 'enemy', id: 4, move: 4 });
    assert.deepEqual({ ...F.parseUnitText('neutral') }, { team: 'neutral', record: '', id: 0, move: 4 });
    assert.equal(F.parseUnitText('enemy'), null, 'a combatant needs a record');
    const comment = text => [{ code: 108, indent: 0, parameters: [text] }];
    assert.equal(F.unitSpecOf({ rrUnit: { team: 'enemy', record: 'enemy', id: 2, move: 3 }, note: '<unit: actor 1>' }, []).id, 2, 'the card wins');
    assert.equal(F.unitSpecOf({ note: '<unit: enemy 7>' }, comment('PTBS_Actor: 1')).id, 7, 'then the note');
    assert.equal(F.unitSpecOf({ note: '' }, comment('<unit: enemy 6>')).id, 6, 'then a page comment');
    assert.deepEqual({ ...F.unitSpecOf({ note: '' }, comment('PTBS_Enemy: 4')) }, { team: 'enemy', record: 'enemy', id: 4, move: 4 });
    assert.deepEqual({ ...F.unitSpecOf({ note: '' }, comment('PTBS_PartyActor: 2')) }, { team: 'ally', record: 'actor', id: 2, move: 4 });
    assert.equal(F.unitSpecOf({ note: '' }, comment('just a note')), null);
});

test('Battle Processing on an on-map mode fights on the map and takes the Win branch with the rewards', () => {
    const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1))] });
    w.run(6000, done(w));
    assert.equal(outcome(w), 1, 'If Win ran');
    assert.deepEqual([...w.pushed], [], 'no battle scene was pushed');
    assert.ok(w.messages.some(text => /victorious/.test(text)), 'the victory message');
    assert.equal(w.$gameParty.gold(), 14, "both Slimes' gold");
    assert.equal(w.$gameParty.numItems(w.$dataItems[1]), 2, 'both drops');
    assert.equal(w.$gameActors.actor(1).currentExp() - w.$gameActors.actor(1).expForLevel(5), 20, 'the EXP of both');
    assert.equal(w.$gameTroop.members().length, 0, 'the troop is cleared after');
    assert.equal(w.$gamePlayer.followers().data()[0].isThrough(), true, 'followers trail again');
});

test('damage is the stock Game_Action: the formula, the result, the popup data', () => {
    const w = fightWorld({ events: [event(1, 3, 3, { note: '<unit: enemy 1>' })] });
    w.$dataEnemies[1].params[0] = 1000;
    w.$gameFight.start({ mode: 'tactical' });
    w.run(400, () => w.$gameFight.unitOfEvent(1) && w.$gameFight.unitOfEvent(1).enemy.hp < 1000);
    const enemy = w.$gameFight.unitOfEvent(1).enemy;
    assert.equal(enemy.hp, 1000 - (60 * 4 - 5 * 2), 'a.atk * 4 - b.def * 2');
    assert.equal(enemy.result().hpDamage, 230, 'the result the popup reads');
});

test('a fight the party loses takes If Lose when it can be lost, and Game Over when it cannot', () => {
    const lose = canLose => {
        const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1, true, canLose))] });
        w.$dataEnemies[1].params = [5000, 0, 999, 999, 5, 5, 99, 5];
        w.run(9000, () => (canLose ? done(w)() : w.pushed.length > 0));
        return w;
    };
    const survivable = lose(true);
    assert.equal(outcome(survivable), 3, 'If Lose ran');
    assert.ok(survivable.$gameParty.battleMembers().every(actor => actor.hp > 0), 'the party is revived');
    const fatal = lose(false);
    assert.deepEqual([...fatal.pushed], ['goto:Scene_Gameover']);
});

test('End Battle ends it as told, and leaving the map ends it as an escape unless it was kept', () => {
    const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1))] });
    w.run(5);
    assert.ok(w.$gameFight.isActive());
    w.$gameFight.end(w.ReactorFight.ESCAPE);
    w.run(200, done(w));
    assert.equal(outcome(w), 2, 'If Escape ran');
    assert.ok(w.messages.some(text => /escape/.test(text)));

    const t = fightWorld({ events: [event(1, 6, 6, { note: '<unit: enemy 1>' })] });
    t.$dataEnemies[1].params[0] = 9999;
    const serial = t.$gameFight.start({ mode: 'tactical' });
    t.$gamePlayer.reserveTransfer(2, 1, 1);
    assert.equal(t.$gameFight.isActive(), false, 'a transfer away ends it');
    assert.equal(t.$gameFight.resultOf(serial), t.ReactorFight.ESCAPE);

    const k = fightWorld({ events: [event(1, 6, 6, { note: '<unit: enemy 1>' })] });
    k.$gameFight.start({ mode: 'tactical', onTransfer: 'keep' });
    k.$gamePlayer.reserveTransfer(2, 1, 1);
    assert.equal(k.$gameFight.isActive(), true, '"keep" keeps it for when the party returns');
});

test('a turn-2 hook spawns a reinforcement that joins and is fought; the defeat and area hooks fire', () => {
    const hook = (on, extra, list) => page({ rrFightHook: Object.assign({ on }, extra), list: list.concat([{ code: 0, indent: 0, parameters: [] }]) });
    const caller = event(2, 10, 1, { pages: [page(), hook('turnStart', { turn: 2, team: 'enemy' }, [reactor('SpawnUnit', { record: 'enemy', id: 2, team: 'enemy', at: 'cell', x: 12, y: 8 })])] });
    const watcher = event(3, 11, 1, { pages: [page(), hook('unitDefeated', { unit: 'enemy' }, [{ code: 122, indent: 0, parameters: [1, 1, 1, 0, 1] }])] });
    const gate = event(4, 12, 1, { pages: [page(), hook('unitEnters', { team: 'ally', x0: 0, y0: 4, x1: 19, y1: 14 }, [{ code: 121, indent: 0, parameters: [5, 5, 0] }])] });
    const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1)), caller, watcher, gate] });
    w.$dataEnemies[1].params[0] = 400;
    let spawnedAt = 0;
    w.run(12000, () => {
        if (!spawnedAt && w.$gameFight.isActive() && w.$gameFight.units({ team: 'enemy' }).length === 3) spawnedAt = w.$gameFight.turn();
        return done(w)();
    });
    assert.equal(spawnedAt, 2, 'the reinforcement arrived on turn 2');
    assert.equal(outcome(w), 1, 'and the party still won');
    assert.equal(w.$gameVariables.value(1), 3, 'the defeat hook ran once per enemy, reinforcement included');
    assert.equal(w.$gameSwitches.value(5), true, 'an ally stepped into the area');
    assert.equal(w.$gameParty.gold(), 14 + 3, "the reinforcement's gold too");
    assert.equal(w.$gameMap.event(2).page(), w.$gameMap.event(2).event().pages[0], 'a hook page is never the shown page');
});

test('the fight waits for messages and running events; parallel events never hold it', () => {
    const parallel = event(2, 15, 1, { pages: [page({ trigger: 4, list: [{ code: 230, indent: 0, parameters: [1] }, { code: 0, indent: 0, parameters: [] }] })] });
    const w = fightWorld({ events: [event(1, 8, 8, { note: '<unit: enemy 1>' }), parallel] });
    w.$dataEnemies[1].params[0] = 9999;
    w.$gameFight.start({ mode: 'tactical' });
    w.run(60);
    const turn = w.$gameFight.turn();
    assert.ok(turn >= 1, 'a parallel event does not hold the battle');
    w.$gameMessage.add('Wait.');
    const before = JSON.stringify(w.$gameFight._act);
    for (let i = 0; i < 120; i++) { w.$gameMap.update(true); w.$gamePlayer.update(true); }
    assert.equal(JSON.stringify(w.$gameFight._act), before, 'nothing moved while the message was up');
    w.$gameMessage.clear();
    w.run(120);
    assert.notEqual(JSON.stringify(w.$gameFight._act), before);
});

test('a fight saved mid-turn loads back into the same fight and finishes it', () => {
    const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1))] });
    w.$dataEnemies[1].params[0] = 300;
    w.run(400, () => w.$gameFight.turn() >= 2);
    assert.ok(w.$gameFight.isActive());
    const json = w.JsonEx.stringify(w.DataManager.makeSaveContents());
    const units = w.$gameFight._units.length;
    // A fresh session reads the save.
    w.DataManager.createGameObjects();
    w.DataManager.extractSaveContents(w.JsonEx.parse(json));
    assert.ok(w.$gameFight instanceof w.Game_Fight && w.$gameFight.isActive(), 'the fight came back');
    assert.equal(w.$gameFight._units.length, units);
    assert.equal(w.$gameTroop.members().length, w.$gameFight._units.filter(u => u.enemy).length, 'the troop is rebuilt from the units');
    assert.equal(w.$gameMap._interpreter._waitMode, 'reactorFight', 'Battle Processing still waits for it');
    w.ReactorFight.restoreSpawned();
    w.run(12000, done(w));
    assert.equal(outcome(w), 1, 'and takes If Win when it ends');
});

test('Classic stays the battle scene, and battle-scene plugins never run during an on-map fight', () => {
    const w = fightWorld({ events: [starter(1, battleProcessing(1))] });
    w.run(3);
    assert.deepEqual([...w.pushed], ['Scene_Battle'], 'Classic pushes the battle scene as before');
    assert.equal(w.$gameFight.isActive(), false);

    const m = fightWorld({ system: { reactorBattle: { mode: 'action' } }, events: [starter(1, battleProcessing(1))] });
    let patched = 0;
    m.BattleManager.setup = () => { patched++; };
    m.Scene_Battle.prototype.start = () => { patched++; };
    m.run(6000, done(m));
    assert.equal(patched, 0, 'neither BattleManager.setup nor Scene_Battle ran');
    assert.equal(outcome(m), 1);
});

test('battle-only items work for units during an on-map fight', () => {
    const w = fightWorld({ events: [event(1, 8, 8, { note: '<unit: enemy 1>' })] });
    const actor = w.$gameActors.actor(1);
    w.$gameParty.gainItem(w.$dataItems[2], 1);
    assert.equal(actor.canUse(w.$dataItems[2]), false, 'a battle item on the map, outside a fight');
    w.$gameFight.start({ mode: 'tactical' });
    assert.equal(actor.canUse(w.$dataItems[2]), true, 'in an on-map fight');
});

test('the fight reports itself on the runtime events feed', () => {
    const w = fightWorld({ system: { reactorBattle: { mode: 'tactical' } }, events: [starter(1, battleProcessing(1))] });
    const seen = [];
    for (const name of ['mapBattleStart', 'mapBattleTurnStart', 'unitDefeated', 'mapBattleEnd']) w.ReactorEvents.on(name, payload => seen.push([name, payload]));
    w.run(6000, done(w));
    assert.deepEqual([...new Set(seen.map(([name]) => name))], ['mapBattleStart', 'mapBattleTurnStart', 'unitDefeated', 'mapBattleEnd']);
    assert.equal(seen.find(([name]) => name === 'mapBattleEnd')[1].result, 0);
    assert.equal(seen.filter(([name]) => name === 'unitDefeated').length, 2);
});

test('hooks read from a comment as well as the page field', () => {
    const F = fightWorld().ReactorFight;
    assert.deepEqual({ ...F.pageHook({ list: [{ code: 108, parameters: ['<fight hook: turnStart turn=2 team=enemy>'] }] }) }, { on: 'turnStart', turn: 2, team: 'enemy' });
    assert.deepEqual({ ...F.pageHook({ list: [{ code: 108, parameters: ['<fight hook: unitEnters region=4>'] }] }) }, { on: 'unitEnters', team: 'any', region: 4 });
    assert.deepEqual({ ...F.pageHook({ rrFightHook: { on: 'unitDefeated', unit: 12 } }) }, { on: 'unitDefeated', unit: 12 });
    assert.equal(F.pageHook({ rrFightHook: { on: 'nonsense' } }), null);
});

test('a battle nobody can move or act in ends as an escape instead of running forever', () => {
    const w = fightWorld({ events: [event(1, 10, 10, { note: '<unit: enemy 1>' })] });
    // Walls (an impassable tile) all round the enemy's cell.
    w.$dataTilesets[1].flags[1537] = 0x0f;
    for (const [x, y] of [[9, 9], [10, 9], [11, 9], [9, 10], [11, 10], [9, 11], [10, 11], [11, 11]]) w.$dataMap.data[y * 20 + x] = 1537;
    const warned = [];
    w.console = Object.assign({}, console, { warn: text => warned.push(text) });
    const serial = w.$gameFight.start({ mode: 'tactical' });
    w.run(20000, () => !w.$gameFight.isActive());
    assert.equal(w.$gameFight.isActive(), false);
    assert.equal(w.$gameFight.resultOf(serial), w.ReactorFight.ESCAPE);
});

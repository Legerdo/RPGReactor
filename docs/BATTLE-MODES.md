# Battle modes

A battle is **Classic** (the separate battle screen: front or side view, turn or time progress, battlebacks or a Battle Room) or happens **on the map**: Tactical, Action or First Person. On-map battles keep the map and its events running; every unit is a character on the map carrying a Database battler. The design and the phases still to come are in [DESIGN-BATTLE-MODES.md](DESIGN-BATTLE-MODES.md).

What works today (phase 1): the mode switch, units, damage, skills, items and states through the stock battle math, outcomes into Battle Processing's branches and the rewards, hooks, saving mid-battle, and a simple driver in which every unit walks toward its nearest opponent and attacks or uses a skill on it. Tactical, Action and First Person all run that driver until their own controls land; the player does not steer yet.

## Choosing the mode

| Where | Set by | Data |
| --- | --- | --- |
| The game | Database › System 1 › Battle Mode | `System.json › reactorBattle: { mode, turns }` |
| A map | a 3D map's sidecar, or a note tag on any map | `MapNNN.r3d.json › battle: { mode }`, `<battle mode: tactical>` |
| A troop | the troop record | `Troops.json › [id].reactorBattle: { mode }` |
| During play | the **Change Battle Mode** command (the whole game, this map, or the next battle) | `$gameSystem._rrBattle` (saved) |

The first that names a mode wins: the next-battle command, the troop, the map (a command for this map, then the map's own), the game (a command, then System). Unset everywhere, battles are Classic. `mode` is `classic`, `tactical`, `action` or `firstPerson`; `turns` is `team` (allies, then enemies) or `initiative` (everyone by AGI).

Battle Processing and random encounters on a map whose mode is on the map fight there; If Win / If Escape / If Lose follow the result.

## Units

The party's battle members are units: the leader is the player, the others the followers, who walk on their own during the fight. An event is a unit by:

- its **Battle unit** row in the event editor (side, Database record, move range), stored as `rrUnit` on the event;
- a note tag: `<unit: enemy 5>`, `<unit: actor 3>`, `<unit: ally 2>` (actor 2 on the allies' side), `<unit: ally enemy 4>`, `<unit: neutral>`, with `move N` for its move range (default 4);
- a `<unit: …>` comment on its current page, or a PSYCHRONIC_PTBS comment (`PTBS_Actor: X`, `PTBS_PartyActor: X`, `PTBS_Enemy: Y`).

A unit event keeps its pages, triggers and move routes; it stops wandering on its own while it fights. On a 3D map, a unit event with no model of its own wears the model the Database binds to its record.

## Commands

On the event command picker's Reactor tab, under **Battles on the Map**:

| Command | Does |
| --- | --- |
| Change Battle Mode | The mode for the whole game, this map, or the next battle; "As set" clears it. |
| Start Battle on Map | A battle here: a troop (its members appear round the party when the map has no enemy units of its own) or the map's units, the turn order, the goal (defeat every enemy, survive N turns, defeat one unit), what leaving the map does (end as an escape, or keep the battle for the party's return), battle music or the map's. **Wait until it ends** holds the event and can put the result (0 win, 1 escape, 2 lose) in a variable. |
| Spawn Unit | An actor or enemy as a new unit, at a cell, next to an event, or at the cell in two variables; it can look like an existing event. |
| Remove Unit | A unit leaves the battle and the map (or stays as a bystander); no reward. |
| End Battle on Map | Ends it as a win (with rewards), an escape or a loss. |

Started by Battle Processing, the battle holds the map's event interpreter, so touch, action and autorun events wait until it ends; parallel events and hooks run. A battle meant to be interrupted by them is started with Start Battle on Map, which does not wait.

## Hooks

A page with a **Battle hook** (Conditions, in the event page editor) runs when its moment comes, if its other conditions hold, and is never the page the event shows: battle starts; turn starts or ends (a turn number, 0 for every turn, and a side); unit defeated (any, an ally, an enemy, this event); a unit enters an area (a region). Stored as `rrFightHook` on the page, or written as a first-line comment such as `<fight hook: turnStart turn=2 team=enemy>`. The battle waits while a hook runs, and for any message, choice or event the map is running.

## Scripts and plugins

`$gameFight` is the battle: `isActive()`, `turn()`, `units({ team, alive })`, `unitOfEvent(id)`, `spawn({...})`, `end(result)`, `resultOf(serial)`. `ReactorFight.resolveMode(troopId)` and `ReactorFight.changeMode(mode, scope)` work the mode. The [runtime events](RUNTIME-EVENTS.md) feed reports `mapBattleStart`, `mapBattleTurnStart`, `unitDefeated` and `mapBattleEnd`. Classic battles are untouched: plugins that patch `Scene_Battle` or `BattleManager` never run during an on-map battle.

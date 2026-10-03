//=============================================================================
// reactor_fight.js — battles on the live map
//
// Classic battles stay the separate battle scene (Scene_Battle). Tactical,
// Action and First Person battles happen on the map itself: the fight is a
// state object beside the map ($gameFight), Scene_Map keeps running, map
// events keep running, and every unit is an ordinary character (the player,
// a follower or an event) carrying a Database battler. Damage, skills, items
// and states go through the stock Game_Action and Game_Battler math.
//
// This file is the framework the three map modes share (docs/DESIGN-BATTLE-
// MODES.md, phase 1): the mode switch, units, hooks, outcomes and rewards,
// save and load mid-battle, and a minimal team-turn driver in which every
// unit approaches its nearest opponent and attacks or uses a skill.
//=============================================================================

(function(root) {
    "use strict";

    const F = root.ReactorFight = root.ReactorFight || {};

    F.MODES = ["classic", "tactical", "action", "firstPerson"];
    F.ON_MAP = ["tactical", "action", "firstPerson"];
    F.TEAMS = ["ally", "enemy", "neutral"];
    F.TURNS = ["team", "initiative"];
    F.HOOKS = ["battleStart", "turnStart", "turnEnd", "unitDefeated", "unitEnters"];
    F.DEFAULT_MOVE = 4;
    // Rounds with no step taken and no action used before a stuck battle ends as an escape.
    F.IDLE_ROUNDS = 20;
    // Results, as Battle Processing's branches number them.
    F.WIN = 0;
    F.ESCAPE = 1;
    F.LOSE = 2;

    F.isMode = mode => F.MODES.includes(mode);
    F.isOnMap = mode => F.ON_MAP.includes(mode);
    F.oppose = team => (team === "ally" ? "enemy" : team === "enemy" ? "ally" : "");

    //-------------------------------------------------------------------------
    // Which mode a battle uses: the Change Battle Mode command's next-battle
    // setting, then the troop, then the map (a command for this map, else the
    // map's own setting), then the game (a command, else System). Stock data
    // has none of these and plays Classic.

    F.systemSettings = function() {
        const settings = typeof $dataSystem !== "undefined" && $dataSystem ? $dataSystem.reactorBattle : null;
        return settings && typeof settings === "object" ? settings : {};
    };

    F.overrides = function() {
        if (typeof $gameSystem === "undefined" || !$gameSystem) return {};
        if (!$gameSystem._rrBattle || typeof $gameSystem._rrBattle !== "object") $gameSystem._rrBattle = {};
        return $gameSystem._rrBattle;
    };

    /** A map's own mode: its 3D sidecar's `battle.mode`, else a `<battle mode: x>` note tag. */
    F.mapMode = function(mapData) {
        if (!mapData) return "";
        const sidecar = mapData.reactor3d && mapData.reactor3d.battle;
        if (sidecar && F.isMode(sidecar.mode)) return sidecar.mode;
        const match = /<battle\s*mode\s*:\s*(\w+)\s*>/i.exec(String(mapData.note || ""));
        return match && F.isMode(match[1]) ? match[1] : "";
    };

    F.troopMode = function(troopId) {
        const troop = typeof $dataTroops !== "undefined" && $dataTroops ? $dataTroops[troopId] : null;
        const settings = troop && troop.reactorBattle;
        return settings && F.isMode(settings.mode) ? settings.mode : "";
    };

    F.resolveMode = function(troopId) {
        const o = F.overrides();
        if (F.isMode(o.next)) return o.next;
        const troop = F.troopMode(troopId);
        if (troop) return troop;
        const mapId = typeof $gameMap !== "undefined" && $gameMap ? $gameMap.mapId() : 0;
        if (o.maps && F.isMode(o.maps[mapId])) return o.maps[mapId];
        const map = F.mapMode(typeof $dataMap !== "undefined" ? $dataMap : null);
        if (map) return map;
        if (F.isMode(o.game)) return o.game;
        const system = F.systemSettings().mode;
        return F.isMode(system) ? system : "classic";
    };

    F.resolveTurns = function() {
        const o = F.overrides();
        if (F.TURNS.includes(o.turns)) return o.turns;
        const system = F.systemSettings().turns;
        return F.TURNS.includes(system) ? system : "team";
    };

    /** The Change Battle Mode command: `scope` game / map / next; mode "default" clears that scope. */
    F.changeMode = function(mode, scope) {
        const o = F.overrides();
        const value = F.isMode(mode) ? mode : null;
        if (scope === "next") {
            if (value) o.next = value; else delete o.next;
        } else if (scope === "map") {
            const mapId = typeof $gameMap !== "undefined" && $gameMap ? $gameMap.mapId() : 0;
            o.maps = o.maps || {};
            if (value) o.maps[mapId] = value; else delete o.maps[mapId];
        } else {
            if (value) o.game = value; else delete o.game;
        }
    };

    //-------------------------------------------------------------------------
    // Units. An event is a unit by its Unit card (`rrUnit` on the event), a
    // `<unit: …>` note tag, or a PTBS comment (PTBS_Actor / PTBS_PartyActor /
    // PTBS_Enemy) on its current page, so maps made for PSYCHRONIC_PTBS fight
    // without rework.

    /**
     * `<unit: enemy 5>`, `<unit: actor 3>`, `<unit: ally 2>` (actor 2 on the
     * allies' side), `<unit: ally enemy 4>`, `<unit: neutral>`, with an
     * optional `move N`. Null when the text names no unit.
     */
    F.parseUnitText = function(text) {
        const words = String(text || "").toLowerCase().replace(/[,:]/g, " ").split(/\s+/).filter(Boolean);
        if (!words.length) return null;
        const spec = { team: "", record: "", id: 0, move: 0 };
        for (let i = 0; i < words.length; i++) {
            const word = words[i], next = Number(words[i + 1]);
            if (word === "move" && Number.isFinite(next)) { spec.move = next; i++; continue; }
            if (word === "actor" || word === "enemy" || word === "ally") {
                if (Number.isFinite(next) && next > 0) {
                    spec.record = word === "enemy" ? "enemy" : "actor";
                    spec.id = Math.floor(next);
                    if (!spec.team) spec.team = word === "enemy" ? "enemy" : "ally";
                    i++;
                } else if (word !== "actor") {
                    spec.team = word;
                }
                continue;
            }
            if (word === "neutral") spec.team = "neutral";
        }
        if (!spec.team) return null;
        return F.normalizeUnit(spec);
    };

    F.normalizeUnit = function(raw) {
        if (!raw || typeof raw !== "object") return null;
        const team = F.TEAMS.includes(raw.team) ? raw.team : null;
        if (!team) return null;
        const record = raw.record === "actor" || raw.record === "enemy" ? raw.record : "";
        const id = record ? Math.max(0, Math.floor(Number(raw.id) || 0)) : 0;
        const move = Math.max(0, Math.min(20, Math.floor(Number(raw.move) || 0)));
        // Every combatant needs a Database record; a neutral one without is a bystander.
        if (team !== "neutral" && !(record && id > 0)) return null;
        return { team, record: record && id > 0 ? record : "", id: record && id > 0 ? id : 0, move: move || F.DEFAULT_MOVE };
    };

    /** The PTBS comments on an event's current page as a unit, or null. */
    F.ptbsUnit = function(list) {
        for (const command of list || []) {
            if (!command || (command.code !== 108 && command.code !== 408)) continue;
            const text = String(command.parameters && command.parameters[0] || "");
            let match = /PTBS_(?:Party)?Actor:\s*(\d+)/i.exec(text);
            if (match) return F.normalizeUnit({ team: "ally", record: "actor", id: Number(match[1]) });
            match = /PTBS_Enemy:\s*(\d+)/i.exec(text);
            if (match) return F.normalizeUnit({ team: "enemy", record: "enemy", id: Number(match[1]) });
        }
        return null;
    };

    /** The unit an event's data names: its card, else its note tag, else a page comment or PTBS comment. */
    F.unitSpecOf = function(data, list) {
        if (!data) return null;
        if (data.rrUnit) return F.normalizeUnit(data.rrUnit);
        const note = /<unit\s*:\s*([^>]+)>/i.exec(String(data.note || ""));
        if (note) return F.parseUnitText(note[1]);
        for (const command of list || []) {
            if (!command || (command.code !== 108 && command.code !== 408)) continue;
            const tag = /<unit\s*:\s*([^>]+)>/i.exec(String(command.parameters && command.parameters[0] || ""));
            if (tag) return F.parseUnitText(tag[1]);
        }
        return F.ptbsUnit(list);
    };

    //-------------------------------------------------------------------------
    // Hooks: a page that runs when its battle condition fires. The page's
    // ordinary conditions (switches, variables, self switch, item, actor) must
    // hold too; its trigger is not used, and it never becomes the event's
    // shown page. Stored as `rrFightHook` on the page, or written as a
    // `<fight hook: turnStart turn=2 team=enemy>` comment.

    F.normalizeHook = function(raw) {
        if (!raw || typeof raw !== "object" || !F.HOOKS.includes(raw.on)) return null;
        const hook = { on: raw.on };
        const team = ["any", "ally", "enemy"].includes(raw.team) ? raw.team : "any";
        if (raw.on === "turnStart" || raw.on === "turnEnd") {
            hook.turn = Math.max(0, Math.floor(Number(raw.turn) || 0));
            hook.team = team;
        } else if (raw.on === "unitDefeated") {
            const unit = raw.unit;
            hook.unit = ["any", "ally", "enemy", "this"].includes(unit) ? unit : Math.max(0, Math.floor(Number(unit) || 0)) || "any";
        } else if (raw.on === "unitEnters") {
            hook.team = team;
            const region = Math.floor(Number(raw.region) || 0);
            if (region > 0) hook.region = region;
            else if (["x0", "y0", "x1", "y1"].every(key => Number.isFinite(Number(raw[key])))) {
                hook.x0 = Math.min(Number(raw.x0), Number(raw.x1)); hook.x1 = Math.max(Number(raw.x0), Number(raw.x1));
                hook.y0 = Math.min(Number(raw.y0), Number(raw.y1)); hook.y1 = Math.max(Number(raw.y0), Number(raw.y1));
            } else return null;
        }
        return hook;
    };

    F.parseHookText = function(text) {
        const match = /<fight\s*hook\s*:\s*(\w+)([^>]*)>/i.exec(String(text || ""));
        if (!match) return null;
        const raw = { on: match[1] };
        for (const pair of match[2].trim().split(/\s+/)) {
            const at = pair.indexOf("=");
            if (at > 0) raw[pair.slice(0, at).toLowerCase()] = pair.slice(at + 1);
        }
        return F.normalizeHook(raw);
    };

    F.pageHook = function(page) {
        if (!page) return null;
        if (page.rrFightHook) return F.normalizeHook(page.rrFightHook);
        const first = page.list && page.list[0];
        if (first && first.code === 108) return F.parseHookText(first.parameters && first.parameters[0]);
        return null;
    };

    //-------------------------------------------------------------------------
    // Rewards, worked out from the enemy-side units defeated (never from an
    // ally made of an enemy record) and given through the message window, as
    // the stock battle words them.

    F.makeRewards = function(enemies) {
        const dead = enemies.filter(enemy => enemy && enemy.isDead());
        const goldRate = typeof $gameTroop !== "undefined" && $gameTroop.goldRate ? $gameTroop.goldRate() : 1;
        return {
            exp: dead.reduce((sum, enemy) => sum + enemy.exp(), 0),
            gold: Math.floor(dead.reduce((sum, enemy) => sum + enemy.gold(), 0) * goldRate),
            items: dead.reduce((list, enemy) => list.concat(enemy.makeDropItems()), [])
        };
    };

    F.giveRewards = function(rewards) {
        $gameMessage.newPage();
        $gameMessage.add(TextManager.victory.format($gameParty.name()));
        if (rewards.exp > 0) $gameMessage.add("\\." + TextManager.obtainExp.format(rewards.exp, TextManager.exp));
        if (rewards.gold > 0) {
            $gameMessage.add("\\." + TextManager.obtainGold.format(rewards.gold));
            $gameParty.gainGold(rewards.gold);
        }
        for (const item of rewards.items) {
            $gameMessage.add(TextManager.obtainItem.format(item.name));
            $gameParty.gainItem(item, 1);
        }
        for (const actor of $gameParty.allMembers()) actor.gainExp(rewards.exp);
    };

    //-------------------------------------------------------------------------
    // Game_Fight — one object for every on-map battle; saved with the game.

    function Game_Fight() {
        this.initialize(...arguments);
    }
    root.Game_Fight = Game_Fight;

    Game_Fight.prototype.initialize = function() {
        this._serial = 0;
        this._results = {};
        this.clear();
    };

    Game_Fight.prototype.clear = function() {
        this._active = false;
        this._mode = "";
        this._mapId = 0;
        this._units = [];
        this._nextUnitId = 1;
        this._turn = 0;
        this._turns = "team";
        this._phase = "idle";
        this._queue = [];
        this._act = null;
        this._run = null;
        this._wait = 0;
        this._options = {};
        this._hooks = [];
        this._ending = null;
        this._inside = {};
        this._fading = [];
        this._savedBgm = null;
        this._followers = null;
        this._hookInterpreter = null;
    };

    Game_Fight.prototype.isActive = function() { return this._active; };
    Game_Fight.prototype.serial = function() { return this._serial; };
    Game_Fight.prototype.mode = function() { return this._mode; };
    Game_Fight.prototype.turn = function() { return this._turn; };
    Game_Fight.prototype.mapId = function() { return this._mapId; };
    Game_Fight.prototype.resultOf = function(serial) {
        const value = this._results[serial];
        return value === undefined ? (this._active && serial === this._serial ? -1 : F.ESCAPE) : value;
    };

    /** Whether the fight runs on the map the party stands on (one left with "keep" waits there). */
    Game_Fight.prototype.isHere = function() {
        return this._active && typeof $gameMap !== "undefined" && $gameMap.mapId() === this._mapId;
    };

    //-------------------------------------------------------------------------
    // Units: who they are and where they stand.

    Game_Fight.prototype.units = function(filter) {
        const list = this._units.filter(unit => !unit.gone);
        if (!filter) return list;
        return list.filter(unit => (!filter.team || unit.team === filter.team) && (!filter.alive || this.isAlive(unit)));
    };

    Game_Fight.prototype.unit = function(id) {
        return this._units.find(unit => unit.id === id) || null;
    };

    Game_Fight.prototype.unitOfEvent = function(eventId) {
        return this._units.find(unit => !unit.gone && unit.eventId === eventId) || null;
    };

    Game_Fight.prototype.battler = function(unit) {
        if (!unit) return null;
        if (unit.enemy) return unit.enemy;
        return unit.actorId ? $gameActors.actor(unit.actorId) : null;
    };

    Game_Fight.prototype.character = function(unit) {
        if (!unit) return null;
        if (unit.eventId) {
            const event = $gameMap.event(unit.eventId);
            return event && !event._erased ? event : null;
        }
        if (unit.party) {
            const actor = $gameActors.actor(unit.actorId);
            if ($gameParty.leader() === actor) return $gamePlayer;
            const follower = $gamePlayer.followers().data().find(f => f.actor() === actor);
            return follower || null;
        }
        return null;
    };

    Game_Fight.prototype.isAlive = function(unit) {
        if (!unit || unit.gone || unit.team === "neutral") return false;
        const battler = this.battler(unit);
        return !!(battler && battler.isAlive() && this.character(unit));
    };

    Game_Fight.prototype.unitAt = function(x, y, except) {
        for (const unit of this.units()) {
            if (unit === except) continue;
            const character = this.character(unit);
            if (character && character.x === x && character.y === y && (unit.team === "neutral" || this.isAlive(unit))) return unit;
        }
        return null;
    };

    Game_Fight.prototype.addUnit = function(spec) {
        const unit = {
            id: this._nextUnitId++,
            team: spec.team,
            party: !!spec.party,
            actorId: spec.record === "actor" ? spec.id : 0,
            enemy: null,
            eventId: spec.eventId || 0,
            move: spec.move || F.DEFAULT_MOVE,
            defeated: false,
            gone: false
        };
        if (spec.record === "enemy" && typeof $dataEnemies !== "undefined" && $dataEnemies[spec.id]) {
            unit.enemy = new Game_Enemy(spec.id, 0, 0);
        }
        if (!unit.enemy && !unit.actorId && unit.team !== "neutral") return null;
        this._units.push(unit);
        if (unit.enemy) this.syncTroop();
        const character = this.character(unit);
        if (character) this._inside[String(unit.id)] = [character.x, character.y];
        return unit;
    };

    /**
     * $gameTroop holds the fight's enemy-record battlers, so Game_Action finds
     * an enemy subject by its index as it does in a battle. The troop is not
     * saved; a load rebuilds it from the units.
     */
    Game_Fight.prototype.syncTroop = function() {
        if (typeof $gameTroop === "undefined" || !$gameTroop) return;
        $gameTroop._enemies = this._units.filter(unit => unit.enemy && !unit.gone).map(unit => unit.enemy);
        $gameTroop._turnCount = Math.max(0, this._turn - 1);
    };

    //-------------------------------------------------------------------------
    // Starting a fight.

    /**
     * Start an on-map battle here. Options: mode, troopId (its members join,
     * spawned round the party, when the map has no enemy units of its own),
     * canEscape, canLose, turns ("team" / "initiative"), objective
     * ({ type: "defeatAll" } / { type: "survive", turns } / { type: "defeatUnit", eventId }),
     * onTransfer ("escape" / "keep"), bgm ("battle" / "map").
     * Returns the fight's serial, or 0 when one is already running.
     */
    Game_Fight.prototype.start = function(options) {
        if (this._active) return 0;
        options = options || {};
        this.clear();
        this._serial++;
        this._active = true;
        this._mode = F.isOnMap(options.mode) ? options.mode : "tactical";
        this._mapId = $gameMap.mapId();
        this._turns = F.TURNS.includes(options.turns) ? options.turns : F.resolveTurns();
        this._options = {
            canEscape: !!options.canEscape,
            canLose: !!options.canLose,
            onTransfer: options.onTransfer === "keep" ? "keep" : "escape",
            bgm: options.bgm === "map" ? "map" : "battle",
            objective: F.normalizeObjective(options.objective)
        };
        const o = F.overrides();
        delete o.next;
        // The party: every battle member, the leader and the followers who stand for them.
        $gameParty.battleMembers().forEach(actor => this.addUnit({ team: "ally", record: "actor", id: actor.actorId(), party: true }));
        // The map's own units.
        for (const event of $gameMap.events()) {
            if (!event || event._erased) continue;
            const spec = F.unitSpecOf(event.event(), event.list && event.list());
            if (spec) this.addUnit(Object.assign({}, spec, { eventId: event.eventId() }));
        }
        // A troop's members when the map brought no enemies of its own.
        const troop = options.troopId && $dataTroops[options.troopId];
        if (troop && !this.units({ team: "enemy" }).length) {
            for (const member of troop.members || []) {
                if (!member || member.hidden || !$dataEnemies[member.enemyId]) continue;
                const spot = this.freeSpotNear($gamePlayer.x, $gamePlayer.y, 3);
                if (spot) this.spawn({ record: "enemy", id: member.enemyId, team: "enemy", x: spot.x, y: spot.y });
            }
        }
        this.syncTroop();
        this.prepareParty();
        if (this._options.bgm === "battle" && typeof AudioManager !== "undefined") {
            this._savedBgm = AudioManager.saveBgm();
            AudioManager.playBgm($gameSystem.battleBgm());
        }
        this._phase = "start";
        for (const unit of this._units) {
            const battler = this.battler(unit);
            if (battler) battler.onBattleStart(false);
        }
        if (F.feed()) ReactorEvents.emit("mapBattleStart", { serial: this._serial, mode: this._mode, mapId: this._mapId });
        return this._serial;
    };

    F.normalizeObjective = function(raw) {
        if (raw && raw.type === "survive") return { type: "survive", turns: Math.max(1, Math.floor(Number(raw.turns) || 1)) };
        if (raw && raw.type === "defeatUnit" && Number(raw.eventId) > 0) return { type: "defeatUnit", eventId: Math.floor(Number(raw.eventId)) };
        return { type: "defeatAll" };
    };

    /** Followers stand and walk on their own during a fight; they were hidden, they show. */
    Game_Fight.prototype.prepareParty = function() {
        const followers = $gamePlayer.followers();
        this._followers = { visible: followers.isVisible() };
        if (!followers.isVisible()) followers.show();
        for (const follower of followers.data()) follower.setThrough(false);
        $gamePlayer.refresh();
    };

    Game_Fight.prototype.restoreParty = function() {
        const followers = $gamePlayer.followers();
        for (const follower of followers.data()) follower.setThrough(true);
        if (this._followers && !this._followers.visible) followers.hide();
        this._followers = null;
        $gamePlayer.refresh();
        if (followers.isVisible()) followers.gather();
    };

    /** The nearest free, passable cell at least `near` from (x, y), searching outward; null if none. */
    Game_Fight.prototype.freeSpotNear = function(x, y, near) {
        for (let radius = Math.max(1, near); radius <= near + 6; radius++) {
            const ring = [];
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) === radius) ring.push([x + dx, y + dy]);
                }
            }
            for (const [cx, cy] of ring) {
                if (!$gameMap.isValid(cx, cy)) continue;
                if (![2, 4, 6, 8].some(d => $gameMap.isPassable(cx, cy, d))) continue;
                if ($gameMap.eventsXyNt(cx, cy).length || $gamePlayer.pos(cx, cy) || this.unitAt(cx, cy)) continue;
                return { x: cx, y: cy };
            }
        }
        return null;
    };

    //-------------------------------------------------------------------------
    // Spawning: a unit made as a new event on this map. It looks like a
    // template event when one is named, else like its record (an actor's
    // character, an enemy's `<unit character: Name, index>` note) and, on a 3D
    // map, the model the Database binds to that record.

    Game_Fight.prototype.spawn = function(options) {
        const spec = F.normalizeUnit({ team: options.team || (options.record === "actor" ? "ally" : "enemy"), record: options.record, id: options.id, move: options.move });
        if (!spec || !$gameMap.isValid(options.x, options.y)) return null;
        const eventId = F.freeEventId();
        const data = F.spawnData(eventId, spec, options);
        $dataMap.events[eventId] = data;
        $gameMap._rrSpawned = $gameMap._rrSpawned || {};
        $gameMap._rrSpawned[eventId] = data;
        const event = new Game_Event($gameMap.mapId(), eventId);
        $gameMap._events[eventId] = event;
        if (options.direction) event.setDirection(options.direction);
        const scene = typeof SceneManager !== "undefined" ? SceneManager._scene : null;
        if (scene && scene._spriteset && scene._spriteset.rrAddCharacter) scene._spriteset.rrAddCharacter(event);
        return this._active ? this.addUnit(Object.assign({}, spec, { eventId })) : null;
    };

    /** An id after every authored event and below the props' range. */
    F.freeEventId = function() {
        let id = 1;
        const base = typeof Reactor3D !== "undefined" && Reactor3D.PROP_EVENT_BASE ? Reactor3D.PROP_EVENT_BASE : 10000;
        const events = $dataMap.events || [];
        for (let i = 1; i < Math.min(events.length, base); i++) if (events[i] || $gameMap._events[i]) id = i + 1;
        return id;
    };

    F.spawnData = function(eventId, spec, options) {
        const template = options.template > 0 ? $dataMap.events[options.template] : null;
        let image = { tileId: 0, characterName: "", characterIndex: 0, direction: options.direction || 2, pattern: 1 };
        let pages = null;
        if (template && template.pages) {
            pages = JSON.parse(JSON.stringify(template.pages)).filter(page => !F.pageHook(page));
        } else if (spec.record === "actor" && $dataActors[spec.id]) {
            image.characterName = $dataActors[spec.id].characterName;
            image.characterIndex = $dataActors[spec.id].characterIndex;
        } else if (spec.record === "enemy" && $dataEnemies[spec.id]) {
            const match = /<unit\s*character\s*:\s*([^,>]+)\s*,\s*(\d+)\s*>/i.exec(String($dataEnemies[spec.id].note || ""));
            if (match) { image.characterName = match[1].trim(); image.characterIndex = Number(match[2]); }
        }
        if (!pages || !pages.length) {
            pages = [{
                conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false, selfSwitchCh: "A", selfSwitchValid: false,
                    switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
                directionFix: false, image, list: [{ code: 0, indent: 0, parameters: [] }], moveFrequency: 3,
                moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
                moveSpeed: 4, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true
            }];
        }
        const name = spec.record === "enemy" ? ($dataEnemies[spec.id] || {}).name : ($dataActors[spec.id] || {}).name;
        return { id: eventId, name: name || "Unit", note: "", pages, x: options.x, y: options.y, rrUnit: spec, rrSpawned: true };
    };

    /** A unit leaves the fight; an event unit is erased unless `keep`. Removed units give no reward. */
    Game_Fight.prototype.removeUnit = function(unit, keep) {
        if (!unit || unit.gone) return;
        unit.gone = true;
        const character = unit.eventId ? $gameMap.event(unit.eventId) : null;
        if (character && !keep) character.erase();
        this.syncTroop();
        this.checkOutcome();
    };

    //-------------------------------------------------------------------------
    // The frame loop. Scene_Map runs it through Game_Map.update; the menu,
    // another scene or a different map leave it waiting where it stood.

    Game_Fight.prototype.hookInterpreter = function() {
        if (!this._hookInterpreter) this._hookInterpreter = new Game_Interpreter();
        return this._hookInterpreter;
    };

    /**
     * Whether the battle waits: a message, choice or number input, an event
     * the map is running (an autorun, a touch or action trigger, a cutscene),
     * a hook page running, a transfer. Parallel events never hold it. The
     * interpreter that started the fight and waits for it does not count;
     * while it waits, events that need it (touch, action, autorun) start
     * after the fight, so a fight meant to be interrupted by them is started
     * with Start Battle on Map, which does not wait.
     */
    Game_Fight.prototype.isBusy = function() {
        if ($gameMessage.isBusy()) return true;
        if (this._hookInterpreter && this._hookInterpreter.isRunning()) return true;
        const interpreter = $gameMap._interpreter;
        const waiting = interpreter && interpreter.isRunning() && interpreter._waitMode === "reactorFight";
        if (interpreter && interpreter.isRunning() && !waiting) return true;
        if (!waiting && $gameMap.isAnyEventStarting && $gameMap.isAnyEventStarting()) return true;
        if ($gamePlayer.isTransferring()) return true;
        if ($gameTemp.isCommonEventReserved && $gameTemp.isCommonEventReserved()) return true;
        return false;
    };

    Game_Fight.prototype.update = function() {
        if (!this._active || !this.isHere()) return;
        this.updateFading();
        this.updateHooks();
        if (this._ending) {
            this.updateEnding();
            return;
        }
        if (this.isBusy()) return;
        if (this._wait > 0) {
            this._wait--;
            return;
        }
        switch (this._phase) {
            case "start":
                this.fireHooks("battleStart", {});
                this._phase = "round";
                break;
            case "round":
                this.startRound();
                break;
            case "queue":
                this.nextInQueue();
                break;
            case "act":
                this.updateAct();
                break;
        }
    };

    Game_Fight.prototype.startRound = function() {
        this._turn++;
        this.syncTroop();
        this._queue = [];
        const order = unit => this.battler(unit).agi;
        if (this._turns === "initiative") {
            this._queue.push({ kind: "turnStart", team: "any" });
            this.units({ alive: true }).filter(unit => unit.team !== "neutral")
                .sort((a, b) => order(b) - order(a) || a.id - b.id)
                .forEach(unit => this._queue.push({ kind: "unit", unitId: unit.id }));
            this._queue.push({ kind: "turnEnd", team: "any" });
        } else {
            for (const team of ["ally", "enemy"]) {
                this._queue.push({ kind: "turnStart", team });
                this.units({ team, alive: true }).forEach(unit => this._queue.push({ kind: "unit", unitId: unit.id }));
                this._queue.push({ kind: "turnEnd", team });
            }
        }
        this._queue.push({ kind: "roundEnd" });
        this._phase = "queue";
        if (F.feed()) ReactorEvents.emit("mapBattleTurnStart", { turn: this._turn });
    };

    Game_Fight.prototype.nextInQueue = function() {
        const entry = this._queue.shift();
        if (!entry) {
            this._phase = "round";
            return;
        }
        if (entry.kind === "turnStart" || entry.kind === "turnEnd") {
            this.fireHooks(entry.kind, { turn: this._turn, team: entry.team });
        } else if (entry.kind === "unit") {
            const unit = this.unit(entry.unitId);
            if (this.isAlive(unit)) {
                this._act = { unitId: unit.id, steps: unit.move, stage: "move", targetId: 0 };
                this._phase = "act";
            }
        } else if (entry.kind === "roundEnd") {
            for (const unit of this.units({ alive: true })) {
                const battler = this.battler(unit);
                battler.onTurnEnd();
                if (battler.isDead()) this.defeat(unit);
            }
            // A battle nobody can move or land a blow in would never end; after a while it ends as an escape.
            this._idleRounds = this._progress ? 0 : (this._idleRounds || 0) + 1;
            this._progress = false;
            const surviving = this._options.objective && this._options.objective.type === "survive";
            if (!surviving && this._idleRounds >= F.IDLE_ROUNDS) {
                console.warn("ReactorFight: no unit could move or act for " + F.IDLE_ROUNDS + " rounds; the battle ends as an escape.");
                this.end(F.ESCAPE, true);
                return;
            }
            this.checkOutcome(true);
        }
    };

    //-------------------------------------------------------------------------
    // A unit's turn: walk toward the nearest opponent, then act on one beside
    // it. Phase 2 replaces this with ranges, the player's own choices and AI.

    Game_Fight.prototype.distance = function(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    };

    /**
     * How far a character's body reaches from its cell, in tiles: a 3D model
     * blocks the cells its body covers (Reactor3D.eventModelFootprint), so a
     * big one is struck from beside its body, not its middle. Half a tile
     * for a character on one cell.
     */
    Game_Fight.prototype.bodyRadius = function(character) {
        const R = typeof Reactor3D !== "undefined" ? Reactor3D : null;
        if (!R || !R.eventModelFootprint || !R.characterModelSpec || !R.shouldRender3D || typeof $dataMap === "undefined" || !R.shouldRender3D($dataMap)) return 0.5;
        try {
            const spec = R.characterModelSpec(character);
            if (!spec) return 0.5;
            const foot = R.eventModelFootprint(character, spec);
            return Math.max(0.5, foot.rawX != null ? Math.max(foot.rawX, foot.rawZ) : Math.max(foot.halfX, foot.halfZ));
        } catch (error) {
            return 0.5;
        }
    };

    /** Whether two units' bodies are close enough to strike. */
    Game_Fight.prototype.inReach = function(a, b) {
        return this.distance(a, b) <= Math.max(1, Math.round(this.bodyRadius(a) + this.bodyRadius(b)));
    };

    Game_Fight.prototype.nearestOpponent = function(unit) {
        const character = this.character(unit);
        let best = null, bestDistance = Infinity;
        for (const other of this.units({ team: F.oppose(unit.team), alive: true })) {
            const d = this.distance(character, this.character(other));
            if (d < bestDistance) { best = other; bestDistance = d; }
        }
        return best;
    };

    Game_Fight.prototype.updateAct = function() {
        const act = this._act;
        const unit = act && this.unit(act.unitId);
        const character = this.character(unit);
        if (!unit || !this.isAlive(unit) || !character) {
            this.finishAct();
            return;
        }
        if (character.isMoving()) return;
        if (act.stage === "move") {
            this.checkEnterHooks(unit, character);
            if (this._hooks.length || this.isBusy()) return;
            const target = this.nearestOpponent(unit);
            if (!target) { this.finishAct(); return; }
            const targetCharacter = this.character(target);
            if (this.inReach(character, targetCharacter) || act.steps <= 0) {
                act.stage = "action";
                act.targetId = target.id;
                return;
            }
            const direction = character.findDirectionTo(targetCharacter.x, targetCharacter.y);
            const nx = $gameMap.roundXWithDirection(character.x, direction);
            const ny = $gameMap.roundYWithDirection(character.y, direction);
            if (direction > 0 && character.canPass(character.x, character.y, direction) && !this.unitAt(nx, ny, unit)) {
                character.moveStraight(direction);
                act.steps--;
                this._progress = true;
            } else {
                act.stage = "action";
                act.targetId = target.id;
            }
            return;
        }
        if (act.stage === "action") {
            this.startAction(unit, character);
            return;
        }
        if (act.stage === "perform") {
            if (this.updateRun()) return;
            this.finishAct();
        }
    };

    Game_Fight.prototype.finishAct = function() {
        const unit = this._act && this.unit(this._act.unitId);
        const battler = unit && this.battler(unit);
        if (battler && battler.isAlive()) battler.onAllActionsEnd();
        this._act = null;
        this._run = null;
        this._wait = 8;
        this._phase = "queue";
        this.checkOutcome();
    };

    /** What a battler does: an enemy by its action patterns, an actor by its skills; the attack otherwise. */
    Game_Fight.prototype.chooseAction = function(battler) {
        const action = new Game_Action(battler);
        let skill = null;
        if (battler.isEnemy()) {
            const list = battler.enemy().actions.filter(a => battler.isActionValid(a));
            if (list.length) {
                const ratingMax = Math.max(...list.map(a => a.rating));
                const ratingZero = ratingMax - 3;
                const chosen = battler.selectAction(list.filter(a => a.rating > ratingZero), ratingZero);
                skill = chosen ? $dataSkills[chosen.skillId] : null;
            }
        } else {
            const usable = battler.usableSkills().filter(s => s.id !== battler.attackSkillId() && s.damage && s.damage.type === 1);
            if (usable.length && Math.random() < 0.3) skill = usable[Math.floor(Math.random() * usable.length)];
        }
        if (skill && battler.canUse(skill)) action.setSkill(skill.id);
        else action.setAttack();
        return action;
    };

    /** The units an action lands on, from the one beside the actor: friends for a friendly skill, an area for "all". */
    Game_Fight.prototype.actionTargets = function(unit, action, target) {
        if (action.isForUser()) return [unit];
        if (action.isForFriend()) {
            const character = this.character(unit);
            const friends = this.units({ team: unit.team, alive: true }).filter(f => this.distance(character, this.character(f)) <= 2);
            if (action.isForAll()) return friends;
            friends.sort((a, b) => this.battler(a).hpRate() - this.battler(b).hpRate());
            return friends.slice(0, 1);
        }
        if (action.isForAll()) {
            const centre = this.character(target);
            return this.units({ team: target.team, alive: true }).filter(o => this.distance(centre, this.character(o)) <= 2);
        }
        return [target];
    };

    Game_Fight.prototype.startAction = function(unit, character) {
        const target = this.unit(this._act.targetId);
        const targetCharacter = this.character(target);
        if (!target || !this.isAlive(target) || !targetCharacter || !this.inReach(character, targetCharacter)) {
            this.finishAct();
            return;
        }
        const battler = this.battler(unit);
        const action = this.chooseAction(battler);
        if (!action.item() || !battler.canUse(action.item())) {
            this.finishAct();
            return;
        }
        character.turnTowardCharacter(targetCharacter);
        const targets = this.actionTargets(unit, action, target);
        battler.useItem(action.item());
        this._progress = true;
        this._run = F.makeRun(this, unit, action, targets);
        this._act.stage = "perform";
    };

    //-------------------------------------------------------------------------
    // Playing an action: its Action Sequence (Skill / Item › Weapon › Class ›
    // Actor / Enemy) cue by cue, the hit landing where the sequence lands it.
    // The run is plain data so a save mid-swing reloads; the sequence is
    // resolved again from the records.

    F.makeRun = function(fight, unit, action, targets) {
        const item = action.item();
        return {
            subjectId: unit.id,
            targetIds: targets.map(t => t.id),
            kind: DataManager.isSkill(item) ? "skill" : "item",
            itemId: item.id,
            attack: action.isAttack(),
            frame: 0,
            applied: false
        };
    };

    Game_Fight.prototype.runAction = function(run) {
        const battler = this.battler(this.unit(run.subjectId));
        if (!battler) return null;
        const action = new Game_Action(battler);
        if (run.kind === "skill") action.setSkill(run.itemId); else action.setItem(run.itemId);
        return action;
    };

    /** The resolved sequence's cues, by start frame; null when there is none to play. */
    Game_Fight.prototype.runCues = function(run, action) {
        if (run._cues !== undefined) return run._cues;
        let cues = null;
        const P = root.ReactorBattlePresentation, B = root.ReactorBattleData;
        try {
            const sequence = P && P.sequence && P.state === "ready" ? P.sequence(action.subject(), action) : null;
            if (sequence && B && B.timeline) {
                cues = B.timeline(sequence).map(cue => ({ start: Math.round(cue.start), step: cue.step, total: Math.round(cue.total) }));
            }
        } catch (error) {
            cues = null;
        }
        Object.defineProperty(run, "_cues", { value: cues, enumerable: false, writable: true });
        return cues;
    };

    /** Advances the run a frame; false when it has ended. */
    Game_Fight.prototype.updateRun = function() {
        const run = this._run;
        if (!run) return false;
        const action = this.runAction(run);
        const subject = this.unit(run.subjectId);
        if (!action || !this.isAlive(subject)) return false;
        const character = this.character(subject);
        const targets = run.targetIds.map(id => this.unit(id)).filter(t => t && !t.gone);
        const cues = this.runCues(run, action);
        const total = cues ? Math.min(600, Math.max(1, cues.length ? cues[0].total : 1)) : 40;
        if (cues) {
            for (const cue of cues) if (cue.start === run.frame) this.playCue(cue.step, run, action, character, targets);
        } else if (run.frame === 0) {
            this.playMotion(character, action.isMagical() ? "cast" : "attack");
            this.playAnimation(action, targets);
        } else if (run.frame === 18) {
            this.applyRun(run, action, targets);
        }
        run.frame++;
        if (run.frame <= total) return true;
        // A sequence that never landed its blow lands it as it ends.
        if (!run.applied) this.applyRun(run, action, targets);
        return false;
    };

    Game_Fight.prototype.playCue = function(step, run, action, character, targets) {
        switch (step.type) {
            case "motion":
                this.playMotion(character, step.motion);
                break;
            case "animation":
                this.playAnimation(action, step.target === "user" ? [this.unit(run.subjectId)] : targets, step.animationId);
                break;
            case "sound":
                if (step.se && step.se.name && typeof AudioManager !== "undefined") AudioManager.playSe(step.se);
                break;
            case "impact":
            case "action":
                this.applyRun(run, action, targets);
                break;
        }
    };

    /** A model's motion rule of that name, where the character is a 3D model with one. */
    Game_Fight.prototype.playMotion = function(character, motion) {
        if (!motion || !character || typeof Reactor3D === "undefined" || !Reactor3D.playModelAnimation) return;
        if (!Reactor3D.characterModelSpec || !Reactor3D.characterModelSpec(character)) return;
        try {
            Reactor3D.playModelAnimation(character, motion);
        } catch (error) {
            // A model without that rule simply keeps its pose.
        }
    };

    Game_Fight.prototype.playAnimation = function(action, targets, id) {
        let animationId = Number(id) > 0 ? Number(id) : action.item().animationId;
        if (animationId < 0) {
            const subject = action.subject();
            animationId = subject && subject.isActor() ? subject.attackAnimationId1() : 1;
        }
        const characters = targets.map(t => this.character(t)).filter(Boolean);
        if (animationId > 0 && characters.length && $dataAnimations[animationId]) $gameTemp.requestAnimation(characters, animationId);
        else if (action.subject() && action.subject().isEnemy() && typeof SoundManager !== "undefined") SoundManager.playEnemyAttack();
    };

    Game_Fight.prototype.applyRun = function(run, action, targets) {
        if (run.applied) return;
        run.applied = true;
        const hit = [];
        // The stock action lands damage only on a party in battle (Game_Action.testApply); for the
        // instant it applies, this party is.
        const inBattle = $gameParty._inBattle;
        $gameParty._inBattle = true;
        try {
            for (const target of targets) {
                const battler = this.battler(target);
                if (!battler) continue;
                action.apply(battler);
                hit.push([target, battler]);
            }
            action.applyGlobal();
        } finally {
            $gameParty._inBattle = inBattle;
        }
        for (const [target, battler] of hit) {
            this.popup(target, battler);
            if (battler.isDead()) this.defeat(target);
        }
    };

    Game_Fight.prototype.popup = function(unit, battler) {
        const character = this.character(unit);
        const scene = typeof SceneManager !== "undefined" ? SceneManager._scene : null;
        if (character && scene && scene._spriteset && scene._spriteset.rrFightPopup) scene._spriteset.rrFightPopup(character, battler);
    };

    //-------------------------------------------------------------------------
    // Defeat, outcomes and the end of the fight.

    Game_Fight.prototype.defeat = function(unit) {
        if (!unit || unit.defeated || unit.gone) return;
        unit.defeated = true;
        const character = this.character(unit);
        if (unit.eventId && character) this._fading.push({ eventId: unit.eventId, frames: 32 });
        else if (character) character.setOpacity(110);
        if (unit.enemy && typeof SoundManager !== "undefined") SoundManager.playEnemyCollapse();
        this.fireHooks("unitDefeated", { unit });
        if (F.feed()) ReactorEvents.emit("unitDefeated", { unitId: unit.id, eventId: unit.eventId, team: unit.team, battler: this.battler(unit) });
    };

    Game_Fight.prototype.updateFading = function() {
        for (const fade of this._fading) {
            const event = $gameMap.event(fade.eventId);
            if (!event) { fade.frames = 0; continue; }
            fade.frames--;
            event.setOpacity(Math.max(0, Math.round(255 * fade.frames / 32)));
            if (fade.frames <= 0) event.erase();
        }
        this._fading = this._fading.filter(fade => fade.frames > 0);
    };

    Game_Fight.prototype.checkOutcome = function(roundEnded) {
        if (!this._active || this._ending) return;
        const party = this._units.filter(unit => unit.party && !unit.gone);
        if (party.length && party.every(unit => this.battler(unit).isDead())) {
            this.end(F.LOSE);
            return;
        }
        const objective = this._options.objective || { type: "defeatAll" };
        if (objective.type === "survive") {
            if (roundEnded && this._turn >= objective.turns) this.end(F.WIN);
            return;
        }
        if (objective.type === "defeatUnit") {
            const target = this.unitOfEvent(objective.eventId) || this._units.find(unit => unit.eventId === objective.eventId);
            if (target && target.defeated) this.end(F.WIN);
            return;
        }
        if (!this.units({ team: "enemy", alive: true }).length) this.end(F.WIN);
    };

    /** Ends the fight: WIN gives the rewards, LOSE the defeat (Game Over unless the battle can be lost), ESCAPE nothing. */
    Game_Fight.prototype.end = function(result, quiet) {
        if (!this._active || this._ending) return;
        if (result === F.LOSE && !this._options.canLose) quiet = false;
        this._ending = { result, shown: false, quiet: !!quiet };
    };

    Game_Fight.prototype.updateEnding = function() {
        const ending = this._ending;
        if (!ending.shown) {
            if (this.isBusy() || this._fading.length) return;
            ending.shown = true;
            if (!ending.quiet) {
                if (ending.result === F.WIN) {
                    AudioManager.playMe($gameSystem.victoryMe());
                    const enemies = this._units.filter(unit => unit.team === "enemy" && unit.enemy && !unit.gone).map(unit => unit.enemy);
                    F.giveRewards(F.makeRewards(enemies));
                } else if (ending.result === F.LOSE) {
                    AudioManager.playMe($gameSystem.defeatMe());
                    $gameMessage.add(TextManager.defeat.format($gameParty.name()));
                } else if (ending.result === F.ESCAPE) {
                    $gameMessage.add(TextManager.escapeStart.format($gameParty.name()));
                }
            }
            return;
        }
        if ($gameMessage.isBusy()) return;
        this.finish();
    };

    Game_Fight.prototype.finish = function() {
        const result = this._ending ? this._ending.result : F.ESCAPE;
        for (const unit of this._units) {
            const battler = this.battler(unit);
            if (battler && !unit.enemy) battler.onBattleEnd();
            if (unit.party) {
                const character = this.character(unit);
                if (character) character.setOpacity(255);
            }
        }
        this.restoreParty();
        if (this._savedBgm) AudioManager.replayBgm(this._savedBgm);
        $gameTroop.clear();
        this._results[this._serial] = result;
        if (F.feed()) ReactorEvents.emit("mapBattleEnd", { serial: this._serial, result });
        const lost = result === F.LOSE;
        const canLose = this._options.canLose;
        this.clear();
        if (lost) {
            if (canLose) $gameParty.reviveBattleMembers();
            else SceneManager.goto(Scene_Gameover);
        }
    };

    //-------------------------------------------------------------------------
    // Hooks firing: queued pages run one after another on the fight's own
    // interpreter; the battle waits while one runs.

    Game_Fight.prototype.hookMatches = function(hook, type, info, event) {
        if (hook.on !== type) return false;
        if (type === "turnStart" || type === "turnEnd") {
            if (hook.turn && hook.turn !== info.turn) return false;
            return hook.team === "any" || info.team === "any" || hook.team === info.team;
        }
        if (type === "unitDefeated") {
            const unit = info.unit;
            if (hook.unit === "any") return true;
            if (hook.unit === "this") return unit.eventId === event.eventId();
            if (hook.unit === "ally" || hook.unit === "enemy") return unit.team === hook.unit;
            return unit.eventId === hook.unit;
        }
        if (type === "unitEnters") {
            if (hook.team !== "any" && info.unit.team !== hook.team) return false;
            return F.inArea(hook, info.x, info.y) && !(info.px !== null && F.inArea(hook, info.px, info.py));
        }
        return true;
    };

    F.inArea = function(hook, x, y) {
        if (hook.region) return $gameMap.regionId(x, y) === hook.region;
        return x >= hook.x0 && x <= hook.x1 && y >= hook.y0 && y <= hook.y1;
    };

    Game_Fight.prototype.fireHooks = function(type, info) {
        for (const event of $gameMap.events()) {
            if (!event || event._erased) continue;
            const pages = event.event().pages || [];
            pages.forEach((page, pageIndex) => {
                const hook = F.pageHook(page);
                if (!hook || !this.hookMatches(hook, type, info, event)) return;
                if (!F.meetsPageConditions(event, page)) return;
                this._hooks.push({ eventId: event.eventId(), pageIndex });
            });
        }
    };

    Game_Fight.prototype.updateHooks = function() {
        const interpreter = this.hookInterpreter();
        if (!interpreter.isRunning() && this._hooks.length && !$gameMessage.isBusy()) {
            const next = this._hooks.shift();
            const event = $gameMap.event(next.eventId);
            const page = event && event.event().pages[next.pageIndex];
            if (page) interpreter.setup(page.list, next.eventId);
        }
        if (interpreter.isRunning()) interpreter.update();
    };

    /** A unit that has just stepped into a hook's area from outside it. */
    Game_Fight.prototype.checkEnterHooks = function(unit, character) {
        const key = String(unit.id);
        const from = this._inside[key];
        if (from && from[0] === character.x && from[1] === character.y) return;
        this._inside[key] = [character.x, character.y];
        this.fireHooks("unitEnters", { unit, x: character.x, y: character.y, px: from ? from[0] : null, py: from ? from[1] : null });
    };

    //-------------------------------------------------------------------------
    // The runtime events feed, for plugins (docs/RUNTIME-EVENTS.md).

    F.feed = () => typeof ReactorEvents !== "undefined" && !!ReactorEvents.emit;

    //-------------------------------------------------------------------------
    // Engine hooks.

    const unhookedMeetsConditions = Game_Event.prototype.meetsConditions;
    F.meetsPageConditions = function(event, page) {
        return unhookedMeetsConditions.call(event, page);
    };

    // A hook page runs when its battle condition fires; it is never the page an event shows.
    Game_Event.prototype.meetsConditions = function(page) {
        if (F.pageHook(page)) return false;
        return unhookedMeetsConditions.call(this, page);
    };

    // Units walk where the battle sends them, not on their own.
    const updateSelfMovement = Game_Event.prototype.updateSelfMovement;
    Game_Event.prototype.updateSelfMovement = function() {
        if (typeof $gameFight !== "undefined" && $gameFight && $gameFight.isHere() && $gameFight.unitOfEvent(this.eventId())) return;
        updateSelfMovement.call(this);
    };

    // Followers walk on their own during a fight instead of trailing the leader.
    const updateFollowersMove = Game_Followers.prototype.updateMove;
    Game_Followers.prototype.updateMove = function() {
        if (typeof $gameFight !== "undefined" && $gameFight && $gameFight.isHere()) return;
        updateFollowersMove.call(this);
    };

    // The battle moves the party; the player's keys do not, and no encounter starts.
    const canMove = Game_Player.prototype.canMove;
    Game_Player.prototype.canMove = function() {
        if (typeof $gameFight !== "undefined" && $gameFight && $gameFight.isHere()) return false;
        return canMove.call(this);
    };
    const canEncounter = Game_Player.prototype.canEncounter;
    Game_Player.prototype.canEncounter = function() {
        if (typeof $gameFight !== "undefined" && $gameFight && $gameFight.isActive()) return false;
        return canEncounter.call(this);
    };

    // A random encounter on a map whose mode is on the map starts the fight there.
    const executeEncounter = Game_Player.prototype.executeEncounter;
    Game_Player.prototype.executeEncounter = function() {
        if (!$gameMap.isEventRunning() && this._encounterCount <= 0 && !$gameFight.isActive()) {
            const troopId = this.makeEncounterTroopId();
            const mode = F.resolveMode(troopId);
            if (F.isOnMap(mode) && $dataTroops[troopId]) {
                this.makeEncounterCount();
                $gameFight.start({ mode, troopId, canEscape: true, canLose: false });
                return false;
            }
        }
        return executeEncounter.call(this);
    };

    // Leaving the map ends the fight as an escape, unless it was started to keep.
    const reserveTransfer = Game_Player.prototype.reserveTransfer;
    Game_Player.prototype.reserveTransfer = function(mapId, x, y, d, fadeType) {
        if ($gameFight.isActive() && mapId !== $gameFight.mapId() && $gameFight._options.onTransfer !== "keep") {
            $gameFight._ending = { result: F.ESCAPE, shown: true, quiet: true };
            $gameFight.finish();
        }
        reserveTransfer.call(this, mapId, x, y, d, fadeType);
    };

    // Items and skills marked for battle work for units in an on-map battle.
    const isOccasionOk = Game_BattlerBase.prototype.isOccasionOk;
    Game_BattlerBase.prototype.isOccasionOk = function(item) {
        if (typeof $gameFight !== "undefined" && $gameFight && $gameFight.isHere() && !$gameParty.inBattle()) {
            return item.occasion === 0 || item.occasion === 1;
        }
        return isOccasionOk.call(this, item);
    };

    const updateMap = Game_Map.prototype.update;
    Game_Map.prototype.update = function(sceneActive) {
        updateMap.call(this, sceneActive);
        if (sceneActive && typeof $gameFight !== "undefined" && $gameFight) $gameFight.update();
    };

    // Spawned units are not in the map's file: they go back into its data when it loads, and leave with the map.
    const setupMap = Game_Map.prototype.setup;
    Game_Map.prototype.setup = function(mapId) {
        const same = mapId === this._mapId;
        if (!same) this._rrSpawned = null;
        setupMap.call(this, mapId);
        // The same map set up again (a load after the project changed reloads it): units still standing come back.
        if (same && this._rrSpawned) F.reinstateSpawned(this);
    };

    F.reinstateSpawned = function(map) {
        for (const id of Object.keys(map._rrSpawned || {})) {
            const unit = typeof $gameFight !== "undefined" && $gameFight ? $gameFight._units.find(u => u.eventId === Number(id)) : null;
            if (unit && (unit.defeated || unit.gone)) { delete map._rrSpawned[id]; continue; }
            if (!$dataMap.events[id]) $dataMap.events[id] = map._rrSpawned[id];
            if (!map._events[id]) map._events[id] = new Game_Event(map.mapId(), Number(id));
        }
    };

    F.restoreSpawned = function() {
        const spawned = typeof $gameMap !== "undefined" && $gameMap && $gameMap._rrSpawned;
        if (!spawned || typeof $dataMap === "undefined" || !$dataMap || !$dataMap.events) return;
        for (const [id, data] of Object.entries(spawned)) {
            if (!$dataMap.events[id]) $dataMap.events[id] = data;
        }
    };

    if (typeof Scene_Map !== "undefined") {
        const onMapLoaded = Scene_Map.prototype.onMapLoaded;
        Scene_Map.prototype.onMapLoaded = function() {
            if (!$gamePlayer.isTransferring()) F.restoreSpawned();
            onMapLoaded.call(this);
        };
        // The menu (and saving) stays open while the only event running is the one waiting for the fight.
        const isMenuEnabled = Scene_Map.prototype.isMenuEnabled;
        Scene_Map.prototype.isMenuEnabled = function() {
            const interpreter = $gameMap._interpreter;
            if ($gameFight.isHere() && interpreter.isRunning() && interpreter._waitMode === "reactorFight") {
                return $gameSystem.isMenuEnabled() && !$gameMessage.isBusy();
            }
            return isMenuEnabled.call(this);
        };
    }

    // Battle Processing in an on-map mode fights here; its If Win / Escape / Lose branches follow the result.
    const command301 = Game_Interpreter.prototype.command301;
    Game_Interpreter.prototype.command301 = function(params) {
        if (!$gameParty.inBattle() && !$gameFight.isActive() && $gameMap.mapId() > 0) {
            const troopId = params[0] === 0 ? params[1] : params[0] === 1 ? $gameVariables.value(params[1]) : $gamePlayer.makeEncounterTroopId();
            const mode = F.resolveMode(troopId);
            if (F.isOnMap(mode) && $dataTroops[troopId]) {
                const serial = $gameFight.start({ mode, troopId, canEscape: params[2], canLose: params[3] });
                if (serial) {
                    this._rrFightSerial = serial;
                    this._rrFightVariable = 0;
                    this.setWaitMode("reactorFight");
                    $gamePlayer.makeEncounterCount();
                    return true;
                }
            }
        }
        return command301.call(this, params);
    };

    const updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
    Game_Interpreter.prototype.updateWaitMode = function() {
        if (this._waitMode !== "reactorFight") return updateWaitMode.call(this);
        if ($gameFight.isActive() && $gameFight.serial() === this._rrFightSerial) return true;
        const result = $gameFight.resultOf(this._rrFightSerial);
        this._branch[this._indent] = result < 0 ? F.ESCAPE : result;
        if (this._rrFightVariable > 0) $gameVariables.setValue(this._rrFightVariable, result < 0 ? F.ESCAPE : result);
        this._rrFightSerial = 0;
        this._rrFightVariable = 0;
        this._waitMode = "";
        return false;
    };

    // $gameFight is created with the game and saved with it; the troop is rebuilt from it on load.
    const createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function() {
        createGameObjects.call(this);
        root.$gameFight = new Game_Fight();
    };
    const makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function() {
        const contents = makeSaveContents.call(this);
        contents.reactorFight = root.$gameFight;
        return contents;
    };
    const extractSaveContents = DataManager.extractSaveContents;
    DataManager.extractSaveContents = function(contents) {
        extractSaveContents.call(this, contents);
        root.$gameFight = contents.reactorFight instanceof Game_Fight ? contents.reactorFight : new Game_Fight();
        if (root.$gameFight.isActive()) root.$gameFight.syncTroop();
    };
    if (typeof root.$gameFight === "undefined") root.$gameFight = new Game_Fight();

    //-------------------------------------------------------------------------
    // Damage numbers over units, and spawned units' sprites.

    if (typeof Spriteset_Map !== "undefined") {
        Spriteset_Map.prototype.rrAddCharacter = function(character) {
            if (!this._characterSprites || !this._tilemap) return;
            const sprite = new Sprite_Character(character);
            this._characterSprites.push(sprite);
            this._tilemap.addChild(sprite);
        };

        Spriteset_Map.prototype.rrFightPopup = function(character, battler) {
            if (typeof Sprite_Damage === "undefined") return;
            const sprite = new Sprite_Damage();
            const head = F.headPoint(character);
            sprite.x = head.x;
            sprite.y = head.y;
            sprite.setup(battler);
            this._rrFightPopups = this._rrFightPopups || [];
            this._rrFightPopups.push(sprite);
            this.addChild(sprite);
        };

        const updateSpriteset = Spriteset_Map.prototype.update;
        Spriteset_Map.prototype.update = function() {
            updateSpriteset.call(this);
            const popups = this._rrFightPopups;
            if (!popups || !popups.length) return;
            for (let i = popups.length - 1; i >= 0; i--) {
                if (popups[i].isPlaying()) continue;
                this.removeChild(popups[i]);
                popups[i].destroy();
                popups.splice(i, 1);
            }
        };
    }

    /** Where a character's head is on screen: above its feet, through the 3D camera on a 3D map. */
    F.headPoint = function(character) {
        const point = character.reactor3DScreenPoint && character.reactor3DScreenPoint();
        if (point && typeof Reactor3D !== "undefined" && Reactor3D.viewport) {
            const viewport = Reactor3D.viewport();
            const camera = viewport && viewport.camera && viewport.camera();
            const ground = Reactor3D.characterGround ? Reactor3D.characterGround($dataMap, character) : 0;
            const head = camera ? Reactor3D.projectToScreen(camera, character._realX + 0.5, ground + 2.6, character._realY + 0.5) : null;
            if (head) return { x: Math.round(head.x), y: Math.round(head.y) };
        }
        return { x: character.screenX(), y: character.screenY() - Math.round($gameMap.tileHeight() * 1.4) };
    };

    // A unit event with no model of its own wears the one the Database binds to its record.
    if (typeof Reactor3D !== "undefined" && Reactor3D.characterModelSpec) {
        const characterModelSpec = Reactor3D.characterModelSpec;
        Reactor3D.characterModelSpec = function(character) {
            const own = characterModelSpec.call(this, character);
            if (own || !character || typeof character.event !== "function") return own;
            const data = character.event();
            if (!data || !(data.rrUnit || /<unit\s*:/i.test(String(data.note || "")))) return own;
            const spec = F.unitSpecOf(data, null);
            if (!spec || !spec.id || !this.databaseModelSpec) return own;
            return this.databaseModelSpec(spec.record === "enemy" ? "enemies" : "actors", spec.id);
        };
    }

    //-------------------------------------------------------------------------
    // The event commands (code 357, plugin "RPGReactor").

    if (typeof PluginManager !== "undefined" && PluginManager.registerCommand) {
        const bool = value => value === true || value === "true";
        const int = value => Math.floor(Number(value) || 0);
        PluginManager.registerCommand("RPGReactor", "ChangeBattleMode", function(args) {
            F.changeMode(String(args && args.mode || "default"), String(args && args.scope || "game"));
        });
        PluginManager.registerCommand("RPGReactor", "StartMapBattle", function(args) {
            args = args || {};
            const troopId = int(args.troopId);
            const mode = F.isOnMap(args.mode) ? args.mode : (F.isOnMap(F.resolveMode(troopId)) ? F.resolveMode(troopId) : "tactical");
            const objective = args.objective === "survive" ? { type: "survive", turns: int(args.turnsToSurvive) }
                : args.objective === "defeatUnit" ? { type: "defeatUnit", eventId: int(args.unitEventId) } : { type: "defeatAll" };
            const serial = $gameFight.start({
                mode, troopId, canEscape: bool(args.canEscape), canLose: bool(args.canLose),
                turns: args.turns === "initiative" || args.turns === "team" ? args.turns : undefined,
                objective, onTransfer: args.onTransfer, bgm: args.bgm
            });
            if (serial && bool(args.wait)) {
                this._rrFightSerial = serial;
                this._rrFightVariable = int(args.resultVariable);
                this.setWaitMode("reactorFight");
            }
        });
        PluginManager.registerCommand("RPGReactor", "SpawnUnit", function(args) {
            args = args || {};
            let x = int(args.x), y = int(args.y);
            if (args.at === "event") {
                const anchor = this.character(int(args.eventId));
                if (!anchor) return;
                const spot = $gameFight.freeSpotNear(anchor.x, anchor.y, 1);
                if (!spot) return;
                x = spot.x; y = spot.y;
            } else if (args.at === "variables") {
                x = $gameVariables.value(int(args.x));
                y = $gameVariables.value(int(args.y));
            }
            $gameFight.spawn({ record: args.record === "actor" ? "actor" : "enemy", id: int(args.id), team: args.team, x, y, template: int(args.template), direction: int(args.direction) });
        });
        PluginManager.registerCommand("RPGReactor", "RemoveUnit", function(args) {
            const eventId = int(args && args.eventId) || this._eventId;
            $gameFight.removeUnit($gameFight.unitOfEvent(eventId), args && bool(args.keep));
        });
        PluginManager.registerCommand("RPGReactor", "EndMapBattle", function(args) {
            const result = String(args && args.result || "win");
            $gameFight.end(result === "lose" ? F.LOSE : result === "escape" ? F.ESCAPE : F.WIN);
        });
    }
})(globalThis);

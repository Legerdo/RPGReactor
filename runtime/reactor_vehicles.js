//=============================================================================
// reactor_vehicles.js - vehicles in the world
//=============================================================================
// Database starting placements and legacy `rrVehicle: { type }` events share
// the event driver. Their records live in data/ReactorVehicles.json; identities
// are "0:<vehicleId>" for database placements and "<mapId>:<eventId>" for legacy events.
// This file holds:
//   - the types ($dataReactorVehicles) and the words the player reads (TERMS);
//   - the vehicles of the map the party is on, and the saved registry of
//     where each stands once it has left its authored tile
//     ($gameMap._rrVehicles);
//   - what $gamePlayer answers while it rides one: `_vehicleType` is
//     "reactor", `isInVehicle()` is true, `vehicle()` is the event, and the
//     event answers every method a caller of `vehicle()` uses;
//   - which vehicle OK would board (`offered`), the two hops as state
//     (`_rrMount`), Confirm to interact and Cancel to get off aboard, parking and the place to stand
//     beside it, and the rule for a battle that starts on the map;
//   - the script calls and the three plugin commands.
// `$gameMap._vehicles` stays the native three. Optional database extensions
// add battler data and image bindings without replacing their movement or commands.
//
// What is saved is plain data on $gamePlayer, on the event and on $gameMap;
// no saved object holds a character. Every cache is in this module and is
// rebuilt on demand, so a save made before this file existed loads and plays.
//
// Moving the ridden vehicle is reactor_vehicles_drive.js; drawing it and its
// rider is reactor_3d_vehicles.js and reactor_3d_rider.js. This file meets
// them in saved fields only: `_rrDrive.v` is read, `_rrDrive.leave` written.
//=============================================================================

(function() {
    "use strict";

    const root = typeof window !== "undefined" ? window : globalThis;
    const V = root.ReactorVehicles = root.ReactorVehicles || {};
    if (V._world) return;
    V._world = true;

    V.DATA_URL = "data/ReactorVehicles.json";
    /** Ticks a hop on or off takes. */
    V.HOP = 14;
    /** Ticks a press to get off is kept while the vehicle slows, and ticks the "no room" word shows. */
    V.KEEP = 90;
    /** Ticks between two looks for the vehicle OK would board. */
    V.LOOK = 6;
    /** Ticks between two looks for the events whose body is more than their own tile (asked about the tile the leader faces). */
    V.BODIES = 120;
    /** How near the leader's middle a vehicle's body has to be, and how near in height, in tiles. */
    V.REACH = 1.25;
    V.REACH_HEIGHT = 1.5;
    /** How far off his facing the nearest point of the body may lie, in degrees. */
    V.FACING = 75;
    /** A command boards with the hop from this near, and at once from further. */
    V.HOP_REACH = 3;
    /** Under this speed (tiles a second) the party can get off, and a rider beside someone talks to him. */
    V.SLOW = 1;
    /** How far OK reaches from the saddle, in tiles: past the vehicle's nose, and to either side of its middle. */
    V.AHEAD = 1.5;
    V.ASIDE = 1.5;

    const RAD = Math.PI / 180;
    // Facings as headings: degrees, 0 north, clockwise.
    const DEGREES_OF_DIR = { 8: 0, 9: 45, 6: 90, 3: 135, 2: 180, 1: 225, 4: 270, 7: 315 };
    const DIR8_OF_STEP = [8, 9, 6, 3, 2, 1, 4, 7];
    const DIR4_OF_STEP = [8, 6, 2, 4];

    const world = () => (typeof Reactor3D !== "undefined" && Reactor3D ? Reactor3D : null);
    const physics = () => (typeof ReactorPhysics !== "undefined" && ReactorPhysics ? ReactorPhysics : null);
    const models = () => { const R = world(); return R && R.Vehicles ? R.Vehicles : null; };
    const mapData = () => (typeof $dataMap !== "undefined" && $dataMap ? $dataMap : null);
    const player = () => (typeof $gamePlayer !== "undefined" && $gamePlayer ? $gamePlayer : null);
    const map3D = () => { const R = world(), data = mapData(); return !!(R && data && R.isMap3D && R.isMap3D(data)); };
    const fightHere = () => typeof $gameFight !== "undefined" && !!$gameFight && typeof $gameFight.isHere === "function" && $gameFight.isHere();
    const number = value => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);
    const flag = (value, otherwise) => (value === true || value === "true" ? true : value === false || value === "false" ? false : otherwise);
    const round3 = value => Math.round(value * 1000) / 1000;

    /** A heading in degrees as one in 0..360. */
    const turn360 = degrees => { const d = degrees % 360; return d < 0 ? d + 360 : d; };
    V.degrees = radians => turn360(radians / RAD);
    V.radians = degrees => turn360(Number(degrees) || 0) * RAD;
    const dir8Of = radians => DIR8_OF_STEP[Math.round(V.degrees(radians) / 45) % 8];
    const dir4Of = radians => DIR4_OF_STEP[Math.round(V.degrees(radians) / 90) % 4];
    const facingOf = character => {
        const d8 = character._reactorDir8;
        const d = d8 === 1 || d8 === 3 || d8 === 7 || d8 === 9 ? d8 : character._direction;
        return (DEGREES_OF_DIR[d] === undefined ? 180 : DEGREES_OF_DIR[d]) * RAD;
    };
    /** A vehicle's facing on the grid, from its heading: the nearest of four, and of eight for its body and its model. */
    const face = function(character, radians) {
        character._direction = dir4Of(radians);
        character._reactorDir8 = dir8Of(radians);
    };

    //-------------------------------------------------------------------------
    // The types and the words.

    /** Loads the types once; a missing or malformed file is an empty list. */
    V.load = function() {
        if (this._state) return;
        this._state = "loading";
        const finish = parsed => {
            root.$dataReactorVehicles = Array.isArray(parsed) ? parsed : [null];
            this._state = "done";
        };
        try {
            if (typeof Utils !== "undefined" && Utils.isNwjs()) {
                const fs = require("fs");
                const path = require("path");
                const full = path.join(path.dirname(process.mainModule.filename), this.DATA_URL);
                if (!fs.existsSync(full)) return finish(null);
                return finish(JSON.parse(fs.readFileSync(full, "utf8")));
            }
        } catch (error) {
            console.warn("ReactorVehicles: could not read " + this.DATA_URL, error);
            return finish(null);
        }
        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", this.DATA_URL);
            xhr.overrideMimeType("application/json");
            xhr.onload = () => {
                let parsed = null;
                if (xhr.status < 400) {
                    try { parsed = JSON.parse(xhr.responseText); } catch (error) { parsed = null; }
                }
                finish(parsed);
            };
            xhr.onerror = () => finish(null);
            xhr.send();
        } catch (error) {
            finish(null);
        }
    };

    V.isReady = function() {
        this.load();
        return this._state === "done";
    };

    /** The words the player reads: English, unless the project has its own (System.json reactorVehicles.terms). */
    V.TERMS = Object.assign({
        ride: "Ride", drive: "Drive", board: "Board", fly: "Fly",
        getOff: "Get off", getOut: "Get out",
        go: "Go", brake: "Brake", steer: "Steer", jump: "Jump",
        turnRound: "Turn round", noRoom: "No room to get off here"
    }, V.TERMS || null);

    const settings = function() {
        const system = typeof $dataSystem !== "undefined" && $dataSystem ? $dataSystem.reactorVehicles : null;
        return system && typeof system === "object" ? system : null;
    };

    V.term = function(key) {
        const own = settings(), terms = own && own.terms;
        return (terms && typeof terms[key] === "string" && terms[key]) || V.TERMS[key] || "";
    };

    /** False when the project's file switches the new vehicles off: each then stands as scenery. */
    V.free = function() {
        const own = settings();
        return !(own && own.free === false);
    };

    // A type without reactor_3d_vehicles.js: what this file itself reads of one, with the motorcycle's values.
    const plainTypes = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    const plainType = function(record) {
        let type = plainTypes.get(record);
        if (type) return type;
        const kind = typeof record.kind === "string" && record.kind ? record.kind : "motorcycle";
        const model = record.graphic3d !== false && record.model && typeof record.model === "object" && record.model.name ? Object.assign({}, record.model) : null;
        if (model) {
            if (!model.file) model.file = String(model.name).split("/").pop();
            if (!model.ext) model.ext = ".glb";
            if (!(Number(model.size) > 0)) model.size = 3.5;
        }
        type = {
            id: record.id, name: record.name || "", kind, prompt: record.prompt || "",
            promptTerm: "ride", leaveTerm: "getOff", played: record.ridable !== false, medium: record.medium || "ground",
            sheet: record.sheet || {},
            model, rider: record.rider === "inside" ? "inside" : "seat", bgm: record.bgm || null,
            handling: Object.assign({ speed: 20, brake: 0.67 }, record.handling || null),
            body: Object.assign({ height: 2.6, radius: 0.45 }, record.body || null),
            sounds: record.sounds || {}
        };
        plainTypes.set(record, type);
        return type;
    };

    /** A type record filled from its kind, or null where the list has none under that id. The same object every time. */
    V.type = function(id) {
        const list = root.$dataReactorVehicles;
        const record = list && id > 0 ? list[id] : null;
        if (!record || typeof record !== "object") return null;
        const M = models();
        return M && typeof M.typeOf === "function" ? M.typeOf(record) : plainType(record);
    };

    /** The two words of a type's label: what OK does beside it, and what OK does aboard. */
    const WORDS = { prompt: "", leave: "" };
    V.words = function(type) {
        WORDS.prompt = (type && type.prompt) || V.term((type && type.promptTerm) || "ride");
        WORDS.leave = V.term((type && type.leaveTerm) || "getOff");
        return WORDS;
    };

    //-------------------------------------------------------------------------
    // The look: an event with no picture or model of its own wears its type's.

    // One kept spec per type: the body rule, the collision keys and the still-model test compare a spec by identity.
    const looks = typeof WeakMap !== "undefined" ? new WeakMap() : null;

    /** A model's front as a unit vector in its own space, from `vehicle.forward`; null when it says none. */
    const forwardOf = function(value) {
        if (typeof value === "string") {
            const axis = { "+x": [1, 0, 0], "-x": [-1, 0, 0], "+z": [0, 0, 1], "-z": [0, 0, -1] }[value.trim().toLowerCase()];
            return axis || null;
        }
        if (Array.isArray(value) && value.length >= 3) {
            const x = Number(value[0]), z = Number(value[2]), length = Math.hypot(x, z);
            return length > 1e-6 ? [x / length, 0, z / length] : null;
        }
        return null;
    };

    const lookOf = function(type) {
        if (!type || !type.model || !type.model.name || !looks) return null;
        let look = looks.get(type);
        if (!look) {
            const R = world();
            const normal = R && R.normalizeModelSpec ? R.normalizeModelSpec(type.model) : null;
            // Its own object: the front mark is written into it below, and the engine's shared copy stays as read.
            look = { spec: normal ? Object.assign({}, normal) : null, fronted: false, front: null, dims: null, cached: null };
            looks.set(type, look);
        }
        if (look.spec && !look.fronted) front(look, type);
        return look;
    };

    /**
     * The spec's front mark, from the model's own `vehicle.forward`, once its sidecar has been read (it is preloaded
     * with the map). A spec with a front mark of its own keeps it. Written into the kept spec, so the body is
     * taken again with the model's true front.
     */
    const front = function(look, type) {
        const R = world(), spec = look.spec;
        if (spec.faces && spec.faces.front) { look.fronted = true; look.front = forwardOf(spec.faces.front); return; }
        const json = R && R._sidecarJson ? R._sidecarJson[spec.name] : undefined;
        if (json === undefined) return;
        const entry = R._glbCache && R.modelCacheKey ? R._glbCache[R.modelCacheKey(spec.name, spec.ext, spec.file)] : null;
        const template = entry && entry.template ? entry.template : null;
        const M = models();
        let forward = forwardOf(json && json.vehicle && json.vehicle.forward);
        if (!forward && M && typeof M.read === "function") {
            // The file names no front: the model file's guess, which needs the model's box.
            if (!template && !(entry && entry.failed)) return;
            try {
                const block = M.read(json || {}, template && typeof M.boxOf === "function" ? M.boxOf(template) : null);
                forward = block ? forwardOf(block.f || block.forward) : null;
            } catch (error) { forward = null; }
        }
        look.fronted = true;
        if (!forward) return;
        look.front = forward;
        spec.faces = Object.assign({}, spec.faces || null, { front: forward });
    };

    /** How long a vehicle is, in tiles: its model's box along its front at the size it is drawn, else its size. */
    const DIMS = { length: 3.5 };
    const dimsOf = function(type) {
        const look = lookOf(type);
        if (look && look.dims) return look.dims;
        const spec = look && look.spec;
        DIMS.length = spec ? spec.size * spec.scale : 3.5;
        const R = world();
        const entry = spec && R && R._glbCache && R.modelCacheKey ? R._glbCache[R.modelCacheKey(spec.name, spec.ext, spec.file)] : null;
        const extent = entry && entry.template && entry.template.userData ? entry.template.userData.glbSize : null;
        if (!extent || !look.fronted) return DIMS;
        const span = Math.max(extent.x, extent.y, extent.z, 0.0001), fit = spec.size / span * spec.scale;
        const f = look.front || [0, 0, 1], stretch = spec.stretch || [1, 1, 1];
        const sx = extent.x * fit * stretch[0], sz = extent.z * fit * stretch[2];
        look.dims = { length: Math.abs(f[0]) * sx + Math.abs(f[2]) * sz };
        return look.dims;
    };

    /** A map's vehicle rows: `fn(data, typeId)` for each event of the data that has one with a type that exists. */
    const eachRow = function(data, fn) {
        const events = data && data.events;
        const types = root.$dataReactorVehicles;
        if (!events || !types || types.length < 2) return;
        for (let i = 1; i < events.length; i++) {
            const row = events[i] && events[i].rrVehicle;
            if (!row || typeof row !== "object") continue;
            const id = Math.floor(Number(row.type)) || 0;
            if (id > 0 && V.type(id)) fn(events[i], id);
        }
    };

    const installLooks = function() {
        const R = world();
        if (!R || typeof R.characterModelSpec !== "function" || R.characterModelSpec.__rrVehicles) return;
        const characterModelSpec = R.characterModelSpec;
        R.characterModelSpec = function(character) {
            const stock = character && ["boat","ship","airship"].includes(character._type) && root.$dataSystem && root.$dataSystem[character._type];
            if (stock && stock.reactorVehicle && stock.reactorVehicle.model && stock.reactorVehicle.model.name) {
                const look = lookOf(models().typeOf(stock.reactorVehicle));
                if (look && look.spec) return look.spec;
            }
            if (!character || !character._rrVehicle) return characterModelSpec.call(this, character);
            // Its own picture or model comes first; an erased event and one with no page in force show nothing.
            if (character._erased || character._pageIndex < 0 || character._characterName || character._tileId > 0) return characterModelSpec.call(this, character);
            const F = root.ReactorFight;
            const own = F && typeof F.ownModelSpec === "function" ? F.ownModelSpec(character) : characterModelSpec.call(this, character);
            if (own) return own;
            const look = lookOf(V.type(character._rrVehicle));
            if (!look || !look.spec) return characterModelSpec.call(this, character);
            return this.variantSpecOf ? this.variantSpecOf(character, look.spec) : look.spec;
        };
        R.characterModelSpec.__rrVehicles = true;

        // A vehicle's model is readied with the map, not at the first boarding.
        if (typeof R.collectMapModelSpecs === "function") {
            const collectMapModelSpecs = R.collectMapModelSpecs;
            R.collectMapModelSpecs = function(data) {
                const specs = collectMapModelSpecs.call(this, data);
                for (const key of ["boat","ship","airship"]) {
                    const entry = root.$dataSystem && root.$dataSystem[key] && root.$dataSystem[key].reactorVehicle;
                    const look = entry && models() && lookOf(models().typeOf(entry));
                    if (look && look.spec) specs.push(look.spec);
                }
                eachRow(data, (event, id) => {
                    const look = lookOf(V.type(id)), spec = look && look.spec;
                    if (!spec) return;
                    const key = this.modelCacheKey(spec.name, spec.ext, spec.file);
                    if (!specs.some(other => this.modelCacheKey(other.name, other.ext, other.file) === key)) specs.push(spec);
                });
                return specs;
            };
        }
        // A map whose only model is a vehicle's is a map with models.
        if (typeof R._hasEventModelsNow === "function") {
            const hasEventModelsNow = R._hasEventModelsNow;
            R._hasEventModelsNow = function(data) {
                if (hasEventModelsNow.call(this, data)) return true;
                let found = false;
                eachRow(data, (event, id) => { const type = V.type(id); if (type && type.model && type.model.name) found = true; });
                return found;
            };
        }
    };

    //-------------------------------------------------------------------------
    // The vehicles of the map the party is on.

    // Kept between frames: this map's vehicle events, each with its row's `board` and `key`. Rebuilt whenever the
    // map's event list is another array (a map entered, a save loaded).
    const kept = { events: null, list: [], board: [], keys: [], types: [] };
    // The event `ridden()` last answered, and whether its ride has begun (`getOn()` has run and `getOff()` has not).
    let carried = null, riding = false;
    // The event list is being rebuilt: `ridden()` answers the event it knew until the new one is bound.
    let rebuilding = false;
    // Ticks left of a kept press to get off, and of the "no room" word.
    let keep = 0, noRoom = 0;

    V.idOf = function(event) {
        return event && event._eventId > 0 ? event._rrIdentity || (event._mapId || 0) + ":" + event._eventId : "";
    };

    /** Whether an event is a vehicle now: marked, not erased, and one of its pages in force. */
    V.isVehicle = function(event) {
        return !!event && event._rrVehicle > 0 && !event._erased && event._pageIndex >= 0;
    };

    const rowOf = function(event) {
        const data = mapData(), p = player();
        // While a transfer waits, the data is the next map's.
        if (!data || !data.events || (p && p.isTransferring && p.isTransferring())) return null;
        const authored = event._rrAuthored || data.events[event._eventId];
        return authored && authored.rrVehicle && typeof authored.rrVehicle === "object" ? authored.rrVehicle : null;
    };

    const rebuild = function(map) {
        kept.events = map._events;
        kept.list.length = 0; kept.board.length = 0; kept.keys.length = 0; kept.types.length = 0;
        const events = map.events();
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event || !(event._rrVehicle > 0)) continue;
            const row = rowOf(event);
            kept.list.push(event);
            kept.board.push(row && row.board === "command" ? "command" : "ok");
            kept.keys.push(row && typeof row.key === "string" ? row.key : "");
            kept.types.push(V.type(event._rrVehicle));
        }
    };

    /** This map's vehicle events. The array is this module's: read it, do not keep or change it. */
    V.list = function() {
        const map = typeof $gameMap !== "undefined" ? $gameMap : null;
        if (!map) return kept.list;
        if (kept.events !== map._events) rebuild(map);
        return kept.list;
    };

    V.any = function() {
        return V.list().length > 0;
    };

    const indexOf = event => V.list().indexOf(event);

    const registry = function(make) {
        const map = typeof $gameMap !== "undefined" ? $gameMap : null;
        if (!map) return null;
        if (!map._rrVehicles && make) map._rrVehicles = { v: 1, at: {} };
        return map._rrVehicles && map._rrVehicles.at ? map._rrVehicles : null;
    };

    // A vehicle can reuse Class/Weapon/Armor/State rules without becoming a party member.
    if (typeof Game_Actor !== "undefined") {
        function Game_ReactorVehicle() { this.initialize.apply(this, arguments); }
        Game_ReactorVehicle.prototype = Object.create(Game_Actor.prototype);
        Game_ReactorVehicle.prototype.constructor = Game_ReactorVehicle;
        Game_ReactorVehicle.prototype.initialize = function(typeId, identity) {
            Game_Battler.prototype.initialize.call(this);
            this._rrVehicleType = typeId; this._rrVehicleIdentity = identity;
            const record = this.actor();
            this._name = record.name; this._classId = record.classId;
            this._level = Math.max(1, Math.min(999, Math.floor(Number(record.initialLevel) || 1)));
            this.initExp(); this.initSkills(); this.initEquips(record.equips || []);
            this.recoverAll();
        };
        Game_ReactorVehicle.prototype.actor = function() {
            const record = typeof this._rrVehicleType === "string" ? root.$dataSystem && root.$dataSystem[this._rrVehicleType] && root.$dataSystem[this._rrVehicleType].reactorVehicle || {}
                : root.$dataReactorVehicles && root.$dataReactorVehicles[this._rrVehicleType] || {};
            return Object.assign({ name: "Vehicle", nickname: "", profile: "", note: "", traits: [], equips: [], maxLevel: 999,
                characterName: "", characterIndex: 0, faceName: "", faceIndex: 0, battlerName: "" }, record);
        };
        // Class is optional: intrinsic traits, skills and equipment still work.
        const transportClass = {id:0,traits:[],learnings:[],expParams:[30,20,30,30],
            params:Array.from({length:8},(_,param)=>Array(1000).fill(param === 0 ? 1 : 0))};
        Game_ReactorVehicle.prototype.currentClass = function() { return root.$dataClasses && root.$dataClasses[this._classId] || transportClass; };
        // Inherit Actor slots: class/vehicle/equipment/state traits supply
        // permissions, seals and Dual Wield, including on classless vehicles.
        Game_ReactorVehicle.prototype.initSkills = function() {
            Game_Actor.prototype.initSkills.call(this);
            for (const learning of this.actor().learnings || []) if (learning.level <= this._level) this.learnSkill(learning.skillId);
        };
        Game_ReactorVehicle.prototype.levelUp = function() {
            Game_Actor.prototype.levelUp.call(this);
            for (const learning of this.actor().learnings || []) if (learning.level === this._level) this.learnSkill(learning.skillId);
        };
        // A vehicle never trades with the party just to validate its initial loadout.
        Game_ReactorVehicle.prototype.tradeItemWithParty = function() { return true; };
        Game_ReactorVehicle.prototype.index = function() { return -1; };
        root.Game_ReactorVehicle = Game_ReactorVehicle;
    }

    V.battler = function(what) {
        const stockKey = typeof what === "string" && /^(?:stock:)?(boat|ship|airship)$/.test(what) ? what.replace(/^stock:/, "")
            : what && typeof what === "object" && !what._rrVehicle && ["boat","ship","airship"].includes(what._type) ? what._type : "";
        if (stockKey) {
            const record = root.$dataSystem && root.$dataSystem[stockKey] && root.$dataSystem[stockKey].reactorVehicle;
            if (!record || !root.Game_ReactorVehicle || !(root.$dataClasses && root.$dataClasses[record.classId] || record.traits?.length || record.learnings?.length || record.equips?.some(id => id > 0))) return null;
            const store = registry(true), identity = "stock:" + stockKey;
            if (!store.battlers) store.battlers = {};
            return store.battlers[identity] || (store.battlers[identity] = new root.Game_ReactorVehicle(stockKey, identity));
        }
        const event = V.find(what), identity = event ? V.idOf(event) : typeof what === "string" ? what.trim() : "";
        const store = registry(false);
        if (store && store.battlers && store.battlers[identity]) {
            const battler = store.battlers[identity];
            if (!event || battler._rrVehicleType === event._rrVehicle) return battler;
            delete store.battlers[identity];
        }
        const record = event && root.$dataReactorVehicles && root.$dataReactorVehicles[event._rrVehicle];
        if (!record || !root.Game_ReactorVehicle) return null;
        const hasClass = record.classId && root.$dataClasses && root.$dataClasses[record.classId];
        const intrinsic = record.traits && record.traits.length || record.learnings && record.learnings.length || record.equips && record.equips.some(id => id > 0);
        if (!hasClass && !intrinsic) return null;
        const live = registry(true);
        if (!live.battlers) live.battlers = {};
        return live.battlers[identity] = new root.Game_ReactorVehicle(event._rrVehicle, identity);
    };

    const groundOf = function(character) {
        if (Number.isFinite(character._reactorGround)) return character._reactorGround;
        const R = world();
        return R && R.characterGround && map3D() ? R.characterGround($dataMap, character) : 0;
    };

    /** Where a vehicle stands, into the registry. Plain fields only: the map's data may already be another map's. */
    const note = function(event, gone) {
        const home = event._rrHome, store = registry(true);
        if (!home || !store) return;
        const entry = {
            map: event._mapId, x: round3(event._realX), y: round3(event._realY),
            z: Number.isFinite(event._reactorGround) ? round3(event._reactorGround + (event._rrFree ? 0 : event._reactorLift || 0)) : null,
            yaw: round3(V.degrees(headingOf(event))), type: event._rrVehicle, home: [home[0], home[1]]
        };
        if (gone) entry.gone = true;
        const previous = store.at[V.idOf(event)];
        if (previous && previous.event) {
            entry.event = previous.event;
            if (previous.models) entry.models = previous.models;
        }
        if (!entry.event && event._rrAuthored && event._rrAuthored._rrDatabaseVehicle) entry.event = copy(event._rrAuthored);
        store.at[V.idOf(event)] = entry;
    };

    /** A vehicle's heading: its own while the mover holds it; on the grid, the facing a route or a command gave it. */
    const headingOf = function(event) {
        const yaw = event._rrYaw;
        if (!Number.isFinite(yaw)) return facingOf(event);
        if (event._rrFree || event._rrBoarded) return yaw;
        const d8 = event._reactorDir8;
        const facing = d8 === 1 || d8 === 3 || d8 === 7 || d8 === 9 ? d8 : event._direction;
        return dir8Of(yaw) === facing || dir4Of(yaw) === facing ? yaw : facingOf(event);
    };

    const atHome = function(event) {
        const home = event._rrHome;
        return !!home && !event._rrIdentity && !event._rrFree && event._realX === home[0] && event._realY === home[1]
            && Math.abs(turn360(V.degrees(headingOf(event)) - home[2] + 180) - 180) < 0.01;
    };

    /** Puts a vehicle where a registry entry or a command says: its middle off the grid, its height its own. */
    const place = function(event, x, y, z, degrees) {
        event._realX = x; event._realY = y;
        event._x = Math.round(x); event._y = Math.round(y);
        event._rrFree = 1;
        event._rrYaw = V.radians(degrees);
        face(event, event._rrYaw);
        if (Number.isFinite(z)) { event._reactorGround = z; event._reactorAlt = z; }
        event._reactorLift = 0; event._reactorZTarget = 0;
        event._reactorAir = 0; event._reactorVz = 0;
        event._rrSpeed = 0; event._rrSteer = 0; event._rrLean = 0;
        event._rrPose = (event._rrPose || 0) + 1;
    };

    /** Marks an event as the vehicle its row makes it, with its home; false when the row names no type that exists. */
    const mark = function(event, authored) {
        const row = authored.rrVehicle;
        const id = Math.floor(Number(row.type)) || 0;
        if (!(id > 0) || !V.type(id)) return false;
        const asked = number(row.yaw);
        const degrees = Number.isFinite(asked) ? turn360(asked) : DEGREES_OF_DIR[event._direction] === undefined ? 180 : DEGREES_OF_DIR[event._direction];
        if (authored._rrVehicleIdentity) {
            event._rrIdentity = authored._rrVehicleIdentity;
            event._rrAuthored = authored;
        }
        event._rrVehicle = id;
        event._rrHome = [authored.x, authored.y, degrees];
        event._rrYaw = degrees * RAD;
        face(event, event._rrYaw);
        return true;
    };

    /**
     * After the map's events are made: each vehicle event is marked, given its home and put where the registry
     * says. An entry is used only while its type and its event's authored tile are the ones it was written for.
     */
    const enterMap = function(map) {
        const data = mapData(), store = registry(false);
        const authored = data && data.events;
        const p = player(), transfer = p && p._rrVehicleTransfer;
        const types = root.$dataReactorVehicles;
        if (authored && types && types.length > 1) {
            for (let i = 1; i < authored.length; i++) {
                const row = authored[i] && authored[i].rrVehicle;
                const event = row && typeof row === "object" ? map._events[authored[i].id] : null;
                if (!event || !mark(event, authored[i])) continue;
                if (event._rrIdentity) event.refresh();
                const id = V.idOf(event), entry = store ? store.at[id] : null;
                if (!entry) continue;
                if (entry.type !== event._rrVehicle || !entry.home || (!event._rrIdentity && (entry.home[0] !== authored[i].x || entry.home[1] !== authored[i].y))) {
                    delete store.at[id];
                } else if (entry.map !== map._mapId) {
                    event._rrAway = true;
                    event.erase();
                } else if (entry.gone) {
                    event.erase();
                } else {
                    if (event._rrIdentity) event._rrHome = [entry.home[0], entry.home[1], entry.yaw];
                    place(event, entry.x, entry.y, entry.z, entry.yaw);
                }
                if (transfer && transfer.map === map._mapId && V.idOf(event) === transfer.identity && !event._erased) {
                    p._rrRide = { map: map._mapId, id: event._eventId };
                    event._rrBoarded = true;
                }
            }
        }
        rebuild(map);
        offer.event = null; offer.stamp = -1;
        if (V.bind && !transfer) V.bind();
    };

    /** Before another map is set up: where each vehicle of this one stands, unless it is at its home. */
    const leaveMap = function(map) {
        if (!map || !map._events || !map._events.length) return;
        const events = map.events();
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event || !(event._rrVehicle > 0) || !event._rrHome || event._rrAway) continue;
            const store = registry(false), id = V.idOf(event), entry = store ? store.at[id] : null;
            if (entry && entry.gone) continue;
            if (atHome(event)) { if (entry) delete store.at[id]; continue; }
            note(event, false);
        }
    };

    /**
     * A map whose events came from a save, not from `setupEvents`: an event the data has since made a vehicle is
     * marked where it stands, and one the data no longer makes a vehicle is an ordinary event again.
     */
    V.refresh = function() {
        const map = typeof $gameMap !== "undefined" ? $gameMap : null, data = mapData();
        const p = player();
        if (!map || !data || !data.events || (p && p.isTransferring && p.isTransferring())) return;
        const events = map.events();
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event || !(event._eventId > 0)) continue;
            if (event._rrAuthored) data.events[event._eventId] = event._rrAuthored;
            const authored = event._rrAuthored || data.events[event._eventId];
            const row = authored && authored.rrVehicle && typeof authored.rrVehicle === "object" ? authored.rrVehicle : null;
            if (row && !event._rrVehicle) mark(event, authored);
            else if (!row && event._rrVehicle && !event._rrBoarded) {
                event._rrVehicle = 0; event._rrHome = null; event._rrYaw = undefined;
                if (event._rrFree) { event._rrFree = 0; event._realX = event._x; event._realY = event._y; }
            }
        }
        rebuild(map);
    };

    /** Why this version rides no vehicle on this map now, whatever its type: "" when it does. */
    const mapRule = function() {
        if (!map3D()) return "";
        const map = $gameMap;
        if (map.isLoopHorizontal() || map.isLoopVertical()) return "loop";
        const camera = map._reactorCamera3d || (typeof map.reactorCamera3D === "function" ? map.reactorCamera3D() : null);
        return camera && camera.mode === "firstPerson" ? "firstPerson" : "";
    };

    /** Why this version does not ride a type anywhere: there is none, or its kind arrives later. */
    const kindRule = function(type) {
        return !type ? "type" : type.played === false ? "disabled" : "";
    };

    /** Whether a type has nothing to be drawn as: it names no model, or its model's file could not be read. */
    const modelRule = function(type, event) {
        const sprite = !!(type && type.sheet && type.sheet.characterName || event && (event._characterName || event._tileId > 0));
        if (!map3D()) return sprite ? "" : "image";
        const look = lookOf(type);
        if (!look || !look.spec) return sprite ? "" : "model";
        // The model's cache entry is looked up once it exists and kept: only its `failed` mark is read after.
        if (!look.cached || look.cached.failed) {
            const R = world();
            look.cached = (R && R._glbCache && R.specCacheKey && R._glbCache[R.specCacheKey(look.spec)]) || null;
        }
        return look.cached && look.cached.failed ? "model" : "";
    };

    /**
     * Why this version does not ride a vehicle here: "" when it does. In this order: the project's switch ("free"),
     * its type ("type", "kind"), the map ("flat", "loop", "firstPerson"), its model ("model").
     */
    V.scenery = function(event) {
        if (!V.free()) return "free";
        const type = event ? V.type(event._rrVehicle) : null;
        return kindRule(type) || mapRule() || modelRule(type,event);
    };

    /**
     * A vehicle of this map: an event, an event id, an identity "<mapId>:<eventId>", "ridden", "nearest", or a name
     * (`rrVehicle.key`; of several that carry it, the nearest to the leader).
     */
    V.find = function(what) {
        if (what && typeof what === "object") return V.isVehicle(what) ? what : null;
        const map = typeof $gameMap !== "undefined" ? $gameMap : null;
        if (!map) return null;
        if (typeof what === "number") { const event = map._events[what]; return V.isVehicle(event) ? event : null; }
        const name = String(what == null ? "" : what).trim();
        if (!name) return null;
        if (name === "ridden") return V.ridden();
        const identity = /^(\d+):(\d+)$/.exec(name);
        if (identity) {
            return V.list().find(event => V.idOf(event) === name && V.isVehicle(event)) || null;
        }
        const list = V.list(), p = player();
        let best = null, bestGap = Infinity;
        for (let i = 0; i < list.length; i++) {
            const event = list[i];
            if (!V.isVehicle(event) || (name !== "nearest" && kept.keys[i] !== name)) continue;
            const gap = p ? Math.hypot(event._realX - p._realX, event._realY - p._realY) : i;
            if (gap < bestGap) { best = event; bestGap = gap; }
        }
        return best;
    };

    /** Where a vehicle is: `{ map, x, y, z, yaw }`, tiles as `_realX`, degrees. From its event, else from the registry. */
    V.where = function(what) {
        const event = V.find(what);
        if (event) {
            return { map: event._mapId, x: round3(event._realX), y: round3(event._realY),
                z: round3(groundOf(event) + (event._rrFree ? 0 : event._reactorLift || 0)), yaw: round3(V.degrees(headingOf(event))) };
        }
        const store = registry(false), entry = store && typeof what === "string" ? store.at[what.trim()] : null;
        return entry && !entry.gone ? { map: entry.map, x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw } : null;
    };

    //-------------------------------------------------------------------------
    // Riding: the one invariant, and what the engine asks of a vehicle.

    const aboard = function(on, instant) {
        const p = player(), followers = p && p._followers;
        if (followers && typeof followers.rrAboard === "function") followers.rrAboard(on, instant);
    };

    const emit = function(name, event) {
        if (typeof ReactorEvents === "undefined" || !ReactorEvents || typeof ReactorEvents.emit !== "function") return;
        ReactorEvents.emit(name, { vehicle: V.idOf(event), type: event._rrVehicle || 0, eventId: event._eventId });
    };

    const sound = function(name) {
        if (V.Feel && typeof V.Feel.sound === "function") V.Feel.sound(name);
    };

    /** The ride that began ends: the vehicle's `getOff()` and the event, once. */
    const endRide = function(event) {
        if (!riding) return;
        riding = false;
        if (!event) return;
        sound("stop");
        if (typeof event.getOff === "function") event.getOff();
        emit("vehicleGetOff", event);
    };

    /**
     * The party on foot where it stands. Plain assignments on the player; the map's data and its events' data are
     * not read, so it is safe while a transfer has already loaded the next map.
     */
    V.putOnFoot = function() {
        const p = player();
        if (!p) return;
        const was = p._rrWas, event = carried;
        p._vehicleType = "walk";
        p._rrFree = 0;
        p._rrSeated = false;
        p._rrDrive = null;
        p._rrMount = null;
        p._rrRide = null;
        p._reactorRiding = false;
        p._reactorAir = 0;
        p._reactorVz = 0;
        if (was) { p._moveSpeed = was.speed; p._transparent = !!was.transparent; }
        p._rrWas = null;
        keep = 0; noRoom = 0; carried = null;
        if (event) { event._rrBoarded = false; event._reactorRiding = false; if (event._rrFree === 2) event._rrFree = 1; }
        aboard(false, true);
        endRide(event);
    };

    /**
     * The ridden vehicle's event, or null. While `_vehicleType` is "reactor" this answers an event of this map that
     * is a vehicle, has a page in force and is boarded; when there is none the party is put on foot first, so no
     * caller of `vehicle()` meets a null while `isInVehicle()` is true.
     */
    V.ridden = function() {
        const p = player();
        if (!p || p._vehicleType !== "reactor") return null;
        if (rebuilding) return carried;
        const ride = p._rrRide, map = $gameMap;
        if (ride && ride.map === map._mapId) {
            const event = map._events[ride.id], data = mapData();
            // While no map's data is loaded (a scene reads it again) the data is not asked: it decides once it is back.
            if (event && event._rrVehicle > 0 && !event._erased && event._pageIndex >= 0 && event._rrBoarded
                && (!data || (data.events && data.events[ride.id]))) {
                if (carried !== event) {
                    // Another object than the one known (a save loaded, the map's events made again): its ride has
                    // begun unless the hop on is still playing.
                    carried = event;
                    riding = !(p._rrMount && p._rrMount.on);
                }
                return event;
            }
        }
        V.putOnFoot();
        return null;
    };

    V.isRiding = function(query) {
        const event = V.ridden();
        if (!event) return false;
        if (query == null || query === "") return true;
        if (typeof query === "object") return query.type == null || event._rrVehicle === Number(query.type);
        const name = String(query);
        return name === V.idOf(event) || kept.keys[indexOf(event)] === name;
    };

    /** Tiles a second, signed; 0 on foot. */
    V.speed = function() {
        const p = player(), drive = p && p._vehicleType === "reactor" ? p._rrDrive : null;
        return drive && Number.isFinite(drive.v) ? drive.v : 0;
    };

    /** The carried event takes the player's place, heights and heading, and is walked through. Counts a change. */
    const carry = function(event, p) {
        const drive = p._rrDrive;
        let changed = event._realX !== p._realX || event._realY !== p._realY || event._reactorGround !== p._reactorGround || event._reactorAir !== p._reactorAir;
        event._x = p._x; event._y = p._y;
        event._realX = p._realX; event._realY = p._realY;
        event._direction = p._direction; event._reactorDir8 = p._reactorDir8;
        event._reactorGround = p._reactorGround; event._reactorAlt = p._reactorAlt;
        event._reactorAir = p._reactorAir; event._reactorVz = p._reactorVz;
        event._reactorRiding = true;
        event._through = true;
        if (drive && Number.isFinite(drive.yaw) && event._rrYaw !== drive.yaw) { event._rrYaw = drive.yaw; changed = true; }
        if (changed) event._rrPose = (event._rrPose || 0) + 1;
    };

    /** The page's own Through, for a vehicle that stands by itself again. */
    const pageThrough = function(event) {
        const data = mapData(), authored = data && data.events ? data.events[event._eventId] : null;
        const page = authored && authored.pages ? authored.pages[event._pageIndex] : null;
        return !!(page && page.through);
    };

    /** A vehicle's lift is spent the first time it is ridden or placed: where it stood lifted is the ground it stands on. */
    const spendLift = function(event) {
        const R = world(), P = physics();
        let ground = groundOf(event);
        const lift = Number(event._reactorLift) || 0;
        if (lift > 0) {
            let best = ground + lift, gap = 0.5;
            const levels = P && P.levelsAt && map3D() ? P.levelsAt($dataMap, Math.round(event._realX), Math.round(event._realY)) : null;
            if (levels) for (let i = 0; i < levels.length; i++) {
                const off = Math.abs(levels[i].top - (ground + lift));
                if (off < gap) { gap = off; best = levels[i].top; }
            }
            ground = best;
        } else if (!Number.isFinite(ground)) ground = R && map3D() ? R.groundHeightAt($dataMap, event._realX + 0.5, event._realY + 0.5) : 0;
        event._reactorGround = ground; event._reactorAlt = ground;
        event._reactorLift = 0; event._reactorZTarget = 0;
        return ground;
    };

    /**
     * Parks a vehicle where it stands: held by nobody, solid again, its place written. Its heading, height and
     * pitch are kept.
     */
    V.park = function(event) {
        if (!event) return;
        event._rrFree = 1;
        event._x = Math.round(event._realX); event._y = Math.round(event._realY);
        if (Number.isFinite(event._rrYaw)) face(event, event._rrYaw);
        event._through = pageThrough(event);
        event._rrSpeed = 0;
        event._reactorAir = 0; event._reactorVz = 0;
        event._rrPose = (event._rrPose || 0) + 1;
        if (V.Drive && typeof V.Drive.leave === "function") V.Drive.leave(event);
        note(event, false);
    };

    /** Whether the party can be put down on a tile: a place to stand near that height, and nobody's body on it. */
    const canStand = function(x, y, ground, out) {
        if (!$gameMap.isValid(x, y)) return false;
        const R = world(), P = physics(), p = player();
        let height = ground;
        if (P && P.standingAt && map3D()) {
            const at = P.standingAt($dataMap, x, y, ground, STAND);
            if (at === null) return false;
            height = at;
        } else if (!$gameMap.checkPassage(x, y, 0x0f)) return false;
        if (map3D() && R && R.bodyBlocksTile) { if (R.bodyBlocksTile(p, x, y, true)) return false; }
        else if ($gameMap.eventsXyNt(x, y).some(event => event.isNormalPriority())) return false;
        if (out) out[2] = height;
        return true;
    };
    const STAND = { within: 1 };

    const coversTile = function(event, x, y) {
        if (event._x === x && event._y === y) return true;
        const R = world();
        return !!(map3D() && R && R.eventBodyCovers && R.eventBodyCovers(event, x, y));
    };

    /**
     * Where the leader gets off a parked vehicle: left of it (its body's radius and 0.8 tile from its middle), then
     * right, behind and ahead (half its length and 0.8); the first tile there that is no tile of the vehicle itself,
     * has a place to stand and is free of bodies. `out` is filled with `[x, y, ground]`; null when no side has one.
     */
    const SIDES = [0, 0, 0, 0, 0, 0, 0, 0];
    V.landingSpot = function(event, out) {
        out = out || [0, 0, 0];
        const yaw = Number.isFinite(event._rrYaw) ? event._rrYaw : facingOf(event);
        const type = V.type(event._rrVehicle);
        const mx = event._realX + 0.5, my = event._realY + 0.5;
        const fx = Math.sin(yaw), fy = -Math.cos(yaw), lx = fy, ly = -fx;
        const side = map3D() ? (type && type.body && type.body.radius > 0 ? type.body.radius : 0.45) + 0.8 : 1, end = map3D() ? dimsOf(type).length / 2 + 0.8 : 1;
        const ground = groundOf(event);
        SIDES[0] = lx * side; SIDES[1] = ly * side; SIDES[2] = -lx * side; SIDES[3] = -ly * side;
        SIDES[4] = -fx * end; SIDES[5] = -fy * end; SIDES[6] = fx * end; SIDES[7] = fy * end;
        for (let n = 0; n < 4; n++) {
            const ox = SIDES[n * 2], oy = SIDES[n * 2 + 1], reach = Math.hypot(ox, oy);
            let lastX = NaN, lastY = NaN;
            // Outward past whatever of that side the vehicle's own body still covers.
            for (let more = 0; more <= 1.5; more += 0.5) {
                const scale = (reach + more) / reach;
                const x = $gameMap.roundX(Math.floor(mx + ox * scale)), y = $gameMap.roundY(Math.floor(my + oy * scale));
                if (x === lastX && y === lastY) continue;
                lastX = x; lastY = y;
                if (coversTile(event, x, y)) continue;
                if (canStand(x, y, ground, out)) { out[0] = x; out[1] = y; return out; }
                break;
            }
        }
        return null;
    };

    /** Tile passage and authored 3D water for the selected travel medium. */
    V.surfacePassable = function(type, x, y) {
        if (!$gameMap.isValid(x,y)) return false;
        if (type.medium === "air") return true;
        if (type.medium !== "water") return $gameMap.checkPassage(x,y,0x0f);
        const R=world();
        if (map3D() && R.waterSurfaceAt && Number.isFinite(R.waterSurfaceAt($dataMap,x+0.5,y+0.5))) return true;
        return type.passability === "ship" ? $gameMap.isShipPassable(x,y) : $gameMap.isBoatPassable(x,y);
    };

    /** Whether the vehicle body fits at a heading and the nearest standing height. */
    V.fits = function(event, x, y, radians, height) {
        if (!event || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        const R = world(), type = V.type(event._rrVehicle);
        if (!map3D() || type && type.medium !== "ground") {
            const tx = $gameMap.roundX(Math.round(x)), ty = $gameMap.roundY(Math.round(y));
            if (!$gameMap.isValid(tx,ty)) return false;
            if (type && type.medium === "air") return true;
            if (type && !V.surfacePassable(type,tx,ty)) return false;
            if ((!type || type.medium === "ground") && !$gameMap.checkPassage(tx,ty,0x0f)) return false;
            return !$gameMap.eventsXyNt(tx,ty).some(other => other !== event && other.isNormalPriority());
        }
        const from = Number.isFinite(height) ? height : groundOf(event);
        const was = [event._x, event._y, event._realX, event._realY, event._direction, event._reactorDir8, event._rrFree, event._through];
        const p = player(), ignoreRider = p && event._rrBoarded && p._rrRide && p._rrRide.map === event._mapId && p._rrRide.id === event._eventId;
        const through = p && p._through;
        if (ignoreRider) p._through = true;
        try {
            event._x = Math.round(x); event._y = Math.round(y); event._realX = x; event._realY = y;
            if (Number.isFinite(radians)) face(event, radians);
            event._rrFree = 1;
            // Its middle's tile has a place to stand (a tile off the map has none); then every tile of its body is on the
            // map, has one within a step of that, and is free of bodies.
            const P = physics(), deep = !!(P && P.standingAt && map3D());
            const near = deep ? P.standingAt($dataMap, event._x, event._y, from, null) : 0;
            let ok = !(deep && near === null);
            const shape = ok && R && R.eventBody ? R.eventBody(event) : null;
            if (shape) {
                for (let j = 0; ok && j < shape.h; j++) for (let i = 0; ok && i < shape.w; i++) {
                    if (shape.cells !== null && !shape.cells[j * shape.w + i]) continue;
                    const tx = event._x + shape.ox + i, ty = event._y + shape.oy + j;
                    if (!$gameMap.isValid(tx, ty) || (deep && P.standingAt($dataMap, tx, ty, near, STAND) === null)) ok = false;
                }
                if (ok && R.bodyFits && !R.bodyFits(event, event._x, event._y)) ok = false;
            } else if (ok && (!$gameMap.isValid(event._x, event._y) || $gameMap.eventsXyNt(event._x, event._y).some(other => other !== event && other.isNormalPriority()))) ok = false;
            return ok;
        } finally {
            event._x = was[0]; event._y = was[1]; event._realX = was[2]; event._realY = was[3];
            event._direction = was[4]; event._reactorDir8 = was[5]; event._rrFree = was[6]; event._through = was[7];
            if (ignoreRider) p._through = through;
        }
    };

    /**
     * Puts a parked vehicle with its middle on (x + 0.5, y + 0.5), facing `degrees`. False where its body does not
     * fit. Where a tile has several floors it arrives on the lowest it can stand on, as a transfer lands on the
     * ground floor, whatever height it stood at before; with `z` (a height, as `where()` answers it), on the floor
     * nearest that.
     */
    V.setLocation = function(what, x, y, degrees, z) {
        x = number(x); y = number(y);
        const asked = number(degrees), height = number(z);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
        const map = $gameMap, name = typeof what === "string" ? what.trim() : what;
        let event = V.find(name);
        if (!event && typeof name === "string") {
            // One that was taken out of the world comes back where it is put.
            const identity = /^(\d+):(\d+)$/.exec(name);
            const gone = identity && Number(identity[1]) === map._mapId ? map._events[Number(identity[2])] : null;
            if (gone && gone._rrVehicle > 0 && gone._erased) event = gone;
        }
        if (!event) return false;
        if (event._rrBoarded || event === carried) return false;
        const radians = Number.isFinite(asked) ? V.radians(asked) : headingOf(event);
        const erased = event._erased;
        const P = physics(), deep = !!(P && P.standingAt && map3D());
        const ground = deep ? P.standingAt($dataMap, Math.round(x), Math.round(y), Number.isFinite(height) ? height : undefined, null) : 0;
        if (ground === null || !V.fits(event, x, y, radians, ground)) return false;
        if (erased) { event._erased = false; event.refresh(); }
        place(event, x, y, deep ? world().groundHeightAt($dataMap, x + 0.5, y + 0.5, ground) : 0, V.degrees(radians));
        event._through = pageThrough(event);
        note(event, false);
        offer.stamp = -1;
        return true;
    };

    /** Takes a parked vehicle out of the world; it is put back by `setLocation`. */
    V.remove = function(what) {
        const event = V.find(what);
        if (!event || event._rrBoarded) return false;
        note(event, true);
        event.erase();
        offer.stamp = -1;
        return true;
    };

    //-------------------------------------------------------------------------
    // Which vehicle OK would board.

    const offer = { event: null, stamp: -1 };
    const NEAR = { x: 0, z: 0 };

    const heightOf = character => (Number.isFinite(character._reactorGround) ? character._reactorGround : 0) + (character._reactorLift || 0) + (character._reactorAir > 0 ? character._reactorAir : 0);

    /** How far a point of the ground is from a vehicle's body, with the nearest point of the body left in NEAR. */
    const gapTo = function(R, event, wx, wz) {
        const shape = R && R.eventBody ? R.eventBody(event) : null;
        // A vehicle that stands off the grid has its body marked round its own tile; one that glides is where it is drawn.
        const off = event._rrFree || !shape || !shape.model;
        const bx = (off ? event._x : event._realX) + (shape ? shape.ox : 0), bz = (off ? event._y : event._realY) + (shape ? shape.oy : 0);
        const w = shape ? shape.w : 1, h = shape ? shape.h : 1, cells = shape ? shape.cells : null;
        let best = Infinity;
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                if (cells !== null && !cells[j * w + i]) continue;
                const cx = wx < bx + i ? bx + i : wx > bx + i + 1 ? bx + i + 1 : wx;
                const cz = wz < bz + j ? bz + j : wz > bz + j + 1 ? bz + j + 1 : wz;
                const d = Math.hypot(cx - wx, cz - wz);
                if (d < best) { best = d; NEAR.x = cx; NEAR.z = cz; }
            }
        }
        return best;
    };

    const hasList = function(data, event) {
        if (event._erased || event._pageIndex < 0) return false;
        const authored = data && data.events ? data.events[event._eventId] : null;
        const page = authored && authored.pages ? authored.pages[event._pageIndex] : null;
        return !!(page && page.list && page.list.length > 1);
    };

    // The events whose body is more than their own tile, each with how far from its own tile a tile of it can lie.
    // Asking an event for its body costs a few microseconds the first time in a frame, and a map has dozens of
    // events and a handful of big ones: only those are asked, and of those only the ones near the tile in question.
    // `events` is the map's events as `$gameMap.events()` answers them. The map's own array is never walked by
    // index: it has a slot for every id up to the highest, and a map's props are numbered from 10000 up.
    const big = { events: null, stamp: -1, list: [], far: [] };
    const bigBodies = function(map, R, events) {
        const tick = Graphics.frameCount >= 0 ? Graphics.frameCount : -1;
        if (big.events === map._events && tick >= 0 && big.stamp >= 0 && tick >= big.stamp && tick - big.stamp < V.BODIES) return big.list;
        big.events = map._events; big.stamp = tick; big.list.length = 0; big.far.length = 0;
        // Without the 3D runtime every body is its own tile.
        if (!R || !R.eventBody) return big.list;
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event._erased || event._rrFree === 2) continue;
            // A sized event is its rectangle whatever it is drawn as; a model, the tiles under it.
            const shape = R.eventBody(event);
            if (!(shape.count > 1 || shape.ox !== 0 || shape.oy !== 0)) continue;
            big.list.push(event);
            // The engine's own bound for it at any facing, gliding or turning; without one, its reach turned a corner
            // and a tile more.
            const held = event._reactorBody;
            big.far.push(held && held.far >= shape.reach ? held.far : Math.ceil(shape.reach * Math.SQRT2) + 1);
        }
        return big.list;
    };

    /** Whether a press of OK starts an event: its trigger and priority are the press's, its page has commands, and it is no vehicle OK boards. */
    const pressed = function(event, data, normal, except) {
        if (event === except || event._erased) return false;
        const trigger = event._trigger;
        if (normal ? trigger !== 0 && trigger !== 1 && trigger !== 2 : trigger !== 0) return false;
        if ((event._priorityType === 1) !== normal || !hasList(data, event)) return false;
        // A vehicle OK boards is not started by the press: its page is not what the press is for.
        const at = event._rrVehicle > 0 ? indexOf(event) : -1;
        return !(at >= 0 && kept.board[at] !== "command");
    };

    /**
     * Whether a press of OK would start an event on a tile: normal priority and an action or touch trigger, or one
     * under or over the party. `events` is the map's events, listed once for the whole look.
     */
    const pressStarts = function(events, data, x, y, normal, except) {
        // Whoever has that tile as its own, by plain counting.
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event._x === x && event._y === y && pressed(event, data, normal, except)) return true;
        }
        // A body that is more than its tile: asked only when it is near enough for a tile of it to lie there, and
        // still one of the map's events (the list of them is up to `BODIES` ticks old).
        const bodies = big.list, own = big.events;
        for (let i = 0; i < bodies.length; i++) {
            const event = bodies[i], far = big.far[i];
            if (event._x - x > far || x - event._x > far || event._y - y > far || y - event._y > far) continue;
            if (own[event._eventId] === event && pressed(event, data, normal, except) && event.pos(x, y)) return true;
        }
        return false;
    };

    /** Whether the tile the leader faces (and the one past a counter) holds an event OK would start. */
    const pressAhead = function(map, events, data, p, except) {
        const d = p._direction;
        const x2 = map.roundXWithDirection(p._x, d), y2 = map.roundYWithDirection(p._y, d);
        if (pressStarts(events, data, x2, y2, true, except)) return true;
        // Whether that tile is a counter is asked only when somebody stands past it: the map makes a list of the
        // tile's layers to answer.
        return pressStarts(events, data, map.roundXWithDirection(x2, d), map.roundYWithDirection(y2, d), true, except) && map.isCounter(x2, y2);
    };

    const doorNear = function(R, map, data, p) {
        if (!R || typeof R.doorAt !== "function" || !data) return false;
        const d = p._direction;
        return !!(R.doorAt(data, map.roundXWithDirection(p._x, d), map.roundYWithDirection(p._y, d)) || R.doorAt(data, p._x, p._y));
    };

    /** On foot and free to board: no event, no message, not swimming, climbing or in the air, no battle on the map. */
    const partyFree = function(p, map, busy) {
        if (p._vehicleType !== "walk" || p._rrMount) return false;
        if (p._reactorSwim || p._reactorOnLadder || p._reactorMantle) return false;
        // In the air as the physics counts it: a jump or a fall, not a step down.
        if (!p._reactorRiding && !p._reactorStepDown && (p._reactorAir > 0.02 || p._reactorVz > 0)) return false;
        const fight = typeof $gameFight !== "undefined" ? $gameFight : null;
        if (fight && fight.isHere()) return false;
        if (busy) return true;
        // An event that runs, by the map's interpreter. This is asked every drawn frame while a label may show, so
        // the map's events are not gone through for one that is only starting: no press is read on such a tick.
        const interpreter = map._interpreter;
        return !(interpreter && interpreter.isRunning()) && !$gameMessage.isBusy();
    };

    const pick = function(p, map) {
        const list = kept.list, R = world(), data = mapData();
        if (!R || !data || !V.free() || mapRule()) return null;
        if (!map3D()) {
            const dx = map.roundXWithDirection(p.x,p.direction()), dy = map.roundYWithDirection(p.y,p.direction());
            const candidate = list.find((event,i) => !event._erased && event._pageIndex >= 0 && kept.board[i] !== "command" &&
                !V.scenery(event) && (event.pos(dx,dy) || event.pos(p.x,p.y)));
            if (!candidate || map.eventsXy(dx,dy).some(other => other !== candidate && !V.isVehicle(other) && other.isNormalPriority() && other.isTriggerIn([0,1,2]))) return null;
            const battler = V.battler(candidate);
            return battler && battler.isDead() ? null : candidate;
        }
        const wx = p._realX + 0.5, wz = p._realY + 0.5, height = heightOf(p), facing = facingOf(p);
        const within = Math.cos(V.FACING * RAD), sin = Math.sin(facing), cos = Math.cos(facing);
        let best = null, bestGap = Infinity, bestFaced = false;
        for (let i = 0; i < list.length; i++) {
            const event = list[i], type = kept.types[i];
            // One that is no longer among the map's events (taken out of its array by other code) is no vehicle here.
            if (event._erased || event._pageIndex < 0 || kept.board[i] === "command" || !type || map._events[event._eventId] !== event) continue;
            // Too far by plain counting for any part of it to be in reach: nothing of its body is asked.
            const far = (type.model && type.model.size > 0 ? type.model.size : 4) + V.REACH + 1;
            if (Math.abs(event._realX + 0.5 - wx) > far || Math.abs(event._realY + 0.5 - wz) > far) continue;
            if (Math.abs(heightOf(event) - height) > V.REACH_HEIGHT) continue;
            const gap = gapTo(R, event, wx, wz);
            if (gap > V.REACH) continue;
            // The direction to the nearest point of its body against his facing; on its body he faces it.
            const dx = NEAR.x - wx, dz = NEAR.z - wz, length = Math.hypot(dx, dz);
            const faced = length < 1e-6 || (dx * sin - dz * cos) / length >= within - 1e-9;
            if (!(faced === bestFaced ? gap < bestGap : faced) || kindRule(type) || modelRule(type,event)) continue;
            const battler = V.battler(event);
            if (battler && battler.isDead()) continue;
            best = event; bestGap = gap; bestFaced = faced;
        }
        if (!best) return null;
        // With a vehicle in reach the map's events are listed, once for this look.
        const events = map.events();
        bigBodies(map, R, events);
        // Someone on the tile he faces keeps the press, whichever way the vehicle lies.
        if (pressAhead(map, events, data, p, best)) return null;
        // Not faced, it answers only when the press has nothing else to do.
        if (!bestFaced && (pressStarts(events, data, p._x, p._y, false, best) || doorNear(R, map, data, p))) return null;
        return best;
    };

    /**
     * The vehicle OK boards now, or null. Looked for every `LOOK` ticks while a vehicle event is on the map; between
     * looks the answer is kept, and it is null the moment the party is not free. `now` looks at once.
     */
    V.offered = function(now) {
        const map = $gameMap;
        if (!map) return null;
        if (kept.events !== map._events) rebuild(map);
        if (!kept.list.length) return null;
        const p = $gamePlayer;
        if (!p || !partyFree(p, map, false)) return null;
        const frames = Graphics.frameCount, tick = frames >= 0 ? frames : -1;
        if (now || tick < 0 || offer.stamp < 0 || tick < offer.stamp || tick - offer.stamp >= V.LOOK) {
            offer.stamp = tick;
            offer.event = pick(p, map);
        }
        const event = offer.event;
        return event && event._rrVehicle > 0 && !event._erased && event._pageIndex >= 0 ? event : null;
    };

    /**
     * What the label says now: `{ event, word, action }`, or null. On foot, the word of the vehicle OK boards;
     * aboard, the leaving word while a press to get off is kept, and the "no room" word (no key: `action` is "")
     * after a place to stand was not found. The same object every time: read it, do not keep it.
     */
    const PROMPT = { event: null, word: "", action: "ok" };
    V.prompt = function() {
        const p = player();
        if (!p) return null;
        if (p._vehicleType === "reactor") {
            const event = p._rrMount ? null : V.ridden();
            if (!event) return null;
            const drive = p._rrDrive;
            if (noRoom > 0) { PROMPT.event = event; PROMPT.word = V.term("noRoom"); PROMPT.action = ""; return PROMPT; }
            if (!drive || drive.leave !== "ok") return null;
            PROMPT.event = event; PROMPT.word = V.words(V.type(event._rrVehicle)).leave; PROMPT.action = "cancel";
            return PROMPT;
        }
        const event = V.offered(false);
        if (!event) return null;
        PROMPT.event = event; PROMPT.word = V.words(kept.types[kept.list.indexOf(event)]).prompt; PROMPT.action = "ok";
        return PROMPT;
    };

    //-------------------------------------------------------------------------
    // Getting on and off: the two hops as state.

    const ease = k => k * k * (3 - 2 * k);

    /** The rider nobody draws on the seat: the type hides its rider, or the leader has no model. */
    const hidesRider = function(type, p) {
        if (!map3D() || type && type.rider === "inside") return true;
        const R = world();
        return !!(R && R.characterModelSpec && map3D() && !R.characterModelSpec(p));
    };

    /** Tick 0 of the hop on. The vehicle stays where it is, solid; the player stands still and is moved by the hop. */
    const board = function(event, instant) {
        const p = player();
        if (!p || !V.isVehicle(event) || p._vehicleType !== "walk" || p._rrMount || fightHere() || V.scenery(event)) return false;
        const battler = V.battler(event);
        if (battler && battler.isDead()) return false;
        const yaw = headingOf(event);
        event._rrYaw = yaw;
        p._rrWas = { speed: p._moveSpeed, transparent: !!p._transparent };
        p._vehicleType = "reactor";
        p._rrRide = { map: $gameMap._mapId, id: event._eventId };
        p._rrSeated = true;
        p._rrFree = 1;
        p._rrDrive = { v: 0, steer: 0, yaw, vz: 0, pitch: 0, roll: 0, travel: 0, leave: "", rest: 0, foot: 0, grid: 0, dry: null };
        p._rrMount = { t: 0, n: V.HOP, on: true, drawn: false, fx: p._realX, fy: p._realY, fz: groundOf(p), fyaw: facingOf(p),
            tx: event._realX, ty: event._realY, tz: groundOf(event) + (event._reactorLift || 0) };
        p._x = Math.round(event._realX); p._y = Math.round(event._realY);
        event._rrBoarded = true;
        event._rrFree = 1;
        event._rrSpeed = 0;
        event._rrPose = (event._rrPose || 0) + 1;
        carried = event; riding = false; keep = 0; noRoom = 0;
        offer.event = null; offer.stamp = -1;
        if (typeof $gameTemp !== "undefined" && $gameTemp && $gameTemp.clearDestination) $gameTemp.clearDestination();
        aboard(true, false);
        if (instant) V.settle();
        return true;
    };

    /** Tick 14 of the hop on: seated. The vehicle is carried from here. */
    const seat = function(event, p) {
        const ground = spendLift(event);
        event._rrFree = 2;
        event._through = true;
        event._x = Math.round(event._realX); event._y = Math.round(event._realY);
        p._realX = event._realX; p._realY = event._realY; p._x = event._x; p._y = event._y;
        if (p._rrDrive) { p._rrDrive.yaw = event._rrYaw; p._rrDrive.v = 0; p._rrDrive.leave = ""; }
        face(p, event._rrYaw);
        p._reactorGround = ground; p._reactorAlt = ground; p._reactorAir = 0; p._reactorVz = 0;
        p._reactorRiding = true; event._reactorRiding = true;
        if (hidesRider(V.type(event._rrVehicle), p)) p._transparent = true;
        p._rrMount = null;
        event._rrPose = (event._rrPose || 0) + 1;
        if (V.Drive && typeof V.Drive.board === "function") V.Drive.board(event);
        riding = true;
        sound("start");
        event.getOn();
        emit("vehicleGetOn", event);
        if (V.Hints && typeof V.Hints.note === "function") V.Hints.note("boarded");
    };

    /** Tick 14 of the hop off: on foot on the tile, facing the way the vehicle faces. */
    const alight = function(event, p, mount) {
        const was = p._rrWas;
        p._rrSeated = false;
        p._rrFree = 0;
        p._vehicleType = "walk";
        p._rrRide = null;
        event._rrBoarded = false;
        if (was) { p._moveSpeed = was.speed; p._transparent = !!was.transparent; }
        p._rrWas = null;
        p._reactorRiding = false; event._reactorRiding = false;
        p._x = mount.tx; p._y = mount.ty; p._realX = mount.tx; p._realY = mount.ty;
        const ground = Number.isFinite(mount.tz) ? mount.tz : groundOf(p);
        p._reactorGround = ground; p._reactorAlt = ground; p._reactorAir = 0; p._reactorVz = 0;
        face(p, Number.isFinite(event._rrYaw) ? event._rrYaw : mount.fyaw);
        p._rrDrive = null;
        p._rrMount = null;
        keep = 0; noRoom = 0; carried = null;
        event._rrPose = (event._rrPose || 0) + 1;
        if (p.makeEncounterCount) p.makeEncounterCount();
        aboard(false, false);
        endRide(event);
    };

    /**
     * One tick of a hop: the player's place eases to where the hop ends, and the last tick seats the party or puts
     * it on foot. A hop that is only drawn (a battle began aboard) counts its ticks and moves nothing.
     */
    V.hop = function() {
        const p = player(), mount = p && p._rrMount;
        if (!mount) return;
        mount.t++;
        if (mount.drawn) {
            if (mount.t >= mount.n) p._rrMount = null;
            return;
        }
        const event = V.ridden();
        if (!event) return;
        const k = ease(Math.min(1, mount.t / mount.n));
        if (mount.on) { mount.tx = event._realX; mount.ty = event._realY; mount.tz = groundOf(event) + (event._reactorLift || 0); }
        p._realX = mount.fx + (mount.tx - mount.fx) * k;
        p._realY = mount.fy + (mount.ty - mount.fy) * k;
        if (Number.isFinite(mount.fz) && Number.isFinite(mount.tz)) {
            p._reactorGround = mount.fz + (mount.tz - mount.fz) * k;
            if (Number.isFinite(p._reactorAlt)) p._reactorAlt = p._reactorGround;
        }
        event._rrPose = (event._rrPose || 0) + 1;
        if (mount.t < mount.n) return;
        if (mount.on) seat(event, p);
        else alight(event, p, mount);
    };

    /** Finishes a hop at once: seated, or on foot on its tile. */
    V.settle = function() {
        const p = player();
        for (let guard = 0; p && p._rrMount && guard < 64; guard++) V.hop();
    };

    /**
     * The party gets off a vehicle that is slow enough: it is parked first, then a place beside it is looked for.
     * With none it is carried again, the buzzer plays and the label says so.
     */
    const SPOT = [0, 0, 0];
    const dismount = function(event, p) {
        const drive = p._rrDrive;
        if (drive) { drive.leave = ""; drive.v = 0; }
        keep = 0;
        V.park(event);
        const spot = V.landingSpot(event, SPOT);
        if (!spot) {
            event._rrFree = 2;
            event._through = true;
            noRoom = V.KEEP;
            if (typeof SoundManager !== "undefined" && SoundManager.playBuzzer) SoundManager.playBuzzer();
            return false;
        }
        const was = p._rrWas;
        if (was) p._transparent = !!was.transparent;
        p._rrMount = { t: 0, n: V.HOP, on: false, drawn: false, fx: p._realX, fy: p._realY, fz: groundOf(p),
            fyaw: Number.isFinite(event._rrYaw) ? event._rrYaw : facingOf(p), tx: spot[0], ty: spot[1], tz: spot[2] };
        p._x = spot[0]; p._y = spot[1];
        noRoom = 0;
        return true;
    };

    const slowEnough = function(p) {
        const drive = p._rrDrive;
        return !(drive && Math.abs(drive.v || 0) >= V.SLOW) && !(p._reactorAir > 0.02) && !(drive && drive.air > 0);
    };

    /** A press to get off: kept while the vehicle slows by itself; the hop starts with it when it is slow already. */
    const leave = function() {
        const p = player(), event = V.ridden();
        if (!event) return false;
        const mount = p._rrMount;
        if (mount) return !mount.on;
        if (!p._rrDrive) p._rrDrive = { v: 0, steer: 0, yaw: event._rrYaw, vz: 0, pitch: 0, roll: 0, travel: 0, leave: "", rest: 0, foot: 0, grid: 0, dry: null };
        p._rrDrive.leave = "ok";
        keep = V.KEEP; noRoom = 0;
        if (slowEnough(p)) dismount(event, p);
        return true;
    };

    /** One tick aboard, after the vehicle has taken the player's place: the kept press, and the word that runs out. */
    const aboardTick = function(event, p) {
        if (noRoom > 0) noRoom--;
        const drive = p._rrDrive;
        if (!drive || drive.leave !== "ok" || p._rrMount) return;
        // A press a save carried is kept from the tick the game goes on.
        if (keep <= 0) keep = V.KEEP;
        if (--keep <= 0) { drive.leave = ""; return; }
        if (slowEnough(p)) dismount(event, p);
    };

    /** Boards a vehicle by name, identity or event. False when it cannot be boarded here. */
    V.getOn = function(what, options) {
        const event = V.find(what), p = player();
        if (!event || !p) return false;
        const far = Math.hypot(event._realX - p._realX, event._realY - p._realY) > V.HOP_REACH + dimsOf(V.type(event._rrVehicle)).length / 2;
        return board(event, !!(options && options.instant) || far);
    };

    /** Gets the party off: braking first, then the hop. With `instant` at once, and false when there is nowhere to stand. */
    V.getOff = function(options) {
        const p = player();
        if (!p || p._vehicleType !== "reactor") return false;
        if (!(options && options.instant)) return leave();
        V.settle();
        if (p._vehicleType !== "reactor") return true;
        const event = V.ridden();
        if (!event) return true;
        if (!dismount(event, p)) return false;
        V.settle();
        return true;
    };

    /** Whether a hop is running or a press to get off is kept: what the wait mode waits for. */
    V.isBusy = function() {
        const p = player();
        if (!p) return false;
        if (p._rrMount && !p._rrMount.drawn) return true;
        return p._vehicleType === "reactor" && !!p._rrDrive && p._rrDrive.leave === "ok";
    };

    /**
     * After the map's events were made again, or a save was loaded: the ridden vehicle is found by `_rrRide` and
     * holds the carried state. Returns it, or null on foot.
     */
    V.bind = function() {
        const p = player();
        if (!p || p._vehicleType !== "reactor") return null;
        const ride = p._rrRide, map = $gameMap;
        const event = ride && ride.map === map._mapId ? map._events[ride.id] : null;
        if (event && event._rrVehicle > 0 && !event._erased && event._pageIndex >= 0) {
            event._rrBoarded = true;
            const mount = p._rrMount;
            // In a hop the vehicle stands by itself; seated, it is carried.
            if (mount && !mount.drawn) event._rrFree = 1;
            else { event._rrFree = 2; carry(event, p); }
        }
        return V.ridden();
    };

    //-------------------------------------------------------------------------
    // OK aboard: someone to act on, before getting off.

    // A line over the grid from a point: the tiles it passes through, in order, each with how far along the line it
    // begins. A tile is in a reach when it begins within it, whichever way the line runs. One kept record per line.
    const line = () => ({ x: 0, y: 0, t: 0, stepX: 0, stepY: 0, nextX: 0, nextY: 0, perX: 0, perY: 0 });
    const AHEAD = line(), LEFT = line(), RIGHT = line();
    const lineFrom = function(ray, mx, my, dx, dy) {
        ray.x = Math.floor(mx); ray.y = Math.floor(my); ray.t = 0;
        ray.stepX = dx > 0 ? 1 : -1; ray.stepY = dy > 0 ? 1 : -1;
        // A direction that runs along one axis crosses no line of the other.
        ray.perX = Math.abs(dx) > 1e-9 ? 1 / Math.abs(dx) : Infinity;
        ray.perY = Math.abs(dy) > 1e-9 ? 1 / Math.abs(dy) : Infinity;
        ray.nextX = ray.perX === Infinity ? Infinity : (dx > 0 ? ray.x + 1 - mx : mx - ray.x) * ray.perX;
        ray.nextY = ray.perY === Infinity ? Infinity : (dy > 0 ? ray.y + 1 - my : my - ray.y) * ray.perY;
    };
    /** Moves a line onto its next tile; false when that tile begins further than `reach` from where the line starts. */
    const lineNext = function(ray, reach) {
        const alongX = ray.nextX <= ray.nextY, t = alongX ? ray.nextX : ray.nextY;
        if (!(t <= reach + 1e-6)) return false;
        if (alongX) { ray.x += ray.stepX; ray.nextX += ray.perX; } else { ray.y += ray.stepY; ray.nextY += ray.perY; }
        ray.t = t;
        return true;
    };

    /** Starts what a press of OK would start on a tile (`events`: the map's, listed once for the press); true when an event is starting. */
    const actOn = function(events, x, y, normal, except) {
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (event === except || event._erased || event._rrBoarded) continue;
            const trigger = event._trigger;
            if (normal ? trigger !== 0 && trigger !== 1 && trigger !== 2 : trigger !== 0) continue;
            if (event.isNormalPriority() !== normal || !event.pos(x, y)) continue;
            event.start();
        }
        return $gameMap.isAnyEventStarting() && $gameMap.setupStartingEvent();
    };

    /**
     * Whoever the rider can act on from the saddle: under the vehicle's middle; then ahead along its heading, every
     * tile that begins within half its length and a tile and a half of its middle (one tile further past a
     * counter); then, stopped or nearly, every tile that begins within a tile and a half of its middle to either
     * side, the nearer first and its left before its right. The same tiles whichever way it heads. True when an
     * event started: that was the press.
     */
    const actAboard = function(event, p) {
        if ($gameMap.isEventRunning()) return false;
        const mx = p._realX + 0.5, my = p._realY + 0.5, events = $gameMap.events();
        if (actOn(events, Math.floor(mx), Math.floor(my), false, event)) return true;
        const yaw = Number.isFinite(event._rrYaw) ? event._rrYaw : facingOf(p);
        const fx = Math.sin(yaw), fy = -Math.cos(yaw);
        let reach = dimsOf(V.type(event._rrVehicle)).length / 2 + V.AHEAD, counter = false;
        lineFrom(AHEAD, mx, my, fx, fy);
        while (lineNext(AHEAD, reach)) {
            if (actOn(events, AHEAD.x, AHEAD.y, true, event)) return true;
            // A counter on the last tile in reach passes the reach on by one tile, once.
            if (!counter && Math.min(AHEAD.nextX, AHEAD.nextY) > reach + 1e-6 && $gameMap.isCounter(AHEAD.x, AHEAD.y)) { counter = true; reach += 1; }
        }
        if (Math.abs(V.speed()) >= V.SLOW) return false;
        lineFrom(LEFT, mx, my, fy, -fx);
        lineFrom(RIGHT, mx, my, -fy, fx);
        let left = lineNext(LEFT, V.ASIDE), right = lineNext(RIGHT, V.ASIDE);
        while (left || right) {
            const ray = left && (!right || LEFT.t <= RIGHT.t) ? LEFT : RIGHT;
            if (actOn(events, ray.x, ray.y, true, event)) return true;
            if (ray === LEFT) left = lineNext(LEFT, V.ASIDE); else right = lineNext(RIGHT, V.ASIDE);
        }
        return false;
    };

    //-------------------------------------------------------------------------
    // A battle that starts on the map while the party is aboard.

    /**
     * Before the battle places anyone: the hop is finished, the vehicle is parked where it is, and the party is on
     * foot beside it (on its own tile, and then clear of its body, when no side is free). The leader's hop is only
     * drawn from here on.
     */
    const dismountForBattle = function() {
        const p = player();
        V.settle();
        const event = p._vehicleType === "reactor" ? V.ridden() : null;
        if (!event) return;
        const fx = p._realX, fy = p._realY, fz = groundOf(p), fyaw = Number.isFinite(event._rrYaw) ? event._rrYaw : facingOf(p);
        if (p._rrDrive) p._rrDrive.v = 0;
        V.park(event);
        const spot = V.landingSpot(event, SPOT);
        const tx = spot ? spot[0] : event._x, ty = spot ? spot[1] : event._y, tz = spot ? spot[2] : groundOf(event);
        p._x = tx; p._y = ty; p._realX = tx; p._realY = ty;
        face(p, fyaw);
        sound("bump");
        V.putOnFoot();
        p._reactorGround = tz; p._reactorAlt = tz;
        const R = world();
        if (!spot && R && R.freePartyOfBodies) R.freePartyOfBodies();
        p._rrMount = { t: 0, n: V.HOP, on: false, drawn: true, fx, fy, fz, fyaw, tx: p._x, ty: p._y, tz: groundOf(p) };
        event._rrPose = (event._rrPose || 0) + 1;
    };

    /**
     * A ride whose vehicle type was written over from outside (`$gamePlayer._vehicleType = "walk"`, the usual line to
     * force a party out of a vehicle) while everything else still said aboard: the vehicle is parked where it is and
     * the party is on foot beside it, or on its tile and then clear of its body. The type that was written is kept.
     */
    const strand = function(p) {
        const written = p._vehicleType, ride = p._rrRide, map = typeof $gameMap !== "undefined" ? $gameMap : null;
        // The event of this map the saved ride names (after a load the one known here is the game's before it).
        const found = ride && map && ride.map === map._mapId ? map._events[ride.id]
            : carried && map && map._events[carried._eventId] === carried ? carried : null;
        const event = found && found._rrVehicle > 0 && !found._erased ? found : null;
        if (event) {
            carried = event;
            V.park(event);
            const spot = V.landingSpot(event, SPOT);
            const tx = spot ? spot[0] : event._x, ty = spot ? spot[1] : event._y, tz = spot ? spot[2] : groundOf(event);
            p._x = tx; p._y = ty; p._realX = tx; p._realY = ty;
            if (Number.isFinite(event._rrYaw)) face(p, event._rrYaw);
            V.putOnFoot();
            p._reactorGround = tz; p._reactorAlt = tz;
            const R = world();
            if (!spot && R && R.freePartyOfBodies) R.freePartyOfBodies();
            event._rrPose = (event._rrPose || 0) + 1;
        } else {
            V.putOnFoot();
        }
        p._vehicleType = written;
    };

    /** A battle on the battle screen: the vehicle is at a standstill when the party comes back to it. */
    const halt = function() {
        const p = player();
        if (!p || p._vehicleType !== "reactor") return;
        V.settle();
        const event = V.ridden(), drive = p._rrDrive;
        if (drive) { drive.v = 0; drive.leave = ""; }
        if (event) event._rrSpeed = 0;
        keep = 0;
    };

    //-------------------------------------------------------------------------
    // What the engine's own code is given.

    const cancelPressed = function() {
        return Input.isTriggered("cancel") || TouchInput.isCancelled();
    };
    let cancelFrame = -1;
    const cancelRide = function(p) {
        if (!p || p._vehicleType !== "reactor" || !V.ridden() || !cancelPressed()) return false;
        if (cancelFrame !== Graphics.frameCount) {
            // Escape is also the menu key. Keep ownership through the last tick of a dismount, when the player
            // becomes a walker before the scene checks its menu, and never request the same landing twice.
            cancelFrame = Graphics.frameCount;
            if (!p._rrMount && p.canMove()) leave();
        }
        return true;
    };

    const installPlayer = function() {
        if (typeof Game_Player === "undefined" || Game_Player.prototype.isInVehicle.__rrVehicles) return;
        const proto = Game_Player.prototype;

        const isInVehicle = proto.isInVehicle;
        proto.isInVehicle = function() {
            if (this._vehicleType === "reactor") return V.ridden() !== null;
            return isInVehicle.call(this);
        };
        proto.isInVehicle.__rrVehicles = true;

        // On foot, OK boards the vehicle the label shows for. The engine's scripted vehicle toggle still gets
        // the party off aboard; anything else is the boat's, the ship's and the airship's own.
        const getOnOffVehicle = proto.getOnOffVehicle;
        proto.getOnOffVehicle = function() {
            if (this._vehicleType === "reactor") {
                if (V.ridden()) return leave();
            } else if (this._vehicleType === "walk" && V.any()) {
                // A command asks while its own event runs: the pick is made without that. A press looks afresh: the
                // look the label keeps is up to five ticks old, and he may have turned to someone since.
                const busy = $gameMap.isEventRunning() || $gameMessage.isBusy();
                const event = busy ? (partyFree(this, $gameMap, true) ? pick(this, $gameMap) : null) : V.offered(true);
                if (event && board(event, false)) return true;
            }
            return getOnOffVehicle.call(this);
        };

        // Aboard, Cancel gets off and OK is for whoever is in reach: neither falls through to the stock vehicle
        // toggle or a door beside the player's own tile.
        const triggerButtonAction = proto.triggerButtonAction;
        proto.triggerButtonAction = function() {
            if (this._vehicleType !== "reactor") return triggerButtonAction.call(this);
            if (cancelRide(this)) return true;
            if (!Input.isTriggered("ok")) return false;
            const event = V.ridden();
            if (!event) return triggerButtonAction.call(this);
            actAboard(event, this);
            return true;
        };

        // Aboard, a click starts nothing. On foot, a click on a tile of the vehicle OK would board boards it.
        const triggerTouchAction = proto.triggerTouchAction;
        proto.triggerTouchAction = function() {
            if (this._vehicleType === "reactor") return false;
            if (this._vehicleType === "walk" && V.any() && $gameTemp.isDestinationValid() && TouchInput.isTriggered()) {
                const event = V.offered(true);
                if (event && coversTile(event, $gameTemp.destinationX(), $gameTemp.destinationY()) && board(event, false)) return true;
            }
            return triggerTouchAction.call(this);
        };

        // A hop is advanced once a tick, after the player's own update; the scroll follows it from where it was.
        // A ride that other code ended by writing the vehicle type is ended in full first.
        const update = proto.update;
        proto.update = function(sceneActive) {
            if (this._rrFree && this._vehicleType !== "reactor") strand(this);
            // A grid vehicle may still be moving, so its normal button-action update need not run this tick.
            if (!this._rrMount) {
                const result = update.call(this, sceneActive);
                if (sceneActive) cancelRide(this);
                return result;
            }
            // Consume Cancel during the hop too, including the tick on which it ends on foot.
            if (sceneActive) cancelRide(this);
            const sx = this.scrolledX(), sy = this.scrolledY();
            update.call(this, sceneActive);
            V.hop();
            this.updateScroll(sx, sy);
        };
    };

    const copy = value => JSON.parse(JSON.stringify(value));

    V.prepareTransfer = function(mapId, x, y, direction) {
        const p = player(), event = V.ridden();
        if (p) p._rrVehicleTransfer = null;
        if (!p || !event || mapId === $gameMap._mapId) return false;
        note(event, false);
        const entry = registry(true).at[V.idOf(event)];
        // Keep the original pages, key and optional graphic binding. Never write to a project map file.
        if (!entry.event) entry.event = copy(event._rrAuthored || event.event());
        const data = mapData(), models = data && data.reactor3d && data.reactor3d.events;
        if (!entry.models && models && models[event._eventId]) entry.models = copy(models[event._eventId]);
        p._rrVehicleTransfer = { identity: V.idOf(event), map: mapId, x, y,
            yaw: direction ? DEGREES_OF_DIR[direction] : V.degrees(headingOf(event)) };
        return true;
    };

    /** Add visiting vehicles to runtime map data before constructing its events. */
    const visitingVehicles = function(map) {
        const data = mapData(), store = registry(false);
        if (!data || !Array.isArray(data.events)) return;
        // setupEvents can run again on the same in-memory map. Retire generated
        // records first so event IDs and parked positions do not accumulate.
        for (let i = 1; i < data.events.length; i++) {
            if (data.events[i] && data.events[i]._rrDatabaseVehicle) data.events[i] = null;
        }
        const placements = models()?.startingEvents?.(root.$dataReactorVehicles, map._mapId) || [];
        for (const authored of placements) {
            const entry = store && store.at[authored._rrVehicleIdentity];
            if (entry && (entry.gone || entry.map !== map._mapId)) continue;
            if (authored.x >= data.width || authored.y >= data.height) continue;
            const vacancy = data.events.findIndex((row, index) => index > 0 && !row);
            authored.id = vacancy > 0 ? vacancy : Math.max(1, data.events.length);
            data.events[authored.id] = authored;
        }
        if (!store) return;
        for (const [identity, entry] of Object.entries(store.at)) {
            if (!entry.event || entry.gone || entry.map !== map._mapId || Number(identity.split(":")[0]) === map._mapId) continue;
            if (data.events.some(event => event && event._rrVehicleIdentity === identity)) continue;
            const authored = copy(entry.event), id = Math.max(1, data.events.length);
            authored.id = id; authored.x = Math.round(entry.x); authored.y = Math.round(entry.y);
            authored._rrVehicleIdentity = identity;
            data.events[id] = authored;
            if (entry.models) {
                if (!data.reactor3d) data.reactor3d = {};
                if (!data.reactor3d.events) data.reactor3d.events = {};
                data.reactor3d.events[id] = copy(entry.models);
            }
        }
    };

    const installMap = function() {
        if (typeof Game_Map === "undefined" || Game_Map.prototype.vehicle.__rrVehicles) return;
        const proto = Game_Map.prototype;

        const vehicle = proto.vehicle;
        proto.vehicle = function(type) {
            if (type === "reactor") return V.ridden();
            return vehicle.call(this, type);
        };
        proto.vehicle.__rrVehicles = true;

        const setupEvents = proto.setupEvents;
        proto.setupEvents = function() {
            visitingVehicles(this);
            rebuilding = true;
            let result;
            try { result = setupEvents.apply(this, arguments); } finally { rebuilding = false; }
            enterMap(this);
            return result;
        };

        const setup = proto.setup;
        proto.setup = function(mapId) {
            const p = player();
            // The same map set up again under a party that is aboard: the ride goes on where it was.
            resumeAt = p && p._vehicleType === "reactor" && p._rrRide && this._mapId === mapId && !p._rrMount
                ? [p._realX, p._realY, p._reactorGround, p._reactorAlt] : null;
            leaveMap(this);
            const transfer = p && p._rrVehicleTransfer;
            if (transfer && transfer.map === mapId) {
                const entry = registry(true).at[transfer.identity];
                if (entry) Object.assign(entry, { map: mapId, x: transfer.x, y: transfer.y, z: null, yaw: transfer.yaw });
            }
            return setup.apply(this, arguments);
        };
    };
    let resumeAt = null;

    /**
     * The map scene starts: events a save brought are matched to the data, and a ride a save or a reload of the
     * map carried goes on exactly where it was (the reload puts the player on a whole tile).
     */
    V.resume = function() {
        V.refresh();
        const p = player(), at = resumeAt;
        resumeAt = null;
        const event = V.bind();
        if (!event || !at || p._rrMount) return event;
        if (Math.round(at[0]) === p._x && Math.round(at[1]) === p._y) {
            p._realX = at[0]; p._realY = at[1];
            if (Number.isFinite(at[2])) p._reactorGround = at[2];
            if (Number.isFinite(at[3])) p._reactorAlt = at[3];
            carry(event, p);
        }
        return event;
    };

    const installEvent = function() {
        if (typeof Game_Event === "undefined" || Game_Event.prototype.pos.__rrVehicles) return;
        const proto = Game_Event.prototype;
        const characterName = proto.characterName, characterIndex = proto.characterIndex;
        const inheritedSheet = event => !event._erased && event._pageIndex >= 0 && !event._characterName && !event._tileId &&
            event._rrVehicle && V.type(event._rrVehicle) && V.type(event._rrVehicle).sheet;
        proto.characterName = function() { const sheet = inheritedSheet(this); return sheet && sheet.characterName || characterName.call(this); };
        proto.characterIndex = function() { const sheet = inheritedSheet(this); return sheet && sheet.characterName ? sheet.characterIndex || 0 : characterIndex.call(this); };
        const eventData = proto.event;
        proto.event = function() { return this._rrAuthored || eventData.call(this); };
        const meetsConditions = proto.meetsConditions;
        proto.meetsConditions = function(page) {
            if (!this._rrIdentity || !page.conditions.selfSwitchValid) return meetsConditions.call(this, page);
            const home = this._rrIdentity.split(":").map(Number);
            if (!$gameSelfSwitches.value([home[0], home[1], page.conditions.selfSwitchCh])) return false;
            return meetsConditions.call(this, Object.assign({}, page, { conditions: Object.assign({}, page.conditions, { selfSwitchValid: false }) }));
        };

        // The carried event is one tile to the grid: its body is the mover's, and no shape is built for a place it
        // holds for one tick.
        const pos = proto.pos;
        proto.pos = function(x, y) {
            if (this._rrFree === 2 || this._rrVehicle && !map3D()) return this._x === x && this._y === y;
            return pos.call(this, x, y);
        };
        proto.pos.__rrVehicles = true;

        // A vehicle that is spoken to does not turn to the speaker, and is not turned back afterwards.
        const lock = proto.lock;
        proto.lock = function() {
            if (!this._rrVehicle) return lock.call(this);
            if (Number.isFinite(this._rrYaw)) this._rrYaw = headingOf(this);
            if (!this._locked) { this._prelockDirection = 0; this._locked = true; }
        };

        // A page change gives an event its page's facing; a vehicle keeps its heading. One whose data has gone
        // (the map's data is another map's) is left as it is.
        const refresh = proto.refresh;
        proto.refresh = function() {
            if (!this._rrVehicle) return refresh.call(this);
            const data = mapData();
            if (!data || !data.events || !data.events[this._eventId]) return;
            // On the grid, a facing a command gave it since is its heading now.
            if (Number.isFinite(this._rrYaw)) this._rrYaw = headingOf(this);
            const page = this._pageIndex;
            refresh.call(this);
            if (this._pageIndex === page) return;
            if (Number.isFinite(this._rrYaw)) face(this, this._rrYaw);
            if (this._rrFree === 2) this._through = true;
            offer.stamp = -1;
        };

        // A boarded vehicle and one the mover parked run no movement type of their own.
        const updateSelfMovement = proto.updateSelfMovement;
        proto.updateSelfMovement = function() {
            if (this._rrFree || this._rrBoarded) return;
            updateSelfMovement.call(this);
        };

        // What a caller of `vehicle()` asks, answered by an event. A plain event answers as something that is no
        // vehicle; no kind answers to the names of the boat, the ship or the airship.
        proto.canMove = function() {
            if (!this._rrVehicle || !this._rrBoarded) return true;
            const p = player(), mount = p && p._rrMount;
            return !(mount && !mount.drawn);
        };
        proto.isLandOk = function(x, y, d) {
            if (!this._rrVehicle) return false;
            // A tile of the vehicle itself is no place to get off onto: parked, its body is there.
            return !coversTile(this, x, y) && canStand(x, y, groundOf(this), null);
        };
        proto.isLowest = function() { return true; };
        proto.isHighest = function() { return true; };
        proto.maxAltitude = function() { return 1; };
        proto.isBoat = function() { return false; };
        proto.isShip = function() { return false; };
        proto.isAirship = function() { return false; };
        proto.getOn = function() {
            const type = this._rrVehicle ? V.type(this._rrVehicle) : null;
            if (!type || !type.bgm || !type.bgm.name) return;
            $gameSystem.saveWalkingBgm();
            AudioManager.playBgm(type.bgm);
        };
        proto.getOff = function() {
            const type = this._rrVehicle ? V.type(this._rrVehicle) : null;
            if (type && type.bgm && type.bgm.name) $gameSystem.replayWalkingBgm();
        };
        proto.syncWithPlayer = function() {
            if (!this._rrVehicle || !this._rrBoarded) return;
            const p = player();
            if (!p || p._vehicleType !== "reactor") return;
            if (this._rrFree === 2) carry(this, p);
            aboardTick(this, p);
        };
    };

    const installRest = function() {
        // A land vehicle fights on the ground's battleback, not the ship's.
        if (typeof Sprite_Battleback !== "undefined" && !Sprite_Battleback.prototype.overworldBattleback1Name.__rrVehicles) {
            const land = function() {
                const p = player(), event = p && p._vehicleType === "reactor" ? V.ridden() : null;
                const type = event ? V.type(event._rrVehicle) : null;
                return !!type && (type.medium === undefined || String(type.medium).indexOf("ground") >= 0);
            };
            const name1 = Sprite_Battleback.prototype.overworldBattleback1Name;
            Sprite_Battleback.prototype.overworldBattleback1Name = function() {
                return land() ? this.normalBattleback1Name() : name1.call(this);
            };
            Sprite_Battleback.prototype.overworldBattleback1Name.__rrVehicles = true;
            const name2 = Sprite_Battleback.prototype.overworldBattleback2Name;
            Sprite_Battleback.prototype.overworldBattleback2Name = function() {
                return land() ? this.normalBattleback2Name() : name2.call(this);
            };
        }

        if (typeof Game_Interpreter !== "undefined" && !Game_Interpreter.prototype.updateWaitMode.__rrVehicles) {
            const selfSwitch = Game_Interpreter.prototype.command123;
            Game_Interpreter.prototype.command123 = function(params) {
                const event = $gameMap && this._mapId === $gameMap._mapId ? $gameMap.event(this._eventId) : null;
                if (!event || !event._rrIdentity) return selfSwitch.call(this, params);
                const home = event._rrIdentity.split(":").map(Number);
                $gameSelfSwitches.setValue([home[0], home[1], params[0]], params[1] === 0);
                return true;
            };
            // Game_Action ordinarily identifies subjects through Actors or Troop indices.
            // Vehicles use their own saved identity; no synthetic Actor database record is needed.
            if (typeof Game_Action !== "undefined" && !Game_Action.prototype.subject.__rrVehicles) {
                const setSubject = Game_Action.prototype.setSubject, subject = Game_Action.prototype.subject;
                Game_Action.prototype.setSubject = function(battler) {
                    this._rrVehicleSubject = battler && battler._rrVehicleIdentity || "";
                    return setSubject.call(this, battler);
                };
                Game_Action.prototype.subject = function() { return this._rrVehicleSubject ? V.battler(this._rrVehicleSubject) : subject.call(this); };
                Game_Action.prototype.subject.__rrVehicles = true;
            }
            const updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
            Game_Interpreter.prototype.updateWaitMode = function() {
                if (this._waitMode === "reactorVehicle") {
                    if (V.isBusy()) return true;
                    this._waitMode = "";
                    return false;
                }
                return updateWaitMode.call(this);
            };
            Game_Interpreter.prototype.updateWaitMode.__rrVehicles = true;
        }

        if (typeof Game_Fight !== "undefined" && !Game_Fight.prototype.start.__rrVehicles) {
            const start = Game_Fight.prototype.start;
            Game_Fight.prototype.start = function(options) {
                const p = player();
                if (!this._active && p && p._vehicleType === "reactor") dismountForBattle();
                return start.call(this, options);
            };
            Game_Fight.prototype.start.__rrVehicles = true;
        }

        if (typeof BattleManager !== "undefined" && typeof BattleManager.setup === "function" && !BattleManager.setup.__rrVehicles) {
            const setup = BattleManager.setup;
            BattleManager.setup = function() {
                halt();
                return setup.apply(this, arguments);
            };
            BattleManager.setup.__rrVehicles = true;
        }

        if (typeof Scene_Map !== "undefined" && !Scene_Map.prototype.start.__rrVehicles) {
            const start = Scene_Map.prototype.start;
            Scene_Map.prototype.start = function() {
                start.apply(this, arguments);
                V.resume();
            };
            Scene_Map.prototype.start.__rrVehicles = true;
        }

        if (typeof Scene_Map !== "undefined" && typeof Scene_Map.prototype.updateCallMenu === "function" && !Scene_Map.prototype.updateCallMenu.__rrVehicles) {
            const updateCallMenu = Scene_Map.prototype.updateCallMenu;
            Scene_Map.prototype.updateCallMenu = function() {
                const p = player();
                if (cancelFrame === Graphics.frameCount || (p && p._vehicleType === "reactor" && V.ridden() && cancelPressed())) {
                    this.menuCalling = false;
                    return;
                }
                return updateCallMenu.apply(this, arguments);
            };
            Scene_Map.prototype.updateCallMenu.__rrVehicles = true;
        }

        // The file loads with the database, and the boot scene waits for it.
        if (typeof Scene_Boot !== "undefined" && !Scene_Boot.prototype.isReady.__rrVehicles) {
            const create = Scene_Boot.prototype.create;
            Scene_Boot.prototype.create = function() {
                create.apply(this, arguments);
                V.load();
            };
            const isReady = Scene_Boot.prototype.isReady;
            Scene_Boot.prototype.isReady = function() {
                return isReady.apply(this, arguments) && V.isReady();
            };
            Scene_Boot.prototype.isReady.__rrVehicles = true;
        }
    };

    //-------------------------------------------------------------------------
    // The event commands (code 357, plugin "RPGReactor").

    /** The vehicle a command names: "this" is the event the command runs in. */
    const commandVehicle = function(interpreter, name) {
        const what = name == null || name === "" ? "this" : name;
        if (what !== "this") return V.find(typeof what === "string" && /^\d+$/.test(what.trim()) ? Number(what) : what);
        const id = interpreter && typeof interpreter.eventId === "function" ? interpreter.eventId() : 0;
        return id > 0 ? V.find(id) : null;
    };

    const installCommands = function() {
        if (typeof PluginManager === "undefined" || !PluginManager.registerCommand || V._commands) return;
        V._commands = true;
        PluginManager.registerCommand("RPGReactor", "GetOnVehicle", function(args) {
            args = args || {};
            const event = commandVehicle(this, args.vehicle);
            if (!event || !V.getOn(event, { instant: flag(args.instant, false) })) return;
            if (flag(args.wait, true) && V.isBusy()) this.setWaitMode("reactorVehicle");
        });
        PluginManager.registerCommand("RPGReactor", "GetOffVehicle", function(args) {
            args = args || {};
            if (!V.getOff({ instant: flag(args.instant, false) })) return;
            if (flag(args.wait, true) && V.isBusy()) this.setWaitMode("reactorVehicle");
        });
        PluginManager.registerCommand("RPGReactor", "SetVehicleLocation", function(args) {
            args = args || {};
            const name = args.vehicle == null || args.vehicle === "" ? "this" : args.vehicle;
            if (flag(args.remove, false)) {
                const event = commandVehicle(this, name);
                if (!event || !V.remove(event)) console.warn("Set Vehicle Location: no parked vehicle \"" + name + "\" to take out of the world.");
                return;
            }
            const x = number(args.x), y = number(args.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                console.warn("Set Vehicle Location: x and y are not set; \"" + name + "\" was not moved.");
                return;
            }
            let target = name === "this" ? (this && typeof this.eventId === "function" ? $gameMap._mapId + ":" + this.eventId() : "") : name;
            if (typeof target === "string" && /^\d+$/.test(target.trim())) target = $gameMap._mapId + ":" + target.trim();
            const asked = number(args.yaw);
            // `z` is not in the command's form: a script that names a floor writes it (a height, as `where()` answers).
            if (!V.setLocation(target, x, y, Number.isFinite(asked) ? asked : 0, args.z)) {
                console.warn("Set Vehicle Location: \"" + name + "\" was not moved to (" + x + ", " + y + "): it is ridden, it is not on this map, or its body does not fit there.");
            }
        });
    };

    if (typeof Game_Player !== "undefined") {
        const nativeGetOn = Game_Player.prototype.getOnVehicle;
        Game_Player.prototype.getOnVehicle = function() {
            const x = this.x, y = this.y, d = this.direction(), nx = $gameMap.roundXWithDirection(x,d), ny = $gameMap.roundYWithDirection(y,d);
            const key = $gameMap.airship().pos(x,y) ? "airship" : $gameMap.ship().pos(nx,ny) ? "ship" : $gameMap.boat().pos(nx,ny) ? "boat" : "";
            const entry = key && root.$dataSystem && root.$dataSystem[key] && root.$dataSystem[key].reactorVehicle;
            if (entry && entry.ridable === false) return false;
            return nativeGetOn.apply(this,arguments);
        };
    }
    installLooks();
    installPlayer();
    installMap();
    installEvent();
    installRest();
    installCommands();
})();

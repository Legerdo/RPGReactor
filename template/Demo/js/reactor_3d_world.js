//=============================================================================
// reactor_3d_world.js — RPG Reactor 3D world builder: terrain, pieces, water
//=============================================================================
/*
 * An extension of Reactor3D (reactor_3d.js): the authored ground and the 3D
 * tileset. Loaded right after the core, in the game from scriptUrls, in the
 * editor from Reactor3D.EXTENSIONS, and in Node by the core's own tail so
 * require("./reactor_3d.js") returns the whole API.
 *
 * Two halves. The rules come first and need nothing but the map data: where
 * the ground is, what a piece is, how deep the water stands. The command-line
 * checks (validate-map, build-structure) run them without three.js. The
 * meshes come second and touch THREE only when a scene is built, so a game
 * with no 3D map never reaches them.
 */

(function(root) {
    // Node alone takes the core from require; the NW.js page and the browser
    // find it on the global object, booted from scriptUrls.
    const node = typeof process !== "undefined" && process.versions && process.versions.node
        && !process.versions.nw && typeof require === "function";
    const Reactor3D = node ? require("./reactor_3d.js") : root.Reactor3D;
    if (!Reactor3D) return;

//-----------------------------------------------------------------------------
// Terrain
//
// Elevation is one whole number per tile: terraces, cliffs, floors. Terrain is
// the rolling ground on top of it — a height at every tile *corner*,
// `(width + 1) * (height + 1)` of them, fractional, in tiles — and the map's
// meshes are bent through it after they are built, so a tile's top becomes a
// bilinear patch and the cliff faces stay attached at their corners. Absent
// until painted; a map without it is exactly what it was.

Reactor3D.TERRAIN_MAX = 60;
/** Steeper than this, in tiles of rise per tile walked, and a step is blocked. */
Reactor3D.TERRAIN_SLOPE_LIMIT = 0.75;

Reactor3D.terrainOf = function(mapData) {
    const sidecar = mapData && mapData.reactor3d;
    const grid = sidecar && sidecar.terrain;
    if (!grid || typeof grid.length !== "number") return null;
    const size = (mapData.width + 1) * (mapData.height + 1);
    if (grid.length === size) return grid;
    // A map resized after its terrain was painted: refit the grid from the
    // width it was made for, keeping every corner that still exists.
    const oldWidth = Number(sidecar.terrainWidth) > 0 ? Number(sidecar.terrainWidth) : Number(sidecar.width) || 0;
    const stride = oldWidth + 1;
    if (!(oldWidth > 0) || grid.length % stride !== 0) return null;
    const grown = new Array(size).fill(0);
    const rows = Math.min(grid.length / stride, mapData.height + 1), cols = Math.min(stride, mapData.width + 1);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) grown[y * (mapData.width + 1) + x] = Number(grid[y * stride + x]) || 0;
    sidecar.terrain = grown;
    sidecar.terrainWidth = mapData.width;
    return grown;
};

Reactor3D.hasTerrain = function(mapData) {
    const grid = this.terrainOf(mapData);
    if (!grid) return false;
    for (let i = 0; i < grid.length; i++) if (grid[i]) return true;
    return false;
};

/** The terrain's rise at a world point (tile `x` spans world x..x+1), bilinear over its corners. */
Reactor3D.terrainHeightAt = function(mapData, wx, wz) {
    const grid = this.terrainOf(mapData);
    if (!grid) return 0;
    const width = mapData.width, height = mapData.height;
    const gx = Math.max(0, Math.min(width, wx)), gz = Math.max(0, Math.min(height, wz));
    const x0 = Math.min(width - 1, Math.floor(gx)), z0 = Math.min(height - 1, Math.floor(gz));
    const fx = gx - x0, fz = gz - z0, stride = width + 1;
    const h00 = grid[z0 * stride + x0] || 0, h10 = grid[z0 * stride + x0 + 1] || 0;
    const h01 = grid[(z0 + 1) * stride + x0] || 0, h11 = grid[(z0 + 1) * stride + x0 + 1] || 0;
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
};

/** Where the ground is at a world point: the cell's elevation plus the terrain's rise there. */
Reactor3D.groundHeightAt = function(mapData, wx, wz, near) {
    const base = this.elevationAt(mapData, Math.floor(wx), Math.floor(wz)) + this.terrainHeightAt(mapData, wx, wz);
    // `near` is a world height; the piece stacks count from the cell's ground.
    return base + this.pieceSurfaceAt(mapData, wx, wz, Number.isFinite(near) ? near - base : 0, base);
};

/**
 * The ground a camera looks at, over a point that is not where anyone stands:
 * the view's middle, which drifts over walls. A stack of walls reads as its
 * top (a character cannot step into it), so over a wall beside a door the view
 * jumped to the roof. More than a step above the player's own floor (`near`)
 * is not ground anyone is on; the player's floor is.
 */
Reactor3D.viewGroundAt = function(mapData, wx, wz, near) {
    const ground = this.groundHeightAt(mapData, wx, wz, near);
    if (Number.isFinite(near) && ground > near + 1 + this.TERRAIN_SLOPE_LIMIT) return near;
    return ground;
};

/** The ground under a character, at the middle of its cell as it moves between cells. */
Reactor3D.characterGround = function(mapData, character) {
    if (!character) return this.DEFAULT_ELEVATION;
    const x = Number.isFinite(character._realX) ? character._realX : character.x || 0;
    const y = Number.isFinite(character._realY) ? character._realY : character.y || 0;
    // Where the character last stood decides which floor of a house it is
    // on; `locate` forgets it, so a transfer lands on the ground floor.
    const near = character._reactorGround;
    let ground = this.groundHeightAt(mapData, x + 0.5, y + 0.5, near);
    // A diagonal step passes over the corner cell between its two cells; beside
    // a doorway that corner is a wall, whose stack reads as its top, and the
    // character was lifted onto the roof (and stayed, standing there). A surface
    // out of a step's reach is not ground anyone walked onto: the cell being
    // entered is.
    if (Number.isFinite(near) && ground > near + 1 + this.TERRAIN_SLOPE_LIMIT
        && Number.isFinite(character.x) && Number.isFinite(character.y)) {
        ground = this.groundHeightAt(mapData, character.x + 0.5, character.y + 0.5, near);
    }
    character._reactorGround = ground;
    return ground;
};

/**
 * A step between two cells the terrain makes too steep to take: the rise
 * from either cell's middle to the middle of the edge between them, or
 * across the whole step. The edge is checked as well as the centres so a
 * ridge on the shared corner, which two flat centres would not see, still
 * blocks.
 */
Reactor3D.terrainBlocks = function(mapData, x, y, x2, y2, near) {
    // Pieces stand on the same rule: a floor is a small step, a block a
    // whole level, a stair a slope that stays under the limit. `near` is
    // the height the character stands at now, which picks its floor.
    if (!mapData || (!this.terrainOf(mapData) && !this.hasPieces(mapData) && !this.hasWater(mapData))) return false;
    const limit = this.TERRAIN_SLOPE_LIMIT;
    // Off a ledge onto the top of a ladder: the climber takes hold there.
    const ladderTo = this.hasPieces(mapData) ? this.ladderAt(mapData, x2, y2) : null;
    if (ladderTo && Number.isFinite(near) && Math.abs(near - ladderTo.top) <= limit && this.groundHeightAt(mapData, x2 + 0.5, y2 + 0.5, near) < ladderTo.top - limit) return false;
    // Up a ladder, a climber is as high as it holds, whatever is under it.
    const ladderFrom = this.hasPieces(mapData) ? this.ladderAt(mapData, x, y) : null;
    const from = ladderFrom && Number.isFinite(near) && near > ladderFrom.bottom + 0.02 && near <= ladderFrom.top + 0.05
        ? near : this.groundHeightAt(mapData, x + 0.5, y + 0.5, near);
    const onLadder = !!ladderFrom && from === near;
    const ex = (x + x2) / 2 + 0.5, ey = (y + y2) / 2 + 0.5;
    // The edge sample can fall on the ladder's own cell, where the climber's height stands.
    const edge = onLadder && Math.floor(ex) === x && Math.floor(ey) === y ? from : this.groundHeightAt(mapData, ex, ey, from);
    const to = this.groundHeightAt(mapData, x2 + 0.5, y2 + 0.5, edge);
    const swim = this.hasWater(mapData) ? this.swimRule() : null;
    if (swim) {
        // A game that swims (reactor_physics): deep water is entered from
        // anywhere at or above its surface (a swim, or a fall into it) and
        // left onto a bank no more than a step over the surface; water a
        // character stands in is walked on its bottom like any ground.
        const levelTo = this.waterLevelAt(mapData, x2, y2), levelFrom = this.waterLevelAt(mapData, x, y);
        const deepTo = levelTo !== null && levelTo - to > swim.swimDepth;
        const deepFrom = levelFrom !== null && levelFrom - from > swim.swimDepth;
        // Swimming from one deep water to another is free on the level; a river's
        // step up (a waterfall's foot to its lip) is not swum up.
        if (deepTo) return deepFrom ? levelTo - levelFrom > limit : from < levelTo - limit;
        if (deepFrom) return to - levelFrom > limit;
    } else if (this.waterDepthAt(mapData, x2 + 0.5, y2 + 0.5, edge) > this.WATER_WADE) {
        // Water deeper than a wade is not walked into.
        return true;
    }
    if (Math.abs(edge - from) > limit || Math.abs(to - edge) > limit) return true;
    // A stair is climbed along its run and nothing else: its sides are as
    // solid as a wall (crossing a hall in a camera-relative walk drifted
    // onto the run from the side and up to the next floor), and a raised
    // step stands on a solid down to the ground, not a passage beneath.
    const stairHere = this.stairPieceAt(mapData, x, y), stairThere = this.stairPieceAt(mapData, x2, y2);
    if (stairHere || stairThere) {
        const dx = x2 - x, dy = y2 - y;
        for (const stair of [stairHere, stairThere]) {
            if (!stair) continue;
            const axis = this.stairAxis(stair.rot);
            if (dx * axis[0] + dy * axis[1] === 0) return true;
        }
        if (stairThere && to < this.pieceBaseAt(mapData, x2, y2) + stairThere.z - 1e-6) return true;
        // A stair rises a whole tile across its cell, so two stairs in a row
        // stand a tile apart at their middles and each half of the step is a
        // half tile: built to be climbed, judged by its halves.
        return false;
    }
    return Math.abs(to - from) > limit;
};

Reactor3D.stairAt = function(mapData, x, y) {
    return !!this.stairPieceAt(mapData, x, y);
};

/** The stair on a cell, or null. */
Reactor3D.stairPieceAt = function(mapData, x, y) {
    const stack = this.piecesAt(mapData, x, y);
    if (!stack) return null;
    for (const piece of stack) if (piece.kind === "stair" && !piece.standIn) return piece;
    return null;
};

/**
 * The ladder on a cell: the way it climbs (a map direction, 2/4/6/8, toward
 * the wall it leans on) and the world heights of its foot and its top.
 */
Reactor3D.ladderAt = function(mapData, x, y) {
    const stack = this.piecesAt(mapData, x, y);
    if (!stack) return null;
    let low = Infinity, high = -Infinity, rot = 0;
    for (const piece of stack) {
        if (piece.kind !== "ladder") continue;
        if (piece.z < low) { low = piece.z; rot = piece.rot || 0; }
        // A top level cut short (a height that is no whole number) ends where it is drawn.
        high = Math.max(high, piece.z + (piece.rise || 1));
    }
    if (!Number.isFinite(low)) return null;
    const base = this.pieceBaseAt(mapData, x, y);
    // A ladder whose foot stands a step over the ground (laid on a slab) is still reached from it.
    const ground = this.groundHeightAt(mapData, x + 0.5, y + 0.5, base + low);
    const foot = base + low - ground <= 1 + this.TERRAIN_SLOPE_LIMIT ? Math.min(base + low, ground) : base + low;
    return { dir: [2, 4, 8, 6][((rot % 4) + 4) % 4], bottom: foot, top: base + high };
};

/** The way a stair climbs, in cells: rot 0 rises south, each turn is clockwise seen from above. */
Reactor3D.stairAxis = function(rot) {
    return [[0, 1], [-1, 0], [0, -1], [1, 0]][((rot % 4) + 4) % 4];
};

/**
 * Bend the built meshes through the terrain: every vertex rises by the field
 * at its own x/z, so a tile top follows its corners, a cliff face stays
 * joined to the top it hangs from, and a standing cut-out (whose vertices
 * share an anchor) rides up whole. Tops and sides of a terrace keep their
 * relative shape. Nothing to do on a map without terrain.
 */
Reactor3D.displaceByTerrain = function(built, mapData) {
    if (!built || !built.groups || !this.hasTerrain(mapData)) return built;
    for (const group of built.groups) {
        const positions = group.positions;
        if (!positions) continue;
        for (let i = 0; i < positions.length; i += 3) {
            positions[i + 1] += this.terrainHeightAt(mapData, positions[i], positions[i + 2]);
        }
    }
    return built;
};

//-----------------------------------------------------------------------------
// Pieces
//
// A 3D tileset. A piece is a block painted on a cell at a level: a wall
// cube, a floor slab, a pillar, a stair, a ramp, a gable, a doorway, a
// window, a fence. Pieces snap to whole cells, turn in quarter turns and
// stack in whole levels on top of the ground (elevation plus terrain), so a
// house is a rectangle of blocks dragged out, a doorway dropped in, and a
// roof laid across — the way a 2D map is tiles rather than pictures. Each
// piece names a *material*, a tileable image under img/materials, which is
// what makes a wall stone or plaster.
//
// Stored in the sidecar as `pieces: [{id, kind, x, y, z, rot, material}]`.
// The ground under a character is the top of the highest piece on its cell
// (`pieceSurfaceAt`), so a floor at level 1 is walked on and a stair climbs
// to it; anything a character cannot step up onto (a block, a fence) blocks
// through the same rise rule the terrain uses.

/**
 * Shapes: the free pieces. Unlike the cell pieces they have a size in
 * tiles (`size: [w, h, d]`, the cell they stand on being the middle of
 * the footprint, `offset: [ox, oy]` a nudge of the middle within it), a
 * free turn in degrees (`angle`, clockwise from above), and a `tilt` and
 * `roll` in degrees about their own middle, so a tower is a cylinder five
 * tiles across with a dome on top, a market tent a cone, and a fallen
 * column a cylinder rolled onto its side. The cells a shape's solid parts
 * cover block like a wall of its height; a tube, a ring, an arch and a
 * tunnel are hollow, walked into and through.
 */
Reactor3D.SHAPE_KINDS = ["box", "wedge", "pyramid", "prism", "hull", "spike", "cylinder", "capsule", "tube", "cone", "dome", "sphere", "dish", "fin", "arch", "tunnel", "ring", "rock"];
/**
 * The settings a kind can carry beyond its size: `sides` (how many flat
 * faces round a hull, a spike, a capsule or a dish) and `taper` (how wide
 * the top is against the bottom, 0 a point, 1 straight; a fin's tip
 * against its root). A shape without them wears its kind's own.
 */
Reactor3D.SHAPE_PARAMS = { hull: { sides: 8, taper: 0.8 }, spike: { sides: 6, taper: 0 }, capsule: { sides: 24 }, dish: { sides: 32 }, fin: { taper: 0.4 }, cylinder: { sweep: 360 }, tube: { sweep: 360, thick: 0.3 }, ring: { sweep: 360, thick: 0.2 }, rock: { rough: 0.5 } };
Reactor3D.shapeParams = function(piece) {
    const own = this.SHAPE_PARAMS[piece.kind] || {};
    const out = {};
    if ("sides" in own) { const n = Math.round(Number(piece.sides)); out.sides = Number.isFinite(n) ? Math.max(3, Math.min(32, n)) : own.sides; }
    if ("taper" in own) { const t = Number(piece.taper); out.taper = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : own.taper; }
    // How much of the circle a round shape goes round, in degrees, the arc centred on its
    // back (+v) so the opening faces forward: a horseshoe deck, a curved console, a bent pipe.
    if ("sweep" in own) { const a = Number(piece.sweep); out.sweep = Number.isFinite(a) ? Math.max(1, Math.min(360, Math.round(a))) : own.sweep; }
    // How thick a hollow shape's wall is, as a fraction of its half width: a rail is thin, a silo thick.
    if ("thick" in own) { const t = Number(piece.thick); out.thick = Number.isFinite(t) ? Math.max(0.02, Math.min(1, t)) : own.thick; }
    // How craggy a rock is, 0 smooth to 1 broken.
    if ("rough" in own) { const t = Number(piece.rough); out.rough = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : own.rough; }
    return out;
};
/** Whether a ground point of a swept shape, at `lx`, `lz` from its middle in its own frame, lies within the arc. */
Reactor3D.withinSweep = function(sweep, lx, lz, slack) {
    if (!(sweep < 360)) return true;
    const a = Math.atan2(lz, lx);
    let away = Math.abs(a - Math.PI / 2);
    if (away > Math.PI) away = Math.PI * 2 - away;
    return away <= (sweep / 2) * Math.PI / 180 + (slack || 0);
};
Reactor3D.PIECE_KINDS = ["wall", "block", "floor", "pillar", "stair", "ramp", "roof", "doorway", "window", "fence", "glass", "ladder", "door"].concat(Reactor3D.SHAPE_KINDS);
/**
 * What a material's name says about how it is drawn: a name beginning
 * "Glass" is see-through (tinted, a third opaque, both faces), a name
 * ending "Glow" is lit from within (full bright whatever the lights, so a
 * console face or a light strip reads as a light source). Any other name
 * is a tileable image under img/materials, shaded by the lights.
 */
Reactor3D.materialLook = function(name) {
    const text = String(name || "");
    return { glass: /^glass/i.test(text), glow: /glow$/i.test(text) };
};
/**
 * The colour a `…Glow` material with no image shines: read from its name (a lamp or a candle warm, a
 * forge or fire orange, a screen or console cyan, a strip white, plain colour words as themselves),
 * else a warm lamplight.
 */
Reactor3D.GLOW_COLOURS = [
    [/forge|fire|ember|lava|coal|torch/i, 0xff7a2e], [/screen|console|monitor|panel|holo/i, 0x7fd8ff], [/strip|neon|white/i, 0xf4f8ff],
    [/red/i, 0xff4a3a], [/green/i, 0x6dff8a], [/blue/i, 0x5aa8ff], [/purple|violet/i, 0xc07aff], [/yellow|gold/i, 0xffd84a], [/orange/i, 0xff9a3a],
    [/lamp|lantern|candle|window|warm/i, 0xffcf86]
];
Reactor3D.glowColour = function(name) {
    const text = String(name || "").replace(/glow$/i, "");
    const found = this.GLOW_COLOURS.find(([pattern]) => pattern.test(text));
    return found ? found[1] : 0xffcf86;
};
Reactor3D.isShapeKind = function(kind) { return this.SHAPE_KINDS.includes(kind); };
/** The shapes with an open middle: only their walls block. */
Reactor3D.HOLLOW_KINDS = ["tube", "ring", "arch", "tunnel"];
/** A shape's middle on the ground: its cell's middle plus its offset, in tiles. */
Reactor3D.shapeCentre = function(piece) {
    const o = Array.isArray(piece.offset) ? piece.offset : [0, 0];
    // A stand-in on another cell of the footprint remembers the cell the shape stands on.
    const ax = Array.isArray(piece.anchor) ? piece.anchor[0] : piece.x, ay = Array.isArray(piece.anchor) ? piece.anchor[1] : piece.y;
    return [ax + 0.5 + (Number(o[0]) || 0), ay + 0.5 + (Number(o[1]) || 0)];
};
/** Whether a shape is turned off the vertical (a tilt or a roll). */
Reactor3D.shapeTurned = function(piece) {
    return !!(((Number(piece.tilt) || 0) % 360) || ((Number(piece.roll) || 0) % 360));
};
/**
 * The map from a shape's unit cell (u across, y up, v along, each 0..1)
 * to the world: stretched to its size, rolled about its own forward axis,
 * tilted about its sideways axis, turned about the vertical, all about
 * the middle of its box, then stood at its cell with its lowest corner at
 * its height, so a rolled column lies on the ground. `base` is the ground
 * under the piece.
 */
Reactor3D.shapePlacer = function(piece, base) {
    const [w, h, d] = this.shapeSize(piece);
    const [cx, cz] = this.shapeCentre(piece);
    const rad = deg => (Number(deg) || 0) * Math.PI / 180;
    const yaw = -rad((Number(piece.angle) || 0) + (Number(piece.rot) || 0) * 90), tilt = rad(piece.tilt), roll = rad(piece.roll);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
    const turned = this.shapeTurned(piece);
    const spin = (u, y, v) => {
        let x = (u - 0.5) * w, yy = (y - 0.5) * h, z = (v - 0.5) * d;
        if (turned) {
            let t = x * cr - yy * sr; yy = x * sr + yy * cr; x = t;
            t = yy * ct - z * st; z = yy * st + z * ct; yy = t;
        }
        const tx = x * cy + z * sy; z = -x * sy + z * cy; x = tx;
        return [x, yy, z];
    };
    let lowest = -h / 2;
    if (turned) { lowest = Infinity; for (const u of [0, 1]) for (const y of [0, 1]) for (const v of [0, 1]) lowest = Math.min(lowest, spin(u, y, v)[1]); }
    const oy = (Number(base) || 0) + (Number(piece.z) || 0) - lowest;
    return (u, y, v) => { const q = spin(u, y, v); return [cx + q[0], oy + q[1], cz + q[2]]; };
};
/**
 * Whether a point of the ground, `lx` across and `lz` along from a
 * shape's middle in its own turned frame (tiles), is under a solid part
 * of the shape: a round one inside its ellipse, a hollow one in its wall,
 * an arch or tunnel in its posts. `slack` widens the solid part so the
 * rim's cells block too.
 */
Reactor3D.shapeSolidAt = function(kind, lx, lz, hw, hd, slack, sweep, thick) {
    const s = slack || 0;
    if (sweep < 360 && !this.withinSweep(sweep, lx, lz, 0.1)) return false;
    const wall = Number.isFinite(thick) ? thick : (kind === "ring" ? 0.2 : 0.3);
    const inside = (kw, kd, grow) => { const a = hw * kw + grow, b = hd * kd + grow; return a > 0 && b > 0 && (lx * lx) / (a * a) + (lz * lz) / (b * b) <= 1; };
    switch (kind) {
        case "cylinder": case "cone": case "dome": case "sphere": case "hull": case "spike": case "capsule": case "dish": return inside(1, 1, s);
        case "tube": return inside(1, 1, s) && !inside(1 - wall, 1 - wall, -s);
        case "ring": return inside(1, 1, s) && !inside(1 - 2 * wall, 1 - 2 * wall, -s);
        case "arch": case "tunnel": return Math.abs(lx) <= hw + s && Math.abs(lz) <= hd + s && Math.abs(lx) >= hw * 0.7 - s;
        default: return Math.abs(lx) <= hw + s && Math.abs(lz) <= hd + s;
    }
};
/** A shape's [w, h, d] in tiles; a cell piece is one by one by its height. */
Reactor3D.shapeSize = function(piece) {
    const size = Array.isArray(piece.size) ? piece.size : null;
    const n = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
    return size ? [n(size[0], 1), n(size[1], 1), n(size[2], n(size[0], 1))] : [1, this.pieceHeight(piece.kind), 1];
};
/** The cells a piece's footprint covers: one for a cell piece, w by d round the middle for a shape. */
Reactor3D.pieceFootprint = function(piece) {
    // A door hangs across `width` cells of its doorway (reactor_3d_doors.js).
    if (piece.kind === "door" && this.doorCells) return this.doorCells(piece);
    if (!this.isShapeKind(piece.kind)) return [[piece.x, piece.y]];
    const SLACK = 0.15;
    const [w, , d] = this.shapeSize(piece);
    const hw = w / 2, hd = d / 2;
    const [cx, cz] = this.shapeCentre(piece);
    const cells = [];
    if (this.shapeTurned(piece)) {
        // Tilted or rolled: the shadow the turned box throws on the ground, the hull of
        // its corners; a cell counts when its middle lies in it or within the slack of it.
        const at = this.shapePlacer(piece, 0);
        const pts = [];
        for (const u of [0, 1]) for (const y of [0, 1]) for (const v of [0, 1]) { const q = at(u, y, v); pts.push([q[0], q[2]]); }
        const hull = this.convexHull(pts);
        const x0 = Math.floor(Math.min(...hull.map(c => c[0])) - SLACK), x1 = Math.ceil(Math.max(...hull.map(c => c[0])) + SLACK);
        const y0 = Math.floor(Math.min(...hull.map(c => c[1])) - SLACK), y1 = Math.ceil(Math.max(...hull.map(c => c[1])) + SLACK);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (x < 0 || y < 0) continue;
            if (this.hullReach([x + 0.5, y + 0.5], hull) <= SLACK) cells.push([x, y]);
        }
    } else {
        const angle = ((Number(piece.angle) || 0) + (Number(piece.rot) || 0) * 90) * Math.PI / 180;
        const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [cx + u * Math.cos(angle) - v * Math.sin(angle), cz + u * Math.sin(angle) + v * Math.cos(angle)]);
        const x0 = Math.floor(Math.min(...corners.map(c => c[0])) - SLACK), x1 = Math.ceil(Math.max(...corners.map(c => c[0])) + SLACK) - 1;
        const y0 = Math.floor(Math.min(...corners.map(c => c[1])) - SLACK), y1 = Math.ceil(Math.max(...corners.map(c => c[1])) + SLACK) - 1;
        // A cell counts when its middle, seen from the shape's own frame, is under a solid part.
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            if (x < 0 || y < 0) continue;
            const px = x + 0.5 - cx, pz = y + 0.5 - cz;
            const u = px * Math.cos(-angle) - pz * Math.sin(-angle), v = px * Math.sin(-angle) + pz * Math.cos(-angle);
            const params = this.shapeParams(piece);
            if (this.shapeSolidAt(piece.kind, u, v, hw, hd, SLACK, params.sweep, params.thick)) cells.push([x, y]);
        }
    }
    if (!cells.length && !this.HOLLOW_KINDS.includes(piece.kind)) cells.push([piece.x, piece.y]);
    return cells;
};
/** The convex hull of ground points [[x, z]], counter-clockwise, by monotone chain. */
Reactor3D.convexHull = function(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop(); lower.push(q); }
    for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
};
/** How far a ground point lies outside a convex hull: zero inside, else the distance to its edge. */
Reactor3D.hullReach = function(point, hull) {
    if (hull.length < 3) return Infinity;
    let inside = true, nearest = Infinity;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i + 1) % hull.length];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        if (ex * (point[1] - a[1]) - ez * (point[0] - a[0]) < 0) inside = false;
        const len2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * ex + (point[1] - a[1]) * ez) / len2));
        nearest = Math.min(nearest, Math.hypot(point[0] - (a[0] + ex * t), point[1] - (a[1] + ez * t)));
    }
    return inside ? 0 : nearest;
};
// Levels a piece may stand at: 48 storeys of five tiles, so a tower plan is never cut short by the store.
Reactor3D.PIECE_MAX_LEVEL = 240;
Reactor3D.PIECE_FLOOR_THICKNESS = 0.1;
/**
 * A storey, in tiles. The bundled characters stand three tiles tall, a
 * little under 1.8 m, so a tile is about 0.6 m and a room a person walks
 * into is five tiles to the ceiling: a 3 m storey. The pieces a character
 * walks past or through are a storey tall — a wall, a doorway, a window, a
 * pillar — and a block is the one-tile brick (a 60 cm cube) for garden
 * walls, steps and anything built up by hand.
 */
Reactor3D.PIECE_STOREY = 5;
Reactor3D.pieceHeight = function(kind) {
    return kind === "wall" || kind === "doorway" || kind === "window" || kind === "pillar" || kind === "glass" ? this.PIECE_STOREY : 1;
};

/**
 * The finishes a built piece can wear over its material, as model surfaces
 * (see `readModelSurface`): a mirror (sharp, the party in it), chrome,
 * polished, glossy paint and gold.
 */
Reactor3D.PIECE_FINISHES = {
    mirror: { reflect: 1, gloss: 1, metal: 1, tint: "#ffffff", texture: 0 },
    chrome: { reflect: 1, gloss: 0.95, metal: 1, tint: "#ffffff", texture: 0.15 },
    polished: { reflect: 0.9, gloss: 0.9, metal: 0.55, tint: "#ffffff", texture: 0.85 },
    glossy: { reflect: 0.9, gloss: 0.9, metal: 0, tint: "#ffffff", texture: 1 },
    gold: { reflect: 1, gloss: 0.85, metal: 1, tint: "#ffcc55", texture: 0.2 }
};

Reactor3D.normalizePiece = function(raw, mapData) {
    if (!raw || typeof raw !== "object") return null;
    const kind = this.PIECE_KINDS.includes(raw.kind) ? raw.kind : null;
    if (!kind) return null;
    const x = Math.floor(Number(raw.x)), y = Math.floor(Number(raw.y));
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
    if (mapData && (x >= mapData.width || y >= mapData.height)) return null;
    const shape = this.isShapeKind(kind);
    // A shape stands at any quarter tile; a cell piece at a whole level.
    const z = Math.max(0, Math.min(this.PIECE_MAX_LEVEL, shape ? Math.round((Number(raw.z) || 0) * 4) / 4 : Math.floor(Number(raw.z)) || 0));
    const rot = ((Math.floor(Number(raw.rot)) || 0) % 4 + 4) % 4;
    const material = typeof raw.material === "string" ? raw.material.trim() : "";
    const id = Number(raw.id);
    const piece = { id: Number.isFinite(id) && id > 0 ? Math.floor(id) : 0, kind, x, y, z, rot, material };
    const group = Number(raw.group);
    if (Number.isFinite(group) && group > 0) piece.group = Math.floor(group);
    if (typeof raw.finish === "string" && Object.prototype.hasOwnProperty.call(this.PIECE_FINISHES, raw.finish)) piece.finish = raw.finish;
    // A surface of its own (the sliders): it wins over the finish's.
    const surface = raw.surface && typeof raw.surface === "object" && this.readModelSurface ? this.readModelSurface({ surface: raw.surface }) : null;
    if (surface) piece.surface = surface;
    // How a ladder's level is drawn: shifted across (`offset`, tiles, so a ladder stays centred
    // at any width), narrower than its cell (`span`, a width that is no whole number of tiles),
    // and the top level only part way up (`rise`, a height that is none). Climbing keeps the cells.
    if (kind === "ladder") {
        if (Array.isArray(raw.offset)) {
            const shift = raw.offset.slice(0, 2).map(v => Math.max(-1, Math.min(1, Math.round((Number(v) || 0) * 1000) / 1000)));
            if (shift[0] || shift[1]) piece.offset = [shift[0] || 0, shift[1] || 0];
        }
        const span = Math.round(Number(raw.span) * 1000) / 1000, rise = Math.round(Number(raw.rise) * 1000) / 1000;
        if (span >= 0.5 && span < 1) piece.span = span;
        if (rise > 0 && rise < 1) piece.rise = rise;
    }
    if (this.isShapeKind(kind)) {
        const size = Array.isArray(raw.size) ? raw.size : [];
        const n = (v, fallback) => { const k = Number(v); return Number.isFinite(k) && k > 0 ? Math.min(60, Math.round(k * 100) / 100) : fallback; };
        piece.size = [n(size[0], 1), n(size[1], 1), n(size[2], n(size[0], 1))];
        const angle = Number(raw.angle);
        piece.angle = Number.isFinite(angle) ? ((Math.round(angle) % 360) + 360) % 360 : 0;
        // A tilt, a roll and an offset only when they are something, so a plain shape stays plain.
        const turn = v => { const k = Number(v); return Number.isFinite(k) ? ((Math.round(k) % 360) + 360) % 360 : 0; };
        const tilt = turn(raw.tilt), roll = turn(raw.roll);
        if (tilt) piece.tilt = tilt;
        if (roll) piece.roll = roll;
        const offset = Array.isArray(raw.offset) ? raw.offset.slice(0, 2).map(v => Math.max(-0.5, Math.min(0.5, Math.round((Number(v) || 0) * 100) / 100))) : null;
        if (offset && (offset[0] || offset[1])) piece.offset = [offset[0] || 0, offset[1] || 0];
        const own = this.SHAPE_PARAMS[kind] || {};
        if ("sides" in own && Number.isFinite(Number(raw.sides))) piece.sides = Math.max(3, Math.min(32, Math.round(Number(raw.sides))));
        if ("taper" in own && Number.isFinite(Number(raw.taper))) piece.taper = Math.max(0, Math.min(1, Math.round(Number(raw.taper) * 100) / 100));
        if ("sweep" in own && Number.isFinite(Number(raw.sweep))) piece.sweep = Math.max(1, Math.min(360, Math.round(Number(raw.sweep))));
        if ("thick" in own && Number.isFinite(Number(raw.thick))) piece.thick = Math.max(0.02, Math.min(1, Math.round(Number(raw.thick) * 100) / 100));
        if ("rough" in own && Number.isFinite(Number(raw.rough))) piece.rough = Math.max(0, Math.min(1, Math.round(Number(raw.rough) * 100) / 100));
    }
    // A door's leaf, how it opens and sounds; a window's frame (reactor_3d_doors.js).
    if (kind === "door" && this.normalizeDoor) Object.assign(piece, this.normalizeDoor(raw));
    if (kind === "window" && raw.frame && this.normalizeWindowFrame) {
        const frame = this.normalizeWindowFrame(raw.frame);
        if (frame) piece.frame = frame;
    }
    // A rock's top (`cap`: a material, or "ground" for the map's own floor) and its tint.
    if (kind === "rock") {
        if (typeof raw.cap === "string" && raw.cap.trim()) piece.cap = raw.cap.trim();
        if (typeof raw.tint === "string" && /^#[0-9a-f]{6}$/i.test(raw.tint) && raw.tint.toLowerCase() !== "#ffffff") piece.tint = raw.tint.toLowerCase();
    }
    return piece;
};

/**
 * The map's pieces, indexed by cell. Cached against the sidecar's own
 * array: the editor writes a new array on every change, so an edit is a
 * new index and a frame's many ground lookups share one.
 */
Reactor3D.pieceIndex = function(mapData) {
    const sidecar = mapData && mapData.reactor3d;
    const raw = sidecar && sidecar.pieces;
    if (!Array.isArray(raw) || !raw.length) return null;
    const memo = this._pieceIndexMemo || (this._pieceIndexMemo = new WeakMap());
    const known = memo.get(raw);
    if (known) return known;
    const cells = new Map();
    const list = [];
    const rocks = [];
    for (const entry of raw) {
        const piece = this.normalizePiece(entry, mapData);
        if (!piece) continue;
        list.push(piece);
        // A rock stands where its surface is, not its box (see rockColumns, after the loop).
        if (piece.kind === "rock") { rocks.push(piece); continue; }
        // A shape stands on every cell of its footprint: the cell rule sees a
        // stand-in there of the shape's height, so nothing walks into a tower.
        for (const [fx, fy] of this.pieceFootprint(piece)) {
            const key = fy * 65536 + fx;
            let stack = cells.get(key);
            if (!stack) cells.set(key, stack = []);
            stack.push(fx === piece.x && fy === piece.y ? piece : Object.assign({}, piece, { x: fx, y: fy, standIn: true, anchor: [piece.x, piece.y] }));
        }
    }
    if (rocks.length) {
        for (const column of this.rockColumns(mapData, rocks)) {
            const key = column.y * 65536 + column.x;
            let stack = cells.get(key);
            if (!stack) cells.set(key, stack = []);
            stack.push(Object.assign({}, column.piece, { x: column.x, y: column.y, z: column.z, rockTop: column.top, standIn: true, anchor: [column.piece.x, column.piece.y] }));
        }
    }
    // Each cell's stack from the ground up, which is the order the surface
    // rule reads it in.
    for (const stack of cells.values()) stack.sort((a, b) => a.z - b.z);
    // Each stamped building's footprint, so a cutaway reaches its walls and no further.
    const groups = new Map();
    for (const piece of list) {
        if (!piece.group) continue;
        const box = groups.get(piece.group) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        // A shape reaches past its own cell (a roof's eaves hang a tile beyond the walls): its whole footprint counts.
        for (const [fx, fy] of this.isShapeKind(piece.kind) ? this.pieceFootprint(piece) : [[piece.x, piece.y]]) {
            box.x0 = Math.min(box.x0, fx); box.y0 = Math.min(box.y0, fy); box.x1 = Math.max(box.x1, fx); box.y1 = Math.max(box.y1, fy);
        }
        groups.set(piece.group, box);
    }
    const index = { list, cells, groups };
    memo.set(raw, index);
    return index;
};

Reactor3D.piecesOf = function(mapData) {
    const index = this.pieceIndex(mapData);
    return index ? index.list : [];
};

Reactor3D.hasPieces = function(mapData) {
    return !!this.pieceIndex(mapData);
};

Reactor3D.piecesAt = function(mapData, x, y) {
    const index = this.pieceIndex(mapData);
    if (!index) return null;
    return index.cells.get(y * 65536 + x) || null;
};

/**
 * A point in a cell (u, v in 0..1, +v south) seen from the piece's own
 * frame, undoing its quarter turns: a stair rises along its own +v
 * whichever way it was turned.
 */
Reactor3D.pieceLocal = function(piece, u, v) {
    let du = u - 0.5, dv = v - 0.5;
    for (let i = 0; i < piece.rot; i++) {
        const next = dv;
        dv = -du;
        du = next;
    }
    return { u: du + 0.5, v: dv + 0.5 };
};

/**
 * How high a piece's walkable top stands over the cell's ground at a
 * point of the cell.
 */
Reactor3D.pieceTop = function(piece, u, v) {
    switch (piece.kind) {
        case "floor": return piece.z + this.PIECE_FLOOR_THICKNESS;
        case "stair":
        case "ramp": {
            const local = this.pieceLocal(piece, u, v);
            return piece.z + Math.max(0, Math.min(1, local.v));
        }
        // A doorway is stood in at its threshold: the level it is laid at,
        // which is the ground downstairs and the floor's level upstairs.
        case "doorway": return piece.z;
        // A door is its threshold while it lets a walker by, its leaf's height while it does not.
        case "door": return this.doorTop ? this.doorTop(piece) : piece.z;
        default:
            // A rock's column: the height of the rock you see over that cell (rockColumns).
            if (piece.kind === "rock" && Number.isFinite(piece.rockTop)) return piece.rockTop;
            if (this.isShapeKind(piece.kind)) {
                // A wedge is a ramp: its top rises along its own +v, so a long low wedge is a
                // slope walked in steps under the limit.
                if (piece.kind === "wedge" && !this.shapeTurned(piece)) {
                    const [w, h, d] = this.shapeSize(piece);
                    const [cx, cz] = this.shapeCentre(piece);
                    const angle = -((Number(piece.angle) || 0) + (Number(piece.rot) || 0) * 90) * Math.PI / 180;
                    const px = (piece.x + (Number.isFinite(u) ? u : 0.5)) - cx, pz = (piece.y + (Number.isFinite(v) ? v : 0.5)) - cz;
                    const lv = px * Math.sin(angle) + pz * Math.cos(angle);
                    const t = Math.max(0, Math.min(1, lv / d + 0.5));
                    return piece.z + h * t;
                }
                if (!this.shapeTurned(piece)) return piece.z + this.shapeSize(piece)[1];
                const at = this.shapePlacer(piece, 0);
                // A rolled or tilted wedge is still a ramp: its slope (y = v in its own frame) is an
                // affine sheet, so the point under the walker is found by inverting it across the
                // ground, and the height read there. (Its highest corner made a crooked ramp a wall.)
                if (piece.kind === "wedge") {
                    const p00 = at(0, 0, 0), p10 = at(1, 0, 0), p01 = at(0, 1, 1);
                    const ax = p10[0] - p00[0], az = p10[2] - p00[2], bx = p01[0] - p00[0], bz = p01[2] - p00[2];
                    const det = ax * bz - bx * az;
                    if (Math.abs(det) > 1e-9) {
                        const qx = piece.x + (Number.isFinite(u) ? u : 0.5) - p00[0], qz = piece.y + (Number.isFinite(v) ? v : 0.5) - p00[2];
                        const su = Math.max(0, Math.min(1, (qx * bz - bx * qz) / det)), sv = Math.max(0, Math.min(1, (ax * qz - qx * az) / det));
                        return p00[1] + su * (p10[1] - p00[1]) + sv * (p01[1] - p00[1]);
                    }
                }
                let top = -Infinity;
                for (const u of [0, 1]) for (const y of [0, 1]) for (const v of [0, 1]) top = Math.max(top, at(u, y, v)[1]);
                return top;
            }
            return piece.z + this.pieceHeight(piece.kind);
    }
};

/**
 * What a character on the cell stands on, over the cell's ground, at a
 * world point, given how high the character already stands (`near`).
 *
 * The stack is read from the ground up. A piece whose foot is within a
 * level and a step of the surface so far joins it (a floor on blocks, a
 * wall on a wall). A piece higher than that opens a gap, and the gap is
 * where the character's own height decides: within reach of the piece's
 * foot, the character is on the upper layer and the surface jumps to it;
 * out of reach, the character is on the lower layer and the reading
 * stops. So a house has two walkable floors — downstairs you stand on the
 * ground-floor slab under the upper floor, and coming up the stairs you
 * arrive on the upper floor — a roof of ramps over either is never
 * walked on, a doorway under a wall is the ground, a floor two levels up
 * with nothing under it is a bridge walked under from below and a floor
 * arrived at from a stair.
 */
Reactor3D.pieceSurfaceAt = function(mapData, wx, wz, near, base) {
    const index = this.pieceIndex(mapData);
    if (!index) return 0;
    const x = Math.floor(wx), y = Math.floor(wz);
    const stack = index.cells.get(y * 65536 + x);
    if (!stack) return 0;
    const reach = 1 + this.TERRAIN_SLOPE_LIMIT + 1e-6;
    const standing = Number.isFinite(near) ? near : 0;
    let surface = 0;
    const u = wx - x, v = wz - y;
    // A shape is drawn from one base, its own cell's ground: over rising ground its top is
    // read from there, not from each cell it covers (a ramp laid on a hill was a wall).
    const cellBase = Number.isFinite(base) ? base : null;
    const shapeTop = piece => {
        const top = this.pieceTop(piece, u, v);
        if (cellBase === null || !this.isShapeKind(piece.kind)) return top;
        const anchor = Array.isArray(piece.anchor) ? piece.anchor : [piece.x, piece.y];
        return top + this.pieceBaseAt(mapData, anchor[0], anchor[1]) - cellBase;
    };
    // A shape's foot over this cell: its `z` is above its anchor cell's ground, so a deck laid from
    // one bank stands lower over a higher bank (a rock's columns already carry their own cell's foot).
    const shapeFoot = piece => {
        if (cellBase === null || !this.isShapeKind(piece.kind) || Number.isFinite(piece.rockTop)) return piece.z;
        const anchor = Array.isArray(piece.anchor) ? piece.anchor : [piece.x, piece.y];
        return piece.z + this.pieceBaseAt(mapData, anchor[0], anchor[1]) - cellBase;
    };
    for (const piece of stack) {
        // A ladder is climbed, never stood on.
        if (piece.kind === "ladder") continue;
        const foot = shapeFoot(piece);
        if (foot > surface + reach) {
            // A rock overhead (an arch, a ledge) is a mass, not a slab: only one already up near its
            // top stands on it; anyone else walks under it.
            const upper = piece.kind === "rock" && Number.isFinite(piece.rockTop) ? shapeTop(piece) : foot;
            if (standing + reach < upper) break;
            surface = Math.max(0, shapeTop(piece));
            continue;
        }
        const height = shapeTop(piece);
        if (height > surface) surface = height;
    }
    return surface;
};

/** The ground a piece stands on: the cell's elevation plus the terrain at its middle. */
Reactor3D.pieceBaseAt = function(mapData, x, y) {
    return this.elevationAt(mapData, x, y) + this.terrainHeightAt(mapData, x + 0.5, y + 0.5);
};

//-----------------------------------------------------------------------------
// Water
//
// Water poured into a hollow of the ground: a sheet at one world height over
// the hollow's cells, drawn as a moving translucent plane. Ground below the
// sheet by more than a wade is impassable; a shore is terrain sloping under
// it. Stored in the sidecar as `water: [{ x0, y0, x1, y1, level, material,
// mask }]`, cells inclusive; `mask` is one character per cell of the box,
// row by row, "1" where the water is. A sheet without a mask (an older one)
// covers its whole box. A sheet with a `path` is a river: its surface follows
// the path's heights downstream instead of standing level (see Rivers below).

Reactor3D.WATER_WADE = 0.45;
// As high as ground goes: the tallest tile with the terrain raised to its top.
Reactor3D.WATER_MAX_LEVEL = 160;

Reactor3D.normalizeWater = function(raw, mapData) {
    if (!raw || typeof raw !== "object") return null;
    let x0 = Math.floor(Number(raw.x0)), y0 = Math.floor(Number(raw.y0)), x1 = Math.floor(Number(raw.x1)), y1 = Math.floor(Number(raw.y1));
    if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (mapData) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(mapData.width - 1, x1); y1 = Math.min(mapData.height - 1, y1); }
    if (x1 < x0 || y1 < y0) return null;
    const level = Math.max(-this.WATER_MAX_LEVEL, Math.min(this.WATER_MAX_LEVEL, Number(raw.level) || 0));
    const region = { x0, y0, x1, y1, level: Math.round(level * 100) / 100, material: typeof raw.material === "string" ? raw.material.trim() : "" };
    const mask = this.waterMaskFor(raw, region);
    if (mask) region.mask = mask;
    Object.assign(region, this.waterLookOf(raw));
    const river = this.normalizeRiverPath(raw, mapData);
    if (river) {
        region.path = river.path;
        region.flow = river.flow;
        // The level old readers see: the river's highest point.
        region.level = river.path.reduce((top, point) => Math.max(top, point[2]), -Infinity);
    }
    return region;
};

/**
 * A sheet's look beyond its image, only what was set: `reflect` (0-1, how
 * much of the world its surface mirrors), `gloss` (0-1, 1 a clean mirror)
 * and `tint` (the colour the reflection takes). Mercury is all three high:
 * reflect 1, gloss 0.9, a pale steel tint.
 */
Reactor3D.waterLookOf = function(raw) {
    const out = {};
    const unit = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null; };
    if (unit(raw.reflect) !== null) out.reflect = unit(raw.reflect);
    if (unit(raw.gloss) !== null) out.gloss = unit(raw.gloss);
    if (typeof raw.tint === "string" && /^#[0-9a-f]{6}$/i.test(raw.tint)) out.tint = raw.tint.toLowerCase();
    // What the liquid is: its own colour (none: the depth blue of water), how clear it is
    // (0 opaque, like tar), how much it waves (0-2, tar barely stirs) and whether it glows (lava).
    if (typeof raw.colour === "string" && /^#[0-9a-f]{6}$/i.test(raw.colour)) out.colour = raw.colour.toLowerCase();
    if (unit(raw.clear) !== null) out.clear = unit(raw.clear);
    const waves = Number(raw.waves);
    if (Number.isFinite(waves)) out.waves = Math.max(0, Math.min(2, Math.round(waves * 100) / 100));
    if (unit(raw.glow) !== null) out.glow = unit(raw.glow);
    return out;
};

/** The raw sheet's mask cut to the region's box (the box may have been clamped to the map), or null when it covers the box. */
Reactor3D.waterMaskFor = function(raw, region) {
    if (typeof raw.mask !== "string" || !raw.mask.length) return null;
    const rx0 = Math.floor(Number(raw.x0)), ry0 = Math.floor(Number(raw.y0)), rx1 = Math.floor(Number(raw.x1)), ry1 = Math.floor(Number(raw.y1));
    const rw = Math.abs(rx1 - rx0) + 1, rh = Math.abs(ry1 - ry0) + 1, ox = Math.min(rx0, rx1), oy = Math.min(ry0, ry1);
    if (raw.mask.length !== rw * rh) return null;
    const w = region.x1 - region.x0 + 1, h = region.y1 - region.y0 + 1;
    let out = "", full = true;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = raw.mask[(region.y0 + y - oy) * rw + (region.x0 + x - ox)] === "1" ? "1" : "0";
        if (c === "0") full = false;
        out += c;
    }
    return full ? null : out;
};

/** Whether a sheet stands over a cell. */
Reactor3D.waterCovers = function(region, x, y) {
    if (x < region.x0 || x > region.x1 || y < region.y0 || y > region.y1) return false;
    return !region.mask || region.mask[(y - region.y0) * (region.x1 - region.x0 + 1) + (x - region.x0)] === "1";
};

Reactor3D.waterOf = function(mapData) {
    const sidecar = mapData && mapData.reactor3d;
    const raw = sidecar && sidecar.water;
    if (!Array.isArray(raw) || !raw.length) return [];
    const memo = this._waterMemo || (this._waterMemo = new WeakMap());
    const known = memo.get(raw);
    if (known) return known;
    const list = raw.map(entry => this.normalizeWater(entry, mapData)).filter(Boolean);
    memo.set(raw, list);
    return list;
};

Reactor3D.hasWater = function(mapData) {
    return this.waterOf(mapData).length > 0;
};

/** The water level over a cell (a river's at the cell's middle), or null on dry land; the highest sheet wins. */
Reactor3D.waterLevelAt = function(mapData, x, y) {
    let level = null;
    for (const region of this.waterOf(mapData)) {
        if (!this.waterCovers(region, x, y)) continue;
        const here = region.path ? this.riverCellLevel(region, x, y) : region.level;
        if (level === null || here > level) level = here;
    }
    return level;
};

/** The water's surface at a world point (a river's exactly there, not its cell's), or null on dry land. */
Reactor3D.waterSurfaceAt = function(mapData, wx, wz) {
    const x = Math.floor(wx), y = Math.floor(wz);
    let level = null;
    for (const region of this.waterOf(mapData)) {
        if (!this.waterCovers(region, x, y)) continue;
        const here = region.path ? this.riverSample(region, wx, wz).level : region.level;
        if (level === null || here > level) level = here;
    }
    return level;
};

/**
 * The physics' settings when the game swims (reactor_physics.js), else null:
 * the editor and a game without physics keep deep water impassable.
 */
Reactor3D.swimRule = function() {
    const physics = typeof ReactorPhysics !== "undefined" ? ReactorPhysics : null;
    if (!physics || !physics.settings) return null;
    const settings = physics.settings();
    return settings.swim ? settings : null;
};

/** How deep the water stands over the ground at a world point; 0 on dry land. */
Reactor3D.waterDepthAt = function(mapData, wx, wz, near) {
    const level = this.waterSurfaceAt(mapData, wx, wz);
    if (level === null) return 0;
    return Math.max(0, level - this.groundHeightAt(mapData, wx, wz, near));
};

/**
 * The bed under a sheet at a world point, for how deep it looks: the ground,
 * raised only by pieces lying wholly under the surface (a sunken floor, a
 * slab on the bottom). What stands up through the water (a jetty's posts and
 * deck, a moored boat, a wall) is not the bed: the water runs on round and
 * under it at its own depth, so it neither fades out nor turns clear there.
 */
Reactor3D.waterBedAt = function(mapData, wx, wz, level) {
    const x = Math.floor(wx), y = Math.floor(wz);
    const base = this.elevationAt(mapData, x, y) + this.terrainHeightAt(mapData, wx, wz);
    const index = this.pieceIndex(mapData);
    const stack = index && index.cells.get(y * 65536 + x);
    if (!stack) return base;
    const u = wx - x, v = wz - y;
    let bed = base;
    for (const piece of stack) {
        if (piece.kind === "ladder") continue;
        let top = base + this.pieceTop(piece, u, v);
        // A shape is drawn from its own cell's ground (as `pieceSurfaceAt` reads it).
        if (this.isShapeKind(piece.kind)) {
            const anchor = Array.isArray(piece.anchor) ? piece.anchor : [piece.x, piece.y];
            top = this.pieceBaseAt(mapData, anchor[0], anchor[1]) + this.pieceTop(piece, u, v);
        }
        if (top <= level && top > bed) bed = top;
    }
    return bed;
};

//-----------------------------------------------------------------------------
// Rivers
//
// A sheet with a `path` runs downhill: `path: [[x, y, level], ...]` is its
// centre line in downstream order (tile units, so a cell's middle is
// x + 0.5) with the surface's height at each point, and `flow` (default 1,
// 0 still) how fast it runs. Anywhere on the sheet the surface is the
// path's height where that point meets the line, blended across the line's
// joints so a bend has no crease and eased between points so a change of
// slope has none either. The image and the foam run along the line, faster
// where it drops. A stretch dropping more than WATER_FALL_SLOPE tiles per
// tile of run is a waterfall: no sheet there, a falling curtain from its
// lip to its foot and foam where it lands. The mask still says which cells
// are wet.

Reactor3D.WATER_FALL_SLOPE = 1;
// How far around a joint the two stretches blend, in tiles.
Reactor3D.RIVER_BLEND = 1.5;

/** A sheet's path and flow, or null when it has none (a level pond). */
Reactor3D.normalizeRiverPath = function(raw, mapData) {
    if (!raw || !Array.isArray(raw.path)) return null;
    const width = mapData && mapData.width > 0 ? mapData.width : Infinity;
    const height = mapData && mapData.height > 0 ? mapData.height : Infinity;
    const round = value => Math.round(value * 100) / 100;
    const path = [];
    for (const point of raw.path) {
        if (!Array.isArray(point) || point.length < 3) continue;
        const x = Number(point[0]), y = Number(point[1]), level = Number(point[2]);
        if (![x, y, level].every(Number.isFinite)) continue;
        const next = [round(Math.max(0, Math.min(width, x))), round(Math.max(0, Math.min(height, y))),
            round(Math.max(-this.WATER_MAX_LEVEL, Math.min(this.WATER_MAX_LEVEL, level)))];
        const last = path[path.length - 1];
        if (last && last[0] === next[0] && last[1] === next[1] && last[2] === next[2]) continue;
        path.push(next);
    }
    if (path.length < 2) return null;
    const flow = raw.flow === undefined || raw.flow === null || raw.flow === "" ? 1 : Number(raw.flow);
    return { path, flow: Number.isFinite(flow) ? Math.max(0, Math.min(4, Math.round(flow * 100) / 100)) : 1 };
};

/**
 * What a river's path works out to, kept per sheet: its stretches (start,
 * end, length, distance along the river where each starts, direction), which
 * of them fall, and the eased slope at each point. Built once.
 */
Reactor3D.riverProfile = function(region) {
    const memo = this._riverMemo || (this._riverMemo = new WeakMap());
    let profile = memo.get(region);
    if (profile) return profile;
    const path = region.path, n = path.length - 1;
    const ax = new Float64Array(n), az = new Float64Array(n), ux = new Float64Array(n), uz = new Float64Array(n);
    const len = new Float64Array(n), start = new Float64Array(n + 1), fall = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const [x0, z0, l0] = path[i], [x1, z1, l1] = path[i + 1];
        const run = Math.hypot(x1 - x0, z1 - z0);
        ax[i] = x0; az[i] = z0; len[i] = run;
        ux[i] = run > 1e-6 ? (x1 - x0) / run : 0; uz[i] = run > 1e-6 ? (z1 - z0) / run : 0;
        start[i + 1] = start[i] + run;
        const drop = l0 - l1;
        fall[i] = drop > 0.5 && drop > this.WATER_FALL_SLOPE * run ? 1 : 0;
    }
    // A stretch with no run of its own (a sheer drop) takes its neighbours' direction.
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
        if (ux[i] || uz[i]) continue;
        const j = pass === 0 ? i - 1 : i + 1;
        if (j >= 0 && j < n && (ux[j] || uz[j])) { ux[i] = ux[j]; uz[i] = uz[j]; }
    }
    // Eased heights: a monotone cubic through the points of each run between falls, so
    // the surface bends smoothly where the slope changes and never overshoots a point.
    const tangent = new Float64Array(n + 1);
    const slopeOf = i => len[i] > 1e-6 ? (path[i + 1][2] - path[i][2]) / len[i] : 0;
    for (let k = 0; k <= n; k++) {
        const before = k > 0 && !fall[k - 1] ? k - 1 : -1, after = k < n && !fall[k] ? k : -1;
        if (before < 0 && after < 0) { tangent[k] = 0; continue; }
        if (before < 0) { tangent[k] = slopeOf(after); continue; }
        if (after < 0) { tangent[k] = slopeOf(before); continue; }
        const d0 = slopeOf(before), d1 = slopeOf(after), h0 = len[before], h1 = len[after];
        tangent[k] = d0 * d1 <= 0 || h0 < 1e-6 || h1 < 1e-6 ? 0 : 3 * (h0 + h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1);
    }
    // Each falling stretch's foot: where the whole run of falls it is part of lands.
    const foot = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) foot[i] = fall[i] ? (i + 1 < n && fall[i + 1] ? foot[i + 1] : path[i + 1][2]) : path[i + 1][2];
    profile = { n, ax, az, ux, uz, len, start, fall, foot, tangent, near: new Float64Array(n), along: new Float64Array(n), cells: null, falls: null };
    memo.set(region, profile);
    return profile;
};

/** The river's height and how fast it drops (tiles per tile) a distance `s` along it; `out` is filled. */
Reactor3D.riverLevelAlong = function(region, profile, s, out) {
    const path = region.path, n = profile.n, start = profile.start;
    let k = 0;
    // A point exactly at a fall's foot is below it, not on it.
    while (k < n - 1 && (s > start[k + 1] || (s === start[k + 1] && profile.fall[k]))) k++;
    const h = profile.len[k], l0 = path[k][2], l1 = path[k + 1][2];
    out.segment = k;
    if (profile.fall[k] || h < 1e-6) {
        const t = h < 1e-6 ? 1 : Math.max(0, Math.min(1, (s - start[k]) / h));
        out.level = l0 + (l1 - l0) * t;
        out.slope = h < 1e-6 ? 8 : Math.max(0, (l0 - l1) / h);
        out.fall = !!profile.fall[k];
        out.foot = profile.foot[k];
        return out;
    }
    const t = Math.max(0, Math.min(1, (s - start[k]) / h)), t2 = t * t, t3 = t2 * t;
    const m0 = profile.tangent[k] * h, m1 = profile.tangent[k + 1] * h;
    out.level = (2 * t3 - 3 * t2 + 1) * l0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * l1 + (t3 - t2) * m1;
    const rate = ((6 * t2 - 6 * t) * l0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * l1 + (3 * t2 - 2 * t) * m1) / h;
    out.slope = Math.max(0, -rate);
    out.fall = false;
    return out;
};

/**
 * The river at a world point: `level`, the way it runs (`dx`, `dz`, a unit
 * vector), how fast it drops (`slope`), whether the point is on a waterfall
 * (`fall`), how far along the river it is (`s`) and how far from its line
 * (`distance`). Each stretch near the point is projected onto and their
 * distances along blended, nearest weighing most, so crossing from one
 * stretch's side of a bend to the next's moves the surface smoothly.
 * `out` is filled and returned (one shared object when none is given).
 */
Reactor3D.riverSample = function(region, wx, wz, out = this._riverScratch || (this._riverScratch = {})) {
    const profile = this.riverProfile(region), n = profile.n, near = profile.near, along = profile.along;
    let nearest = Infinity, best = 0;
    for (let i = 0; i < n; i++) {
        const h = profile.len[i];
        let t = h > 1e-6 ? ((wx - profile.ax[i]) * profile.ux[i] + (wz - profile.az[i]) * profile.uz[i]) : 0;
        t = Math.max(0, Math.min(h, t));
        const px = profile.ax[i] + profile.ux[i] * t, pz = profile.az[i] + profile.uz[i] * t;
        near[i] = Math.hypot(wx - px, wz - pz);
        along[i] = profile.start[i] + t;
        if (near[i] < nearest) { nearest = near[i]; best = i; }
    }
    const reach = this.RIVER_BLEND;
    let weight = 0, s = 0, dx = 0, dz = 0;
    for (let i = 0; i < n; i++) {
        const gap = near[i] - nearest;
        if (gap >= reach) continue;
        const w = (1 - gap / reach) * (1 - gap / reach);
        weight += w; s += w * along[i]; dx += w * profile.ux[i]; dz += w * profile.uz[i];
    }
    s = weight > 0 ? s / weight : along[best];
    // A point beside the river just past a lip projects onto the stretch above it, clamped to its end,
    // and would read as the river above the fall, standing out over the drop at the top's height. Past
    // a fall's lip line (in the fall's own direction, and no farther across it than the river reaches
    // here) a point is on the fall.
    for (let i = 0; i < n; i++) {
        if (!profile.fall[i] || (i > 0 && profile.fall[i - 1])) continue;
        const ox = wx - profile.ax[i], oz = wz - profile.az[i];
        const ahead = ox * profile.ux[i] + oz * profile.uz[i];
        if (!(ahead > 0) || s >= profile.start[i]) continue;
        const across = Math.abs(ox * profile.uz[i] - oz * profile.ux[i]);
        if (across <= nearest + reach && ahead <= profile.len[i] + 0.5) { s = profile.start[i] + Math.min(ahead, profile.len[i]); break; }
    }
    const length = Math.hypot(dx, dz);
    out.dx = length > 1e-6 ? dx / length : profile.ux[best];
    out.dz = length > 1e-6 ? dz / length : profile.uz[best];
    out.s = s;
    out.distance = nearest;
    this.riverLevelAlong(region, profile, s, out);
    return out;
};

/** How fast a river runs where it drops `slope` tiles per tile, in tiles a second: lazy on the flat, quick in rapids. */
Reactor3D.riverSpeed = function(slope, flow) {
    return (flow === undefined ? 1 : flow) * (0.4 + 2.4 * Math.max(0, Math.min(1, slope * 4)));
};

/** Each wet cell of a river: its level at the middle, the way and speed it runs, and whether it falls. Built once. */
Reactor3D.riverCells = function(region) {
    const profile = this.riverProfile(region);
    if (profile.cells) return profile.cells;
    const w = region.x1 - region.x0 + 1, h = region.y1 - region.y0 + 1;
    const cells = { level: new Float32Array(w * h), dx: new Float32Array(w * h), dz: new Float32Array(w * h), speed: new Float32Array(w * h), fall: new Uint8Array(w * h) };
    const sample = {};
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (region.mask && region.mask[i] !== "1") { cells.level[i] = NaN; continue; }
        this.riverSample(region, region.x0 + x + 0.5, region.y0 + y + 0.5, sample);
        cells.level[i] = sample.level;
        cells.dx[i] = sample.dx; cells.dz[i] = sample.dz;
        cells.speed[i] = sample.fall ? 0 : this.riverSpeed(sample.slope, region.flow);
        cells.fall[i] = sample.fall ? 1 : 0;
    }
    profile.cells = cells;
    return cells;
};

/** A river's level at a cell's middle (the cell must be one it covers). */
Reactor3D.riverCellLevel = function(region, x, y) {
    const cells = this.riverCells(region);
    const level = cells.level[(y - region.y0) * (region.x1 - region.x0 + 1) + (x - region.x0)];
    return Number.isFinite(level) ? level : region.level;
};

/**
 * Which way the water over a cell runs and how fast (`dx`, `dz` a unit
 * vector, `speed` in tiles a second), or null where it stands still or there
 * is none: the highest sheet over the cell decides, as for its level.
 */
Reactor3D.waterFlowAt = function(mapData, x, y) {
    let top = null, level = null;
    for (const region of this.waterOf(mapData)) {
        if (!this.waterCovers(region, x, y)) continue;
        const here = region.path ? this.riverCellLevel(region, x, y) : region.level;
        if (level === null || here > level) { level = here; top = region; }
    }
    if (!top || !top.path) return null;
    const cells = this.riverCells(top), i = (y - top.y0) * (top.x1 - top.x0 + 1) + (x - top.x0);
    if (!(cells.speed[i] > 0)) return null;
    const out = this._flowScratch || (this._flowScratch = {});
    out.dx = cells.dx[i]; out.dz = cells.dz[i]; out.speed = cells.speed[i]; out.level = cells.level[i];
    return out;
};

/**
 * A river's waterfalls: each run of falling stretches as one fall, from its
 * lip (`x0`, `z0`, `top`) to its foot (`x1`, `z1`, `bottom`), the way it
 * falls (`dx`, `dz`) and how wide it is (`half` each side of `x0`/`z0`
 * shifted by `offset` across), the width measured on the mask just upstream
 * of the lip. Built once.
 */
Reactor3D.riverFalls = function(region) {
    const profile = this.riverProfile(region);
    if (profile.falls) return profile.falls;
    const falls = [], path = region.path;
    for (let i = 0; i < profile.n; i++) {
        if (!profile.fall[i]) continue;
        let j = i;
        while (j + 1 < profile.n && profile.fall[j + 1]) j++;
        const lip = path[i], foot = path[j + 1];
        let dx = foot[0] - lip[0], dz = foot[1] - lip[1];
        const run = Math.hypot(dx, dz);
        if (run > 1e-6) { dx /= run; dz /= run; } else { dx = profile.ux[i]; dz = profile.uz[i]; }
        if (!dx && !dz) dz = 1;
        // Across the river just above the lip: as far each way as the water goes.
        const px = -dz, pz = dx, ox = lip[0] - dx * 0.6, oz = lip[1] - dz * 0.6;
        const reach = sign => {
            let d = 0;
            while (d < 12 && this.waterCovers(region, Math.floor(ox + px * sign * (d + 0.25)), Math.floor(oz + pz * sign * (d + 0.25)))) d += 0.25;
            return d;
        };
        const left = reach(-1), right = reach(1);
        falls.push({ x0: lip[0], z0: lip[1], top: lip[2], x1: foot[0], z1: foot[1], bottom: foot[2], run, dx, dz,
            half: Math.max(0.5, (left + right) / 2), offset: (right - left) / 2 });
        i = j;
    }
    profile.falls = falls;
    return falls;
};

/** The Y of every vertex as built, kept so the terrain can lift it again later. */
Reactor3D.terrainBaseY = function(positions) {
    const base = new Float32Array(positions.length / 3);
    for (let i = 0, j = 0; i < positions.length; i += 3, j++) base[j] = positions[i + 1];
    return base;
};

//-----------------------------------------------------------------------------
// World meshes
//
// The terrain bend, piece chunks and water sheets of a Reactor3D.MapScene.
// Pieces are laid in chunks: one mesh per material per PIECE_CHUNK-cell
// square of the map, so an off-screen chunk is culled whole and an edit
// relays only the chunks it touches.

/**
 * Bend the built scene through the terrain again, in place, after the grid
 * changed under it. Only vertices inside `region` (corner-grid bounds
 * `{x0, x1, z0, z1}` in tiles, or null for the whole map) are touched: a
 * brush dab moves a few hundred vertices instead of throwing the scene away
 * and building it again, which is what made every dab pause and reset the
 * sky's drift. Returns the geometries it changed, or null when the scene was
 * built without terrain vertices and has to be rebuilt to get them.
 */
Reactor3D.MapScene.prototype.updateTerrain = function(mapData, region) {
    if (!this._terrainMap || !mapData || !Reactor3D.terrainOf(mapData)) return null;
    const x0 = region ? region.x0 - 1e-3 : -Infinity, x1 = region ? region.x1 + 1e-3 : Infinity;
    const z0 = region ? region.z0 - 1e-3 : -Infinity, z1 = region ? region.z1 + 1e-3 : Infinity;
    const changed = [];
    const seen = new Set();
    for (const mesh of this._meshes) {
        const geometry = mesh && mesh.geometry;
        if (!geometry || seen.has(geometry)) continue;
        const base = geometry.userData && geometry.userData.terrainBaseY;
        if (base === undefined || base === null) continue;
        seen.add(geometry);
        const attribute = geometry.attributes.position;
        const positions = attribute.array;
        const constant = typeof base === "number";
        let moved = false;
        for (let i = 0, j = 0; i < positions.length; i += 3, j++) {
            const x = positions[i], z = positions[i + 2];
            if (x < x0 || x > x1 || z < z0 || z > z1) continue;
            const y = (constant ? base : base[j]) + Reactor3D.terrainHeightAt(mapData, x, z);
            if (positions[i + 1] !== y) { positions[i + 1] = y; moved = true; }
        }
        if (!moved) continue;
        attribute.needsUpdate = true;
        if (geometry.userData.terrainPlane) geometry.computeVertexNormals();
        if (geometry.boundingBox) geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        changed.push(geometry);
    }
    if (changed.length && Reactor3D.Shadows && Reactor3D.Shadows.invalidate) Reactor3D.Shadows.invalidate();
    return changed;
};

/**
 * The shape of each kind in its own unit cell: x east, y up, v south, all
 * 0..1. A piece is a few boxes, a wedge (rises along +v), a gable (a ridge
 * across the middle, eaves at v 0 and 1) or a column. Turned by `rot`
 * quarter turns about the cell's middle when it is laid down.
 */
Reactor3D.pieceShapes = function(kind, piece) {
    const box = (x0, y0, v0, x1, y1, v1) => ({ box: [x0, y0, v0, x1, y1, v1] });
    const S = this.PIECE_STOREY;
    const params = this.shapeParams(piece || { kind });
    switch (kind) {
        case "wall": return [box(0, 0, 0, 1, S, 1)];
        case "block": return [box(0, 0, 0, 1, 1, 1)];
        case "floor": return [box(0, 0, 0, 1, this.PIECE_FLOOR_THICKNESS, 1)];
        case "pillar": return [box(0.24, 0, 0.24, 0.76, 0.12, 0.76), { column: [0.5, 0.5, 0.2, 0.12, S - 0.12] }, box(0.24, S - 0.12, 0.24, 0.76, S, 0.76)];
        case "stair": {
            const steps = [0, 1, 2, 3].map(i => box(0, 0, i * 0.25, 1, (i + 1) * 0.25, 1));
            // A step above what it stands on has a solid down to it: a plan lays no slab under a stair,
            // and the ground showed through the run. Down to the roof or floor under it, not the ground
            // (a stair on a skyscraper's roof ran the building's whole height down its side).
            const under = piece && Number.isFinite(piece.supportTop) ? piece.supportTop : 0;
            const drop = piece && Number.isFinite(piece.z) && piece.z > under ? piece.z - under : 0;
            return drop > 0 ? steps.concat([box(0, -drop, 0, 1, 0, 1)]) : steps;
        }
        case "ramp": return [{ wedge: true }];
        case "roof": return [{ gable: true }];
        // A level of ladder against the side it climbs toward (+v): two rails, two rungs.
        case "ladder": {
            // Beside another level of ladder (a wide ladder), the shared side has no rail and the
            // rungs run on across (`ladderJoin`, set where the geometry is laid).
            const join = (piece && piece.ladderJoin) || {};
            const u0 = join.lo ? 0 : 0.22, u1 = join.hi ? 1 : 0.78;
            const parts = [box(u0, 0.22, 0.86, u1, 0.29, 0.92), box(u0, 0.72, 0.86, u1, 0.79, 0.92)];
            if (!join.lo) parts.push(box(0.14, 0, 0.84, 0.22, 1, 0.94));
            if (!join.hi) parts.push(box(0.78, 0, 0.84, 0.86, 1, 0.94));
            return parts;
        }
        // A doorway is a wall with its bottom gone: a lintel band across the
        // top and nothing under it, the whole cell wide. The walls either
        // side are the posts, so two doorways side by side are one opening
        // two tiles wide — 1.2 m, a door a person walks through — and one
        // alone is a narrow 60 cm gap. A window is the same with a sill
        // under the hole and a header over it.
        case "doorway": return [box(0, S - 0.6, 0, 1, S, 1)];
        case "window": return [box(0, 0, 0, 1, 1.5, 1), box(0, S - 1.4, 0, 1, S, 1)];
        // A pane the height of a wall, thin, in the middle of the cell: a viewport, or
        // the glass a plan sets in every window's hole.
        case "glass": return [box(0, 0, 0.45, 1, S, 0.55)];
        // Waist high on a three-tile character; it still blocks a cell.
        case "fence": return [box(0.05, 0, 0.42, 0.15, 1.5, 0.58), box(0.85, 0, 0.42, 0.95, 1.5, 0.58), box(0, 0.5, 0.45, 1, 0.62, 0.55), box(0, 1.15, 0.45, 1, 1.27, 0.55)];
        // The shapes fill the unit cell; their size stretches the cell.
        case "box": return [box(0, 0, 0, 1, 1, 1)];
        case "wedge": return [{ wedge: true }];
        case "prism": return [{ gable: true }];
        case "pyramid": return [{ pyramid: true }];
        case "cylinder": return [{ column: [0.5, 0.5, 0.5, 0, 1, 32, params.sweep] }];
        case "tube": return [{ tube: [0.5, 0.5, 0.5, 0.5 * (1 - params.thick), 0, 1, 32, params.sweep] }];
        case "cone": return [{ cone: [0.5, 0.5, 0.5, 0, 1, 32] }];
        case "dome": return [{ dome: [0.5, 0.5, 0.5, 0, 32, 10] }];
        case "sphere": return [{ sphere: [0.5, 0.5, 0.5, 0.5, 32, 16] }];
        // An arch is a wall with a round-topped opening through it; a tunnel is the same, deep.
        case "arch": case "tunnel": return [{ arch: [0.15, 0.5, 0.35, 24] }];
        case "ring": return [{ torus: [0.5, 0.5, 0.5, 0.5 - params.thick / 2, params.thick / 2, 0.5, 32, 16, params.sweep] }];
        // Ship parts: a hull segment and a spike are sided prisms that taper (flats touch
        // the cell), a capsule a column with domed ends, a dish a shallow bowl, a fin a
        // swept plate standing on its root.
        case "hull": case "spike": return [{ frustum: [0.5, 0.5, 0.5, 0, 1, params.sides, params.taper] }];
        case "capsule": return [{ capsule: [0.5, 0.5, 0.5, 0.25, 0.75, params.sides, 6] }];
        case "dish": return [{ dish: [0.5, 0.5, 0.5, 0.12, params.sides, 8] }];
        case "fin": return [{ fin: [params.taper] }];
        // Drawn as one mass with its neighbours (rockMesh); anything reading its parts sees its box.
        case "rock": return [box(0, 0, 0, 1, 1, 1)];
        // A door's casing or a window's frame, sill and shutters: boxes worked out by reactor_3d_doors.js.
        case "trim": return (piece && piece.boxes) || [];
        default: return [];
    }
};

/**
 * Triangles for one piece, in world units, appended to flat arrays.
 * Faces carry planar world-space UVs (one image repeat per tile, so a row
 * of blocks tiles seamlessly) and a per-vertex shade by facing, which is
 * the only lighting a flat-shaded block gets: tops bright, undersides
 * dark, the four sides each their own tone so edges read.
 */
Reactor3D.emitPiece = function(piece, base, out, hidden) {
    const cx = piece.x + 0.5, cz = piece.y + 0.5, oy = base + piece.z;
    const rot = piece.rot;
    const skip = hidden || {};
    // A shape is the unit cell stretched to its size, turned, tilted and rolled about its middle.
    const placeShape = this.isShapeKind(piece.kind) ? this.shapePlacer(piece, base) : null;
    const place = (x, y, v) => {
        if (placeShape) return placeShape(x, y, v);
        let dx = x - 0.5, dz = v - 0.5;
        for (let i = 0; i < rot; i++) {
            const next = -dz;
            dz = dx;
            dx = next;
        }
        return [cx + dx, oy + y, cz + dz];
    };
    const shadeFor = (nx, ny, nz) => {
        if (ny > 0.7) return 1;
        if (ny < -0.7) return 0.5;
        const side = 0.62 + 0.16 * (nx * 0.5 + 0.5) + 0.12 * (nz * 0.5 + 0.5);
        return ny > 0 ? side + (1 - side) * ny : side;
    };
    // A box may carry its own colour over the material (a shutter's paint, a flower): [r, g, b], 0-1.
    let tint = null;
    const tri = (a, b, c) => {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length; ny /= length; nz /= length;
        const shade = shadeFor(nx, ny, nz);
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        for (const p of [a, b, c]) {
            out.positions.push(p[0], p[1], p[2]);
            if (ay >= ax && ay >= az) out.uvs.push(p[0], p[2]);
            else if (ax >= az) out.uvs.push(p[2], p[1]);
            else out.uvs.push(p[0], p[1]);
            if (tint) out.colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
            else out.colors.push(shade, shade, shade);
        }
    };
    const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
    const shapes = this.pieceShapes(piece.kind, piece);
    // The highest box face of the piece: the top the skip rule speaks of (a window's header, not its sill).
    let boxTop = 0;
    for (const shape of shapes) if (shape.box) boxTop = Math.max(boxTop, shape.box[4]);
    for (const shape of shapes) {
        tint = shape.tint || null;
        if (shape.box) {
            const [x0, y0, v0, x1, y1, v1] = shape.box;
            const p = (x, y, v) => place(x, y, v);
            // Wound to face outward, whichever way the piece is turned. A
            // face pressed against a neighbouring solid is left out: it was
            // never seen, and a cutaway through a wall would have shown it.
            if (!(skip.top && y1 >= boxTop - 1e-6)) quad(p(x0, y1, v0), p(x0, y1, v1), p(x1, y1, v1), p(x1, y1, v0)); // top
            if (!(skip.bottom && y0 <= 1e-6)) quad(p(x0, y0, v0), p(x1, y0, v0), p(x1, y0, v1), p(x0, y0, v1)); // bottom
            const side = (covered, atEdge, emit) => { for (const [a, b] of (atEdge ? Reactor3D.visibleSpans(y0, y1, covered) : [[y0, y1]])) emit(a, b); };
            side(skip.south, v1 >= 1 - 1e-6, (a, b) => quad(p(x0, a, v1), p(x1, a, v1), p(x1, b, v1), p(x0, b, v1))); // south
            side(skip.north, v0 <= 1e-6, (a, b) => quad(p(x1, a, v0), p(x0, a, v0), p(x0, b, v0), p(x1, b, v0))); // north
            side(skip.east, x1 >= 1 - 1e-6, (a, b) => quad(p(x1, a, v1), p(x1, a, v0), p(x1, b, v0), p(x1, b, v1))); // east
            side(skip.west, x0 <= 1e-6, (a, b) => quad(p(x0, a, v0), p(x0, a, v1), p(x0, b, v1), p(x0, b, v0))); // west
        } else if (shape.wedge) {
            // Flat at v 0, a full level at v 1.
            const p = place;
            quad(p(0, 0, 0), p(0, 1, 1), p(1, 1, 1), p(1, 0, 0)); // slope
            quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)); // bottom
            quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)); // back wall
            tri(p(1, 0, 0), p(1, 1, 1), p(1, 0, 1)); // east
            tri(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)); // west
        } else if (shape.gable) {
            const p = place;
            quad(p(0, 0, 0), p(0, 1, 0.5), p(1, 1, 0.5), p(1, 0, 0)); // north slope
            quad(p(0, 1, 0.5), p(0, 0, 1), p(1, 0, 1), p(1, 1, 0.5)); // south slope
            quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)); // bottom
            tri(p(1, 0, 0), p(1, 1, 0.5), p(1, 0, 1)); // east gable
            tri(p(0, 0, 0), p(0, 0, 1), p(0, 1, 0.5)); // west gable
        } else if (shape.column) {
            // Round the circle, or round an arc of it centred on +v with flat faces at the ends.
            const [ccx, ccv, r, y0, y1, segs, sweep] = shape.column;
            const segments = segs || 12, arc = (sweep || 360) * Math.PI / 180, start = Math.PI / 2 - arc / 2;
            const at = i => { const a = start + (i / segments) * arc; return [ccx + Math.cos(a) * r, ccv + Math.sin(a) * r]; };
            for (let i = 0; i < segments; i++) {
                const [x0, v0] = at(i), [x1, v1] = at(i + 1);
                quad(place(x0, y0, v0), place(x0, y1, v0), place(x1, y1, v1), place(x1, y0, v1));
                tri(place(ccx, y1, ccv), place(x1, y1, v1), place(x0, y1, v0));
                tri(place(ccx, y0, ccv), place(x0, y0, v0), place(x1, y0, v1));
            }
            if (arc < Math.PI * 2 - 1e-6) {
                const [xs, vs] = at(0), [xe, ve] = at(segments);
                quad(place(ccx, y0, ccv), place(ccx, y1, ccv), place(xs, y1, vs), place(xs, y0, vs)); // the face at the start
                quad(place(xe, y0, ve), place(xe, y1, ve), place(ccx, y1, ccv), place(ccx, y0, ccv)); // and at the end
            }
        } else if (shape.cone) {
            const [ccx, ccv, r, y0, y1, segs] = shape.cone;
            const segments = segs || 24;
            for (let i = 0; i < segments; i++) {
                const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
                const x0 = ccx + Math.cos(a0) * r, v0 = ccv + Math.sin(a0) * r;
                const x1 = ccx + Math.cos(a1) * r, v1 = ccv + Math.sin(a1) * r;
                tri(place(x0, y0, v0), place(ccx, y1, ccv), place(x1, y0, v1));
                tri(place(ccx, y0, ccv), place(x0, y0, v0), place(x1, y0, v1));
            }
        } else if (shape.dome) {
            // A half sphere in rings of quads, closed by a disc underneath.
            const [ccx, ccv, r, y0, segs, ringCount] = shape.dome;
            const segments = segs || 24, rings = ringCount || 8;
            const at = (i, j) => {
                const a = (i / segments) * Math.PI * 2, t = (j / rings) * (Math.PI / 2);
                return place(ccx + Math.cos(a) * Math.cos(t) * r, y0 + Math.sin(t), ccv + Math.sin(a) * Math.cos(t) * r);
            };
            // Wound up the ring first, then round it, like the column's side: the normal points out.
            for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
                if (j === rings - 1) tri(at(i, j), at(i, j + 1), at(i + 1, j));
                else quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
            }
            for (let i = 0; i < segments; i++) {
                const a0 = (i / segments) * Math.PI * 2, a1 = ((i + 1) / segments) * Math.PI * 2;
                tri(place(ccx, y0, ccv), place(ccx + Math.cos(a0) * r, y0, ccv + Math.sin(a0) * r), place(ccx + Math.cos(a1) * r, y0, ccv + Math.sin(a1) * r));
            }
        } else if (shape.pyramid) {
            const p = place, apex = p(0.5, 1, 0.5);
            quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)); // bottom
            tri(p(1, 0, 0), p(0, 0, 0), apex); // north
            tri(p(0, 0, 1), p(1, 0, 1), apex); // south
            tri(p(1, 0, 1), p(1, 0, 0), apex); // east
            tri(p(0, 0, 0), p(0, 0, 1), apex); // west
        } else if (shape.sphere) {
            // Rings of quads from pole to pole, wound up the ring first like the dome.
            const [ccx, ccy, ccv, r, segs, ringCount] = shape.sphere;
            const segments = segs || 24, rings = ringCount || 12;
            const at = (i, j) => {
                const a = (i / segments) * Math.PI * 2, t = -Math.PI / 2 + (j / rings) * Math.PI;
                return place(ccx + Math.cos(a) * Math.cos(t) * r, ccy + Math.sin(t) * r, ccv + Math.sin(a) * Math.cos(t) * r);
            };
            for (let j = 0; j < rings; j++) for (let i = 0; i < segments; i++) {
                if (j === 0) tri(at(i, j), at(i, j + 1), at(i + 1, j + 1));
                else if (j === rings - 1) tri(at(i, j), at(i, j + 1), at(i + 1, j));
                else quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
            }
        } else if (shape.tube) {
            // A column with a hole down its middle: the inner wall faces the hole, the ends are rings.
            const [ccx, ccv, r, ri, y0, y1, segs, sweep] = shape.tube;
            const segments = segs || 24, arc = (sweep || 360) * Math.PI / 180, start = Math.PI / 2 - arc / 2;
            const ring = (i, rad) => { const a = start + (i / segments) * arc; return [ccx + Math.cos(a) * rad, ccv + Math.sin(a) * rad]; };
            if (arc < Math.PI * 2 - 1e-6) {
                const os = ring(0, r), ns = ring(0, ri), oe = ring(segments, r), ne = ring(segments, ri);
                quad(place(ns[0], y0, ns[1]), place(ns[0], y1, ns[1]), place(os[0], y1, os[1]), place(os[0], y0, os[1])); // the face at the start
                quad(place(oe[0], y0, oe[1]), place(oe[0], y1, oe[1]), place(ne[0], y1, ne[1]), place(ne[0], y0, ne[1])); // and at the end
            }
            for (let i = 0; i < segments; i++) {
                const o0 = ring(i, r), o1 = ring(i + 1, r);
                const n0 = ring(i, ri), n1 = ring(i + 1, ri);
                quad(place(o0[0], y0, o0[1]), place(o0[0], y1, o0[1]), place(o1[0], y1, o1[1]), place(o1[0], y0, o1[1])); // outside
                quad(place(n1[0], y0, n1[1]), place(n1[0], y1, n1[1]), place(n0[0], y1, n0[1]), place(n0[0], y0, n0[1])); // inside
                quad(place(o0[0], y1, o0[1]), place(n0[0], y1, n0[1]), place(n1[0], y1, n1[1]), place(o1[0], y1, o1[1])); // top ring
                quad(place(o0[0], y0, o0[1]), place(o1[0], y0, o1[1]), place(n1[0], y0, n1[1]), place(n0[0], y0, n0[1])); // bottom ring
            }
        } else if (shape.torus) {
            // A ring lying flat: the tube's cross-section is `rh` wide and `rv` tall, so a
            // one-tile-tall ring's tube stands the full height.
            const [ccx, ccy, ccv, R, rh, rv, segs, tsegs, sweep] = shape.torus;
            const segments = segs || 24, around = tsegs || 8, arc = (sweep || 360) * Math.PI / 180, start = Math.PI / 2 - arc / 2;
            const at = (i, j) => {
                const a = start + (i / segments) * arc, b = (j / around) * Math.PI * 2;
                const rad = R + Math.cos(b) * rh;
                return place(ccx + Math.cos(a) * rad, ccy + Math.sin(b) * rv, ccv + Math.sin(a) * rad);
            };
            for (let j = 0; j < around; j++) for (let i = 0; i < segments; i++) quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
            if (arc < Math.PI * 2 - 1e-6) {
                // A disc closes each end of the bent pipe.
                const centre = i => { const a = start + (i / segments) * arc; return place(ccx + Math.cos(a) * R, ccy, ccv + Math.sin(a) * R); };
                for (let j = 0; j < around; j++) { tri(centre(0), at(0, j), at(0, j + 1)); tri(centre(segments), at(segments, j + 1), at(segments, j)); }
            }
        } else if (shape.frustum) {
            // A sided prism fitted to the cell (a flat faces forward; the polygon is stretched so
            // its box is the cell's, so four sides make a box), its top ring `taper` as wide as its
            // bottom, a point when 0.
            const [ccx, ccv, half, y0, y1, sides, taper] = shape.frustum;
            const n = Math.max(3, sides || 8), rt = taper;
            const corner = i => { const a = (i / n) * Math.PI * 2 + Math.PI / n; return [Math.cos(a), Math.sin(a)]; };
            let mx = 0, mz = 0;
            for (let i = 0; i < n; i++) { const c = corner(i); mx = Math.max(mx, Math.abs(c[0])); mz = Math.max(mz, Math.abs(c[1])); }
            const ring = (i, k) => { const c = corner(i); return [ccx + c[0] / mx * half * k, ccv + c[1] / mz * half * k]; };
            for (let i = 0; i < n; i++) {
                const b0 = ring(i, 1), b1 = ring(i + 1, 1), t0 = ring(i, rt), t1 = ring(i + 1, rt);
                if (rt > 1e-6) {
                    quad(place(b0[0], y0, b0[1]), place(t0[0], y1, t0[1]), place(t1[0], y1, t1[1]), place(b1[0], y0, b1[1]));
                    tri(place(ccx, y1, ccv), place(t1[0], y1, t1[1]), place(t0[0], y1, t0[1]));
                } else tri(place(b0[0], y0, b0[1]), place(ccx, y1, ccv), place(b1[0], y0, b1[1]));
                tri(place(ccx, y0, ccv), place(b0[0], y0, b0[1]), place(b1[0], y0, b1[1]));
            }
        } else if (shape.capsule) {
            // A column between `y0` and `y1` with a half dome at each end filling the rest of the cell.
            const [ccx, ccy, ccv, y0, y1, sides, ringCount] = shape.capsule;
            const n = Math.max(3, sides || 24), rings = ringCount || 6, r = 0.5;
            const at = (i, j) => {
                // j runs from the bottom pole, over the lower cap, up the side, over the top cap to the top pole.
                const a = (i / n) * Math.PI * 2;
                let y, rad;
                if (j <= rings) { const t = -Math.PI / 2 + (j / rings) * (Math.PI / 2); y = y0 + Math.sin(t) * y0; rad = Math.cos(t) * r; }
                else { const t = ((j - rings - 1) / rings) * (Math.PI / 2); y = y1 + Math.sin(t) * (1 - y1); rad = Math.cos(t) * r; }
                return place(ccx + Math.cos(a) * rad, y, ccv + Math.sin(a) * rad);
            };
            const last = rings * 2 + 1;
            for (let j = 0; j < last; j++) for (let i = 0; i < n; i++) {
                if (j === 0) tri(at(i, j), at(i, j + 1), at(i + 1, j + 1));
                else if (j === last - 1) tri(at(i, j), at(i, j + 1), at(i + 1, j));
                else quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
            }
        } else if (shape.dish) {
            // A bowl: a paraboloid shell `thick` deep, its rim flat at the top of the cell.
            const [ccx, ccv, r, thick, sides, ringCount] = shape.dish;
            const n = Math.max(3, sides || 32), rings = ringCount || 8;
            const rimIn = r * Math.sqrt(1 - thick);
            const outer = (i, j) => { const a = (i / n) * Math.PI * 2, t = j / rings, rad = t * r; return place(ccx + Math.cos(a) * rad, t * t, ccv + Math.sin(a) * rad); };
            const inner = (i, j) => { const a = (i / n) * Math.PI * 2, t = (j / rings) * Math.sqrt(1 - thick), rad = t * r; return place(ccx + Math.cos(a) * rad, t * t + thick, ccv + Math.sin(a) * rad); };
            const rim = (i, rad) => { const a = (i / n) * Math.PI * 2; return place(ccx + Math.cos(a) * rad, 1, ccv + Math.sin(a) * rad); };
            for (let j = 0; j < rings; j++) for (let i = 0; i < n; i++) {
                // Outside faces down and out; inside faces up and in; the rim closes them.
                if (j === 0) { tri(outer(i, 0), outer(i, 1), outer(i + 1, 1)); tri(inner(i, 0), inner(i + 1, 1), inner(i, 1)); }
                else { quad(outer(i, j), outer(i, j + 1), outer(i + 1, j + 1), outer(i + 1, j)); quad(inner(i, j), inner(i + 1, j), inner(i + 1, j + 1), inner(i, j + 1)); }
            }
            for (let i = 0; i < n; i++) quad(rim(i, r), rim(i, rimIn), rim(i + 1, rimIn), rim(i + 1, r));
        } else if (shape.fin) {
            // A plate in the u-y plane, `d` thick along v, its root the full width at the bottom and
            // its tip `taper` as wide at the top, swept so the trailing edge (u 1) stands straight.
            const [taper] = shape.fin;
            const p = place, u0 = 1 - taper;
            quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(u0, 1, 1)); // south face
            quad(p(1, 0, 0), p(0, 0, 0), p(u0, 1, 0), p(1, 1, 0)); // north face
            quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)); // root
            quad(p(u0, 1, 0), p(u0, 1, 1), p(1, 1, 1), p(1, 1, 0)); // tip
            quad(p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)); // trailing edge
            quad(p(0, 0, 0), p(0, 0, 1), p(u0, 1, 1), p(u0, 1, 0)); // leading edge
        } else if (shape.arch) {
            // A wall (the unit cell) with an opening through it along v: posts `post` wide, the
            // opening straight up to `spring` and a half circle of `r` above, the band over it solid.
            const [post, spring, r, segs] = shape.arch;
            const p = place, segments = segs || 16;
            const arc = i => { const t = Math.PI - (i / segments) * Math.PI; return [0.5 + Math.cos(t) * r, spring + Math.sin(t) * r]; }; // left to right
            // A face in the u-y plane at v: `south` order is bottom-left, bottom-right, top-right, top-left.
            const south = (a, b, c, d) => quad(p(a[0], a[1], 1), p(b[0], b[1], 1), p(c[0], c[1], 1), p(d[0], d[1], 1));
            const north = (a, b, c, d) => quad(p(b[0], b[1], 0), p(a[0], a[1], 0), p(d[0], d[1], 0), p(c[0], c[1], 0));
            for (const face of [south, north]) {
                face([0, 0], [post, 0], [post, spring], [0, spring]); // left post
                face([1 - post, 0], [1, 0], [1, spring], [1 - post, spring]); // right post
                face([0, spring], [post, spring], [post, 1], [0, 1]); // over the left post
                face([1 - post, spring], [1, spring], [1, 1], [1 - post, 1]); // over the right post
                for (let i = 0; i < segments; i++) { const a = arc(i), b = arc(i + 1); face(a, b, [b[0], 1], [a[0], 1]); } // the band over the arc
            }
            quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)); // top
            quad(p(0, 0, 0), p(post, 0, 0), p(post, 0, 1), p(0, 0, 1)); // under the left post
            quad(p(1 - post, 0, 0), p(1, 0, 0), p(1, 0, 1), p(1 - post, 0, 1)); // under the right post
            quad(p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)); // east
            quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)); // west
            quad(p(post, 0, 1), p(post, 0, 0), p(post, spring, 0), p(post, spring, 1)); // the left post's inner face
            quad(p(1 - post, 0, 0), p(1 - post, 0, 1), p(1 - post, spring, 1), p(1 - post, spring, 0)); // the right post's inner face
            for (let i = 0; i < segments; i++) { // the underside of the arc, facing into the opening
                const a = arc(i), b = arc(i + 1);
                quad(p(a[0], a[1], 0), p(b[0], b[1], 0), p(b[0], b[1], 1), p(a[0], a[1], 1));
            }
        }
    }
    return out;
};

/**
 * Which faces of a full cube (a wall, a block) touch another full cube of
 * the same footing: those faces are dropped. The sides only where the
 * neighbour spans the same levels and stands on the same ground (to a
 * hair: a shaped map is never exactly flat, and a wall row on a slope
 * keeps its sides so no seam opens); a wall's top under another wall, a
 * block's bottom on a block; and a bottom on the map's ground level. A
 * face kept between two walls is never seen whole, but the cutaway shows
 * it: a row of them through a cut or a faded wall is a sawtooth.
 */
Reactor3D.HIDDEN_FACE_KINDS = ["wall", "block", "window", "doorway"];
/** Height ranges sorted and joined where they touch. */
Reactor3D.mergeRanges = function(ranges) {
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const [a, b] of sorted) {
        const last = out[out.length - 1];
        if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
};
/** The parts of [y0, y1] that `covered` (true, false, or ranges) leaves showing. */
Reactor3D.visibleSpans = function(y0, y1, covered) {
    if (covered === true) return [];
    if (!covered || !covered.length) return [[y0, y1]];
    const spans = [];
    let at = y0;
    for (const [a, b] of covered) {
        if (b <= at + 1e-6) continue;
        if (a >= y1 - 1e-6) break;
        if (a > at + 1e-6) spans.push([at, Math.min(a, y1)]);
        at = Math.max(at, b);
        if (at >= y1 - 1e-6) break;
    }
    if (at < y1 - 1e-6) spans.push([at, y1]);
    return spans;
};
Reactor3D.hiddenFacesOf = function(piece, mapData) {
    if (!this.HIDDEN_FACE_KINDS.includes(piece.kind) && piece.kind !== "floor") return null;
    const height = this.pieceHeight(piece.kind);
    // What a neighbouring cell covers of a shared face, as height ranges from
    // the piece's base: a wall or block all of it (true); a window its sill
    // and header, a doorway its header, and the hole between stays open, so
    // the face shows there as the side of the opening. Nothing: false.
    const solidAt = (x, y, z, h) => {
        const stack = mapData ? this.piecesAt(mapData, x, y) : null;
        if (!stack) return false;
        let ranges = [];
        for (const other of stack) {
            if (!this.HIDDEN_FACE_KINDS.includes(other.kind) || other.z !== z || this.pieceHeight(other.kind) !== h) continue;
            if (other.kind === "wall" || other.kind === "block") return true;
            for (const shape of this.pieceShapes(other.kind, other)) {
                if (!shape.box) continue;
                const [x0, y0, v0, x1, y1, v1] = shape.box;
                if (x0 <= 1e-6 && x1 >= 1 - 1e-6 && v0 <= 1e-6 && v1 >= 1 - 1e-6) ranges.push([y0, y1]);
            }
        }
        return ranges.length ? this.mergeRanges(ranges) : false;
    };
    const stoneAt = (x, y, z, h) => {
        const stack = mapData ? this.piecesAt(mapData, x, y) : null;
        return !!stack && stack.some(other => (other.kind === "wall" || other.kind === "block") && other.z === z && this.pieceHeight(other.kind) === h);
    };
    const here = mapData ? this.pieceBaseAt(mapData, piece.x, piece.y) : 0;
    const level = (x, y) => !!mapData && Math.abs(this.pieceBaseAt(mapData, x, y) - here) < 0.02;
    if (piece.kind === "floor") {
        // A slab is laid under every wall of a plan, so a doorway has a
        // threshold and a cut wall never shows the ground. Inside a wall it
        // is never seen, and its sides would fight the wall's own faces for
        // the bottom tenth of a tile: a band of floorboard round the foot of
        // every building. A side against a neighbouring slab at the same
        // level is a seam inside one floor, and a side against a
        // neighbouring wall is covered by it. The underside stays wherever
        // nothing stands beneath: that is the ceiling of the room below.
        const stackHere = mapData ? this.piecesAt(mapData, piece.x, piece.y) : null;
        const enclosed = !!stackHere && stackHere.some(other => (other.kind === "wall" || other.kind === "block") && other.z === piece.z);
        const covered = (x, y) => {
            const stack = mapData ? this.piecesAt(mapData, x, y) : null;
            return !!stack && stack.some(other => other.z === piece.z && (other.kind === "floor" || other.kind === "wall" || other.kind === "block"));
        };
        return {
            east: enclosed || (level(piece.x + 1, piece.y) && covered(piece.x + 1, piece.y)),
            west: enclosed || (level(piece.x - 1, piece.y) && covered(piece.x - 1, piece.y)),
            south: enclosed || (level(piece.x, piece.y + 1) && covered(piece.x, piece.y + 1)),
            north: enclosed || (level(piece.x, piece.y - 1) && covered(piece.x, piece.y - 1)),
            top: enclosed,
            bottom: piece.z === 0 || stoneAt(piece.x, piece.y, piece.z - 1, 1) || stoneAt(piece.x, piece.y, piece.z - this.PIECE_STOREY, this.PIECE_STOREY)
        };
    }
    // Rotation does not change a cube, so the faces are named in world terms and the cube is emitted unturned.
    return {
        east: level(piece.x + 1, piece.y) && solidAt(piece.x + 1, piece.y, piece.z, height),
        west: level(piece.x - 1, piece.y) && solidAt(piece.x - 1, piece.y, piece.z, height),
        south: level(piece.x, piece.y + 1) && solidAt(piece.x, piece.y + 1, piece.z, height),
        north: level(piece.x, piece.y - 1) && solidAt(piece.x, piece.y - 1, piece.z, height),
        top: stoneAt(piece.x, piece.y, piece.z + height, 1) || stoneAt(piece.x, piece.y, piece.z + height, this.PIECE_STOREY),
        // The bottom stays on the ground too: it is what a cut wall shows from above, else the ground.
        bottom: stoneAt(piece.x, piece.y, piece.z - 1, 1) || stoneAt(piece.x, piece.y, piece.z - this.PIECE_STOREY, this.PIECE_STOREY)
    };
};

/** A geometry of the given pieces, each on its own cell's ground. */
Reactor3D.pieceGeometry = function(pieces, mapData) {
    const out = { positions: [], uvs: [], colors: [] };
    const index = mapData ? this.pieceIndex(mapData) : null;
    // Rocks are one mass, meshed together over their own bounds (a chunk lays its own, see layRockChunks).
    const rocks = pieces.filter(piece => piece.kind === "rock");
    if (rocks.length) {
        const frames = rocks.map(piece => this.rockFrame(piece, mapData ? this.pieceBaseAt(mapData, piece.x, piece.y) : 0));
        const box = frames.reduce((b, f) => ({ x0: Math.min(b.x0, f.min[0]), z0: Math.min(b.z0, f.min[2]), x1: Math.max(b.x1, f.max[0]), z1: Math.max(b.z1, f.max[2]) }), { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity });
        this.rockMesh(frames, { x0: Math.floor(box.x0), z0: Math.floor(box.z0), x1: Math.ceil(box.x1), z1: Math.ceil(box.z1) }, () => out);
        pieces = pieces.filter(piece => piece.kind !== "rock");
    }
    for (let piece of pieces) {
        const base = mapData ? this.pieceBaseAt(mapData, piece.x, piece.y) : 0;
        // A ladder level beside another (same turn, same level): the two draw as one wide ladder.
        if (piece.kind === "ladder" && index) {
            const join = {};
            for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const local = this.pieceLocal(piece, 0.5 + ox, 0.5 + oy);
                if (Math.abs(local.u - 0.5) < 0.9) continue; // along the climb, not beside it
                const stack = index.cells.get((piece.y + oy) * 65536 + piece.x + ox) || [];
                if (stack.some(other => other.kind === "ladder" && other.rot === piece.rot && other.z === piece.z)) join[local.u > 0.5 ? "hi" : "lo"] = true;
            }
            if (join.lo || join.hi) piece = Object.assign({}, piece, { ladderJoin: join });
        }
        // A raised stair's support stops on the highest piece top under it in its cell.
        if (piece.kind === "stair" && piece.z > 0 && index) {
            const stack = index.cells.get(piece.y * 65536 + piece.x) || [];
            let top = 0;
            for (const other of stack) {
                if (other === piece || other.id === piece.id || other.kind === "ladder" || other.z >= piece.z) continue;
                top = Math.max(top, Math.min(piece.z, this.pieceTop(other, 0.5, 0.5)));
            }
            if (top > 0) piece = Object.assign({}, piece, { supportTop: top });
        }
        const hidden = this.hiddenFacesOf(piece, mapData);
        const from = out.positions.length;
        this.emitPiece(hidden ? Object.assign({}, piece, { rot: 0 }) : piece, base, out, hidden);
        // A ladder's level as drawn: narrowed across its cell (`span`), cut short (`rise`), shifted over (`offset`).
        if (piece.kind === "ladder" && (piece.offset || piece.span || piece.rise)) {
            const [ax, ay] = this.stairAxis(piece.rot), lx = -ay, lz = ax;
            const cx = piece.x + 0.5, cz = piece.y + 0.5, narrow = (piece.span || 1) - 1;
            const [ox, oz] = piece.offset || [0, 0];
            let bottom = Infinity;
            for (let i = from + 1; i < out.positions.length; i += 3) bottom = Math.min(bottom, out.positions[i]);
            for (let i = from; i < out.positions.length; i += 3) {
                const across = ((out.positions[i] - cx) * lx + (out.positions[i + 2] - cz) * lz) * narrow;
                out.positions[i] += lx * across + ox;
                out.positions[i + 2] += lz * across + oz;
                if (piece.rise) out.positions[i + 1] = bottom + (out.positions[i + 1] - bottom) * piece.rise;
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out.positions), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.uvs), 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.colors), 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
};

//-----------------------------------------------------------------------------
// Rocks
//
// A rock is a shape piece (`kind: "rock"`, a box of its `size`, turned and
// placed like any shape) that is never drawn as a box. Every rock of the map
// is one field of rounded boxes, melted together where they meet and made
// craggy by a noise fixed to the world, and meshed a chunk at a time: rocks
// laid side by side and stacked are one cliff, and the chunk edges never
// show. `rough` (0-1) is how craggy. A rock is stood on and blocks where it
// is drawn (rockColumns); selection and plans use the box of its size.

/** The mesh grid, in tiles. */
Reactor3D.ROCK_STEP = 0.5;
/** How far neighbouring rocks melt into one another, in tiles. */
Reactor3D.ROCK_BLEND = 1.6;
/** How far a rock standing on the ground reaches down into it, so no bump lifts its foot off a slope. */
Reactor3D.ROCK_SINK = 1;
/** How far the world bends under a rock's outline, in tiles. */
Reactor3D.ROCK_WARP = 1.4;
/** Tiles per repeat of a rock's material image, and of its top's. */
Reactor3D.ROCK_UV = 5;
Reactor3D.ROCK_CAP_UV = 3;
/** The cap that wears the map's own floor (the room's floor image, at its own scale). */
Reactor3D.ROCK_GROUND = "ground";
/** The gap under a rock a character walks into: its own height (three tiles); a lower gap is solid rock. */
Reactor3D.ROCK_HEADROOM = 3;

/** Smooth value noise fixed to the world, about -1..1; three octaves, or one for a slow bend. */
// The noise's lattice: a whole-number corner hashed to 0..1, and one octave smoothly between corners.
// Plain functions of the closure, so a mesh's hundreds of thousands of samples make no garbage.
const rockHash = (i, j, k) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2147483587);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const rockOctave = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const a0 = rockHash(ix, iy, iz), a1 = rockHash(ix + 1, iy, iz), b0 = rockHash(ix, iy + 1, iz), b1 = rockHash(ix + 1, iy + 1, iz);
    const c0 = rockHash(ix, iy, iz + 1), c1 = rockHash(ix + 1, iy, iz + 1), d0 = rockHash(ix, iy + 1, iz + 1), d1 = rockHash(ix + 1, iy + 1, iz + 1);
    const x00 = a0 + (a1 - a0) * ux, x10 = b0 + (b1 - b0) * ux, x01 = c0 + (c1 - c0) * ux, x11 = d0 + (d1 - d0) * ux;
    const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
    return (y0 + (y1 - y0) * uz) * 2 - 1;
};
Reactor3D.rockNoise = function(x, y, z, octaves) {
    if (octaves === 1) return rockOctave(x, y, z);
    return rockOctave(x, y, z) * 0.57 + rockOctave(x * 2.03 + 17.1, y * 2.03 + 3.7, z * 2.03 + 9.2) * 0.29 + rockOctave(x * 4.11 + 5.3, y * 4.11 + 11.9, z * 4.11 + 1.3) * 0.14;
};

/** A rock's rounded box, as a signed distance from a world point (no bend, no noise). */
const rockBoxDistance = (f, x, y, z) => {
    const px = x - f.c[0], py = y - f.c[1], pz = z - f.c[2], r = f.round, a = f.axes;
    const qx = Math.abs(px * a[0][0] + py * a[0][1] + pz * a[0][2]) - (f.half[0] - r);
    const qy = Math.abs(px * a[1][0] + py * a[1][1] + pz * a[1][2]) - (f.half[1] - r);
    const qz = Math.abs(px * a[2][0] + py * a[2][1] + pz * a[2][2]) - (f.half[2] - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};

/**
 * A rock as the field reads it: its middle, its three axes (unit vectors),
 * its half size along them, how round its edges are and how rough it is,
 * and the world box it can reach. A rock on the ground (under a quarter
 * tile up, not tilted) reaches `ROCK_SINK` further down.
 */
Reactor3D.rockFrame = function(piece, base) {
    const at = this.shapePlacer(piece, base);
    const c = at(0.5, 0.5, 0.5);
    const axis = (u, y, v) => { const p = at(u, y, v); return [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; };
    const ex = axis(1, 0.5, 0.5), ey = axis(0.5, 1, 0.5), ez = axis(0.5, 0.5, 1);
    const half = [Math.hypot(...ex), Math.hypot(...ey), Math.hypot(...ez)];
    const unit = (v, n) => n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
    const axes = [unit(ex, half[0]), unit(ey, half[1]), unit(ez, half[2])];
    const sink = (Number(piece.z) || 0) < 0.25 && !this.shapeTurned(piece) ? this.ROCK_SINK : 0;
    if (sink) { c[1] -= sink / 2; half[1] += sink / 2; }
    const rough = Number.isFinite(Number(piece.rough)) ? Math.max(0, Math.min(1, Number(piece.rough))) : this.SHAPE_PARAMS.rock.rough;
    const round = Math.min(0.3, Math.min(half[0], half[1], half[2]) * 0.5);
    const amp = 0.3 + 1.1 * rough;
    const reach = [0, 1, 2].map(i => Math.abs(axes[0][i]) * half[0] + Math.abs(axes[1][i]) * half[1] + Math.abs(axes[2][i]) * half[2]);
    const pad = amp + this.ROCK_BLEND + this.ROCK_WARP;
    const tint = piece.tint ? [1, 3, 5].map(i => parseInt(piece.tint.slice(i, i + 2), 16) / 255) : null;
    // The bend where the rock stands: taken off its reading, so the bend shapes its outline and never
    // moves the rock itself away from where it was laid (up to a tile and a half, otherwise).
    const W = this.ROCK_WARP;
    const warp = [W * this.rockNoise(c[0] * 0.16 + 3.1, c[1] * 0.1, c[2] * 0.16, 1), W * 0.3 * this.rockNoise(c[0] * 0.2 + 11, c[1] * 0.2, c[2] * 0.2 + 2, 1), W * this.rockNoise(c[0] * 0.16, c[1] * 0.1 + 5.7, c[2] * 0.16 + 8.3, 1)];
    return {
        piece, c, axes, half, round, rough, amp, tint, warp, top: c[1] + half[1] * Math.abs(axes[1][1]),
        min: [c[0] - reach[0] - pad, c[1] - reach[1] - pad, c[2] - reach[2] - pad],
        max: [c[0] + reach[0] + pad, c[1] + reach[1] + pad, c[2] + reach[2] + pad]
    };
};

/**
 * The rock field at a world point: negative inside. `near` receives the
 * index of the rock that decides the point (its material and roughness).
 */
Reactor3D.rockField = function(frames, x, y, z, near) {
    const k = this.ROCK_BLEND;
    // Nowhere near a rock (most of a chunk's grid): nothing to bend or roughen. Far outside
    // every rock, or deep in one, only the side of the surface matters to the mesh: the plain
    // boxes say it, past the most the bend, the blend and the noise could move it.
    let plain = Infinity, amp = 0, closest = -1;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (x < f.min[0] || x > f.max[0] || y < f.min[1] || y > f.max[1] || z < f.min[2] || z > f.max[2]) continue;
        const di = rockBoxDistance(f, x, y, z);
        if (di < plain) { plain = di; closest = i; }
        if (f.amp > amp) amp = f.amp;
    }
    if (closest < 0) return 1e3;
    const margin = 1.6 * this.ROCK_WARP + amp + k * 0.25 + 0.3;
    if (plain > margin || plain < -margin) { if (near) near.index = closest; return plain; }
    // The boxes are read through a slow bend of the world, across more than up, so a row of
    // them is an outcrop and not a wall of bricks; the tops stay level.
    const W = this.ROCK_WARP;
    const wx = x + W * this.rockNoise(x * 0.16 + 3.1, y * 0.1, z * 0.16, 1), wz = z + W * this.rockNoise(x * 0.16, y * 0.1 + 5.7, z * 0.16 + 8.3, 1);
    const wy = y + W * 0.3 * this.rockNoise(x * 0.2 + 11, y * 0.2, z * 0.2 + 2, 1);
    x = wx; z = wz; const yy = wy;
    let d = Infinity, best = -1, bestD = Infinity;
    for (let i = 0; i < frames.length; i++) {
        const f = frames[i];
        if (x < f.min[0] || x > f.max[0] || yy < f.min[1] || yy > f.max[1] || z < f.min[2] || z > f.max[2]) continue;
        const di = rockBoxDistance(f, x - f.warp[0], yy - f.warp[1], z - f.warp[2]);
        if (di < bestD) { bestD = di; best = i; }
        if (d === Infinity) d = di;
        else { const h = Math.max(k - Math.abs(d - di), 0) / k; d = Math.min(d, di) - h * h * k * 0.25; }
    }
    if (best < 0) return 1e3;
    if (near) near.index = best;
    const f = frames[best];
    // Craggy sides, a nearly flat top: the noise fades over the top tile of a rock.
    const fromTop = f.top - y;
    const craggy = fromTop >= 1.5 ? 1 : 0.2 + 0.8 * Math.max(0, fromTop) / 1.5;
    // Broad lumps, sharp ridges (the folded noise creases), and ledges: every band of
    // height (wandering a little) is cut back toward its top, so a cliff steps.
    const lumps = this.rockNoise(x * 0.22, y * 0.4, z * 0.22);
    const ridges = 0.5 - Math.abs(this.rockNoise(x * 0.75 + 31, y * 1.1, z * 0.75 + 17));
    const band = y * 0.55 + 0.7 * this.rockNoise(x * 0.12 + 7, 0, z * 0.12 + 3, 1);
    const cut = band - Math.floor(band);
    const ledge = cut > 0.72 ? (cut - 0.72) / 0.28 : 0;
    return d + f.amp * craggy * (0.8 * lumps + 0.8 * ridges + 0.6 * ledge * ledge);
};

/**
 * Mesh the rocks `frames` inside the world box {x0, z0, x1, z1} (whole
 * tiles, x1 and z1 exclusive) by surface nets on the ROCK_STEP grid. Each
 * face goes into `bucketFor(frame, capped)`'s arrays (positions, uvs,
 * colors), so a chunk can split them by material and cap. Faces are owned by the box they start
 * in, so boxes side by side mesh one seamless surface. With `groundFloor` (rockGroundFloor), a
 * face lower than the ground of every cell it spans is left out: a rock's foot reaches a tile into it.
 */
Reactor3D.rockMesh = function(frames, box, bucketFor, groundFloor) {
    if (!frames.length) return;
    const s = this.ROCK_STEP;
    const live = frames.filter(f => f.max[0] >= box.x0 - 1 && f.min[0] <= box.x1 + 1 && f.max[2] >= box.z0 - 1 && f.min[2] <= box.z1 + 1);
    if (!live.length) return;
    const ylo = Math.floor(Math.min(...live.map(f => f.min[1])) / s) * s - s, yhi = Math.ceil(Math.max(...live.map(f => f.max[1])) / s) * s + s;
    const nx = Math.round((box.x1 - box.x0) / s), nz = Math.round((box.z1 - box.z0) / s), ny = Math.round((yhi - ylo) / s);
    // Grid points from one step before the box to two after it: the cubes either side of every owned edge.
    const X = nx + 3, Y = ny + 1, Z = nz + 3;
    const gx = i => box.x0 + (i - 1) * s, gy = j => ylo + j * s, gz = k => box.z0 + (k - 1) * s;
    const values = new Float32Array(X * Y * Z), owner = new Int16Array(X * Y * Z);
    const near = { index: -1 };
    // The rocks each column of the grid can meet (with room for a crack's look along a slope):
    // a sample weighs those, not every rock of the chunk.
    live.forEach((f, i) => { f.live = i; });
    const reachOf = new Array(X * Z);
    for (let k = 0; k < Z; k++) for (let i = 0; i < X; i++) {
        const x = gx(i), z = gz(k);
        reachOf[k * X + i] = live.filter(f => x >= f.min[0] - 2 && x <= f.max[0] + 2 && z >= f.min[2] - 2 && z <= f.max[2] + 2);
    }
    let any = false;
    for (let k = 0; k < Z; k++) for (let i = 0; i < X; i++) {
        const column = reachOf[k * X + i];
        for (let j = 0; j < Y; j++) {
            const at = (k * Y + j) * X + i;
            if (!column.length) { values[at] = 1e3; owner[at] = -1; continue; }
            near.index = -1;
            const v = this.rockField(column, gx(i), gy(j), gz(k), near);
            values[at] = v; owner[at] = near.index >= 0 ? column[near.index].live : -1;
            if (v < 0) any = true;
        }
    }
    if (!any) return;
    const id = (i, j, k) => (k * Y + j) * X + i;
    // One vertex per cube the surface crosses: where its crossing edges meet, on average.
    const cubeVertex = new Int32Array((X - 1) * (Y - 1) * (Z - 1)).fill(-1);
    const verts = [];
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const v = new Float64Array(8);
    const vertexOf = (i, j, k) => {
        const key = (k * (Y - 1) + j) * (X - 1) + i;
        if (cubeVertex[key] >= 0) return cubeVertex[key];
        for (let c = 0; c < 8; c++) v[c] = values[id(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))];
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of edges) {
            if ((v[a] < 0) === (v[b] < 0)) continue;
            const t = v[a] / (v[a] - v[b]);
            const pa = corners[a], pb = corners[b];
            sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t; n++;
        }
        const p = [gx(i) + (sx / n) * s, gy(j) + (sy / n) * s, gz(k) + (sz / n) * s];
        // Its shade: darker in a crack (how open the field is along its slope, read off the
        // cube's own corners), a little mottled.
        const gxv = v[1] - v[0] + v[3] - v[2] + v[5] - v[4] + v[7] - v[6];
        const gyv = v[2] - v[0] + v[3] - v[1] + v[6] - v[4] + v[7] - v[5];
        const gzv = v[4] - v[0] + v[5] - v[1] + v[6] - v[2] + v[7] - v[3];
        const gl = Math.hypot(gxv, gyv, gzv) || 1;
        const nrm = [gxv / gl, gyv / gl, gzv / gl];
        const column = reachOf[k * X + i];
        const open1 = this.rockField(column, p[0] + nrm[0] * 0.6, p[1] + nrm[1] * 0.6, p[2] + nrm[2] * 0.6) / 0.6;
        const open2 = this.rockField(column, p[0] + nrm[0] * 1.5, p[1] + nrm[1] * 1.5, p[2] + nrm[2] * 1.5) / 1.5;
        const ao = Math.max(0.45, Math.min(1, 0.4 + 0.6 * (Math.max(0, open1) + Math.max(0, open2)) / 2));
        const mottle = 0.9 + 0.1 * rockOctave(p[0] * 1.7 + 40, p[1] * 1.7, p[2] * 1.7);
        verts.push({ p, n: nrm, shade: Math.min(1, ao * mottle) });
        cubeVertex[key] = verts.length - 1;
        return verts.length - 1;
    };
    // Each face lit by its own facing, as a cut stone is: tops bright, overhangs dark, the sides by their turn.
    // A face turned up far enough wears the rock's cap (the edge wanders, so a top is not cut
    // square), mapped from above; a rock's tint colours the rest.
    const tri = (frame, a, b, c) => {
        if (groundFloor) {
            // Under the ground of every cell the face spans: never seen.
            const top = Math.max(a.p[1], b.p[1], c.p[1]) + 0.05;
            let under = true;
            const x1 = Math.floor(Math.max(a.p[0], b.p[0], c.p[0])), z1 = Math.floor(Math.max(a.p[2], b.p[2], c.p[2]));
            for (let cz = Math.floor(Math.min(a.p[2], b.p[2], c.p[2])); under && cz <= z1; cz++) {
                for (let cx = Math.floor(Math.min(a.p[0], b.p[0], c.p[0])); under && cx <= x1; cx++) if (!(top < groundFloor(cx, cz))) under = false;
            }
            if (under) return;
        }
        const ux = b.p[0] - a.p[0], uy = b.p[1] - a.p[1], uz = b.p[2] - a.p[2];
        const vx = c.p[0] - a.p[0], vy = c.p[1] - a.p[1], vz = c.p[2] - a.p[2];
        let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        // A face folded over at a crease looks the other way from the field's slope at its
        // corners: turned back, it is lit and wound as the surface round it.
        if (cx * (a.n[0] + b.n[0] + c.n[0]) + cy * (a.n[1] + b.n[1] + c.n[1]) + cz * (a.n[2] + b.n[2] + c.n[2]) < 0) { const t = b; b = c; c = t; cx = -cx; cy = -cy; cz = -cz; }
        const nx = Math.abs(cx), ny = Math.abs(cy), nz = Math.abs(cz);
        const len = Math.hypot(cx, cy, cz) || 1;
        // Lit half by its own facing (the cut look) and half by the surface round it, so a sliver
        // at a crease takes the light of its neighbours instead of going black.
        const sx = cx / len + (a.n[0] + b.n[0] + c.n[0]) / 3, sy = cy / len + (a.n[1] + b.n[1] + c.n[1]) / 3, sz = cz / len + (a.n[2] + b.n[2] + c.n[2]) / 3;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const fx = sx / sl, fy = sy / sl, fz = sz / sl;
        const side = 0.6 + 0.2 * (fx * 0.5 + 0.5) + 0.12 * (fz * 0.5 + 0.5);
        const facing = fy > 0 ? side + (1 - side) * Math.min(1, fy * 1.25) : side * (1 + 0.5 * fy);
        // Near a rock's top it wears the cap wherever it faces up; lower down, only a ledge that
        // faces nearly straight up does, so a craggy side is not speckled with it.
        const my = (a.p[1] + b.p[1] + c.p[1]) / 3;
        const edge = 0.22 * rockOctave((a.p[0] + b.p[0] + c.p[0]) * 0.2, my * 0.6, (a.p[2] + b.p[2] + c.p[2]) * 0.2);
        const capped = !!frame.piece.cap && fy > (frame.top - my < 1.5 ? 0.5 : 0.86) + edge;
        const bucket = bucketFor(frame, capped);
        const U = capped ? (frame.piece.cap === this.ROCK_GROUND ? 1 : this.ROCK_CAP_UV) : this.ROCK_UV;
        const tint = !capped && frame.tint;
        for (const q of [a, b, c]) {
            bucket.positions.push(q.p[0], q.p[1], q.p[2]);
            if (capped || (ny >= nx && ny >= nz)) bucket.uvs.push(q.p[0] / U, q.p[2] / U);
            else if (nx >= nz) bucket.uvs.push(q.p[2] / U, q.p[1] / U);
            else bucket.uvs.push(q.p[0] / U, q.p[1] / U);
            const shade = Math.max(0.3, Math.min(1, q.shade * facing));
            if (tint) bucket.colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
            else bucket.colors.push(shade, shade, shade);
            if (bucket.normals) bucket.normals.push(q.n[0], q.n[1], q.n[2]);
        }
    };
    // A face for every owned grid edge the surface crosses, joining the four cubes round it,
    // wound to face out of the rock.
    for (let k = 1; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
        const here = values[id(i, j, k)];
        for (let axis = 0; axis < 3; axis++) {
            const ni = i + (axis === 0), nj = j + (axis === 1), nk = k + (axis === 2);
            // Owned by this box: an edge starting inside it across the ground; every height is this box's.
            if (i > nx || k > nz) continue;
            const there = values[id(ni, nj, nk)];
            if ((here < 0) === (there < 0)) continue;
            // The four cubes sharing this edge, round the two other axes.
            const [a1, a2] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
            const cube = (d1, d2) => { const o = [i, j, k]; o[a1] -= d1; o[a2] -= d2; return o; };
            const quad = [cube(1, 1), cube(0, 1), cube(0, 0), cube(1, 0)];
            if (quad.some(([ci, cj, ck]) => ci < 0 || cj < 0 || ck < 0 || ci >= X - 1 || cj >= Y - 1 || ck >= Z - 1)) continue;
            const v = quad.map(([ci, cj, ck]) => verts[vertexOf(ci, cj, ck)]);
            const inside = here < 0 ? id(i, j, k) : id(ni, nj, nk);
            const frame = live[Math.max(0, owner[inside])];
            // The quad faces the way out of the rock across its edge; both halves turn together.
            const d1 = [v[2].p[0] - v[0].p[0], v[2].p[1] - v[0].p[1], v[2].p[2] - v[0].p[2]], d2 = [v[3].p[0] - v[1].p[0], v[3].p[1] - v[1].p[1], v[3].p[2] - v[1].p[2]];
            const facing = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]][axis] * (here < 0 ? 1 : -1);
            if (facing >= 0) { tri(frame, v[0], v[1], v[2]); tri(frame, v[0], v[2], v[3]); }
            else { tri(frame, v[0], v[2], v[1]); tri(frame, v[0], v[3], v[2]); }
        }
    }
};

/**
 * A material whose image is laid from all three sides by world position and
 * blended by the surface's facing, `tiles` world tiles to a repeat: a rock's
 * crags turn every way, and a face's own projection jumped between neighbours.
 */
Reactor3D.triplanarMaterial = function(material, tiles) {
    if (!material || material.__reactorTriplanar) return material;
    material.__reactorTriplanar = 1 / (tiles || 1);
    const earlier = material.onBeforeCompile;
    material.onBeforeCompile = function(shader, renderer) {
        if (typeof earlier === "function") earlier.call(this, shader, renderer);
        shader.uniforms.rrTriScale = this.__rrTriScale || (this.__rrTriScale = { value: this.__reactorTriplanar });
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vRRTriPos;\nvarying vec3 vRRTriNormal;")
            .replace("#include <project_vertex>", "#include <project_vertex>\nvRRTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRRTriNormal = normalize(mat3(modelMatrix) * normal);");
        shader.fragmentShader = shader.fragmentShader
            .replace("#include <common>", "#include <common>\nvarying vec3 vRRTriPos;\nvarying vec3 vRRTriNormal;\nuniform float rrTriScale;")
            .replace("#include <map_fragment>", [
                "#ifdef USE_MAP",
                "\tvec3 rrTriW = pow(abs(normalize(vRRTriNormal)), vec3(4.0));",
                "\trrTriW /= max(rrTriW.x + rrTriW.y + rrTriW.z, 1e-4);",
                "\tvec4 sampledDiffuseColor = texture2D(map, vRRTriPos.zy * rrTriScale) * rrTriW.x + texture2D(map, vRRTriPos.xz * rrTriScale) * rrTriW.y + texture2D(map, vRRTriPos.xy * rrTriScale) * rrTriW.z;",
                "\tdiffuseColor *= sampledDiffuseColor;",
                "#endif"
            ].join("\n"));
    };
    const earlierKey = material.customProgramCacheKey;
    material.customProgramCacheKey = function() { return (typeof earlierKey === "function" ? earlierKey.call(this) : "") + "|triplanar"; };
    return material;
};

/**
 * The lowest the drawn ground goes in a cell (x, y): the least of its four corners plus its
 * elevation, however the cell's ground is cut into triangles. Off the map there is no ground to
 * hide anything: -Infinity.
 */
Reactor3D.rockGroundFloor = function(mapData) {
    if (!mapData || !(mapData.width > 0) || !(mapData.height > 0)) return null;
    const W = mapData.width, H = mapData.height, grid = this.terrainOf(mapData);
    const cellMin = new Float64Array(W * H).fill(NaN);
    const corner = (x, y) => (grid ? Number(grid[y * (W + 1) + x]) || 0 : 0);
    return (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return -Infinity;
        const i = y * W + x;
        if (Number.isNaN(cellMin[i])) cellMin[i] = this.elevationAt(mapData, x, y) + Math.min(corner(x, y), corner(x + 1, y), corner(x, y + 1), corner(x + 1, y + 1));
        return cellMin[i];
    };
};

/** A rock as a key: where it stands and what shapes it, its ground included. */
Reactor3D.rockSignature = function(f) {
    return f.sig || (f.sig = JSON.stringify([f.piece.x, f.piece.y, f.piece.z, f.piece.size, f.piece.angle, f.piece.tilt, f.piece.roll, f.piece.offset, f.piece.rough, f.piece.material, f.piece.finish, f.piece.surface, f.piece.cap, f.piece.tint, f.c[1]]));
};

/**
 * Where the rocks stand, cell by cell, as the rock is drawn: at each cell's
 * middle, the top of the rock mass there (found from above, then halved in)
 * and how far down it goes before it opens, so a party stands on the rock it
 * sees, is stopped by a bulge past a rock's box, and walks under an arch.
 * Each entry is {x, y, piece (the rock whose surface it is), top (over that
 * rock's own ground, as a shape's top is), z (the mass's foot over the
 * cell's ground; 0 when it reaches the ground)}. Measured a chunk at a time
 * and kept by the rocks that reach it, so an edit measures only its chunks.
 */
Reactor3D.rockColumns = function(mapData, rocks) {
    const frames = rocks.map(piece => this.rockFrame(piece, this.pieceBaseAt(mapData, piece.x, piece.y)));
    const size = this.PIECE_CHUNK, W = mapData ? mapData.width : Infinity, H = mapData ? mapData.height : Infinity;
    const cache = this._rockColumnCache || (this._rockColumnCache = new Map());
    if (cache.size > 4096) cache.clear();
    const keys = new Set();
    for (const f of frames) {
        for (let cy = Math.floor(Math.max(0, f.min[2]) / size); cy <= Math.floor(Math.max(0, f.max[2]) / size); cy++) {
            for (let cx = Math.floor(Math.max(0, f.min[0]) / size); cx <= Math.floor(Math.max(0, f.max[0]) / size); cx++) keys.add(cx * 65536 + cy);
        }
    }
    const out = [];
    const near = { index: -1 };
    for (const key of keys) {
        const kx = Math.floor(key / 65536), ky = key % 65536;
        const box = { x0: kx * size, z0: ky * size, x1: kx * size + size, z1: ky * size + size };
        const reaching = frames.filter(f => f.max[0] >= box.x0 && f.min[0] <= box.x1 && f.max[2] >= box.z0 && f.min[2] <= box.z1);
        const sig = (mapData && mapData.id) + "|" + reaching.map(f => this.rockSignature(f)).sort().join("|");
        const known = cache.get(key);
        if (known && known.sig === sig) { for (const c of known.columns) out.push(Object.assign({}, c, { piece: reaching[c.owner].piece })); continue; }
        const columns = [];
        for (let y = box.z0; y < Math.min(box.z1, H); y++) for (let x = box.x0; x < Math.min(box.x1, W); x++) {
            const cx = x + 0.5, cz = y + 0.5;
            const here = reaching.filter(f => cx >= f.min[0] && cx <= f.max[0] && cz >= f.min[2] && cz <= f.max[2]);
            if (!here.length) continue;
            let hi = -Infinity, lo = Infinity;
            for (const f of here) { hi = Math.max(hi, f.max[1]); lo = Math.min(lo, f.min[1]); }
            let inside = null, outside = hi;
            for (let wy = hi; wy >= lo; wy -= 0.5) { if (this.rockField(here, cx, wy, cz) < 0) { inside = wy; break; } outside = wy; }
            if (inside === null) continue;
            for (let i = 0; i < 6; i++) { const m = (inside + outside) / 2; if (this.rockField(here, cx, m, cz) < 0) inside = m; else outside = m; }
            const top = inside;
            let foot = top;
            for (let wy = top - 0.5; wy >= lo; wy -= 0.5) { if (this.rockField(here, cx, wy, cz) >= 0) break; foot = wy; }
            near.index = -1;
            this.rockField(here, cx, top - 0.05, cz, near);
            const owner = here[Math.max(0, near.index)];
            const cellBase = mapData ? this.pieceBaseAt(mapData, x, y) : 0;
            const anchorBase = mapData ? this.pieceBaseAt(mapData, owner.piece.x, owner.piece.y) : 0;
            // A gap under the mass too low for a character to walk into is rock down to the ground.
            columns.push({ x, y, owner: reaching.indexOf(owner), top: Math.round((top - anchorBase) * 100) / 100, z: foot < cellBase + this.ROCK_HEADROOM ? 0 : Math.round((foot - cellBase) * 100) / 100 });
        }
        cache.set(key, { sig, columns });
        for (const c of columns) out.push(Object.assign({}, c, { piece: reaching[c.owner].piece }));
    }
    return out;
};

/** Whether a map has any rock. */
Reactor3D.hasRocks = function(mapData) {
    return this.piecesOf(mapData).some(piece => piece.kind === "rock");
};

Reactor3D.defaultMaterialLoader = function(name) {
    if (!name || typeof ImageManager === "undefined" || !ImageManager || typeof ImageManager.loadBitmap !== "function") return null;
    // A `…Glow` material needs no image: one that is not there shines its own colour instead of stopping the game.
    if (this.materialLook(name).glow && typeof this.materialFileExists === "function" && !this.materialFileExists(name)) return null;
    return ImageManager.loadBitmap("img/materials/", name);
};

/** The group the pieces stand in: part of the world, drawn with the ground pass. */
Reactor3D.MapScene.prototype.piecesGroup = function() {
    if (!this._piecesGroup) {
        this._piecesGroup = new THREE.Group();
        this._piecesGroup.name = "pieces";
        this._scene.add(this._piecesGroup);
    }
    return this._piecesGroup;
};

/**
 * A material's texture, repeating, made once per scene. A bitmap still
 * loading (the game's ImageManager hands those out) fills the texture when
 * it arrives; the wall is drawn plain until then and textured a frame later.
 */
Reactor3D.MapScene.prototype.materialTexture = function(name, load) {
    if (!name) return null;
    if (!this._materialTextures) this._materialTextures = {};
    if (this._materialTextures[name] !== undefined) return this._materialTextures[name];
    let bitmap = null;
    try { bitmap = typeof load === "function" ? load(name) : null; } catch (error) { bitmap = null; }
    if (!bitmap) { this._materialTextures[name] = null; return null; }
    const texture = new THREE.Texture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    const fill = () => {
        const source = bitmap.image || bitmap.canvas;
        if (!source) return;
        texture.image = source;
        // A rock's "ground" cap is mapped in tiles: its image repeats at the room floor's scale.
        if (name === Reactor3D.ROCK_GROUND && this._roomFloor) texture.repeat.set(48 / (source.width || 48), 48 / (source.height || 48));
        texture.needsUpdate = true;
    };
    if (bitmap.isReady && !bitmap.isReady()) {
        if (typeof bitmap.addLoadListener === "function") bitmap.addLoadListener(fill);
    } else {
        fill();
    }
    this._textures.push(texture);
    this._materialTextures[name] = texture;
    return texture;
};

/**
 * A material's companions beside its image under img/materials, each optional:
 * `<Name>_normal.png` (a normal map, OpenGL convention: green up),
 * `<Name>_rough.png` (roughness, white rough, read from red) and `<Name>.json`
 * (`{ "scale", "gloss", "reflect", "normalStrength" }`, see
 * normalizeMaterialSettings). With either map the surface takes its relief
 * from the key light (the map's sun, else a light from above) and a modest
 * sheen where it is smooth, pixel by pixel; with neither it draws as before.
 * The two maps are packed into one texture (normal in rgb, roughness in a).
 */
Reactor3D.MATERIAL_DETAIL = true;
Reactor3D.MATERIAL_NORMAL = "_normal";
Reactor3D.MATERIAL_ROUGH = "_rough";
/** The largest side a packed normal and roughness texture keeps, by GPU tier. */
Reactor3D.MATERIAL_DETAIL_SIZE = { full: 1024, weak: 512 };

/** Whether an image under img/materials is another material's normal or roughness map, not a material. */
Reactor3D.isMaterialCompanion = function(name) {
    return /_(normal|rough)$/i.test(String(name || ""));
};

/**
 * A material's settings, each kept in range: `scale` the tiles one repeat of its
 * image covers (null: a box piece's one per tile, a rock's ROCK_UV), `gloss` how
 * smooth its smoothest parts are (0 matte, 1 polished), `reflect` how much sky
 * a smooth part mirrors at a glancing angle, `normalStrength` how deep the
 * normal map's relief reads.
 */
Reactor3D.normalizeMaterialSettings = function(raw) {
    const out = { scale: null, gloss: 0, reflect: 0.5, normalStrength: 1 };
    if (!raw || typeof raw !== "object") return out;
    const number = (value, min, max, fallback) => {
        const n = Number(value);
        return value === null || value === "" || !Number.isFinite(n) ? fallback : Math.max(min, Math.min(max, n));
    };
    const scale = Number(raw.scale);
    if (raw.scale !== null && raw.scale !== "" && Number.isFinite(scale) && scale > 0) out.scale = Math.max(0.25, Math.min(32, scale));
    out.gloss = number(raw.gloss, 0, 1, 0);
    out.reflect = number(raw.reflect, 0, 1, 0.5);
    out.normalStrength = number(raw.normalStrength, 0, 3, 1);
    return out;
};

/** Whether img/materials holds `<name>.json`, by disk or a web build's file index. */
Reactor3D.materialSettingsExist = function(name) {
    if (!name || typeof Utils === "undefined") return false;
    const file = "img/materials/" + name + ".json";
    try {
        if (Utils.isNwjs && Utils.isNwjs() && typeof require === "function") {
            const fs = require("fs"), path = require("path");
            return fs.existsSync(path.join(path.dirname(process.mainModule.filename), file)) || !!Utils.correctFileCase(file);
        }
        if (Utils.loadWebFileIndex) Utils.loadWebFileIndex();
        return !!Utils._webFileIndex && Utils._webFileIndex.has(file.toLowerCase());
    } catch (error) {
        return false;
    }
};

/** The game's reading of `<name>.json`: at once off disk, in a browser when it arrives; null when there is none. */
Reactor3D.readMaterialSettings = function(name, done) {
    if (!this.materialSettingsExist(name)) { done(null); return; }
    const file = "img/materials/" + name + ".json";
    try {
        if (Utils.isNwjs && Utils.isNwjs() && typeof require === "function") {
            const fs = require("fs"), path = require("path");
            const base = path.dirname(process.mainModule.filename);
            const full = fs.existsSync(path.join(base, file)) ? path.join(base, file) : path.join(base, Utils.correctFileCase(file));
            done(JSON.parse(fs.readFileSync(full, "utf8")));
            return;
        }
        fetch(file).then(response => (response.ok ? response.json() : null)).then(done, () => done(null));
    } catch (error) {
        console.warn(`Reactor3D: ${file} could not be read.`, error);
        done(null);
    }
};

/** A texture of no relief and no roughness: what a detail map shows until its own arrives. */
Reactor3D.neutralDetailTexture = function() {
    if (!this._neutralDetail) {
        this._neutralDetail = new THREE.DataTexture(new Uint8Array([128, 128, 255, 0]), 1, 1, THREE.RGBAFormat);
        this._neutralDetail.needsUpdate = true;
    }
    return this._neutralDetail;
};

/**
 * One texture of a normal map (rgb) and a roughness map (a, from its red), either
 * of which may be missing, at most `maxSize` on a side. Rows are stored bottom up,
 * so it lines up with the material's own image (three flips that one on upload).
 */
Reactor3D.packMaterialDetail = function(normal, rough, maxSize) {
    const source = normal || rough;
    if (!source || typeof document === "undefined" || !document) return null;
    const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
    if (!(width > 0) || !(height > 0)) return null;
    const fit = Math.min(1, (maxSize || 1024) / Math.max(width, height));
    const w = Math.max(1, Math.round(width * fit)), h = Math.max(1, Math.round(height * fit));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const read = image => {
        context.clearRect(0, 0, w, h);
        context.drawImage(image, 0, 0, w, h);
        return context.getImageData(0, 0, w, h).data;
    };
    const n = normal ? read(normal) : null, r = rough ? read(rough) : null;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
        const from = (h - 1 - y) * w * 4, to = y * w * 4;
        for (let x = 0; x < w * 4; x += 4) {
            data[to + x] = n ? n[from + x] : 128;
            data[to + x + 1] = n ? n[from + x + 1] : 128;
            data[to + x + 2] = n ? n[from + x + 2] : 255;
            data[to + x + 3] = r ? r[from + x] : 0;
        }
    }
    const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
};

/**
 * A material's detail, made once per scene: its packed maps (`map`, neutral until
 * they arrive), `params` (normal strength, gloss, reflect, 1 once the maps are in),
 * and the repeat of a box piece (`uvScale`) and of a rock (`triScale`) from its
 * settings. Null when the material has no companions. The game asks the disk
 * which companions exist (an image that is not there would stop it); the editor's
 * loader answers null for one it has not got.
 */
Reactor3D.MapScene.prototype.materialDetail = function(name, load) {
    if (!Reactor3D.MATERIAL_DETAIL || !name || name === Reactor3D.ROCK_GROUND || Reactor3D.isMaterialCompanion(name) || typeof THREE === "undefined") return null;
    if (!this._materialDetails) this._materialDetails = new Map();
    if (this._materialDetails.has(name)) return this._materialDetails.get(name);
    const probe = this._materialProbe;
    const companion = suffix => {
        if (probe && !probe(name + suffix)) return null;
        try { return typeof load === "function" ? load(name + suffix) || null : null; } catch (error) { return null; }
    };
    const normal = companion(Reactor3D.MATERIAL_NORMAL), rough = companion(Reactor3D.MATERIAL_ROUGH);
    const own = this._materialSettingsLoad;
    const settings = own ? own(name) : null;
    const pending = !own && Reactor3D.materialSettingsExist(name);
    if (!normal && !rough && !settings && !pending) { this._materialDetails.set(name, null); return null; }
    const detail = {
        name,
        maps: !!(normal || rough),
        map: { value: Reactor3D.neutralDetailTexture() },
        params: { value: new THREE.Vector4(1, 0, 0.5, 0) },
        uvScale: { value: 1 },
        triScale: { value: 1 / Reactor3D.ROCK_UV },
        settings: null
    };
    const apply = raw => {
        const s = detail.settings = Reactor3D.normalizeMaterialSettings(raw);
        detail.params.value.x = s.normalStrength;
        detail.params.value.y = s.gloss;
        detail.params.value.z = s.reflect;
        detail.uvScale.value = s.scale ? 1 / s.scale : 1;
        detail.triScale.value = 1 / (s.scale || Reactor3D.ROCK_UV);
    };
    apply(settings);
    const build = this._build;
    if (pending) Reactor3D.readMaterialSettings(name, raw => { if (raw && this._build === build) apply(raw); });
    if (detail.maps) {
        const bitmaps = [normal, rough].filter(Boolean);
        const imageOf = bitmap => (bitmap ? bitmap.image || bitmap.canvas || null : null);
        const pack = () => {
            if (this._build !== build || !bitmaps.every(b => !(b.isReady && !b.isReady()) && imageOf(b))) return;
            let texture = null;
            try {
                texture = Reactor3D.packMaterialDetail(imageOf(normal), imageOf(rough), Reactor3D.MATERIAL_DETAIL_SIZE[Reactor3D.isWeakGpu() ? "weak" : "full"]);
            } catch (error) {
                console.warn(`Reactor3D: the maps of material "${name}" could not be read.`, error);
            }
            if (!texture) return;
            this._textures.push(texture);
            detail.map.value = texture;
            detail.params.value.w = 1;
        };
        for (const bitmap of bitmaps) if (bitmap.isReady && !bitmap.isReady() && typeof bitmap.addLoadListener === "function") bitmap.addLoadListener(pack);
        pack();
    }
    this._materialDetails.set(name, detail);
    return detail;
};

/**
 * The detail stage's functions: a projection's normal-map texel laid onto the
 * surface (a whiteout blend; axis 0 lays the image by z and y, 1 by x and z, 2
 * by x and y, as the pieces' own mapping does), and the colour it gives: relief
 * against the key light, as the light on the bumps against the light on the
 * face, then where the surface is smooth a highlight and a glancing sheen of the
 * sky's colour. Before the light: the light multiplies all of it.
 */
Reactor3D.DETAIL_FUNCTIONS_GLSL = [
    "#ifndef RR_DETAIL_FUNCTIONS",
    "#define RR_DETAIL_FUNCTIONS",
    "vec3 rrDetailAxis(vec4 c, vec3 n, int axis, float strength) {",
    "\tvec3 t = c.xyz * 2.0 - 1.0;",
    "\tt.xy *= strength;",
    "\tif (axis == 0) { vec3 b = vec3(t.xy + n.zy, abs(t.z) * n.x); return b.zyx; }",
    "\tif (axis == 1) { vec3 b = vec3(t.xy + n.xz, abs(t.z) * n.y); return b.xzy; }",
    "\treturn vec3(t.xy + n.xy, abs(t.z) * n.z);",
    "}",
    "vec3 rrDetailShade(vec3 col, vec3 ng, vec3 nd, float rough, vec3 p, vec4 params) {",
    "\tvec3 v = normalize(cameraPosition - p);",
    "\tvec3 l = rrKeyLight.w > 0.5 ? normalize(rrKeyLight.xyz - p) : normalize(rrKeyLight.xyz);",
    "\tfloat lg = max(dot(ng, l), 0.0), ln = max(dot(nd, l), 0.0);",
    "\tcol *= (0.45 + 0.55 * ln) / (0.45 + 0.55 * lg);",
    "\tfloat smoothness = params.y * (1.0 - rough);",
    "\tif (smoothness > 0.002) {",
    "\t\tvec3 h = normalize(l + v);",
    "\t\tfloat spec = pow(max(dot(nd, h), 0.0), mix(8.0, 64.0, smoothness)) * ln;",
    "\t\tfloat fres = 0.04 + 0.96 * pow(1.0 - max(dot(nd, v), 0.0), 5.0);",
    "\t\tvec3 sky = rrAmbient / max(max(rrAmbient.r, max(rrAmbient.g, rrAmbient.b)), 0.001);",
    "\t\tcol = mix(col, sky * 0.75, clamp(fres * params.z * smoothness, 0.0, 0.6));",
    "\t\tcol += vec3(spec * smoothness * 0.4);",
    "\t}",
    "\treturn col;",
    "}",
    // Three projections by world position (`p` already scaled to repeats, `dx` and `dy` its screen
    // derivatives, taken where every pixel runs), blended by `w`; roughness in `rough`.
    "vec3 rrDetailTriplanar(sampler2D m, vec3 p, vec3 dx, vec3 dy, vec3 n, vec3 w, float strength, out float rough) {",
    "\tvec3 sum = vec3(0.0);",
    "\tfloat r = 0.0, total = 0.0;",
    "\tif (w.x > 0.02) { vec4 c = textureGrad(m, p.zy, dx.zy, dy.zy); sum += rrDetailAxis(c, n, 0, strength) * w.x; r += c.a * w.x; total += w.x; }",
    "\tif (w.y > 0.02) { vec4 c = textureGrad(m, p.xz, dx.xz, dy.xz); sum += rrDetailAxis(c, n, 1, strength) * w.y; r += c.a * w.y; total += w.y; }",
    "\tif (w.z > 0.02) { vec4 c = textureGrad(m, p.xy, dx.xy, dy.xy); sum += rrDetailAxis(c, n, 2, strength) * w.z; r += c.a * w.z; total += w.z; }",
    "\trough = r / max(total, 1e-4);",
    "\treturn normalize(sum);",
    "}",
    "#endif"
].join("\n");

/**
 * A lit material's detail (the material's `userData.rrDetail`, from
 * materialDetail): a box piece's repeat from its settings, a rock's through its
 * triplanar scale, and, when it has maps, the relief and sheen after its colour
 * is set (before the light, so a material the light is worked out apart from —
 * HalfLight — keeps it).
 */
Reactor3D.injectMaterialDetail = function(material, shader) {
    const detail = material && material.userData && material.userData.rrDetail;
    if (!detail || shader.fragmentShader.indexOf("uniform vec4 rrDetailParams;") >= 0) return;
    const triplanar = !!material.__reactorTriplanar;
    if (triplanar) shader.uniforms.rrTriScale = detail.triScale;
    else if (material.userData.rrDetailUv !== false) {
        shader.uniforms.rrUvScale = detail.uvScale;
        shader.vertexShader = "uniform float rrUvScale;\n" + shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv *= rrUvScale;\n#endif");
    }
    if (!detail.maps) return;
    shader.uniforms.rrDetailMap = detail.map;
    shader.uniforms.rrDetailParams = detail.params;
    const body = triplanar ? [
        "if (rrDetailParams.w > 0.5) {",
        "\tvec3 rrDNg = normalize(vRRTriNormal);",
        "\tif (dot(rrDNg, cameraPosition - vRRTriPos) < 0.0) rrDNg = -rrDNg;",
        "\tvec3 rrDW = pow(abs(rrDNg), vec3(4.0));",
        "\trrDW /= max(rrDW.x + rrDW.y + rrDW.z, 1e-4);",
        "\tfloat rrDR;",
        "\tvec3 rrDP = vRRTriPos * rrTriScale;",
        "\tvec3 rrDN = rrDetailTriplanar(rrDetailMap, rrDP, dFdx(rrDP), dFdy(rrDP), rrDNg, rrDW, rrDetailParams.x, rrDR);",
        "\tdiffuseColor.rgb = rrDetailShade(diffuseColor.rgb, rrDNg, rrDN, rrDR, vRRTriPos, rrDetailParams);",
        "}"
    ] : [
        "#ifdef USE_MAP",
        "if (rrDetailParams.w > 0.5) {",
        // The face's own facing (a box face is flat): which way its image was laid.
        "\tvec3 rrDNg = normalize(cross(dFdx(vRRWorldPos), dFdy(vRRWorldPos)));",
        "\tif (dot(rrDNg, cameraPosition - vRRWorldPos) < 0.0) rrDNg = -rrDNg;",
        "\tvec4 rrDC = texture2D(rrDetailMap, vMapUv);",
        "\tvec3 rrDA = abs(rrDNg);",
        "\tint rrDAxis = rrDA.y >= rrDA.x && rrDA.y >= rrDA.z ? 1 : rrDA.x >= rrDA.z ? 0 : 2;",
        "\tvec3 rrDN = normalize(rrDetailAxis(rrDC, rrDNg, rrDAxis, rrDetailParams.x));",
        "\tdiffuseColor.rgb = rrDetailShade(diffuseColor.rgb, rrDNg, rrDN, rrDC.a, vRRWorldPos, rrDetailParams);",
        "}",
        "#endif"
    ];
    // After three's common chunk, which follows the light's declarations (rrKeyLight, rrAmbient) that the functions read.
    shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D rrDetailMap;\nuniform vec4 rrDetailParams;\n" + Reactor3D.DETAIL_FUNCTIONS_GLSL)
        .replace("#include <color_fragment>", "#include <color_fragment>\n" + body.join("\n"));
};

/** A detail's part in a program's key: whether it scales, has maps, and how it is laid. */
Reactor3D.detailProgramKey = function(material) {
    const detail = material && material.userData && material.userData.rrDetail;
    if (!detail) return "";
    return "|detail" + (detail.maps ? "m" : "") + (material.__reactorTriplanar ? "t" : material.userData.rrDetailUv === false ? "c" : "b");
};

/**
 * Pieces are laid in chunks: one mesh per material per PIECE_CHUNK-cell
 * square of the map. A chunk off screen is culled whole, and an edit
 * relays only the chunks it touches — on a ten-thousand-piece map that is
 * a few milliseconds instead of fifty.
 */
Reactor3D.PIECE_CHUNK = 16;

Reactor3D.pieceChunkKey = function(x, y) {
    return Math.floor(x / this.PIECE_CHUNK) * 65536 + Math.floor(y / this.PIECE_CHUNK);
};

/** A piece's surface: its own, else its finish's, else none. */
Reactor3D.pieceSurface = function(piece) {
    return (piece && (piece.surface || (piece.finish && this.PIECE_FINISHES[piece.finish]))) || null;
};

/** A surface as a key: pieces shining alike share a draw. */
Reactor3D.surfaceKey = function(surface) {
    return surface ? [surface.reflect, surface.gloss, surface.metal, surface.texture || 0, surface.tint || "#ffffff"].join(",") : "";
};

/**
 * One material's material object (in a surface, when it has one), shared by every chunk that
 * wears it. `both` draws both faces: a rock's mesh can fold a face over at a crease.
 */
Reactor3D.MapScene.prototype.pieceMaterial = function(name, load, surface, both) {
    if (!this._pieceMaterials) this._pieceMaterials = new Map();
    if (typeof surface === "string") surface = Reactor3D.PIECE_FINISHES[surface] || null;
    const shine = Reactor3D.surfaceKey(surface);
    const key = (shine ? name + "\u0001" + shine : name) + (both ? "\u0002" + both : "");
    let material = this._pieceMaterials.get(key);
    if (material) return material;
    const look = Reactor3D.materialLook(name);
    const texture = look.glass ? null : this.materialTexture(name, load);
    material = new THREE.MeshBasicMaterial({
        map: texture || null,
        color: texture ? 0xffffff : look.glass ? 0xbfe6ff : look.glow ? Reactor3D.glowColour(name) : 0x9a9a9a,
        vertexColors: true,
        side: look.glass || both ? THREE.DoubleSide : THREE.FrontSide,
        transparent: look.glass,
        opacity: look.glass ? 0.32 : 1,
        depthWrite: !look.glass
    });
    // Glass in one draw, both faces: three draws a see-through two-sided material twice, marking it
    // changed between the two, so every pane looked its program up again twice a draw in every pass.
    if (look.glass) material.forceSinglePass = true;
    material.__reactorShaded = true;
    material.__reactorPieces = true;
    material.__reactorSelfLit = look.glow;
    material.userData.rrPieceMaterial = name;
    // Its normal and roughness maps and settings, when it has any; a rock's cap keeps its own repeat.
    const detail = texture && !look.glow ? this.materialDetail(name, load) : null;
    if (detail) { material.userData.rrDetail = detail; material.userData.rrDetailUv = both !== "both"; }
    if (both === "rock") Reactor3D.triplanarMaterial(material, Reactor3D.ROCK_UV);
    Reactor3D.litMaterial(material);
    if (surface && Reactor3D.setMaterialShine) Reactor3D.setMaterialShine(material, surface);
    this._materials.push(material);
    this._pieceMaterials.set(key, material);
    return material;
};

/**
 * Caps over the cut: a top laid over every wall-high piece the cut plane
 * passes through inside `box` (x0, z0, x1, z1 in world tiles), so the
 * storey the player stands in reads as though it had no floor above it.
 * One mesh per material in the pieces group, wearing the piece material
 * (its top mapping: the image by world x and z); made again when the cut
 * changes and dropped when it ends. A doorway's header sits under the
 * plane, so a doorway gets none and stays an opening.
 */
Reactor3D.MapScene.prototype.updateCutCaps = function(mapData, cutTop, box) {
    for (const mesh of this._cutCaps || []) { if (mesh.parent) mesh.parent.remove(mesh); mesh.geometry.dispose(); }
    this._cutCaps = [];
    if (!mapData || !Number.isFinite(cutTop) || cutTop >= 1e8 || !box || !this._scene) return;
    const index = Reactor3D.pieceIndex(mapData);
    if (!index) return;
    const byMaterial = new Map();
    for (const piece of index.list) {
        if (!Reactor3D.CAPPED_KINDS.includes(piece.kind)) continue;
        if (piece.x + 1 < box[0] || piece.x > box[2] || piece.y + 1 < box[1] || piece.y > box[3]) continue;
        const base = Reactor3D.pieceBaseAt(mapData, piece.x, piece.y) + piece.z;
        if (!(base < cutTop - 1e-6 && base + Reactor3D.pieceHeight(piece.kind) > cutTop + 1e-6)) continue;
        let list = byMaterial.get(piece.material);
        if (!list) byMaterial.set(piece.material, list = []);
        list.push(piece);
    }
    const group = this.piecesGroup();
    // A hair under the plane, so the cut itself never takes the cap.
    const y = cutTop - 0.01;
    for (const [name, list] of byMaterial) {
        const positions = [], uvs = [], colors = [];
        for (const piece of list) {
            const x0 = piece.x, x1 = piece.x + 1, z0 = piece.y, z1 = piece.y + 1;
            for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) { positions.push(x, y, z); uvs.push(x, z); colors.push(1, 1, 1); }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(colors), 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, this.pieceMaterial(name, null));
        mesh.userData.pieceCap = true;
        mesh.renderOrder = -5;
        group.add(mesh);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        this._cutCaps.push(mesh);
    }
};
/** The kinds a cap is laid over: full-cell pieces a storey tall or stacked to one. */
Reactor3D.CAPPED_KINDS = ["wall", "block", "window", "glass"];

/** The see-through twin of a piece material: what the sight corridor holds is drawn with this, at a third. */
Reactor3D.MapScene.prototype.pieceGhostMaterial = function(name, load) {
    if (!this._pieceGhostMaterials) this._pieceGhostMaterials = new Map();
    let material = this._pieceGhostMaterials.get(name);
    if (material) return material;
    const look = Reactor3D.materialLook(name);
    const texture = look.glass ? null : this.materialTexture(name, load);
    material = new THREE.MeshBasicMaterial({
        map: texture || null,
        color: texture ? 0xffffff : look.glass ? 0xbfe6ff : look.glow ? Reactor3D.glowColour(name) : 0x9a9a9a,
        vertexColors: true, side: THREE.FrontSide, transparent: true, opacity: Reactor3D.GHOST_OPACITY, depthWrite: false
    });
    material.__reactorShaded = true;
    material.__reactorPieces = true;
    material.__reactorGhost = true;
    material.__reactorSelfLit = look.glow;
    material.userData.rrPieceMaterial = name;
    // Laid at the wall's own repeat, so the wall seen through keeps its stones where they were.
    const detail = texture && !look.glow ? this.materialDetail(name, load) : null;
    if (detail) material.userData.rrDetail = detail;
    Reactor3D.litMaterial(material);
    this._materials.push(material);
    this._pieceGhostMaterials.set(name, material);
    return material;
};
/** How much of a wall in the way is still seen. */
Reactor3D.GHOST_OPACITY = 0.35;

/** Lay the pieces of the chunks named in `keys` (every chunk when null). */
Reactor3D.MapScene.prototype.layPieceChunks = function(mapData, load, keys) {
    // Door casings and window frames are laid with the pieces, in their own materials (reactor_3d_doors.js).
    const trims = Reactor3D.pieceTrims ? Reactor3D.pieceTrims(mapData) : [];
    const pieces = trims.length ? Reactor3D.piecesOf(mapData).concat(trims) : Reactor3D.piecesOf(mapData);
    const wanted = keys ? new Set(keys) : null;
    const byChunk = new Map();
    const rocks = [];
    for (const piece of pieces) {
        if (piece.kind === "rock") { rocks.push(piece); continue; }
        const key = Reactor3D.pieceChunkKey(piece.x, piece.y);
        if (wanted && !wanted.has(key)) continue;
        let byMaterial = byChunk.get(key);
        if (!byMaterial) byChunk.set(key, byMaterial = new Map());
        // Material and surface: a mirror wall is its own draw.
        const shine = Reactor3D.surfaceKey(Reactor3D.pieceSurface(piece));
        const look = shine ? piece.material + "\u0001" + shine : piece.material;
        let list = byMaterial.get(look);
        if (!list) byMaterial.set(look, list = []);
        list.push(piece);
    }
    for (const [key, byMaterial] of byChunk) {
        for (const list of byMaterial.values()) this.addPieceChunkMesh(key, list[0].material, Reactor3D.pieceSurface(list[0]), Reactor3D.pieceGeometry(list, mapData), load);
    }
    if (rocks.length) this.layRockChunks(mapData, load, rocks, wanted);
};

/**
 * The rocks of the chunks in `wanted` (every chunk a rock reaches when
 * null): each chunk meshes the rock field over its own cells, from every
 * rock that reaches it, one mesh per material and per cap. A chunk whose
 * rocks are the same as when it was last meshed (an edit beside it, an
 * undo) takes its arrays again instead of meshing.
 */
Reactor3D.MapScene.prototype.layRockChunks = function(mapData, load, rocks, wanted) {
    const frames = rocks.map(piece => Reactor3D.rockFrame(piece, Reactor3D.pieceBaseAt(mapData, piece.x, piece.y)));
    const size = Reactor3D.PIECE_CHUNK;
    const keys = new Set();
    for (const f of frames) {
        for (let cy = Math.floor(Math.max(0, f.min[2]) / size); cy <= Math.floor(Math.max(0, f.max[2]) / size); cy++) {
            for (let cx = Math.floor(Math.max(0, f.min[0]) / size); cx <= Math.floor(Math.max(0, f.max[0]) / size); cx++) keys.add(cx * 65536 + cy);
        }
    }
    const cache = this._rockChunkCache || (this._rockChunkCache = new Map());
    const signature = f => Reactor3D.rockSignature(f);
    const floor = Reactor3D.rockGroundFloor(mapData);
    const pending = this._rockPending || (this._rockPending = new Map());
    // A whole map laid in the game: the chunks round the player now, the rest in the background,
    // nearest first. An edit relays its own chunks at once.
    const pool = !wanted && this._rockWorkers ? Reactor3D.rockWorkerPool() : null;
    const focus = pool ? Reactor3D.rockFocus(mapData) : null;
    const jobs = [];
    for (const key of keys) {
        if (wanted && !wanted.has(key)) continue;
        pending.delete(key);
        const cx = Math.floor(key / 65536), cy = key % 65536;
        const box = { x0: cx * size, z0: cy * size, x1: cx * size + size, z1: cy * size + size };
        const reaching = frames.filter(f => f.max[0] >= box.x0 - 1 && f.min[0] <= box.x1 + 1 && f.max[2] >= box.z0 - 1 && f.min[2] <= box.z1 + 1);
        // The ground decides which faces are buried, so it is part of what the chunk was meshed from.
        const sig = reaching.map(signature).sort().join("|") + "|" + Reactor3D.rockGroundSignature(floor, box);
        let buckets = cache.get(key);
        if (!buckets || buckets.sig !== sig) {
            const distance = focus ? Math.hypot(Math.max(box.x0 - focus.x, 0, focus.x - box.x1), Math.max(box.z0 - focus.z, 0, focus.z - box.z1)) : 0;
            if (pool && distance > Reactor3D.ROCK_NEAR) { jobs.push({ key, box, reaching, sig, distance }); continue; }
            buckets = Reactor3D.rockChunkBuckets(reaching, box, floor);
            buckets.sig = sig;
            cache.set(key, buckets);
        }
        this.addRockChunk(key, buckets, load);
    }
    if (jobs.length) this.queueRockChunks(pool, jobs, load, floor);
};

/** Chunks this near the player (tiles from its edge) are meshed before the map shows; the rest after. */
Reactor3D.ROCK_NEAR = 24;
/** Background meshing on (the game asks for it; the editor, which draws only on a change, does not). */
Reactor3D.ROCK_WORKERS = true;

/** What a rock face is drawn with: its bucket's key, material or cap, and surface. */
Reactor3D.rockLook = function(frame, capped) {
    const piece = frame.piece, cap = capped ? piece.cap : null;
    const surface = cap ? null : this.pieceSurface(piece);
    const shine = this.surfaceKey(surface);
    return { look: cap ? "\u0003" + cap : shine ? piece.material + "\u0001" + shine : piece.material, name: cap || piece.material, surface, cap: !!cap };
};

/** A chunk's rock faces, meshed here: one bucket of arrays per material and cap. */
Reactor3D.rockChunkBuckets = function(reaching, box, floor) {
    const made = new Map();
    const bucketFor = (frame, capped) => {
        const looks = frame.looks || (frame.looks = [this.rockLook(frame, false), this.rockLook(frame, true)]);
        const look = looks[capped ? 1 : 0];
        let bucket = made.get(look.look);
        if (!bucket) made.set(look.look, bucket = { positions: [], uvs: [], colors: [], normals: [], name: look.name, surface: look.surface, cap: look.cap });
        return bucket;
    };
    this.rockMesh(reaching, box, bucketFor, floor);
    return [...made.values()].filter(b => b.positions.length).map(b => ({ name: b.name, surface: b.surface, cap: b.cap,
        positions: new Float32Array(b.positions), uvs: new Float32Array(b.uvs), colors: new Float32Array(b.colors), normals: new Float32Array(b.normals) }));
};

/** The ground under and round a chunk as a number, so a terrain edit there meshes it again. */
Reactor3D.rockGroundSignature = function(floor, box) {
    if (!floor) return "0";
    let h = 0;
    for (let z = box.z0 - 2; z < box.z1 + 2; z++) for (let x = box.x0 - 2; x < box.x1 + 2; x++) {
        const v = floor(x, z);
        h = (Math.imul(h, 31) + (v === -Infinity ? 7919 : Math.round(v * 100))) | 0;
    }
    return String(h);
};

/** Where the player stands, for which rocks to mesh first; the map's middle without one. */
Reactor3D.rockFocus = function(mapData) {
    const player = typeof $gamePlayer !== "undefined" ? $gamePlayer : null;
    if (player && Number.isFinite(player._realX) && Number.isFinite(player._realY)) return { x: player._realX + 0.5, z: player._realY + 0.5 };
    return { x: (mapData && mapData.width || 0) / 2, z: (mapData && mapData.height || 0) / 2 };
};

/** Lay a chunk's meshed rock faces into the scene. */
Reactor3D.MapScene.prototype.addRockChunk = function(key, buckets, load) {
    for (const bucket of buckets) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(bucket.positions, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(bucket.uvs, 2));
        geometry.setAttribute("color", new THREE.BufferAttribute(bucket.colors, 3));
        // The field's own slope, smooth across faces: what the rock's image is blended by.
        geometry.setAttribute("normal", new THREE.BufferAttribute(bucket.normals, 3));
        geometry.computeBoundingSphere();
        const ground = bucket.cap && bucket.name === Reactor3D.ROCK_GROUND;
        this.addPieceChunkMesh(key, ground ? Reactor3D.ROCK_GROUND : bucket.name, bucket.surface, geometry, ground ? this.groundLoader() : load, bucket.cap ? "both" : "rock").userData.rocks = true;
    }
};

/**
 * Hand chunks to the background meshers, nearest first. Each comes back as arrays and is laid
 * if it is still wanted: the same map build, and no edit relaid the chunk meanwhile.
 */
Reactor3D.MapScene.prototype.queueRockChunks = function(pool, jobs, load, floor) {
    const generation = this._rockGeneration;
    jobs.sort((a, b) => a.distance - b.distance);
    for (const job of jobs) {
        const looks = new Map();
        const frames = job.reaching.map(f => {
            const pair = f.looks || (f.looks = [Reactor3D.rockLook(f, false), Reactor3D.rockLook(f, true)]);
            for (const look of pair) looks.set(look.look, look);
            return { piece: { cap: f.piece.cap || "" }, c: f.c, axes: f.axes, half: f.half, round: f.round, rough: f.rough, amp: f.amp, tint: f.tint, warp: f.warp, top: f.top, min: f.min, max: f.max, lookKeys: [pair[0].look, pair[1].look] };
        });
        // The ground the faces are judged against, over the chunk and two tiles round it.
        const g = { x0: job.box.x0 - 2, z0: job.box.z0 - 2, w: job.box.x1 - job.box.x0 + 4, h: job.box.z1 - job.box.z0 + 4, values: null };
        g.values = new Float64Array(g.w * g.h);
        for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) g.values[z * g.w + x] = floor ? floor(g.x0 + x, g.z0 + z) : -Infinity;
        this._rockPending.set(job.key, job.sig);
        pool.submit({ frames, box: job.box, ground: g }, data => {
            if (!this._scene || this._rockGeneration !== generation || this._rockPending.get(job.key) !== job.sig) return;
            this._rockPending.delete(job.key);
            // A worker's buckets name their look; one meshed here already carries it.
            const buckets = (data.buckets || []).map(b => {
                const look = b.look ? looks.get(b.look) : b;
                return { name: look.name, surface: look.surface, cap: look.cap, positions: b.positions, uvs: b.uvs, colors: b.colors, normals: b.normals };
            });
            buckets.sig = job.sig;
            this._rockChunkCache.set(job.key, buckets);
            this.addRockChunk(job.key, buckets, load);
            // The static shadow rows take the new rock once the arrivals settle, not once per chunk.
            clearTimeout(this._rockShadowTimer);
            this._rockShadowTimer = setTimeout(() => { if (Reactor3D.Shadows && Reactor3D.Shadows.invalidate) Reactor3D.Shadows.invalidate(); }, 150);
        }, () => Reactor3D.rockChunkBuckets(job.reaching, job.box, floor));
    }
};

/** The worker's whole program: the field and mesher, as written above, and its message loop. */
Reactor3D.rockWorkerSource = function() {
    const kernel = fn => "const " + fn.name + " = " + fn.toString() + ";";
    const R = {};
    for (const name of ["ROCK_STEP", "ROCK_BLEND", "ROCK_WARP", "ROCK_UV", "ROCK_CAP_UV", "ROCK_GROUND"]) R[name] = this[name];
    return [
        "'use strict';",
        kernel(rockHash), kernel(rockOctave), kernel(rockBoxDistance),
        "const R = " + JSON.stringify(R) + ";",
        "R.rockNoise = " + this.rockNoise.toString() + ";",
        "R.rockField = " + this.rockField.toString() + ";",
        "R.rockMesh = " + this.rockMesh.toString() + ";",
        "self.onmessage = function(event) {",
        "    const job = event.data, made = new Map();",
        "    const bucketFor = (frame, capped) => { const look = frame.lookKeys[capped ? 1 : 0]; let b = made.get(look); if (!b) made.set(look, b = { look, positions: [], uvs: [], colors: [], normals: [] }); return b; };",
        "    const g = job.ground;",
        "    const floor = (x, z) => { const ix = x - g.x0, iz = z - g.z0; return ix >= 0 && iz >= 0 && ix < g.w && iz < g.h ? g.values[iz * g.w + ix] : -Infinity; };",
        "    R.rockMesh(job.frames, job.box, bucketFor, floor);",
        "    const buckets = [], transfer = [];",
        "    for (const b of made.values()) {",
        "        if (!b.positions.length) continue;",
        "        const out = { look: b.look, positions: new Float32Array(b.positions), uvs: new Float32Array(b.uvs), colors: new Float32Array(b.colors), normals: new Float32Array(b.normals) };",
        "        buckets.push(out); transfer.push(out.positions.buffer, out.uvs.buffer, out.colors.buffer, out.normals.buffer);",
        "    }",
        "    self.postMessage({ id: job.id, buckets }, transfer);",
        "};"
    ].join("\n");
};

/**
 * The background meshers, shared by every map: up to three workers (one core is the game's), made
 * on first use. Null where workers cannot run. A worker that fails hands its work back: the rest
 * is meshed here, a chunk a turn.
 */
Reactor3D.rockWorkerPool = function() {
    if (this._rockPool !== undefined) return this._rockPool && !this._rockPool.broken ? this._rockPool : null;
    this._rockPool = null;
    if (!this.ROCK_WORKERS || typeof Worker !== "function" || typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
    let url;
    try { url = URL.createObjectURL(new Blob([this.rockWorkerSource()], { type: "text/javascript" })); } catch (e) { return null; }
    const cores = typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 2;
    const pool = { broken: false, queue: [], jobs: new Map(), idle: [], next: 1 };
    const runHere = () => {
        // Off the workers: one chunk a turn, so the frames go on between them.
        const job = pool.queue.shift();
        if (!job) return;
        try { job.done({ buckets: job.fallback() }); } catch (e) { console.warn("Reactor3D: a rock chunk could not be meshed —", e); }
        setTimeout(runHere, 0);
    };
    const pump = () => {
        if (pool.broken) { runHere(); return; }
        while (pool.idle.length && pool.queue.length) {
            const worker = pool.idle.pop(), job = pool.queue.shift();
            pool.jobs.set(job.id, job);
            job.worker = worker;
            worker.postMessage(Object.assign({ id: job.id }, job.payload));
        }
    };
    const fail = error => {
        if (pool.broken) return;
        console.warn("Reactor3D: background rock meshing is off —", error && (error.message || error));
        pool.broken = true;
        // Whatever was out on a worker is meshed here instead.
        for (const job of pool.jobs.values()) pool.queue.unshift(job);
        pool.jobs.clear();
        runHere();
    };
    try {
        for (let i = 0; i < Math.max(1, Math.min(3, cores - 1)); i++) {
            const worker = new Worker(url);
            worker.onmessage = event => {
                const job = pool.jobs.get(event.data && event.data.id);
                if (job) { pool.jobs.delete(job.id); try { job.done(event.data); } catch (e) { console.warn("Reactor3D: a rock chunk could not be laid —", e); } }
                pool.idle.push(worker);
                pump();
            };
            worker.onerror = event => { if (event && event.preventDefault) event.preventDefault(); fail(event); };
            pool.idle.push(worker);
        }
    } catch (e) { return null; }
    pool.submit = (payload, done, fallback) => {
        pool.queue.push({ id: pool.next++, payload, done, fallback });
        pump();
    };
    this._rockPool = pool;
    return pool;
};

/**
 * The loader a rock's "ground" cap reads with: the room's floor image, by
 * the loader the room was laid with; with no floor, the Grass material.
 */
Reactor3D.MapScene.prototype.groundLoader = function() {
    const floor = this._roomFloor, load = this._roomLoad;
    return () => {
        if (floor && typeof load === "function") return load(floor);
        return Reactor3D.defaultMaterialLoader("Grass");
    };
};

/** One chunk's mesh of one material (and its ghost for the cut), laid in the pieces group. */
Reactor3D.MapScene.prototype.addPieceChunkMesh = function(key, name, surface, geometry, load, both) {
    const group = this.piecesGroup();
    const mesh = new THREE.Mesh(geometry, this.pieceMaterial(name, load, surface, both));
    mesh.userData.pieces = true;
    mesh.userData.pieceMaterial = name;
    if (surface) mesh.userData.pieceFinish = Reactor3D.surfaceKey(surface);
    mesh.userData.pieceChunk = key;
    // Glass draws after everything solid, so what is behind it shows through.
    mesh.renderOrder = Reactor3D.materialLook(name).glass ? 5 : -5;
    group.add(mesh);
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this._meshes.push(mesh);
    this._pieceMeshes.push(mesh);
    if (Reactor3D.Shadows && Reactor3D.Shadows.markCaster) Reactor3D.Shadows.markCaster(mesh, false);
    // The chunk again for the ghost pass: the same geometry, drawn translucent where a wall is in the way, shown only while a cut is on.
    if (!Reactor3D.materialLook(name).glass) {
        const ghost = new THREE.Mesh(geometry, this.pieceGhostMaterial(name, load));
        ghost.userData.pieceGhost = true;
        ghost.userData.pieceChunk = key;
        ghost.renderOrder = 4;
        ghost.visible = !!this._cutLook;
        group.add(ghost);
        ghost.updateMatrix();
        ghost.matrixAutoUpdate = false;
        (this._pieceGhosts = this._pieceGhosts || []).push(ghost);
    }
    return mesh;
};

/** Lay every piece down, cast into the static shadow rows. */
Reactor3D.MapScene.prototype.addPieces = function(mapData, load) {
    this._pieceMeshes = this._pieceMeshes || [];
    // A new build: rock chunks still meshing for the last one are not laid into this one.
    this._rockGeneration = (this._rockGeneration || 0) + 1;
    this._rockPending = new Map();
    if (!Reactor3D.hasPieces(mapData)) return;
    this.layPieceChunks(mapData, load, null);
};

/**
 * Lay the pieces down again after an edit. Only the chunks `region`
 * (cell bounds {x0, y0, x1, y1}, inclusive; null for all) touches are
 * dropped and laid again; the tiles, ground, room, sky and every other
 * chunk stay as they are. Returns the meshes laid.
 */
Reactor3D.MapScene.prototype.updatePieces = function(mapData, load, region) {
    let keys = null;
    // A rock melts into its neighbours a little past its own box: relay the chunks that far round an edit.
    if (region && Reactor3D.hasRocks(mapData)) region = { x0: region.x0 - 3, y0: region.y0 - 3, x1: region.x1 + 3, y1: region.y1 + 3 };
    if (region) {
        keys = [];
        const size = Reactor3D.PIECE_CHUNK;
        for (let cy = Math.floor(Math.max(0, region.y0) / size); cy <= Math.floor(Math.max(0, region.y1) / size); cy++) {
            for (let cx = Math.floor(Math.max(0, region.x0) / size); cx <= Math.floor(Math.max(0, region.x1) / size); cx++) keys.push(cx * 65536 + cy);
        }
    }
    const wanted = keys ? new Set(keys) : null;
    const ghosts = [];
    for (const ghost of this._pieceGhosts || []) {
        if (wanted && !wanted.has(ghost.userData.pieceChunk)) { ghosts.push(ghost); continue; }
        if (ghost.parent) ghost.parent.remove(ghost);
    }
    this._pieceGhosts = ghosts;
    const kept = [];
    for (const mesh of this._pieceMeshes || []) {
        if (wanted && !wanted.has(mesh.userData.pieceChunk)) { kept.push(mesh); continue; }
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        const at = this._meshes.indexOf(mesh);
        if (at >= 0) this._meshes.splice(at, 1);
        if (Reactor3D.Shadows && Reactor3D.Shadows._static) Reactor3D.Shadows._static.delete(mesh);
    }
    this._pieceMeshes = kept;
    const before = kept.length;
    if (Reactor3D.hasPieces(mapData)) this.layPieceChunks(mapData, load, keys);
    if (Reactor3D.Shadows && Reactor3D.Shadows.invalidate) Reactor3D.Shadows.invalidate();
    return this._pieceMeshes.slice(before);
};

/** The one clock every water sheet reads. */
Reactor3D.waterUniforms = function() {
    if (!this._waterUniforms) this._waterUniforms = { rrWaveTime: { value: 0 } };
    return this._waterUniforms;
};

/**
 * A river's image, in place of three's plain lookup: sampled at the world
 * point carried back along the flow twice, half a cycle apart, and faded
 * from one to the other (a flow map), so it runs downstream forever without
 * stretching. One image per tile, as a pond's. It is the surface's detail,
 * not its colour (RIVER_SHADE_GLSL colours it by depth): `rrBright` is how
 * light the running image is against its own average, `rrLines` the
 * current's streaks, `rrFoam` the white water where it runs fast, and
 * `rrRipple` a slope worked out from the running image, which tilts the
 * surface so the sun's glints ride downstream with it.
 */
Reactor3D.RIVER_MAP_GLSL = [
    "float rrFoam = 0.0, rrBright = 0.5, rrLines = 0.0;",
    "vec2 rrRipple = vec2(0.0);",
    "#ifdef USE_MAP",
    "{",
    "\tfloat rrCycle = rrWaveTime * 0.5;",
    "\tfloat rrPhaseA = fract(rrCycle), rrPhaseB = fract(rrCycle + 0.5);",
    "\tfloat rrFade = abs(1.0 - 2.0 * rrPhaseA);",
    // Two seconds a cycle: the image moves the flow's speed times two in one.
    "\tvec2 rrRun = vec2(vRRFlow.x, -vRRFlow.y) * 2.0;",
    "\tvec2 rrBase = vec2(vRRWorldPos.x, -vRRWorldPos.z);",
    "\tvec4 rrA = texture2D(map, rrBase - rrRun * rrPhaseA);",
    "\tvec4 rrB = texture2D(map, rrBase - rrRun * rrPhaseB + vec2(0.37, 0.61));",
    "\tvec4 rrRunning = mix(rrA, rrB, rrFade);",
    // The current's lines: the same image drawn out three times longer along the flow and
    // carried down it, its bright parts kept as streaks; none where the water stands still.
    "\tfloat rrSpeed = length(vRRFlow);",
    "\tvec2 rrAlong = rrSpeed > 0.01 ? rrRun / (2.0 * rrSpeed) : vec2(1.0, 0.0);",
    "\tvec2 rrAcross = vec2(-rrAlong.y, rrAlong.x);",
    "\tvec2 rrDrawn = vec2(dot(rrBase, rrAlong) * 0.33, dot(rrBase, rrAcross) * 1.4);",
    "\tfloat rrShift = rrSpeed * 2.0 * 0.33;",
    "\tfloat rrLineA = dot(texture2D(map, rrDrawn - vec2(rrShift * rrPhaseA, 0.0) + vec2(0.13, 0.29)).rgb, vec3(0.3, 0.59, 0.11));",
    "\tfloat rrLineB = dot(texture2D(map, rrDrawn - vec2(rrShift * rrPhaseB, 0.0) + vec2(0.71, 0.47)).rgb, vec3(0.3, 0.59, 0.11));",
    // Brightness against the image's own average (its smallest mip), so any water picture foams alike.
    "\tfloat rrMean = dot(textureLod(map, vec2(0.5), 12.0).rgb, vec3(0.3, 0.59, 0.11));",
    "\tfloat rrLineRaw = 0.5 + (mix(rrLineA, rrLineB, rrFade) - rrMean) * 5.0;",
    "\trrLines = smoothstep(0.6, 0.85, rrLineRaw) * smoothstep(0.02, 0.4, rrSpeed);",
    "\trrBright = clamp(0.5 + (dot(rrRunning.rgb, vec3(0.3, 0.59, 0.11)) - rrMean) * 5.0, 0.0, 1.0);",
    // Ripples: three crossing wave trains, carried downstream as the image is (two phases, faded),
    // their slope worked out exactly, so a glint is a smooth highlight that rides the current.
    "\tvec2 rrWA = rrBase - rrRun * rrPhaseA, rrWB = rrBase - rrRun * rrPhaseB + vec2(0.71, 0.29);",
    "\tvec2 rrK1 = rrAlong * 4.2 + rrAcross * 1.3, rrK2 = rrAlong * 2.6 - rrAcross * 3.4, rrK3 = rrAlong * 7.1 + rrAcross * 5.2;",
    "\tvec2 rrSlopeA = rrK1 * cos(dot(rrK1, rrWA)) * 0.5 + rrK2 * cos(dot(rrK2, rrWA) + 1.7) * 0.35 + rrK3 * cos(dot(rrK3, rrWA) + 0.4) * 0.15;",
    "\tvec2 rrSlopeB = rrK1 * cos(dot(rrK1, rrWB)) * 0.5 + rrK2 * cos(dot(rrK2, rrWB) + 1.7) * 0.35 + rrK3 * cos(dot(rrK3, rrWB) + 0.4) * 0.15;",
    // Calm water barely ripples; it roughens as it runs.
    "\trrRipple = mix(rrSlopeA, rrSlopeB, rrFade) * vec2(1.0, -1.0) * (0.25 + 0.75 * smoothstep(0.1, 1.2, rrSpeed));",
    // White water only where it is fast, and only its brightest, so rapids break up rather than turn white.
    "\trrFoam = clamp(vRRRapid * 0.8 * smoothstep(0.55, 0.85, rrBright + 0.1 * vRRRapid) + rrLines * 0.45 * vRRRapid, 0.0, 1.0);",
    "}",
    "#endif"
].join("\n");

/**
 * A river's colour and clarity, in place of a pond's: the water's own colour
 * by its depth (clear and green-brown over the shallows, so the bed shows,
 * dark blue-green in the middle of the channel), the running image as light
 * and shade on it, the current's streaks a little lighter, the sky caught at
 * a glancing angle (more as the eye drops toward the water), the sun's
 * glints riding the ripples downstream, a lacy foam where it laps the bank
 * and white water where it runs fast. Sets the names the shared tail reads:
 * rrTint, rrViewDir, rrWaveN, rrGlint, rrFresnel.
 */
Reactor3D.RIVER_SHADE_GLSL = [
    // The colours are before the light, which a sunny map lays on at two to three times: dark here is dark there.
    "\tvec3 rrShallow = vec3(0.10, 0.155, 0.105), rrDeep = vec3(0.008, 0.034, 0.04);",
    // A liquid of its own colour: lighter in the shallows. One that lights itself (lava) is not lit
    // afterwards, so its colour stands as it is.
    "\tfloat rrSelf = rrWaterForm.z >= 0.5 ? 1.0 : 0.0;",
    "\tif (rrWaterColour.w > 0.5) { rrShallow = rrWaterColour.rgb * mix(0.5, 1.15, rrSelf); rrDeep = rrWaterColour.rgb * mix(0.22, 0.9, rrSelf); }",
    "\tfloat rrDeepness = smoothstep(0.05, 1.1, vRRDepth);",
    "\tvec3 rrTint = mix(rrShallow, rrDeep, rrDeepness);",
    // A low sun to the north, the way the camera looks: its glints gather in a glittering path across
    // the water ahead, and only a ripple tilted well toward it flashes seen from above (an overhead
    // light glinted everywhere at once, and the river read as frosted glass).
    "\tvec3 rrLightDir = normalize(vec3(0.12, 0.55, -0.83));",
    "\tvec3 rrViewDir = normalize(cameraPosition - vRRWorldPos);",
    "\tfloat rrFar = smoothstep(25.0, 80.0, distance(cameraPosition, vRRWorldPos));",
    // The swell's slope and the running ripples', both fading out with distance.
    // How much it ripples follows the liquid's waves: tar barely stirs.
    "\tvec3 rrWaveN = normalize(mix(vRRWaveNormal + vec3(-rrRipple.x, 0.0, -rrRipple.y) * 0.035 * rrWaterForm.y, vec3(0.0, 1.0, 0.0), rrFar));",
    "\tvec3 rrHalf = normalize(rrLightDir + rrViewDir);",
    "\tfloat rrNdotH = max(dot(rrWaveN, rrHalf), 0.0);",
    // A tight sun glint, and a sparkle of points where the ripples face it just so.
    "\tfloat rrGlint = pow(rrNdotH, 500.0) * 1.4 + pow(rrNdotH, 60.0) * 0.12;",
    "\tfloat rrFresnel = 0.03 + 0.97 * pow(1.0 - max(dot(rrWaveN, rrViewDir), 0.0), 5.0);",
    // The body: the running image as light and shade, the streaks lighter.
    "\tvec3 rrBody = rrTint * (0.7 + 0.6 * rrBright) + vec3(0.03, 0.04, 0.04) * rrLines;",
    // The sky it catches: pale toward the horizon, deeper overhead.
    "\tvec3 rrSky = mix(vec3(0.24, 0.28, 0.31), vec3(0.11, 0.16, 0.23), clamp(reflect(-rrViewDir, rrWaveN).y, 0.0, 1.0));",
    "\tdiffuseColor.rgb = mix(rrBody, rrSky, clamp(rrFresnel * 0.7, 0.0, 0.6));",
    // Lace along the bank: where it is shallowest, broken up by the running image.
    "\tfloat rrShore = 1.0 - smoothstep(0.02, 0.2, vRRDepth);",
    // Water's own: a liquid of its own colour (tar, lava, slime) does not foam white at its edge.
    "\tfloat rrLace = rrShore * smoothstep(0.35, 0.7, rrBright + 0.35 * rrShore) * smoothstep(-0.02, 0.03, vRRDepth) * (1.0 - rrWaterColour.w);",
    "\tfloat rrWhite = clamp(max(rrFoam, rrLace * 0.75), 0.0, 1.0);",
    "\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.44, 0.44), rrWhite) + vec3(rrGlint * 0.6) * (1.0 - rrWaterForm.z);",
    // Clear over the shallows, near opaque over the deep; the sky and the foam are not seen through.
    "\tfloat rrClear = clamp(rrWaterForm.x / 0.6, 0.0, 1.66);",
    "\tfloat rrOpacity = mix(0.32, 0.95, rrDeepness);",
    "\trrOpacity = mix(1.0, rrOpacity, min(rrClear, 1.0)) * (rrClear > 1.0 ? mix(1.0, 0.6, rrClear - 1.0) : 1.0);",
    "\trrOpacity = max(rrOpacity, max(min(rrFresnel, 0.85), max(rrWhite, min(rrGlint, 1.0))));",
    // Gone over a third of a tile of depth: an opaque liquid's edge would show the cells' steps on a shorter one.
    "\tdiffuseColor.a *= rrOpacity * smoothstep(0.0, 0.3, vRRDepth) * vRREdge;"
].join("\n");

/**
 * Waves in the sheet's own shader: two swells cross the surface and lift
 * the vertices, and the fragment is shaded by RIVER_MAP_GLSL and
 * RIVER_SHADE_GLSL, a still sheet as a river with a breath of wind across
 * it: coloured by its depth, mirroring by its Fresnel term (and toward a
 * full mirror as `reflect` rises past water's 0.45), glinting off its
 * ripples, fading out where the ground rises to meet it, so a shore is a
 * shore. A liquid's `colour`, `clear`, `waves` and `glow` say what it is.
 */
Reactor3D.waterMaterial = function(texture, look) {
    const material = new THREE.MeshBasicMaterial({
        map: texture || null, color: 0xffffff, transparent: true, opacity: 1,
        depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true
    });
    material.__reactorShaded = true;
    material.__reactorWater = true;
    const shared = this.waterUniforms();
    // Its look: reflect, roughness, then the tint the reflection takes.
    const reflect = look && look.reflect > 0 ? look.reflect : 0;
    material.userData.rrWaterLook = new THREE.Vector4(reflect, 1 - (look && look.gloss !== undefined ? look.gloss : 0.85), 0, 0);
    material.userData.rrWaterTint = new THREE.Color(look && look.tint ? look.tint : "#ffffff");
    // The liquid: its colour (w 1 when it has its own), and its clarity, waves and glow.
    const colour = look && look.colour ? new THREE.Color(look.colour) : null;
    material.userData.rrWaterColour = new THREE.Vector4(colour ? colour.r : 0, colour ? colour.g : 0, colour ? colour.b : 0, colour ? 1 : 0);
    const glow = look && look.glow > 0 ? look.glow : 0;
    material.userData.rrWaterForm = new THREE.Vector4(look && look.clear !== undefined ? look.clear : 0.6, look && look.waves !== undefined ? look.waves : 1, glow, 0);
    // A glowing liquid lights itself: lava is bright in the dark.
    if (glow >= 0.5) material.__reactorSelfLit = true;
    // A river: its image runs along it (the vertices carry the way and speed) and whitens in rapids.
    const flowing = !!(look && Array.isArray(look.path));
    material.userData.rrFlowing = flowing;
    if (reflect > 0 && this.Reflections) { this.Reflections.wanted = true; this.Reflections.hook(material); }
    const env = this.Reflections ? this.Reflections.uniforms() : null;
    material.onBeforeCompile = function(shader) {
        shader.uniforms.rrWaveTime = shared.rrWaveTime;
        shader.uniforms.rrWaterLook = { value: material.userData.rrWaterLook };
        shader.uniforms.rrWaterTint = { value: material.userData.rrWaterTint };
        shader.uniforms.rrWaterColour = { value: material.userData.rrWaterColour };
        shader.uniforms.rrWaterForm = { value: material.userData.rrWaterForm };
        if (env) { shader.uniforms.rrEnvMap = env.rrEnvMap; shader.uniforms.rrEnvMaxLod = env.rrEnvMaxLod; shader.uniforms.rrEnvFlip = env.rrEnvFlip; }
        const mirror = env && Reactor3D.Mirrors ? Reactor3D.Mirrors.uniforms() : null;
        if (mirror) for (const name of Object.keys(mirror)) shader.uniforms[name] = mirror[name];
        shader.vertexShader = "uniform float rrWaveTime;\nuniform vec4 rrWaterForm;\nattribute float rrDepth;\nvarying float vRRDepth;\nvarying vec3 vRRWaveNormal;\n"
            + (flowing ? "attribute vec2 rrFlow;\nattribute float rrRapid;\nvarying vec2 vRRFlow;\nvarying float vRRRapid;\n" : "attribute float rrEdge;\nvarying float vRREdge;\n") + shader.vertexShader.replace(
            "#include <begin_vertex>",
            [
                "#include <begin_vertex>",
                "{",
                "\tvec2 rrP = vec2(position.x, position.z);",
                "\tvec2 rrK1 = vec2(0.9, 0.45), rrK2 = vec2(-0.35, 0.8);",
                // How much it waves: higher and quicker for more, low and sluggish for tar.
                // A river's swell is smaller: its surface is read by the image running down it.
                "\tfloat rrA1 = " + (flowing ? "0.035" : "0.07") + " * rrWaterForm.y, rrA2 = " + (flowing ? "0.025" : "0.045") + " * rrWaterForm.y;",
                "\tfloat rrPace = mix(0.25, 1.0, clamp(rrWaterForm.y, 0.0, 1.0));",
                "\tfloat rrPh1 = dot(rrK1, rrP) - rrWaveTime * 1.1 * rrPace, rrPh2 = dot(rrK2, rrP) - rrWaveTime * 1.7 * rrPace;",
                "\tfloat rrLift = rrA1 * sin(rrPh1) + rrA2 * sin(rrPh2);",
                "\tfloat rrDx = rrA1 * cos(rrPh1) * rrK1.x + rrA2 * cos(rrPh2) * rrK2.x;",
                "\tfloat rrDz = rrA1 * cos(rrPh1) * rrK1.y + rrA2 * cos(rrPh2) * rrK2.y;",
                "\t// Waves die out in the shallows, so the sheet meets the shore flat.",
                "\tfloat rrCalm = smoothstep(0.0, 0.8, rrDepth);",
                "\ttransformed.y += rrLift * rrCalm;",
                "\tvRRWaveNormal = normalize(vec3(-rrDx * rrCalm, 1.0, -rrDz * rrCalm));",
                "\tvRRDepth = rrDepth;",
                flowing ? "\tvRRFlow = rrFlow;\n\tvRRRapid = rrRapid;" : "\tvRREdge = rrEdge;",
                "}"
            ].join("\n")
        );
        shader.fragmentShader = "varying float vRRDepth;\nvarying vec3 vRRWaveNormal;\nuniform vec4 rrWaterLook;\nuniform vec3 rrWaterTint;\nuniform vec4 rrWaterColour;\nuniform vec4 rrWaterForm;\n"
            // A level sheet is shaded as a river is, still but for a breath of wind across it.
            + "uniform float rrWaveTime;\n" + (flowing ? "varying vec2 vRRFlow;\nvarying float vRRRapid;\nconst float vRREdge = 1.0;\n" : "const vec2 vRRFlow = vec2(0.16, 0.07);\nconst float vRRRapid = 0.0;\nvarying float vRREdge;\n")
            + (env ? "uniform samplerCube rrEnvMap;\nuniform float rrEnvMaxLod;\nuniform float rrEnvFlip;\n" + Reactor3D.SRGB_DECODE_GLSL + "\n" : "")
            + (mirror ? Reactor3D.mirrorUniformDeclarations() + "\nuniform float rrMirrorTolerance;\n" : "")
            + shader.fragmentShader.replace(
            "#include <map_fragment>",
            [
                Reactor3D.RIVER_MAP_GLSL,
                "{",
                Reactor3D.RIVER_SHADE_GLSL,
                // A glowing liquid burns brighter at its crests.
                // Its crests, and the bright of its running image.
                "\tif (rrWaterForm.z > 0.0) diffuseColor.rgb *= 1.0 + rrWaterForm.z * (0.1 + 0.9 * rrBright * rrBright + 2.5 * (1.0 - rrWaveN.y));",
                // A reflective sheet mirrors the world through its waves, more at a
                // glancing angle, and turns opaque as it does: mercury is a mirror.
                env ? [
                    // From under the water (the eye below the sheet) the surface is a window to the sky, as
                    // Snell's window is, opened wider than nature's 49 degrees so a third-person camera
                    // (which looks up only so far) sees the sky; only toward the horizon does the surface
                    // mirror the underwater world back, faintly. It had mirrored the lakebed overhead.
                    "\tif (rrViewDir.y < 0.0) {",
                    "\t\tfloat rrWindow = smoothstep(0.18, 0.4, -rrViewDir.y);",
                    "\t\tvec3 rrRb = reflect(-rrViewDir, -rrWaveN);",
                    "\t\trrRb.x *= rrEnvFlip;",
                    "\t\tvec3 rrUnder = textureLod(rrEnvMap, rrRb, 0.35 * rrEnvMaxLod).rgb;",
                    // A live capture holds sRGB (flip 1); the studio cube is decoded by the GPU.
                    "\t\tif (rrEnvFlip > 0.0) rrUnder = rrSRGBToLinear(rrUnder);",
                    "\t\trrUnder *= rrTint;",
                    "\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, rrUnder, 0.6 * (1.0 - rrWindow));",
                    "\t\tdiffuseColor.a = mix(max(diffuseColor.a, 0.9), 0.12, rrWindow);",
                    "\t} else if (rrWaterLook.x > 0.0) {",
                    "\t\tvec3 rrR = reflect(-rrViewDir, rrWaveN);",
                    "\t\trrR.x *= rrEnvFlip;",
                    "\t\tvec3 rrEnvC = textureLod(rrEnvMap, rrR, rrWaterLook.y * rrEnvMaxLod).rgb;",
                    "\t\tif (rrEnvFlip > 0.0) rrEnvC = rrSRGBToLinear(rrEnvC);",
                    "\t\trrEnvC *= rrWaterTint;",
                    // The sheet's own mirror picture when it is one of the frame's mirrors: the world sharp and
                    // in place, rippled by the waves (and blurred a little as the water roughens).
                    mirror ? [
                        "\t\tvec2 rrRipple = rrWaveN.xz * (0.035 + 0.1 * rrWaterLook.y);",
                        Reactor3D.mirrorLookup("rrEnvC", slot => "rrMirrorPlane" + slot + ".y > 0.9 && abs(vRRWorldPos.y - rrMirrorPlane" + slot + ".w) < 0.4", "rrRipple", "rrWaterTint")
                    ].join("\n") : "",
                    // Glancing light is reflected, light from above goes in: a dark liquid stays dark seen from
                    // above (tar is black, not sky blue) and mirrors the world toward the horizon; only a full
                    // mirror (mercury) reflects as strongly straight down.
                    // Water mirrors by its Fresnel term (fully at water's own reflect, 0.45, and up); a reflect
                    // past that raises a floor toward a full mirror, as mercury is. The world it mirrors is
                    // taken down by the light the map lays on after it.
                    "\t\tfloat rrBase = min(rrWaterLook.x / 0.45, 1.0) * rrFresnel * 0.9;",
                    "\t\tfloat rrFloor = pow(smoothstep(0.45, 1.0, rrWaterLook.x), 1.5) * mix(0.75, 0.95, 1.0 - rrWaterLook.y);",
                    "\t\tfloat rrMirror = clamp(rrFloor + (1.0 - rrFloor) * rrBase, 0.0, 0.97);",
                    "\t\tdiffuseColor.rgb = mix(diffuseColor.rgb, rrEnvC * 0.4, rrMirror) + vec3(rrGlint * 0.4 * rrMirror);",
                    // Opaque as a mirror, but still gone where the ground rises over it (the shore cells).
                    "\t\tdiffuseColor.a = max(diffuseColor.a, rrMirror * smoothstep(0.0, 0.3, vRRDepth) * vRREdge);",
                    "\t}"
                ].join("\n") : "",
                "}"
            ].join("\n")
        );
    };
    material.customProgramCacheKey = function() { return "reactor3d-water" + (env ? "|env|mirror" : "") + (flowing ? "|river" : ""); };
    this.litMaterial(material);
    return material;
};

/**
 * A sheet's surface: one quad per cell the water covers, corners shared, a
 * vertex per tile corner so the waves and the shoreline have something to
 * move; each vertex knows how deep the water is under it (`rrDepth`). UVs run
 * over the sheet's box so the image repeats once per tile.
 *
 * The quads reach one cell past the wet cells (`shore`, on by default): a
 * bank cell is dry at its middle but its ground dips under the level toward
 * the pond, and the sheet must be there for the shoreline to be where the
 * ground crosses the water rather than a square cut at the cell's edge.
 * Where the bank stands above the level the ground hides the sheet.
 */
Reactor3D.waterGeometry = function(region, mapData, shore = true, others = null) {
    if (region.path) return this.riverGeometry(region, mapData, shore, others);
    const w = region.x1 - region.x0 + 1, h = region.y1 - region.y0 + 1;
    const reach = shore && region.mask ? 1 : 0;
    const gw = w + 2 * reach, gh = h + 2 * reach;
    const positions = [], uvs = [], depth = [], edge = [], index = [];
    // Where a river leaves (or enters) the pond the ground runs on down its channel, so nothing fades
    // the pond's edge there: it would stand as a pane with a straight edge over the river. Each corner
    // touching a river cell outside the pond (at about the pond's level) fades it out (`rrEdge`).
    const rivers = others ? others.filter(other => other !== region && other.path) : [];
    const riverOut = (x, y) => !this.waterCovers(region, x, y) && rivers.some(river => this.waterCovers(river, x, y) && Math.abs(this.riverCellLevel(river, x, y) - region.level) < 0.6);
    const ids = new Map();
    const wet = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h && (!region.mask || region.mask[cy * w + cx] === "1");
    const corner = (cx, cy) => {
        const key = (cy + reach) * (gw + 1) + (cx + reach);
        let id = ids.get(key);
        if (id === undefined) {
            id = positions.length / 3;
            ids.set(key, id);
            const wx = region.x0 + cx, wz = region.y0 + cy;
            positions.push(wx, region.level, wz);
            // In tiles: the image repeats once per tile in the sheet's own UVs. The image itself is
            // shared by every sheet (and piece) of that material, so its repeat is left alone.
            uvs.push(cx + reach, gh - (cy + reach));
            const gx = Math.max(0, Math.min(mapData.width - 1e-3, wx)), gz = Math.max(0, Math.min(mapData.height - 1e-3, wz));
            // Over the bed, not over what stands up through the water (a jetty, a boat).
            depth.push(region.level - Reactor3D.waterBedAt(mapData, gx, gz, region.level));
            edge.push(rivers.length && (riverOut(wx - 1, wz - 1) || riverOut(wx, wz - 1) || riverOut(wx - 1, wz) || riverOut(wx, wz)) ? 0 : 1);
        }
        return id;
    };
    for (let cy = -reach; cy < h + reach; cy++) for (let cx = -reach; cx < w + reach; cx++) {
        const wx = region.x0 + cx, wz = region.y0 + cy;
        if (wx < 0 || wz < 0 || wx >= mapData.width || wz >= mapData.height) continue;
        if (!wet(cx, cy) && !(reach && (wet(cx - 1, cy) || wet(cx + 1, cy) || wet(cx, cy - 1) || wet(cx, cy + 1) || wet(cx - 1, cy - 1) || wet(cx + 1, cy - 1) || wet(cx - 1, cy + 1) || wet(cx + 1, cy + 1)))) continue;
        const a = corner(cx, cy), b = corner(cx + 1, cy), c = corner(cx + 1, cy + 1), d = corner(cx, cy + 1);
        index.push(a, d, b, b, d, c);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("rrDepth", new THREE.Float32BufferAttribute(depth, 1));
    geometry.setAttribute("rrEdge", new THREE.Float32BufferAttribute(edge, 1));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

/**
 * A river's surface: a pond's (quads over the wet cells and one past them
 * for the shore), each corner at the river's height there, and carrying
 * the way and speed the water runs (`rrFlow`, tiles a second) and how much
 * white water it has (`rrRapid`). No quads where it falls (the curtain is
 * there) or where a level sheet as high stands over it (a lake it runs
 * into draws its own water, without the two fighting at one height).
 */
Reactor3D.RIVER_SUBDIVIDE = 3;
// The deepest a river stands over its own bed; deeper is a drop beside it, not river.
Reactor3D.RIVER_DEEP_MAX = 3;
Reactor3D.riverGeometry = function(region, mapData, shore = true, others = null) {
    const w = region.x1 - region.x0 + 1, h = region.y1 - region.y0 + 1;
    const reach = shore && region.mask ? 1 : 0;
    const gw = w + 2 * reach;
    const positions = [], uvs = [], depth = [], flow = [], rapid = [], index = [];
    const ids = new Map(), sample = {};
    const wet = (cx, cy) => cx >= 0 && cy >= 0 && cx < w && cy < h && (!region.mask || region.mask[cy * w + cx] === "1");
    const level = others ? others.filter(other => other !== region && !other.path) : [];
    // Within a quarter tile: the river's last cells, easing down to the lake's level, would stand just proud of it.
    // Its first cells inside the pool or lake (beside its own water outside it) are still drawn: the pool
    // fades out there (its `rrEdge`), and the two meet without a gap.
    const under = (wx, wz, here) => level.some(other => other.level >= here - 0.25 && this.waterCovers(other, wx, wz));
    const outside = (wx, wz, here) => this.waterCovers(region, wx, wz) && !under(wx, wz, here);
    const drowned = (wx, wz, here) => under(wx, wz, here) && !(outside(wx - 1, wz, here) || outside(wx + 1, wz, here) || outside(wx, wz - 1, here) || outside(wx, wz + 1, here)
        || outside(wx - 1, wz - 1, here) || outside(wx + 1, wz - 1, here) || outside(wx - 1, wz + 1, here) || outside(wx + 1, wz + 1, here));
    // Each cell is laid as SUB x SUB quads: the shore fade and the depth colour are worked out per
    // vertex, and over a whole cell a bank rising inside it (a gorge wall) faded along the
    // triangles' edges, drawing straight seams down the river's sides.
    const SUB = Reactor3D.RIVER_SUBDIVIDE, row = (gw * SUB + 1);
    const corner = (sx, sy) => {
        const key = (sy + reach * SUB) * row + (sx + reach * SUB);
        let id = ids.get(key);
        if (id === undefined) {
            id = positions.length / 3;
            ids.set(key, id);
            const cx = sx / SUB, cy = sy / SUB;
            const wx = region.x0 + cx, wz = region.y0 + cy;
            this.riverSample(region, wx, wz, sample);
            // A corner on a fall lies at its foot: the pool runs in under the curtain, which hides the drop.
            const surface = sample.fall ? sample.foot : sample.level;
            positions.push(wx, surface, wz);
            uvs.push(cx / gw, 1 - cy / gw);
            const gx = Math.max(0, Math.min(mapData.width - 1e-3, wx)), gz = Math.max(0, Math.min(mapData.height - 1e-3, wz));
            // How deep it stands where it is drawn: under the fall that is the foot, so the pool's
            // corners inside the cliff are below the ground there and fade out instead of showing as deep water.
            depth.push(surface - Reactor3D.waterBedAt(mapData, gx, gz, surface));
            const speed = sample.fall ? 0 : this.riverSpeed(sample.slope, region.flow);
            flow.push(sample.dx * speed, sample.dz * speed);
            rapid.push(Math.max(0, Math.min(1, (sample.slope - 0.06) * 5)) * (region.flow === 0 ? 0 : 1));
        }
        return id;
    };
    for (let cy = -reach; cy < h + reach; cy++) for (let cx = -reach; cx < w + reach; cx++) {
        const wx = region.x0 + cx, wz = region.y0 + cy;
        if (wx < 0 || wz < 0 || wx >= mapData.width || wz >= mapData.height) continue;
        if (!wet(cx, cy) && !(reach && (wet(cx - 1, cy) || wet(cx + 1, cy) || wet(cx, cy - 1) || wet(cx, cy + 1) || wet(cx - 1, cy - 1) || wet(cx + 1, cy - 1) || wet(cx - 1, cy + 1) || wet(cx + 1, cy + 1)))) continue;
        this.riverSample(region, wx + 0.5, wz + 0.5, sample);
        if (drowned(wx, wz, sample.level)) continue;
        for (let j = 0; j < SUB; j++) for (let i = 0; i < SUB; i++) {
            const sx = cx * SUB + i, sy = cy * SUB + j;
            const a = corner(sx, sy), b = corner(sx + 1, sy), c = corner(sx + 1, sy + 1), d = corner(sx, sy + 1);
            // The fall is the curtain's: a quad spanning it (a corner on the fall, which lies at its foot,
            // beside one above it) would stand as a steep sheet, the whole drop high, poking out past
            // the lip. Water the fall reaches into from below lies flat at its foot and stays.
            const ya = positions[a * 3 + 1], yb = positions[b * 3 + 1], yc = positions[c * 3 + 1], yd = positions[d * 3 + 1];
            if (Math.max(ya, yb, yc, yd) - Math.min(ya, yb, yc, yd) > 0.5) continue;
            // A river runs in a channel: water standing far over the ground at any corner is not in
            // one but out over a drop (beside a lip, where the cliff falls away), hanging in the air.
            if (Math.max(depth[a], depth[b], depth[c], depth[d]) > Reactor3D.RIVER_DEEP_MAX) continue;
            index.push(a, d, b, b, d, c);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("rrDepth", new THREE.Float32BufferAttribute(depth, 1));
    geometry.setAttribute("rrFlow", new THREE.Float32BufferAttribute(flow, 2));
    geometry.setAttribute("rrRapid", new THREE.Float32BufferAttribute(rapid, 1));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

/**
 * A waterfall's curtain: a sheet from the lip down to the foot, the full
 * width of the river, bowed out the way water leaves a ledge (it throws
 * forward and drops) and spreading a little as it falls. `rrCurtain` is
 * how far across (0-1) and how far down (0-1) each vertex is; the UVs
 * run a tile of image per tile of width and down the fall.
 */
Reactor3D.FALL_LEAD = 0.9;
Reactor3D.fallGeometry = function(fall) {
    const drop = Math.max(0.1, fall.top - fall.bottom);
    const rows = Math.max(6, Math.min(24, Math.ceil(drop * 1.5))), cols = Math.max(2, Math.min(24, Math.ceil(fall.half * 2 * 1.5)));
    const px = -fall.dz, pz = fall.dx;
    const throwOut = Math.min(1.4, 0.22 * Math.sqrt(drop));
    const positions = [], uvs = [], curtain = [], index = [];
    let down = 0, lastX = 0, lastY = 0, lastZ = 0;
    // A first row half a tile upstream of the lip, at the river's height: the curtain starts over the
    // last of the river's sheet (which stops short of the drop), so no ground shows between them.
    for (let i = -1; i <= rows; i++) {
        const u = Math.max(0, i / rows);
        const along = i < 0 ? -Reactor3D.FALL_LEAD : fall.run * u + throwOut * Math.sqrt(u);
        const y = fall.top + 0.03 + (fall.bottom - 0.15 - fall.top - 0.03) * u;
        const cx = fall.x0 + fall.dx * along + px * fall.offset, cz = fall.z0 + fall.dz * along + pz * fall.offset;
        if (i > 0) down += Math.hypot(cx - lastX, y - lastY, cz - lastZ);
        lastX = cx; lastY = y; lastZ = cz;
        const spread = fall.half * (1 + 0.25 * u);
        for (let j = 0; j <= cols; j++) {
            const v = j / cols, across = (v - 0.5) * 2 * spread;
            positions.push(cx + px * across, y, cz + pz * across);
            uvs.push(v * fall.half * 2, -down);
            curtain.push(v, u);
        }
    }
    for (let i = 0; i < rows + 1; i++) for (let j = 0; j < cols; j++) {
        const a = i * (cols + 1) + j, b = a + 1, c = a + cols + 1, d = c + 1;
        index.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    // Its own copy of the UVs: the material's image is shared with the ponds, whose repeat is theirs.
    geometry.setAttribute("rrFallUv", new THREE.Float32BufferAttribute(uvs.slice(), 2));
    geometry.setAttribute("rrCurtain", new THREE.Float32BufferAttribute(curtain, 2));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

/** Where a fall's water lands, and how wide the foam there is. */
Reactor3D.fallFoot = function(fall) {
    const drop = Math.max(0.1, fall.top - fall.bottom);
    const along = fall.run + Math.min(1.4, 0.22 * Math.sqrt(drop));
    return { x: fall.x0 + fall.dx * along - fall.dz * fall.offset, z: fall.z0 + fall.dz * along + fall.dx * fall.offset,
        y: fall.bottom, radius: fall.half * 1.35 + 0.6 + Math.min(1.5, drop * 0.05) };
};

/**
 * The curtain's material. Three layers of the image stream down at
 * different speeds and scales, with ropes of water across it at uneven
 * spacing; where they are thin the curtain is a dark, see-through sheet
 * over the rock, where they gather it is white. Glassy at the lip, which
 * catches the light; broken up and whiter as it falls; its sides ragged
 * and shifting, not a ruled edge. Lit like the rest of the water; one per
 * fall (its speed is the drop's).
 */
Reactor3D.fallMaterial = function(texture, region, drop) {
    const material = new THREE.MeshBasicMaterial({ map: texture || null, color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    material.__reactorShaded = true;
    material.__reactorWater = true;
    const shared = this.waterUniforms();
    // Before the light, which a sunny map lays on at two to three times.
    const colour = region && region.colour ? new THREE.Color(region.colour).multiplyScalar(0.4) : new THREE.Color(0.05, 0.1, 0.11);
    material.userData.rrFallTint = colour;
    // Water falling `drop` tiles reaches a few tiles a second; a still river (flow 0) falls all the same.
    material.userData.rrFallSpeed = 1.6 + Math.min(4, Math.sqrt(Math.max(0.1, drop)) * 0.9);
    material.onBeforeCompile = function(shader) {
        shader.uniforms.rrWaveTime = shared.rrWaveTime;
        shader.uniforms.rrFallTint = { value: material.userData.rrFallTint };
        shader.uniforms.rrFallSpeed = { value: material.userData.rrFallSpeed };
        shader.vertexShader = "attribute vec2 rrCurtain;\nattribute vec2 rrFallUv;\nvarying vec2 vRRCurtain;\nvarying vec2 vRRFallUv;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvRRCurtain = rrCurtain;\n\tvRRFallUv = rrFallUv;");
        shader.fragmentShader = "uniform float rrWaveTime;\nuniform vec3 rrFallTint;\nuniform float rrFallSpeed;\nvarying vec2 vRRCurtain;\nvarying vec2 vRRFallUv;\n" + shader.fragmentShader.replace(
            "#include <map_fragment>",
            [
                "{",
                "\tvec2 rrUv = vRRFallUv;",
                "\tfloat rrT = rrWaveTime * rrFallSpeed;",
                "\tfloat rrMean = 0.5, rrL1 = 0.5, rrL2 = 0.5, rrL3 = 0.5;",
                "#ifdef USE_MAP",
                "\trrMean = dot(textureLod(map, vec2(0.5), 12.0).rgb, vec3(0.3, 0.59, 0.11));",
                // Three sheets of water in one: slow and broad, quicker, quick and fine.
                "\trrL1 = dot(texture2D(map, vec2(rrUv.x * 0.45, rrUv.y * 0.2 + rrT * 0.2)).rgb, vec3(0.3, 0.59, 0.11));",
                "\trrL2 = dot(texture2D(map, vec2(rrUv.x * 0.9 + 0.31, rrUv.y * 0.33 + rrT * 0.31)).rgb, vec3(0.3, 0.59, 0.11));",
                "\trrL3 = dot(texture2D(map, vec2(rrUv.x * 1.8 + 0.57, rrUv.y * 0.55 + rrT * 0.47)).rgb, vec3(0.3, 0.59, 0.11));",
                "#endif",
                "\tfloat rrN1 = clamp(0.5 + (rrL1 - rrMean) * 4.0, 0.0, 1.0), rrN2 = clamp(0.5 + (rrL2 - rrMean) * 4.0, 0.0, 1.0), rrN3 = clamp(0.5 + (rrL3 - rrMean) * 4.0, 0.0, 1.0);",
                // Ropes of water: bands down the fall at uneven spacing, wavering a little.
                "\tfloat rrX = rrUv.x * 3.1;",
                "\tfloat rrRope = 0.5 + 0.5 * sin(rrX * 6.3 + sin(rrX * 2.1) * 2.4 + sin(rrX * 0.7 + rrWaveTime * 0.3));",
                "\tfloat rrFine = 0.5 + 0.5 * sin(rrUv.x * 13.0 + sin(rrUv.x * 5.3 + 1.7) * 1.8);",
                "\tfloat rrDown = vRRCurtain.y;",
                "\tfloat rrBreak = smoothstep(0.04, 0.55, rrDown);",
                // How much water there is: thin between the ropes, gathered in them, more as it breaks up.
                "\tfloat rrDensity = clamp(rrN1 * 0.4 + rrN2 * 0.3 + rrN3 * 0.2 + rrRope * 0.38 + rrFine * 0.12 - 0.42 + 0.3 * rrBreak, 0.0, 1.0);",
                "\tfloat rrWhite = smoothstep(0.42 - 0.2 * rrBreak, 0.82 - 0.22 * rrBreak, rrDensity);",
                "\tdiffuseColor.rgb = mix(rrFallTint * (0.55 + 0.6 * rrN2), vec3(0.42, 0.44, 0.45), rrWhite);",
                // The lip: glassy water bending over the edge, catching the light.
                "\tfloat rrLip = 1.0 - smoothstep(0.0, 0.07, rrDown);",
                "\tdiffuseColor.rgb += vec3(0.2, 0.22, 0.21) * rrLip * (0.4 + 0.6 * rrN3);",
                // Ragged, shifting sides.
                "\tfloat rrRag = 0.06 + 0.1 * rrN3 + 0.06 * rrN1;",
                "\tfloat rrSide = smoothstep(0.0, rrRag, vRRCurtain.x) * smoothstep(1.0, 1.0 - rrRag, vRRCurtain.x);",
                // Thin water is a dark film the rock shows through; gathered water hides it.
                // The lip is a lens of water bending over the edge: it hides the ground it pours over.
                "\tdiffuseColor.a = clamp(0.16 + 0.78 * rrDensity + 0.6 * rrLip, 0.0, 0.95) * rrSide * smoothstep(1.0, 0.86, rrDown);",
                // The top of a fall is one sheet of water, never seen through to the ledge it pours off; it
                // thins into ropes with gaps only lower down, as it breaks up.
                "\tdiffuseColor.a = max(diffuseColor.a, 0.92 * (1.0 - smoothstep(0.12, 0.4, rrDown)) * rrSide);",
                "}"
            ].join("\n")
        );
    };
    material.customProgramCacheKey = function() { return "reactor3d-waterfall"; };
    this.litMaterial(material);
    return material;
};

/**
 * Where a fall lands: a disc of churning foam on the water below, thickest
 * in a ring where the curtain strikes, boiling outward in patches and
 * thinning out at the rim.
 */
Reactor3D.foamMaterial = function(texture) {
    const material = new THREE.MeshBasicMaterial({ map: texture || null, color: 0xffffff, transparent: true, depthWrite: false, forceSinglePass: true });
    material.__reactorShaded = true;
    material.__reactorWater = true;
    const shared = this.waterUniforms();
    material.onBeforeCompile = function(shader) {
        shader.uniforms.rrWaveTime = shared.rrWaveTime;
        shader.vertexShader = "attribute vec2 rrFoamUv;\nvarying vec2 vRRFoamUv;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvRRFoamUv = rrFoamUv;");
        shader.fragmentShader = "uniform float rrWaveTime;\nvarying vec2 vRRFoamUv;\n" + shader.fragmentShader.replace(
            "#include <map_fragment>",
            [
                "{",
                "\tvec2 rrP = vRRFoamUv * 2.0 - 1.0;",
                "\tfloat rrR = length(rrP);",
                "\tfloat rrAngle = atan(rrP.y, rrP.x);",
                "\tfloat rrMean = 0.5, rrLA = 0.5, rrLB = 0.5;",
                "#ifdef USE_MAP",
                "\trrMean = dot(textureLod(map, vec2(0.5), 12.0).rgb, vec3(0.3, 0.59, 0.11));",
                "\trrLA = dot(texture2D(map, vec2(rrAngle * 1.3, rrR * 1.6 - rrWaveTime * 0.45)).rgb, vec3(0.3, 0.59, 0.11));",
                "\trrLB = dot(texture2D(map, vec2(rrAngle * 2.1 + 0.4, rrR * 2.3 - rrWaveTime * 0.7)).rgb, vec3(0.3, 0.59, 0.11));",
                "#endif",
                "\tfloat rrBright = clamp(0.5 + ((rrLA + rrLB) * 0.5 - rrMean) * 4.0, 0.0, 1.0);",
                // Thickest in a ring a third of the way out (where the curtain strikes), boiling outward in
                // broken rings, patchy beyond.
                "\tfloat rrRing = exp(-pow((rrR - 0.3) / 0.2, 2.0));",
                "\tfloat rrBoil = 0.5 + 0.5 * sin(rrR * 26.0 - rrWaveTime * 3.1 + 2.0 * sin(rrAngle * 5.0 + rrWaveTime * 0.7));",
                "\tfloat rrChurn = clamp(rrRing * (0.35 + 0.75 * rrBright) + smoothstep(0.5, 0.95, rrBoil * (0.45 + rrBright)) * (1.0 - rrR) * 0.9, 0.0, 1.0);",
                "\tdiffuseColor.rgb = vec3(0.42, 0.44, 0.45);",
                "\tdiffuseColor.a = rrChurn * (1.0 - smoothstep(0.5, 1.0, rrR)) * 0.88;",
                "}"
            ].join("\n")
        );
    };
    material.customProgramCacheKey = function() { return "reactor3d-fall-foam"; };
    this.litMaterial(material);
    return material;
};

/**
 * Spray and mist where a fall lands: points that move by themselves in the
 * vertex shader from a seed each (`rrSeed`: phase, heading, kind, size), so
 * nothing is touched per frame. Spray is flung out and up from the foot and
 * drops back; mist rises from it, drifting outward, swelling and fading. As
 * many as the fall is wide, a few dozen at most.
 */
Reactor3D.FALL_SPRAY_MAX = 40;
Reactor3D.FALL_MIST_MAX = 24;
Reactor3D.fallSprayGeometry = function(fall, foot) {
    const width = fall.half * 2, drop = Math.max(0.1, fall.top - fall.bottom);
    const spray = Math.min(this.FALL_SPRAY_MAX, Math.round(10 + width * 5 + Math.min(10, drop)));
    const mist = Math.min(this.FALL_MIST_MAX, Math.round(6 + width * 2.5 + Math.min(8, drop * 0.5)));
    const seeds = [], positions = [];
    // A fixed scatter (no Math.random: the same fall looks the same each time it is built).
    let state = 1 + Math.floor((foot.x * 73 + foot.z * 37) % 1000);
    const next = () => { state = (state * 16807) % 2147483647; return (state - 1) / 2147483646; };
    // Headings away from the curtain, the way the water is thrown.
    const away = Math.atan2(fall.dz, fall.dx);
    for (let i = 0; i < spray + mist; i++) {
        const kind = i < spray ? 0 : 1;
        const heading = away + (next() - 0.5) * (kind ? Math.PI * 1.6 : Math.PI * 1.3);
        seeds.push(next(), heading, kind, next());
        positions.push(foot.x, foot.y, foot.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("rrSeed", new THREE.Float32BufferAttribute(seeds, 4));
    const reach = foot.radius * 1.4 + fall.half, rise = 2 + Math.min(4, drop * 0.25);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(foot.x, foot.y + rise / 2, foot.z), Math.hypot(reach, rise));
    return geometry;
};

Reactor3D.fallSprayMaterial = function(fall, foot) {
    const shared = this.waterUniforms();
    const drop = Math.max(0.1, fall.top - fall.bottom);
    const material = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
            rrWaveTime: shared.rrWaveTime,
            rrFoot: { value: new THREE.Vector3(foot.x, foot.y, foot.z) },
            rrAcross: { value: new THREE.Vector2(-fall.dz, fall.dx) },
            rrHalf: { value: fall.half },
            rrRadius: { value: foot.radius },
            rrDrop: { value: drop },
            rrViewH: { value: 720 }
        },
        vertexShader: [
            "attribute vec4 rrSeed;",
            "uniform float rrWaveTime, rrHalf, rrRadius, rrDrop, rrViewH;",
            "uniform vec3 rrFoot;",
            "uniform vec2 rrAcross;",
            "varying float vRRAlpha;",
            "varying float vRRKind;",
            "void main() {",
            "\tfloat kind = rrSeed.z;",
            "\tfloat period = kind < 0.5 ? 1.1 + rrSeed.w * 0.7 : 4.5 + rrSeed.w * 3.0;",
            "\tfloat t = fract(rrWaveTime / period + rrSeed.x);",
            "\tvec2 dir = vec2(cos(rrSeed.y), sin(rrSeed.y));",
            // Along the curtain's width at the foot, where its water strikes.
            "\tvec2 start = rrFoot.xz + rrAcross * (fract(rrSeed.w * 7.31 + rrSeed.x * 3.7) * 2.0 - 1.0) * rrHalf * 0.9;",
            "\tvec3 p; float size; float a;",
            "\tif (kind < 0.5) {",
            "\t\tfloat out_ = (0.6 + rrSeed.w * 1.3) * (1.0 + min(rrDrop * 0.04, 0.8));",
            "\t\tfloat up = 1.2 + fract(rrSeed.x * 5.3) * 1.4 + min(rrDrop * 0.07, 1.8);",
            "\t\tp = vec3(start.x + dir.x * out_ * t, rrFoot.y + up * t - (up + 0.3) * t * t, start.y + dir.y * out_ * t);",
            "\t\tsize = 0.16 + 0.18 * rrSeed.w;",
            "\t\ta = (1.0 - t) * smoothstep(0.0, 0.08, t) * 0.95;",
            "\t} else {",
            "\t\tfloat spread = rrRadius * (0.15 + 0.85 * t);",
            "\t\tp = vec3(start.x + dir.x * spread, rrFoot.y + 0.15 + t * (0.9 + min(rrDrop * 0.22, 3.5)), start.y + dir.y * spread);",
            "\t\tsize = 1.0 + (2.0 + min(rrDrop * 0.1, 2.0)) * t + rrSeed.w * 0.8;",
            "\t\ta = sin(3.14159 * t) * (0.26 + min(rrDrop * 0.015, 0.16));",
            "\t}",
            "\tvec4 mv = modelViewMatrix * vec4(p, 1.0);",
            "\tgl_Position = projectionMatrix * mv;",
            "\tgl_PointSize = clamp(size * projectionMatrix[1][1] * rrViewH * 0.5 / max(-mv.z, 0.1), 1.0, 256.0);",
            "\tvRRAlpha = a;",
            "\tvRRKind = kind;",
            "}"
        ].join("\n"),
        fragmentShader: [
            "varying float vRRAlpha;",
            "varying float vRRKind;",
            "void main() {",
            "\tvec2 c = gl_PointCoord * 2.0 - 1.0;",
            "\tfloat r2 = dot(c, c);",
            "\tif (r2 > 1.0) discard;",
            "\tfloat soft = vRRKind < 0.5 ? (1.0 - r2) : (1.0 - r2) * (1.0 - r2);",
            "\tgl_FragColor = vec4(vRRKind < 0.5 ? vec3(0.93, 0.96, 0.97) : vec3(0.84, 0.88, 0.9), vRRAlpha * soft);",
            "}"
        ].join("\n")
    });
    material.__reactorWater = true;
    return material;
};

/** The points' size is in screen pixels: the height of whatever the pass draws into, read as it draws. */
Reactor3D.fallSprayBeforeRender = function(renderer, scene, camera, geometry, material) {
    const target = renderer.getRenderTarget();
    const size = Reactor3D._fallSpraySize || (Reactor3D._fallSpraySize = new THREE.Vector2());
    material.uniforms.rrViewH.value = target ? target.height : renderer.getDrawingBufferSize(size).y;
};

/** The water sheets: one waving translucent surface per sheet, in the world's own pass. */
Reactor3D.MapScene.prototype.addWater = function(mapData, load) {
    this._waterMeshes = this._waterMeshes || [];
    this._waterFalls = this._waterFalls || [];
    const all = Reactor3D.waterOf(mapData);
    for (const region of all) {
        const geometry = Reactor3D.waterGeometry(region, mapData, true, all);
        // The image repeats once per tile (the sheet's UVs are in tiles), drifting.
        const texture = this.materialTexture(region.material, load);
        const material = Reactor3D.waterMaterial(texture, region);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.water = region;
        mesh.renderOrder = 6;
        this.piecesGroup().add(mesh);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        this._materials.push(material);
        this._waterMeshes.push(mesh);
        if (region.path) this.addFalls(region, load);
    }
};

/** A river's waterfalls: a curtain down each, foam where it lands, and spray and mist rising there. Kept in `_waterFalls`. */
Reactor3D.MapScene.prototype.addFalls = function(region, load) {
    for (const fall of Reactor3D.riverFalls(region)) {
        const texture = this.materialTexture(region.material, load);
        const curtain = new THREE.Mesh(Reactor3D.fallGeometry(fall), Reactor3D.fallMaterial(texture, region, fall.top - fall.bottom));
        curtain.renderOrder = 6;
        curtain.userData.waterFall = fall;
        const foot = Reactor3D.fallFoot(fall);
        const disc = new THREE.CircleGeometry(foot.radius, 28);
        disc.rotateX(-Math.PI / 2);
        disc.setAttribute("rrFoamUv", disc.attributes.uv.clone());
        const foam = new THREE.Mesh(disc, Reactor3D.foamMaterial(this.materialTexture(region.material, load)));
        foam.position.set(foot.x, foot.y + 0.06, foot.z);
        foam.renderOrder = 7;
        foam.userData.waterFall = fall;
        const spray = new THREE.Points(Reactor3D.fallSprayGeometry(fall, foot), Reactor3D.fallSprayMaterial(fall, foot));
        spray.onBeforeRender = Reactor3D.fallSprayBeforeRender;
        spray.renderOrder = 8;
        spray.userData.waterFall = fall;
        for (const mesh of [curtain, foam, spray]) {
            this.piecesGroup().add(mesh);
            mesh.updateMatrix();
            mesh.matrixAutoUpdate = false;
            this._materials.push(mesh.material);
            this._waterFalls.push(mesh);
        }
    }
};

/** Take the waterfalls down (a rebuild or a new map). */
Reactor3D.MapScene.prototype.removeFalls = function() {
    for (const mesh of this._waterFalls || []) {
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        const m = this._materials ? this._materials.indexOf(mesh.material) : -1;
        if (m >= 0) this._materials.splice(m, 1);
        mesh.material.dispose();
    }
    this._waterFalls = [];
};

/**
 * The scene's water sheets as volumes (world boxes and levels) for the
 * lit shader; the nearest four to `focus` (a world point: the player in the
 * game, the camera's target in the editor) when there are more. A level
 * sheet is one box. A river is a box per stretch, as wide as its water there
 * and as high as the stretch's lower end, so its dry banks (below the river
 * upstream, above it here) are never taken for water; falls have none.
 */
Reactor3D.MapScene.prototype.noteWaterVolume = function(focus) {
    const scene = this.scene && this.scene();
    if (!scene) return;
    const meshes = this._waterMeshes || [];
    if (!meshes.length) { scene.userData.rrWater = null; return; }
    if (this._waterVolumeFor !== meshes || this._waterVolumeCount !== meshes.length) {
        this._waterVolumeFor = meshes;
        this._waterVolumeCount = meshes.length;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        const box = (mesh, x0, z0, x1, z1, level) => {
            a.set(x0, level, z0).applyMatrix4(mesh.matrixWorld);
            b.set(x1, level, z1).applyMatrix4(mesh.matrixWorld);
            return { x0: Math.min(a.x, b.x), z0: Math.min(a.z, b.z), x1: Math.max(a.x, b.x), z1: Math.max(a.z, b.z), level: a.y };
        };
        const all = [];
        for (const mesh of meshes) {
            const region = mesh.userData.water;
            mesh.updateMatrixWorld();
            if (!region.path) { all.push(box(mesh, region.x0, region.y0, region.x1 + 1, region.y1 + 1, region.level)); continue; }
            const profile = Reactor3D.riverProfile(region), path = region.path;
            for (let i = 0; i < profile.n; i++) {
                if (profile.fall[i]) continue;
                const half = Reactor3D.riverHalfWidth(region, (path[i][0] + path[i + 1][0]) / 2, (path[i][1] + path[i + 1][1]) / 2, profile.ux[i], profile.uz[i]);
                all.push(box(mesh, Math.min(path[i][0], path[i + 1][0]) - half, Math.min(path[i][1], path[i + 1][1]) - half,
                    Math.max(path[i][0], path[i + 1][0]) + half, Math.max(path[i][1], path[i + 1][1]) + half, Math.min(path[i][2], path[i + 1][2])));
            }
        }
        this._waterVolumeAll = all;
        this._waterVolumePick = all.length > Reactor3D.WATER_VOLUME_MAX ? all.slice(0, Reactor3D.WATER_VOLUME_MAX) : all;
        this._waterVolumeAt = null;
    }
    const all = this._waterVolumeAll;
    if (all.length > Reactor3D.WATER_VOLUME_MAX && focus) {
        // Chosen again only once the focus has moved a couple of tiles.
        const at = this._waterVolumeAt;
        if (!at || Math.abs(at.x - focus.x) + Math.abs(at.z - focus.z) > 2) {
            this._waterVolumeAt = { x: focus.x, z: focus.z };
            const away = entry => Math.hypot(Math.max(entry.x0 - focus.x, 0, focus.x - entry.x1), Math.max(entry.z0 - focus.z, 0, focus.z - entry.z1));
            const pick = this._waterVolumePick;
            pick.length = 0;
            for (const entry of all) {
                const d = away(entry);
                if (pick.length < Reactor3D.WATER_VOLUME_MAX) { pick.push(entry); entry._rrAway = d; continue; }
                let worst = 0;
                for (let i = 1; i < pick.length; i++) if (pick[i]._rrAway > pick[worst]._rrAway) worst = i;
                if (d < pick[worst]._rrAway) { pick[worst] = entry; entry._rrAway = d; }
            }
        }
    }
    scene.userData.rrWater = this._waterVolumePick;
};

/** How far a river's water reaches each way across its line at a point, on average (at least half a tile). */
Reactor3D.riverHalfWidth = function(region, x, z, ux, uz) {
    const px = -uz, pz = ux;
    let total = 0;
    for (const sign of [-1, 1]) {
        let d = 0;
        while (d < 12 && this.waterCovers(region, Math.floor(x + px * sign * (d + 0.25)), Math.floor(z + pz * sign * (d + 0.25)))) d += 0.25;
        total += d;
    }
    return Math.max(0.5, total / 2 + 0.5);
};

/** Each frame: the waves run and the image drifts. `focus` (a world point) picks the water volumes nearest it. */
Reactor3D.MapScene.prototype.updateWater = function(frame, focus) {
    if (!focus && typeof $gamePlayer !== "undefined" && $gamePlayer && this._waterVolumeAll && this._waterVolumeAll.length > Reactor3D.WATER_VOLUME_MAX) {
        const point = this._waterFocusPoint || (this._waterFocusPoint = new THREE.Vector3());
        point.set($gamePlayer._realX + 0.5, 0, $gamePlayer._realY + 0.5).applyMatrix4(this.piecesGroup().matrixWorld);
        focus = point;
    }
    this.noteWaterVolume(focus);
    if (!this._waterMeshes || !this._waterMeshes.length || !Number.isFinite(frame)) return;
    Reactor3D.waterUniforms().rrWaveTime.value = frame / 60;
    for (const mesh of this._waterMeshes) {
        const texture = mesh.material.map;
        if (!texture) continue;
        texture.offset.x = (frame * 0.0015) % 1;
        texture.offset.y = (frame * 0.0009) % 1;
    }
};

/**
 * Rings on the water around swimmers: a wake while one swims, a slow ring
 * while one treads water, and a burst where one splashes in (the physics'
 * `_reactorSplash`). A small pool of flat rings, reused; in the game only.
 */
Reactor3D.RIPPLE_POOL = 24;
Reactor3D.MapScene.prototype.updateRipples = function(frame, characters) {
    if (!this._waterMeshes || !this._waterMeshes.length || !Number.isFinite(frame) || typeof THREE === "undefined") return;
    const ripples = this._ripples || (this._ripples = { live: [], free: [], geometry: null });
    const mapData = typeof $dataMap !== "undefined" ? $dataMap : null;
    const spawn = (x, z, y, size, life, strength) => {
        let mesh = ripples.free.pop();
        if (!mesh) {
            if (ripples.live.length >= Reactor3D.RIPPLE_POOL) return;
            if (!ripples.geometry) {
                ripples.geometry = new THREE.RingGeometry(0.42, 0.5, 40);
                ripples.geometry.rotateX(-Math.PI / 2);
            }
            mesh = new THREE.Mesh(ripples.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
            mesh.renderOrder = 7;
            this.piecesGroup().add(mesh);
        }
        mesh.visible = true;
        mesh.position.set(x, y, z);
        ripples.live.push({ mesh, born: frame, life, size, strength });
    };
    for (const character of characters || []) {
        if (!character || !mapData) continue;
        const x = character._realX + 0.5, z = character._realY + 0.5;
        const level = Reactor3D.waterLevelAt(mapData, Math.floor(x), Math.floor(z));
        if (level === null) continue;
        const splash = character._reactorSplash;
        if (splash && splash.frame !== character._reactorSplashSeen) {
            character._reactorSplashSeen = splash.frame;
            const burst = Math.min(1, 0.4 + splash.speed * 2);
            spawn(x, z, level + 0.1, 2.6 * burst + 1, 50, 0.85);
            spawn(x, z, level + 0.1, 1.6 * burst + 0.8, 38, 0.7);
            character._reactorRippleAt = frame;
        }
        // Rings are the surface's: a diver under it leaves none.
        if (!character._reactorSwim || (character._reactorDive || 0) > 0.3) continue;
        const moving = character.isMoving && character.isMoving();
        const every = moving ? 14 : 48;
        if (character._reactorRippleAt !== undefined && frame - character._reactorRippleAt < every && frame >= character._reactorRippleAt) continue;
        character._reactorRippleAt = frame;
        spawn(x, z, level + 0.1, moving ? 1.5 : 1.2, moving ? 40 : 70, moving ? 0.45 : 0.3);
    }
    for (let i = ripples.live.length - 1; i >= 0; i--) {
        const ripple = ripples.live[i];
        const t = (frame - ripple.born) / ripple.life;
        if (t >= 1 || t < 0) {
            ripple.mesh.visible = false;
            ripples.free.push(ripple.mesh);
            ripples.live.splice(i, 1);
            continue;
        }
        const scale = 0.5 + ripple.size * Math.sqrt(t);
        ripple.mesh.scale.set(scale, 1, scale);
        ripple.mesh.material.opacity = ripple.strength * (1 - t) * (1 - t);
    }
};

/** Lay the water again after an edit; the rest of the scene stays. */
Reactor3D.MapScene.prototype.updateWaterSheets = function(mapData, load) {
    this.removeFalls();
    for (const mesh of this._waterMeshes || []) {
        if (mesh.parent) mesh.parent.remove(mesh);
        mesh.geometry.dispose();
        const m = this._materials.indexOf(mesh.material);
        if (m >= 0) this._materials.splice(m, 1);
        mesh.material.dispose();
    }
    this._waterMeshes = [];
    this.addWater(mapData, load);
    return this._waterMeshes.slice();
};

Reactor3D.World = { file: "reactor_3d_world.js" };
})(typeof globalThis !== "undefined" ? globalThis : this);

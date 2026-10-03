# Authoring a world in RPG Reactor, by hand or by generator

RPG Reactor is built so a person and an AI can work on the same project.
Every authoring surface below has three faces: a tool in the editor, a
plain file a person can read and a generator can write, and a check that
proves the data works with the engine's own rules. Hand edits are never
overwritten by generation.

This page is the contract. A generator should read it before touching a
project; a person can use it to find where anything lives.

## Where things live

| Surface | File (per map, beside `data/MapNNN.json`) | Editor tool | Check |
| --- | --- | --- | --- |
| 3D switch | `<3d>` in the map note | Map Properties › 3D | — |
| Tile elevation (terraces, cliffs) | `MapNNN.r3d.json` › `elevation` (one whole number per tile) | — (by hand or generator) | — |
| Terrain (rolling ground) | `MapNNN.r3d.json` › `terrain` ((w+1)×(h+1) corner heights), `terrainWidth` | Build bar › Terrain brushes | `editor/tests/terrain.test.cjs` rules |
| Room (floor, walls, ceiling, sky) | `MapNNN.r3d.json` › `room` | Map Properties › 3D | — |
| Pieces (the 3D tileset) | `MapNNN.r3d.json` › `pieces` | **Build** bar over the 3D view (the Build button in the toolbar); drawn as a plan on the flat map too | `validate-map.cjs` |
| Buildings, built or described | `3d/Structures/*.json` (project-wide), placed as `MapNNN.r3d.json` › `structures` | Database › Structures › Build (the plot in the 3D view with the Build bar), Build bar › Blueprint or Use on the map stamps one | `build-structure.cjs --check`, and the page's own walk |
| Materials | `img/materials/*.png` (tileable) | swatches in the Build bar's specs panel | — |
| Water | `MapNNN.r3d.json` › `water` (a hollow's box, its `level`, a `mask` of the wet cells) | Build bar › Terrain › Pour | `validate-map.cjs` |
| Rivers and waterfalls | `MapNNN.r3d.json` › `water` (a sheet with a `path` of heights downstream and a `flow`) | Build bar › Terrain › River | `carve-river.cjs`, `validate-map.cjs` |
| Foliage (grass, flowers, ferns, reeds, bushes) and wind | `MapNNN.r3d.json` › `foliage` (a density per cell per layer, bushes one by one) | Build bar › Foliage | `paint-foliage.cjs`, `validate-map.cjs` |
| Placed models | `MapNNN.r3d.json` › `props` | Build bar › Models (Select there, or Build › Select, picks a placed one up) | — |
| Physics (gravity, jump, fall damage, swimming) | `System.json` › `reactorPhysics`; a map's own in `MapNNN.r3d.json` › `physics` | Database › Controls › Physics (3D maps); Map Properties › Physics | — |
| Keys and gamepad buttons | `System.json` › `reactorControls` (absent while stock) | Database › Controls | — |
| Lights and time of day | `MapNNN.r3d.json` › `lights`, `lighting` (a sun follows the ambient unless `daylight: "fixed"`) | Lighting tool | — |
| Events | `MapNNN.json` › `events` (RPG Maker data) | Event tool | — |

`MapNNN.json` stays ordinary RPG Maker data. Everything 3D is in the
sidecar `MapNNN.r3d.json`, so a project with no 3D maps has no sidecars.

The editor writes these files compactly: a sidecar or structure keeps one
grid row or one piece per line, and database files one record per line.
Any valid JSON reads the same; a generator may write whatever layout it
likes, and the editor rewrites it compactly on the next save.

In the editor, Database › Structures lists the structure files as cards.
A structure's page has a floor plan beside a 3D view of it: pick a floor,
paint rooms, floors, walls, doors, windows and stairs with the tools
(Select picks pieces up to move, nudge, turn or delete; right-drag erases;
Ctrl+Z undoes), set **Floors** to stack more, and **Rebuild roof** lays
the roof again over the top floor. **Build** opens the structure's plot in
the map's 3D view with the same Build bar the map uses, for anything the
plan cannot paint. The Build bar's Blueprint slot, or Use on the map,
stamps a structure; **Rebuild from plan** re-lays a stamped one from its
file.

The rules the engine applies to terrain, pieces and water (where the
ground is, what blocks a step, how deep the water stands) are in
`runtime/reactor_3d_world.js`, readable without three.js; the checks above
run the same code the game does.

## Units

A tile is one world unit. The bundled characters stand three tiles, so a
tile is about 0.6 m. A storey (`PIECE_STOREY`) is 5 tiles. Doorways default
to 3 cells wide (1.8 m); a front door is usually 4 to 6. Heights in the
sidecar are in tiles; positions are cells (integers) for pieces and
fractional tiles for models.

## Pieces

```json
{ "id": 12, "kind": "wall", "x": 30, "y": 49, "z": 0, "rot": 0, "material": "Stone", "group": 2 }
```

- `kind`: `wall` (a storey tall), `block` (one tile cube), `floor` (a slab),
  `pillar`, `stair` (rises one tile across the cell, toward its `rot`;
  a wider stair is stairs side by side), `ramp` (same, a slope), `roof`
  (a one-cell gable), `doorway` (a lintel only: the opening is the whole
  cell, tile two side by side for a door), `window` (a sill and a header),
  `glass`, `fence`, `ladder` (one level of rails and rungs on one side
  of the cell; a stack of them at one cell is one ladder, climbed by
  walking into it, and nothing stands on it) and `door` (below). The shapes are `box`,
  `wedge`, `pyramid`, `prism`, `hull`, `spike`, `cylinder`, `capsule`,
  `tube`, `cone`, `dome`, `sphere`, `dish`, `fin`, `arch`, `tunnel` and
  `ring`: they carry `size: [w, h, d]` in tiles (the cell is the middle of
  the footprint), `angle` in degrees and optional `tilt` and `roll`, stand
  at any quarter tile, and some take settings (`sides`, `taper`, `sweep`,
  `thick`; see `Reactor3D.SHAPE_PARAMS`). A shape blocks every cell its
  footprint covers, as a wall of its height. `rock` is a shape drawn as
  rock: every rock on a map is one mass (neighbours melt together, a
  noise fixed to the world makes it craggy, its top stays nearly flat),
  with an optional `rough` from 0 to 1 (0.5 by default), `cap` (the
  material its tops and flat ledges wear, or `"ground"` for the map's own
  room floor, so a cliff top is the grass around it) and `tint`
  (`#rrggbb`, its sides only). Its image is laid from all three sides by
  world position. It is stood on and blocks where it is drawn (each cell
  reads the rock's surface over its middle; a raised rock is walked
  under), and one standing on the ground reaches a tile into it. Cliffs are rocks side by side and
  stacked: in the Build bar a drag lays a row and a Ctrl-drag fills an
  area, each rock varied a little unless Vary is off.
- `x, y`: the cell. `z`: the level the piece's foot stands at, in tiles
  above the ground, up to 240 (forty-eight storeys of five). `rot`: quarter
  turns clockwise seen from above; `0` rises or faces south.
- `material`: a name under `img/materials` without extension, or `""` for
  plain grey.
- `finish`: optional `mirror`, `chrome`, `polished`, `glossy` or `gold`,
  worn over the material; a `surface` (`reflect`, `gloss`, `metal`, `tint`,
  `texture`, as on a model) overrides it.
- `group`: pieces of one building share a number. Optional.

A material may have companions beside its image, each optional:
`<Name>_normal.png` (a normal map, OpenGL convention, green up),
`<Name>_rough.png` (roughness, white rough) and `<Name>.json`:

```json
{ "scale": 4.5, "gloss": 0.35, "reflect": 0.5, "normalStrength": 1.2 }
```

`scale` is the tiles one repeat of the image covers (absent: one a tile on
a piece, `5` on a rock); `gloss` (0-1) how smooth its smoothest parts are,
`reflect` (0-1) how much sky they mirror at a glancing angle, and
`normalStrength` (0-3) how deep the relief reads. Pieces, rocks and terrain
cliffs of that material take the relief from the map's sun (else a light
from above) and a sheen where the roughness map is dark. The pickers list
the material, not its companions.

### Doors and window frames

```json
{ "kind": "door", "x": 52, "y": 30, "z": 0, "rot": 0, "material": "Wood", "width": 3,
  "style": "plank", "hinge": "left", "swing": "away", "opens": "locked",
  "lock": { "item": 4 }, "message": "It's locked.",
  "sound": { "open": { "name": "door-open-02", "volume": 80, "pitch": 95 } },
  "frame": "Wood", "tag": "inn.front" }
```

A door hangs in a doorway (or a gap in a fence) across `width` cells (1-6),
starting at its own and running along its across: east when `rot` is 0,
south for 1, west for 2, north for 3. `rot` is the way its front faces.
`swing` `"away"` (the default) opens away from whoever opens it, so a door
pushed from inside swings out onto the street; `"in"` always opens away from
the front, `"out"` always toward it. An automatic door notices a walker early
enough (by their pace) to be clear of their way before they reach it, and a
leaf never sweeps through anyone: it stops short of a character in its way,
opens the other way when that side is clearer, and waits to close while
anyone stands between it and the doorway. `style`:
`plank` (boards, ledges, strap hinges, a ring), `panelled`, `arched` (an
arched head, the wall coming down over it), `double` (two panelled leaves)
or `gate` (fence high); a door three cells wide or more hangs two leaves.
`frame` is the casing's material (the door's own when absent). The wall comes
down to the door's head (an arched door's crown), so nothing crosses the
opening above an open leaf; `validate-map.cjs` reports anything that stands
in a doorway's opening (a rail, a sill, a shape) as "something crosses
doorway at x,y".

`opens`: `"auto"` opens for whoever walks up to it (the player, followers,
events) and shuts behind them; `"action"` opens and shuts with the OK button
facing it, and shuts itself a while after everyone has gone; `"locked"`
stays shut until its `lock` is met (`{ "switch": n }` on, or the party holding
`{ "item": n }`, which unlocks it for good), then behaves as `"auto"`. With no
`lock`, a script unlocks it. OK at a locked door, or walking into it, rattles
it; OK also shows its `message` (`"It's locked."` when absent, none when
`""`). Each of `sound.open`, `sound.close` and `sound.locked` is a sound
effect's `name`, `volume` and `pitch`; absent ones use `door-open-01`,
`door-close-01` and `door-locked-01` (a gate `gate-open-01` and
`door-close-02`), and an empty name is silence. Sounds fade with distance
from the player and pan with the camera. A shut door blocks like a wall;
an open one is its threshold. In the editor no door is ever shut against a
walker.

A script reaches a door on the player's map by piece id or tag:
`Reactor3D.Doors.open("inn.front")`, `close`, `lock`, `unlock`, `isOpen`,
`isLocked`. A lock or unlock is kept in the save; open and shut are not (a
map's doors are shut when it loads). The runtime feed sends `doorOpened` and
`doorClosed` (docs/RUNTIME-EVENTS.md).

A window may wear a frame:

```json
{ "kind": "window", "x": 40, "y": 12, "z": 0, "rot": 2, "material": "Stone",
  "frame": { "style": "cottage", "material": "Wood", "shutters": "#3f5f3a", "closed": false, "flowerBox": true } }
```

`style`: `cottage` (six small panes a cell), `two` (a sash bar), `arched`
(an arched head) or `plain`. `rot` points its outside: the sill and lintel
band stand out on that face, open shutters fold back against the wall either
side, and the flower box hangs under the sill. Framed windows side by side at
one level and turn are one window: one sill, one pair of shutters, a mullion
between cells. In the Build bar the Door slot hangs a door in the doorway
clicked (a run of doorways gets one door across it), and the Door and Window
cards set all of the above.

Rules the engine applies, so a generator can predict them: a character
stands on the top of the lowest stack reachable from where it already is,
so a floor over a room is a ceiling from below and a floor from the stairs;
a step higher than 0.75 tile is blocked, which is what makes a wall a wall
and a stair a stair; a doorway is walked through at its own level; a stair
climbs one tile per cell, so a storey is five stair cells.

## Built structures

What Database › Structures › **Build** saves: the structure's plot and what
stands on it, built in the workshop with the map's own Build bar (the plot
opens in the 3D view; Save writes the file). Pieces are in the plot's own
cells and take the fields of a map piece (see Pieces) without `id` or
`group`; `lights` and `surfaces` are the map's light and media-surface rows,
at plot coordinates. A stamp moves all of it to the stamp's corner, turns it
with the stamp (cells and facings a quarter turn, shapes by `angle`, lights
and screens about the plot) and marks it as the building's.

```json
{
  "name": "Shed", "size": [10, 8], "storey": 5, "height": 2,
  "pieces": [
    { "kind": "floor", "x": 4, "y": 5, "material": "Wood" },
    { "kind": "wall", "x": 3, "y": 2, "z": 1, "rot": 1, "material": "Stone" },
    { "kind": "cylinder", "x": 6, "y": 2, "z": 0.5, "size": [2, 3, 2], "angle": 30 }
  ],
  "lights": [{ "type": "point", "x": 5.5, "y": 4.5, "height": 2.5, "radius": 4, "color": "#ffcc88" }]
}
```

`size` is the plot in tiles and `height` its floors (of `storey` levels
each); the workshop keeps building inside them. A described plan (below)
opened in the workshop is built out into pieces, and saving it keeps the
pieces.

### Saving what is on a map as a structure

Anything built on a map can be kept as a structure and stamped again
anywhere. In Build › Select, click a piece and **Select whole building**
(or double-click the piece): a stamped building takes its whole group, a
hand-built one every loose piece touching it; a box dragged on the ground
selects everything in it. **Save as structure…** on the selection names
it and writes `3d/Structures/<Name>.json` (with a `.png` picture of it),
which Database › Structures and the Blueprint slot list at once. It holds
the selected pieces and what stands in the box they cover:

- `lights` and `surfaces` as above (not the sun or a light riding a character);
- `props`: placed models, in the plot's cells, as the map's `props` rows;
- `water`: sheets wholly inside the box (a fountain, a garden pond), the
  box and mask in plot cells and `level` above the ground it stood on;
- with **Bring the events inside as its people**, each event in the box as
  a template under `3d/Structures/events` and a spot (`spots`, `events`),
  so a stamp places them where they stood (People at spots, below);
- `description`, the note typed with it.

A stamp levels the ground under the plot, puts the water at its height
above that, and marks the models and water with the building's group, so
moving, turning or removing the building takes them along. **Make the
selection one building of it** turns the original into a stamp of the new
structure (one undo step); Rebuild from plan then follows later edits of
the file. A name already taken asks before replacing that structure.
Foliage is not saved with a structure.

From a shell, a box of a map:

```
node editor/build-scripts/save-structure.cjs <project> <mapId> <x0> <y0> <x1> <y1> <name> [--events] [--note "text"] [--force] [--check]
```

## Structure plans

A building as a person describes it. Everything else is derived.

```json
{
  "name": "Cottage", "size": [14, 10], "storey": 5,
  "materials": { "wall": "Stone", "inner": "Plaster", "floor": "Wood", "wet": "Stone", "roof": "RoofTile", "stair": "Wood" },
  "floors": [
    { "rooms": { "hall": [1, 1, 6, 8], "kitchen": [8, 1, 12, 8] },
      "doors": [["hall", "outside", 3], ["hall", "kitchen", 3]],
      "wet": ["kitchen"] },
    { "rooms": { "landing": [1, 1, 6, 8], "bedroom": [8, 1, 12, 8] },
      "doors": [["landing", "bedroom", 3]] }
  ],
  "stairs": [{ "floor": 0, "from": [5, 7], "dir": "north", "width": 1 }],
  "roof": { "pitch": 2 },
  "windows": { "every": 6, "width": 2 }
}
```

- `rooms`: `[x0, y0, x1, y1]`, inclusive, in the plan's own cells. Walls
  grow on the cells beside a room that no room claims, so leave one cell
  between rooms and one round the building; the rest of the plan's `size`
  is open ground, and a floor with no rooms builds nothing. Walls can be
  thicker; doors cut through whatever thickness.
- `doors`: `[roomA, roomB, width]`, centred on the wall the two rooms share,
  or `[roomA, roomB, width, at]` to put the door where the plan says: `at`
  is the position along the wall (the x of a wall that runs east to west,
  the y of one that runs north to south), clamped so the door stays in the
  wall. `"outside"` is the wall beside the room that faces open ground,
  south first, then north, east, west; a fifth entry names the side:
  `["hall", "outside", 3, 5, "east"]`.
- `windows` on a floor: `[[x, y], ...]` outer wall cells with a window
  each, beside whatever the plan's window rhythm places along the building. A rhythm of
  `every: 0` leaves only the windows placed by hand.
- `stairs`: `from` is the bottom step's cell, `dir` the way it climbs, one
  cell per tile of rise; the floor above is left open over the run.
- `roof`: ramps step up `pitch` rows from each eave, a flat top between,
  gables closed with blocks. `windows`: a pair every `every` cells along
  the outside, never beside a door.
- Floor is laid under every doorway and wall cell as well as every room,
  and a ceiling over every top-floor room under the roof.
- A door hangs in every doorway: outside doors `plank`, inner ones
  `panelled`, all `"auto"`, in `materials.door` (`Wood` when absent) with a
  `materials.frame` casing. `"door": { ... }` on the plan gives them all
  their settings, a door entry's own last element (an object) its own:
  `["hall", "outside", 3, 5, "south", { "opens": "locked", "lock": { "switch": 7 } }]`;
  `false` there, or `"doors": false` on the plan, leaves an open doorway.
- Windows wear a frame: `"windows": { "every": 6, "width": 2, "frame":
  "cottage", "shutters": "#3f5f3a", "flowerBox": true }` (`frame: false` for
  none; `flowerBox` on the ground floor, `"all"` on every floor), in
  `materials.frame`.
- A room may wear its own materials: `"materials": { "hall": { "floor":
  "Stone", "wall": "Wood" } }` on the floor. The floor is the room's; the
  wall applies to inner walls that touch the room (the first neighbouring
  room that says wins), never to the outer wall, which stays the building's.

### Plans of plans

A plan can be made of other plans, so a hamlet is one page and a city is
districts of hamlets:

```json
{
  "name": "Hamlet", "size": [64, 48], "storey": 5, "floors": [],
  "materials": { "path": "Sand" },
  "parts": [
    { "name": "north", "plan": "Cottage.json", "at": [4, 4], "rot": 0 },
    { "name": "east",  "plan": "Cottage.json", "at": [40, 6], "rot": 1 }
  ],
  "paths": [[9, 16, 10, 31], [9, 23, 45, 24]],
  "spots": { "start": [9, 20], "well": [27, 20] }
}
```

- `parts`: sibling files under `3d/Structures`, each at a corner `at` in
  the plan's cells, turned `rot` quarter turns, grown `scale`. A part may
  carry `materials` of its own, laid over the plan's, so one cottage file
  stands as stone here and timber there. A stamped
  plan of parts is one building: it moves and turns as one.
- `paths`: paved strips `[x0, y0, x1, y1]` (floor slabs of the `path`
  material, or a fifth entry naming one).
- `shapes`: `[{ kind, at: [x, y], z, size: [w, h, d], angle, tilt, roll,
  offset: [ox, oy], sides, taper, material }]`, the free pieces on a plan:
  `box`, `wedge`, `pyramid`, `prism`, `hull`, `spike`, `cylinder`, `capsule`,
  `tube`, `cone`, `dome`, `sphere`, `dish`, `fin`, `arch`, `tunnel`, `ring`.
  A `hull` and a `spike` are sided prisms fitted to their box (`sides` 3..32,
  four sides is a box) whose top is `taper` as wide as their bottom (0 a
  point, 1 straight; a hull wears 8 and 0.8, a spike 6 and 0); a `capsule` is
  a column with domed ends, a `dish` a shallow bowl, a `fin` a swept plate
  standing on its root with a tip `taper` as wide (0.4). A ship is hull
  segments end to end, capsules for engines, fins rolled flat for wings, a
  dish on a spike for a sensor. `at` is the cell under the shape's middle and `offset` a
  nudge of the middle within it (tiles, -0.5..0.5); `z` (quarter tiles) is
  where its bottom sits; `angle` turns it about the vertical, `tilt` and
  `roll` about its own middle, and a turned shape rests on its lowest corner,
  so a rolled cylinder lies on the ground. A tower is a `cylinder` five across
  and eight tall with a `dome` at `z` 8 on it; a tent is a `cone`; a corridor
  a `tunnel` with an `arch` at each end. A tube, a ring, an arch and a tunnel
  are hollow: only their walls block, so they are walked into and through.
  `material` falls back to the wall's. A quarter turn of the plan adds ninety
  degrees and turns the offset; tilt and roll are the shape's own and stay.
  A `cylinder`, `tube` or `ring` may go part way round: `sweep` in degrees,
  the arc centred on the shape's back so the opening faces forward (a tube
  swept 230 is a horseshoe deck, a thin tube segment a curved console); a
  `tube` or `ring` may have a `thick` wall (a fraction of its half width;
  a rail is 0.04). Steps of up to three quarters of a tile are walked, so a
  raised deck 0.7 tall is walked up onto with no stair.
- `effects`: `[{ name, type, at: [x, y], z, ... }]`, what the building
  shows, the way a model's effects are attached: a `screen` (a media surface
  on a wall: `facing` the room, `width` and `height` in tiles, `media` a
  movie under movies/ or a picture under img/pictures), a `light` (`color`,
  `radius`, `intensity`, a map light) or an `animation` (a database
  `animation` id, played over and over on a parallel event). A stamp writes
  them onto the map marked with the building's group; a re-stamp or a
  removal takes only its own. `roof: { pitch: null }` is a building with no
  roof at all. Materials named `Glass…` draw see-through and `…Glow` draw
  lit from within, with no image needed (without one a `…Glow` shines a colour
  read from its name: `LampGlow` warm, `ForgeGlow` orange, `ScreenGlow` cyan); every window gets a pane of
  `materials.glass` (`Glass` unless the plan says).
- `spots`: named cells. A stamped building keeps them in its record as
  map cells, prefixed by the part's name (`north.bed`), so a story can
  say "the innkeeper stands at `inn.counter`". A plan of parts is walked
  from its `start` spot.

### People at spots

```json
"spots": { "desk": [52, 25] },
"events": [{ "spot": "desk", "name": "Steward", "template": "villager", "direction": 2 }]
```

`template` names a file under `3d/Structures/events` holding an ordinary
RPG Maker event (its pages are used; id, x and y are not). Stamping puts
the event on the map at the spot with `<structure:N><spot:name>` in its
note. Move or turn the building and the event moves with it; edit its
pages by hand in the event editor and the edit stays through a re-stamp,
because the event is found by its tag, not made again. Remove the
building and its events go. A part's events keep the part's prefix
(`north.table`).

Stamp it from a shell, which levels the ground under it, moves placed
models off the footprint, and reports which rooms the engine can walk to
from the front door:

```
node editor/build-scripts/build-structure.cjs <project> <mapId> <plan.json> <x> <y> [--check]
```

`--check` writes nothing. To check a whole map at any time:

```
node editor/build-scripts/validate-map.cjs <project> <mapId>
```

which reports pieces off the map, materials with no image, models standing
inside a building, rooms that cannot be walked to, uneven ground under a
building, and the piece, triangle, model and light counts. A room reported `MISS` means the plan has a door
into a wall or a stair that lands nowhere; fix the plan, not the pieces.

In the editor the same plan is a card on Database › Structures and a
choice in the Build bar's Blueprint slot, which stamps it where you click;
Select picks pieces up again, and a box dragged round a building selects
all of it to move or turn. A building keeps its plan in
`structures: [{ group, plan, x, y, rot, scale }]`, and turning or scaling
builds it again from the plan. **Editing a stamped building by hand
detaches it from its plan**: the hand edit stays, the building still moves
and turns as one, scale is off.

## Water

```json
{ "x0": 8, "y0": 30, "x1": 20, "y1": 40, "level": 0.4, "material": "Water" }
```

A sheet over the cells `x0..x1, y0..y1` (inclusive) at world height
`level`. The ground decides what it is: water up to the swim depth
(`reactorPhysics.swimDepth`, 2.2 tiles by default) is waded on its bottom;
deeper water is swum, entered from its bank or by a fall, and left onto a
bank no more than a step above the surface. With swimming off, water
deeper than 0.45 tile cannot be walked into. So a lake is terrain lowered under a sheet, a beach is the slope at
its rim, and a river is a long thin sheet over a trough. `material` is an
image under `img/materials`; the runtime waves it, tints it by depth and
fades it out at the shore. Optional `reflect` and `gloss` (0-1) and `tint` (`#rrggbb`) make it mirror the
world through its waves: `reflect: 1, gloss: 0.92, tint: "#d8dde3"` is mercury.

### Rivers and waterfalls

```json
{ "x0": 20, "y0": 140, "x1": 120, "y1": 175, "mask": "…", "material": "Water",
  "path": [[25.5, 170.5, -4.91], [60.5, 172.5, -5.2], [110.3, 155.8, -5.6], [112.7, 154.2, -13.94]],
  "flow": 1, "level": -4.91 }
```

A sheet with a `path` is a river: its centre line, upstream first, in tiles
(a cell's middle is x + 0.5), with the surface's height at each point.
The surface follows those heights, smoothly round bends and changes of
slope, and the image runs downstream, faster where it drops, white where
it is fast; it is clear over the shallows and dark where it runs deep. A stretch dropping more than a tile per tile of run is a
waterfall: a falling curtain from its lip to its foot, foam, spray and mist where it lands.
`flow` (0-4, default 1) scales the current; 0 is still. `level` is the
path's highest point, for older readers. The mask says which cells are wet,
as for a pond.

In the game a river carries a swimmer downstream (and a wader where it runs
fast) while they take no step of their own, and a waterfall is gone down,
never swum up. Where a river runs into a lake the lake draws the water.

The Build bar's **River** slot lays one: click along the course, upstream
first, then double-click or press Enter (Esc drops the course). It carves
the channel (Width across, Depth under the surface), starts a little under
the ground at the first point or at the level of a lake it starts in,
follows the ground down and never up, falls where the ground drops, and
ends at the level of a lake it runs into. One undo takes the river and its
channel back. The same from a shell:

```
node editor/build-scripts/carve-river.cjs <project> <mapId> <course.json> [--width 3] [--depth 1] [--flow 1] [--material Water] [--check]
```

`course.json` is `[[x, y], ...]`; points that all carry a level
(`[[x, y, level], ...]`) keep those heights. The channel only ever lowers
the ground, so rocks and pieces in its way stay: lay the river first, or
clear its course. `validate-map.cjs` reports a course that leaves the map,
runs uphill or has no wet cell.

## Terrain and elevation

`terrain` is a height at every tile corner, bilinear between; `elevation`
is a whole number per tile that the tile builder turns into terraces with
cliff faces. Both add. A generator writing hills should write `terrain`
and keep slopes under 0.75 tile per tile where characters must walk;
`build-structure.cjs` levels a building's pad itself.

On a shaped map the room floor is laid from the sides as well as from
above where the ground leans, so slopes do not streak, and past a slope it
turns to rock:

```json
"room": { "floor": "!Grass-01", "cliff": "Rock", "cliffSlope": 40, "cliffTint": "#a99f93" }
```

`cliff` is an image under `img/materials` (absent: `Rock` when the project
has it; `""`: off), `cliffSlope` the angle in degrees where the change
begins (10-80, default 40), `cliffTint` a colour multiplied in as a rock
piece's `tint`, so terrain cliffs match the rocks beside them. Map
Properties › 3D sets all three.

## Foliage

```json
"foliage": {
  "wind": { "dir": 30, "strength": 0.6, "gust": 1 },
  "layers": [
    { "kind": "grass", "density": "0x812 4x6 7x3", "height": 0.8, "colour": "#4a7a30", "tip": "#b9c862", "vary": 0.25, "seed": 1 }
  ],
  "bushes": [ { "x": 41.5, "y": 30.2, "size": 2, "colour": "#3f6b2b", "bloom": "#f3c6dc", "tall": 1.2, "seed": 7 } ]
}
```

A layer is one `kind` (`grass`, `flowers`, `fern`, `reeds`) painted over
the whole map: `density` is a level 0-9 per cell, row by row, written as
runs (`0x812` is 812 cells of none, `7` one cell at level 7, trailing none
left off). Blades are not stored; the runtime grows them from the density
by a seeded scatter, on the ground where it is drawn, so they follow the
terrain. Nothing grows where a piece or a rock stands on the ground, under
water (reeds stand in water up to about 0.9 tile deep), or on a slope the
room draws as cliff. `height` is in tiles, `colour` the root and `tip` the
tip (as they read in daylight), `vary` how much each clump differs, `seed`
which scatter; `flowers` also takes `colours`, the petals to pick from.
Leave a key out for the kind's own look. A bush is a seeded mass of leaves
at `x`, `y` (tiles), `size` wide (0.4-8); `tall` makes it taller than wide,
`bloom` gives it blossom. A bush 1.4 or more wide blocks the cells it
covers; smaller ones are walked through. `wind` blows toward `dir`
degrees (0 east, 90 south) at `strength` (0-2), with `gust` rolling over
it; whoever walks through the grass bends it.

In the editor the Build bar's **Foliage** group paints a kind with a brush
(size, strength, density; Erase thins it), stands bushes by click or
scatters them by drag, and sets the map's wind; each stroke is one undo
step. To fill a map by rule:

```
node editor/build-scripts/paint-foliage.cjs <project> <mapId> <spec.json> [--check]
```

where `spec.json` names fills (`kind`, `level`, `where`: a `rect`,
`polygon` or `all`; `rules`: `maxSlope`, `awayFromPieces`, `nearPieces`,
`awayFromWater`, `nearWater`, `noise` for natural patches), scattered
bushes (`where`, `count`, `size` [min, max], `spacing`, `rules`) and the
wind; the script's header has the full shape. Density thins with distance
from the eye (`Reactor3D.FOLIAGE_LOD`, less on weak graphics) and the
blades stay out of reflections.

## Time of day

The map's ambient (`lighting.ambient`, `lighting.ambientColour`; the
Lighting tool's Day, Dusk and Night presets) says what time it is, and a
sun follows it: as authored by day, lower and amber at a warm dusk, a dim
pale-blue moon at night that still casts. On a map with a sky image the
sky and the reflections of shiny surfaces darken and tint with it. A sun
that should keep its authored light whatever the hour says
`"daylight": "fixed"` (Lighting tool › the sun's Follows time of day).
Lamps, fires and Glow materials keep their own light, so they stand out
at night. A map with no sun and no sky (indoors) is unchanged.

## What is not here yet

Furniture inside rooms, hip roofs, and a per-transfer floor (a transfer always lands on the ground
floor). Add them to this page as they land.

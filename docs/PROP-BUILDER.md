# 3D Prop Builder

Forge › 3D Prop Builder makes props and saves them to the project as 3D models. Pick a type in the left column: sections (Banners & Flags, From Picture, Weapons, Wearables, Tools & Gear, and more as kinds are added) hold short groups. Click a section's header, or press Enter or Space on it, to fold it; folds last for the session. A search shows every matching type, its section open.

**Randomize** rolls a new take on the current type; the list beside it picks what changes: **Everything**, or only the **Shape**, the **Colors**, or the **Design** or **Details**. Undo takes a roll back.

## Banners & Flags

- **Flag, Streamer, Banner:** a flag on a pole, a long pointed streamer, or a tall banner down the pole.
- **Pole:** a metal flagpole, a wooden staff, a wall bracket or a crossbar banner. Height, finial (ball, spearhead, eagle, none), the halyard rope on a metal pole, and colors. Wall brackets have a separate Placement height; their studio wall and saved placement follow it.
- **Cloth:** shape (1:2 to 1:1, streamer, pennant, swallowtail, the tall 3:2, 2:1 and pole banner, or Custom), width 0.15 to 6 m, height up to the pole, the fly end (square-cut, swallowtail, pointed) and fabric (cotton, silk, heavy wool, worn and tattered).
- **Design:** a background pattern and up to eight emblems over it.
  - Patterns: solid, bands (2 to 5 either way, each its own size), stripes, cross (its arm width, centered or toward the hoist), saltire, quartered, checkered, diagonal bend, canton (its size, corner and a grid of stars), hoist triangle, border, or a whole-flag picture. Each region has its color.
  - Emblems: star, circle, crescent, shield, sun, eagle, cross, crown, sword, laurel wreath, cogwheel, skull, tree, or a picture from `img/pictures` (its own colors or one color). Place one at a snap point or freely, then its size, turn, color and mirror; repeat it as a ring or a row. ▲ ▼ reorder the list, ✕ removes one.
  - Presets: made-up kingdoms, cities, guilds, houses, a republic and an order.
- **Wind:** calm to storm, gusts, and the direction.
- **Hanging banners:** banners on a pole, an iron rod, a rope or a wire, 1 to 8 tiles long. Its ends rest on wall brackets or posts, or run from wall to wall. A rope or wire sags in a catenary. Banners come as rectangles, swallowtails, points or bunting. Each banner can have its own place and length, and every other banner can carry the second design. The prop's origin is the middle of the span on the ground, and the span runs along x. Turn it 90° for a north–south street. The readout gives the size to place it at.

## From Picture

Choose a picture from `img/pictures`, then:

- **Cut-out:** the picture's outline as a solid board, from its transparency or with its border color taken away. Height, thickness, edge, back and stand. A picture in pieces sits on a backing plate.
- **Turned:** half an outline turned round: a pot, vase, bottle or column, from the picture's silhouette or points dragged over it. Height, segments, top, wall thickness and surface.
- **Framed:** a painting, poster, hanging banner, crate or book.
  - Frames: plain modern, ornate gilded (carved molding, rosettes and shells), rustic wood, thin metal, shadow box, clip frame, or none. Each has a width, depth, rounded or beveled edge, and material (gold leaf, silver, dark or light wood, painted, black metal).
  - A frame can have a mat and glass. It hangs from a wall hook or stands on an easel or a table stand.
  - Presets: museum gilded, gallery modern, rustic, poster in a clip frame.
  - A crate takes its wood, metal or rope banding, and its picture on all sides or the front only; a book takes its cover color, thickness and spine bands.

## Weapons

- **Swords & Blades:** longsword, katana, scimitar, rapier, greatsword, dagger, machete, falchion.
  - Blade: length, width, curve, taper, thickness, tip, single or double edge, fuller and serrations.
  - Hilt: crossguard, disc or basket guard with its size and the bend of its arms; the grip's length, wrap and color; the pommel.
  - Look: steel, damascus or bronze; steel, gilded, bronze or black iron trim; a glowing edge or blade.
- **Firearms:** pistol, revolver, rifle, shotgun, submachine gun, sniper rifle. **Sci-fi:** energy sword, blaster pistol and rifle, plasma cannon, laser rifle.
  - Parts: barrel, receiver, grip angle, magazine (box, drum, revolver cylinder, tube, energy cell, none), stock, sight, muzzle (plain, brake, suppressor, emitter), rails, forend, glowing coils and vents.
  - Finish: gunmetal, polymer, chrome or painted panels; wood or polymer furniture; the glow color.
- **Axes, Bows & Shields:** the Character Builder's axe, spear, staff, bow and round shield.

Every sword and gun saves a hand rig (`rig.template` blade or gun, with its markers) in `model.json`. A character holds it through Database › Weapons the same way it holds an imported weapon.

## Wearables and Tools & Gear

The 3D Character Builder's accessories, each a standalone model: hats, face, masks, jewelry and ties, capes and packs, nails and claws, bags, tools, instruments and sports. Swords, daggers and books are listed once, under Swords & Blades and Framed; saved recipes of the accessory versions still open.

Background-color outlines remove matching color inside enclosed openings too, so rings and letters keep their holes. Use transparency outlines when same-colored interior details should remain solid. Still props keep their authored color; preview and game lighting shade their surfaces as they turn.

- **Shape:** overall size, then what the accessory has: style, fit, height or length, and its own options. A choker has its band (leather, velvet, metal links, lace), width, thickness, charm and studs.
- **Look:** the colors it shows, and a material for each of its parts (original, metal, leather, plastic, fabric, velvet, glass).
- **Placement:** origin (bottom for a map, center, or the attachment point for a character), the side it is worn on, and rotation. Single-layer pieces such as lenses and bands are two-sided.

## Containers

The Containers section offers wine and wooden barrels, oil and explosive drums, supply and ammunition crates, stacked crates, a treasure chest, cargo crates, fuel canisters, coolant cells and data crates.

**Shape** sets size and construction: barrel staves and hoops, drum ribs, crate braces and handles, chest lids and locks, and futuristic panels and bumpers. Round containers can lie on their sides; crates can stack. **Look** sets colors and wear. **Markings** adds text, symbols or a project picture. Futuristic containers also have **Lights**, with status lamps, glowing strips and text, numeric, progress or picture displays.

Randomize keeps the current container type. Its scope chooses **Shape**, **Colors**, **Details** or **Everything**. A Colors roll preserves geometry and light timing; a Details roll preserves the chosen palette and size.

## Saving

**Save to Project** writes `3d/Props/<name>/`:

- `source/<name>.glb`: the model with its pictures inside. Cloth is skinned to bones and carries its loop as the clip **Wave**. The loop lasts three seconds and is baked from the cloth simulated in the tool, so nothing is simulated in the game.
- `model.json`: the Wave clip playing always and the model's origin placed where the prop stands. Every prop rests on the floor except wall-hung ones (a painting on a hook, a bracket flag, a span on brackets), which keep their height. Weapons add their hand rig; hanging banners add `span` (length in tiles, axis, origin).
- `prop.json`: the recipe, for **Open…**. `thumbnail.png`: the picture Open shows.

The model shows in Database › 3D Models like an imported one.

Animated container lights and displays use a saved **Lights** clip and emissive materials. The game plays the clip; it runs no container simulation. Ordinary barrels, crates and chests remain still.

## In the game

The game lights each face by the way it turns. Still props also carry a soft form shading in their colors, so carving reads under any light. Glowing edges, coils and emitters glow (glTF emissive).

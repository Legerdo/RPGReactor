# 3D Character Builder

Forge › 3D Character Builder makes a character with sliders and pickers and saves it to the project as a rigged 3D model: a human or humanoid of any species, or a four-legged creature.

## The page

- **Species:** Humanoid or Four-legged. A species tile (Elf, Dwarf, Orc, Lizardfolk, Catfolk, Tiefling, Android and more) sets the body, face, skin, eyes and features to start from; everything stays editable. Features add horns, animal ears, a tail, wings, a beak, tusks, spines or whiskers to any humanoid, each with its size and colors. Four-legged offers cat, lion, tiger, dog, wolf, fox, deer, horse, bear, boar, rabbit, bull, ram and drake, with ears, tail, horns, feet, wings and mane.
- **Slimefolk:** shiny, see-through goo with big glossy eyes, a body of its own. **Shape** runs from a slime mound to a goo person whose legs melt into a puddle; then size, feelers (antennae or tendrils), color, core color, translucency, glow, bubbles and their size, iris and eye size. It wears hats only, sitting on top and sunk a little into the goo. Switching to or from it starts the other species fresh.
- **Body:** gender, age, height, weight, muscle, **Proportions** (Average to Ideal: MakeHuman's idealized build with a refined face, 70% by default), head size, bust and firmness, then proportions (limb lengths, hand, foot size, length and width), torso, bust, arms and legs (fat and muscle per limb, calves), and toe length. Muscle past average adds bulk; weight and muscle combine (heavy and strong).
- **Body hair:** locks of fine hairs grown out of the skin, as head hair is, over a hair-colored tint that carries it from afar. An amount, a pattern (light, natural, very hairy, furry body, werewolf) and every region on its own (face, neck, chest, belly, back, shoulders, upper arms, forearms, hands, armpits, pubic, buttocks, thighs, lower legs, feet); its color is the hair's unless chosen. **Fur** adds a fur coat over the skin, with its length. The Werewolf species starts furred all over.
- **Anatomy:** off unless **Anatomical detail** is checked (Randomize leaves it as set). Then nipples and areolas (size, color), and genitals by **Shown as** (by gender, male or female): length, girth and testicles, or mons, labia and fold depth. Clothing covers them.
- **Face:** **Ancestry** first: a **Heritage** choice of the world's peoples (European, Middle Eastern and North African, Sub-Saharan African, South, Central, East and Southeast Asian, Native American, Latin American, Pacific Islander, Aboriginal Australian, or Mixed) sets the face's blend and a skin tone from that people's range, and the African, Asian and European mix under it fine-tunes the face. Then head shape, forehead and brows, eyes (an **Eye style**: natural, anime or small; eye size up to very large, width and tallness), nose, mouth and jaw, ears, a snout or muzzle, a flat face (for a beak), and hidden ears with ear holes.
- **Hair:** 45 styles with color, tip color, length, volume, curl, bangs, receding hairline, highlights and part; strand-based styles also have density, frizz and lock thickness controls. Cornrows, short locs, ringlets, asymmetric bobs, half-up hair, side braids, braided ponytails and double buns extend the catalog. There are 20 facial-hair choices, including None; brows (painted on the brow ridge, so they follow any face) and lashes.
- **Outfit:** Dress as a preset (Everyday, Fantasy, Armor, Sci-fi) or add garments one by one. Each garment has its colors, trim, pattern, material and its own knobs (sleeves, length, neckline, looseness, flare, open front, bulk). One garment per slot; armor goes over clothes.
- **Accessories:** glasses, sunglasses, monocle, eye patch, goggles, visor, hats, crown, helmets, earrings, necklaces, bracelets, cape, scarf, backpack, quiver, jetpack, bow tie.
- **Colors:** skin color and markings (freckles, scales, stripes, spots, fur, feathers, decay, panels, tribal marks, patches), belly color, lips, blush, eye shadow; iris color and size, pupil shape and size, catchlights, the whites of the eyes. Color fields open the editor's own color picker. A creature has its coat pattern and colors here.

### Community-inspired generated choices

The [MakeHuman asset packs](https://static.makehumancommunity.org/assets/assetpacks.html) provide references for a broader procedural catalog. This expansion adds 34 garment cuts, 29 accessories, 10 hairstyles, five facial-hair styles, six skin patterns, eight skin finishes, nine outfit presets, and Vampire and Insectfolk starting points. All these additions are generated from code and the builder's existing body/helper geometry; no new community meshes, textures, Blender libraries or target files are installed. Existing Modeled and Star Shift choices remain separate.

| Community family | Builder coverage |
| --- | --- |
| Shirts, pants, skirts and dresses | New polos, cardigans, crop tops, off-shoulder blouses, flared/capri/cargo trousers, pleated/pencil skirts, ball/evening gowns, a high-collar slit dress and a tailcoat. Including armor and headwear, the procedural garment catalog now has 82 choices. |
| Underwear, swimwear and hosiery | Separate briefs, boxers, bandeau/sports bras, bikini top, swim briefs/trunks, swimsuit, socks, stockings and tights. Underwear and hosiery have their own slots under outer clothes and footwear. |
| Work, sports and performance outfits | Coveralls, scrubs, service uniform, apron, tennis/ballet dresses, wetsuit and triathlon suit; outfit presets combine matching pieces. |
| Gloves and body parts | Opera and fingerless gloves, nails and claws; full gloves hide nails without removing the choice from the recipe. Antennae, upper fangs and insect wings join existing horns, tails, animal ears and wings. |
| Masks, hats, glasses and jewelry | Domino/cloth masks, respirator, headset, beret, sun hat and necktie join the existing eyewear, helmets, hats and jewelry. |
| Equipment | Swords, dagger, axe, spear, staff, bow, shield, hammer, pickaxe, lantern, book, umbrella, suitcase, satchel, pouch, canteen, microphone, guitar, tennis racket and stethoscope. Held items save with the character and follow the selected hand; one item fits each hand. |
| Hair and fur | New styles and strand controls above. Existing body-hair regions cover the face, neck, trunk and individual limbs; the supplied `haireditor.zip` was inspected as a reference for its hair/fur curve categories without importing its Blender files. |
| Skin and face details | Moles, scars, veins, stone, marble and lava cracks. Colors › Apply skin finish offers freckled, beauty-mark, scarred, stone, marble, volcanic, frost and moss settings; individual settings remain editable and chosen makeup is preserved. |
| Deformations, poses and expressions | Existing body/face sliders, 33 preview poses, expressions and visemes already cover these families; this expansion adds no motion or expression asset downloads. |

The deeper comparison used the official inventories for [hair](https://static.makehumancommunity.org/assets/assetpacks/hair02.html), [dresses](https://static.makehumancommunity.org/assets/assetpacks/dress03.html), [thematic suits](https://static.makehumancommunity.org/assets/assetpacks/suits03.html), [equipment](https://static.makehumancommunity.org/assets/assetpacks/equipment03.html), [masks](https://static.makehumancommunity.org/assets/assetpacks/masks01.html), [gloves](https://static.makehumancommunity.org/assets/assetpacks/gloves01.html), [body parts](https://static.makehumancommunity.org/assets/assetpacks/bodyparts03.html), and underwear/hats inventories. The original community landing page returned HTTP 502 during review; MakeHuman's [download guide](https://static.makehumancommunity.org/assets/downloadassets.html) identifies the packs as collections from the community repositories. Coverage is by design family; individual contributed models are not reproduced one for one.

**Extreme proportions** (Body and Face) lets every slider run past its natural range, the natural part of each track shaded: weight from rail thin to bed-bound, and belly, butt, hips, limb fat and the bust swelling round and heavy. **Anatomical detail** sits beside it on the Body tab.

Hair styles, facial hair, brows, species, outfits, garments and accessories are chosen from pictures of each one on the character as it stands; the pictures fill in a moment after the sliders rest and are kept in the editor's data folder, so opening the builder again shows them at once. Every section folds by its header.

**Randomize** rolls a new character, or only the part chosen beside it (Body, Face, Hair, Outfit, Colors). **Reset** returns to the species' starting point. **↶ ↷** undo and redo. In the view, drag to turn and use the wheel to zoom. The **Pose** dropdown on the right is searchable and sorts the translated names alphabetically. It offers the current body's poses, including A-pose (Still for slime) and Idle, without covering the preview with a long list; **Whole body** and **Face** frame the view. Preview poses do not change the saved Idle.

**Power armor** and **Space marine** use beveled chest/back plates, tapered limb housings, separate shoulder, elbow and knee protection, a dark flexible undersuit and a matching power helmet. Plate surfaces follow their carrying bones rigidly, with gaps at the joints. Bulk and colors remain editable. The same accessories offered here are also available as standalone equipment in [Prop Builder](PROP-BUILDER.md).

## Saving and opening

**Save to Project** writes `3d/Characters/<name>/`:

- `source/<name>.glb`: the model, skinned on a humanoid skeleton named the Mixamo way (a tail adds `Tail`…`Tail5`), with its pictures inside (`skin.png`, `eyes.png`, `outfit.png`, `hair.png`, `lashes.png`, `brows.png`, and `bodyhair.png` and `areola.png` when used), shading baked into its vertex colors (creases, under the chin, where clothes overlap), and an Idle clip.
- `character.json`: the recipe. **Open…** shows every saved character as a picture; choosing one loads it to edit, and saving under the same name replaces the model.
- `thumbnail.png`: the picture Open shows.
- `model.json` (four-legged and Slimefolk): a creature's quadruped rig, so the built-in walk and idle motions play; a Slimefolk's wet surface. Other settings the 3D Models page keeps there stay.

A Slimefolk's GLB carries its goo picture and glow picture (`goo.png`, `goo-glow.png`, the glow as the material's emissive) and six clips: Idle, Walk (a hop or an ooze), Attack, Hit, Death (a melt into a puddle) and Talk.

The model shows in Database › 3D Models like an imported one. A humanoid's Rig tool places every marker from the bones.

## Sprite sheets

**Export sprite sheet…** (beside Save to Project) draws the character into a sheet the game uses as it is, with transparent edges, and writes it to the project:

| Sheet | File | Cells |
| --- | --- | --- |
| 8 directions [8D] | `img/characters/$Name[8D].png` | 12 × 8 frames, default 100 px |
| 4 directions | `img/characters/$Name.png` | 3 × 4 frames, default 48 px |
| Side-view battler | `img/sv_actors/Name.png` | 9 × 6 cells, default 64 px |
| Face portraits | `img/faces/Name.png` | 4 × 2 portraits, the project's face size |

**Frame size** sets the cell. **Camera angle** is how far the camera looks down (30° by default; 15° for a battler). **Outline** draws a one-pixel dark edge. Portraits are head and shoulders, front or three-quarter, eight expressions from a preset (Everyday, Battle, Story) or picked one by one, the eyes on one line in every cell, on a transparent or solid background. Every frame uses one scale, centered, its feet on the same baseline.

The [8D] sheet, by blocks of 3 frames × 4 rows (rows down, left, right, up; diagonal rows down-left, down-right, up-left, up-right):

| | Columns 1–3 | 4–6 | 7–9 | 10–12 |
| --- | --- | --- | --- | --- |
| Rows 1–4 | walk | walk, diagonals | dash | dash, diagonals |
| Rows 5–8 | carry (arms up) | carry, diagonals | attack | jump, guard, cast, down (facing down) |

Each walk row is MZ's three frames: a step, standing, the other step. The side-view sheet holds MZ's 18 motions in order (walk, wait, chant, guard, damage, evade, thrust, swing, missile, skill, spell, item, escape, victory, dying, abnormal, sleep, dead), each from the closest pose the character has.

## Not yet

Crowds of characters at once, binding a saved character to an actor from the page, other body plans (birds, serpents, insects), and hair or clothes that move on their own.

## Where the body comes from

The base mesh, shape targets, skeleton, eyes and clothing helpers are MakeHuman's, released CC0 (no credit needed, any use). `editor/build-scripts/build-human-pack.cjs` converts them from a checkout of the makehuman repository into `editor/src/forge/Character3D/data/`; the sliders it converts are listed in `HumanTargets.js`. Garments, hair, accessories, species features, creatures and painted skins are generated by the builder.

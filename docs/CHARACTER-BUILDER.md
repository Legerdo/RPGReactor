# 3D Character Builder

Forge › 3D Character Builder makes a character with sliders and pickers and saves it to the project as a rigged 3D model: a human or humanoid of any species, or a four-legged creature.

## The page

- **Species:** Humanoid or Four-legged. A species tile (Elf, Dwarf, Orc, Lizardfolk, Catfolk, Tiefling, Android and more) sets the body, face, skin, eyes and features to start from; everything stays editable. Features add horns, animal ears, a tail, wings, a beak, tusks, spines or whiskers to any humanoid, each with its size and colors. Four-legged offers cat, lion, tiger, dog, wolf, fox, deer, horse, bear, boar, rabbit, bull, ram and drake, with ears, tail, horns, feet, wings and mane.
- **Body:** gender, age, height, weight, muscle, head size, bust and firmness, then proportions (limb lengths, hand, foot size, length and width), torso, bust, arms and legs (fat and muscle per limb, calves), and toe length. Muscle past average adds bulk; weight and muscle combine (heavy and strong).
- **Body hair:** an amount, a pattern (light, natural, very hairy, furry body, werewolf) and every region on its own (face, neck, chest, belly, back, shoulders, upper arms, forearms, hands, armpits, pubic, buttocks, thighs, lower legs, feet); its color is the hair's unless chosen. **Fur** adds a fur coat over the skin, with its length. The Werewolf species starts furred all over.
- **Anatomy:** off unless **Anatomical detail** is checked (Randomize leaves it as set). Then nipples and areolas (size, color), and genitals by **Shown as** (by gender, male or female): length, girth and testicles, or mons, labia and fold depth. Clothing covers them.
- **Face:** head shape, forehead and brows, eyes (an **Eye style**: natural, anime or small; eye size up to very large, width and tallness), nose, mouth and jaw, ears, a snout or muzzle, a flat face (for a beak), hidden ears with ear holes, and the ancestry mix.
- **Hair:** 35 styles with color, tip color, length, volume, curl, bangs, receding hairline, highlights and part; facial hair; brows and lashes.
- **Outfit:** Dress as a preset (Everyday, Fantasy, Armor, Sci-fi) or add garments one by one. Each garment has its colors, trim, pattern, material and its own knobs (sleeves, length, neckline, looseness, flare, open front, bulk). One garment per slot; armor goes over clothes.
- **Accessories:** glasses, sunglasses, monocle, eye patch, goggles, visor, hats, crown, helmets, earrings, necklaces, bracelets, cape, scarf, backpack, quiver, jetpack, bow tie.
- **Colors:** skin color and markings (freckles, scales, stripes, spots, fur, feathers, decay, panels, tribal marks, patches), belly color, lips, blush, eye shadow; iris color and size, pupil shape and size, catchlights, the whites of the eyes. Color fields open the editor's own color picker. A creature has its coat pattern and colors here.

**Extreme proportions** (Body and Face) lets every slider run past its natural range, the natural part of each track shaded: weight from rail thin to bed-bound, and belly, butt, hips, limb fat and the bust swelling round and heavy. **Anatomical detail** sits beside it on the Body tab.

Hair styles, facial hair, brows, species, outfits, garments and accessories are chosen from pictures of each one on the character as it stands; the pictures fill in a moment after the sliders rest and are kept in the editor's data folder, so opening the builder again shows them at once. Every section folds by its header.

**Randomize** rolls a new character, or only the part chosen beside it (Body, Face, Hair, Outfit, Colors). **Reset** returns to the species' starting point. **↶ ↷** undo and redo. In the view, drag to turn and use the wheel to zoom; **A-pose** and **Idle** switch between the modeling pose and the saved Idle animation; **Whole body** and **Face** frame the view.

## Saving and opening

**Save to Project** writes `3d/Characters/<name>/`:

- `source/<name>.glb`: the model, skinned on a humanoid skeleton named the Mixamo way (a tail adds `Tail`…`Tail5`), with its pictures inside (`skin.png`, `eyes.png`, `outfit.png`, `lashes.png`, `fur.png`), shading baked into its vertex colors (creases, under the chin, where clothes overlap), and an Idle clip.
- `character.json`: the recipe. **Open…** shows every saved character as a picture; choosing one loads it to edit, and saving under the same name replaces the model.
- `thumbnail.png`: the picture Open shows.
- `model.json` (four-legged only): the quadruped rig, so the built-in walk and idle motions play. Other settings the 3D Models page keeps there stay.

The model shows in Database › 3D Models like an imported one. A humanoid's Rig tool places every marker from the bones.

## Not yet

Crowds of characters at once, binding a saved character to an actor from the page, other body plans (birds, serpents, insects), and hair or clothes that move on their own.

## Where the body comes from

The base mesh, shape targets, skeleton, eyes and clothing helpers are MakeHuman's, released CC0 (no credit needed, any use). `editor/build-scripts/build-human-pack.cjs` converts them from a checkout of the makehuman repository into `editor/src/forge/Character3D/data/`; the sliders it converts are listed in `HumanTargets.js`. Garments, hair, accessories, species features, creatures and painted skins are generated by the builder.

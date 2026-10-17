# 3D Character Builder

Forge › 3D Character Builder shapes a human body with sliders and saves it to the project as a 3D model.

## Making a character

- **Body:** gender, age (11 to 90 years), height, weight, muscle, bust, shoulders, hips, belly and neck. A heavy weight with little muscle reads as fat, with a lot of muscle as strong.
- **Face:** fullness, head width and height, nose width, length and bridge, ear size, pointed ears.
- **Ancestry:** a mix of African, Asian and European face and body features. Moving one slider rebalances the other two.
- **Skin:** a swatch or any color.
- **Randomize** rolls a new body. **Reset** goes back to the average.
- Drag the view to turn it; the wheel zooms, and close in it centers on the face.

## Saving

**Save to Project** writes the character to `3d/Characters/<name>/`:

- `source/<name>.glb`: the model, a skinned mesh with a 52-bone humanoid skeleton named the Mixamo way (Hips, Spine, LeftArm, LeftHandThumb1…), and an Idle clip in which the arms rest at the sides and the chest breathes.
- `character.json`: the recipe, the slider values. **Open saved…** loads it back to edit, and saving under the same name replaces the model.

The model shows in Database › 3D Models like an imported one. Its Rig tool places every marker from the bones, fingers included, and the Idle clip plays when the character stands still.

## Not yet

Clothing, hair, eyebrows, eye colors, a crowd of characters at once, and species other than human.

## Where the body comes from

The base mesh, shape targets, skeleton and eyes are MakeHuman's, released CC0 (no credit needed, any use). `editor/build-scripts/build-human-pack.cjs` converts them from a checkout of the makehuman repository into `editor/src/forge/Character3D/data/`.

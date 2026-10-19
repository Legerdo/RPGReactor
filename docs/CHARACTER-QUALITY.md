# Character Builder quality pass — 2026-10-18

This pass covers every catalog entry with a bounded set of contrasting slider profiles. It is not an exhaustive Cartesian product of all sliders, outfits, accessories and animation frames. Geometry checks are supplemented by visibility rays, software contact sheets and isolated NW.js rendering.

The second pass also reconciles Claude's thirteen agent reports, including the eleven paused agents, lighting and props. [The continuation tracker](CLAUDE-QUALITY-TRACKER.md) records each inherited issue separately; unresolved aesthetic and renderer limits remain explicit.

## Swimwear, imported boots and hair follow-up

Bikini now has two triangular cups, continuous narrow halter/back cords and a low-rise V bottom with hip ties. Body-surface triangle bindings carry the cords through slider changes; cached bindings contain no stale shaped positions. Five regressions cover intended exposed/covered regions, actual cup fabric, continuous front-side halters (including clavicle crossings), eight body profiles and cache round trips. Forty independent front-view probes check both cup interiors on average, heavy, compact/pendulous and male bodies, with a bottom-only negative control. The general full-bust coverage check applies to bras and shirts; a triangle bikini intentionally exposes the center chest. Eighteen actual NW captures cover normal, walking, sitting, heavy, tall and compact bodies, front/side/back, with finite geometry and no console/GL errors. Local comparison: `scratchpad/bikini-quality/comparison.png`.

Jolt Eagle, Max Triton and Vay Drokan boots have been regenerated from their original models. General import preparation preserves source sole pitch while aligning the foot heading, instead of pitching the foot with the shin. Feet/toes cannot enter the loose-cloth pass. Three independent regressions cover source sole orientation, 108 posed triangle-depth visibility views with a bare-foot positive control, and a fresh import/encode/decode/wear round trip. The three tests plus existing transfer/power-armor checks pass22 cases; import lifecycle passes eight. Actual NW inspection covers72 close-ups across the three outfits, three bodies and four rest/walking phases, with zero errors. Re-import old custom prepared outfits; re-save old character GLBs. Thin retained mask seam vertices are naturally occluded rather than forcibly hidden. Source push-off deformation and Vay's stretched robe rails remain separate appearance limits. Evidence: `scratchpad/imported-boots/`.

A matching female-uniform “floating tail” was reproduced as long hair whose middle entered a bulky armor backpack, leaving its root and flattened tip visible. Hair clearance now tests real garment faces and spreads the required displacement along connected locks, pinning the scalp. A broad four-corner back-plate regression checks2,379 middle vertices and fails against the old source. Fifteen hair checks and six actual Jolt/Max/Carol captures pass. Several ordinary clothing/style combinations retain exactly the previous geometry; thick armor can still produce sharp bends and small edge overlaps. No unwanted species tail was found in47 other outfit presets or24 female-uniform/cache-switch profiles; the owner's exact unidentified outfit remains unconfirmed. Evidence: `scratchpad/uniform-tail/hair-comparison.png`.

Preview revision14 invalidates earlier pictures. The final source snapshot repeats all1,314 static equipment builds and28,416 hiding probes with no failures (`/tmp/rr-swim-boots-equipment-final.json`); geometry checks do not certify all appearance combinations. The eight-variant real browser-worker smoke passes with an11.2ms peak independent heartbeat. Thirty focused Bikini/hair/worker/scheduler checks and55 broader model/hair/cloth regressions pass, including saved garment textures and seated-robe coverage.

## Second pass

Medieval armor follow-up: the owner identified inflated/melted Knight and Dark knight silhouettes despite the catalog's geometry checks. Their shared pieces now use formed rigid plates around the body and underlying fabric, replacing enlarged muscle-following clothing cuts. Shoulder lames are smaller, chest/waist forms are separated, thighs/shins articulate independently, knees have pointed shields and sabatons end below the greaves. Knight/Dark knight use shorter mail hems; Dark knight gains matching tassets. Paladin, Gladiator and individual pieces share these improvements. Preview revision13 invalidates earlier thumbnails. The current targeted tests cover all four presets on eight body profiles, actual mail occlusion, plate dimensions through motion and exclusion of toes from shin fitting. Actual NW captures inspect both sexes front/side/back, walking, kneeling, thrust, heavy and compact bodies. Large bust/heavy combinations still require a broad projecting cuirass; this is not an all-slider aesthetic clearance. Local before/after evidence is in ignored `scratchpad/knight-quality/`.

The final armor follow-up repeats all1,314 static equipment cases:28,416 hiding probes, zero reported failures (`/tmp/rr-knight-equipment-final.json`). Seven armor regressions and nine preview-scheduler checks pass. The actual browser-worker smoke now includes both knight presets among eight variants, with finite meshes, no Node/Model on the page and an11.4ms peak heartbeat. A broader54-case armor/model/catalog run passed53 cases; its one fixed-filename export assertion was updated to verify the actual generated footwear image, then passed on rerun. Thirty final actual NW captures (12 normal front/side/back and18 posed/extreme) have zero console/GL errors. The nine source hashes retain the tested implementation; the report notes a later header-comment-only change to Wardrobe.

- **564 fresh model builds:** all 28 humanoid species × 16 new body profiles, all nine heads × four profiles, all 14 creatures × four seeded mixed-extreme profiles, 16 Merfolk combinations and eight mixed Slimefolk/hat/material cases. Raw slider patches preserve each species' own head, morphs and features. No invalid geometry cases. `character-fresh-quality.cjs` retains exact recipes and source hashes.
- **1,314 fresh equipment builds:** every 110 garment, 49 outfit preset and 60 accessory ID across compact/lean, short/wide, tall/narrow, bust/narrow-hip, barrel-male and pear-female profiles. All 28,992 hidden-skin rays pass in the original second-pass snapshot. Source hashes preserve that version; the medieval follow-up is checked separately on its final sources.
- **780 moving garments:** all 26 modeled/transferred garments × six new bodies × three Walk phases, Sit and Kneel. All meshes remain finite. Of 24,960 vertex-normal probes, 40 graze nearby fabric at distances no greater than 1.15 mm. Of 18,720 independent interior face-center probes, one misses its normal ray but has fabric 0.33 mm away. These remain reported diagnostic risks, rather than being relabeled holes or hidden by enlarged masks. The measured unsupported area is 0.00000671 m² out of 5.362 m² sampled.
- **Compact bodies:** narrow hip/shoulder targets compose as relative widths; very short torso/neck lengths compress monotonically between carrying joints. The reproduced lean compact trunk drops from 241 to 10 reversed source-relative faces, and 239 to four against its own macro body before proportions. All three geometry regressions fail against the pre-pass source; skin/bone topology remains unchanged. Warmed Body.build median is 18.33→18.66 ms in this small diagnostic, not a whole-editor benchmark.
- **Cloth:** raised thighs now keep point and link contacts on the same carried side. The seated Human/Grey knee check improves from 210 misses to zero across 360 real fabric rays, preview and save. Standing dresses and kneeling hems retain free settling. Full clip/collider/floor/loop tests pass, including new thrust/bow motions; actual NW checks cover sitting, prone, heavy cape/robe kneeling and original dress seeds 2/8 in Idle.
- **Imported fabric:** signed radial offsets keep overlapping lower panels separate; fitted lower fabric relaxes without restoring source creases, with a small-face guard. Rigid Jolt/Max fits retain their previous path. Captain's reproduced rear crossing cluster falls from 85 to 13; a strict triangle-intersection regression guards that improvement. Broader tail/upper-body folds remain.
- **Poses and held equipment:** Thrust and Bow now have distinct arm motions and export/game slots. Accessories › Preview › Weapon can attach a saved marked sword or gun to RightHand for pose inspection. Selection changes, rebuilds and detach handle stale loads/resources; preview equipment is not baked into the saved character. Actual NW sword/pistol posing and walking pass.
- **Actual renderer and sustained switching:** reviewed front/back captures for 59 contrasting species/head/creature/Slimefolk recipes. Two earlier runs crashed after 42–44 switches as desktop preview workers were repeatedly replaced. Reusing one warmed worker, with stale-job cancellation, completes all 59 with thumbnails enabled and zero console/GL errors; sampled RSS peaks at 2,112 MiB and ends at 1,554 MiB. A thumbnails-disabled control also completes. See PERFORMANCE for scope and artifacts. These captures supplement geometry checks; tiny creatures in full-body views do not certify every facial detail.

Reproduce the additions:

```bash
node editor/tests/quality/character-fresh-quality.cjs --out=scratchpad/fresh-quality --render=none
node editor/tests/quality/character-outfit-accessory-quality.cjs --fresh --out /tmp/fresh-equipment.json
node editor/tests/quality/character-outfit-accessory-quality.cjs --fresh --motion --out /tmp/fresh-moving.json
node --test editor/tests/character-body-proportion-quality.test.cjs editor/tests/character-cloth-coverage.test.cjs editor/tests/character-held-preview.test.cjs
```

Second-pass evidence: `/tmp/rr-body-fresh/pass2-final-report.json`, `/tmp/rr-transfer-newpass/{catalog-final,motion-final}.json`, and ignored `scratchpad/quality-pass2/`. The latter includes actual held-equipment, robe/dress/hair and Reactor Room captures. A white-afro shell refinement was rejected after the enlarged view exposed persistent cap-like contours; it is not retained or claimed fixed.

## Coverage

| Catalog | Coverage |
| --- | --- |
| Species | All 28 humanoid presets across eight body/face profiles: 224 builds. Slimefolk has its own matrix below. |
| Selectable heads | All nine heads across five profiles: 45 builds. |
| Four-legged creatures | All 14 kinds across six profiles, including all 33 slider endpoints and alternating extremes: 84 builds. |
| Merfolk options | All three fins × five palettes × two tail lengths on contrasting extreme hips: 30 builds. |
| Slimefolk options | Three forms × two sizes × three feelers, with contrasting bubbles and eyes: 18 builds. |
| Garments and equipment | All 110 garments (84 procedural, 17 modeled, nine transferred), 49 outfit presets and 60 accessory IDs across eight profiles: 1,752 builds and 38,656 hidden-skin probes. The accessory count includes the saved-compatible necktie alias; eight empty `none` presets are intentional. |
| Moving modeled/transferred garments | All 26 pieces on average and maximum-heavy female bodies in three Walk phases, Sit and Kneel: 260 posed builds and 8,320 skin probes. These use actual weighted meshes; cloth simulation is checked separately. |
| Transferred source fits | All four shipped source outfits, 12 body profiles each: 48 source fits containing 108 wearable-part fits, with front/back renders on six profiles. |

The species/heads/body-plan matrix totals **401 builds**. Checks include finite positions, normals, UVs, colors and bones; normalized weights; valid indices; texture presence; head/neck and tail attachment continuity. Body profiles cover both sexes, short/lean, tall/strong, heavy female/male, narrow/long heads and broad/short heads. Exact normalized recipes are retained in each generated report.

Reproduce the species report and visual sheets:

```bash
node --test editor/tests/character-species-quality.test.cjs editor/tests/character-grey-quality.test.cjs
node editor/tests/quality/character-species-quality.cjs --out=scratchpad/species-quality/review --render=presets
node editor/tests/quality/character-outfit-accessory-quality.cjs --out /tmp/character-equipment-quality.json
node editor/tests/quality/character-outfit-accessory-quality.cjs --motion --out /tmp/character-moving-quality.json
```

## Fixes retained

- Grey: balanced preset proportions and silver-grey skin; local surface fairing before socket fitting; wider, less steeply tilted, shallower almond lenses. The base mesh topology and expression/slider bindings remain intact.
- Face camera: bounds come from the actual head and account for narrow viewports and orbit angles. Whole-body framing remains available.
- Thumbnail cameras: all 219 garments, presets and accessory IDs were rendered in the actual NW.js/WebGL catalog renderer. The sweep caught cropped hat crowns and long weapons; workers now send small head/feet/hand bounds, and cameras fit the full bounds into their frustum. Camera projection regressions cover tall hats, wide brims, necklaces, long weapons, claws and boot shafts at normal/large head sizes.
- Head accessories and horns: missing vertex slices are reconstructed from actual head-edge intersections rather than guessed dimensions.
- Facial hair: a strand that stops at its root contributes no invalid ribbon or UV coordinates.
- Merfolk: deeply folded hips and extremely short legs retain valid scale-line joins and nonzero tail girth; tail placement respects body scaling.
- Creatures: closed eye pole fans and shared wing roots remove invalid normals and collapsed tip geometry.
- Thin bodies: negative source-body blend weights no longer shrink the body before the separate volume pass. Inward offsets are limited by current bone clearance and backtracked before reversing skin triangles. In the combined short/lean diagnostic, reversed face directions fell from 521 to 118 (109 on the zero-extra-shrink reference); torso 118→1, legs 22→0. Residual extreme-proportion folding remains a visual limitation.
- Clothes: extreme soft garments use detailed body cuts when the helper surface no longer follows bust/crotch contours. Cut and atlas caches distinguish both surfaces; ordinary bodies retain their existing lighter geometry. Clothing visibility is checked independently of skin hiding.
- Modeled clothes: compact fabric backing follows the body's exact weights beneath authored covered triangles. UVs are projected in the reference shape and remain stable across sliders; necklines, cuffs, hems and transparent cuts stay bounded by the source garment. The detailed outer shell is retained.
- Browser previews: project-picture Maps survive crossing JavaScript realms, matching desktop behavior.

## Geometry cost

Except for the new physical Bikini cords, procedural average-body cuts keep their previous geometry. The new standard Bikini has5,674 garment triangles versus2,366 before; the earlier Bikini count below describes the pre-redesign sweep. On inspected heavy bodies, the combined garment and visible-skin increase is 124 triangles for Bikini, 836 for T-shirt, 249 for jeans and 693 for a dress. Modeled garment meshes, including backing, range from 4,702 to 22,352 triangles; the largest combined outfit has 39,503 garment triangles before the visible body/hair/accessories. Backing stores only referenced skin vertices.

## Remaining visual issues

Transferred Captain and other source outfits can still fold and self-intersect on very heavy bodies or extreme hip/limb combinations. Captain's fabric backing closes sampled skin gaps and the second pass reduces rear-panel crossings, but its outer surface is not uniformly smooth. The reproduced seated Human/Grey robe coverage failure is repaired; this does not certify every possible garment/pose combination.

The initial moving modeled/transferred sweep found 220 unsupported normal rays in 92 cases. These are coverage risks, rather than a count of visible holes: some directions change across a posed surface. Fabric backing repairs the confirmed large exposed islands; modeled pieces alone improved from 214 unsupported rays to 15 across 5,440 probes, with 2,448 additional interior-face probes passing. Single-point boundary/fold risks remain. Dense clothing and combined extreme body proportions still need visual checks beyond finite-number tests; very large bodies also retain the base mesh's visible faceting.

Software sheets help expose silhouette and coverage defects; they do not reproduce the editor's smooth shading, translucent materials or environment reflections. Grey was also inspected front/three-quarter/side/back in an isolated hardware-backed NW.js editor. Screenshots and generated reports live under ignored `scratchpad/species-quality/`; source-transfer audit evidence is under `/tmp/rr-transfer-quality/`.

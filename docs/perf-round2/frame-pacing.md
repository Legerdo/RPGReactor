# frame-pacing checkpoint (2026-10-14, paused by coordinator)

Evidence and scripts: `perf-round2-checkpoint/frame-pacing/` (scripts/: split.cjs main-thread/GC/alloc harness, run.sh, probes, summ.cjs; results/<run>/log.txt + split.json). Rules: S/round2-rules.md. The scratchpad copy of everything is in /tmp/.../scratchpad/frame-pacing (may be gone).

## First pass (done, reported)

Radeon iGPU, North Haven walk, ms/frame, before → after (after includes other agents' round-2 changes):
game state 0.37→0.33, 2D sprites 0.67→0.60, 3D sync 0.84→0.62, render submission 4.12→3.17, composite 0.52→0.48, main total 6.78→5.41; garbage 875→346 KB/frame; frame p95/sd 18.9/1.27→17.3/0.31. Battle on map main 6.53→5.14, Reactor Room 3.71→3.06. RTX walk main 9.12→6.78, garbage 1006→386 KB/frame. Minor GC pauses 6.6→3.7/s; longest (8 to 11 ms, major GC) unchanged.

- Garbage: normals computed before the index (`buildGlbTemplate`) wrote undefined into three's scratch vector and boxed every Vector3 number for the session (also wrong normals: Black Hole animation model now looks correct/different, owner should look); worker glTF arrays repacked (`Reactor3D.packJsonArrays`) since generic arrays made every Matrix4 box its numbers (84 B per multiply). Plus: HalfLight split record reuse, DepthFirst lists, GeometryDetail eligible/fresh without allocation, `Reactor3D.IntegerSort`, `Reactor3D.Shadows.sortFaces`, `Reactor3D.DoorRest`, static shadow hash box, light keys compared in place, stand/point helpers take out records. Frozen frame: 0 channels differ.
- Sync GL: none blocking per frame; checkShaderErrors already off in shipped games. Arrival program-info reads moved between frames (`ShaderWarmup.readEarly`, `Reactor3D.lazyUniformArrays`): in-frame 96→36 ms, worst frame 37–48→21 ms.
- Pacing: `Graphics.FramePacing` (interpolated drawing when updates land unevenly; screens 60 divides unchanged; eased switch). `determineRepeatNumber` fix: irregular frames averaging a tick ran the game at 80% speed. Emulated 144 Hz: camera speed variation 0.36–0.46 → 0.009 (RTX) / 0.02 (iGPU). Same-session on/off at 4x throttle: no cost. Real 180 Hz monitor unverified.
- Spikes: `F.anyEventStarting` walked 10,000 empty slots per call (2–3 ms a battle frame), fixed. Battle-start worst frame (4x throttle) 344→316 ms, median 50→31 ms.

## Battle-start follow-ups (round 2b)

1. replaceRefs (pixi_compat): DONE differently. Cause is not pixi_compat: `reactor_ui.js` built its UI windows through the local (un-upgraded) class names, so each Action HUD window took PIXISuper's copy path (6 windows, 3.4 ms unthrottled). Added `built(cls)` in reactor_ui.js to construct through the MZGlobalUpgrade wrapper on `window`. pixi_compat untouched. NOT YET MEASURED after (probe: scripts/probe-super.js; expect PIXISuper total 3.4 ms → ~0.2 ms). Pixels of the Action HUD not yet compared.
2. MegaSkills paySkillCost: DONE. 11 console.log calls gated behind `const LOG_SKILL_COSTS = false` in template/Demo/js/plugins/PSYCHRONIC_MegaSkillsMZ.js; behavior identical. Original saved as MegaSkills.before.js. NOT YET MEASURED (spikes run with battle: scripts/spikes-setup.js).
3. Effekseer preload: CODE DONE, measurement INCONCLUSIVE. `EffectManager.preloadMap` (reactor_managers.js) loads the effects of the map's Show Animation commands, the party's attack and skills, and the enemies/troops the map can bring, from `Scene_Map.onMapLoaded` (reactor_scenes.js); the scene waits behind the fade (Scene_Base.isReady already waits on EffectManager). Missing/stalled files are let go (`PRELOAD_WAIT_MS` 8000). Switch `EffectManager.preloadWithMap`. The walk measurement showed no Effekseer uploads during play in either version (Stage.warmMap already covers party skills over time), so the gain is moving those loads behind the fade. Shader compile warm-up NOT done. The 25.7 MB spike came from my synthetic animation 8, which nothing on North Haven uses.
4. Grip / hull: CODE DONE, NOT MEASURED. `Reactor3D.GripMemo` (reactor_3d_models.js, before `_gripPlace`) caches solved grips per held thing's point cloud (shared per model geometry) keyed by hand layout + trigger + hold matrix to 1e-4, LIMIT 64. `HullWorker.request` (reactor_fight_action.js) now copies meshes in idle callbacks one model at a time (`HullWorker.idleCopy`); failure falls back to the main thread as before.
5. Character shapes: DONE, MEASURED. `Game_CharacterBase.LATE_FIELDS` declared undefined in `initMembers` (reactor_objects_map.js) plus `Game_CharacterBase.evenOut` and `DataManager.evenCharacterShapes` after `extractSaveContents` (rebuild restored characters in one order per kind, swap in place). Switch `Game_CharacterBase.evenShapes`. Undefined fields are not saved: save format unchanged; old saves load; new saves load in 0.99.0. North Haven new game: hidden classes 16 → 4; garbage 401 → 367 KB/frame; logic 1.10 → 0.95 ms (alternated 2x2 runs). An in-page full normalization probe reached 393 → 288 KB/frame (the rest is fields declared undefined becoming tagged: double writes box). Load path not yet exercised live (no save/load harness run).

## Next steps, in order
1. Measure 1, 2, 4 together: spikes mode with battle (scripts/spikes-setup.js, 4x throttle) before (runtime snapshot from git diff / previous) vs now; probe-super.js for PIXISuper time; frozen/visual check of the Action HUD.
2. Save/load test for item 5: start a game, save via DataManager.saveGame, load, check `$gameMap.events()` shapes (probe-maps2.js with --allow-natives-syntax) and that play continues; Node test for evenOut (values, prototypes, order, undefined not saved).
3. Node tests for: EffectManager.preloadMap (ids gathered, missing file let go), GripMemo (hit returns same solve), HullWorker idle copy (falls back), MegaSkills unchanged costs.
4. Optional: Effekseer shader warm-up during arrival; consider declaring numeric late fields so they stay unboxed.
5. Write the final report.

## Files changed (both passes)
runtime: reactor_core.js (FramePacing, _onTick, _mustComposite), reactor_managers.js (updateMain hook, determineRepeatNumber, EffectManager.preloadMap/preload, DataManager.evenCharacterShapes), reactor_scenes.js (onMapLoaded preload call), reactor_sprites.js (drawReactor3D split, reactor3DScreenPoint, stand records), reactor_3d.js (DepthFirst, GeometryDetail, IntegerSort, ShaderWarmup.readSoon, stand/point helpers), reactor_3d_lighting.js (HalfLight reuse, _changedRoots, renderFace sortFaces, lazy cacheUniformArrays, light keys), reactor_3d_models.js (normals, packJsonArrays, GripMemo), reactor_3d_doors.js (DoorRest), reactor_fight.js (anyEventStarting), reactor_fight_action.js (HullWorker idle copy), reactor_ui.js (built()), reactor_objects_map.js (LATE_FIELDS, evenOut).
template/Demo/js/plugins/PSYCHRONIC_MegaSkillsMZ.js (log gate).
editor/tests: new frame-pacing.test.cjs, frame-garbage.test.cjs; updated reactor-3d-frame-caches, shadow-maps, event-stays-on-ground, reactor-3d-event-props, reactor-3d-panels, map-elevation, reactor-3d-foundation.

## Tests
My set (23 files, 430 tests): 427 pass, 3 fail, none mine: runtime-events and user-interfaces "Demo carries the same runtime" (runtime not yet synced into template/Demo/js, lead's step), shadow-maps "both viewports..." (MapEditor3D.js, another agent's edit). Earlier full suite: 7,149 tests, failures only sync/other-agent ones after my fixes. No tests yet for round-2b items (see next steps).

## Draft changelog lines
Editor (technical):
- `Graphics.FramePacing`: the map is drawn interpolated on frames where updates land unevenly (144, 165, 100, 50 Hz; a 180 Hz screen at 90 fps); `SceneManager.determineRepeatNumber` locks to one update a frame only when the frame is itself a tick long.
- Less garbage per frame: glTF arrays repacked and normals computed over the index (three's math no longer boxes numbers), `Reactor3D.IntegerSort`, `Reactor3D.Shadows.sortFaces`, `Reactor3D.DoorRest.enabled`, reused split and depth-first lists.
- `ShaderWarmup.readEarly` and `Reactor3D.lazyUniformArrays`: a new program's uniforms are read between frames.
- `EffectManager.preloadWithMap`: a map's effects load behind the fade. `Reactor3D.GripMemo`, `HullWorker.idleCopy`, `Game_CharacterBase.evenShapes` (one object shape per kind of character, saves unchanged).
- Battles on the map check for starting events through `$gameMap.events()`; Reactor UI windows are built through the upgraded classes.
Player:
- Smoother motion on 144 Hz and other high-refresh screens, steadier frame times and less memory churn.
- The game keeps its proper speed when frames arrive unevenly.
- Battles on the map start with fewer hitches and no longer slow down while checking events.

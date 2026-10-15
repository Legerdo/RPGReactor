# Handoff

Dated notes for the cycle in progress, newest first. Read [STATUS.md](STATUS.md) first: it is the current state and the one list of open work. Earlier cycles are in [archive/handoff](archive/handoff/), one file per version ([0.99.0](archive/handoff/0.99.0.md), [0.98.8](archive/handoff/0.98.8.md), and date-named files before that).

An entry holds only what the next session needs and cannot find elsewhere: what is half-done, what to watch for, what waits on the owner, how to resume. What changed goes in the editor changelog; how the code works goes in the commit message and the guides. Size limits and the rollover are in [README.md](README.md#keeping-status-and-handoff-short); `docs-budget.test.cjs` enforces them.

## Where things stand (2026-10-14)

- **0.99.0** shipped on 2026-10-12 at runtime **20261011.14**; PR #74 was merged after it. `main` matches `origin/main` at `dc918245`.
- **0.99.1** is in development at runtime **20261015.2**, synced to all 16 bundled projects. Committed locally; nothing pushed.
- **Performance round 2 landed at 20261014.4** (2026-10-15, on top of WIP commits `bf2b82bc` and `8714c49e`); several items still need measuring in the game on Linux (below).
- **Next agreed:** nothing yet. The owner agreed a kept battle ends when another starts, and asked for Action escape by running (done). On-map defeated enemies done the owner's way (event box, else Database › Enemies).

## 2026-10-15 — 3D draw calls: region batches, per-pixel light on discrete GPUs (runtime 20261015.2)

The owner still felt jerky 3D at 72 to 90 fps and asked for structural work. Numbers are in [PERFORMANCE.md](PERFORMANCE.md) (first section); North Haven now holds 144 fps on the laptop.

- **What to know:** `Reactor3D.DrawBatches` (reactor_3d_world.js) hides the chunk meshes it draws for (`userData.rrBatchedIn`); code that shows or hides pieces or plants by their `visible` must skip those (`updateFoliageFrame` does, `MeshBvh` picks them anyway). Region meshes carry `userData.rrBatch`, never `pieceChunk`, and are not in `mapScene._meshes`.
- **To watch:** the per-pixel light on discrete GPUs changes pixels slightly against the quarter-size split (it is the original look); a mid-range discrete card at 1440p or above is the place a GPU cost would show. The editor's pick returning a detached chunk after an edit (seen with batches off too) was not looked into.
- **Next candidates:** the water mirror on update refreshes (about 1.5 ms), character model sync (0.7 ms an update), the shadow face mask not counting map pieces (chunks stand at the map's corner).

## 2026-10-15 — 3D jitter on the owner's laptop: reflections and the editor view (runtime 20261015.1)

The owner reported jitter in 3D, game and editor, and allowed NW harness windows on this machine. Numbers and what was left alone are in [PERFORMANCE.md](PERFORMANCE.md) (first section).

- **Harness:** an A/B script that boots the game once, walks a loop and interleaves in-page variants, with per-function timers and updates per tick, was kept in the session scratchpad only (not in the repo). The editor was driven with `nw-3d-profile.cjs --setup` orbiting North Haven by `m3.orbit()` each frame. A Demo copy with junctions for media works on Windows; `reactor_plugins.js` must not be overwritten by a runtime copy (the project's own list).
- **To watch:** `Mirrors.WATER_AREA` was pixel-checked on one frozen frame by the fountain only; look at a lake edge-on and a river under a moving camera on the RTX. `Reflections.SPARE_REFRESH` shifts an update's face by up to one refresh; at 60 Hz nothing changes.
- **Not measured:** the UHD 630 (Windows keeps NW on the RTX regardless of the manifest; forcing it needs the owner's Windows graphics setting for `nw.exe`). The weak tier draws neither the capture nor the mirrors, so these changes do not reach it.
- **Next candidates:** taken up in 20261015.2 (the entry above).

## 2026-10-15 — Performance round 2 finished on Windows (runtime 20261014.4)

The overnight round was finished on the Windows machine with code and Node tests only: no NW harness ran there (it would open on the owner's desktop). What changed is in both changelogs and [PERFORMANCE.md](PERFORMANCE.md); its **Still to measure** list is the next Linux session's work.

- **How to measure:** each item's exact steps are in its Next steps in [perf-round2/](perf-round2/) (`2d-path.md`, `frame-pacing.md`, `startup-memory.md`, `threads.md`; harness rules in `rules.md`); delete the folder once they are measured. Scripts and baselines are in the gitignored `scratchpad/perf-round2-checkpoint/` (Dropbox). Run copies of the Demo, never the Demo itself.
- **Riskiest, check first:** `Tilemap.ChunkPaint.passThrough` (UltraMode7 hooks attributed at plugin load through accessors on 18 Tilemap methods, settled to plain properties at the first paint; pixels proven in Node only) and `MapEditor3D.RELEASE_2D_GRAPHICS` (the first 2D frame after 3D re-uploads). Both have switches.
- **evenShapes:** all 163 bundled saves load the same on and off in Node (`character-shapes.test.cjs` keeps four); the next save can differ in byte order, never in content.
- **Owner checks on real hardware:** Task Manager GPU column shows the RTX in a playtest and in the editor; Reactor Room GPU memory with 3D on and off; walking smoothness on the 180 Hz monitor; the Black Hole animation model (normals now correct); 1024 textures in close cameras; the reactor beam on Windows (Discord tester).
- **Tests on this machine:** the full suite after the merge is in the commit message; the failures left are the Windows list in memory plus `passage-3d` "a stroke of edits", which fails only under parallel load (time-sliced; passes alone).
- **Render thread:** a prototype only, about 2 to 3 months to production (gap list in `threads.md`). Not proposed.

## 2026-10-14 — The 2026-10-10 audit's bugs fixed (runtime 20261014.1)

All fourteen, plus the early border exit, are in `editor/changelog/0.99.1.md`. Tests: `audit-20261010-fight-core`, `audit-20261010-action`, `fight-classic`, `audit-20261010-left`, `layout-fit`, `vehicles-border-slide`. Screenshots before and after at three sizes were in `/tmp/rr-layout-shots/` (not kept).

- **Changed rule, agreed by the owner:** a kept battle (Transfer Player with "keep") now ends as an escape when any other battle starts, encounters included; one `$gameFight` cannot hold two. `fight-flow.test.cjs` and two `vehicles-battle.test.cjs` tests were rewritten for it.
- **Defeated enemies on the map are remembered now:** the Demo's North Haven raid and Map007's enemies stay gone after one win unless their enemy or event is set to Comes back (the owner sets the Demo).
- **Action and First Person escape is by running** (`A.updateGetaway`, 15 tiles for 90 frames after an enemy came near); not yet played live.

## 2026-10-14 — 0.99.1 opened; handoff archived, doc budgets enforced

- Version surfaces name 0.99.1 (package, About box, `RR_APP_VERSION`, web host, legacy skeleton, runtime header via `sync-runtime.cjs`, the Demo's project file, READMEs, release checklist, plugin API examples). Both changelogs have a 0.99.1 file and index line.
- The handoff had grown to 166 KB over two cycles. `editor/build-scripts/archive-handoff.cjs` moved the 0.98.8 and 0.99.0 entries to `archive/handoff/`; `cut-release.cjs` now runs it in every release commit. STATUS was rewritten to one bullet per area and took over the open lists, the owner decisions that stand, and the harness notes.

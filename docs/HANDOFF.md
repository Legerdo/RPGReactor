# Handoff

Dated notes for the cycle in progress, newest first. Read [STATUS.md](STATUS.md) first: it is the current state and the one list of open work. Earlier cycles are in [archive/handoff](archive/handoff/), one file per version ([0.99.0](archive/handoff/0.99.0.md), [0.98.8](archive/handoff/0.98.8.md), and date-named files before that).

An entry holds only what the next session needs and cannot find elsewhere: what is half-done, what to watch for, what waits on the owner, how to resume. What changed goes in the editor changelog; how the code works goes in the commit message and the guides. Size limits and the rollover are in [README.md](README.md#keeping-status-and-handoff-short); `docs-budget.test.cjs` enforces them.

## Where things stand (2026-10-16)

- **0.99.1** in development at runtime **20261016.3**, synced to all 18 bundled projects. Committed locally; nothing pushed.
- **User-path sweeps:** 1 to 11 done and committed (owner approved all, two agents at a time, a commit per sweep); 10 Forge tools and 11 battles follow-up done. Left uncovered, to queue: a 3D model placed on a map and rigged by real clicks (8); media surfaces and a north-south neighbor crossing (9; the Demo's maps do not line up north to south, so author two that do). Owner questions: the two sweeps entries below.
- **User reports fixed 2026-10-16:** Script commands show every line in the three event lists; Show Text lines were white on white in light themes.
- **Savior & Religion** (`template/Savior & Religion`, not in git; a deployed, encrypted MV game the owner is trying as a template): boots and plays to its opening with runtime 20261016.3. Its index.html still says `$reactorMvCompat = false` until the editor opens it once (`repairMvCompatFlag`).
- **Contrast pass, in progress:** light themes clean (committed); the dark palettes' findings are next. The owner keeps the current look; only unreadable pairs change. Tools in `scratchpad/user-path-sweeps/contrast-audit/` (`run.cjs` through `harness-slot.sh`, `summarize.cjs <results>`). Then the floating event editor (owner approved step 1: non-blocking, draggable; a second-monitor pop-out later).

## 2026-10-16 — User-path sweeps 6 to 11: questions for the owner

Sweeps 6 to 11 are committed one by one (changelog has the fixes). These wait on the owner:

- **Vehicles:** Get On lists unnamed blank records and types with no placement (list only placed or named vehicles?); Set Vehicle Location cannot move a map's vehicle event; twice the menu opened by itself after an Escape dismount, and one keyboard load did nothing (`Scene_Load.executeLoad` only buzzes on any failure): neither reproduced, likely the shared harness display, worth one hand check.
- **Forge tools:** Character Generator's Align Y defaults to Middle, so a Looseleaf character stands about 40 px above its square in game (the Demo's config stores `templateAlignY: middle`): default to Bottom, or always bottom-align the walking sheet? Effekseer battle animations anchor at the target's feet (`targetSpritePosition`, `reactor_sprites.js`; stock Fire One 1 too): keep, or center unless Align Bottom? A built character cannot be reopened (only the PNG is saved): keep a recipe per character? Smaller: Tint All leaves the per-letter swatches stale; a fill-frames-from-sheet button for sprite animations.
- **Battles, follow-up:** Rhea's authored roof cells on North Haven (x 85 to 89, y 74) see nothing: Tree-01 (event 10006 at 87,72) records its footprint solid from the ground to its crown, so her eye sits inside it; move her cell in the Demo, or keep the gap between roots and crown in the tree's hull? Twice Start Battle on Map run after Spawn Unit ended as a win on the spot, the spawned unit read as an enemy (cause not found); a lead on the Action skirmish won before the player acts.
- **Plugins and resources:** Optimize aggressively promises about a quarter of the triangles but texture seams can hold it near the source (Vay Drokan kept 97%); should the status line give the triangle result? The Element dialog in a list or struct editor has OK and Delete, no Cancel.
- **Quests, neighbors:** a common-event reward with no text shows no line in the quest log (show something?); Reactor's own quest commands list their arguments twice in the event list ("Quest: Discover: Herb Hunt (questId=1, action=discover)"); in the editor's 3D view of Open Road: Lake the land past the south and west borders draws nearly black under its trees.
- **Project lifecycle:** keep the new blank project's window skin (dark blue-gray, light frame) or supply one; a macOS game's Info.plist still names `nwjs` and shares the bundle id `io.nwjs.nwjs`; a Linux build on Automatic: Bundled ships the SDK (DevTools, chromedriver, nwjc, about 48 MB); Deploy has no asset encryption; no Save As or copy-project command; a blank project starts with an empty party.

- **Rules learned (2026-10-15):** commit only a finished sweep's own files (two agents share the tree); a web-build test can fail while agents edit files during it (rerun alone); keep owner questions in the sweeps entry, not STATUS (near its budget).

## 2026-10-15 — User-path sweeps: questions for the owner

A sweep builds one system by real input in the editor and plays it with real keys (rules and tools in `scratchpad/user-path-sweeps/`, queue in its `lead.md`). Fixes are in the changelog; these wait on the owner:

- **Events:** Paste Event Page adds a page (MZ overwrites); Show Choices' When Cancel default and empty branches; three labels for an unnamed switch (and an unnamed common event); Barebones Map002/003 name a missing tileset 10 (the game crashes there, the editor only warns in the console).
- **Database:** a face reads "Actor2 (4)" on the page but "index 3" in the picker; Cancel discards without asking (Escape and × ask); the first OK writes `UserInterfaces.json` into a project that had none.
- **2D maps:** Circle grows from the center (MZ's Ellipse fits the drag); New Map defaults to tileset 1 (empty in the Demo); a new map is not opened after OK; a new 2D map writes a flat `.r3d.json`; the Demo's Interstellar tileset has 4,184 null passability flags (water walkable).
- **Battles:** troop pages never run in battles on the map; the Troops battleback preview is the Battle Test one; the Tactical unit panel covers units on a small map; a flying enemy overlaps the next cell; the Demo's Action skirmish is won before the player acts; the victory message draws over the Action HUD.
- **3D builder:** a Roof box lays only a ring; no camera turn while building, and the hint names keys Build uses otherwise; a roofed inside cannot be seen or edited (no editor cut by level); nothing warns of a stair whose foot faces a wall; Escape in Select with nothing selected returns to the last piece kind; four Lower passes leave banks too steep to enter; stamping a structure moves models off the plot silently.

## 2026-10-15 — User Interfaces in the game: AbyssGazes (runtime 20261015.3)

Tester feedback: interfaces preview and build in the editor but do not show in the game; the diagonal menu's highlight should be diagonal too. Project: `template/AbyssGazes` (not in git).

- **Cause:** nothing was bound. Use As defaults to Custom, and the stock Title note pointed at System 1, which binds nothing. Once bound, the runtime showed both, but skipped Ramza_PreTitleSplash: the router over plugins swapped Scene_Title before the plugin saw it. Both fixed (changelog); the project's System.json now binds Title (1) and Main Menu (2).
- **Edited in the tester's project:** System.json (the two bindings) and `js/reactor_plugins.js` (the splash File was an absolute `C:\Program Files (x86)\Steam\...` path, now `movies/GoblinPartyGames.webm`; it crashed boot anywhere else). Their menu layout was left as they made it: no Angle set, labels Item/Status/Save over tabs reading Inventory/Statuses/Resume.
- **Also found under Wine:** Item and Status only buzzed, since the journal menu has no party panel to pick an actor in; they now act for the menu actor. Wine harness: `abyss-run-wine.cjs` with a `wine chromedriver.exe` wrapper and its own WINEPREFIX in the session scratchpad; paths go in as `Z:\...`.
- **The sweep:** `steps-sweep.cjs` with `sweep-prep.cjs` (binds all 17 roles, adds a terminal, an info popup and an overlay HUD, and a map event that calls the terminal) in the session scratchpad. It found four more: no party panel, missing meter art, baselines from before a resolution change (AbyssGazes' records 3 to 17 now carry `design` 1280x720), and Cancel under the touch Back button.
- **To watch:** plugins wrapped around goto/push now see the stock class where they saw `Scene_ReactorUI`; a plugin that read `SceneManager._nextScene` right after its own goto call sees the swapped scene.
- **Harness:** session scratchpad only (`abyss-run.cjs`, `editor-ui-check.cjs`), on copies, display from `headless-display.sh`.

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

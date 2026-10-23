# Handoff

Dated notes for the cycle in progress, newest first. Read [STATUS.md](STATUS.md) first: it is the current state and the one list of open work. Earlier cycles are in [archive/handoff](archive/handoff/), one file per version ([0.99.0](archive/handoff/0.99.0.md), [0.98.8](archive/handoff/0.98.8.md), and date-named files before that).

An entry holds only what the next session needs and cannot find elsewhere: what is half-done, what to watch for, what waits on the owner, how to resume. What changed goes in the editor changelog; how the code works goes in the commit message and the guides. Size limits and the rollover are in [README.md](README.md#keeping-status-and-handoff-short); `docs-budget.test.cjs` enforces them.

## Where things stand (2026-10-23)

- **0.99.1** at runtime **20261022.1**, synced to all 19 projects. The builders are at Preview 47 with visual acceptance open: [character coverage](CHARACTER-QUALITY.md), [remaining issues](CLAUDE-QUALITY-TRACKER.md), [props](PROP-BUILDER.md). The vehicles to review are in `scratchpad/vehicle-corrections-20261022/review.html`.
- **Owner questions:** one list, [OWNER-QUESTIONS.md](OWNER-QUESTIONS.md). Answered items leave it.
- **User-path sweeps:** 1 to 13 are done and committed.
- **Editor windows:** the Event Editor, Database, Forge and Plugin Manager each open in a frameless window of their own (`utils/DetachedWindow.js`). Native Linux transparency still needs a look on the real desktop.
- **Savior & Religion** (`template/Savior & Religion`, not in git, an encrypted MV game the owner is trying as a template) boots, plays its opening and draws its ULDS maps 2, 5 and 19.
- **Next:** a full Node run (the last was 2026-10-18), maps 1 and 5 on the RTX, then the owner's answers.

## 2026-10-22 — Builder progress checkpoint

The checkpoint holds the creature and catalog expansion, tailoring and pose corrections, faster outfit fitting, shared construction rules, furniture, and nine vehicle families. Preview 47 adds outline lettering, filtered grain and formed bodywork. The owner rejected Preview 46; Preview 47 has not been reviewed. Technical checks pass, but they are not visual acceptance. The caption regression test rejects the old merged lettering and cannot certify a whole asset. The Demo's generated Villager7 eight-direction sheet is kept. No push or release.

Next: vehicle silhouettes and mechanics, the weaker sci-fi and plate outfits, extreme cloth and armor contact, and bikini coverage. Older GLBs need a reload, reselect and re-save to pick up the changes. No full Node run or hardware frame-rate check since 2026-10-18.

## 2026-10-20 — Linux 3D startup recovery

A pacman update installed NVIDIA 615.78.08 and kernel 7.2.11 while the old driver was loaded, so WebGL failed until a reboot. Fixed by the reboot (checked 2026-10-23). The launcher workaround was removed; the preview guards for a missing or lost GL context stay. Still to do: open maps 1 and 5 on the RTX. Evidence: `scratchpad/map-load-recovery/`.

## 2026-10-20 — Character visual-audit recovery

The recovered audit finished the Ferengi, Vulcan and Klingon heads, sci-fi hardware, and skirt waists. Evidence is in `scratchpad/character-visual-audit/`. llvmpipe captures show appearance only. Remaining limits are in [coverage](CHARACTER-QUALITY.md): extreme folds and armor silhouettes, animal neck joins, mixed heads and heavy Merfolk contours.

How to check builder work without running out of memory: one large check at a time, Node with a concurrency of 1, and browser batches of at most four. Mesh and texture assertions must print bounded diagnostics; a deep diff of a cache once produced output large enough to stall the machine. Native peaks stayed under 1.8 GiB this way.

## 2026-10-18 — Outfit follow-ups and Sunset import fidelity

- Re-import older custom prepared outfits and re-save older GLBs to pick up the bikini, boot sole and ponytail fixes. Extreme folds and sharp hair bends remain ([coverage](CHARACTER-QUALITY.md)).
- Sunset: the original RPG_RT ran in a disposable Wine copy as the reference. The reported roof issue is Map7 to Map2, where the import cropped 296 px against the original's 304; the legacy camera fix covers the 8 px. Map10's layers already align, so no offset was added there. The exact shadow line the user reported is not confirmed.
- Imports made before these fixes need a fresh import for the new font and skin data; keep any edited copies. All 65 maps convert. Nobody has played the game through. Details: [import guide](IMPORTING-LEGACY-PROJECTS.md).

## 2026-10-18 — Second character pass and Claude continuation

- The [Claude tracker](CLAUDE-QUALITY-TRACKER.md) covers all eleven paused agents, lighting and props, with each item's status.
- Character cache revision is 13. Open aesthetic limits: extreme source folds, the white afro's cap and rims, dense hair on extreme bodies, and finer creature and chibi work. An afro shell trial failed review and was removed; don't retry it as it was.
- A candidate model shader broke Battle Room floors and walls; its varying is now model-only. Check room floors and walls after any model shader change.
- Switching through all 59 models in a row used to crash near 4 GB; reusing one warmed preview worker fixed it ([performance](PERFORMANCE.md)).

## 2026-10-18 — Character catalog previews off the UI thread

- User prioritized faster previews and weaker PCs. `CharacterPreviewWorker.cjs` owns desktop builds; `CharacterPreviewBrowser.js` and its dedicated entry handle Web. Worker results contain static render arrays only. One worker, bounded queues/caches, context revisions, failure/timeout cleanup and cancellation; no expensive synchronous fallback. The Builder does the final small GPU render. Initial selected-character/WebGL setup still stalls separately.
- Real NW measurements: first Outfit all-visible 5.45→3.57 s, worst frame 467→34 ms; bottom imported outfits 20.12→10.38 s, worst heartbeat 5.77 s→95 ms. Cached revisits 14–18 ms with no hidden jobs. Species all-visible 7.19→4.55 s. Same1366×900 fresh-profile/copied-project/empty-cache scenario on AMD integrated graphics. Evidence/reproducer in ignored `scratchpad/preview-perf/`; final output is `worker-post-fixed`, earlier post is a rejected cross-realm failure.
- NW worker arrays need page-realm typed views for THREE (zero-copy); resource Maps need brand-safe entries across Node/window realms. Tests cover both, copied source buffers, painted resources and project import registrations. The browser smoke uses HTTP and no Node/Model on the page: `editor/tests/smoke/character-browser-preview.cjs`.
- User then broadened the priority to app-wide performance on weaker PCs. Shared `PickerIndex.js` now reuses Intl helpers and operation-local sorting metadata. Five warmed runs: 442 Demo names 7.55→0.99 ms, 5,000 Unicode names 689.78→32.58 ms median, exact legacy order. Reproduce with `node editor/tests/perf/picker-index.cjs`. Fifteen picker/recursive-asset tests passed before the final combined checks.
- Importer thumbnails now await worker output; model-catalog renderer initialization no longer triggers an extra character build. Final combined validation: 272 tests passed across 26 files, including picker consumers, worker/scheduler lifecycles, distribution staging, reproducible Web packaging and docs. Actual importer/emblem/detach checks passed; 45 changed JS files passed syntax checks. No owner window restarted; work included in the closeout commit.

## 2026-10-18 — Resumed character quality pass

- Continued the checkpoint's paused agents. Work is included in the closeout commit; no push, release, or owner-instance restart. Source thumbnails and cached character previews use a new cache revision. Read the current changelog and Character Builder guide for delivered behavior.
- Real isolated NW.js editor checks covered importer Keep/Discard, failed Keep/retry, deletion/Undo, cancellation/project switches, all source thumbnails at 1366×768, project-picture emblems, Bikini, body extremes, helmets, and saved motions. Game checks covered humanoid rig/motion playback, dressed speech visemes, both merfolk sexes and container Lights clips, with no unexpected console errors.
- At this checkpoint the robe slipped off seated knees and Captain's seat fabric folded. The second pass above repairs the reproduced robe slip; source folds remain. Rejected solver/fit trials are not retained.
- Full Node sweep: 7,746 passed, 9 skipped, no failures; Web package reproducibility 6/6, final transfer/import lifecycle 25/25, and final graft checks 3/3 also passed. Syntax, patch hygiene and all 19 runtime copies checked.
- Disposable evidence: `scratchpad/{resume-checks,outfit-resume}/`, `/tmp/rr-motion-qa/`, `/tmp/rr-resume-*.log`. Reload the editor and re-save older characters for changed geometry/motion keys.

## 2026-10-18 — Power armor, standalone equipment and searchable poses

- Owner disliked the procedural power armor and requested accessories in Prop Builder plus an alphabetical/searchable pose picker. `CharacterPowerArmor.js` now makes beveled chest/back plates with side walls, tapered rigid limb housings, shoulder/elbow/knee guards, a dark undersuit and matching `powerhelm`. Trooper/Marine presets use it; hair/face coverage and preview cache version are updated. No imported armor assets.
- `AccessoryProp.js` registers all 59 CharacterProps entries in the searchable Prop Builder catalog. It reuses their geometry/options; a lazily loaded neutral body is only a sizing reference. Save writes only equipment on one prop root, with scale, rotation, material and bottom/center/attachment origin in the recipe. Held attachment origins use the grip. Small-object framing, floor placement and transparent lenses work in the prop preview. Resource loading handles failure/retry, detach/reopen and switching kinds; saves capture their recipe across preparation. Resting accessories have no character motions or cloth simulation.
- Pose selection uses the existing themed searchable select, sorted by translated labels, with lists refreshed for the current body plan and long closed labels clipped to the column. Existing pose playback is retained.
- Checked: 59 selected tests in nine files (11 new workflow tests, catalog, poses, props, six model checks, dropdowns and docs), plus syntax and patch checks. The browser module dependency audit now passes in the current working tree. Software mesh renders inspected front/side/back on three armor bodies and nine standalone props; armor mesh checks cover six average/extreme bodies. Native editor/GPU appearance and interaction remain unverified because this sandbox blocks launching the desktop GUI. Guides and both changelogs updated; no runtime changes for this pass.

## 2026-10-18 — Floating-window opening and Forge corners

- Owner still saw protruding Forge corners and asked for a larger Forge and no small-to-large opening jump. Shared windows now use `show: false`, mount and load the copied styles, set their minimum/final geometry while hidden, then reveal. Removed the visible 300 ms resize correction; Media Surface's separate pop-out uses the same sequence instead of its 50/400 ms corrections. Closing during startup prevents a late reveal; raising during loading waits. Only ready native geometry is remembered.
- Forge defaults to up to 1920 × 1080 within its monitor (owner's preferred size), with placement keys advanced once; subsequent user sizing is retained. Rounded clipping covers the complete native document, including body-level resize grips and composited previews, plus all in-page floating panels. Transparent pixels and GPU acceleration remain enabled.
- Checked: 149 tests in 15 focused files passed, covering loading, first-show dimensions, close/raise races, remembered resizing, Media Surface docking during loading, stylesheet load/error completion and existing shutdown/shortcut flows. Native appearance remains unverified: the session sandbox blocks launching the desktop GUI. Restart and inspect the actual Forge corners and first-open behavior before calling that visual gate passed. No runtime or character/prop builder changes.

## 2026-10-18 — Closing the editor with floating windows open

- Owner report: closing the main editor left the Event Editor/Database windows open with dead controls. `requestApplicationClose` closed only `nw.Window.get()`; its pop-outs depended on the destroyed main context. After the existing unsaved-changes decision and project-lock release, it now calls `nw.App.quit()` to end this editor instance, including visible, hidden and opening child windows. The allowed-close branch in main uses it too; native File › Exit now calls the shared checked exit callback.
- Checked: 74 tests across shutdown/dialog flows, shortcuts, startup and floating-window lifecycle. New cases cover a pending save, failed save, Cancel/retry and duplicate close requests. Syntax and patch checks passed. Desktop reproduction remains unverified here because native GUI launches are blocked by this session's sandbox. No runtime changes.

## 2026-10-18 — Transparent corners, Plugin settings and Media Surfaces cards

- Owner rejected both the opaque frame and the Linux square-corner fallback. Removed the fallback; every shared pop-out requests rounded corners with clear HTML/body backgrounds and no outer shadow. `editor/package.json` enables `--enable-transparent-visuals`; no GPU-disabling switch was added. **Native Linux transparency is unverified:** NW.js documents compositor/graphics requirements; restart the editor and inspect the actual desktop before claiming this visual gate passed. This sandbox still cannot launch Chromium or a headless display.
- Plugin Manager now uses `PluginManagerWindow.js` / `plugin-manager-panel.html` (included in distribution packaging). Its frame persists; raising it preserves unsaved plugin edits. Child-dialog closures use their actual parent document. Keyboard ownership and project-change cleanup are wired; the old manual drag/resize handlers are removed.
- Owner clarified that the plugin name/URL block and “Plugin Help & Documentation” heading were the plain-looking areas. They now use themed cards and shared accent headers; metadata spacing and URL treatment are separate from heading colors. Form labels/inputs and nested-dialog headings also follow the theme. A shared rounded `clip-path` clips the complete pop-out, including its header strip; native compositor output still needs a desktop check.
- Media Surfaces map panel: themed cards with image previews or video snapshots, filename/ID/type/position, and a fixed history footer. Thumbnail URLs reuse validated project paths and the asset URL helper. Two video decoders at most, released after capture, 48 cached small PNGs; cancel on rerender, edit or close. Source data and save formats are unchanged.
- Latest check after the styling changes: 156 tests in 20 focused files passed, including pop-out lifecycle, project reset, parameter serialization, themes and media thumbnail cleanup. A broader earlier run passed 193 of 194; its one failure is the pre-existing dialog audit of unawaited prompts in the unrelated `forge/Character3D/CharacterSpriteSheet.js` at lines 609 and 617; that file was left alone. Still to check visually: native transparent corners on Linux, Plugin Manager and its parameter dialogs beside the other windows, and image/video cards in light and dark themes.

## 2026-10-18 — Database layout and floating Forge

- Owner requested a wider Database default, an uncluttered 3D Models timeline, consistent rounded corners, and a floating/resizable Forge alongside other workspaces. Editor-only changes; no runtime sync or revision change.
- `ForgeWindow.js` uses `DetachedWindow`; `forge-panel.html` is included in distribution packaging. Forge keeps its outer frame mounted across tool changes and preserves an already open tool when raised again. Keyboard ownership includes Forge in UIManager and the map's fly controls.
- Database's placement keys advance once to discard the old narrow default. `sizeToScreen` sizes a first-open Database or Forge against its monitor's work area; subsequent user sizes are retained. The opaque frame and subsequent Linux square-corner workaround were both rejected; the later transparency entry above supersedes them.
- The Motion editor appends to `.r3d-model-workspace`, as a row below all three columns. The canvas fills its own preview row; the old absolute overlay and manual height subtraction are removed.
- Checked: 72 tests across ten focused files, run separately with Node; syntax and patch hygiene. Live visual/resize/multi-window checks still needed: this session's sandbox rejects the sockets needed by the headless display and Chromium (both attempted). Check 3D Models with a motion open at small and large sizes, Forge on a second monitor, and a Forge picker alongside the Database/Event Editor. Preserve the unrelated character/prop work already in the tree.

## 2026-10-17 — 3D Character Builder, comprehensive pass

- **Asked for** (owner, after trying the first pass): extreme proportions (Jabba-fat, huge busts), muscle that bulks instead of thinning, limb and butt bulk, outfits from tunic to power armor, accessories (sunglasses, monocle), many hair styles and colors, species (reptilian, avian, cats, dogs, deer), a working Open saved, "use the logic of the existing content to extend upon it", easy for beginners.
- **Built:** everything in the editor changelog's builder entry. Checked: Node (`character-3d-builder`, `-model`, `-hair`, `-creatures`), the software renders in the session scratchpad (`r/`), and the editor by real clicks and drags on a Barebones copy (`c3d/ui.cjs` in the session scratchpad, headless display): tabs, species, presets, Extreme drags, undo, a style through the themed dropdown, accessories, Randomize, Save, Open…, a horse; both GLBs read back through `Reactor3D.readModelAsync`, skinned, with Idle; no console errors.
- **Not checked:** a saved character walked in the game (only read back by the game's reader); Windows; the web editor; a light theme.
- **To know:** a garment's cut, the outfit picture and the painted skin are cached per setting (`cache.wardrobe`, `cache.skin`); pack-level caches live on the pack (`_anatomy`, `_cuts`, `_bindings`). Chain positions for cut lines are in `CharacterWardrobe.js`'s header. Hair and the creature generator were built by two agents in this session; their reports' limits: the afro reads mushroom-like, the chin strap is heavy; creatures have no UVs (vertex colors only).
- **Questions for the owner:** keep hair hidden under hoods and helmets (now) or let long hair fall below them; do animal ears poke through helmets (now) or hide; GLB sizes run 2.5 to 3 MB for a dressed human (three 1024 pictures, 40 to 60k triangles): add an Optimize step at save?
- **Next candidates:** crowds (Randomize × N into a folder), binding a saved character to an actor, hair cards with alpha, cloth and tail physics in the runtime, birds and serpents as body plans, ARKit face units from MakeHuman's CC0 extra-targets repo for expressions and lip sync.

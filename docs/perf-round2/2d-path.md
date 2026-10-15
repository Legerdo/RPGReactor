# 2d-path checkpoint (2026-10-14, paused at owner sign-off)

All source edits are complete and consistent; no half-applied edit. My own test files: 59/59 pass.
No NW, chromedriver or display of mine is running; project copies in /tmp removed.
Evidence, scripts, baseline runtime snapshot: `perf-round2-checkpoint/2d-path/` (next to this file).

Measurement setup: headless KWin display, Radeon iGPU (weak tier), NW under `flock /tmp/rr-perf.lock`,
CPU throttled 4x unless stated. "before" = runtime snapshot taken at 17:21 before my edits
(`2d-path/rt-before/`), "after" = that snapshot plus only my changed files (my reactor_core.js hunks
applied as a patch, `logs/core-mine.diff`). Main 2D test bed: a Barebones copy with Project3's Map038
(150x130, lots of water, events stripped) transplanted as Map004 (`2d-path/bb-maps/`), walking an
8-tile square at (66,14), 10 s. Medians of 3, alternated.

## Done

### 1. Chunked 2D tilemap (switch `Tilemap.ChunkPaint.enabled`)
- Cause: `Tilemap.updateTransform` (reactor_core_display.js ~703) repainted the whole view on every tile
  crossing and every water frame; `_syncV8Backend` built new typed arrays per paint plus 3 temp arrays per
  quad; `CombinedLayer.addRect` spread `arguments` per rect.
- Change: while every painting hook is stock, the map is painted in 8x8-tile chunk meshes, built once
  (visible chunks now, a one-chunk ring ahead one per frame), moved by the layer transform, released two
  chunks away; water/waterfall frames advance by patching only their quads' UVs (`_addAutotile` tags A1
  quads via `this._rrPaintAnim`); one chunk per frame is compared with the map data (tile writes without
  refresh still show). Any plugin hook on the paint path (14 hooks, Layer/CombinedLayer addRect/clear),
  a plugin tile layer, `_rrTileFrames`, UltraMode7 installed, or a paint error -> the stock full paint,
  unchanged (stats `$reactorTilemapStats.chunkFallback` says why). Profiler-wrapped methods are seen
  through (`__rrProfilerOriginal`, one line in reactor_core.js ReactorProfiler._wrap).
- Fallback path also cheaper: reusable grow-only quad arrays with partial buffer uploads, no per-quad temp
  arrays, indexed CombinedLayer.addRect.
- Numbers, Barebones big water map, iGPU, 4x throttle, tick (update+render CPU) ms:
  before p95 6.1 / p99 7.4 / max 9.4 / mean 1.30 -> after p95 1.4 / p99 2.1 / max 2.8 / mean 0.77.
  Tile work per 10 s: before 55 full repaints = ~250 ms paint + ~53 ms mesh (~5.5 ms each);
  after 13 chunk builds (2.7-4.0 ms total) + 198 UV patches (~2 ms total). Unthrottled: tick p95 1.8 -> 0.7, max 3.4 -> 0.9.
  Frame deltas unchanged (no vsync misses either way on this machine).
- Plugins ON, fallback path (Project3, TF_Billboard + VisuMZ + MPP_HiddenPassage, Map038, 4x):
  tick p95 19.1 -> 12.8, p99 21.3 -> 15.3, max 24.6 -> 18.3; paint 495 -> 326 ms/10 s; mesh 46 -> 15 ms.
- Pixels: Barebones Map004, 27 frames (12 water/waterfall phases, scrolled positions): identical.
  Project3 plugins on, 12 frames: identical to a second before run. SSR (MV, UltraMode7 installed,
  save 11, map 612, tile layers only): identical. Demo Map007 (UltraMode7 installed -> fallback),
  tile layers only, 10 frames: identical. Barebones parallax map (event-free copy with DarkSpace,
  scrolled past the map edge): identical. Node test: chunk quads equal the full paint cell by cell,
  in order, across 260 frames of walking + all water phases.

### 2. Packed tile atlas, CPU copy dropped (switches `Tilemap.Layer.v8AtlasPacked`, `Tilemap.Layer.v8AtlasDropsCanvas`)
- Cause: fixed 4096x3072 atlas with 1024 px slots (~1336-1411), canvas kept beside the texture.
- Change: sheets packed into columns (smallest area within 15%, squarest), rects past a sheet edge
  clipped (same pixels as the old transparent slot margin); canvas shrunk to 1x1 once the GPU holds the
  texture and repainted when the GPU copy is gone (lost context via `webglcontextrestored`, texture GC
  via per-frame `_keepV8AtlasPixels` check of `source._gpuData`).
- Numbers: full MZ 48 px tileset 4096x3072 (48 MB GPU + 48 MB canvas) -> 2304x2112 (18.6 MB GPU,
  canvas 0); Project3 world tileset -> 1024x1280 (5 MB). Renderer RSS 427 -> 408 MB (bb), 595 -> 537 MB
  (Project3). GPU-process RSS does not show GPU memory (unchanged 206 MB); savings there are by arithmetic.

### 3. Neutral sprite colour pass skipped (switch `ColorFilter.skipNeutralSpritePasses`)
- Cause: `Sprite._createColorFilter` (~419) filter stays as a render-to-texture pass while neutral.
- Change: `ColorFilter.prototype.allowNeutralSpriteSkip` (enabled getter) skips it while the matrix is
  identity, it is the sprite's only filter, its blend matches the sprite's, no mask, and children draw
  plain alpha unfiltered/unmasked.
- Numbers (battle, 2 enemies flashed then neutral + toned picture then neutral): passes 3 -> 0 after
  neutral; GPU 3.345 -> 3.289 ms (tiny on 2 enemies). Frames: start, flash+tone, neutral-again all
  pixel-identical before/after (checked twice).

### 4. Partial Bitmap uploads (switch `Bitmap.partialUploads`)
- Cause: each Bitmap draw op re-uploads the whole canvas (batched per frame in pixi_compat already).
- Change: stock draw ops name their changed area (`Bitmap._touchUpload`); the per-frame flush sends only
  that area with WebGL 2 `texSubImage2D` + UNPACK_SKIP_PIXELS/ROWS when it is under half the canvas and
  the GPU texture exists at size; anything else (plugin `update()` with no area, `bitmap.context` or
  `.canvas` taken by outside code -> that bitmap stays whole for life, WebGL 1, resize) is a full upload.
  Stock ops use an internal `_drawingContext()` so their own access does not mark the bitmap lent.
- Numbers (letter-by-letter message, 4x): upload 455 KB/frame -> 21 KB/frame; flush CPU mean 0.164 ->
  0.054 ms, p95 0.7 -> 0.4. Menu and battle idle: 0 uploads either way. Final message frame identical
  (checked twice); battle identical; menu diff only the blinking cursor highlight (timing, max 4).

### 5. Per-frame garbage in the 2D path (no switch: same behavior, no allocation)
- Iterator garbage from `for...of` in per-frame recursions: Sprite/TilingSprite/Window/WindowLayer/
  Tilemap update, `PIXI.Container.update` shim (pixi_compat), `_syncV8TileLayers`,
  `CombinedLayer._syncV8Backend`, `ColorFilter._sceneBlendsKeepBackdrop`, `_rrPlaceLayeredPictures`
  (reactor_screen_fx.js), gamepad polling (reactor_core_io.js: also a Set + array per frame).
- `Number#clamp` boxing in `Sprite._refresh` and 7 opacity setters -> Math.min/max.
- `Window_Scrollable.processWheelScroll` checked the touch frame every frame for every scrollable window
  (new Point + new Point + new Rectangle): wheel checked first; `isTouchedInsideFrame` reuses one Point.
- Numbers (2 s walk, 4x, allocation sampling incl. collected): before all changes 128.9 MB -> after
  items 1-2 31.6 MB -> after item 5 10.2 MB ("next" iterator results 34.9 MB -> 0.7 MB).

## In progress
Nothing running. Not yet re-measured: the bb walk timing with the item 5 changes included (item 1
numbers above predate item 5); battle allocation profile after item 5 (before: 29.1 MB / 2 s, top items
iterator garbage, `Game_BattlerBase.param`/`traitObjects` concat/filter from gauges, not touched).

## Next steps
1. Re-run the bb walk A/B (3x alternated, 4x) and the battle alloc profile with the final runtime.
2. Optional, needs owner opinion: chunk paint when UltraMode7 is installed but inactive on a map (the
   Demo has UM7 enabled, so Demo 2D maps use the cheaper fallback, not chunks). UM7's hooks pass through
   when inactive, but the captured originals cannot be verified without a load-time hook snapshot.
3. Optional: VisuMZ_0_CoreEngine overrides `_addSpotTile`/`_addShadow`, so VisuMZ projects stay on the
   fallback path (made ~35% cheaper). Whitelisting would need fingerprinting obfuscated code.
4. Optional: battle gauges call `param()` -> `traitObjects()` concat per frame per gauge (reactor_objects_battlers.js).
5. Write the final report.

## Files changed (mine)
- runtime/reactor_core_display.js (items 1, 2, 3, 5; whole diff of this file is mine)
- runtime/reactor_core.js (Bitmap section: partial uploads; ReactorProfiler._wrap: one line `__rrProfilerOriginal`)
- runtime/libs/pixi_compat.js (deferTextureUpload area tracking, `uploadTextureArea`, flush; Container.update loop)
- runtime/reactor_windows.js (processWheelScroll order, isTouchedInsideFrame scratch point)
- runtime/reactor_core_io.js (Input._pollGamepads allocation-free)
- runtime/reactor_screen_fx.js (_rrPlaceLayeredPictures indexed loop)

## Tests
- Added: editor/tests/tilemap-chunk-paint.test.cjs (11), editor/tests/sprite-neutral-color-filter.test.cjs (4),
  editor/tests/bitmap-partial-uploads.test.cjs (3), editor/tests/helpers/runtime-tilemap.cjs (loader).
- Changed: runtime-tilemap-mesh.test.cjs (reused arrays, fixed-slot atlas fixture, blocker stub),
  runtime-frame-churn.test.cjs (updateTransform regex), legacy-windows.test.cjs (drawText fixture gets
  `_drawingContext`/`_touchUpload`), pixi-texture-upload-batching.test.cjs (+3 partial upload tests).
- Status: all mine pass (59/59). Failures seen in the wider runs are not mine: Demo template drift
  (runtime-events, window-culling, runtime-manifest: lead syncs), map-elevation "3D ground drawn then
  taken", reactor-3d-foundation A1 UVs, shadow-maps viewports (reactor_sprites/3D), tactical-view
  `isStarting` (reactor_fight).

## Draft changelog lines
Editor changelog (technical):
- 2D tilemap paints in 8x8-tile chunk meshes built once and moved by the layer, with water and waterfall frames advanced by a UV patch; any plugin hook on the paint path keeps the full repaint (`Tilemap.ChunkPaint.enabled`, `$reactorTilemapStats.chunkFallback`).
- Full tilemap repaint reuses its quad arrays and uploads only the quads in use; `CombinedLayer.addRect` no longer spreads arguments.
- Tile atlas packs the sheets to their size (48 MB to about 19 MB for a full MZ set) and frees its CPU canvas after upload, repainting it on context restore or texture GC (`Tilemap.Layer.v8AtlasPacked`, `Tilemap.Layer.v8AtlasDropsCanvas`).
- A sprite's neutral colour filter (after a flash or tone) is skipped instead of rendering through a texture (`ColorFilter.skipNeutralSpritePasses`).
- Bitmap draw ops upload only the area they changed via WebGL 2 sub-rectangle uploads; plugin drawing and lent contexts keep whole uploads (`Bitmap.partialUploads`).
- Per-frame update walks, gamepad polling, sprite frame clamping and window wheel checks allocate nothing.
User changelog (plain):
- Walking around 2D maps is smoother on slow computers, with water still animating as before.
- 2D maps use much less graphics memory.
- Text that types out letter by letter costs far less to show.
- Enemies and pictures that were flashed or tinted no longer cost extra to draw once they are back to normal.

## Evidence and scripts
`perf-round2-checkpoint/2d-path/`: `scripts/` (run.sh: flock + sync + game.cjs on DISPLAY; walk2d.js,
pixshot.js, upload.js, fx.js, probe.js, cmpdir.cjs, allocsum.cjs, allocwho.cjs, states*.json, batch*.sh),
`logs/` (batch1-6 results, test logs, core-mine.diff), `evidence/` (alloc profiles, sample frames),
`rt-before/` (baseline runtime), `bb-maps/` (transplanted Map004/Map005/MapInfos, Project3 plugin list
with the three tilemap plugins off, used only for one engine-cost profile).
Rebuild the bb copy: copy template/Barebones data/js/css/index.html/package.json/project.rpgreactor/icon,
symlink img/audio/movies/effects/fonts, drop in bb-maps. Note run.sh paths point at the /tmp scratchpad
folder (`.../scratchpad/2d-path/`); the display was `:4` (start a new one with headless-display.sh).

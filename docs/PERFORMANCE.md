# Runtime performance checks

## Quality settings (not yet exposed to players)

The owner wants these to become a player-facing graphics menu one day, the way most games let weak hardware trade a little picture for frame rate. Today they are engine defaults a script call or plugin can change at any time. Figures: Intel UHD 630, 1080p, the Demo's start map, frozen GPU frame unless noted (runtime 20260930.9).

| Setting | Default | What it trades | Measured |
| --- | --- | --- | --- |
| `Reactor3D.renderScale` | 0.75 | The 3D is drawn at this fraction of the screen each way and enlarged. The saving is the pixels not drawn (0.75 draws 56% of them); fine texture softens a little. 1 = native. | native 11.2 ms, 0.75 9.3 ms; walking about 100 → 117 fps |
| `Reactor3D.SharpUpscale.mode` | `"cas"` | How the smaller picture is enlarged: `"crisp"` keeps each pixel flat with a hard, slightly stepped edge; `"cas"` filters and sharpens within each pixel's neighbours (softer, no steps). `enabled = false` lets PIXI enlarge it pixel for pixel (blocky). | crisp 9.3, cas 9.4, PIXI nearest 8.3 ms |
| `Reactor3D.SharpUpscale.sharpness` | 0.5 | 0–1. Crisp: how hard the edge blend is (1: half a screen pixel). CAS: how strongly it sharpens. | no cost difference |
| `Reactor3D.HalfLight.SCALE` | 0.25 | The size the lighting and shadows are worked out at, each way, before being filtered up. Surfaces keep their full detail; only the light is coarser. 0.125 and below put light rims on models against much brighter or darker ground. `enabled = false` lights every pixel (the old way). | full 20.3, 1/4 10.6, 1/8 9.9, 1/16 9.8 ms (three places, before `renderScale`) |
| `Reactor3D.HalfLight.matchSurfaces` | true | The small light is filtered up from the samples on each pixel's own surface, and a pixel with none (a rim, a thin part) is lit at full size. `false` filters plainly: a blocky rim of the ground's light on models. `PLAIN_SPREAD` (0.02) lets pixels whose four samples agree skip the depth read; `exactEdges = false` drops the full-size fallback. | harness iGPU, 0.75 of 1080p: combine 0.48 → 1.1 ms; pixels 24+ levels off full-size light 9,139 → 538 |
| `Reactor3D.HalfHaze.SCALE` | 0.25 | The size the lights' haze (cones, balls) is drawn at. `enabled = false` draws it full size. | 3.8 → about 0.8 ms for eleven cones |
| `Reactor3D.GeometryDetail.pixelError` | 1 | How far, in screen pixels, a simplified model may stray from the full one before the finer level is drawn. | 0.35 → 1: 0.85 ms, single texels moved |
| `Reactor3D.SHADOWS`, `Reactor3D.SHADOW_QUALITY` | `"auto"`, weak/full tiers | Shadow rows, their size and filtering. The tier is picked from the GPU. | rows about 1.3 ms walking |
| `Reactor3D.LightVolume.dynamicEnabled` | true | Moving lights baked once a frame instead of per pixel. Evens out on average, saves up to 3.5 ms where many swing across the view. | |
| `Reactor3D.FOLIAGE_LOD` | full: near 22, far 64, scale 1; weak: near 12, far 38, scale 0.5 | Grass, flowers, ferns and reeds: tiles from the eye where the field starts to thin and where it is gone, and the share drawn at all. Chunks past `far` are not drawn; the blades are drawn before the ground (whatever they hide is never shaded) and stay out of reflections. | harness iGPU (weak tier), North Haven with about 100,000 clumps painted, 3D update with `gl.finish`: +0.2 to +1 ms across meadow, cliff, wide and high views (runtime 20261002.6 + foliage) |
| `Reactor3D.adaptiveResolution` | false | Let the scale fall when frames run long and climb back when calm. Off: a scale that moves reads as the picture changing under the player. | |

A menu would most naturally offer presets over these (for example Low: renderScale 0.6, lighting 1/8; Medium: 0.75, 1/4; High: 1, 1/4; Ultra: 1 with `HalfLight` and `HalfHaze` off and pixelError 0.35), saved per player with the other options.

## Edges and beams — runtime 20260930.12

Harness iGPU (Ryzen 9 9950X3D's Radeon, radeonsi on X11, weak tier since this runtime), 1920×1080, the start map near the Psychronic mascot (37,11) and the start area (24,47). Looks were judged with game updates stopped and the clock running, each variant drawn for a second first; the frozen mode's stopped clock can hold programs a variant never compiled and drew a wrong reference.

| Change | Cost | What it fixed |
| --- | --- | --- |
| The small light's passes stand at the camera (`cameraPosition`) | none | the volume read from the far side of faces: dark floors, bright model faces, in quarter-size blocks |
| Shadows switching on refresh the originals, not the twins | none | start-map floor compiled without the shadow lookup (full-size path only) |
| Light filtered up by surface, full-size at rims | about +0.6 ms | blocky rims of the ground's light on models (24+ level errors 9,139 → 538) |
| Haze filtered up by surface | +0.16 ms | haze bleeding across silhouettes |
| Beams in the pass at full size | negligible | a laser drawn as a row of soft blocks |
| Ryzen APUs on Linux weak tier | −15 ms here | full-tier reflection capture (6.2 ms) and full-detail meshes on a 2-CU iGPU |

Weak tier, start map, GPU per frame: 7.95 ms at the defaults, 9.28 at `renderScale = 1`, 7.58 with `SharpUpscale.mode = "crisp"`.

## Intel UHD 630 pass — runtimes 20260930.2–.6

Laptop: i5-10500H with its integrated Intel UHD 630 forced on (the RTX 3060 idle), 1920×1080, ANGLE/D3D11, weak tier. Tool: `editor/tests/perf/nw-frame-breakdown.cjs` on a disposable Demo copy: `--mode=passes` (GPU per three.js pass and PIXI composite), `--mode=draws` (GPU per draw call, for ranking only), `--mode=spikes` (every long frame with the CPU samples and the GL traffic inside it), `--mode=frozen` (clocks, tickers and videos stopped; the same frame drawn under a timer per variant; pixels compared with the baseline's own noise; variants from a `--setup` script's `window.__rrVariants`). The harness waits for the geometry worker before measuring: until it has simplified the dense models the full geometry is drawn.

Findings that shaped the pass:

- The frame is GPU-bound: the main thread idled for most of every long frame while the GPU ran 40–90 ms. Spikes were GPU back-pressure, not script, GC or shader compiles.
- On a frozen start-map frame the light loop was about 12 ms of 30, but not for its arithmetic: the inlined double shadow lookup slowed every lit pixel (removing its code, with no pixel change, saved 8 ms). Merged, the frame went 29.8 to 23.9 ms. A loop indexed identically across pixels and a depth pre-pass measured no gain; drawing the room's walls as opaque made it slower (they are rejected behind props only as late, transparent draws).
- Of 23 lights on the start map only 6 are unchanged from frame to frame (seven sweeping searchlights, flicker), so caching the summed light across frames does not pay there.
- Remaining weight on that frame: lighting about 11 ms, vertex and fixed work about 11 ms (three 488k-triangle props, 149k-triangle characters), PIXI composite 2 ms.

Walking route (20 s, same start, collision off), before → after this pass (before the merged shadow lookup): median frame 48.7 → 34.7 ms, p95 124.8 → 69 ms, worst 368 → 264 ms, long frames 46 → 30. The changes are listed in the 0.98.9 editor changelog, Performance.

Runtime 20260930.6, the second round (measured with frozen frames drawn back to back, which an integrated GPU needs: timed with gaps between draws it dropped its clock, and the same frame read 12.9 to 20.4 ms):

- Frozen, three places along the walk: 24.8 ms before the round, 11.0 ms after. Walking, 20 s: about 95 to 100 fps (it began the day near 40), the median frame on the 144 Hz display's 7 ms refresh.
- Largest steps: the light at a quarter size from the pass's depth (`HalfLight`; in the view with the most lights 23.1 → 12.5 ms); the haze at a quarter size (`HalfHaze`, 3.8 → about 0.8 ms); an opaque game canvas (the browser's blend of an alpha canvas pushed most frames past the refresh: 91 → 101 fps); distance levels at a pixel of error (0.85 ms); the moving lights' bake on a one-tile grid.
- Where the remaining frame goes (live, per pass): the unlit surfaces about 5 ms (757k triangles, 83 draws; the three dense props alone 1.2 ms of vertex work), PIXI's composite 1.3 ms, the combine 1 ms, the shadow rows 1.3 ms, surfaces lit as before (49 reflective meshes, 328k triangles) 1.1 ms, the light pass 0.8 ms. At a quarter of the resolution the frame still costs about 5 ms: 144 fps at 1080p on this GPU needs the fixed costs cut as well as the pixels.
- Fixed on the way: the light volume's bakes were refused by the driver whenever PIXI had drawn since three (a shadow sampler met PIXI's texture), so some earlier volume measurements included lights that were not being drawn; the figures above are after the fix.

Later the same day (runtimes 20260930.3–.5), the light volume and loading:

- Baked light volume: still, flickering and pulsing lights read from half-tile 3D textures (15 of 23 on the start map); moving lights without their own shadow row are gathered once a frame into a view atlas. Frozen: 8.3 ms saved by the baked lights; walking, 20 s: 699/703 → 755/778 frames, GPU median about 23 ms, p95 41 → 33 ms. The frame is still GPU-bound at about 40 FPS on this GPU; the per-pixel cost left is the texture shading every pixel pays (about 6 ms at 1080p), the party's sharp shadows, and vertex work on dense models.
- Loading: shader compiles on the driver's threads with meshes shown when ready, pictures decoded in a worker and uploaded under a budget. Fresh profile, New Game, 15 s: 298 → 453 frames, worst frame 2.4 → 0.62 s. Left: Effekseer's WebAssembly start (0.3–0.6 s once) and single large texture uploads (about 70 ms each).

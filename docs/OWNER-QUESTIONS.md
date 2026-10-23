# Waiting on the owner

The one list of questions only the owner can answer. Each item has a recommendation. Remove an item once it is answered; record the work in the changelog.

Answer by number: "A: go", "B: all recommended except B4 and B13", "C2 done".

## A. Defects: fixed as described unless the owner objects

1. Crossing between North Haven and Forest Road still costs one frame of about 120 ms, mostly shader compiling (events are now built ahead). Compile the neighbor's shaders before the crossing.

## B. Decisions (recommendation in bold)

1. Rhea's roof cells on North Haven (x 85 to 89, y 74) still see nothing: her eye, about 6.8 tiles up, is inside Tree-01's crown, whose underside there is 4 to 6.5 tiles up. Tree hulls now keep the gap under the crown, which fixed sight lines elsewhere. **Move her cell out from under the tree.**
2. Forest Road now matches North Haven (night, steep ground from 80), so the mismatch moved to the Forest Road and Fields border (night against day). **Blend the light over the first tiles past a border, so neighboring maps can keep different times of day.**
3. In the game a 2D map draws its neighbor's tiles past its edge; the editor's 2D view does not. **Draw them dimmed in the editor too.**
4. The Storeys cut in the editor's 3D view shows the inside shaded by the hidden roof, as the game's cutaway does. **Drop the hidden roof's shadow in both.**
5. Show Choices made by Reactor's old dialog with "Branch" always played as Disallow (the dialog had the two swapped); they now show Disallow, and their When Cancel bodies never ran. **Leave them as they show; they do what they always did.**
6. The web bundle before the next itch upload: the Demo ships 1,011 files and 438 MB, over both limits with the editor. The proposal (`scratchpad/owner-answers-2026-10-23/web-trim-proposal.md`) drops 61 files (52 MB), keeps the Psychronic BGM, and lists lossy shrinks of two videos and the icon separately. **Approve the drop list; decide the lossy shrinks by eye.**

## C. Only the owner can do these

1. By hand: dismount a vehicle with Escape, and load a save with the keyboard. In harness runs the menu twice opened by itself after the dismount, and one keyboard load did nothing. Both were probably the harness.
2. Review North Haven (landscape, rivers, foliage, HD materials, the village, night). The five motorcycles are now Starting Positions using the vehicle's own model facing south; their old event models were turned 163° and tilted 7°.
3. Playtest an Action battle: followers now hold back until the leader attacks or drops below half HP. Does it feel right?
4. Look at Barebones Map002 and Map003: drawn on a Star Shift tileset Barebones lacks, they now use SF Inside and look different.
5. Look at the regrouped Database menu and sidebar (Animations and Action Sequences under Battle, Music Sequences under Events and Interfaces).
6. Look at the weak-GPU picture on the UHD 630: edges, beams, and the `"cas"` against the `"crisp"` upscale.
7. Look at the motion presets on Fleagus: Guard reads as hands up, Swim and Jump are awkward, and there are no finger joints.
8. Look at Preview 47 vehicles (`scratchpad/vehicle-corrections-20261022/review.html`) for visual acceptance.
9. Look at the floating windows on the real desktop: transparent rounded corners on Linux, the Forge's first opening, and the Plugin Manager beside the others.
10. Check weaker hardware and two monitors.
11. Release gates: signed Windows and macOS package launches (editing `Info.plist` for the game's name breaks the macOS seal, as the icon swap already did), and one full game playthrough.

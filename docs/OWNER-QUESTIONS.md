# Waiting on the owner

The one list of questions only the owner can answer, gathered from the user-path sweeps (2026-10-15 and 16), the 2026-10-10 audit and STATUS. Each item has a recommendation. Remove an item once it is answered; record the work in the changelog.

Answer by number: "A: go", "B: all recommended except B4 and B13", "C2 done".

## A. Defects: fixed as described unless the owner objects

1. Barebones Map002 and Map003 name a missing tileset 10. The game crashes there and the editor only warns in the console. Point them at a real tileset and show the warning in the editor.
2. Show Choices: its When Cancel default and its empty branches differ from MZ. Match MZ.
3. An unnamed switch shows three different labels (and so does an unnamed common event). Use one label everywhere.
4. Database: a face reads "Actor2 (4)" on the page but "index 3" in the picker. Number them the same way.
5. Database: Cancel discards edits without asking, while Escape and × ask. Make Cancel ask too.
6. Database: the first OK writes `UserInterfaces.json` into a project that had none. Write it only when something changed.
7. A new 2D map writes a flat `.r3d.json`. Write none until the map uses 3D.
8. The Demo's Interstellar tileset has 4,184 empty passability flags, so its water is walkable. Fill them.
9. Troops: the battleback preview shows the Battle Test one.
10. Tactical: the unit panel covers units on a small map.
11. Tactical: a flying enemy overlaps the next cell.
12. Action: the Demo's skirmish is won before the player acts, and twice Start Battle on Map after Spawn Unit ended as a win at once (the spawned unit read as an enemy).
13. Action: the victory message draws over the HUD.
14. Build: a Roof box lays only a ring. Fill it.
15. Build: the hint names keys that Build uses for something else.
16. Build: warn when a stair's foot faces a wall.
17. Build: stamping a structure moves models off the plot without a word. Warn.
18. Build: four Lower passes leave banks too steep to walk into.
19. Character Generator: Tint All leaves the per-letter swatches showing the old colors.
20. Plugin parameters: the Element dialog in a list or struct editor has OK and Delete but no Cancel.
21. Quests: Reactor's own quest commands list their arguments twice in the event list.
22. Editor 3D view of Open Road: Lake: the land past the south and west borders draws nearly black under its trees.
23. Deploy for macOS: Info.plist still names `nwjs` and every game shares the bundle id `io.nwjs.nwjs`. Use the game's name and an id from the project.
24. Deploy for Linux on Automatic: Bundled ships the SDK build (DevTools, chromedriver, about 48 MB). Ship the normal build.
25. Left from the 2026-10-10 audit; each is checked again before fixing: the Tilesets list keeps the old name until Save; the User Interfaces drawer covers the Layout toolbar at 1366 wide; Types scrolls sideways at 1024; Terms clips values at 1366; the Door "Opens" list is cut off; Import Project scrolls at 768 and 600 high, and the User Interfaces page scrolls as a whole at 1024×600; Copy Page and Paste Page drop the page's 3D model; an event edit on a 2D map leaves the map marked changed after Undo; a malformed project lock blocks the project; a battle kept on another map blocks Start Battle on Map and encounters; a member added to the party mid-battle is not a unit; Classic placed enemies are not remembered as defeated.

## B. Decisions (recommendation in bold)

1. Paste Event Page adds a new page; MZ overwrites the selected one. **Overwrite, like MZ.**
2. The Circle tool grows from the center; MZ's Ellipse fits the drag. **Fit the drag; hold Alt to grow from the center.**
3. New Map defaults to tileset 1 (empty in the Demo). **Use the tileset of the map selected in the tree.**
4. A new map is not opened after OK. **Open it.**
5. Troop event pages never run in battles on the map. **Run them, with the same conditions as in Classic.**
6. Build has no camera turn. **Allow turning the camera while building.**
7. A roofed interior cannot be seen or edited in the editor. **Add a storey cut to the editor's 3D view, like the game's.**
8. Escape in Select with nothing selected returns to the last piece kind. **Leave Build instead.**
9. Get On lists blank, unnamed vehicle records and types with no placement. **List only placed or named vehicles.**
10. Set Vehicle Location cannot move a map's vehicle event. **List map vehicle events too.**
11. Character Generator's Align Y defaults to Middle, so a Looseleaf character stands about 40 px above its square in the game. **Always bottom-align walking sheets, and fix the Demo's config.**
12. Battle animations (Effekseer) anchor at the target's feet, including stock Fire One 1; MZ centers them unless the animation has Align Bottom. **Follow MZ: center unless Align Bottom.**
13. A character built in the Character Generator cannot be reopened (only the PNG is saved). **Save a recipe beside each PNG.**
14. A button to fill a sprite animation's frames from a sheet. **Yes.**
15. Rhea's roof cells on North Haven (x 85 to 89, y 74) see nothing, because Tree-01 is solid from its roots to its crown. **Leave a gap between trunk and crown in tree hulls, so sight lines under canopies work everywhere.**
16. Optimize aggressively promises about a quarter of the triangles, but texture seams can hold a model near its source (Vay Drokan kept 97%). **Report the triangle result in the status line.**
17. A quest reward that runs a common event and has no text shows nothing in the quest log. **Show the common event's name.**
18. A new blank project's window skin is dark blue-gray with a light frame. **Keep it.**
19. Deploy has no asset encryption. **Add it in MZ's format (the runtime already reads it).**
20. There is no Save As or copy-project command. **Add Save As.**
21. A blank project starts with an empty party. **Start with one actor.**
22. The Demo's motorcycles are vehicle events (five on North Haven, and Open Road: Forest event 1 in the older form). **Move them to Starting Positions (with the editor closed on the Demo), and Forest Road keeps no second motorcycle.**
23. The Demo's Actor Command setting. **Set it to Follows: The actor in the battle.**
24. A neighboring map's events appear only once its border is crossed, so parked vehicles pop in (77 ms for two). **Draw the events near the border ahead of the crossing.**
25. The light and the bank change at the North Haven and Forest Road border (night against day; cliff slope 80 against 42). **Match Forest Road to North Haven.**
26. Draw a neighboring map past a 2D map's edge. **Yes, after the items above.**
27. A Tactical walk that drew a reaction shot can no longer be undone. **Keep it; undoing would dodge the shot.**
28. Database layout, from the 2026-10-10 audit. **All of them:** one Combat section per page instead of "Shared Combat Settings"; drop the empty "Action and First Person Battles" heading in System 1 › Battles; fold Battle Room Setup's seven camera numbers and put Cancel and OK at the bottom right; set a state's motion in one place, not three; drop the Animations Properties section that holds only a hint; drop the Tilesets page's own Save button (Apply already writes); move Physics and Swimming from Controls to System 2.
29. Editor layout, from the same audit. **All of them:** Map Properties › Room and Sky into the map's own tools with live preview; Models › Select with nothing selected shows only the hint; Event Editor's Priority and Trigger visible at 768 and 600 high, with a smaller empty image box; fold Binding and 3D World Transform in Show / Transform Media Surface; the model picker's orientation fixer under Advanced; remove the toolbar's Lighting and Media Surfaces buttons, which duplicate the Build bar and Tools; shorten the Database menu to the sections; list Forge tools once; Escape closes the Event Editor and Forge, asking first when there are unsaved changes.
30. The web bundle before the next itch upload. **I propose a trim list for approval; the Psychronic BGM stays.** Music (156 MB) does not shrink in an archive.

## C. Only the owner can do these

1. By hand: dismount a vehicle with Escape, and load a save with the keyboard. In harness runs the menu twice opened by itself after the dismount, and one keyboard load did nothing. Both were probably the harness.
2. Review North Haven (landscape, rivers, foliage, HD materials, the village, night).
3. Look at the weak-GPU picture on the UHD 630: edges, beams, and the `"cas"` against the `"crisp"` upscale.
4. Look at the motion presets on Fleagus: Guard reads as hands up, Swim and Jump are awkward, and there are no finger joints.
5. Look at Preview 47 vehicles (`scratchpad/vehicle-corrections-20261022/review.html`) for visual acceptance.
6. Look at the floating windows on the real desktop: transparent rounded corners on Linux, the Forge's first opening, and the Plugin Manager beside the others.
7. Check weaker hardware and two monitors.
8. Release gates: signed Windows and macOS package launches, and one full game playthrough.

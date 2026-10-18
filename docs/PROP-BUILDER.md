# Prop Builder

Forge › Prop Builder makes props and saves them to the project as 3D models. Pick what to make at the top of the panel: **Flag** or **From picture**.

## Flag

- **Pole:** a metal flagpole, a wooden staff, a wall bracket or a crossbar banner, each with its own starting height, cloth and finial. Then the height (the bracket's length), the finial (ball, spearhead, eagle or none), the halyard rope on a metal pole, and the pole's and finial's colors.
- **Cloth:** width, shape (1:2, 3:5, 2:3, 3:4, 1:1, the tall 3:2 and 2:1, or Custom with its own height) and fabric: cotton bunting, silk, heavy wool, or worn and tattered (faded, soiled, holed and frayed at the fly, as much as **Wear** says).
- **Design:** solid, two or three bands either way, Nordic cross, saltire, canton, hoist triangle, border, a centered emblem, or **Picture**, an image from `img/pictures` laid over the whole cloth. Each layout shows its colors. An emblem (star, circle, crescent, shield, sun, eagle) goes in the center, the canton or by the hoist, in its color and size.
- **Wind:** strength from calm (the flag hangs in folds) to storm (it snaps), gusts, and the direction across the pole.

The view runs the cloth live as the sliders move. **Saved loop** in the Motion panel plays the loop Save writes.

## From picture

Choose a picture from `img/pictures`, then how to make it:

- **Cut-out:** the picture's outline becomes a solid board with the picture on its face. The outline comes from the picture's transparency or, with **Background color**, from the color around its border taken away (**Tolerance** says how near a color counts). Its height, board thickness, edge (beveled, rounded, square-cut), back (the picture, a color, or wood) and what it stands on (nothing, a stand, a post). Holes in the picture stay holes. A picture in several pieces (a logo and its lettering) sits on a backing plate that joins them, unless **Backing** is None.
- **Turned:** half an outline turned into a round solid: a pot, vase, bottle or column. **Follow the picture** takes the outline from the picture's silhouette; drag the points over the picture to change it (double-click adds a point, right-click removes one). Height, segments, an open or closed top, the wall thickness (0 is solid), and the surface: the picture laid on from the front, or clay, glaze, wood, polished metal or stone in a color.
- **Framed:** the picture on an object: a framed painting (gilded, wooden, black or no frame), a poster, a hanging banner (a crossbar banner in the wind, as Flag makes), a crate or a book.

## Saving

**Save to Project** writes `3d/Props/<name>/`:

- `source/<name>.glb`: the model with its pictures inside. A flag or banner is skinned to a grid of bones and carries its loop as the clip **Wave**: three seconds, the cloth simulated in the tool and baked, its end running on into its start. The game plays it; nothing is simulated while the game runs.
- `model.json`: the Wave clip playing always, and the model's own origin (the pole's foot, the bottom of a sign) placed where the prop stands. Other settings the 3D Models page keeps there stay.
- `prop.json`: the recipe, for **Open…**. `thumbnail.png`: the picture Open shows.

The model shows in Database › 3D Models like an imported one.

## In the game

The game lights models by the lights around them, not by the direction each face turns. Still props keep their form in their colors, shaded as if lit from above and in front. A flag's folds show by its outline and its moving picture; the builder's view also shades them.

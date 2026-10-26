# Visual research

What the table, the mallets and the puck are modelled on, how the model was compared with the
reference, and what was left out. The reference is a commercial coin-op air hockey table seen in
three photographs the author supplied: a low three-quarter view, a high view from above, and a
three-quarter view of the black finish. They are kept in `docs/reference/`, which is not
published. The reference's maker is never named in this project: its name is among the names the
public-safety check (`scripts/public-safety.ts`) refuses in tracked files and in the models.

## 1. The table

What the Blender model reproduces (`blender/scripts/table.py`):
- **The cabinet.** A deep box whose sides flare outward toward the top, a lofted trapezoid. Its
  side panels are speckled light grey powder coat on the silver finish and black on the black one,
  with black end caps that wrap each corner as a curved wedge.
- **The top rail.** Wide and flat, with rounded outer corners, satin light grey (white on the black
  finish), with a row of evenly spaced screw heads. Its inner wall is translucent blue acrylic, lit
  from within, and that wall's inner face is the physics' boundary.
- **The playing surface.** Glossy and blue, lit from within, with a white centre line across its
  width, a ring at the centre, our own mark (a puck) in place of the reference's logo, and the
  grid of air holes, visible only up close.
- **The goals.** Black housings centred on each end rail over the goal slot, running down the end
  face to the opening where the puck comes back out.
- **The score unit.** A black box with red seven-segment digits at the middle of the far side rail.
  In the game its digits show the live score.
- **The legs.** Four black legs, tapered and set slightly outward, with chrome levelling feet.
- **The front panel.** A red start button, a black button and a coin-door panel outline, in relief,
  with no text or brand.
- **The finishes.** Silver (silver body, black caps) and black (all black), switched in the
  settings by material name, as Pool's cloth colours are.

## 2. The mallets and the puck

- **The mallet** is a high-top mallet, lathed from the spec (`blender/scripts/mallet.py`): a wide
  base with a felt sole, a waist, and a round knob for the hand. The first player's is red, the
  second player's green.
- **The puck** is lathed from the spec (`blender/scripts/puck.py`): yellow and slightly
  translucent, as the coin-op table's plastic pucks are, with rounded edges and a shallow ring
  pressed into its top.

## 3. How the model was compared

`npm run models -- previews` renders the model in `blender/renders/` from the reference's three
camera angles, with a fourth close-up of the mallet and the puck. The renders were viewed beside
the photographs, and the model adjusted until the outline, proportions, colours and details
matched. The same comparison was then made in the browser, from Playwright screenshots with the
game's own lights. Changes it led to:
- The goal housing was lowered, and set back from the field, after it hid the near goal in the
  game's 3D view.
- The lamps' reflections on the glossy surface were softened (a rougher surface and clear coat, and
  smaller lamps), after they read as hard white bars.
- The 3D view was raised to 44° so that both goals show.
- The pieces' shadows were made faint contact shadows right at their feet. The lit surface washes
  out the lamps' own shadows, and a wider or offset shadow made the pieces look as if they floated.

## 4. Proportions

The playing field is 1.10 × 2.29 m and the top rail's outline 1.30 × 2.49 m, an 8-foot table
(`docs/table.md`). The proportions were checked against the reference's top-down photograph.

## 5. Limits of this research

- Only the photographs were used: no measurements of a real table beyond published cabinet sizes.
  The rail's height, the goal slot's width and the field's corner radius are judged from the
  photographs and tuned in play.
- The surface's markings and the score unit's digits are drawn by the game, not modelled, so they
  stay sharp at any zoom.
- The black finish's side panels are plain black; the reference's may carry decals, which are left
  out.

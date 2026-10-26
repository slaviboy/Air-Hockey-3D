# The table

One description of the table, `src/table/spec.ts`, drives everything:
- the physics
- the Blender model (through `blender/table-geometry.json`, which `node scripts/export-table.ts`
  writes, and a test keeps up to date)
- the camera's framing
- the zones

The rails drawn are the rails the puck hits: the model's inner faces at the puck's height lie on
the physics' walls to within 0.1 mm (`tests/unit/models.test.ts`).

## Dimensions

An 8-foot coin-op table of the reference's kind (`docs/visual-research.md`). The frame's x runs
across from the left rail's face, y along from seat 0's end rail's face, and z up from the surface.

| What | Value | Where it comes from |
|---|---|---|
| Top rail's outline | 1.30 × 2.49 m | an 8-foot table's cabinet top (listings: about 51 × 99.5 in over the goal housings) |
| Playing field, between the rails' faces | 1.10 × 2.29 m | the outline less a 10 cm top rail each side |
| Field's corners | 6 cm radius | the reference's top-down view |
| Goal slot | 0.28 m wide, 7 cm deep | tuned in play (below) |
| Slot's rounded posts | 1.2 cm radius | — |
| Rail above the surface | 2.8 cm | the reference's low acrylic wall |
| Surface above the floor | 0.80 m | a coin-op table's usual height |
| Puck | 82.55 mm across (3¼ in), 4.8 mm thick | a common home-table puck |
| Mallet | 101.6 mm across (4 in) at its felt base, 72 mm high | a high-top mallet |

**Assumptions.** Beyond the cabinet's outline and the puck, the figures are assumptions, measured
off the reference's photographs and then tuned in play. They are not taken from an official
rulebook.
- **The goal** started at 0.24 m. At that width the computer, whose mallet covers most of it,
  hardly ever conceded, so it was widened to 0.28 m and the models rebuilt.
- **The centre line** is at L/2 = 1.145 m. Each mallet's edge stops 2 mm plus the puck's radius
  short of it (`docs/physics.md`).

## Places on the table

From `src/table/geometry.ts`:
- **A mallet's home**: across the middle, 11 cm out from its end rail (the mallet's edge).
- **The serve spot**: across the middle, a quarter of the table from its end, or three quarters
  of the zone's depth when the zone is shorter. The server always reaches it.
- **Each seat's area**: where its mallet's centre may go. It is its zone, kept a mallet's radius
  inside the rails and the zone's front, with the field's rounded corners.

## The model

Built in Blender 5.2 by `npm run models`, which runs four steps:
1. inputs (the geometry JSON)
2. build (`blender/scripts/table.py`, `mallet.py`, `puck.py`, saved to `blender/air-hockey.blend`)
3. export (`public/models/table.glb`, `mallet.glb`, `puck.glb`)
4. previews (`blender/renders/`)

Each part is named:
- **The surface**: the playing surface and its slots.
- **The rails**: the top rail, its acrylic wall and its screws.
- **The cabinet**: its end caps, the goal housings, the score unit, the legs and their feet, and
  the front panel.

In the browser, each part's material is swapped for the game's own by name, as Pool does with its
cloth (`src/scene/TableView.ts`, `src/scene/surfaces.ts`).
- **The surface** is drawn by a shader from the spec, in world space, so it stays sharp at any
  zoom: the blue lit from within, the centre line, the centre circle, our own mark, and the grid
  of air holes (which fades to the surface's average shade where the holes become smaller than a
  pixel).
- **The score unit's** red digits are a canvas texture, updated with the live score.
- **The cabinet's finish**, silver or black, is chosen in the settings.

# Physics

How the puck slides and the mallets move. The code is in `src/physics/` and the walls are in
`src/table/geometry.ts`. Like the rules, it uses only exactly rounded arithmetic: `dmath.exp`
rather than `Math.exp`, no clocks, no random numbers. ESLint and an architecture test hold it to
that, so a match plays out the same in every browser.

## Fixed steps

The frame loop hands the match the time that passed. The match plays it in fixed steps of 1/240 s,
keeping what is left for the next frame, so the game runs alike at 30, 60 or 144 frames a second.
A frame that comes very late (a stalled tab) plays at most 24 steps and drops the rest. The puck
and the mallets are drawn between their last two steps.

## The walls a disc meets

A disc of radius r touches a rail when its centre is r from the rail's face. So the walls are built
once for each kind of disc, moved in by its radius:
- straight rails become lines r inside the faces
- the field's rounded corners become arcs (the centre stays inside them)
- the rounded edges of each goal slot become posts of their radius plus r (the centre stays
  outside them)

With r = 0 the same pieces are the faces themselves, which the Blender model is built from: the
rails drawn are the rails the puck hits, to within 0.1 mm (`tests/unit/models.test.ts`).

## A step

Within a step the puck slides in a straight line, and each mallet moves in a straight line to
where its player sent it.
- **The next contact.** The step finds the first contact in closed form: a line, a corner's arc, a
  post, or a moving mallet (a quadratic in the mallet's frame).
- **Resolving it.** The step moves everything to that moment, resolves the contact, and carries on
  with what is left of the step: at most eight contacts a step. So nothing passes through anything
  at any speed: not the puck at 6 m/s, nor a mallet at 5.5 m/s.
- **After the step**, the air's drag, the speed limit and the goal lines are applied.

| What | Value |
|---|---|
| Rail: speed kept across it | 0.88 |
| Rail: friction (tangential speed lost per unit of normal impulse) | 0.08 |
| Mallet: speed kept across it, relative to the mallet | 0.82 |
| Mallet friction | 0.04 |
| No bounce below this closing speed (the puck is pushed instead) | 0.05 m/s |
| Air drag: speed lost per second | 12 % (e^−0.12t) |
| At rest below | 4 mm/s |
| The puck's top speed | 6 m/s |
| The fastest any mallet moves | 5.5 m/s |
| A player's mallet: top speed, acceleration | 5 m/s, 90 m/s² |

**A mallet hit** is a bounce off a moving wall: the closing speed across the contact, in the
mallet's frame, comes back times 0.82, so a moving mallet hands the puck its momentum. A hit that
would pass the puck's top speed is trimmed along the contact first. The puck still leaves at least
as fast as the mallet follows it, so it never stays inside the mallet.

**Mallets are driven by hands, not by collisions.** They are kinematic: as heavy as the player
makes them.
- **A pinned puck.** A puck squeezed between a mallet and a rail cannot give way, so the mallet
  does. It stops pushing (it may still slide along the puck's edge), and nothing bounces or
  rattles.
- **After the step** nothing overlaps. A mallet into the puck pushes it out, and where the walls
  stop the puck, the mallet stands back instead.

## Steering a mallet

The pointer, a finger, the keys or the computer say where a mallet should be (`src/physics/mallet.ts`).
The mallet gets there as a hand would:
- no faster than its top speed
- its velocity changing no faster than its acceleration
- slowing in time to stop where it was sent, worked out per step so it never overshoots
- never out of its area: its zone and the rails

A pointer flicked across the table swings the mallet hard but never teleports it.

## The centre line

Each mallet's edge stops 2 mm plus the puck's radius short of the centre line. So neither mallet
can touch a puck on the other half: online, only the device of the player whose half the puck is
in plays it (`docs/protocol.md`). That leaves a strip 4 mm wide at the line, which no mallet
reaches. With zones shorter than half the table, the strip is wider: all the table between the
zones.

- **The nudge.** A puck in that strip that is slow up or down the table, below 0.12 m/s, is pushed
  toward the nearer zone at 0.6 m/s², as on a table not quite level. At the centre line it goes
  toward the half it is in.
  - It goes by the puck's speed *across* the table, not its speed: a puck sliding along the centre
    line from side rail to side rail would otherwise stay out of reach until the seven-second rule
    gave a foul against a player who could not touch it.
- **Fetching.** A puck that stops (or slides from side to side) between short zones is fetched,
  under the rules (`docs/rules.md`).

## Goals

The slot in each end rail is 0.28 m wide. A puck whose centre passes one radius beyond the goal
line, wholly inside the slot, is in the goal: the step reports it, and the puck rests there out of
play. The match counts a goal only from play (`src/rules/match.ts`), so a second report of the same
goal changes nothing.

## Prediction

`coast()` lets the puck slide on its own for a while, off the walls but past the mallets, on a copy
of the world. The computer uses it to see where the puck will be, and online play uses the same
steps to play a report on to now.

## How it was checked

`tests/unit/physics/` and `tests/unit/game/`:
- a rail bounce keeps 0.88 of the speed across it
- nothing tunnels at the top speeds, into corners or posts
- a moving mallet hands on its momentum
- a pinned puck separates without rattling
- drag and the speed cap
- a goal inside the mouth and none outside it
- mallets kept in their zones and under their speed (no teleport)
- a puck sliding along the centre line comes into reach within a tenth of a second

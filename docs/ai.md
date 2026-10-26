# The computer opponent

The computer plays the far mallet with a hand's limits, not a program's. It sees the puck late,
moves no faster than its level allows, and commits to a plan for a moment before changing its
mind. The code is `src/ai/ComputerPlayer.ts`, and the levels are in `src/ai/difficulty.ts`.

## How it plays

- **Every step** it says where its mallet should go. The mallet then gets there by the same
  steering as a player's (`src/physics/mallet.ts`), under its level's top speed and acceleration.
- **It sees the past.** It perceives the puck as it was a reaction time ago, between the two
  remembered steps around then.
- **It plans.** It picks one of five plans, and keeps it at least 0.15 s. It reconsiders ten times a
  second, and sooner when the puck turns about or off a rail by more than 25°.

| Plan | When | What it does |
|---|---|---|
| home | the puck is going away, or in the other half | waits in front of its goal, following the puck across the width (its "shadow") |
| defend | the puck is coming and cannot be met in time | stands between the puck and the goal |
| intercept | the puck is coming and can be met | goes where it will be, and strikes it on |
| attack | the puck is slow in its half | lines up behind it and strikes it at the other goal, or banks it off a side rail when the other mallet blocks the straight line |
| clear | the puck is behind its mallet | goes round it first, never pushing it back into its own goal |

**Predictions.** Its predictions run the real simulation forward (`coast()` in
`src/physics/puck.ts`), so it reads the bounces as they will happen. Where it expects to meet the
puck, and where its shots go, carry errors drawn once per decision from a seeded generator. So a
test with the same seed plays the same match every time, while each game against a person is
different.

**Zones.** It plays in the zone the match was set up with, and fetches a stranded puck under the
same rule as a player (`docs/rules.md`).

## The three levels

Each level is a person with a portrait in the New Game sheet.

| | Easy | Medium | Hard |
|---|---|---|---|
| Reaction time | 0.42 s | 0.34 s | 0.10 s |
| Top speed | 1.7 m/s | 2.1 m/s | 4.2 m/s |
| Acceleration | 11 m/s² | 15 m/s² | 45 m/s² |
| Strike speed | 2.2 m/s | 3.4 m/s | 4.6 m/s |
| Looks ahead | 0.4 s | 0.7 s | 1.4 s |
| Error in where it meets the puck | 13 cm | 10 cm | 1.5 cm |
| Error in its aim | 0.32 rad | 0.16 rad | 0.06 rad |
| Goes for the puck (0–1) | 0.3 | 0.6 | 0.85 |
| Banks shots | no | yes | yes |
| Waits in front of its goal | 30 cm out | 27 cm out | 17 cm out |

A new level is a new row of data; a new way of playing is a new plan in the same driver
(`Driver` in `src/game/Match.ts`).

## How it was checked

`tests/unit/ai/computer.test.ts` plays seeded matches with no screen:
- the stronger it is, the more of the same shots it saves
- at every level it takes a resting puck up the table, from anywhere in its half, and never into
  its own goal
- it settles when there is nothing to do, without twitching
- it keeps to its level's limits and to its own half
- a seeded game plays the same every time, from either end
- it plays within the smallest zone (`tests/unit/game/zones.test.ts`)

The end-to-end tests check that the computer at each level goes for the puck in a real browser.

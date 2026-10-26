# Rules

The rules a match is played by: `src/rules/match.ts` for the score, and `src/game/Match.ts` for the
puck and the clocks. They follow the common rules of table air hockey where they apply to a table
played in the browser; where they differ, the last section says how and why.

## How a match goes

- **The target.** A match is played to a number of goals, 3, 5, 7 or 10, chosen when it is set up
  (online, the host's choice). The first to it wins.
- **The first serve** is chosen too: a coin toss, either player, or (against the computer) you or
  the computer. The puck is put down on the server's spot, in the middle of their half, and is
  theirs to strike.
- **A goal** counts once the whole puck has gone into the slot in the end rail: its centre one
  radius past the goal line. It counts once, only from play: a second report of the same goal
  changes nothing. The player scored on serves next, after a pause of 1.6 s while both mallets
  glide home.
- **Keeping the puck.** A player may keep the puck in their half for seven seconds. Then it is a
  foul, and the other player serves, after a pause of 1.2 s. The ring round the player's card
  counts the seconds down, and the status says how many are left in the last three.
- **Giving up.** Against the computer the match can be conceded from the pause menu; online it can
  be resigned. The other player wins it as it stands.
- **A rematch** is the same terms again, and the loser serves first. Online, both players must
  ask.

## Mallet zones

Each player's mallet stays in their own zone, shown on the table in green. A match is set up with
the zone it is played with, the same for both players: for a match with a friend online, the
host's choice applies to both.

| Zone | How far up the table a mallet may go |
|---|---|
| Half | to the centre line (the standard game) |
| 2/5 | two fifths of the table's length |
| 1/3 | a third |
| 1/4 | a quarter |

"Up to the centre line" means the mallet's edge stops 2 mm plus the puck's radius short of it.
The puck can never be touched by both mallets at once, and online it is always clear whose half
plays it.

**Fetching a stranded puck.** With short zones the puck can come to rest, or slide from side to
side, where neither mallet may go. Then, after half a second, the player whose half it lies in may
take their mallet out of their zone, up to the centre line, and strike it, as a player at a real
table would. This holds while the puck is slower than 0.25 m/s up or down the table and out of
both zones' reach. Once it is struck, or comes within reach, the zone holds again, and the mallet
glides back into it no faster than a hand. The status line says who may go and get it.

**The band at the centre line.** A puck that stops in the 4 mm strip at the line, which neither
mallet reaches even with the whole half, slides out of it into the half it is in, as on a table
not quite level. So does a puck sliding along the line (`docs/physics.md`).

## Differences from a real table

- The puck never leaves the table and never jumps a rail.
- There is no face-off: every point starts with a serve from the server's spot.
- Mallets may not cross the centre line, even partly (some rules allow the mallet's edge over it).
  Online this keeps each half's play on one device.
- A goal against yourself (the puck struck into your own goal) counts for the other player, as it
  does at a real table.

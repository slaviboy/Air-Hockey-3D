# Sounds

What each contact sounds like, and where the sounds come from.

## How play is heard

- **Contacts.** The simulation reports every contact with its impact speed (`src/physics/puck.ts`):
  a mallet on the puck, the puck on a rail or a goal's post, and the puck dropping into a goal.
- **Loudness.** `src/audio/hitAudio.ts` turns each contact into a sound and a loudness. It is
  silent below 1.5 cm/s, then rises on a logarithmic curve to full at 6 m/s for a mallet, 5 for a
  rail and 4 for a post.
- **Crowding.** Contacts of one kind within 12 ms of each other are heard as one, and at most 14
  sounds ring at once, so a puck rattling in a corner stays a rattle.

`src/audio/SoundManager.ts` plays a recorded hit for each:

| Contact | Clips | How the loudness is used |
|---|---|---|
| mallet on the puck | `mallet-1`–`mallet-5`; `mallet-hard` from 82 % | gain, and a low-pass: soft taps are darker |
| puck on a rail | `rail-1`–`rail-4` | gain |
| puck on a goal's post | `post-1`, or `rail-3` played higher | gain |
| puck into a goal | `goal-1`, `goal-2` | gain |

**Variety and fallbacks.**
- A clip is picked at random from its set and played a few per cent higher or lower, so that
  repeats never sound alike.
- Until the clips have loaded (they load when audio starts, after the first click or key press),
  or if one cannot be loaded, a synthesised hit is played instead.

**Synthesised sounds:**
- **The table's blower** hums quietly while a match is on. The hiss of the puck on its air rises
  as it slides faster.
- **The game's notes**, short tones: a rising chord for a goal for you, two falling notes for one
  against you or a foul, a soft knock for a serve, and a longer chord for a match won.

## Where the clips come from

The clips are Pool's own (its `docs/sounds.md` gives every cut), renamed for what they are played
for here. They are cut from recordings on Pixabay, under the Pixabay Content License (see
[NOTICE.md](../NOTICE.md)).
- **The mallets.** The bright click of two billiard balls is close to a mallet's crack on a puck.
- **The rails.** A cushion's low thump is close to a puck off a rail.
- **The goal.** A ball dropping into a pocket is close to a puck dropping into the return.

| Clip | Pool's clip | Source on Pixabay |
|---|---|---|
| `mallet-1` | `ball-1` | Billiard Sound 6 (288417) |
| `mallet-2` | `ball-2` | pool_break (105353) |
| `mallet-3` | `ball-3` | Billiard Sound 03 (288424) |
| `mallet-4` | `ball-4` | Billiard Sound 02 (288423) |
| `mallet-5` | `ball-5` | Billiard Sound 02 (288423) |
| `mallet-hard` | `ball-hard` | pool_break (105353) |
| `rail-1` | `cushion-1` | Billiard Sound 02 (288423) |
| `rail-2` | `cushion-2` | Billiard Sound 05 (288416) |
| `rail-3` | `cushion-3` | Billiard Sound 03 (288424) |
| `rail-4` | `cushion-4` | Billiard Sound 02 (288423) |
| `post-1` | `jaw-1` | pool_break (105353) |
| `goal-1` | `pocket-1` | Billiard Hole (288419) |
| `goal-2` | `pocket-2` | Billiard Hole 2 (288420) |

The files are byte for byte Pool's. They were chosen from measurements and waveforms, not by ear,
and none was recorded at an air hockey table. A recording of a real table (a mallet's crack, the
puck's clack on an acrylic wall, the blower) would sound truer.

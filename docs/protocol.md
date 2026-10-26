# Online protocol

Two players' browsers play a match directly, over a WebRTC data channel, with nothing in between
to referee. Air hockey is played in real time, not in turns as Pool is, so it cannot simulate
every move on both sides and compare. Instead **the puck belongs to the half it is in**. The device
of the player whose half it is in plays it, against that player's own mallet with no delay. That
device tells the other where it is thirty times a second, and passes it over when it crosses the
centre line. Each side checks everything the other sends.

The code:
- `src/net/` is the session, which knows no game. It is Pool's, with one option added: the rate
  limits.
- `src/game/hockeyMessages.ts` and `src/game/HockeyPort.ts` are air hockey's part.

## Finding each other

This is Pool's, unchanged apart from the names:
- **The link** carries 128 random bits in its hash, `https://…/air-hockey-3d/#g=<secret>`. Browsers
  never send the hash to the web server. It is shown as a QR code too, drawn in the page.
- **The room.** The two meet in a room on public Nostr relays named by
  `SHA-256("air-hockey room:" + secret)`. Trystero's app id is `air-hockey-slaviboy`.
- **The password.** The secret is Trystero's password, which encrypts the handshake.
- **One partner** is admitted; anyone else is refused.
- **The clock** comes from the web server, so players whose clocks are hours off still meet.
- **The warning comes first.** Every online game starts with the 18+ and IP-address warning, its
  box unticked, before anything connects.

## Messages

Every message is a JSON object with a type `t`, at most 4096 bytes. The session's own messages are
Pool's:
- `hello`
- `setup` (with air hockey's terms: `target`, `reach`, `names`, `host`, `firstServe`)
- `desync`
- `resign`
- `rematch`
- `media`
- `bye`

Air hockey's messages travel in whole numbers. Positions are in tenths of a millimetre, speeds in
millimetres a second, and clocks in milliseconds:

| Message | From | Meaning |
|---|---|---|
| `st {s, m, a, r, h, x, y, p?}` | both, 30 a second | The sender's state. `s` is its clock: `performance.now()`, which only ever goes forward. `m` is its match's own clock, the milliseconds of play so far, which a slow page runs slower than real time. `a` is the last of the other side's clocks it heard. `r` is the puck's token as it has it, and `h` whether its page is hidden. `x, y` is its mallet. `p = [x, y, vx, vy]` is the puck, while the puck is the sender's to play. |
| `pass {s, age, r, p}` | the puck's holder | The puck crossed the centre line `age` ms before `s`. It is the other side's now, with token `r`, and `p` is its state at the crossing. |
| `goal {s, n}` | the player scored on | A goal into the sender's own goal: the match's goal number `n`. |
| `foul {s, n}` | the holder | The sender kept the puck in its half past seven seconds: the match's foul number `n`. |
| `serve {s, r}` | the server | The sender served: the puck lies on its spot, with token `r`. |
| `sync {n, score, fouls, phase, server, winner, conceded, r, p}` | host | The host's match, to bring the guest's back in step (below). |

**The puck's token** `r` says whose the puck is: player `r % 2`'s. It goes up each time the puck
changes hands:
- a pass sets `r + 1`
- a serve sets the next number with the server's parity

So any two moments of a match can be ordered, and an old report is told from a new one.

## Playing the puck

- **The holder plays it.** The puck's holder simulates it every step (240 a second), with its own
  mallet. A hit there is felt at once, with no delay at all.
- **Only one mallet can reach the puck.** Each mallet's edge stops 2 mm plus the puck's radius short
  of the centre line, so neither can touch a puck on the other half. A puck in the band at the line,
  or sliding along it, is nudged out of it into the half it is in (`docs/physics.md`).
- **The other device predicts.** It plays the puck on from each report, back-dated by how long the
  report took to arrive. It includes its own mallet: a puck heading for its half meets its mallet
  as it would after the pass.
- **The report's age.** It is estimated from the stamps: receive time minus `s`, less the least
  such gap seen, plus half the round trip. It is capped at the smaller of that estimate, half the
  round trip + 30 ms, and 300 ms.
- **Replaying from a report.** The device puts the puck where the report says and plays it again to
  now. Its own mallet moves along the path it really took over those steps (each device keeps
  half a second of its mallet's path). The jump on screen fades over 70 ms.
- **The pass.** When the puck crosses the centre line on the holder's device, the holder sends
  `pass` with the puck at the crossing, and stops playing it. The receiver plays it again from the
  crossing with its own mallet's path over the same time. So a hit the receiver made while the
  pass was on its way still counts, and a puck that went on into its goal goes in.
- **A pass during a hold** is played from where it crossed once play goes on, with no rewind.
- **The other mallet** is drawn 60 ms behind its newest report, between the two reports around
  then, so it moves smoothly.

## Calls, and who makes them

Each device calls only what is against its own player, while the puck is that player's. The other
device is told:
- **A goal** is called by the player scored on (the puck is on their half when it goes in). The
  other side counts it from `goal`, once: only from play, and only if its number is the next one.
  The player scored on serves next, as on one device.
- **The seven-second rule** is called by the holder on itself.
- **A serve** is made by the server's own device once the pause is over. The other device keeps
  its pause until the `serve` arrives.
- **Sending again.** A pass or a serve the other side's reports still do not show, after the round
  trip and 500 ms, is sent again; a copy that arrives twice is ignored.

## Holding play

Play stands still, and goes on from where it stood (a hold never restarts a rally, so it never
cancels a goal on its way in):
- **A hidden page** (another tab, the phone locked). The page says so at once in `st`, and the
  other side holds too. After two minutes hidden, its player loses the match. The other player
  sees the time left in the status line.
- **Silence.** Nothing heard for 1.5 s. While nothing has been heard for a second, or the other
  side's `a` shows it no longer hears this one, `st` goes out four times a second instead of
  thirty, so no backlog builds up.
- **The session's own holds**: the friend away, or the two being brought back in step.

The menu does not hold play online, as Pool's menus do not stop its shot clock.

## What each side checks

Nothing the other side sends is taken on trust. These break the rules, and the sender loses the
match and is disconnected:
- **Its clock**: `s` never goes back. Where it stands against this side's clock is measured over
  the first five seconds (a page busy as the match starts handles its first messages late), and
  after that it never runs more than 3 s further ahead.
- **Its mallet** stays in its own half (2 mm slack), and moves no faster than 1.2 × 5.5 m/s over
  the time between stamps and a tenth of a second, plus 4 mm.
  - **The tenth of a second** is a frame's worth. A frame plays at most 0.1 s of a match at once,
    from the time owed since the last, so between two reports a slow page's match can run on
    that much longer than their stamps say. The real two-browser test found it: a page drawing a
    few frames a second was taken for a cheat.
  - Within its half, a mallet out of its zone is not caught: the zone is kept by the player's own
    device (it widens to the whole half while a stranded puck is fetched, `docs/rules.md`).
- **The puck** may be reported only by its holder: with the current token, from the sender's half.
  It is never faster than 1.1 × 6 m/s + 5 cm/s. It is never through a wall (2 mm slack) or past a
  goal line without a goal. It never moves further than 1.1 × 6 m/s over the time between stamps
  and a tenth of a second, plus 15 mm.
- **A pass** comes from the holder, with the next token, of a puck over the centre line into the
  receiver's half.
- **A serve** comes from the server, in the pause before it, with the next token of its parity.
- **Its clocks**, on its own match's clock `m`, so a slow page is not hurried:
  - A serve must come within 3 s + 2 s of the pause starting, and within ten times that in real
    time, so a page whose match clock stood still could not hold the match up.
  - The holder must call the seven-second rule on itself within 2 s.
  - A page hidden for two minutes (real time) loses.
- **Courses changed from nowhere.** A puck whose course changed by more than 0.3 m/s with no wall
  and no mallet of the sender's near, or a puck inside the sender's mallet, is a strike. Three
  strikes in 20 s break the rules.

These only put the two out of step, which the host's match then mends:
- a goal or foul that is not the next one
- a token that stays different from this side's for the round trip and a second
- a holder's report without the puck

## Staying in step, and coming back

- **A difference.** When the two disagree, the session stops play on both sides and sends the
  host's match (`sync`), as in Pool. The guest compares the score, the fouls, the phase, the
  server and the token with its own. If they differ, it takes the host's, with the puck where the
  host has it. More than three differences in a session end it, with nobody losing.
- **A guest that reloads** rejoins from what its tab kept (`sessionStorage`) and takes the host's
  match.
- **A host that reloads** has lost the rally it was in. It picks the match up before a serve, and
  the guest serves. A player who reloads never gains by it.

## Limits

- **The guard.** It allows 60 messages a second on average and bursts of 240; 20 dropped messages
  disconnect. Air hockey streams about 34 a second each way. Pool's limits, 20 a second for a game
  of turns, would cut a player off within seconds.
- **Message size** is at most 4096 bytes, as in Pool; air hockey's largest, a `sync`, is under
  200 bytes.

## What it does not protect against

- **A defender lying about its own half.** It could report the puck a little off within what is
  physically possible: a few centimetres, a slightly different bounce. The checks catch teleports,
  impossible speeds, walls passed through and courses changed from nowhere, not every subtle lie.
- **A mallet outside its zone but inside its half**, on a modified client.
- **A match clock stood still.** A modified client that stops its `m` can keep the puck in its own
  half past seven seconds: the seven-second rule is timed on the holder's own clock so that a slow
  device is never taken for a cheat. It gains no goal by it.
- **Hits right at the centre line.** The puck crossing reaches the other side about half a round
  trip late. The replay keeps the receiver's own hits, but the holder's view of the receiver's
  mallet is a few frames old.
- **No relay (TURN) server.** About one pair of networks in ten cannot connect directly, as with
  Pool.

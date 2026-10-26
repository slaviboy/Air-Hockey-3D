# Air Hockey 3D

A 3D air hockey game for the browser: three.js scene, a table, mallets and a puck modelled in
Blender, a real-time puck simulation, a computer opponent at three strengths, and online play with a
friend over WebRTC with voice and video. It shares its interface, online layer and tooling with the
author's Pool and Grandmaster 3D. Read `README.md` for features and commands, and the documents in
`docs/` for the physics, the protocol, the table and its look.

## Commit rules

These are enforced by `.githooks/`, enabled with `git config core.hooksPath .githooks`.

- **Author.** Every commit is authored by `slaviboy <slavi94slavi94@gmail.com>`. The repository's
  local git config sets this, and `pre-commit` rejects anything else.
- **No co-author trailers.** `commit-msg` strips `Co-Authored-By:` lines. Do not add them.
- **License headers.** The project is GPL-3.0-or-later. Every hand-written source file starts with
  the GPL header (`Copyright (C) 2026 Stanislav Georgiev`, `https://github.com/slaviboy`, GNU
  General Public License). `tests/architecture/licenseHeaders.test.ts` enforces this.
- **No secrets.** `tests/architecture/secrets.test.ts` scans tracked files.
- **Nothing private.** The repository is public. No e-mail address but the author's, no path of
  the computer the work is done on, no copyright holder who is not credited, and no metadata in
  images (strip it with `node scripts/image-metadata.ts strip <files>`). This applies inside
  binary files too: Blender writes paths into renders and into the .blend, so save the .blend
  through `common.save_blend`. `tests/architecture/identity.test.ts` enforces this, and
  `npm run audit` checks every commit in the history (the deploy workflow runs it). The rules live
  in `scripts/public-safety.ts`.
- **Product naming.** The product is Air Hockey 3D. The commercial table whose look inspired it is
  never named in tracked files: not in source, comments, identifiers, UI strings, documentation or
  commit messages. Write "the reference" instead. `tests/architecture/branding.test.ts` enforces
  this, also inside images and models. Reference photographs stay in `docs/reference/`, which is
  gitignored.
- **Messages.** Use conventional prefixes (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`,
  `chore:`, `ci:`) in the imperative mood, with a body that says what changed and why. Make one
  meaningful change per commit, and commit after every one. Never push; the owner pushes.

## Commands

```
npm run dev          # Vite dev server
npm run build        # type-check, then production build
npm test             # Vitest: unit + architecture
npm run test:e2e     # Playwright against the production build (ask before running all of it)
npm run lint         # ESLint
npm run format:check # Prettier
npm run models       # rebuild the table, mallet and puck with headless Blender
npm run audit        # the whole history: authors, messages, every file version (public safety)
npm run audit:dist   # the built site: no source maps, local addresses or private data
```

**Run end-to-end tests one file at a time** (`npx playwright test tests/e2e/boot.spec.ts`). The
machine is shared with other work: never start the whole suite, or a second run, without asking.
A second working copy must test on its own port (`AIR_HOCKEY_E2E_PORT`), or its run reuses the
first copy's server and tests the wrong build.

## Rules that keep the game correct

- **The simulation is deterministic.** `src/physics`, `src/table` and `src/rules` use only exactly
  rounded arithmetic (`+ - * /`, `Math.sqrt` and the exact `Math` helpers); exponentials come from
  `src/physics/dmath.ts`; no clocks, random numbers, DOM or outside imports. ESLint and
  `tests/architecture/determinism.test.ts` enforce it. The simulation advances in fixed steps; the
  frame loop only decides how many.
- **One table, everywhere.** `src/table/` describes the table once. The simulation uses it
  directly, and the Blender model is built from `blender/table-geometry.json`, which
  `node scripts/export-table.ts` writes from it (a unit test fails while it is stale). The rails
  drawn are the rails the puck hits.
- **The match leads, meshes follow.** The match (`src/game/Match.ts`) owns the puck, the mallets and
  the score; the scene only shows them. A goal is counted once, from the `play` phase only.
- **Online, each side referees what it receives.** Everything from the other player passes
  `PeerGuard` (size, rate, shape), `OnlineSession` (who may say what, when) and `HockeyPort` (the
  puck's authority, the halves, speeds, continuity and the score). The puck is simulated by the
  side whose half it is in; never trust the other side's results or media state. A rule break
  forfeits and disconnects. Only `src/net/PeerLink.ts` touches Trystero or a peer connection;
  never put network objects on `window` or log addresses, candidates or SDP. Every online game
  starts with the 18+ and IP warning, its box unticked, before anything connects. See
  `docs/protocol.md`.
- **The session knows no game.** `src/net/` is the sister games' session; air hockey plugs in
  through `src/game/HockeyPort.ts` and `src/game/hockeyMessages.ts`. The build id
  (`scripts/build-id.ts`) fingerprints the code both players must share, so players on different
  builds are asked to reload rather than play on.

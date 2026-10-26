/*
 * Copyright (C) 2026 Stanislav Georgiev
 * https://github.com/slaviboy
 *
 * This file is part of Air Hockey 3D.
 *
 * Air Hockey 3D is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. See the LICENSE file for the full terms.
 */

// Lets two devices whose clocks disagree still find each other through the Nostr relays.
//
// Trystero's Nostr strategy stamps what it sends with this device's clock, and subscribes with
// `since: now()` from the same clock. Relays drop live events stamped before a subscription's
// `since`, and some refuse events stamped too far from their own time. So when the host's clock
// runs even a few seconds behind the guest's, every reply the host sends is hidden from the guest
// and the two never meet; a clock set by hand, or hours off, is not heard at all.
//
// Two changes to that one file fix it:
// - Its clock becomes serverNow() (src/net/serverTime.ts): this device's clock corrected by the
//   site's server, so both players stamp and filter by the same time whatever their own clocks say.
// - Its subscriptions ask for events from a while back, in case the server could not be asked.
//   Trystero's signalling kinds (20000-29999) are ephemeral in Nostr, so relays keep little or
//   nothing to replay.

import type { Plugin } from 'vite';

/** How far another device's clock may be behind this one's and still be heard, unsynced. */
export const CLOCK_SKEW_SECONDS = 600;
/** The clock the strategy is given, as an id Vite resolves from the project root. */
export const SERVER_TIME_MODULE = '/src/net/serverTime.ts';

const NOSTR_STRATEGY = /[\\/]@trystero-p2p[\\/]nostr[\\/]dist[\\/]index\.mjs$/;
const SITES = [
  [
    'const now = () => Math.floor(Date.now() / 1e3);',
    'const now = () => Math.floor(serverNow() / 1e3);',
  ],
  ['since: now()', `since: now() - ${CLOCK_SKEW_SECONDS}`],
  ['const since = now();', `const since = now() - ${CLOCK_SKEW_SECONDS};`],
] as const;

/** Rewrites the strategy's code as above; throws if it does not look as expected. */
export function patchNostrStrategy(code: string): string {
  let out = code;
  for (const [from, to] of SITES) {
    const count = out.split(from).length - 1;
    if (count !== 1) {
      throw new Error(
        `trystero-clock-skew: expected "${from}" once in Trystero's Nostr strategy, found ${count}. ` +
          'Check its clock and subscription window after a Trystero upgrade.',
      );
    }
    out = out.replace(from, to);
  }
  return `import { serverNow } from ${JSON.stringify(SERVER_TIME_MODULE)};\n${out}`;
}

/** The Vite plugin that applies patchNostrStrategy to Trystero, in development and in builds. */
export function trysteroClockSkew(): Plugin {
  return {
    name: 'trystero-clock-skew',
    enforce: 'pre',
    transform(code, id) {
      if (!NOSTR_STRATEGY.test(id.split('?')[0]!)) return null;
      return { code: patchNostrStrategy(code), map: null };
    },
  };
}

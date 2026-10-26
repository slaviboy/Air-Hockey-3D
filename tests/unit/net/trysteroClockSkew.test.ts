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

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_SECONDS,
  SERVER_TIME_MODULE,
  patchNostrStrategy,
  trysteroClockSkew,
} from '../../../scripts/trystero-clock-skew.ts';

const STRATEGY = 'node_modules/@trystero-p2p/nostr/dist/index.mjs';
const installed = () => readFileSync(STRATEGY, 'utf8');

/** Runs the plugin's transform the way Vite does. */
function transform(code: string, id: string): string | null {
  const hook = trysteroClockSkew().transform as (code: string, id: string) => { code: string };
  return hook.call({}, code, id)?.code ?? null;
}

describe('trystero clock skew', () => {
  it("gives the installed Nostr strategy the server's clock and a wider window", () => {
    const code = patchNostrStrategy(installed());
    expect(code.startsWith(`import { serverNow } from "${SERVER_TIME_MODULE}";\n`)).toBe(true);
    expect(code).toContain('const now = () => Math.floor(serverNow() / 1e3);');
    // Every stamp and every window goes through that clock.
    expect(code).not.toMatch(/Date\.now\(\)\s*\/\s*1e3/);
    expect(code).toContain('created_at: now(),');
    expect(code).toContain(`since: now() - ${CLOCK_SKEW_SECONDS},`);
    expect(code).toContain(`const since = now() - ${CLOCK_SKEW_SECONDS};`);
    expect(code).not.toMatch(/since(?::| =) now\(\)(?! - )/);
  });

  it('refuses a strategy it does not recognise, so an upgrade cannot drop the fix quietly', () => {
    expect(() => patchNostrStrategy('const since = Date.now();')).toThrow(/trystero-clock-skew/);
  });

  it('touches only the Nostr strategy, whichever way the path is written', () => {
    const code = installed();
    expect(transform(code, `/repo/${STRATEGY}`)).toContain('serverNow()');
    expect(transform(code, `C:\\repo\\${STRATEGY.replaceAll('/', '\\')}?v=1`)).not.toBeNull();
    expect(transform(code, '/repo/node_modules/@trystero-p2p/core/dist/index.mjs')).toBeNull();
    expect(transform(code, '/repo/src/net/PeerLink.ts')).toBeNull();
  });
});

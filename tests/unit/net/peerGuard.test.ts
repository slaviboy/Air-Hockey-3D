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

import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, PeerGuard } from '../../../src/net/PeerGuard.ts';
import { parseMessage, type GameCodec } from '../../../src/net/protocol.ts';

/** A game that knows one message, { t: 'poke', n }, and no terms. */
const codec: GameCodec<{ t: 'poke'; n: number }, Record<string, never>> = {
  parse: (data) =>
    data.t === 'poke' && Object.keys(data).length === 2 && Number.isInteger(data.n)
      ? { t: 'poke', n: data.n as number }
      : null,
  parseTerms: () => ({}),
};

function guard() {
  let time = 0;
  return {
    guard: new PeerGuard(
      (data) => parseMessage(data, codec),
      () => time,
    ),
    advance: (ms: number) => (time += ms),
  };
}

const poke = { t: 'poke', n: 3 };

describe('PeerGuard', () => {
  it('lets well-formed messages through, the session’s and the game’s', () => {
    const { guard: g } = guard();
    expect(g.check(poke)).toEqual({ ok: true, message: poke });
    expect(g.check({ t: 'resign' })).toEqual({ ok: true, message: { t: 'resign' } });
    expect(g.drops).toBe(0);
  });

  it('drops malformed data and counts it', () => {
    const { guard: g } = guard();
    for (const data of [null, 'poke', 42, { t: 'poke' }, { t: 'resign', extra: 1 }]) {
      expect(g.check(data)).toMatchObject({ ok: false, disconnect: false });
    }
    expect(g.drops).toBe(5);
  });

  it('drops a message over the size limit before reading it', () => {
    const { guard: g } = guard();
    const huge = { t: 'hello', v: 1, build: 'b', name: 'x'.repeat(DEFAULT_LIMITS.maxBytes) };
    expect(g.check(huge)).toMatchObject({ ok: false, reason: 'size' });
    // Counted in bytes, not characters: four-byte characters fill the limit four times as fast.
    const wide = { t: 'hello', v: 1, build: 'b', name: '\u{1F3B1}'.repeat(1100) };
    expect(g.check(wide)).toMatchObject({ ok: false, reason: 'size' });
  });

  it('drops a flood beyond the burst, then lets messages through at the average rate', () => {
    const { guard: g, advance } = guard();
    for (let i = 0; i < DEFAULT_LIMITS.burst; i++) expect(g.check(poke).ok).toBe(true);
    expect(g.check(poke)).toMatchObject({ ok: false, reason: 'rate' });
    advance(1000 / DEFAULT_LIMITS.perSecond);
    expect(g.check(poke).ok).toBe(true);
  });

  it('asks to disconnect a peer that keeps sending bad data', () => {
    const { guard: g } = guard();
    let last = g.check(null);
    for (let i = 1; i < DEFAULT_LIMITS.maxDrops; i++) last = g.check(null);
    expect(last).toMatchObject({ ok: false, disconnect: true });
  });

  it('survives data that cannot be measured', () => {
    const { guard: g } = guard();
    const cyclic: Record<string, unknown> = { t: 'resign' };
    cyclic.self = cyclic;
    expect(g.check(cyclic)).toMatchObject({ ok: false, reason: 'size' });
    expect(g.check({ t: 'resign', n: 10n })).toMatchObject({ ok: false, reason: 'size' });
  });
});

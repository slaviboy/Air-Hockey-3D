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
import {
  MAX_COUNT,
  MAX_NAME_LENGTH,
  PROTOCOL_VERSION,
  cleanName,
  createInvite,
  createToken,
  inviteFromText,
  inviteUrl,
  isInvite,
  parseInvite,
  parseMessage,
  roomFor,
  setupMessage,
  type GameCodec,
} from '../../../src/net/protocol.ts';

const SAMPLE_ID = 'abcdefghijklmnopqrstuv';

/** A game with one message of its own and terms of one field. */
const codec: GameCodec<{ t: 'poke'; n: number }, { race: number }> = {
  parse: (data) =>
    (data.t === 'poke' || data.t === 'resign') && Number.isInteger(data.n)
      ? ({ t: data.t, n: data.n as number } as { t: 'poke'; n: number })
      : null,
  parseTerms: (data) =>
    Object.keys(data).length === 1 && Number.isInteger(data.race)
      ? { race: data.race as number }
      : null,
};

const parse = (data: unknown) => parseMessage(data, codec);

describe('the session envelope', () => {
  it('accepts every session message in its exact shape', () => {
    const valid = [
      { t: 'hello', v: PROTOCOL_VERSION, build: 'abc-1.2', name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'abc', name: 'Ana', token: SAMPLE_ID },
      { t: 'desync', n: 0 },
      { t: 'desync', n: 41 },
      { t: 'resign' },
      { t: 'rematch' },
      { t: 'media', mic: true, cam: false },
      { t: 'bye' },
    ];
    for (const message of valid) expect(parse(message)).toEqual(message);
  });

  it('carries the game’s terms in a setup, beside the token', () => {
    const wire = setupMessage(SAMPLE_ID, { race: 3 });
    expect(wire).toEqual({ t: 'setup', token: SAMPLE_ID, race: 3 });
    expect(parse(JSON.parse(JSON.stringify(wire)))).toEqual({
      t: 'setup',
      token: SAMPLE_ID,
      terms: { race: 3 },
    });
    expect(parse({ t: 'setup', token: SAMPLE_ID, race: 3, extra: 1 })).toBeNull();
    expect(parse({ t: 'setup', token: 'short', race: 3 })).toBeNull();
    expect(parse({ t: 'setup', race: 3 })).toBeNull();
  });

  it('passes other types to the game, which may not take over a session type', () => {
    expect(parse({ t: 'poke', n: 2 })).toEqual({ t: 'poke', n: 2 });
    // The codec above would read this one, but a session type is the session's alone.
    expect(parse({ t: 'resign', n: 2 })).toBeNull();
  });

  it('drops anything that is not an object with a known type', () => {
    for (const data of [null, 3, 'poke', [], ['poke'], {}, { t: 'castle' }, { t: 7 }]) {
      expect(parse(data)).toBeNull();
    }
  });

  it('drops extra, missing and wrongly typed fields', () => {
    const bad = [
      { t: 'resign', winner: 0 },
      { t: 'bye', reason: 'x' },
      { t: 'desync' },
      { t: 'desync', n: -1 },
      { t: 'desync', n: 1.5 },
      { t: 'desync', n: MAX_COUNT + 1 },
      { t: 'desync', n: '3' },
      { t: 'hello', v: 0, build: 'b', name: 'Ana' },
      { t: 'hello', v: 1.5, build: 'b', name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, build: '', name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'a b', name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'x'.repeat(41), name: 'Ana' },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'b', name: 7 },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'b', name: 'x'.repeat(500) },
      { t: 'hello', v: PROTOCOL_VERSION, build: 'b', name: 'Ana', token: 'short' },
      { t: 'media', mic: 'yes', cam: false },
      { t: 'media', mic: true },
    ];
    for (const data of bad) expect(parse(data), JSON.stringify(data)).toBeNull();
  });

  it('ignores inherited properties and refuses prototype tricks', () => {
    const sneaky = JSON.parse('{"t":"resign","__proto__":{"winner":0}}');
    expect(parse(sneaky)).toBeNull();
    const inherited = Object.create({ n: 0 });
    Object.assign(inherited, { t: 'desync' });
    expect(parse(inherited)).toBeNull();
  });

  it('cleans the name in a hello', () => {
    const parsed = parse({ t: 'hello', v: 1, build: 'b', name: ' <b>Ana</b>‮ ' });
    expect(parsed).toEqual({ t: 'hello', v: 1, build: 'b', name: '<b>Ana</b>' });
  });
});

describe('cleanName', () => {
  it('removes control and direction characters, collapses spaces and cuts to length', () => {
    expect(cleanName('  Ana\u0000 \n Bell‏ ')).toBe('Ana Bell');
    expect(cleanName('x'.repeat(100))).toHaveLength(MAX_NAME_LENGTH);
    expect(cleanName('‮\u0007')).toBe('Friend');
    expect(cleanName('', 'You')).toBe('You');
  });
});

describe('invitation links', () => {
  it('carries only the secret, after the bare page address', () => {
    const invite = createInvite();
    expect(isInvite(invite)).toBe(true);
    const url = inviteUrl('https://example.org/air-hockey-3d/?quality=low&menu=0#old', invite);
    expect(url).toBe(`https://example.org/air-hockey-3d/#g=${invite.secret}`);
    expect(parseInvite(new URL(url).hash)).toEqual(invite);
    expect(createInvite()).not.toEqual(invite);
    expect(createToken()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('stays short: 66 characters on the published site', () => {
    const url = inviteUrl('https://slaviboy.github.io/air-hockey-3d/', createInvite());
    expect(url.length).toBe(66);
  });

  it('derives the same room for both players, a different one for every game', async () => {
    const invite = createInvite();
    const room = await roomFor(invite);
    expect(await roomFor({ ...invite })).toBe(room);
    expect(room).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(room).not.toContain(invite.secret);
    expect(await roomFor(createInvite())).not.toBe(room);
  });

  it('accepts only the exact form', () => {
    const { secret } = createInvite();
    for (const hash of [
      '',
      '#g=',
      `#g=${secret}x`,
      `#g=${secret}&x=1`,
      `#g=${secret.slice(1)}<`,
      `#G=${secret}`,
      `#play=${secret}`,
      `#g=${secret}.${secret}`,
    ]) {
      expect(parseInvite(hash), hash).toBeNull();
    }
  });

  it('finds the invitation in a pasted link, or in its hash alone', () => {
    const invite = createInvite();
    const url = inviteUrl('https://example.org/air-hockey-3d/', invite);
    expect(inviteFromText(`  ${url}\n`)).toEqual(invite);
    expect(inviteFromText(`#g=${invite.secret}`)).toEqual(invite);
    expect(inviteFromText('https://example.org/air-hockey-3d/')).toBeNull();
    expect(inviteFromText(`${url}x`)).toBeNull();
  });
});

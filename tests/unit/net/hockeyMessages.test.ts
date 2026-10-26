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

// Air hockey's messages as they travel: exactly the shapes it sends, nothing else, in whole
// numbers; the puck's token and whose it is; the host's match taken only when it could be one.

import { describe, expect, it } from 'vitest';
import {
  decodePuck,
  encodePuck,
  holderOf,
  nextToken,
  parseHockeyMessage,
  parseTerms,
  rematchTerms,
  setupFor,
  stateFromSync,
  syncMessage,
} from '../../../src/game/hockeyMessages.ts';
import { newMatch } from '../../../src/rules/match.ts';
import { TABLE } from '../../../src/table/spec.ts';
import { terms } from '../../support/onlineSides.ts';

const st = { t: 'st', s: 1200, m: 900, a: 1100, r: 3, h: false, x: 5850, y: 1500 };

describe('air hockey’s messages', () => {
  it('take the host’s terms exactly, and clean the names', () => {
    const t = terms('Ben');
    expect(parseTerms({ ...t })).toEqual(t);
    expect(parseTerms({ ...t, names: [' Ana‮ ', ''] })?.names).toEqual(['Ana', 'Player 2']);
    for (const bad of [
      { ...t, target: 0 },
      { ...t, target: 2.5 },
      { ...t, reach: 'everything' },
      { ...t, host: 2 },
      { ...t, firstServe: '0' },
      { ...t, names: ['Ana'] },
      { ...t, extra: 1 },
    ]) {
      expect(parseTerms(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('read each message only in its exact shape, in whole numbers', () => {
    expect(parseHockeyMessage(st)).toEqual(st);
    const withPuck = { ...st, p: [5850, 11700, -1200, 3400] };
    expect(parseHockeyMessage(withPuck)).toEqual(withPuck);
    const pass = { t: 'pass', s: 9, age: 20, r: 4, p: [5850, 11710, 0, 900] };
    expect(parseHockeyMessage(pass)).toEqual(pass);
    expect(parseHockeyMessage({ t: 'goal', s: 9, n: 1 })).toEqual({ t: 'goal', s: 9, n: 1 });
    expect(parseHockeyMessage({ t: 'foul', s: 9, n: 2 })).toEqual({ t: 'foul', s: 9, n: 2 });
    expect(parseHockeyMessage({ t: 'serve', s: 9, r: 5 })).toEqual({ t: 'serve', s: 9, r: 5 });
    for (const bad of [
      { ...st, x: 1.5 },
      { ...st, h: 0 },
      { ...st, s: -1 },
      { ...st, a: -2 },
      { ...st, p: [1, 2, 3] },
      { ...st, p: [1, 2, 3, 99999] },
      { ...st, extra: true },
      { t: 'st', s: 1 },
      { ...pass, age: 5000 },
      { t: 'goal', s: 9, n: 0 },
      { t: 'serve', s: 9 },
      { t: 'shot', n: 1 },
    ]) {
      expect(parseHockeyMessage(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('carry the puck to a tenth of a millimetre and a millimetre a second', () => {
    const puck = { x: 0.58512345, y: 1.17, vx: -2.71828, vy: 3.14159 };
    const back = decodePuck(encodePuck(puck));
    expect(Math.abs(back.x - puck.x)).toBeLessThanOrEqual(5e-5);
    expect(Math.abs(back.vy - puck.vy)).toBeLessThanOrEqual(5e-4);
  });

  it('give the puck to the player whose token it is, the next token keeping to its parity', () => {
    expect(holderOf(0)).toBe(0);
    expect(holderOf(7)).toBe(1);
    expect(nextToken(4, 1)).toBe(5);
    expect(nextToken(4, 0)).toBe(6);
    expect(nextToken(5, 1)).toBe(7);
  });

  it('let the loser serve first in a rematch', () => {
    expect(rematchTerms(terms('Ben'), 0).firstServe).toBe(1);
    expect(rematchTerms(terms('Ben', { firstServe: 1 }), 1).firstServe).toBe(0);
    expect(rematchTerms(terms('Ben', { firstServe: 1 }), null).firstServe).toBe(0);
  });

  it('take the host’s match only when it could be one of this match', () => {
    const setup = setupFor(terms('Ben'));
    const state = { ...newMatch(3, 0), score: [2, 1] as const, goals: 3, conceded: 1 as const };
    const puck = { x: TABLE.W / 2, y: 0.5, vx: 0, vy: 1 };
    const sync = syncMessage(state, 6, puck);
    expect(stateFromSync(sync, setup)).toEqual(state);
    for (const bad of [
      { ...sync, score: [4, 0] as const, n: 4 },
      { ...sync, n: 2 },
      { ...sync, p: null },
      { ...sync, phase: 'goal' as const },
      { ...sync, p: [-5000, 5000, 0, 0] as const },
      { ...sync, winner: 0 as const },
    ]) {
      expect(stateFromSync(bad, setup), JSON.stringify(bad)).toBeNull();
    }
  });
});

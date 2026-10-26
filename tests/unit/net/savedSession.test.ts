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
import { HOCKEY_CODEC, setupFor, syncMessage } from '../../../src/game/hockeyMessages.ts';
import { Match } from '../../../src/game/Match.ts';
import { createInvite } from '../../../src/net/protocol.ts';
import { parseSaved } from '../../../src/net/savedSession.ts';
import { terms } from '../../support/onlineSides.ts';

const SAMPLE_ID = 'abcdefghijklmnopqrstuv';

describe('parseSaved', () => {
  const match = new Match(setupFor(terms('Ben')));
  const good = {
    invite: createInvite(),
    role: 'guest',
    token: SAMPLE_ID,
    name: 'Ben',
    friendName: 'Ana',
    terms: terms('Ben'),
    state: syncMessage(match.current, 0, match.world.puck),
  };

  it('reads back a saved game, with the game’s own checks for its terms and match', () => {
    const parsed = parseSaved(JSON.parse(JSON.stringify(good)), HOCKEY_CODEC);
    expect(parsed).toEqual(JSON.parse(JSON.stringify(good)));
    expect(parseSaved({ ...good, terms: null, state: null }, HOCKEY_CODEC)).toMatchObject({
      terms: null,
      state: null,
    });
  });

  it('treats anything malformed as nothing', () => {
    for (const patch of [
      { role: 'admin' },
      { token: 'x' },
      { token: null },
      { name: 7 },
      { invite: { secret: 's' } },
      { terms: { ...terms('Ben'), target: 0 } },
      { terms: { ...terms('Ben'), reach: 'all' } },
      { terms: 'first to 3' },
      { state: { ...good.state, score: [1] } },
      { state: { ...good.state, p: [1, 2, 3] } },
      { state: { t: 'goal', s: 1, n: 1 } },
      { state: { t: 'st', s: 1, m: 0, a: 0, r: 0, h: false, x: 0, y: 0 } },
    ]) {
      expect(parseSaved({ ...good, ...patch }, HOCKEY_CODEC), JSON.stringify(patch)).toBeNull();
    }
    expect(parseSaved(null, HOCKEY_CODEC)).toBeNull();
    expect(parseSaved('saved', HOCKEY_CODEC)).toBeNull();
  });

  it('cleans the names it reads back', () => {
    const parsed = parseSaved({ ...good, name: ' Ben‮ ', friendName: '' }, HOCKEY_CODEC);
    expect(parsed).toMatchObject({ name: 'Ben', friendName: 'Friend' });
  });
});

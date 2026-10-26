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

// The rules of a match: a goal counts once and gives the serve to the player scored on, the
// target ends the match, a foul gives the puck away, and only possible states pass.

import { describe, expect, it } from 'vitest';
import {
  concede,
  isPossible,
  newMatch,
  possessionFoul,
  scoreGoal,
  serve,
  type MatchState,
} from '../../../src/rules/match.ts';

describe('the rules of a match', () => {
  it('counts a goal for the other player, once, and gives the puck to the player scored on', () => {
    const start = newMatch(7, 0);
    const after = scoreGoal(start, 0);
    expect(after).toMatchObject({ score: [0, 1], phase: 'goal', server: 0, goals: 1, conceded: 0 });
    // The same goal reported again, or any goal before the serve, changes nothing.
    expect(scoreGoal(after, 0)).toBe(after);
    expect(scoreGoal(after, 1)).toBe(after);
    const played = serve(after);
    expect(played.phase).toBe('play');
    expect(serve(played)).toBe(played);
    expect(scoreGoal(played, 1)).toMatchObject({ score: [1, 1], server: 1, goals: 2 });
  });

  it('ends the match when a player reaches the target, and nothing scores after it', () => {
    let state: MatchState = newMatch(3, 1);
    for (let i = 0; i < 3; i++) state = serve(scoreGoal(state, 0));
    expect(state).toMatchObject({ score: [0, 3], phase: 'over', winner: 1 });
    expect(scoreGoal(state, 1)).toBe(state);
    expect(serve(state)).toBe(state);
    expect(isPossible(state)).toBe(true);
  });

  it('gives the puck to the other player after a foul, without a goal', () => {
    const state = possessionFoul(newMatch(5, 0), 0);
    expect(state).toMatchObject({ phase: 'foul', server: 1, fouls: 1, goals: 0, score: [0, 0] });
    expect(possessionFoul(state, 0)).toBe(state);
    expect(serve(state).phase).toBe('play');
  });

  it('lets a player give up the match', () => {
    const state = concede(scoreGoal(newMatch(7, 0), 1), 1);
    expect(state).toMatchObject({ phase: 'over', winner: 0, score: [1, 0] });
    expect(isPossible(state)).toBe(true);
    expect(concede(state, 0)).toBe(state);
  });

  it('tells possible states from impossible ones', () => {
    const real = serve(scoreGoal(newMatch(7, 0), 1));
    expect(isPossible(real)).toBe(true);
    expect(isPossible({ ...real, score: [9, 0] })).toBe(false);
    expect(isPossible({ ...real, goals: 3 })).toBe(false);
    expect(isPossible({ ...real, winner: 0 })).toBe(false);
    expect(isPossible({ ...real, target: 99 })).toBe(false);
    expect(isPossible({ ...real, score: [7, 0], goals: 7 })).toBe(false);
    expect(isPossible({ ...real, conceded: null })).toBe(false);
    expect(isPossible({ ...real, phase: 'over', winner: null })).toBe(false);
  });
});

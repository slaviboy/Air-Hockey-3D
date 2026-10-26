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

// The rules of a match (docs/rules.md): the first to the target wins; a goal counts once, and the
// player scored on serves next; a player who keeps the puck in their half too long gives it to the
// other. Each change is a new state, made only from the phase it belongs to, so a second report of
// the same goal changes nothing.

import { other, type Seat } from './types.ts';

/** The goals a match can be played to. */
export const TARGETS = [3, 5, 7, 10] as const;
export const DEFAULT_TARGET = 7;
export const MAX_TARGET = 15;

/** Seconds the match waits after a goal before the next serve. */
export const GOAL_PAUSE = 1.6;
/** Seconds it waits after a foul. */
export const FOUL_PAUSE = 1.2;
/** Seconds a player may keep the puck in their own half. */
export const POSSESSION_LIMIT = 7;

/**
 * `play` while the puck is live; `goal` and `foul` for the pause after one, until the serve;
 * `over` once someone has won.
 */
export type Phase = 'play' | 'goal' | 'foul' | 'over';

export interface MatchState {
  readonly target: number;
  readonly score: readonly [number, number];
  readonly phase: Phase;
  /** Who is given the puck at the next serve (or was, at the last one). */
  readonly server: Seat;
  readonly winner: Seat | null;
  /** Goals scored in the match: each goal's number, the same for both players online. */
  readonly goals: number;
  /** Fouls called in the match. */
  readonly fouls: number;
  /** Whose goal the last goal went into, null before the first. */
  readonly conceded: Seat | null;
}

export function isTarget(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TARGET;
}

export function newMatch(target: number, firstServe: Seat): MatchState {
  return {
    target,
    score: [0, 0],
    phase: 'play',
    server: firstServe,
    winner: null,
    goals: 0,
    fouls: 0,
    conceded: null,
  };
}

/**
 * The puck went into `into`'s goal: the other player scores, and the player scored on serves.
 * Only a puck in play scores; anything else leaves the state as it is.
 */
export function scoreGoal(state: MatchState, into: Seat): MatchState {
  if (state.phase !== 'play') return state;
  const scorer = other(into);
  const score: [number, number] = [state.score[0], state.score[1]];
  score[scorer] += 1;
  const won = score[scorer] >= state.target;
  return {
    ...state,
    score,
    phase: won ? 'over' : 'goal',
    server: into,
    winner: won ? scorer : null,
    goals: state.goals + 1,
    conceded: into,
  };
}

/** `holder` kept the puck in their half past the limit: the other player is given it. */
export function possessionFoul(state: MatchState, holder: Seat): MatchState {
  if (state.phase !== 'play') return state;
  return { ...state, phase: 'foul', server: other(holder), fouls: state.fouls + 1 };
}

/** The pause after a goal or a foul is over: the server is given the puck and play goes on. */
export function serve(state: MatchState): MatchState {
  if (state.phase !== 'goal' && state.phase !== 'foul') return state;
  return { ...state, phase: 'play' };
}

/** A player gives up the match: the other wins it as it stands. */
export function concede(state: MatchState, loser: Seat): MatchState {
  if (state.phase === 'over') return state;
  return { ...state, phase: 'over', winner: other(loser) };
}

/** Whether a state could be one of a match to `target` (for a state taken from elsewhere). */
export function isPossible(state: MatchState): boolean {
  const [a, b] = state.score;
  const count = (n: number) => Number.isInteger(n) && n >= 0 && n <= state.target;
  if (!isTarget(state.target) || !count(a) || !count(b)) return false;
  if (state.goals !== a + b || !Number.isInteger(state.fouls) || state.fouls < 0) return false;
  const reached = a >= state.target || b >= state.target;
  if (a >= state.target && b >= state.target) return false;
  if (state.phase === 'over') {
    // Won on goals, or given up before the target.
    return state.winner !== null && (!reached || state.score[state.winner] === state.target);
  }
  if (reached || state.winner !== null) return false;
  if (state.goals === 0 && state.conceded !== null) return false;
  if (state.goals > 0 && state.conceded === null) return false;
  return true;
}

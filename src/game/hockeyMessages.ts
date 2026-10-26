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

// What an online match of air hockey says on top of the session's envelope (src/net/protocol.ts,
// docs/protocol.md): the host's terms, each side's state thirty times a second (its mallet, and the
// puck while the puck is its to play), the puck passed over the centre line, the goals, fouls and
// serves each side calls, and the host's match when the two have to be brought back in step.
// Positions travel in tenths of a millimetre and speeds in millimetres a second, as integers.
//
// parseHockeyMessage and parseTerms accept the exact shapes below and nothing else: anything else
// is noise, dropped and counted by the guard. Whether a well-formed message is possible (a mallet
// in its half, a puck no faster than it can go, the puck passed by the player who had it) is the
// port's check, against this device's own match; failing one is a rule break.

import type { GuardLimits } from '../net/PeerGuard.ts';
import {
  MAX_COUNT,
  MAX_MESSAGE_BYTES,
  cleanName,
  hasKeys,
  isInt,
  isObject,
  type GameCodec,
  type Raw,
  type SessionMessage,
} from '../net/protocol.ts';
import type { Body } from '../physics/puck.ts';
import { isPossible, isTarget, type MatchState, type Phase } from '../rules/match.ts';
import { other, type Seat } from '../rules/types.ts';
import { isReach, type Reach } from '../table/geometry.ts';
import { TABLE } from '../table/spec.ts';
import type { MatchSetup } from './Match.ts';

/** Metres in one unit of a position as it travels. */
export const POSITION_UNIT = 1e-4;
/** Metres a second in one unit of a speed. */
export const SPEED_UNIT = 1e-3;
/** No position travels further than this from the table's corner, in its units (5 m). */
const MAX_POSITION = 50_000;
/** Nor any speed faster (20 m/s): what lies between is the port's to judge. */
const MAX_SPEED = 20_000;
/** A sender's clock in milliseconds: a page open for weeks stays under it. */
const MAX_STAMP = 0x7fffffff;
/** How long before it was sent a pass can say the puck crossed, in milliseconds. */
export const MAX_AGE = 1000;

/** What the host chooses for an online match, as for a match on one device. */
export interface HockeyTerms {
  readonly target: number;
  /** How far up the table both players' mallets may go. */
  readonly reach: Reach;
  /** The two seats' names, the host's and the guest's. */
  readonly names: readonly [string, string];
  /** The host's seat; the guest has the other one. */
  readonly host: Seat;
  readonly firstServe: Seat;
}

/** The puck as it travels: position and velocity, in their units. */
export type PuckCode = readonly [x: number, y: number, vx: number, vy: number];

/** The host's match, to bring the guest's back in step: the score, the phase, and the puck. */
export interface SyncMessage {
  readonly t: 'sync';
  /** Goals scored in the match. */
  readonly n: number;
  readonly score: readonly [number, number];
  readonly fouls: number;
  readonly phase: Phase;
  readonly server: Seat;
  readonly winner: Seat | null;
  readonly conceded: Seat | null;
  /** The puck's token: whose it is to play (r % 2) and how often it has changed hands. */
  readonly r: number;
  /** The puck, while it is in play. */
  readonly p: PuckCode | null;
}

export type HockeyMessage =
  /**
   * The sender's state, thirty times a second: its clock (`s`, milliseconds), its match's own
   * clock (`m`, milliseconds of play, which a slow page runs slower), the last clock of the other
   * side's it heard (`a`, -1 for none), the puck's token as it has it, whether its page is
   * hidden, its mallet, and the puck while the puck is its to play.
   */
  | {
      readonly t: 'st';
      readonly s: number;
      readonly m: number;
      readonly a: number;
      readonly r: number;
      readonly h: boolean;
      readonly x: number;
      readonly y: number;
      readonly p?: PuckCode;
    }
  /** The puck crossed the centre line `age` ms before `s`: it is the other side's now, token r. */
  | {
      readonly t: 'pass';
      readonly s: number;
      readonly age: number;
      readonly r: number;
      readonly p: PuckCode;
    }
  /** The sender called a goal into its own goal, the match's goal number n. */
  | { readonly t: 'goal'; readonly s: number; readonly n: number }
  /** The sender called a foul on itself (the puck kept too long), the match's foul number n. */
  | { readonly t: 'foul'; readonly s: number; readonly n: number }
  /** The sender served: the puck is on its spot, its to play, token r. */
  | { readonly t: 'serve'; readonly s: number; readonly r: number }
  | SyncMessage;

export type StateMessage = Extract<HockeyMessage, { t: 'st' }>;
export type PassMessage = Extract<HockeyMessage, { t: 'pass' }>;
export type HockeyWire = SessionMessage<HockeyTerms> | HockeyMessage;

const PHASES: readonly Phase[] = ['play', 'goal', 'foul', 'over'];

const isSeat = (value: unknown): value is Seat => value === 0 || value === 1;
const isStamp = (value: unknown): value is number => isInt(value, 0, MAX_STAMP);
const isPosition = (value: unknown): value is number => isInt(value, -MAX_POSITION, MAX_POSITION);
const isToken = (value: unknown): value is number => isInt(value, 0, MAX_COUNT);
const pair = <T>(value: unknown, item: (v: unknown) => v is T): value is [T, T] =>
  Array.isArray(value) && value.length === 2 && item(value[0]) && item(value[1]);

function puckCode(value: unknown): PuckCode | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [x, y, vx, vy] = value as unknown[];
  if (!isPosition(x) || !isPosition(y)) return null;
  if (!isInt(vx, -MAX_SPEED, MAX_SPEED) || !isInt(vy, -MAX_SPEED, MAX_SPEED)) return null;
  return [x, y, vx, vy];
}

/** The host's terms, if the data is exactly them; null otherwise. */
export function parseTerms(data: Raw): HockeyTerms | null {
  if (!hasKeys(data, ['target', 'reach', 'names', 'host', 'firstServe'])) return null;
  const { target, reach, names, host, firstServe } = data;
  if (!isTarget(target) || !isReach(reach) || !isSeat(host) || !isSeat(firstServe)) return null;
  const isName = (v: unknown): v is string => typeof v === 'string' && v.length <= 96;
  if (!pair(names, isName)) return null;
  return {
    target,
    reach,
    names: [cleanName(names[0], 'Player 1'), cleanName(names[1], 'Player 2')],
    host,
    firstServe,
  };
}

/** One of the game's messages, if the data is exactly one; null for anything else. */
export function parseHockeyMessage(data: Raw): HockeyMessage | null {
  switch (data.t) {
    case 'st': {
      if (!hasKeys(data, ['t', 's', 'm', 'a', 'r', 'h', 'x', 'y'], ['p'])) return null;
      const { s, m, a, r, h, x, y } = data;
      if (!isStamp(s) || !isStamp(m) || !isInt(a, -1, MAX_STAMP) || !isToken(r)) return null;
      if (typeof h !== 'boolean') return null;
      if (!isPosition(x) || !isPosition(y)) return null;
      if (!Object.hasOwn(data, 'p')) return { t: 'st', s, m, a, r, h, x, y };
      const p = puckCode(data.p);
      return p ? { t: 'st', s, m, a, r, h, x, y, p } : null;
    }
    case 'pass': {
      if (!hasKeys(data, ['t', 's', 'age', 'r', 'p'])) return null;
      const p = puckCode(data.p);
      if (!isStamp(data.s) || !isInt(data.age, 0, MAX_AGE) || !isToken(data.r) || !p) return null;
      return { t: 'pass', s: data.s, age: data.age, r: data.r, p };
    }
    case 'goal':
    case 'foul':
      if (!hasKeys(data, ['t', 's', 'n']) || !isStamp(data.s)) return null;
      if (!isInt(data.n, 1, MAX_COUNT)) return null;
      return { t: data.t, s: data.s, n: data.n };
    case 'serve':
      if (!hasKeys(data, ['t', 's', 'r']) || !isStamp(data.s) || !isToken(data.r)) return null;
      return { t: 'serve', s: data.s, r: data.r };
    case 'sync':
      return parseSync(data);
    default:
      return null;
  }
}

const SYNC_KEYS = ['t', 'n', 'score', 'fouls', 'phase', 'server', 'winner', 'conceded', 'r', 'p'];

function parseSync(data: Raw): SyncMessage | null {
  if (!hasKeys(data, SYNC_KEYS)) return null;
  const d = data;
  const count = (v: unknown): v is number => isInt(v, 0, MAX_COUNT);
  if (!count(d.n) || !pair(d.score, count) || !count(d.fouls) || !isToken(d.r)) return null;
  if (!PHASES.includes(d.phase as Phase) || !isSeat(d.server)) return null;
  if (d.winner !== null && !isSeat(d.winner)) return null;
  if (d.conceded !== null && !isSeat(d.conceded)) return null;
  const p = d.p === null ? null : puckCode(d.p);
  if (d.p !== null && !p) return null;
  return {
    t: 'sync',
    n: d.n,
    score: [d.score[0], d.score[1]],
    fouls: d.fouls,
    phase: d.phase as Phase,
    server: d.server,
    winner: d.winner,
    conceded: d.conceded,
    r: d.r,
    p,
  };
}

/** How the session reads air hockey's messages and terms. */
export const HOCKEY_CODEC: GameCodec<HockeyMessage, HockeyTerms> = {
  parse: parseHockeyMessage,
  parseTerms,
};

/** Whether the data is a sync message, exactly (a saved game is checked like a received one). */
export function parseSyncMessage(data: unknown): SyncMessage | null {
  return isObject(data) && data.t === 'sync' ? parseSync(data) : null;
}

// --- between messages and the match ----------------------------------------------------------

export const encodePosition = (metres: number): number => Math.round(metres / POSITION_UNIT);
export const decodePosition = (units: number): number => units * POSITION_UNIT;

export function encodePuck(puck: Body): PuckCode {
  return [
    encodePosition(puck.x),
    encodePosition(puck.y),
    Math.round(puck.vx / SPEED_UNIT),
    Math.round(puck.vy / SPEED_UNIT),
  ];
}

export function decodePuck([x, y, vx, vy]: PuckCode): Body {
  return { x: x * POSITION_UNIT, y: y * POSITION_UNIT, vx: vx * SPEED_UNIT, vy: vy * SPEED_UNIT };
}

/** The holder of the puck's token r. */
export const holderOf = (r: number): Seat => (r % 2) as Seat;

/** The token after r that is `seat`'s: the next with its parity. */
export function nextToken(r: number, seat: Seat): number {
  return holderOf(r + 1) === seat ? r + 1 : r + 2;
}

/** The match's terms on this device. */
export function setupFor(terms: HockeyTerms): MatchSetup {
  return {
    mode: 'online',
    target: terms.target,
    names: terms.names,
    firstServe: terms.firstServe,
    reach: terms.reach,
  };
}

/**
 * A rematch: the same terms, and the loser of the match serves first (the other player than
 * before, if it ended without a winner). Both sides work it out from the same match.
 */
export function rematchTerms(terms: HockeyTerms, winner: Seat | null): HockeyTerms {
  return { ...terms, firstServe: winner === null ? other(terms.firstServe) : other(winner) };
}

/** The match as a sync message, with the puck while it is in play. */
export function syncMessage(state: MatchState, r: number, puck: Body | null): SyncMessage {
  return {
    t: 'sync',
    n: state.goals,
    score: [state.score[0], state.score[1]],
    fouls: state.fouls,
    phase: state.phase,
    server: state.server,
    winner: state.winner,
    conceded: state.conceded,
    r,
    p: state.phase === 'play' && puck ? encodePuck(puck) : null,
  };
}

/**
 * The match state a sync message describes, for this match's terms; null when it could not be a
 * state of this match (a score beyond the target, goals that do not add up, a puck off the table).
 */
export function stateFromSync(sync: SyncMessage, setup: MatchSetup): MatchState | null {
  const state: MatchState = {
    target: setup.target,
    score: [sync.score[0], sync.score[1]],
    phase: sync.phase,
    server: sync.server,
    winner: sync.winner,
    goals: sync.n,
    fouls: sync.fouls,
    conceded: sync.conceded,
  };
  if (!isPossible(state)) return null;
  if ((sync.p !== null) !== (sync.phase === 'play')) return null;
  if (sync.p) {
    // On the table, or in a goal's slot.
    const { x, y } = decodePuck(sync.p);
    const reach = TABLE.slotDepth + TABLE.puck.radius * 2;
    if (x < 0 || x > TABLE.W || y < -reach || y > TABLE.L + reach) return null;
  }
  return state;
}

/**
 * What the other side may send: each side's state thirty times a second, and the passes, goals and
 * serves between, with room for a burst after a reconnection (the session's default suits a game
 * of turns).
 */
export const HOCKEY_LIMITS: GuardLimits = {
  maxBytes: MAX_MESSAGE_BYTES,
  perSecond: 60,
  burst: 240,
  maxDrops: 20,
};

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

// Air hockey's side of an online session (the session is src/net/OnlineSession.ts; this is its
// GamePort; docs/protocol.md has the whole of it). The puck belongs to the half it is in: the
// device of the player whose half it is in plays it, with that player's own mallet at once, and
// tells the other device where it is thirty times a second. When it crosses the centre line it is
// passed over, with its state at the crossing; the device it comes to plays it on from there,
// over again from that moment with its own mallet as it moved meanwhile, so a hit made while the
// pass was on its way still counts. Neither mallet can reach the other half (the band at the
// centre line keeps them apart), so only one device ever plays the puck against a mallet.
//
// Each device calls the goals into its own goal and the fouls on its own player, and serves for
// them; the other device is told. Each checks everything the other sends against its own match:
// the clock it is stamped with, the mallet in its half and no faster than a hand, the puck on the
// sender's half, no faster than it can go and never through a wall, passed and served only by
// the player whose turn it is. Play stands still while either page is hidden, while nothing has
// been heard for a moment, and while the session holds it; it goes on from where it stood.

import {
  browserTimers,
  type ForfeitReason,
  type GameListener,
  type GamePort,
  type GameStatus,
  type Receipt,
  type Restored,
  type RestoreReason,
  type Role,
  type Timers,
} from '../net/OnlineSession.ts';
import { DAMPING, MAX_MALLET_SPEED, MAX_PUCK_SPEED, STEP } from '../physics/params.ts';
import { pushInside, type Body } from '../physics/puck.ts';
import { POSSESSION_LIMIT, type MatchState } from '../rules/match.ts';
import { other, type Seat } from '../rules/types.ts';
import { boundary, centreLine, halfOf, malletArea, type Point } from '../table/geometry.ts';
import {
  decodePosition,
  decodePuck,
  encodePosition,
  encodePuck,
  holderOf,
  MAX_AGE,
  nextToken,
  rematchTerms,
  setupFor,
  stateFromSync,
  syncMessage,
  type HockeyMessage,
  type HockeyTerms,
  type PassMessage,
  type StateMessage,
} from './hockeyMessages.ts';
import type { Driver, Match, MatchEvent, MatchSetup, Referee } from './Match.ts';

/** What the port needs of the game on this device. */
export interface PortTable {
  readonly match: Match;
  /** Starts a match; `localSeats` are the seats this device plays. */
  newMatch(setup: MatchSetup, localSeats: readonly Seat[]): Promise<void> | void;
  /** A note for the player. */
  say(text: string): void;
  /** The match was replaced by the host's (after a reconnection). */
  restored?(): void;
}

export interface PortOptions {
  readonly timers?: Timers;
  /** Milliseconds, for the clocks the messages carry; performance.now() by default. */
  readonly now?: () => number;
}

/** Each side's state goes out this often while playing (thirty times a second), in ms. */
export const SEND_MS = 33;
/** And this often while play is held, or while the other side does not hear this one. */
export const HEARTBEAT_MS = 250;
/** Nothing heard for this long, and the other side is taken not to hear this one either. */
export const SLOW_AFTER_MS = 1000;
/** Nothing heard for this long holds play. */
export const SILENCE_MS = 1500;
/** The other player's page may stay hidden this long before they lose the match. */
export const HIDDEN_LIMIT_MS = 120_000;
/** The other player's serve is due this long into the pause before it (and the allowances). */
export const SERVE_DUE_MS = 3000;
/** Slack on the other player's clocks, beyond the network's allowance. */
export const GRACE_MS = 2000;
/**
 * The other player's clocks run on their match's own time, which a slow page plays slower than
 * real time. A serve may take this many times longer in real time, no more, so a page whose match
 * clock stood still could not hold the match up for ever. (Keeping the puck has no such bound:
 * a page that stood its clock still to keep the puck would only keep it in its own half.)
 */
export const SLOWEST = 10;
/** A pass or a serve the other side has not taken after this (and the allowance) goes again. */
export const RESEND_MS = 500;
/** The two sides' tokens may differ for this long (and the allowance) before they are resynced. */
export const MISMATCH_MS = 1000;
/** The other side's clock may run ahead of where it settled by this much, no more. */
export const AHEAD_MS = 3000;
/** Where the other side's clock stands is measured over this long before it is held to it. */
export const SETTLE_MS = 5000;
/** The furthest back a report of the puck is played again from. */
export const MAX_REWIND_MS = 300;
/** The other mallet is drawn this far behind its newest report, so its motion is smooth. */
const BEHIND_MS = 60;
/** This device's mallet, step by step, kept to play the puck again with: half a second. */
const PATH_STEPS = 120;
/** Strikes (a puck's course changed with nothing there to change it, a puck inside a mallet). */
const STRIKES = 3;
const STRIKE_WINDOW_MS = 20_000;
/** The other mallet follows its reports at once, as fast as any mallet may go. */
const FOLLOW = { maxSpeed: MAX_MALLET_SPEED, accel: 1e5 } as const;

/** How far a report may stray past what it describes: rounding, and a step's travel. */
const AREA_SLACK = 0.002;
const WALL_SLACK = 0.002;
/**
 * A frame plays at most this much of a match at once (the match's 24 steps), from the time owed
 * since the last frame: so between two reports, a slow page's match can run on this much longer
 * than their stamps say. Every bound on how far something moved between reports allows for it.
 */
const FRAME_SLACK = 0.1;
const MALLET_MOVE = (seconds: number) => 1.2 * MAX_MALLET_SPEED * (seconds + FRAME_SLACK) + 0.004;
const PUCK_MOVE = (seconds: number) => 1.1 * MAX_PUCK_SPEED * (seconds + FRAME_SLACK) + 0.015;
const PUCK_SPEED = 1.1 * MAX_PUCK_SPEED + 0.05;
/** A change of the puck's velocity bigger than this needs a wall or the sender's mallet. */
const TURN = 0.3;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export class HockeyPort implements GamePort<HockeyMessage, HockeyTerms>, Referee {
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly listeners = new Set<GameListener<HockeyMessage>>();
  private readonly ticker: unknown;
  private readonly follower: Driver = { target: () => this.followed() };
  private started = false;
  private mySeat: Seat = 0;
  /** The puck's token: it is holderOf(r)'s to play; it goes up each time it changes hands. */
  private r = 0;
  private allowance = 0;

  // What holds play.
  private sessionHeld = false;
  private hidden = false;
  private peerHidden = false;
  private peerHiddenSince = 0;
  private held = true;
  private lastHeard = 0;

  // The other side's clock and what it last said.
  private lastStamp: number | null = null;
  /** When the first stamp since the clock was last measured afresh arrived (this clock). */
  private leadSince: number | null = null;
  /**
   * The most a stamp has been ahead of this clock on arrival (stamp − receive time): the other
   * clock's offset from this one, less the least delay. Where it stood once settled.
   */
  private bestLead = -Infinity;
  private settledLead: number | null = null;
  private peerAck = -1;
  private peerAckAt = 0;
  private lastSent = -Infinity;
  private mismatchSince: number | null = null;
  private lastMallet: { s: number; at: Point } | null = null;
  private lastPuck: { s: number; puck: Body } | null = null;
  private strikes: number[] = [];
  /** The other mallet's reports, on the other side's clock, to draw it from. */
  private reports: { s: number; at: Point }[] = [];
  private restingAt: Point | null = null;

  /** This device's mallet after each step, to play the puck again with. */
  private path: Point[] = [];
  /** The last pass or serve sent, to send again if the other side never took it. */
  private lastEvent: { message: HockeyMessage; r: number; at: number; s: number } | null = null;

  // The other player's clocks: since when (on their match's clock, and on this side's play time).
  private playClock = 0;
  private lastTick = 0;
  /** The other side's match clock as its last report gave it, milliseconds of play. */
  private peerTime = 0;
  private serveDueSince: { theirs: number; mine: number } | null = null;
  private heldBySince: { theirs: number; mine: number } | null = null;

  constructor(
    private readonly table: PortTable,
    options: PortOptions = {},
  ) {
    this.timers = options.timers ?? browserTimers;
    this.now = options.now ?? (() => performance.now());
    this.ticker = this.timers.setInterval(() => this.tick(), SEND_MS);
  }

  /** The seat this device plays. */
  get seat(): Seat {
    return this.mySeat;
  }

  /** Whose the puck is to play: the player whose half it is in. */
  get holder(): Seat {
    return holderOf(this.r);
  }

  /** The puck's token, for the tests. */
  get token(): number {
    return this.r;
  }

  /** Why play stands still, if it does, for the interface. */
  holdReason(): { kind: 'peerHidden'; secondsLeft: number } | { kind: 'silent' } | null {
    if (!this.started || this.sessionHeld) return null;
    if (this.peerHidden) {
      const left = (HIDDEN_LIMIT_MS - (this.now() - this.peerHiddenSince)) / 1000;
      return { kind: 'peerHidden', secondsLeft: Math.max(0, Math.ceil(left)) };
    }
    if (this.held && !this.hidden) return { kind: 'silent' };
    return null;
  }

  /** This page is hidden (another tab, the phone locked), or shown again. */
  setHidden(on: boolean): void {
    if (this.hidden === on) return;
    this.hidden = on;
    this.updateHold();
    // At once, so the other side stands still too.
    if (this.online()) this.sendState();
  }

  /** Stops listening and sending (the session is over). */
  dispose(): void {
    this.timers.clearInterval(this.ticker);
    this.listeners.clear();
    const match = this.table.match;
    if (this.started && match.referee === this) {
      match.referee = null;
      match.drivers[other(this.mySeat)] = null;
    }
    this.started = false;
  }

  // --- GamePort ------------------------------------------------------------------------------

  async start(terms: HockeyTerms, role: Role): Promise<void> {
    this.mySeat = role === 'host' ? terms.host : other(terms.host);
    this.r = terms.firstServe;
    this.started = true;
    this.sessionHeld = false;
    this.peerHidden = false;
    this.lastEvent = null;
    this.strikes = [];
    this.reports = [];
    this.restingAt = null;
    this.path = [];
    this.resetBaselines(true);
    await this.table.newMatch(setupFor(terms), [this.mySeat]);
    this.attach();
    const now = this.now();
    this.lastHeard = now;
    this.lastTick = now;
    this.held = true;
    this.updateHold();
    this.sendState();
  }

  rematchTerms(terms: HockeyTerms): HockeyTerms {
    return rematchTerms(terms, this.table.match.current.winner);
  }

  onLocal(listener: GameListener<HockeyMessage>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async receive(message: HockeyMessage): Promise<Receipt> {
    if (!this.online()) return { kind: 'shown' };
    if (message.t === 'sync') return { kind: 'shown' };
    const late = this.checkStamp(message.s);
    if (late) return violation(late);
    this.lastHeard = this.now();
    switch (message.t) {
      case 'st':
        return this.onState(message);
      case 'pass':
        return this.onPass(message);
      case 'goal':
        return this.onGoal(message.n);
      case 'foul':
        return this.onFoul(message.n);
      case 'serve':
        return this.onServe(message.s, message.r);
    }
  }

  snapshot(): HockeyMessage | null {
    if (!this.started) return null;
    const match = this.table.match;
    return syncMessage(match.current, this.r, match.world.puck);
  }

  async restore(message: HockeyMessage, why: RestoreReason): Promise<Restored> {
    if (message.t !== 'sync' || !this.online()) return 'rejected';
    const match = this.table.match;
    const state = stateFromSync(message, match.setup);
    if (!state) return 'rejected';
    if (why === 'saved') {
      // This device was reloaded: the rally it was in is gone, and the other player serves.
      const server = other(this.mySeat);
      this.take(
        state.phase === 'over' ? state : { ...state, phase: 'foul', server },
        null,
        message.r,
      );
      return 'restored';
    }
    if (sameMatch(match.current, state) && message.r === this.r) return 'same';
    this.take(state, message.p ? decodePuck(message.p) : null, message.r);
    return 'restored';
  }

  status(): GameStatus {
    if (!this.online()) return 'none';
    return this.table.match.current.winner === null ? 'playing' : 'over';
  }

  async resign(): Promise<void> {
    if (this.status() === 'playing') this.table.match.concede(this.mySeat);
  }

  async forfeit(_reason: ForfeitReason): Promise<void> {
    if (this.status() === 'playing') this.table.match.concede(other(this.mySeat));
  }

  setLagAllowance(ms: number): void {
    this.allowance = Math.max(0, ms);
  }

  hold(on: boolean): void {
    if (!this.started) return;
    this.sessionHeld = on;
    if (on) {
      // Whoever comes back may be a page reloaded since, on a fresh clock.
      this.peerHidden = false;
      this.resetBaselines(true);
    } else {
      this.lastHeard = this.now();
    }
    this.updateHold();
  }

  // --- Referee: the calls this device makes ---------------------------------------------------

  calls(seat: Seat): boolean {
    return seat === this.mySeat && this.holder === this.mySeat;
  }

  serves(seat: Seat): boolean {
    return seat === this.mySeat;
  }

  heard(event: MatchEvent): void {
    if (!this.online()) return;
    const state = this.table.match.current;
    if (event.kind === 'scored' && other(event.scorer) === this.mySeat) {
      this.send({ t: 'goal', s: this.stamp(), n: state.goals }, true);
    } else if (event.kind === 'foul' && event.holder === this.mySeat) {
      this.send({ t: 'foul', s: this.stamp(), n: state.fouls }, true);
    } else if (event.kind === 'served' && event.seat === this.mySeat) {
      this.r = nextToken(this.r, this.mySeat);
      const s = this.stamp();
      const message: HockeyMessage = { t: 'serve', s, r: this.r };
      this.lastEvent = { message, r: this.r, at: this.now(), s };
      this.send(message, true);
    }
  }

  stepped(): void {
    if (!this.online()) return;
    const m = this.table.match.world.mallets[this.mySeat];
    this.path.push({ x: m.x, y: m.y });
    if (this.path.length > PATH_STEPS + 1) this.path.shift();
    this.passIfCrossed(0);
  }

  // --- the other player's play -----------------------------------------------------------------

  private onState(message: StateMessage): Receipt {
    const now = this.now();
    const match = this.table.match;
    const remote = other(this.mySeat);
    this.peerTime = message.m;
    if (message.a !== this.peerAck) {
      this.peerAck = message.a;
      this.peerAckAt = now;
    }
    if (message.h !== this.peerHidden) {
      this.peerHidden = message.h;
      if (message.h) this.peerHiddenSince = now;
    }
    this.updateHold();

    // Their mallet: in their half, no faster than a hand.
    const at = { x: decodePosition(message.x), y: decodePosition(message.y) };
    const half = malletArea(match.spec, remote);
    if (
      at.x < half.x0 - AREA_SLACK ||
      at.x > half.x1 + AREA_SLACK ||
      at.y < half.y0 - AREA_SLACK ||
      at.y > half.y1 + AREA_SLACK
    ) {
      return violation('moved its mallet out of its half');
    }
    const last = this.lastMallet;
    if (last && dist(at, last.at) > MALLET_MOVE((message.s - last.s) / 1000)) {
      return violation('moved its mallet faster than a hand can');
    }
    this.lastMallet = { s: message.s, at };
    this.reports.push({ s: message.s, at });
    while (this.reports.length > 2 && this.reports[0]!.s < message.s - 1000) this.reports.shift();
    this.restingAt = at;

    // The puck's token: the two sides agree on it once each has heard the other's last word.
    const theirs = this.holder === remote;
    const missing =
      message.r !== this.r ||
      (theirs && !message.p && match.current.phase === 'play' && !this.held);
    if (!missing) this.mismatchSince = null;
    else if (!this.held) {
      this.mismatchSince ??= now;
      if (now - this.mismatchSince > this.allowance + MISMATCH_MS) {
        this.mismatchSince = null;
        return { kind: 'desync', n: match.current.goals };
      }
    }
    if (!message.p) return { kind: 'shown' };
    // Only the player whose puck it is says where it is.
    if (message.r > this.r) return violation('took the puck when it was not theirs');
    if (message.r < this.r) return { kind: 'shown' };
    if (!theirs) return violation('moved the puck while it was not theirs');
    if (match.current.phase !== 'play') return { kind: 'shown' };
    const puck = decodePuck(message.p);
    const wrong = this.checkPuck(puck, message.s, remote) ?? this.strike(puck, message.s, at);
    if (wrong) return violation(wrong);
    this.lastPuck = { s: message.s, puck };
    if (this.held) match.takePuck(puck);
    else this.playFrom(puck, this.rewind(message.s, 0));
    return { kind: 'shown' };
  }

  private onPass(message: PassMessage): Receipt {
    const match = this.table.match;
    const remote = other(this.mySeat);
    // Sent again, and taken already.
    if (message.r <= this.r) return { kind: 'shown' };
    if (this.holder !== remote || message.r !== this.r + 1) {
      return violation('passed the puck when it was not theirs');
    }
    if (match.current.phase !== 'play') return { kind: 'desync', n: match.current.goals };
    const puck = decodePuck(message.p);
    const wrong = this.checkPuck(puck, message.s - message.age, null);
    if (wrong) return violation(wrong);
    // Over the line, into this half.
    const line = centreLine(match.spec);
    if (this.mySeat === 0 ? puck.y > line + 2e-4 : puck.y < line - 2e-4) {
      return violation('passed the puck before it crossed the centre line');
    }
    this.r = message.r;
    this.lastPuck = null;
    this.mismatchSince = null;
    // Held, the puck waits where it crossed and is played from there once play goes on.
    if (this.held) match.takePuck(puck);
    else this.playFrom(puck, this.rewind(message.s, message.age));
    return { kind: 'played' };
  }

  private onGoal(n: number): Receipt {
    const match = this.table.match;
    const state = match.current;
    // A goal against the sender: never to its gain, so a mismatch is the two tables differing.
    if (state.phase !== 'play' || this.holder === this.mySeat || n !== state.goals + 1) {
      return { kind: 'desync', n };
    }
    match.takeGoal(other(this.mySeat));
    this.lastPuck = null;
    return { kind: 'played' };
  }

  private onFoul(n: number): Receipt {
    const match = this.table.match;
    const state = match.current;
    if (state.phase !== 'play' || this.holder === this.mySeat || n !== state.fouls + 1) {
      return { kind: 'desync', n: state.goals };
    }
    match.takeFoul(other(this.mySeat));
    this.lastPuck = null;
    return { kind: 'played' };
  }

  private onServe(s: number, r: number): Receipt {
    const match = this.table.match;
    const remote = other(this.mySeat);
    if (r <= this.r) return { kind: 'shown' };
    if (!match.waiting || match.current.server !== remote) {
      return violation('served when it was not theirs to serve');
    }
    if (r !== nextToken(this.r, remote)) return violation('served out of turn');
    this.r = r;
    this.mismatchSince = null;
    match.takeServe();
    const p = match.world.puck;
    this.lastPuck = { s, puck: { x: p.x, y: p.y, vx: 0, vy: 0 } };
    return { kind: 'played' };
  }

  /** What is wrong with a puck the other side sent, or null: on the table, possible, theirs. */
  private checkPuck(puck: Body, s: number, half: Seat | null): string | null {
    const match = this.table.match;
    const spec = match.spec;
    if (Math.hypot(puck.vx, puck.vy) > PUCK_SPEED) return 'sent the puck faster than it can go';
    const inside = pushInside(match.world.walls, puck.x, puck.y);
    if (dist(inside, puck) > WALL_SLACK) return 'sent the puck through a wall';
    const r = spec.puck.radius;
    if (puck.y < -r || puck.y > spec.L + r) return 'sent the puck past a goal line without a goal';
    if (half !== null) {
      const line = centreLine(spec);
      const slack = MAX_PUCK_SPEED * STEP + 0.01;
      if (half === 0 ? puck.y > line + slack : puck.y < line - slack) {
        return 'sent the puck from the wrong half';
      }
    }
    const last = this.lastPuck;
    if (last) {
      // A pass may tell of a moment a little before the last report: allow for either order.
      const seconds = (Math.abs(s - last.s) + (half === null ? 50 : 0)) / 1000;
      if (dist(puck, last.puck) > PUCK_MOVE(seconds)) return 'moved the puck faster than it can go';
    }
    return null;
  }

  /**
   * Counts what an honest app never sends but a rounding might once: the puck's course changed
   * with no wall and no mallet near, or the puck inside the sender's mallet. Too many in a while
   * is a rule break.
   */
  private strike(puck: Body, s: number, mallet: Point): string | null {
    const spec = this.table.match.spec;
    const now = this.now();
    let strike = dist(puck, mallet) < spec.puck.radius + spec.mallet.radius - 0.003;
    const last = this.lastPuck;
    if (!strike && last && s > last.s && s - last.s <= 100) {
      const seconds = (s - last.s) / 1000;
      const keep = Math.exp(-DAMPING * seconds);
      const turned = Math.hypot(puck.vx - last.puck.vx * keep, puck.vy - last.puck.vy * keep);
      if (turned > TURN) {
        // Where the puck can have been between the two: as far as it goes in that time.
        const time = seconds + FRAME_SLACK;
        const speed = Math.max(
          Math.hypot(puck.vx, puck.vy),
          Math.hypot(last.puck.vx, last.puck.vy),
        );
        const reach = spec.puck.radius + spec.mallet.radius + MAX_MALLET_SPEED * time + 0.03;
        const nearMallet = dist(puck, mallet) < reach || dist(last.puck, mallet) < reach;
        const walls = boundary(spec, spec.puck.radius + speed * time + 0.03);
        const free = (p: Point) => dist(pushInside(walls, p.x, p.y), p) === 0;
        strike = !nearMallet && free(puck) && free(last.puck);
      }
    }
    if (!strike) return null;
    this.strikes = [...this.strikes.filter((t) => now - t < STRIKE_WINDOW_MS), now];
    return this.strikes.length >= STRIKES
      ? 'kept changing the puck’s course with nothing there to change it'
      : null;
  }

  /** How long ago, on this clock, a report stamped `s` (about `age` ms after the moment) was. */
  private rewind(s: number, age: number): number {
    const gap = this.bestLead - (s - this.now());
    const half = this.allowance / 2;
    const estimate = Math.max(0, gap) + half + age;
    return Math.min(estimate, half + 30 + age, MAX_REWIND_MS + age, PATH_STEPS * STEP * 1000);
  }

  /** Plays the puck on from where the other side had it `ms` ago, with this mallet as it went. */
  private playFrom(puck: Body, ms: number): void {
    const steps = Math.min(Math.round(ms / (STEP * 1000)), this.path.length - 1);
    const path = steps > 0 ? this.path.slice(-(steps + 1)) : [];
    this.table.match.replay(this.mySeat, puck, path, (left) => this.passIfCrossed(left));
  }

  // --- this player's play ------------------------------------------------------------------------

  /** The puck has crossed into the other half: it is theirs now (`left` steps ago). */
  private passIfCrossed(left: number): void {
    const match = this.table.match;
    const { world } = match;
    if (this.holder !== this.mySeat || match.current.phase !== 'play' || !world.live) return;
    if (halfOf(match.spec, world.puck.y) === this.mySeat) return;
    this.r += 1;
    const s = this.stamp();
    const age = Math.min(MAX_AGE, Math.round(left * STEP * 1000));
    const message: HockeyMessage = { t: 'pass', s, age, r: this.r, p: encodePuck(world.puck) };
    this.lastEvent = { message, r: this.r, at: this.now(), s: s - age };
    this.lastPuck = null;
    this.send(message, true);
  }

  private sendState(): void {
    const match = this.table.match;
    const { world } = match;
    const m = world.mallets[this.mySeat];
    const mine = this.holder === this.mySeat && match.current.phase === 'play' && world.live;
    const message: StateMessage = {
      t: 'st',
      s: this.stamp(),
      m: Math.round(match.time * 1000),
      a: this.lastStamp ?? -1,
      r: this.r,
      h: this.hidden,
      x: encodePosition(m.x),
      y: encodePosition(m.y),
      ...(mine ? { p: encodePuck(world.puck) } : {}),
    };
    this.lastSent = this.now();
    this.send(message, false);
  }

  private send(message: HockeyMessage, changesMatch: boolean): void {
    for (const listener of this.listeners) listener.send(message, changesMatch);
  }

  // --- the clocks ------------------------------------------------------------------------------

  private tick(): void {
    if (!this.online()) return;
    const now = this.now();
    if (!this.held) this.playClock += now - this.lastTick;
    this.lastTick = now;
    this.updateHold();
    this.watchClocks(now);
    this.resend(now);
    // Nothing goes to a hidden page but what changes the match; it says when it is back.
    if (this.peerHidden) return;
    const slow =
      this.held || now - this.lastHeard > SLOW_AFTER_MS || now - this.peerAckAt > SLOW_AFTER_MS;
    if (slow && now - this.lastSent < HEARTBEAT_MS) return;
    this.sendState();
  }

  /** The other player's clocks: their serve, their hold on the puck, their page hidden. */
  private watchClocks(now: number): void {
    const match = this.table.match;
    const state = match.current;
    const remote = other(this.mySeat);
    const slack = this.allowance + GRACE_MS;

    const since = () => ({ theirs: this.peerTime, mine: this.playClock });
    const past = (start: { theirs: number }, limit: number) =>
      this.peerTime - start.theirs > limit + GRACE_MS;

    const serveDue = match.waiting && state.server === remote;
    if (!serveDue) this.serveDueSince = null;
    else {
      this.serveDueSince ??= since();
      const late = SLOWEST * (SERVE_DUE_MS + GRACE_MS) + slack;
      if (
        past(this.serveDueSince, SERVE_DUE_MS) ||
        this.playClock - this.serveDueSince.mine > late
      ) {
        this.serveDueSince = since();
        const still = () => match.waiting && match.current.server === remote && !this.held;
        this.violation('stalled', 'did not serve', still);
      }
    }

    const holding = state.phase === 'play' && this.holder === remote;
    if (!holding) this.heldBySince = null;
    else {
      this.heldBySince ??= since();
      if (past(this.heldBySince, POSSESSION_LIMIT * 1000)) {
        this.heldBySince = since();
        const r = this.r;
        const still = () => this.r === r && match.current.phase === 'play' && !this.held;
        this.violation('stalled', 'kept the puck past the time allowed without saying so', still);
      }
    }

    if (this.peerHidden && !this.sessionHeld && now - this.peerHiddenSince > HIDDEN_LIMIT_MS) {
      this.peerHiddenSince = now;
      this.violation(
        'abandoned',
        'stayed away from the game for two minutes',
        () => this.peerHidden && !this.sessionHeld,
      );
    }
  }

  /** A pass or serve the other side has still not taken goes again. */
  private resend(now: number): void {
    const last = this.lastEvent;
    if (!last || this.held || this.r !== last.r) return;
    if (this.peerAckAt < last.at || now - last.at <= this.allowance + RESEND_MS) return;
    // Their reports carry the token: once they show it, the event arrived.
    if (this.mismatchSince === null) return;
    const s = this.stamp();
    const message =
      last.message.t === 'pass'
        ? { ...last.message, s, age: Math.min(MAX_AGE, Math.round(s - last.s)) }
        : { ...last.message, s };
    if (message.t === 'pass' && message.age >= MAX_AGE) return;
    last.at = now;
    this.send(message, false);
  }

  private violation(reason: ForfeitReason, detail: string, stillTrue: () => boolean): void {
    for (const listener of this.listeners) listener.violation(reason, detail, stillTrue);
  }

  // --- holding play --------------------------------------------------------------------------

  private updateHold(): void {
    if (!this.started) return;
    const silent = !this.peerHidden && this.now() - this.lastHeard > SILENCE_MS;
    const held = this.sessionHeld || this.hidden || this.peerHidden || silent;
    if (held !== this.held) {
      this.held = held;
      // What was measured before stands for nothing after.
      this.resetBaselines(false);
      this.path = [];
    }
    if (this.online()) this.table.match.held = held;
  }

  private resetBaselines(clock: boolean): void {
    this.lastMallet = null;
    this.lastPuck = null;
    this.mismatchSince = null;
    if (!clock) return;
    this.lastStamp = null;
    this.leadSince = null;
    this.bestLead = -Infinity;
    this.settledLead = null;
    this.peerAck = -1;
    this.peerAckAt = this.now();
    this.reports = [];
  }

  /**
   * What is wrong with the other side's clock, or null. Its stamps never go back, and never run
   * ahead of this clock by more than they did once settled: a stamp that arrives sooner after it
   * was sent than any before shows that clock a little further ahead; a page busy as the match
   * starts handles its first messages late, so where the clock stands is settled over a few
   * seconds first.
   */
  private checkStamp(s: number): string | null {
    const now = this.now();
    if (this.lastStamp !== null && s < this.lastStamp) return 'sent its moves out of order';
    this.leadSince ??= now;
    this.bestLead = Math.max(this.bestLead, s - now);
    if (this.settledLead === null) {
      if (now - this.leadSince >= SETTLE_MS) this.settledLead = this.bestLead;
    } else if (this.bestLead > this.settledLead + AHEAD_MS) {
      return 'ran its clock ahead';
    }
    this.lastStamp = s;
    return null;
  }

  // --- helpers ---------------------------------------------------------------------------------

  /** The other mallet, a moment behind its newest report, between the two reports around then. */
  private followed(): Point | null {
    const reports = this.reports;
    const newest = reports[reports.length - 1];
    if (!newest || this.leadSince === null) return this.restingAt;
    const at = this.now() + this.bestLead - BEHIND_MS;
    if (at >= newest.s) return newest.at;
    for (let i = reports.length - 1; i > 0; i--) {
      const a = reports[i - 1]!;
      const b = reports[i]!;
      if (at < a.s) continue;
      const t = b.s > a.s ? (at - a.s) / (b.s - a.s) : 1;
      return { x: a.at.x + (b.at.x - a.at.x) * t, y: a.at.y + (b.at.y - a.at.y) * t };
    }
    return reports[0]!.at;
  }

  /** The match plays online with the other seat driven by its reports. */
  private attach(): void {
    const match = this.table.match;
    const remote = other(this.mySeat);
    match.referee = this;
    match.world.solid[this.mySeat] = true;
    match.world.solid[remote] = false;
    match.drivers[remote] = this.follower;
    match.limits[remote] = FOLLOW;
  }

  private take(state: MatchState, puck: Body | null, r: number): void {
    this.r = r;
    this.table.match.adopt(state, puck);
    this.lastEvent = null;
    this.path = [];
    this.serveDueSince = null;
    this.heldBySince = null;
    this.resetBaselines(false);
    this.table.restored?.();
  }

  private stamp(): number {
    return Math.max(0, Math.round(this.now()));
  }

  private online(): boolean {
    return this.started && this.table.match.setup.mode === 'online';
  }
}

/** Whether two states are the same point of the same match (the puck aside). */
function sameMatch(a: MatchState, b: MatchState): boolean {
  return (
    a.goals === b.goals &&
    a.score[0] === b.score[0] &&
    a.score[1] === b.score[1] &&
    a.fouls === b.fouls &&
    a.winner === b.winner &&
    a.phase === b.phase &&
    a.server === b.server
  );
}

function violation(detail: string): Receipt {
  return { kind: 'violation', detail };
}

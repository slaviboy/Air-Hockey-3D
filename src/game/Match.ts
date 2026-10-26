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

// A match being played: the puck, the mallets and the score, in time. The frame loop hands it the
// time that passed; it plays that many fixed steps of the simulation (and keeps the rest for the
// next frame), so the game runs alike at any frame rate. Each step it sends the mallets where their
// players want them, applies the rules to what happened, and after a goal or a foul glides the
// mallets home and serves the puck to the player who is given it. The scene only shows the result.

import { Store } from '../core/Store.ts';
import { steer, type MalletLimits } from '../physics/mallet.ts';
import { PLAYER_MALLET, STEP } from '../physics/params.ts';
import { createWorld, step, type Body, type PhysicsEvent, type World } from '../physics/puck.ts';
import {
  concede,
  FETCH_DELAY,
  FETCH_SPEED,
  FOUL_PAUSE,
  GOAL_PAUSE,
  newMatch,
  POSSESSION_LIMIT,
  possessionFoul,
  scoreGoal,
  serve,
  type MatchState,
} from '../rules/match.ts';
import { other, type Seat } from '../rules/types.ts';
import {
  halfOf,
  malletArea,
  malletHome,
  serveSpot,
  type Area,
  type Point,
  type Reach,
} from '../table/geometry.ts';
import { TABLE, type TableSpec } from '../table/spec.ts';

/** Against the computer, two players on this device, or a friend online. */
export type MatchMode = 'computer' | 'local' | 'online';

export interface MatchSetup {
  readonly mode: MatchMode;
  readonly target: number;
  readonly names: readonly [string, string];
  readonly firstServe: Seat;
  /** How far up the table the mallets may go (both alike); the whole half when not given. */
  readonly reach?: Reach;
}

/** What happens in a match, for the sounds, the scene and the interface. */
export type MatchEvent =
  | PhysicsEvent
  | { readonly kind: 'scored'; readonly scorer: Seat }
  | { readonly kind: 'foul'; readonly holder: Seat }
  | { readonly kind: 'served'; readonly seat: Seat }
  | { readonly kind: 'won'; readonly winner: Seat };

/** Something that moves a mallet each step instead of a pointer: the computer, or the keys. */
export interface Driver {
  /** Where the seat's mallet should go this step, or null to leave it to the pointer. */
  target(match: Match, seat: Seat, dt: number): Point | null;
}

/**
 * Who makes the calls (src/game/HockeyPort.ts, online). On one device this device makes them all.
 * Online each player's device calls the goals into their own goal and the fouls on themselves,
 * while the puck is theirs, and serves for them; the other device is told, and waits until it is.
 */
export interface Referee {
  /** Whether this device calls a goal into `seat`'s goal, or a foul on `seat`. */
  calls(seat: Seat): boolean;
  /** Whether this device serves for `seat` once the pause before a serve is over. */
  serves(seat: Seat): boolean;
  /** Hears everything that happens, after the match has. */
  heard(event: MatchEvent): void;
  /** After each step of play. */
  stepped(): void;
}

/** How quickly a drawing correction fades (online, the puck as the other player's device has it). */
const CORRECTION_SECONDS = 0.07;

/** Steps played in one frame at most; a frame later than that drops the rest (a stalled tab). */
const MAX_STEPS_PER_FRAME = 24;

export class Match {
  readonly world: World;
  readonly state: Store<MatchState>;
  setup: MatchSetup;
  /** Where each mallet is sent, by a pointer or a finger; a driver overrides it. */
  readonly targets: [Point, Point];
  readonly drivers: [Driver | null, Driver | null] = [null, null];
  readonly limits: [MalletLimits, MalletLimits] = [PLAYER_MALLET, PLAYER_MALLET];
  /** Where the puck and the mallets were a step ago, to draw them between steps. */
  readonly previous = {
    puck: { x: 0, y: 0 },
    mallets: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
  };
  /** The player stopped the match (the pause menu, on one device). */
  paused = false;
  /** Held from outside: online, while the other player is away or the tables are put in step. */
  held = false;
  /** Called with everything that happens. */
  onEvent: (event: MatchEvent) => void = () => {};
  /** Online, who makes which calls; null on one device. A new match clears it. */
  referee: Referee | null = null;
  /**
   * Where the puck is drawn from where it is: online, a correction from the other device, faded
   * away over a moment rather than shown as a jump.
   */
  readonly drawOffset = { x: 0, y: 0 };
  /** Seconds of play so far. */
  time = 0;
  /** The time owed to the simulation, less than a step. */
  private owed = 0;
  /** Seconds left of the pause after a goal or a foul. */
  private wait = 0;
  /** The half the puck is in, and for how long it has been there. */
  private possession: { seat: Seat; time: number } = { seat: 0, time: 0 };
  /** Each seat's zone in this match, and its whole half (where a stranded puck may be fetched). */
  private zones: [Area, Area] = [malletArea(TABLE, 0), malletArea(TABLE, 1)];
  private halves: [Area, Area] = [malletArea(TABLE, 0), malletArea(TABLE, 1)];
  /** Seconds the puck has lain where neither mallet may reach. */
  private stranded = 0;
  /** The seat out of its zone to fetch a stranded puck, or null. */
  fetching: Seat | null = null;

  constructor(
    setup: MatchSetup,
    readonly spec: TableSpec = TABLE,
  ) {
    this.setup = setup;
    this.world = createWorld(spec);
    this.state = new Store(newMatch(setup.target, setup.firstServe));
    this.targets = [malletHome(spec, 0), malletHome(spec, 1)];
    this.start(setup);
  }

  /** Starts a match with these terms: the mallets at home, the puck on the server's spot. */
  start(setup: MatchSetup = this.setup): void {
    this.setup = setup;
    this.referee = null;
    this.world.solid[0] = true;
    this.world.solid[1] = true;
    this.drawOffset.x = this.drawOffset.y = 0;
    this.state.set(newMatch(setup.target, setup.firstServe));
    this.zones = [malletArea(this.spec, 0, this.reach), malletArea(this.spec, 1, this.reach)];
    this.halves = [malletArea(this.spec, 0), malletArea(this.spec, 1)];
    this.world.areas = [this.zones[0], this.zones[1]];
    this.stranded = 0;
    this.fetching = null;
    for (const seat of [0, 1] as const) {
      const home = malletHome(this.spec, seat);
      Object.assign(this.world.mallets[seat], { x: home.x, y: home.y, vx: 0, vy: 0 });
      this.targets[seat] = home;
    }
    this.placePuck(setup.firstServe);
    this.owed = 0;
    this.wait = 0;
    this.time = 0;
    this.paused = false;
    this.remember();
  }

  get current(): MatchState {
    return this.state.get();
  }

  /** How far up the table the mallets may go in this match. */
  get reach(): Reach {
    return this.setup.reach ?? 'half';
  }

  /** Whether the puck is out of play for the pause after a goal or a foul. */
  get waiting(): boolean {
    const phase = this.current.phase;
    return phase === 'goal' || phase === 'foul';
  }

  /** The share of a step owed to the simulation: how far to draw between the last two steps. */
  get alpha(): number {
    return this.owed / STEP;
  }

  /** Seconds the puck has been in its present half, while in play. */
  get possessionTime(): number {
    return this.current.phase === 'play' ? this.possession.time : 0;
  }

  /** Plays the time that passed, in fixed steps. Returns whether anything may have moved. */
  update(dt: number): boolean {
    const fade = Math.exp(-dt / CORRECTION_SECONDS);
    this.drawOffset.x *= fade;
    this.drawOffset.y *= fade;
    if (this.paused || this.held) return false;
    this.owed += dt;
    let steps = 0;
    while (this.owed >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.stepOnce();
      this.owed -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.owed = 0;
    return true;
  }

  /** One step of the simulation and the rules. */
  stepOnce(): void {
    this.remember();
    const { world, spec } = this;
    const waiting = this.waiting;
    this.watchStranded();
    const to: [Point, Point] = [world.mallets[0], world.mallets[1]];
    for (const seat of [0, 1] as const) {
      // In the pause after a goal or a foul both mallets go home; otherwise where they are sent.
      const target = waiting
        ? malletHome(spec, seat)
        : (this.drivers[seat]?.target(this, seat, STEP) ?? this.targets[seat]);
      to[seat] = steer(world.mallets[seat], target, world.areas[seat], this.limits[seat]);
    }
    for (const event of step(world, to)) this.apply(event);
    this.time += STEP;
    if (this.waiting) {
      this.wait -= STEP;
      // Online, the server's own device serves; this one waits to be told.
      if (this.wait <= 0 && (this.referee?.serves(this.current.server) ?? true)) this.serve();
    } else if (this.current.phase === 'play') {
      this.watchPossession();
    }
    this.referee?.stepped();
  }

  private emit(event: MatchEvent): void {
    this.onEvent(event);
    this.referee?.heard(event);
  }

  private apply(event: PhysicsEvent): void {
    if (event.kind !== 'goal') {
      this.emit(event);
      return;
    }
    // A goal this device does not call waits in the slot until it is called, or the puck is put
    // back where the other device has it.
    if (this.referee && !this.referee.calls(event.seat)) return;
    this.emit(event);
    this.score(event.seat);
  }

  /** A goal into `into`'s goal counts. */
  private score(into: Seat): void {
    const before = this.current;
    const after = scoreGoal(before, into);
    if (after === before) return;
    this.state.set(after);
    this.wait = GOAL_PAUSE;
    this.emit({ kind: 'scored', scorer: other(into) });
    if (after.winner !== null) this.emit({ kind: 'won', winner: after.winner });
  }

  /**
   * A puck at rest where neither mallet may reach (between short zones), or sliding there from
   * side to side, is fetched, as a player at a real table would: after a moment, the player whose half it lies in may take their mallet
   * up to the centre line, until the puck is struck or within reach again. The mallet then glides
   * back into its zone (the step moves it there no faster than a hand).
   */
  private watchStranded(): void {
    const { world, spec } = this;
    const p = world.puck;
    const touch = spec.mallet.radius + spec.puck.radius;
    const beyond = p.y > this.zones[0].y1 + touch && p.y < this.zones[1].y0 - touch;
    // Slow to come into either zone: at rest, or sliding along the table rather than up it.
    const slow = Math.abs(p.vy) < FETCH_SPEED;
    // Struck, or come within reach: the zones hold again at once.
    const still = world.live && this.current.phase === 'play' && beyond && slow;
    this.stranded = still ? this.stranded + STEP : 0;
    const seat = this.stranded >= FETCH_DELAY ? halfOf(spec, p.y) : null;
    if (seat === this.fetching) return;
    this.fetching = seat;
    world.areas = [
      seat === 0 ? this.halves[0] : this.zones[0],
      seat === 1 ? this.halves[1] : this.zones[1],
    ];
  }

  /** The 7-second rule: a player keeping the puck in their half too long gives it up. */
  private watchPossession(): void {
    const half = halfOf(this.spec, this.world.puck.y);
    if (half !== this.possession.seat) {
      this.possession = { seat: half, time: 0 };
      return;
    }
    this.possession.time += STEP;
    if (this.possession.time < POSSESSION_LIMIT) return;
    // Online, the holder's own device calls it.
    if (this.referee && !this.referee.calls(half)) return;
    this.foul(half);
  }

  private foul(holder: Seat): void {
    this.state.set(possessionFoul(this.current, holder));
    this.world.live = false;
    Object.assign(this.world.puck, { vx: 0, vy: 0 });
    this.wait = FOUL_PAUSE;
    this.emit({ kind: 'foul', holder });
  }

  /** The pause is over: the puck goes down on the server's spot, and play goes on. */
  private serve(): void {
    const next = serve(this.current);
    this.state.set(next);
    this.placePuck(next.server);
    this.emit({ kind: 'served', seat: next.server });
  }

  // --- online: what the other player's device called ------------------------------------------

  /** The other device called a goal into `into`'s goal: the puck goes into the slot, and counts. */
  takeGoal(into: Seat): boolean {
    if (this.current.phase !== 'play') return false;
    const { world, spec } = this;
    if (world.goal !== into) {
      // Into the slot, where the puck crossed the line on this device or in the mouth's middle.
      const r = spec.puck.radius;
      const x = Math.min(
        Math.max(world.puck.x, spec.W / 2 - spec.goalWidth / 4),
        spec.W / 2 + spec.goalWidth / 4,
      );
      Object.assign(world.puck, { x, y: into === 0 ? -r * 1.2 : spec.L + r * 1.2, vx: 0, vy: 0 });
      this.previous.puck = { x: world.puck.x, y: world.puck.y };
    }
    world.live = false;
    world.goal = into;
    this.emit({ kind: 'goal', seat: into });
    this.score(into);
    return true;
  }

  /** The other device called a foul on `holder`. */
  takeFoul(holder: Seat): boolean {
    if (this.current.phase !== 'play') return false;
    this.foul(holder);
    return true;
  }

  /** The other device served: the puck goes down on the server's spot. */
  takeServe(): boolean {
    if (!this.waiting) return false;
    this.serve();
    return true;
  }

  /** Puts the puck where the other device has it, in play. */
  takePuck(puck: Body): void {
    const { world } = this;
    Object.assign(world.puck, { x: puck.x, y: puck.y, vx: puck.vx, vy: puck.vy });
    world.live = true;
    world.goal = null;
  }

  /**
   * Plays the puck again from where the other device had it, steps ago, to now: the seat's mallet
   * moves along the path it took over those steps (`path[0]` where it was, then where each step
   * left it), so a hit this device made meanwhile still counts. Only the puck, the walls and that
   * mallet are played (the other mallet cannot reach a puck in this half), and of what happens
   * only a goal is called; the step's sounds were heard, or are lost. `after` hears each step, with
   * the steps still to play.
   */
  replay(seat: Seat, puck: Body, path: readonly Point[], after?: (left: number) => void): void {
    const { world } = this;
    const drawn = this.puckAt();
    this.takePuck(puck);
    const mine = world.mallets[seat];
    const start = path[0];
    if (start) Object.assign(mine, { x: start.x, y: start.y });
    const still = world.mallets[other(seat)];
    const stay = { x: still.x, y: still.y };
    for (let i = 1; i < path.length; i++) {
      const to: [Point, Point] = seat === 0 ? [path[i]!, stay] : [stay, path[i]!];
      for (const event of step(world, to)) if (event.kind === 'goal') this.apply(event);
      after?.(path.length - 1 - i);
    }
    // Drawn from here on, with the jump faded away.
    this.previous.puck = { x: world.puck.x, y: world.puck.y };
    this.previous.mallets[seat] = { x: mine.x, y: mine.y };
    this.drawOffset.x += drawn.x - world.puck.x;
    this.drawOffset.y += drawn.y - world.puck.y;
  }

  /**
   * Takes a match as the other device has it (online, the host's, after a reconnection): its score
   * and phase, and the puck where it is, or out of play before a serve.
   */
  adopt(state: MatchState, puck: Body | null): void {
    const { world, spec } = this;
    this.state.set(state);
    this.stranded = 0;
    this.fetching = null;
    world.areas = [this.zones[0], this.zones[1]];
    if (puck && state.phase === 'play') {
      this.takePuck(puck);
      this.possession = { seat: halfOf(spec, puck.y), time: 0 };
    } else {
      const spot = serveSpot(spec, state.server, this.reach);
      Object.assign(world.puck, { x: spot.x, y: spot.y, vx: 0, vy: 0 });
      world.live = false;
      world.goal = null;
      this.wait = state.phase === 'over' ? 0 : FOUL_PAUSE;
    }
    this.previous.puck = { x: world.puck.x, y: world.puck.y };
    this.drawOffset.x = this.drawOffset.y = 0;
  }

  private placePuck(seat: Seat): void {
    const spot = serveSpot(this.spec, seat, this.reach);
    Object.assign(this.world.puck, { x: spot.x, y: spot.y, vx: 0, vy: 0 });
    this.world.live = true;
    this.world.goal = null;
    this.possession = { seat, time: 0 };
    this.previous.puck = { x: spot.x, y: spot.y };
  }

  /** A player gives up the match. */
  concede(seat: Seat): void {
    const next = concede(this.current, seat);
    if (next === this.current) return;
    this.state.set(next);
    if (next.winner !== null) this.emit({ kind: 'won', winner: next.winner });
  }

  private remember(): void {
    const { puck, mallets } = this.world;
    this.previous.puck = { x: puck.x, y: puck.y };
    this.previous.mallets = [
      { x: mallets[0].x, y: mallets[0].y },
      { x: mallets[1].x, y: mallets[1].y },
    ];
  }

  /** Where to draw the puck now, between the last step and the next. */
  puckAt(alpha = this.alpha): Point {
    const from = this.previous.puck;
    const to = this.world.puck;
    return {
      x: from.x + (to.x - from.x) * alpha + this.drawOffset.x,
      y: from.y + (to.y - from.y) * alpha + this.drawOffset.y,
    };
  }

  /** Where to draw a mallet now. */
  malletAt(seat: Seat, alpha = this.alpha): Point {
    const from = this.previous.mallets[seat]!;
    const to = this.world.mallets[seat];
    return { x: from.x + (to.x - from.x) * alpha, y: from.y + (to.y - from.y) * alpha };
  }
}

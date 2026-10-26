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

// One player's device for online tests (Pool's): the real match, a stand-in for the game on the
// screen, the port that connects it to a session, and timers the test runs by hand. play() runs
// both devices' frames side by side, each at sixty a second, and lets their messages cross.

import { HockeyPort, type PortTable } from '../../src/game/HockeyPort.ts';
import {
  HOCKEY_CODEC,
  HOCKEY_LIMITS,
  type HockeyMessage,
  type HockeyTerms,
} from '../../src/game/hockeyMessages.ts';
import { Match, type MatchSetup } from '../../src/game/Match.ts';
import type { LinkPort } from '../../src/net/LinkPort.ts';
import {
  OnlineSession,
  type SavedSession,
  type SessionStorage,
  type Timers,
} from '../../src/net/OnlineSession.ts';
import { createInvite } from '../../src/net/protocol.ts';
import { PLAYER_MALLET } from '../../src/physics/params.ts';
import type { Seat } from '../../src/rules/types.ts';
import { settle } from './memoryLink.ts';

export const invite = createInvite();
export const BUILD = 'test-build';

/** Timers that run only when the test says time has passed. */
export class ManualTimers implements Timers {
  private clock = 0;
  private next = 1;
  private readonly pending = new Map<number, { at: number; every: number; run: () => void }>();

  get time(): number {
    return this.clock;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.clock + ms, every: 0, run: callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  setInterval(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.pending.set(id, { at: this.clock + ms, every: ms, run: callback });
    return id;
  }

  clearInterval(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const end = this.clock + ms;
    for (;;) {
      const due = [...this.pending.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.clock = timer.at;
      if (timer.every > 0) timer.at += timer.every;
      else this.pending.delete(id);
      timer.run();
    }
    this.clock = end;
  }
}

export class MemoryStorage implements SessionStorage<HockeyMessage, HockeyTerms> {
  saved: SavedSession<HockeyMessage, HockeyTerms> | null = null;
  save(session: SavedSession<HockeyMessage, HockeyTerms>): void {
    this.saved = JSON.parse(JSON.stringify(session));
  }
  clear(): void {
    this.saved = null;
  }
}

/** The game on the screen, without a screen: the match, set up as the app sets it up. */
export class FakeTable implements PortTable {
  readonly match = new Match({
    mode: 'local',
    target: 7,
    names: ['Player 1', 'Player 2'],
    firstServe: 0,
  });
  localSeats: readonly Seat[] = [0, 1];
  readonly notes: string[] = [];
  readonly matches: MatchSetup[] = [];
  restores = 0;

  newMatch(setup: MatchSetup, localSeats: readonly Seat[]): void {
    this.matches.push(setup);
    const match = this.match;
    match.drivers[0] = match.drivers[1] = null;
    match.limits[0] = match.limits[1] = PLAYER_MALLET;
    match.start(setup);
    match.held = false;
    this.localSeats = localSeats;
  }

  say(text: string): void {
    this.notes.push(text);
  }

  restored(): void {
    this.restores++;
  }
}

export function device() {
  const timers = new ManualTimers();
  const table = new FakeTable();
  const port = new HockeyPort(table, { timers, now: () => timers.time });
  return {
    table,
    port,
    timers,
    now: () => timers.time,
    storage: new MemoryStorage(),
    match: table.match,
  };
}

export type Device = ReturnType<typeof device>;

export const terms = (friend: string, over: Partial<HockeyTerms> = {}): HockeyTerms => ({
  target: 3,
  reach: 'half',
  names: ['Ana', friend],
  host: 0,
  firstServe: 0,
  ...over,
});

/** The session options every test shares. */
export function sessionOptions(d: Device, link: LinkPort, name: string) {
  return {
    link,
    port: d.port,
    codec: HOCKEY_CODEC,
    invite,
    name,
    build: BUILD,
    timers: d.timers,
    now: d.now,
    storage: d.storage,
    limits: HOCKEY_LIMITS,
  };
}

export function hostSession(d: Device, link: LinkPort, over: Partial<HockeyTerms> = {}) {
  return OnlineSession.host({
    ...sessionOptions(d, link, 'Ana'),
    terms: (friend) => terms(friend, over),
  });
}

export function guestSession(d: Device, link: LinkPort, name = 'Ben') {
  return OnlineSession.join(sessionOptions(d, link, name));
}

/** A frame at sixty a second, in milliseconds. */
export const FRAME_MS = 1000 / 60;

/**
 * Runs the devices' frames side by side for `ms`: their clocks, their matches, and the messages
 * between them. `each` runs after every frame (to steer a mallet, or to look).
 */
export async function play(devices: readonly Device[], ms: number, each?: () => void) {
  for (let t = 0; t < ms - 1e-9; t += FRAME_MS) {
    for (const d of devices) {
      d.timers.advance(FRAME_MS);
      d.match.update(FRAME_MS / 1000);
    }
    each?.();
    await settle(2);
  }
}

/**
 * Puts the puck somewhere on the device that plays it, as a test's starting point. The other
 * device would take a puck that jumps as a rule break, so it is done while play is held (this page
 * hidden for a moment), after which both sides measure afresh.
 */
export async function placePuck(
  d: Device,
  puck: { x: number; y: number; vx: number; vy: number },
): Promise<void> {
  d.port.setHidden(true);
  await settle(2);
  Object.assign(d.match.world.puck, puck);
  d.match.world.live = true;
  d.port.setHidden(false);
  await settle(2);
}

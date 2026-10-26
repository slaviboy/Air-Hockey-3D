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

// A modified client against an honest host: whatever it sends goes through the host's checks.
// A mallet out of its half or faster than a hand, a puck that is not its own, faster than a puck
// goes, through a wall or on the wrong half, a pass or a serve out of turn, a clock that runs back
// or ahead: each forfeits the match and closes the connection. An honest stream, thirty times a
// second, never comes near the guard's limits.

import { describe, expect, it } from 'vitest';
import { encodePosition, type HockeyTerms } from '../../../src/game/hockeyMessages.ts';
import { OnlineSession } from '../../../src/net/OnlineSession.ts';
import { malletHome } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';
import { MemoryLink, plug, settle } from '../../support/memoryLink.ts';
import {
  BUILD,
  device,
  hostSession,
  sessionOptions,
  terms,
  type Device,
} from '../../support/onlineSides.ts';

const { W, L } = TABLE;
const home = malletHome(TABLE, 1);
const at = { x: encodePosition(home.x), y: encodePosition(home.y) };

/** An honest host, and a client that says whatever the test makes it say. */
async function cheat(over: Partial<HockeyTerms> = {}, withLimits = true) {
  const host = device();
  const hostLink = new MemoryLink();
  const fake = new MemoryLink();
  const session = withLimits
    ? hostSession(host, hostLink, over)
    : OnlineSession.host({
        ...sessionOptions(host, hostLink, 'Ana'),
        limits: undefined,
        terms: (friend) => terms(friend, over),
      });
  plug(hostLink, fake);
  await settle();
  fake.sendRaw({ t: 'hello', v: 1, build: BUILD, name: 'Eve' });
  await settle();
  const r = over.firstServe ?? 0;
  /** Sends a message on the host's clock, a frame after the last. */
  const say = async (message: Record<string, unknown>, ms = 33) => {
    host.timers.advance(ms);
    host.match.update(ms / 1000);
    const s = Math.round(host.timers.time);
    // A report carries its match's clock too: here, as fast as real time.
    fake.sendRaw({ s, ...(message.t === 'st' ? { m: s } : {}), ...message });
    await settle();
  };
  const state = (extra: Record<string, unknown> = {}) => ({
    t: 'st',
    a: -1,
    r,
    h: false,
    ...at,
    ...extra,
  });
  return { host, session, fake, hostLink, say, state };
}

function forfeited(host: Device, session: OnlineSession<never, never> | { closed: boolean }) {
  expect(session.closed).toBe(true);
  expect(host.match.current.winner).toBe(0);
}

/** A puck as it travels, from metres. */
const puck = (x: number, y: number, vx = 0, vy = 0) => [
  encodePosition(x),
  encodePosition(y),
  Math.round(vx * 1000),
  Math.round(vy * 1000),
];

describe('a modified client', () => {
  it('can stream its moves thirty times a second without being cut off', async () => {
    const { session, say, state } = await cheat();
    for (let i = 0; i < 300; i++) await say(state());
    expect(session.closed).toBe(false);
    // The default limits, made for a game of turns, would not let it.
    const turns = await cheat({}, false);
    for (let i = 0; i < 300 && !turns.session.closed; i++) await turns.say(turns.state());
    expect(turns.session.closed).toBe(true);
  });

  it('forfeits for a mallet out of its half', async () => {
    const { host, session, hostLink, say, state } = await cheat();
    await say(state());
    await say(state({ y: encodePosition(L / 2 - 0.1) }), 2000);
    forfeited(host, session);
    expect(hostLink.kicked).toBe(true);
    expect(session.state.get().message).toMatch(/mallet out of its half/);
  });

  it('forfeits for a mallet faster than a hand', async () => {
    const { host, session, say, state } = await cheat();
    await say(state());
    // From its home to the far corner of its half in a frame: a metre in 33 ms.
    const corner = { x: encodePosition(0.06), y: encodePosition(L / 2 + 0.1) };
    await say(state(corner));
    forfeited(host, session);
    expect(session.state.get().message).toMatch(/faster than a hand/);
  });

  it('forfeits for moving a puck that is not its own', async () => {
    const mine = await cheat();
    await mine.say(mine.state({ p: puck(W / 2, L * 0.75) }));
    forfeited(mine.host, mine.session);
    expect(mine.session.state.get().message).toMatch(/not theirs/);
    // Nor by claiming a later token than it was ever given.
    const later = await cheat();
    await later.say(later.state({ r: 2, p: puck(W / 2, L * 0.75) }));
    forfeited(later.host, later.session);
  });

  it('forfeits for passing or serving out of turn', async () => {
    const pass = await cheat();
    await pass.say(pass.state());
    await pass.say({ t: 'pass', age: 0, r: 1, p: puck(W / 2, L / 2 - 0.01, 0, -1) });
    forfeited(pass.host, pass.session);
    expect(pass.session.state.get().message).toMatch(/passed the puck/);
    const serve = await cheat();
    await serve.say(serve.state());
    await serve.say({ t: 'serve', r: 1 });
    forfeited(serve.host, serve.session);
    expect(serve.session.state.get().message).toMatch(/served/);
  });

  it('forfeits for a pass of a puck that never crossed the centre line', async () => {
    const { host, session, say, state } = await cheat({ firstServe: 1 });
    await say(state({ p: puck(W / 2, L * 0.75) }));
    await say({ t: 'pass', age: 0, r: 2, p: puck(W / 2, L * 0.74, 0, -0.3) });
    forfeited(host, session);
    expect(session.state.get().message).toMatch(/before it crossed/);
  });

  it('forfeits for a puck faster than it goes, through a wall, or on the wrong half', async () => {
    for (const [p, why] of [
      [puck(W / 2, L * 0.75, 0, 9), /faster than it can go/],
      [puck(-0.05, L * 0.75), /through a wall/],
      [puck(W / 2, L * 0.3), /wrong half/],
    ] as const) {
      const { host, session, say, state } = await cheat({ firstServe: 1 });
      await say(state({ p }));
      forfeited(host, session);
      expect(session.state.get().message, String(why)).toMatch(why);
    }
  });

  it('forfeits for a puck that jumps', async () => {
    const { host, session, say, state } = await cheat({ firstServe: 1 });
    await say(state({ p: puck(W / 2, L * 0.55) }));
    await say(state({ p: puck(0.1, L - 0.06) }));
    forfeited(host, session);
    expect(session.state.get().message).toMatch(/faster than it can go/);
  });

  it('forfeits for changing the puck’s course again and again with nothing there to change it', async () => {
    const { host, session, say, state } = await cheat({ firstServe: 1 });
    // Its mallet in a far corner, the puck in the open: nothing there to turn it.
    const corner = { x: encodePosition(0.06), y: encodePosition(L - 0.06) };
    let y = L * 0.59;
    let vy = 2;
    await say(state({ ...corner, p: puck(0.7, y, 0, vy) }));
    for (let i = 0; i < 4 && !session.closed; i++) {
      y += vy * 0.033;
      vy = -vy;
      await say(state({ ...corner, p: puck(0.7, y, 0, vy) }));
    }
    forfeited(host, session);
    expect(session.state.get().message).toMatch(/course/);
  });

  it('forfeits for a clock that runs back, or ahead', async () => {
    const back = await cheat();
    await back.say(back.state());
    back.host.timers.advance(33);
    back.fake.sendRaw({ ...back.state(), s: 1, m: 1 });
    await settle();
    forfeited(back.host, back.session);
    expect(back.session.state.get().message).toMatch(/out of order/);
    // Ahead, once its clock has settled (a few seconds of honest messages first).
    const ahead = await cheat();
    for (let i = 0; i < 170; i++) await ahead.say(ahead.state());
    expect(ahead.session.closed).toBe(false);
    ahead.host.timers.advance(33);
    ahead.fake.sendRaw({ ...ahead.state(), s: Math.round(ahead.host.timers.time) + 4000, m: 0 });
    await settle();
    forfeited(ahead.host, ahead.session);
    expect(ahead.session.state.get().message).toMatch(/clock ahead/);
  });

  it('only puts the two out of step with a goal counted wrong, which costs nobody the match', async () => {
    const { host, session, say, state } = await cheat({ firstServe: 1 });
    await say(state({ p: puck(W / 2, L * 0.75) }));
    await say({ t: 'goal', n: 5 });
    expect(session.closed).toBe(false);
    expect(session.state.get().desyncs).toBe(1);
    expect(host.match.current.score).toEqual([0, 0]);
  });
});

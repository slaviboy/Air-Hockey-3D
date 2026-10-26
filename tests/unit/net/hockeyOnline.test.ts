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

// Two devices playing a match online, each with its own match, joined by a link in memory: the
// puck passed over the centre line, goals and fouls called once by the right device and counted on
// both, serves, play held by a hidden page or a silent link and going on from where it stood, a
// rematch, a reloaded guest picking the match back up, and the two brought back in step.

import { describe, expect, it } from 'vitest';
import { HIDDEN_LIMIT_MS } from '../../../src/game/HockeyPort.ts';
import { OnlineSession } from '../../../src/net/OnlineSession.ts';
import { centreLine, serveSpot } from '../../../src/table/geometry.ts';
import { TABLE } from '../../../src/table/spec.ts';
import { MemoryLink, plug, settle, unplug } from '../../support/memoryLink.ts';
import {
  device,
  guestSession,
  hostSession,
  placePuck,
  play,
  sessionOptions,
  type Device,
} from '../../support/onlineSides.ts';

const { W, L } = TABLE;

async function connect(over: Parameters<typeof hostSession>[2] = {}) {
  const host = device();
  const guest = device();
  const hostLink = new MemoryLink();
  const guestLink = new MemoryLink();
  const hostSide = hostSession(host, hostLink, over);
  const guestSide = guestSession(guest, guestLink);
  plug(hostLink, guestLink);
  await settle();
  // A frame or two for the first reports to cross.
  await play([host, guest], 100);
  return { host, guest, hostSide, guestSide, hostLink, guestLink };
}

/** Both mallets out of the way, in a corner by their own goal. */
function park(...devices: Device[]) {
  for (const d of devices) {
    d.match.targets[0] = { x: 0.1, y: 0.12 };
    d.match.targets[1] = { x: 0.1, y: L - 0.12 };
  }
}

const close = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('a match online', () => {
  it('starts alike on both devices, each playing its own seat', async () => {
    const { host, guest, hostSide, guestSide } = await connect({ reach: 'third' });
    expect(hostSide.state.get().status).toBe('playing');
    expect(guestSide.state.get().status).toBe('playing');
    expect([host.port.seat, guest.port.seat]).toEqual([0, 1]);
    expect(host.table.localSeats).toEqual([0]);
    expect(guest.table.localSeats).toEqual([1]);
    for (const d of [host, guest]) {
      expect(d.match.setup).toMatchObject({
        mode: 'online',
        names: ['Ana', 'Ben'],
        reach: 'third',
      });
      expect(d.port.holder).toBe(0);
      expect(d.match.held).toBe(false);
    }
    // Each plays the puck only against its own mallet.
    expect(host.match.world.solid).toEqual([true, false]);
    expect(guest.match.world.solid).toEqual([false, true]);
  });

  it('shows each player the other’s mallet where they move it', async () => {
    const { host, guest } = await connect();
    guest.match.targets[1] = { x: 0.3, y: L - 0.3 };
    await play([host, guest], 800);
    const there = guest.match.world.mallets[1];
    expect(close(host.match.world.mallets[1], there)).toBeLessThan(0.01);
  });

  it('passes the puck over the centre line, and the other device plays it on', async () => {
    const { host, guest, hostSide, guestSide } = await connect();
    park(host, guest);
    await play([host, guest], 600);
    await placePuck(host, { x: W / 2 - 0.2, y: L / 2 - 0.25, vx: 0.4, vy: 1.6 });
    let passed = false;
    await play([host, guest], 400, () => {
      passed ||= host.port.token === 1;
    });
    expect(passed).toBe(true);
    expect(guest.port.token).toBe(1);
    expect(guest.port.holder).toBe(1);
    // The guest plays it now, and the host sees it there.
    expect(guest.match.world.puck.y).toBeGreaterThan(centreLine(TABLE));
    await play([host, guest], 100);
    expect(close(host.match.world.puck, guest.match.world.puck)).toBeLessThan(0.05);
    expect(hostSide.closed || guestSide.closed).toBe(false);
  });

  it('counts a goal once on both devices, called by the player scored on, who serves', async () => {
    const { host, guest, hostSide } = await connect();
    park(host, guest);
    await play([host, guest], 600);
    // Straight at the guest's goal.
    await placePuck(host, { x: W / 2, y: L / 2 - 0.1, vx: 0, vy: 4 });
    await play([host, guest], 800);
    for (const d of [host, guest]) {
      expect(d.match.current.score).toEqual([1, 0]);
      expect(d.match.current.goals).toBe(1);
      expect(d.match.current.server).toBe(1);
    }
    expect(guest.storage.saved?.state).toMatchObject({ t: 'sync', n: 1, score: [1, 0] });
    // After the pause the guest serves: the puck is theirs on their spot, on both devices.
    await play([host, guest], 2500);
    for (const d of [host, guest]) {
      expect(d.match.current.phase).toBe('play');
      expect(d.port.holder).toBe(1);
      expect(d.match.current.score).toEqual([1, 0]);
    }
    const spot = serveSpot(TABLE, 1);
    expect(close(guest.match.world.puck, spot)).toBeLessThan(1e-9);
    expect(close(host.match.world.puck, spot)).toBeLessThan(0.01);
    expect(hostSide.closed).toBe(false);
  });

  it('calls the seven-second rule on the player keeping the puck; the other one serves', async () => {
    const { host, guest } = await connect();
    park(host, guest);
    // At rest in the host's half, which the host leaves alone.
    await placePuck(host, { x: W / 2, y: L / 4, vx: 0, vy: 0 });
    await play([host, guest], 7600);
    for (const d of [host, guest]) {
      expect(d.match.current.fouls).toBe(1);
      expect(d.match.current.server).toBe(1);
    }
    await play([host, guest], 1800);
    for (const d of [host, guest]) {
      expect(d.match.current.phase).toBe('play');
      expect(d.port.holder).toBe(1);
    }
  });

  it('holds play on both sides while a page is hidden, and goes on from where it stood', async () => {
    const { host, guest } = await connect();
    park(host, guest);
    await play([host, guest], 300);
    await placePuck(host, { x: 0.3, y: 0.5, vx: 1.2, vy: 0.3 });
    await play([host, guest], 50);
    guest.port.setHidden(true);
    await settle();
    expect(guest.match.held).toBe(true);
    expect(host.match.held).toBe(true);
    expect(host.port.holdReason()).toMatchObject({ kind: 'peerHidden' });
    const stood = { ...host.match.world.puck };
    await play([host, guest], 3000);
    expect(host.match.world.puck).toEqual(stood);
    guest.port.setHidden(false);
    await settle();
    expect(host.match.held).toBe(false);
    await play([host, guest], 100);
    // On from where it stood: a tenth of a second further along.
    expect(close(host.match.world.puck, stood)).toBeGreaterThan(0.05);
    expect(close(host.match.world.puck, stood)).toBeLessThan(0.2);
  });

  it('takes a slow page, playing its match in bursts, for what it is: no cheat', async () => {
    const { host, guest, hostSide, guestSide } = await connect();
    // The guest's page draws ten frames a second, each playing a tenth of a second of the match
    // at once, while its reports still go out thirty times a second; its mallet swings hard
    // from side to side.
    let frame = 0;
    for (let t = 0; t < 4000; t += 1000 / 60) {
      host.timers.advance(1000 / 60);
      guest.timers.advance(1000 / 60);
      host.match.update(1 / 60);
      if (++frame % 6 === 0) {
        guest.match.targets[1] = { x: frame % 12 === 0 ? 0.08 : W - 0.08, y: L * 0.6 };
        guest.match.update(0.1);
      }
      await settle(2);
    }
    expect(hostSide.closed).toBe(false);
    expect(guestSide.closed).toBe(false);
    expect(host.match.current.winner).toBeNull();
  });

  it('waits for a slow page’s serve on its own match’s clock', async () => {
    const { host, guest, hostSide } = await connect();
    park(host, guest);
    await play([host, guest], 600);
    await placePuck(host, { x: W / 2, y: L / 2 - 0.1, vx: 0, vy: 4 });
    await play([host, guest], 800);
    expect(guest.match.current).toMatchObject({ phase: 'goal', server: 1 });
    // The guest's match now runs at a quarter of real time: its pause, and its serve, come late.
    let frame = 0;
    for (let t = 0; t < 12000 && guest.match.current.phase !== 'play'; t += 1000 / 60) {
      host.timers.advance(1000 / 60);
      guest.timers.advance(1000 / 60);
      host.match.update(1 / 60);
      if (++frame % 24 === 0) guest.match.update(0.1);
      await settle(2);
    }
    await play([host, guest], 200);
    expect(hostSide.closed).toBe(false);
    expect(host.match.current.phase).toBe('play');
    expect(host.port.holder).toBe(1);
  });

  it('holds play while nothing is heard from the other side', async () => {
    const { host, guest, guestLink } = await connect();
    guestLink.losing = true;
    await play([host, guest], 2000);
    expect(host.match.held).toBe(true);
    expect(host.port.holdReason()).toEqual({ kind: 'silent' });
    guestLink.losing = false;
    await play([host, guest], 300);
    expect(host.match.held).toBe(false);
  });

  it('gives the match to the player whose friend’s page stays hidden for two minutes', async () => {
    const { host, guest, hostSide } = await connect();
    guest.port.setHidden(true);
    await settle();
    for (let t = 0; t < HIDDEN_LIMIT_MS + 2000; t += 1000) {
      host.timers.advance(1000);
      guest.timers.advance(1000);
      await settle(2);
    }
    expect(host.match.current.winner).toBe(0);
    expect(hostSide.closed).toBe(true);
    expect(hostSide.state.get().message).toMatch(/two minutes/);
  });

  it('plays a rematch on the same terms, the loser serving first', async () => {
    const { host, guest, hostSide, guestSide } = await connect();
    await guestSide.resign();
    await settle();
    expect(host.match.current.winner).toBe(0);
    expect(guest.match.current.winner).toBe(0);
    await hostSide.requestRematch();
    await settle();
    await guestSide.requestRematch();
    await settle();
    for (const d of [host, guest]) {
      expect(d.match.current).toMatchObject({ phase: 'play', winner: null, score: [0, 0] });
      expect(d.match.setup.firstServe).toBe(1);
      expect(d.port.holder).toBe(1);
    }
  });

  it('lets a reloaded guest pick the match back up from the host’s', async () => {
    const { host, guest, hostLink, guestLink, guestSide } = await connect();
    park(host, guest);
    await play([host, guest], 500);
    await placePuck(host, { x: W / 2, y: L / 2 - 0.1, vx: 0, vy: 4 });
    await play([host, guest], 3000);
    expect(host.match.current.score).toEqual([1, 0]);
    const saved = guest.storage.saved!;
    expect(saved).not.toBeNull();
    // The guest's page reloads: a new device, from what its tab kept.
    guestSide.dispose();
    unplug(hostLink, guestLink);
    await settle();
    expect(hostLink.connected).toBe(false);
    const again = device();
    again.timers.advance(host.timers.time);
    const link = new MemoryLink();
    const resumed = OnlineSession.resume(saved, sessionOptions(again, link, 'Ben'));
    plug(hostLink, link);
    await settle();
    await play([host, again], 300);
    expect(resumed.state.get().status).toBe('playing');
    expect(again.match.current.score).toEqual([1, 0]);
    expect(again.port.seat).toBe(1);
    expect(again.port.token).toBe(host.port.token);
    // And plays on.
    await play([host, again], 2500);
    expect(again.match.current.phase).toBe('play');
    expect(host.match.current.phase).toBe('play');
  });
});

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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetServerTime, serverNow, syncServerTime } from '../../../src/net/serverTime.ts';

const TRUE_TIME = Date.parse('2026-10-21T12:00:00.000Z');

/** A server whose clock shows the true time, answering after `delayMs` of this device's time. */
function server(delayMs = 0, date: (now: number) => string | null = (now) => httpDate(now)) {
  const requests: RequestInit[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    requests.push(init);
    vi.advanceTimersByTime(delayMs / 2);
    const header = date(trueNow());
    vi.advanceTimersByTime(delayMs / 2);
    return new Response(null, { headers: header ? { Date: header } : {} });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

const httpDate = (ms: number) => new Date(ms).toUTCString();

/** When this device's clock was set; the true time then was TRUE_TIME. */
const device = { start: 0 };
/** The true time now, as the server's clock shows it. */
const trueNow = () => TRUE_TIME + (Date.now() - device.start);

/** Sets this device's clock `lagMs` behind the true time (negative: ahead). */
function deviceClock(lagMs: number) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(TRUE_TIME - lagMs);
  device.start = Date.now();
}

afterEach(() => {
  resetServerTime();
  vi.useRealTimers();
});

describe('server time', () => {
  it("is this device's own clock until the server has been asked", () => {
    deviceClock(3 * 3600_000);
    expect(serverNow()).toBe(Date.now());
  });

  for (const [name, lag] of [
    ['set hours behind by hand', 3 * 3600_000],
    ['five minutes fast', -5 * 60_000],
    ['a few seconds behind', 7_000],
    ['right', 0],
  ] as const) {
    it(`corrects a device whose clock is ${name}, to within a second`, async () => {
      deviceClock(lag);
      const { fetch, requests } = server(300);
      expect(await syncServerTime({ fetch, url: 'https://example.test/' })).toBe(true);
      expect(Math.abs(serverNow() - trueNow())).toBeLessThan(1_000);
      // One small request for the page itself, never from a cache.
      expect(requests).toEqual([expect.objectContaining({ method: 'HEAD', cache: 'no-store' })]);
    });
  }

  it("keeps this device's clock when the server gives no time, or cannot be reached", async () => {
    deviceClock(60_000);
    const silent = server(0, () => null);
    expect(await syncServerTime({ fetch: silent.fetch, url: 'https://example.test/' })).toBe(false);
    expect(serverNow()).toBe(Date.now());
    const failing = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof globalThis.fetch;
    expect(await syncServerTime({ fetch: failing, url: 'https://example.test/' })).toBe(false);
    expect(serverNow()).toBe(Date.now());
  });

  it('keeps what it learnt when a later attempt fails', async () => {
    deviceClock(3600_000);
    await syncServerTime({ fetch: server().fetch, url: 'https://example.test/' });
    const learnt = serverNow() - Date.now();
    const failing = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof globalThis.fetch;
    await syncServerTime({ fetch: failing, url: 'https://example.test/' });
    expect(serverNow() - Date.now()).toBe(learnt);
  });

  it('gives up on a server that does not answer in time', async () => {
    deviceClock(0);
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as unknown as typeof globalThis.fetch;
    const result = syncServerTime({ fetch: hanging, url: 'https://example.test/', timeoutMs: 50 });
    vi.advanceTimersByTime(50);
    expect(await result).toBe(false);
  });
});

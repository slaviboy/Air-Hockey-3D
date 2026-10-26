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

// The time the two players' devices agree on, for finding each other through the relays.
//
// The relays compare the times signals are stamped with, so a device whose clock is wrong (set by
// hand, drifted, or hours off) is not heard. Before an online game the page asks the site that
// served it for the time, from the Date header of a request for the page itself: nobody new learns
// anything, and both players end up on the same clock, whatever their own say. Trystero's Nostr
// strategy stamps and filters its signals with serverNow() (see scripts/trystero-clock-skew.ts).
// Time zones play no part: these are milliseconds since the epoch, the same everywhere.

/** How long to wait for the server before keeping this device's own clock. */
export const SYNC_TIMEOUT_MS = 4_000;

export interface SyncOptions {
  readonly fetch?: typeof fetch;
  /** The address to ask; the page itself by default. */
  readonly url?: string;
  readonly timeoutMs?: number;
}

/** How far the server's clock is ahead of this device's, once known. */
let offsetMs = 0;
let syncing: Promise<boolean> | null = null;

/** Milliseconds since the epoch by the server's clock, as well as it is known. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/**
 * Learns how far this device's clock is off. Resolves true when the server answered; never throws,
 * and on failure keeps what was known before (at first, this device's own clock).
 */
export function syncServerTime(options: SyncOptions = {}): Promise<boolean> {
  syncing ??= measure(options)
    .then((offset) => {
      if (offset === null) return false;
      offsetMs = offset;
      return true;
    })
    .finally(() => (syncing = null));
  return syncing;
}

/** Forgets what was learnt, for tests. */
export function resetServerTime(): void {
  offsetMs = 0;
  syncing = null;
}

async function measure(options: SyncOptions): Promise<number | null> {
  const get = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const url = options.url ?? globalThis.location?.href.split('#')[0];
  if (!get || !url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SYNC_TIMEOUT_MS);
  try {
    const sent = Date.now();
    const response = await get(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    const received = Date.now();
    const server = Date.parse(response.headers.get('Date') ?? '');
    if (!Number.isFinite(server)) return null;
    // The header counts whole seconds, so the server's moment lies somewhere in that second; the
    // answer left it about halfway through the round trip.
    return server + 500 - (sent + received) / 2;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

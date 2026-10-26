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

// The first of the honest player's checks on everything the other browser sends: size, rate and
// shape. Oversized, too frequent or malformed data is dropped and counted; a peer that keeps it up
// is disconnected. The session's rules and the game's rules come after this. The guard knows no
// game: it is given the function that recognises a well-formed message.

import { MAX_MESSAGE_BYTES } from './protocol.ts';

export interface GuardLimits {
  readonly maxBytes: number;
  /** Messages a second, on average. */
  readonly perSecond: number;
  /** Messages allowed in a quick burst. */
  readonly burst: number;
  /** Dropped messages tolerated before the peer is disconnected. */
  readonly maxDrops: number;
}

/**
 * Twenty a second on average suits a game of turns (the sister games' previews come at most eight
 * a second) with everything else; a burst of forty covers a reconnect, when several messages cross
 * at once. A game that streams its play, as air hockey does, gives the session its own limits.
 */
export const DEFAULT_LIMITS: GuardLimits = {
  maxBytes: MAX_MESSAGE_BYTES,
  perSecond: 20,
  burst: 40,
  maxDrops: 20,
};

export type DropReason = 'size' | 'rate' | 'shape';

export type Verdict<T> =
  | { readonly ok: true; readonly message: T }
  | { readonly ok: false; readonly reason: DropReason; readonly disconnect: boolean };

const encoder = new TextEncoder();

export class PeerGuard<T> {
  private tokens: number;
  private last: number;
  private dropped = 0;

  constructor(
    /** The message, if the data is exactly one of the accepted shapes; null otherwise. */
    private readonly parse: (data: unknown) => T | null,
    private readonly now: () => number = () => performance.now(),
    private readonly limits: GuardLimits = DEFAULT_LIMITS,
  ) {
    this.tokens = limits.burst;
    this.last = now();
  }

  /** How many messages have been dropped so far. */
  get drops(): number {
    return this.dropped;
  }

  /** Lets a message through, or says why it was dropped and whether to give up on the peer. */
  check(data: unknown): Verdict<T> {
    if (!this.take()) return this.drop('rate');
    if (this.size(data) > this.limits.maxBytes) return this.drop('size');
    const message = this.parse(data);
    return message ? { ok: true, message } : this.drop('shape');
  }

  /** A token bucket: refills at the average rate, holds at most a burst. */
  private take(): boolean {
    const now = this.now();
    const refill = ((now - this.last) / 1000) * this.limits.perSecond;
    this.tokens = Math.min(this.limits.burst, this.tokens + refill);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** The message's size as JSON in bytes; Infinity for anything that is not plain data. */
  private size(data: unknown): number {
    if (typeof data !== 'object' || data === null) return Infinity;
    try {
      const json = JSON.stringify(data);
      // A quick bound before encoding: a UTF-8 byte count is never below the string length.
      if (json.length > this.limits.maxBytes) return Infinity;
      return encoder.encode(json).length;
    } catch {
      return Infinity;
    }
  }

  private drop(reason: DropReason): Verdict<T> {
    this.dropped++;
    return { ok: false, reason, disconnect: this.dropped >= this.limits.maxDrops };
  }
}

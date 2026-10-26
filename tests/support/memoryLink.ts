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

// Two ends of a connection in memory, for session tests: messages cross asynchronously, as JSON
// would. sendRaw lets a test speak as a modified client and send anything at all.

import type { LinkHandlers, LinkPort } from '../../src/net/LinkPort.ts';
import type { WireMessage } from '../../src/net/protocol.ts';

const NONE: LinkHandlers = {
  message: () => undefined,
  join: () => undefined,
  leave: () => undefined,
  error: () => undefined,
};

export class MemoryLink implements LinkPort {
  other: MemoryLink | null = null;
  handlers: LinkHandlers = NONE;
  connected = false;
  closed = false;
  kicked = false;
  rtt = 40;
  /** Everything this end sent, in order. */
  readonly sent: unknown[] = [];
  /** While set, what this end sends is lost on the way (a connection dropping mid-message). */
  losing = false;

  setHandlers(handlers: LinkHandlers): void {
    this.handlers = handlers;
  }

  async send(message: WireMessage): Promise<void> {
    this.sendRaw(JSON.parse(JSON.stringify(message)));
  }

  /** Sends any data, unchecked, as a modified client could. */
  sendRaw(data: unknown): void {
    if (!this.connected || this.closed || !this.other) return;
    this.sent.push(data);
    if (this.losing) return;
    const peer = this.other;
    // Once sent, a message arrives even if the sender closes straight after.
    void Promise.resolve().then(() => {
      if (!peer.closed) peer.handlers.message(data);
    });
  }

  /** The messages of one type this end sent. */
  sentOf(type: string): Record<string, unknown>[] {
    return this.sent.filter(
      (m): m is Record<string, unknown> => (m as { t?: unknown } | null)?.t === type,
    );
  }

  /** Tracks this end is sending. */
  readonly tracks = new Map<MediaStreamTrack, MediaStream>();

  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    this.tracks.set(track, stream);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks.delete(track);
  }

  ping(): Promise<number> {
    return this.connected ? Promise.resolve(this.rtt) : Promise.reject(new Error('not connected'));
  }

  kick(): void {
    this.kicked = true;
    if (this.other) unplug(this, this.other);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.other) unplug(this, this.other);
  }
}

/** Connects two ends: each hears that the other joined. */
export function plug(a: MemoryLink, b: MemoryLink): void {
  a.other = b;
  b.other = a;
  a.connected = true;
  b.connected = true;
  void Promise.resolve().then(() => {
    a.handlers.join();
    b.handlers.join();
  });
}

/** Drops the connection: each end that was connected hears that the other left. */
export function unplug(a: MemoryLink, b: MemoryLink): void {
  for (const [end, other] of [
    [a, b],
    [b, a],
  ] as const) {
    if (!end.connected || end.other !== other) continue;
    end.connected = false;
    end.other = null;
    if (!end.closed) void Promise.resolve().then(() => end.handlers.leave());
  }
}

/**
 * Lets every pending message and handler run. Each round lets the promise callbacks queued so far
 * run; setImmediate rather than a zero timeout, which some systems round up to a 15 ms tick.
 */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

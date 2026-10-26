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

// What an online session needs from the connection to the other player. PeerLink provides it over
// WebRTC; tests use an in-memory pair. A link talks to one other player at a time: whoever else
// turns up with the link is turned away.

import type { WireMessage } from './protocol.ts';

export interface LinkHandlers {
  /** Data from the other player, exactly as received: untrusted until the guard has seen it. */
  message(data: unknown): void;
  /** The other player connected, for the first time or again. */
  join(): void;
  /** The other player's connection dropped. */
  leave(): void;
  /** No connection could be made; the text is for the player. */
  error(text: string): void;
  /** A camera or microphone track from the other player. */
  track?(track: MediaStreamTrack, stream: MediaStream): void;
}

export interface LinkPort {
  /** True while the other player is connected. */
  readonly connected: boolean;
  setHandlers(handlers: LinkHandlers): void;
  /** Resolves once the message is on its way (it may still be lost if the connection drops). */
  send(message: WireMessage): Promise<void>;
  /** The round trip to the other player in milliseconds. */
  ping(): Promise<number>;
  /** Sends a local camera or microphone track to the other player, now and after a reconnect. */
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  /** Stops sending a track. */
  removeTrack(track: MediaStreamTrack): void;
  /** Drops the other player for good: they cannot come back on this link. */
  kick(): void;
  close(): Promise<void>;
}

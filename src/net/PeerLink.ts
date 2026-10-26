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

// The connection to the other player: a direct WebRTC link, found through public Nostr relays by
// Trystero. This is the only file that touches Trystero or a peer connection.
//
// The invitation's secret is Trystero's password: it encrypts the handshake, so the relays and
// anyone without the link see neither the offer nor the network addresses in it, and it must match
// for a peer to be let in. The first player admitted is the partner; anyone else is refused at the
// handshake, and messages from anyone but the partner are ignored. The room and its peer
// connections stay private to this module: nothing here is put on window or logged.

import { joinRoom, selfId, type JsonValue, type MessageAction, type Room } from 'trystero/nostr';
import type { LinkHandlers, LinkPort } from './LinkPort.ts';
import { MAX_MESSAGE_BYTES, type Invite, type WireMessage } from './protocol.ts';

const APP_ID = 'air-hockey-slaviboy';
/** Trystero's own ceiling for anything a peer sends, well above our largest message. */
const MAX_RECEIVE_BYTES = 16 * 1024;
/**
 * How long the side that does not lead lets the connection be quiet before changing its media:
 * long enough for an offer the leader made at the same moment to arrive first.
 */
const SETTLE_MS = 1000;

const NO_HANDLERS: LinkHandlers = {
  message: () => undefined,
  join: () => undefined,
  leave: () => undefined,
  error: () => undefined,
};

/** Joins the invitation's room (see roomFor) and starts looking for the other player. */
export function openPeerLink(invite: Invite, room: string): LinkPort {
  return new PeerLink(invite, room);
}

class PeerLink implements LinkPort {
  private readonly room: Room;
  private readonly channel: MessageAction<JsonValue>;
  private handlers: LinkHandlers = NO_HANDLERS;
  private partner: string | null = null;
  /** Peers turned away for good: a kicked partner, or a second player. */
  private readonly refused = new Set<string>();
  /** The local camera and microphone tracks being sent, to send again after a reconnect. */
  private readonly tracks = new Map<MediaStreamTrack, MediaStream>();
  /** Changes not yet made on the connection: a track to send with its stream, or null to stop. */
  private readonly changes = new Map<MediaStreamTrack, MediaStream | null>();
  private changeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the negotiation last changed state, or this side last asked to change its media. */
  private quietSince = 0;
  /** Detaches the listener from the current connection. */
  private watching: AbortController | null = null;
  private closed = false;

  constructor(invite: Invite, room: string) {
    this.room = joinRoom(
      { appId: APP_ID, password: invite.secret, maxReceiveBytes: MAX_RECEIVE_BYTES },
      room,
      {
        onJoinError: ({ error }) => this.handlers.error(friendlyError(error)),
        onPeerHandshake: async (peerId) => {
          if (this.refused.has(peerId) || (this.partner !== null && this.partner !== peerId)) {
            throw new Error('the game already has two players');
          }
        },
      },
    );
    this.channel = this.room.makeAction<JsonValue>('m', {
      // Refuse anything from a stranger, or too big, before it is even read.
      onReceive: ({ peerId, byteLength }) =>
        peerId === this.partner && byteLength <= MAX_MESSAGE_BYTES,
      onMessage: (data, { peerId }) => {
        if (peerId === this.partner) this.handlers.message(data);
      },
    });
    this.room.onPeerJoin = (peerId) => {
      if (this.refused.has(peerId) || (this.partner !== null && this.partner !== peerId)) {
        this.disconnect(peerId);
        return;
      }
      this.partner = peerId;
      this.watch(peerId);
      // A new connection carries nothing yet: everything being sent goes again.
      this.changes.clear();
      for (const [track, stream] of this.tracks) this.changes.set(track, stream);
      this.applyChanges();
      this.handlers.join();
    };
    this.room.onPeerLeave = (peerId) => {
      if (peerId !== this.partner) return;
      this.partner = null;
      this.unwatch();
      this.handlers.leave();
    };
    this.room.onPeerTrack = (track, stream, peerId) => {
      if (peerId === this.partner) this.handlers.track?.(track, stream);
    };
  }

  get connected(): boolean {
    return this.partner !== null;
  }

  setHandlers(handlers: LinkHandlers): void {
    this.handlers = handlers;
  }

  send(message: WireMessage): Promise<void> {
    if (!this.partner || this.closed) return Promise.resolve();
    // Sending can fail if the connection drops mid-way; the session notices through leave().
    return this.channel
      .send(message as unknown as JsonValue, { target: this.partner })
      .catch(() => undefined);
  }

  ping(): Promise<number> {
    return this.partner ? this.room.ping(this.partner) : Promise.reject(new Error('not connected'));
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): void {
    this.tracks.set(track, stream);
    this.changes.set(track, stream);
    this.quietSince = performance.now();
    this.applyChanges();
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks.delete(track);
    // A track still waiting to be sent is simply never sent.
    if (this.changes.get(track)) this.changes.delete(track);
    else this.changes.set(track, null);
    this.quietSince = performance.now();
    this.applyChanges();
  }

  kick(): void {
    const partner = this.partner;
    if (!partner) return;
    this.refused.add(partner);
    this.partner = null;
    this.unwatch();
    this.disconnect(partner);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.partner = null;
    this.unwatch();
    this.handlers = NO_HANDLERS;
    await this.room.leave();
  }

  /** Follows the connection's negotiation, to know when it is settled. */
  private watch(peerId: string): void {
    this.unwatch();
    const watching = new AbortController();
    this.watching = watching;
    this.quietSince = performance.now();
    this.room.getPeers()[peerId]?.addEventListener(
      'signalingstatechange',
      () => {
        this.quietSince = performance.now();
        this.applyChanges();
      },
      { signal: watching.signal },
    );
  }

  private unwatch(): void {
    this.watching?.abort();
    this.watching = null;
    if (this.changeTimer !== null) clearTimeout(this.changeTimer);
    this.changeTimer = null;
  }

  /**
   * Makes the waiting camera and microphone changes. Each one makes this side renegotiate the
   * connection, and if both sides do so at once (both cameras turned on together, or both sending
   * theirs again after a reconnect) their offers collide. The way out of that, one side taking its
   * offer back, can leave that side's picture of the other muted for good, or fail and drop the
   * connection, which then happens again on every reconnect. So changes wait until the negotiation
   * is settled, and the side that does not lead (Trystero's own order: the lower id leads, and
   * keeps its offer in a collision) waits until it has been quiet a while, so the leader goes first.
   */
  private applyChanges(): void {
    if (this.changeTimer !== null) clearTimeout(this.changeTimer);
    this.changeTimer = null;
    const partner = this.partner;
    if (!partner || this.closed || this.changes.size === 0) return;
    const connection = this.room.getPeers()[partner];
    // The next change of state tries again.
    if (!connection || connection.signalingState !== 'stable') return;
    const wait = selfId < partner ? 0 : this.quietSince + SETTLE_MS - performance.now();
    if (wait > 0) {
      this.changeTimer = setTimeout(() => this.applyChanges(), wait);
      return;
    }
    for (const [track, stream] of this.changes) {
      if (stream) void Promise.allSettled(this.room.addTrack(track, stream, { target: partner }));
      else this.room.removeTrack(track, { target: partner });
    }
    this.changes.clear();
  }

  private disconnect(peerId: string): void {
    this.refused.add(peerId);
    this.room.getPeers()[peerId]?.close();
  }
}

/** Trystero's errors name peers and servers; the player gets a plain explanation instead. */
function friendlyError(error: string): string {
  if (/password/i.test(error)) return 'This link does not match the game. Ask for a new link.';
  return (
    "Couldn't connect directly to your friend. Some networks, such as mobile data or office " +
    'Wi-Fi, block direct connections; try another network.'
  );
}

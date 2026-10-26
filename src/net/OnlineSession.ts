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

// An online match between two browsers. The host made the link and sets the terms; the guest
// opened it. Nothing in between referees, so each side referees what it receives: the guard checks
// size, rate and shape, this session checks who may say what and when, and the game (through its
// GamePort) checks the play itself. A player who breaks the rules forfeits on the honest side, and
// is disconnected. The session knows no game: 8-ball plugs in through src/game/GamePort.ts.
//
// Identity: when the guest first arrives the host gives it a random token over the encrypted
// connection. Whoever comes back later must show the same token, in both directions, so a stranger
// holding a leaked link can neither take the guest's seat nor pose as the host.
//
// Keeping in step: each side simulates every shot and compares its table's fingerprint with the
// shooter's. When they differ, play stops on both sides and the host's table is sent over (a
// sync); the guest takes it. More than MAX_DESYNCS times in one session and the session ends, with
// nobody losing. A guest that comes back gets the host's table the same way, and sends its own last
// action again if the host never heard it.

import { Store } from '../core/Store.ts';
import type { LinkPort } from './LinkPort.ts';
import { OnlineMedia, type MediaOptions } from './OnlineMedia.ts';
import { PeerGuard, type Verdict } from './PeerGuard.ts';
import {
  PROTOCOL_VERSION,
  SESSION_TYPES,
  cleanName,
  createToken,
  parseMessage,
  setupMessage,
  type GameCodec,
  type Invite,
  type SessionMessage,
  type WireMessage,
} from './protocol.ts';

/** The most network delay allowed for on the other player's shot clock. */
export const MAX_LAG_ALLOWANCE_MS = 1000;
/** How long a guest looks for the game before giving up. */
export const CONNECT_TIMEOUT_MS = 45_000;
/** How long the other player may be away before the win can be claimed. */
export const CLAIM_AFTER_MS = 120_000;
export const PING_EVERY_MS = 3_000;
/** Tables found different in one session before it ends (the next one ends it). */
export const MAX_DESYNCS = 3;
/** How long a leaving player waits for the goodbye to cross before closing the connection. */
const LEAVE_GRACE_MS = 250;
/** How long one side waits for the other to answer while their tables are brought in step. */
export const STEP_TIMEOUT_MS = 15_000;
/** A game's table at rest travels as its message of this type. */
export const SYNC_TYPE = 'sync';
/** What the host is told when the friend's attempt fails; the link stays open. */
export const HOST_RETRY_MESSAGE =
  "Your friend couldn't connect. Some networks, such as mobile data or office Wi-Fi, block " +
  'direct connections. The link still works: they can open it again, maybe on another network.';
export const RELOAD_MESSAGE =
  'You and your friend have different versions of the game. Both of you should reload the ' +
  'page; then the host can send a new link.';
export const OUT_OF_STEP_MESSAGE =
  'Your two games kept seeing a different table, so the match was stopped. Nobody loses it.';

export type Role = 'host' | 'guest';

export type OnlineStatus =
  /** The host made the link; nobody has come yet. */
  | 'waiting'
  /** The guest is looking for the game, or the two are setting up. */
  | 'connecting'
  | 'playing'
  /** The other player's connection dropped; they may come back. */
  | 'away'
  /** No connection could be made. */
  | 'failed'
  /** Over: someone left, or broke the rules. */
  | 'closed';

export interface OnlineState {
  readonly role: Role;
  readonly status: OnlineStatus;
  readonly myName: string;
  readonly friendName: string;
  readonly rematch: 'none' | 'sent' | 'received';
  /** The other player has been away long enough for the win to be claimed. */
  readonly canClaimWin: boolean;
  /** The other player's microphone and camera, as they report them. */
  readonly friendMedia: { readonly mic: boolean; readonly cam: boolean } | null;
  /** The last round trip to the other player, in milliseconds. */
  readonly ping: number | null;
  /** How many times the two tables have been found different. */
  readonly desyncs: number;
  /** Play waits while the two tables are brought back in step. */
  readonly resyncing: boolean;
  /** Why the session failed or closed, for the player. */
  readonly message: string | null;
}

export type ForfeitReason =
  /** The other player gave up. */
  | 'resigned'
  /** The other player left, or stayed away too long. */
  | 'abandoned'
  /** The other player's app sent play the rules do not allow. */
  | 'invalid-shot'
  /** The other player's app sent something that is not a message of the game. */
  | 'invalid-data'
  /** The other player's app did not keep its own shot clock. */
  | 'stalled';

export type SessionEvent =
  | { readonly kind: 'joined' }
  | { readonly kind: 'returned' }
  | { readonly kind: 'away' }
  | { readonly kind: 'rematchOffered' }
  | { readonly kind: 'rematchStarted' }
  | { readonly kind: 'resigned' }
  | { readonly kind: 'left' }
  | { readonly kind: 'resynced' }
  | { readonly kind: 'outOfStep' }
  | { readonly kind: 'violation'; readonly reason: ForfeitReason; readonly detail: string }
  | { readonly kind: 'failed'; readonly text: string };

/** What the game made of a message from the other player. */
export type Receipt =
  /** It changed the match. */
  | { readonly kind: 'played' }
  /** It only showed something (a preview), or came too late to matter: nothing changed. */
  | { readonly kind: 'shown' }
  /** The rules do not allow it: the other side forfeits. */
  | { readonly kind: 'violation'; readonly detail: string }
  /** It was played, and this side's table came out different from the sender's after shot n. */
  | { readonly kind: 'desync'; readonly n: number };

/** Why a table is being restored: from this tab's storage, a rejoin, or after a desync. */
export type RestoreReason = 'saved' | 'rejoin' | 'resync';
/**
 * same: it is this side's table already; resent: it is this side's table before its own last
 * action, which has been sent again; restored: it replaced this side's table; rejected: it could
 * not be a table of this match.
 */
export type Restored = 'same' | 'resent' | 'restored' | 'rejected';

/** none: no match yet; playing: a match in progress; over: it has a winner. */
export type GameStatus = 'none' | 'playing' | 'over';

export interface GameListener<M> {
  /** A message the local player's play produced; `changesMatch` is false for a mere preview. */
  send(message: M, changesMatch: boolean): void;
  /**
   * The other player's app broke a rule no single message shows (a shot clock it did not keep).
   * The session acts on it after the messages already received, and only if `stillTrue` (when
   * given) says it still holds then: the awaited message may have been on its way.
   */
  violation(reason: ForfeitReason, detail: string, stillTrue?: () => boolean): void;
}

/** What the session needs from the game. */
export interface GamePort<M extends WireMessage, S> {
  /** Starts a fresh match on these terms; `role` tells which seat is this device's. */
  start(terms: S, role: Role): Promise<void>;
  /** The terms of the rematch after a match on `terms` (the same on both sides). */
  rematchTerms(terms: S): S;
  /** Hears the local player's play; returns an unsubscribe. */
  onLocal(listener: GameListener<M>): () => void;
  /** A game message from the other player, already checked for shape. */
  receive(message: M): Promise<Receipt>;
  /** The table at rest as a message of type SYNC_TYPE, or null before a match. */
  snapshot(): M | null;
  /** Takes a table at rest (a message of type SYNC_TYPE). */
  restore(message: M, why: RestoreReason): Promise<Restored>;
  status(): GameStatus;
  /** The local player gives up the match. */
  resign(): Promise<void>;
  /** The other player loses the match. */
  forfeit(reason: ForfeitReason): Promise<void>;
  /** The network delay to allow for on the other player's clock. */
  setLagAllowance(ms: number): void;
  /** Stops (or lets resume) the local player's play: the other player is away, or out of step. */
  hold(on: boolean): void;
}

export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const browserTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** What a session keeps for this tab only, so a player who reloads can rejoin. */
export interface SavedSession<M, S> {
  readonly invite: Invite;
  readonly role: Role;
  readonly token: string | null;
  readonly name: string;
  readonly friendName: string;
  readonly terms: S | null;
  /** The table at rest when it was saved (a message of type SYNC_TYPE). */
  readonly state: M | null;
}

export interface SessionStorage<M, S> {
  save(session: SavedSession<M, S>): void;
  clear(): void;
}

interface CommonOptions<M extends WireMessage, S> {
  readonly link: LinkPort;
  readonly port: GamePort<M, S>;
  readonly codec: GameCodec<M, S>;
  readonly invite: Invite;
  readonly name: string;
  /** This copy's build: both players must have the same one. */
  readonly build: string;
  readonly timers?: Timers;
  readonly now?: () => number;
  readonly storage?: SessionStorage<M, S>;
  /** Camera and microphone access; tests pass stand-ins. */
  readonly media?: MediaOptions;
}

export interface HostOptions<M extends WireMessage, S> extends CommonOptions<M, S> {
  /** The terms of the match, made once the guest's name is known. */
  readonly terms: (friendName: string) => S;
}

export type GuestOptions<M extends WireMessage, S> = CommonOptions<M, S>;

type Hello = Extract<SessionMessage<unknown>, { t: 'hello' }>;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export class OnlineSession<M extends WireMessage, S extends object> {
  readonly state: Store<OnlineState>;
  readonly invite: Invite;
  /** Video and voice for this game; everything starts off. */
  readonly media: OnlineMedia;
  private readonly link: LinkPort;
  private readonly port: GamePort<M, S>;
  private readonly guard: PeerGuard<SessionMessage<S> | M>;
  private readonly timers: Timers;
  private readonly storage: SessionStorage<M, S> | null;
  private readonly build: string;
  private readonly makeTerms: ((friendName: string) => S) | null;
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  private readonly offLocal: () => void;
  /** The shared secret between host and guest; null until the host has handed it out. */
  private token: string | null;
  /** The match's terms, once set (they change with each rematch). */
  private terms: S | null;
  /** A match has been set up on this device. */
  private started = false;
  /** The connected peer has shown who they are; nothing else is accepted before that. */
  private verified = false;
  /** Incoming messages are handled one at a time, in order. */
  private queue: Promise<void> = Promise.resolve();
  private lags: number[] = [];
  private pingTimer: unknown = null;
  private connectTimer: unknown = null;
  private claimTimer: unknown = null;
  private stepTimer: unknown = null;
  private ended = false;
  /** The session is about to close (the tables kept differing): nothing more is taken in. */
  private closing = false;
  /** Tracks that arrived before the other player showed who they are. */
  private heldTracks: MediaStreamTrack[] = [];
  /** A guest that came back waits for the host's table before it plays on. */
  private expectSync = false;
  /** A guest waiting for the host's table after the two disagreed. */
  private awaitingSync = false;
  /** A host that found the tables different, waiting for the guest to stop (its shot index). */
  private pendingDesync: number | null = null;
  /** A guest's own table from this tab's storage, taken once the host has set up the match. */
  private savedState: M | null;

  /** The player who made the link; the match starts when the guest arrives. */
  static host<M extends WireMessage, S extends object>(
    options: HostOptions<M, S>,
  ): OnlineSession<M, S> {
    return new OnlineSession<M, S>('host', options, options.terms, null);
  }

  /** The player who opened a link. */
  static join<M extends WireMessage, S extends object>(
    options: GuestOptions<M, S>,
  ): OnlineSession<M, S> {
    return new OnlineSession<M, S>('guest', options, null, null);
  }

  /** Picks up a game this tab was playing before a reload. */
  static resume<M extends WireMessage, S extends object>(
    saved: SavedSession<M, S>,
    options: Omit<CommonOptions<M, S>, 'invite' | 'name'> & { readonly name?: string },
  ): OnlineSession<M, S> {
    const terms = saved.terms;
    return new OnlineSession<M, S>(
      saved.role,
      { ...options, invite: saved.invite, name: options.name ?? saved.name },
      saved.role === 'host' && terms ? () => terms : null,
      saved,
    );
  }

  private constructor(
    readonly role: Role,
    options: CommonOptions<M, S>,
    makeTerms: ((friendName: string) => S) | null,
    saved: SavedSession<M, S> | null,
  ) {
    this.link = options.link;
    this.port = options.port;
    this.invite = options.invite;
    this.build = options.build;
    this.makeTerms = makeTerms;
    this.timers = options.timers ?? browserTimers;
    this.storage = options.storage ?? null;
    const codec = options.codec;
    this.guard = new PeerGuard((data) => parseMessage(data, codec), options.now);
    this.token = saved?.token ?? null;
    this.terms = saved?.terms ?? null;
    this.savedState = saved?.state ?? null;
    this.state = new Store<OnlineState>({
      role,
      status: role === 'host' && !saved?.token ? 'waiting' : 'connecting',
      myName: cleanName(options.name, 'Player'),
      friendName: saved?.friendName ?? 'Friend',
      rematch: 'none',
      canClaimWin: false,
      friendMedia: null,
      ping: null,
      desyncs: 0,
      resyncing: false,
      message: null,
    });
    this.media = new OnlineMedia(this.link, {
      ...options.media,
      onLocalChange: (mic, cam) => void this.link.send({ t: 'media', mic, cam } as WireMessage),
    });
    this.offLocal = this.port.onLocal({
      send: (message, changesMatch) => this.sendGame(message, changesMatch),
      violation: (reason, detail, stillTrue) =>
        this.enqueue(() =>
          !stillTrue || stillTrue() ? this.violation(reason, detail) : undefined,
        ),
    });
    this.link.setHandlers({
      message: (data) => this.onData(data),
      track: (track) => {
        if (this.verified) this.media.receive(track);
        else this.heldTracks.push(track);
      },
      join: () => this.enqueue(() => this.onJoin()),
      leave: () => this.enqueue(() => this.onLeave()),
      error: (text) => this.onError(text),
    });
    // A host that reloads picks its own match back up; the guest waits for the host's copy.
    if (role === 'host' && saved?.token && saved.terms) {
      const { terms, state } = saved;
      this.enqueue(async () => {
        await this.port.start(terms, 'host');
        if (state) await this.port.restore(state, 'saved');
        this.started = true;
        this.port.hold(true);
        this.patch({ status: 'away' });
      });
    }
    if (role === 'guest') this.armConnectTimer();
  }

  /** Hears what happens: arrivals, offers, rule breaks. Returns an unsubscribe. */
  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get closed(): boolean {
    return this.ended;
  }

  /** Whether a match has been set up on this device. */
  get matchStarted(): boolean {
    return this.started;
  }

  // --- the player's commands -----------------------------------------------------------------

  /** Asks for a rematch after a finished match, or accepts the one asked for. */
  async requestRematch(): Promise<void> {
    if (this.ended || !this.started || this.port.status() !== 'over') return;
    const { rematch } = this.state.get();
    if (rematch === 'sent') return;
    void this.link.send({ t: 'rematch' });
    if (rematch === 'received') await this.beginRematch();
    else this.patch({ rematch: 'sent' });
  }

  /** Takes the win from a player who has been gone too long. */
  async claimWin(): Promise<void> {
    if (!this.state.get().canClaimWin || this.port.status() !== 'playing') return;
    this.patch({ canClaimWin: false });
    await this.port.forfeit('abandoned');
    // The other player cannot be told, and coming back would bring their table back with them:
    // the session ends here, the win with it.
    const name = this.state.get().friendName;
    await this.close('closed', `${name} stayed away, and you claimed the win.`);
  }

  /**
   * Gives up the match in progress; the session stays open for a rematch. Only while the other
   * player is there to hear it: their table would undo it when they came back.
   */
  async resign(): Promise<void> {
    if (this.ended || !this.started || this.port.status() !== 'playing') return;
    if (this.state.get().status !== 'playing') return;
    await this.port.resign();
    void this.link.send({ t: 'resign' });
    this.save();
  }

  /** Leaves: resigns a match in progress, says goodbye and closes the connection. */
  async leave(): Promise<void> {
    if (this.ended) return;
    if (this.started && this.port.status() === 'playing') await this.port.resign();
    await this.link.send({ t: 'bye' });
    // A moment for the goodbye to cross before the connection closes.
    await new Promise<void>((resolve) => this.timers.setTimeout(resolve, LEAVE_GRACE_MS));
    await this.close('closed', null);
  }

  /** Stops everything without a word to the other side (the page is going away). */
  dispose(): void {
    this.stopTimers();
    this.offLocal();
    this.dropHeldTracks();
    this.media.stop();
    this.listeners.clear();
    if (!this.ended) {
      this.ended = true;
      void this.link.close();
    }
  }

  // --- the connection ------------------------------------------------------------------------

  private enqueue(step: () => Promise<void> | void): void {
    this.queue = this.queue.then(step).catch((error: unknown) => console.error('online:', error));
  }

  private onJoin(): void {
    if (this.ended) return;
    this.verified = false;
    this.dropHeldTracks();
    this.clearTimer('claimTimer');
    this.patch({ canClaimWin: false });
    // The host proves itself with the token too, once it has given one out.
    const proof = this.role === 'guest' || this.started ? this.token : null;
    void this.link.send({
      t: 'hello',
      v: PROTOCOL_VERSION,
      build: this.build,
      name: this.state.get().myName,
      ...(proof ? { token: proof } : {}),
    } as WireMessage);
    this.startPings();
  }

  private onLeave(): void {
    if (this.ended) return;
    this.verified = false;
    this.expectSync = false;
    // The waits for a table start again when the other player is back.
    this.clearTimer('stepTimer');
    this.dropHeldTracks();
    this.stopPings();
    if (!this.started) {
      // Dropped before the match was set up: the guest gets a fresh while to find it again.
      if (this.role === 'guest') this.armConnectTimer();
      this.patch({ status: this.role === 'host' ? 'waiting' : 'connecting' });
      return;
    }
    this.port.hold(true);
    this.patch({ status: 'away' });
    this.emit({ kind: 'away' });
    if (this.port.status() === 'playing') {
      this.claimTimer = this.timers.setTimeout(() => {
        if (this.state.get().status === 'away' && this.port.status() === 'playing') {
          this.patch({ canClaimWin: true });
        }
      }, CLAIM_AFTER_MS);
    }
  }

  private onError(text: string): void {
    if (this.ended || this.started) return;
    // The host keeps the link open, so the friend can simply try again.
    if (this.role === 'host') {
      this.patch({ message: HOST_RETRY_MESSAGE });
      return;
    }
    this.fail(text);
  }

  /**
   * Data from the other player, checked by the guard as it arrives (so its rate is the rate it
   * was sent at, however long earlier messages take), then handled in turn.
   */
  private onData(data: unknown): void {
    if (this.ended || this.closing) return;
    const verdict = this.guard.check(data);
    this.enqueue(() => this.onMessage(verdict));
  }

  private async onMessage(verdict: Verdict<SessionMessage<S> | M>): Promise<void> {
    if (this.ended || this.closing) return;
    if (!verdict.ok) {
      if (verdict.disconnect) await this.violation('invalid-data', 'kept sending invalid data');
      return;
    }
    const message = verdict.message;
    if (!SESSION_TYPES.includes(message.t)) {
      if (this.verified) await this.onGame(message as M);
      return;
    }
    const session = message as SessionMessage<S>;
    if (session.t === 'hello') return this.onHello(session);
    // Nothing counts from a peer that has not shown who they are.
    if (!this.verified) return;
    switch (session.t) {
      case 'setup':
        return this.onSetup(session.token, session.terms);
      case 'desync':
        return this.onDesync(session.n);
      case 'resign':
        return this.onResign();
      case 'rematch':
        return this.onRematch();
      case 'media':
        this.patch({ friendMedia: { mic: session.mic, cam: session.cam } });
        return;
      case 'bye':
        return this.onBye();
    }
  }

  private async onHello(message: Hello): Promise<void> {
    if (this.verified) return;
    const proven = this.token !== null && message.token === this.token;
    // Once the host has handed out the token, only the one who holds it counts, in both
    // directions; anyone else is turned away before anything they say is weighed.
    const host = this.role === 'host';
    if (this.token && !proven) {
      this.dropHeldTracks();
      this.link.kick();
      return;
    }
    if (message.v !== PROTOCOL_VERSION || message.build !== this.build) {
      // Not a rule break: an older or newer copy of the game, which might not play the same.
      this.dropHeldTracks();
      this.emit({ kind: 'failed', text: RELOAD_MESSAGE });
      await this.close('failed', RELOAD_MESSAGE);
      return;
    }
    if (host) {
      this.trust();
      const first = this.token === null;
      if (first) {
        this.token = createToken();
        this.patch({ friendName: message.name });
      }
      this.terms ??= this.makeTerms!(this.state.get().friendName);
      void this.link.send(setupMessage(this.token!, this.terms));
      if (!this.started) {
        await this.port.start(this.terms, 'host');
        this.started = true;
      } else {
        // The guest may have been away while this side played on: here is the table.
        const snapshot = this.port.snapshot();
        if (snapshot) void this.link.send(snapshot);
      }
      this.pendingDesync = null;
      this.clearTimer('stepTimer');
      this.port.hold(false);
      this.patch({ status: 'playing', message: null, resyncing: false });
      this.emit({ kind: first ? 'joined' : 'returned' });
      this.save();
      return;
    }
    this.trust();
    if (!this.token) this.patch({ friendName: message.name });
    // A guest that has played with this host before takes the host's table before going on.
    this.expectSync = this.token !== null;
    if (this.expectSync) this.watchStep();
    if (this.started) {
      this.patch({ status: 'playing', message: null });
      this.emit({ kind: 'returned' });
    }
  }

  private async onSetup(token: string, terms: S): Promise<void> {
    // Only the host sets the terms, once; later setups (a rejoin repeats them) change nothing.
    if (this.role !== 'guest' || this.started) return;
    if (this.token && token !== this.token) return;
    this.token = token;
    this.terms = terms;
    await this.port.start(terms, 'guest');
    const saved = this.savedState;
    this.savedState = null;
    if (saved) await this.port.restore(saved, 'saved');
    this.started = true;
    this.clearTimer('connectTimer');
    // A guest that came back plays on once it has the host's table.
    this.port.hold(this.expectSync);
    this.patch({ status: 'playing', message: null });
    this.emit({ kind: 'joined' });
    this.save();
  }

  private async onGame(message: M): Promise<void> {
    if (!this.started) return;
    if (message.t === SYNC_TYPE) return this.onSync(message);
    // Play from before the two tables were brought back in step counts for nothing.
    if (this.awaitingSync || this.pendingDesync !== null || this.expectSync) return;
    const receipt = await this.port.receive(message);
    switch (receipt.kind) {
      case 'played':
        return this.save();
      case 'shown':
        return;
      case 'violation':
        return this.violation('invalid-shot', receipt.detail);
      case 'desync':
        return this.onMismatch(receipt.n);
    }
  }

  private async onSync(message: M): Promise<void> {
    // Only the host's table counts, and only when this side asked for it.
    if (this.role !== 'guest') return;
    const why: RestoreReason | null = this.awaitingSync
      ? 'resync'
      : this.expectSync
        ? 'rejoin'
        : null;
    if (!why) return;
    const result = await this.port.restore(message, why);
    if (result === 'rejected') {
      return this.violation('invalid-data', 'sent a table that cannot be this match');
    }
    if (why === 'rejoin' && result === 'restored') {
      // Taking the host's table on a return is a difference like any other, and counts on both
      // sides: a host cannot replace the guest's table more often by dropping out and back.
      void this.link.send({ t: 'desync', n: 0 } as WireMessage);
      if (this.countDesync()) return;
    }
    this.expectSync = false;
    this.clearTimer('stepTimer');
    if (this.awaitingSync) {
      this.awaitingSync = false;
      this.patch({ resyncing: false });
      this.emit({ kind: 'resynced' });
    }
    this.port.hold(false);
    this.save();
  }

  /** This side's table came out different from the other side's after shot n. */
  private async onMismatch(n: number): Promise<void> {
    this.save();
    void this.link.send({ t: 'desync', n } as WireMessage);
    if (this.countDesync()) return;
    this.port.hold(true);
    this.patch({ resyncing: true });
    // The host waits for the guest to stop and say so; the guest waits for the host's table.
    if (this.role === 'host') this.pendingDesync = n;
    else this.awaitingSync = true;
    this.watchStep();
  }

  /** The other side found the tables different after shot n (or, to a host, has stopped). */
  private async onDesync(n: number): Promise<void> {
    if (!this.started) return;
    if (this.role === 'host') {
      const echo = this.pendingDesync === n;
      this.pendingDesync = null;
      this.clearTimer('stepTimer');
      if (!echo && this.countDesync()) return;
      const snapshot = this.port.snapshot();
      if (snapshot) void this.link.send(snapshot);
      this.port.hold(false);
      this.patch({ resyncing: false });
      this.emit({ kind: 'resynced' });
      return;
    }
    if (this.countDesync()) return;
    // Stop, say so, and wait for the host's table.
    this.awaitingSync = true;
    this.port.hold(true);
    this.patch({ resyncing: true });
    void this.link.send({ t: 'desync', n } as WireMessage);
    this.watchStep();
  }

  /**
   * One side waits for the other to bring the tables back in step (a table, or word that it has
   * stopped). An honest app answers at once; one that never does would hold this player forever.
   */
  private watchStep(): void {
    this.clearTimer('stepTimer');
    const waiting = () =>
      (this.awaitingSync || this.expectSync || this.pendingDesync !== null) &&
      this.verified &&
      !this.ended;
    this.stepTimer = this.timers.setTimeout(() => {
      // Judged after the messages already received: the answer may be among them.
      this.enqueue(() =>
        waiting()
          ? this.violation('stalled', 'did not help bring the two tables back in step')
          : undefined,
      );
    }, STEP_TIMEOUT_MS);
  }

  /** Counts a difference; true if that was one too many and the session is ending. */
  private countDesync(): boolean {
    const desyncs = this.state.get().desyncs + 1;
    this.patch({ desyncs });
    if (desyncs <= MAX_DESYNCS) return false;
    // Nobody broke a rule, so nobody loses: the session just ends, on both sides.
    console.warn('online: the two tables kept differing; the session is closing.');
    this.closing = true;
    this.port.hold(true);
    this.emit({ kind: 'outOfStep' });
    // Time for the last desync to cross, so the other side stops too.
    this.timers.setTimeout(() => void this.close('closed', OUT_OF_STEP_MESSAGE), LEAVE_GRACE_MS);
    return true;
  }

  private async onResign(): Promise<void> {
    if (!this.started || this.port.status() !== 'playing') return;
    await this.port.forfeit('resigned');
    this.emit({ kind: 'resigned' });
    this.save();
  }

  private async onRematch(): Promise<void> {
    if (!this.started || this.port.status() !== 'over') return;
    const { rematch } = this.state.get();
    if (rematch === 'sent') {
      // Our offer, accepted; or an offer of theirs crossing ours (or ours lost while they were
      // away). Saying so again makes sure they start too; once started they ignore it.
      void this.link.send({ t: 'rematch' });
      await this.beginRematch();
    } else if (rematch === 'none') {
      this.patch({ rematch: 'received' });
      this.emit({ kind: 'rematchOffered' });
    }
  }

  private async onBye(): Promise<void> {
    if (this.started && this.port.status() === 'playing') await this.port.forfeit('abandoned');
    const name = this.state.get().friendName;
    this.emit({ kind: 'left' });
    await this.close('closed', `${name} left the game.`);
  }

  /** Both players asked: a new match starts, the other player breaking first. */
  private async beginRematch(): Promise<void> {
    this.terms = this.port.rematchTerms(this.terms!);
    this.patch({ rematch: 'none' });
    await this.port.start(this.terms, this.role);
    this.port.hold(this.state.get().status !== 'playing');
    this.emit({ kind: 'rematchStarted' });
    this.save();
  }

  // --- the local player's play -------------------------------------------------------------------

  private sendGame(message: M, changesMatch: boolean): void {
    // Play in any other kind of match is nobody else's business.
    if (this.ended || this.closing || !this.started) return;
    void this.link.send(message);
    if (changesMatch) this.save();
  }

  // --- rule breaks, timing and bookkeeping ---------------------------------------------------

  /** The other side broke the rules: the honest player wins and the connection is cut. */
  private async violation(reason: ForfeitReason, detail: string): Promise<void> {
    if (this.ended) return;
    const name = this.state.get().friendName;
    if (this.started && this.port.status() === 'playing') await this.port.forfeit(reason);
    // Logged for the honest player; this names what happened, never where it came from.
    console.warn(`online: ${name}'s app ${detail}; the game is over and the connection closed.`);
    this.emit({ kind: 'violation', reason, detail });
    this.link.kick();
    await this.close('closed', `Game ended: ${name}'s app ${detail}.`);
  }

  /** The connected peer showed who they are: their camera and microphone may now come through. */
  private trust(): void {
    this.verified = true;
    for (const track of this.heldTracks.splice(0)) this.media.receive(track);
    const { mic, cam } = this.media.state.get();
    if (mic === 'on' || cam === 'on') {
      void this.link.send({ t: 'media', mic: mic === 'on', cam: cam === 'on' } as WireMessage);
    }
  }

  /** The guest gives up if no match is set up in time, whether or not a connection was made. */
  private armConnectTimer(): void {
    this.clearTimer('connectTimer');
    this.connectTimer = this.timers.setTimeout(() => {
      if (!this.started) {
        this.fail("Couldn't reach the game. Check the link, or ask your friend for a new one.");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private dropHeldTracks(): void {
    for (const track of this.heldTracks.splice(0)) track.stop();
  }

  private fail(text: string): void {
    if (this.ended) return;
    this.emit({ kind: 'failed', text });
    void this.close('failed', text);
  }

  private async close(status: OnlineStatus, message: string | null): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.stopTimers();
    this.offLocal();
    this.dropHeldTracks();
    this.media.stop();
    this.port.hold(true);
    this.patch({ status, message, canClaimWin: false, resyncing: false });
    this.storage?.clear();
    await this.link.close();
  }

  private startPings(): void {
    this.stopPings();
    const measure = () => {
      void this.link.ping().then(
        (rtt) => {
          if (!Number.isFinite(rtt) || rtt < 0 || this.ended) return;
          this.lags = [...this.lags.slice(-4), rtt];
          // A message's delay is at most about the round trip; a peer that slows its answers on
          // purpose gains at most the cap.
          const allowance = Math.min(MAX_LAG_ALLOWANCE_MS, median(this.lags));
          this.port.setLagAllowance(allowance);
          this.patch({ ping: Math.round(rtt) });
        },
        () => undefined,
      );
    };
    measure();
    this.pingTimer = this.timers.setInterval(measure, PING_EVERY_MS);
  }

  private stopPings(): void {
    if (this.pingTimer !== null) this.timers.clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private clearTimer(name: 'connectTimer' | 'claimTimer' | 'stepTimer'): void {
    if (this[name] !== null) this.timers.clearTimeout(this[name]);
    this[name] = null;
  }

  private stopTimers(): void {
    this.stopPings();
    this.clearTimer('connectTimer');
    this.clearTimer('claimTimer');
    this.clearTimer('stepTimer');
  }

  private save(): void {
    if (!this.storage || this.ended || !this.token) return;
    const s = this.state.get();
    this.storage.save({
      invite: this.invite,
      role: this.role,
      token: this.token,
      name: s.myName,
      friendName: s.friendName,
      terms: this.terms,
      state: this.port.snapshot(),
    });
  }

  private patch(patch: Partial<OnlineState>): void {
    this.state.update(patch);
  }

  private emit(event: SessionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

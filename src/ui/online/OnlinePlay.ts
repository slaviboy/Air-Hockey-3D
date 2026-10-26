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

// Online play in the interface (Pool's): hosting (the terms, the warning, the link and its QR
// code), joining from a link (in the address bar, pasted, or a game this tab was playing before a
// reload), the connection's state beside the cards, video and voice on the cards (with a button to
// hang up), and what the session reports (arrivals, offers, rule breaks). Every online game starts
// with the 18+ and IP warning, its box unticked, before anything connects; the development hook is
// removed for good once one begins. A hidden page holds play on both sides until it is shown again.

import type { App } from '../../app/App.ts';
import { removeDebugHook } from '../../app/debugHook.ts';
import { HockeyPort, type PortTable } from '../../game/HockeyPort.ts';
import {
  HOCKEY_CODEC,
  HOCKEY_LIMITS,
  type HockeyMessage,
  type HockeyTerms,
} from '../../game/hockeyMessages.ts';
import { openPeerLink } from '../../net/PeerLink.ts';
import {
  OUT_OF_STEP_MESSAGE,
  OnlineSession,
  type OnlineState,
  type SavedSession,
  type SessionEvent,
} from '../../net/OnlineSession.ts';
import {
  cleanName,
  createInvite,
  inviteUrl,
  parseInvite,
  roomFor,
  type Invite,
} from '../../net/protocol.ts';
import { tabStorage } from '../../net/savedSession.ts';
import { syncServerTime } from '../../net/serverTime.ts';
import { other, type Seat } from '../../rules/types.ts';
import { CardMedia, type MediaView } from '../cardMedia.ts';
import { dialogOpen, el } from '../Dialog.ts';
import { iconButton } from '../modern/controls.ts';
import {
  consentDialog,
  joinDialog,
  noticeDialog,
  offerDialog,
  onlineTermsDialog,
  waitDialog,
  type ConsentKind,
} from '../onlineDialogs.ts';
import type { UiRoot } from '../UiRoot.ts';
import type { HostTerms, OnlineHooks } from './hooks.ts';

type HockeySession = OnlineSession<HockeyMessage, HockeyTerms>;

const coin = (): Seat => (crypto.getRandomValues(new Uint8Array(1))[0]! & 1) as Seat;

/** Seconds as m:ss. */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export class OnlinePlay implements OnlineHooks {
  private session: HockeySession | null = null;
  private port: HockeyPort | null = null;
  private offs: Array<() => void> = [];
  private readonly storage = tabStorage(HOCKEY_CODEC);
  /** An invitation from the address bar, waiting for the player to accept the warning. */
  private pendingInvite: Invite | null = null;
  private readonly chip: HTMLElement;
  private readonly chipText: HTMLElement;
  /** The other player's voice: one element for the whole game, never a video's. */
  private readonly voice: HTMLAudioElement;
  private readonly media: [CardMedia, CardMedia];
  private lastMediaError: string | null = null;
  private claimOffered = false;

  constructor(
    private readonly app: App,
    private readonly ui: UiRoot,
  ) {
    ui.online = this;
    this.readInvite();
    window.addEventListener('hashchange', () => {
      if (this.readInvite()) void this.checkInvitation();
    });
    // A hidden page (another tab, the phone locked) holds play on both sides.
    document.addEventListener('visibilitychange', () => this.port?.setHidden(document.hidden));

    this.chip = el('div', 'online-chip');
    this.chip.dataset.testid = 'online';
    this.chip.setAttribute('role', 'status');
    this.chip.hidden = true;
    this.chipText = el('span', 'online-chip-text');
    this.chip.append(el('span', 'online-chip-dot'), this.chipText);
    ui.element.append(this.chip);

    this.voice = document.createElement('audio');
    this.voice.autoplay = true;
    this.voice.hidden = true;
    document.body.append(this.voice);

    const commands = {
      toggleMic: () => void this.session?.media.toggleMic(),
      toggleCam: () => void this.session?.media.toggleCam(),
      toggleSpeaker: () => this.session?.media.toggleSpeaker(),
      hangUp: () => {
        this.session?.media.hangUp();
        this.ui.say('You hung up. Turn your camera or microphone on to call again.');
      },
    };
    const makeButton = (icon: string, label: string, onClick: () => void) =>
      iconButton(icon, label, onClick, 'm-icon-btn m-media-btn');
    this.media = [
      new CardMedia(commands, makeButton, 'm-avatar-video'),
      new CardMedia(commands, makeButton, 'm-avatar-video'),
    ];
    for (const seat of [0, 1] as const) {
      ui.playerCard(seat).attachMedia(this.media[seat].video, this.media[seat].controls);
    }
    // The cards show video and voice once the match (and so this device's seat) is set up.
    app.match.state.subscribe(() => {
      this.renderChip();
      this.renderMedia();
    });
    // The chip's score and the puck's holder change during play, not only with the match's state.
    setInterval(() => this.renderChip(), 250);
  }

  // --- what the interface asks ---------------------------------------------------------------

  get active(): boolean {
    return !!this.session && !this.session.closed;
  }

  get seat(): Seat | null {
    return this.port && this.app.match.setup.mode === 'online' ? this.port.seat : null;
  }

  async intercept(): Promise<boolean> {
    return this.checkInvitation();
  }

  async host(terms?: HostTerms): Promise<boolean> {
    const chosen = terms ?? (await onlineTermsDialog(this.app.settings.get()));
    if (!chosen) return false;
    if (this.active && !(await this.leaveForNewMatch())) return false;
    const consent = await this.askConsent('host');
    if (!consent) return false;
    this.app.settings.update({ target: chosen.target, reach: chosen.reach });
    const invite = createInvite();
    const firstServe: Seat = chosen.firstServe === 'toss' ? coin() : chosen.firstServe;
    const options = await this.options(invite);
    const session = OnlineSession.host<HockeyMessage, HockeyTerms>({
      ...options,
      name: consent.name,
      terms: (friend) => ({
        target: chosen.target,
        reach: chosen.reach,
        names: [cleanName(consent.name, 'Player'), friend],
        host: 0,
        firstServe,
      }),
    });
    this.begin(session, options.port);
    const result = await waitDialog(session.state, inviteUrl(location.href, invite));
    if (result !== 'playing' && this.session === session) await this.end();
    return result === 'playing';
  }

  async join(): Promise<boolean> {
    const invite = await joinDialog();
    if (!invite) return false;
    if (this.active && !(await this.leaveForNewMatch())) return false;
    const consent = await this.askConsent('guest');
    if (!consent) return false;
    return this.joinWith(invite, consent.name);
  }

  async rematch(): Promise<void> {
    const session = this.session;
    if (!session || session.closed) {
      this.ui.say('Your friend has left. Start a new game from the menu.');
      return;
    }
    const consent = await this.askConsent('rematch', session.state.get().myName);
    if (!consent || session.closed) return;
    const asked = session.state.get().rematch !== 'received';
    await session.requestRematch();
    if (asked) this.ui.say(`Waiting for ${session.state.get().friendName} to accept the rematch…`);
  }

  async resign(): Promise<void> {
    const session = this.session;
    if (!session || session.closed || this.app.match.current.winner !== null) return;
    const { friendName: friend, status } = session.state.get();
    if (status !== 'playing') {
      // Their match would undo it when they came back.
      this.ui.say(`${friend} is away. Wait for them to come back, or leave the game.`);
      return;
    }
    const sure = await offerDialog(
      'Resign the match?',
      `${friend} wins the match. You stay connected, for a rematch.`,
      'Resign',
      'Keep playing',
    );
    if (sure) await session.resign();
  }

  async leave(): Promise<void> {
    if (await this.leaveForNewMatch()) {
      this.ui.say('You left the online game.');
      await this.ui.menu();
    }
  }

  async leaveForNewMatch(): Promise<boolean> {
    const session = this.session;
    if (!session || session.closed) {
      await this.end();
      return true;
    }
    const { status, friendName } = session.state.get();
    const playing = session.matchStarted && this.app.match.current.winner === null;
    if (playing && status !== 'waiting') {
      const ok = await offerDialog(
        'Leave the online game?',
        `You lose the match if you leave now. ${friendName} wins.`,
        'Leave',
        'Stay',
      );
      if (!ok) return false;
    }
    await this.end();
    return true;
  }

  status(): string | null {
    const session = this.session;
    if (!session || session.closed || this.app.match.setup.mode !== 'online') return null;
    const s = session.state.get();
    if (s.status === 'away') return `${s.friendName} lost the connection. Waiting for them…`;
    if (s.resyncing) return 'Bringing the two tables back in step…';
    if (s.status !== 'playing' || this.app.match.current.winner !== null) return null;
    const hold = this.port?.holdReason() ?? null;
    if (hold?.kind === 'peerHidden') {
      return `${s.friendName} left the game’s window · ${clock(hold.secondsLeft)} to come back`;
    }
    if (hold?.kind === 'silent') return `Waiting to hear from ${s.friendName}…`;
    return null;
  }

  // --- joining -------------------------------------------------------------------------------

  /** Takes the invitation from the address bar, if any, and clears it from there. */
  private readInvite(): boolean {
    if (!location.hash.startsWith('#g=')) return false;
    const invite = parseInvite(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (invite) this.pendingInvite = invite;
    return invite !== null;
  }

  /** An invitation in the address bar, or a game this tab was playing before a reload. */
  private async checkInvitation(): Promise<boolean> {
    await this.app.ready;
    const invite = this.pendingInvite;
    this.pendingInvite = null;
    if (invite) {
      if (this.active && !(await this.leaveForNewMatch())) return true;
      const consent = await this.askConsent('guest');
      if (!consent) return false;
      return this.joinWith(invite, consent.name);
    }
    const saved = this.storage.load();
    if (!saved || this.session) return false;
    const consent = await this.askConsent('rejoin', saved.name);
    if (!consent) {
      this.storage.clear();
      return false;
    }
    return this.resume(saved, consent.name);
  }

  private async joinWith(invite: Invite, name: string): Promise<boolean> {
    const options = await this.options(invite);
    const session = OnlineSession.join<HockeyMessage, HockeyTerms>({ ...options, name });
    this.begin(session, options.port);
    return this.waitForHost(session);
  }

  private async resume(saved: SavedSession<HockeyMessage, HockeyTerms>, name: string) {
    const options = await this.options(saved.invite);
    const { invite: _invite, ...rest } = options;
    const session = OnlineSession.resume<HockeyMessage, HockeyTerms>(saved, { ...rest, name });
    this.begin(session, options.port);
    if (saved.role === 'guest') return this.waitForHost(session);
    this.ui.say(`Waiting for ${saved.friendName} to come back…`);
    return true;
  }

  private async waitForHost(session: HockeySession): Promise<boolean> {
    const result = await waitDialog(session.state, null);
    if (result !== 'playing' && this.session === session) await this.end();
    return result === 'playing';
  }

  /** The warning, every time; the name it asks for is remembered as the player's name. */
  private async askConsent(kind: ConsentKind, name = this.app.settings.get().name) {
    const answer = await consentDialog(kind, name);
    if (answer) this.app.settings.update({ name: answer.name });
    return answer;
  }

  private async options(invite: Invite) {
    const port = new HockeyPort(this.table());
    port.setHidden(document.hidden);
    // The relays compare times, so first the clock both players will agree on.
    const [room] = await Promise.all([roomFor(invite), syncServerTime()]);
    return {
      link: openPeerLink(invite, room),
      port,
      codec: HOCKEY_CODEC,
      invite,
      build: __AIR_HOCKEY_BUILD__,
      storage: this.storage,
      limits: HOCKEY_LIMITS,
    };
  }

  /** What the port needs of this device's game. */
  private table(): PortTable {
    const app = this.app;
    const ui = this.ui;
    return {
      get match() {
        return app.match;
      },
      newMatch: (setup, seats) => ui.beginMatch(setup, seats),
      say: (text) => ui.say(text),
      restored: () => ui.render(),
    };
  }

  // --- following a session -------------------------------------------------------------------

  private begin(session: HockeySession, port: HockeyPort): void {
    this.stopFollowing();
    this.session?.dispose();
    this.port?.dispose();
    // The development hook reaches into the whole game; it has no place in a game against a person.
    removeDebugHook();
    this.session = session;
    this.port = port;
    this.claimOffered = false;
    this.offs.push(
      session.state.subscribe((state) => this.onState(session, state)),
      session.onEvent((event) => void this.onEvent(session, event)),
      session.media.state.subscribe(() => this.renderMedia()),
    );
  }

  /** Leaves the online game, if there is one (losing a match still being played). */
  private async end(): Promise<void> {
    const session = this.session;
    const port = this.port;
    this.stopFollowing();
    this.session = null;
    this.port = null;
    if (session) {
      await session.leave();
      session.dispose();
    }
    port?.dispose();
    this.app.match.held = false;
    this.renderChip();
    this.renderMedia();
  }

  private stopFollowing(): void {
    for (const off of this.offs.splice(0)) off();
  }

  private onState(session: HockeySession, state: OnlineState): void {
    this.renderChip();
    this.renderMedia();
    this.ui.render();
    if (state.canClaimWin && !this.claimOffered) {
      this.claimOffered = true;
      void this.offerClaim(session);
    }
    if (!state.canClaimWin) this.claimOffered = false;
  }

  private async onEvent(session: HockeySession, event: SessionEvent): Promise<void> {
    const friend = session.state.get().friendName;
    const setup = this.app.match.setup;
    const names = setup.names;
    const server = names[setup.firstServe];
    switch (event.kind) {
      case 'joined':
        this.ui.say(`${friend} joined. ${server} serves first.`);
        break;
      case 'returned':
        this.ui.say(`${friend} is back.`);
        break;
      case 'away':
        this.ui.say(`${friend} lost the connection. Waiting for them to come back…`);
        break;
      case 'resynced':
        this.ui.say('The two tables were brought back in step.');
        break;
      case 'rematchOffered': {
        const winner = this.app.match.current.winner;
        const next = names[winner === null ? other(setup.firstServe) : other(winner)];
        const text = `${friend} wants a rematch. ${next} would serve first.`;
        this.ui.say(text);
        if (dialogOpen()) break;
        if (await offerDialog('Rematch', text, 'Rematch')) await this.rematch();
        break;
      }
      case 'rematchStarted':
        this.ui.say(`Rematch against ${friend}: ${server} serves.`);
        break;
      case 'resigned':
        await noticeDialog('You win the match', `${friend} resigned.`);
        break;
      case 'outOfStep':
        // The session closes a moment later, once the last word has crossed.
        void noticeDialog('Online game over', OUT_OF_STEP_MESSAGE);
        break;
      case 'left':
      case 'violation':
      case 'failed':
        // The message arrives with the closing state; give it a moment.
        queueMicrotask(() => {
          const message = session.state.get().message;
          if (message && session.matchStarted) void noticeDialog('Online game over', message);
        });
        break;
    }
  }

  /**
   * Offers the win over a player who has stayed away; asked again a while after "Keep waiting",
   * or once no other dialog is open, as long as they are still away.
   */
  private async offerClaim(session: HockeySession): Promise<void> {
    const friend = session.state.get().friendName;
    const again = (ms: number) =>
      setTimeout(() => {
        if (this.session === session && session.state.get().canClaimWin) {
          void this.offerClaim(session);
        }
      }, ms);
    if (dialogOpen()) {
      again(5_000);
      return;
    }
    this.ui.say(`${friend} has been gone for two minutes. You can claim the win.`);
    const claim = await offerDialog(
      'Claim the win?',
      `${friend} has been gone for two minutes. Claim the win, or keep waiting for them.`,
      'Claim the win',
      'Keep waiting',
    );
    if (this.session !== session || !session.state.get().canClaimWin) return;
    if (!claim) {
      again(60_000);
      return;
    }
    await session.claimWin();
    const message = session.state.get().message;
    if (message) await noticeDialog('You win the match', message);
  }

  // --- drawing -------------------------------------------------------------------------------

  /** The connection beside the cards: who, how it is, and where the match stands, for tests. */
  private renderChip(): void {
    const session = this.session;
    const match = this.app.match;
    const online = match.setup.mode === 'online' && session !== null;
    this.chip.hidden = !online;
    if (!online || !session) return;
    const s = session.state.get();
    let text: string;
    if (s.status === 'waiting') text = 'Waiting for your friend…';
    else if (s.status === 'connecting') text = 'Connecting…';
    else if (s.status === 'away') text = `${s.friendName} lost the connection…`;
    else if (s.status === 'closed' || s.status === 'failed') text = 'Offline';
    else if (s.resyncing) text = 'Bringing the tables back in step…';
    else text = `Online with ${s.friendName}${s.ping !== null ? ` · ${s.ping} ms` : ''}`;
    if (this.chipText.textContent !== text) this.chipText.textContent = text;
    const state = match.current;
    const data = this.chip.dataset;
    data.status = s.resyncing ? 'resyncing' : s.status;
    data.score = `${state.score[0]}-${state.score[1]}`;
    data.goals = String(state.goals);
    data.phase = state.phase;
    data.seat = String(this.port?.seat ?? '');
    data.holder = String(this.port?.holder ?? '');
  }

  private mediaView(): MediaView | null {
    const session = this.session;
    if (!session || session.closed || this.seat === null) return null;
    const media = session.media.state.get();
    return {
      me: this.seat,
      friendName: session.state.get().friendName,
      mic: media.mic,
      cam: media.cam,
      preview: media.preview,
      friendVideo: media.friendVideo,
      friendSound: media.friendAudio !== null,
      speakerMuted: media.speakerMuted,
      hungUp: media.hungUp,
    };
  }

  private renderMedia(): void {
    const session = this.session;
    const media = session && !session.closed ? session.media.state.get() : null;
    const sound = media?.friendAudio ?? null;
    if (this.voice.srcObject !== sound) {
      this.voice.srcObject = sound;
      if (sound) void this.voice.play().catch(() => undefined);
    }
    this.voice.muted = media?.speakerMuted ?? false;
    const error = media?.error ?? null;
    if (error && error !== this.lastMediaError) this.ui.say(error);
    this.lastMediaError = error;
    const view = this.mediaView();
    for (const seat of [0, 1] as const) {
      const on = this.media[seat].render(view, seat);
      this.ui.playerCard(seat).setVideo(on);
    }
  }
}

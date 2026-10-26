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

// Video and voice in an online game. Everything starts off: the camera and the microphone are
// asked for only when the player turns them on here, and turning one off stops the device itself
// (its light goes out), not just the picture. No message from the other player can turn anything
// on: there is no such message, and nothing they send reaches getUserMedia.
//
// What the other player sends is shown from the tracks that actually arrive, never from what they
// say about them: a camera shows only while live pictures come in, and a microphone counts as on
// while live sound does. At most one sound and one picture are taken from them; anything more is
// stopped and ignored.
//
// Hanging up ends the call on this device while the match goes on: both devices stop, and the
// other player is no longer seen or heard here. Turning either device on again calls back.

import { Store } from '../core/Store.ts';
import type { LinkPort } from './LinkPort.ts';

export type DeviceState = 'off' | 'starting' | 'on' | 'blocked';
export type Kind = 'audio' | 'video';

export interface MediaState {
  readonly mic: DeviceState;
  readonly cam: DeviceState;
  /** This device's camera, for its own card. */
  readonly preview: MediaStream | null;
  /** The other player's camera, while pictures actually arrive. */
  readonly friendVideo: MediaStream | null;
  /** The other player's microphone, while sound actually arrives. */
  readonly friendAudio: MediaStream | null;
  /** The other player's sound is muted on this device. */
  readonly speakerMuted: boolean;
  /** This player hung up: nothing of the other player's is shown or played here. */
  readonly hungUp: boolean;
  /** Why a device could not start, for the player. */
  readonly error: string | null;
}

export interface MediaOptions {
  readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  /** Makes a stream from tracks; injectable for tests outside a browser. */
  readonly createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
  /** Told when this side's microphone or camera turns on or off, to let the other side know. */
  readonly onLocalChange?: (mic: boolean, cam: boolean) => void;
}

/** Small and light: a picture the size of a player's card is all the game needs. */
const CONSTRAINTS: Record<Kind, MediaStreamConstraints> = {
  audio: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
  video: {
    video: {
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: { ideal: 15, max: 15 },
      facingMode: 'user',
    },
  },
};

const DEVICE: Record<Kind, 'mic' | 'cam'> = { audio: 'mic', video: 'cam' };

const live = (track: MediaStreamTrack | null): track is MediaStreamTrack =>
  !!track && track.readyState === 'live' && !track.muted;

export class OnlineMedia {
  readonly state = new Store<MediaState>({
    mic: 'off',
    cam: 'off',
    preview: null,
    friendVideo: null,
    friendAudio: null,
    speakerMuted: false,
    hungUp: false,
    error: null,
  });
  private readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  private readonly createStream: (tracks: MediaStreamTrack[]) => MediaStream;
  private readonly local: Record<Kind, MediaStreamTrack | null> = { audio: null, video: null };
  private readonly remote: Record<Kind, MediaStreamTrack | null> = { audio: null, video: null };
  /** One stream per remote track, so the cards are not handed a new one on every change. */
  private readonly shown = new Map<MediaStreamTrack, MediaStream>();
  private outgoing: MediaStream | null = null;
  private stopped = false;
  /** Hang-ups so far: a device still starting when the player hangs up is stopped once it starts. */
  private hangUps = 0;

  constructor(
    private readonly link: LinkPort,
    private readonly options: MediaOptions = {},
  ) {
    this.getUserMedia =
      options.getUserMedia ?? ((constraints) => navigator.mediaDevices.getUserMedia(constraints));
    this.createStream = options.createStream ?? ((tracks) => new MediaStream(tracks));
  }

  toggleMic(): Promise<void> {
    return this.toggle('audio');
  }

  toggleCam(): Promise<void> {
    return this.toggle('video');
  }

  /** Mutes or unmutes the other player's sound on this device only. */
  toggleSpeaker(): void {
    this.patch({ speakerMuted: !this.state.get().speakerMuted });
  }

  /**
   * Ends the call on this device: the microphone and camera stop (their lights go out), and the
   * other player is no longer shown or heard here. The match goes on; a device turned on calls back.
   */
  hangUp(): void {
    if (this.stopped) return;
    const { mic, cam } = this.state.get();
    this.hangUps++;
    for (const kind of ['audio', 'video'] as const) this.release(kind);
    this.patch({
      mic: mic === 'blocked' ? 'blocked' : 'off',
      cam: cam === 'blocked' ? 'blocked' : 'off',
      hungUp: true,
    });
    this.showRemote();
    if (mic === 'on' || cam === 'on') this.report();
  }

  /** A track from the other player (the link passes only the partner's). */
  receive(track: MediaStreamTrack): void {
    if (this.stopped) {
      track.stop();
      return;
    }
    const kind = track.kind as Kind;
    if (kind !== 'audio' && kind !== 'video') {
      track.stop();
      return;
    }
    const current = this.remote[kind];
    if (current === track) return;
    // One of each kind: a second live one is not shown, and not kept.
    if (current && current.readyState === 'live' && !current.muted) {
      track.stop();
      return;
    }
    this.remote[kind] = track;
    const update = () => this.showRemote();
    track.addEventListener('mute', update);
    track.addEventListener('unmute', update);
    track.addEventListener('ended', update);
    this.showRemote();
  }

  /** Stops both devices and lets go of the other player's tracks (the game is over or left). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const kind of ['audio', 'video'] as const) {
      this.release(kind);
      this.remote[kind] = null;
    }
    this.shown.clear();
    this.patch({ mic: 'off', cam: 'off', preview: null, friendVideo: null, friendAudio: null });
  }

  private async toggle(kind: Kind): Promise<void> {
    if (this.stopped) return;
    const device = DEVICE[kind];
    const now = this.state.get()[device];
    if (now === 'starting') return;
    if (now === 'on') {
      this.release(kind);
      this.patch({ [device]: 'off' } as Partial<MediaState>);
      this.report();
      return;
    }
    // Turning a device on calls back after a hang-up.
    this.patch({ [device]: 'starting', error: null, hungUp: false } as Partial<MediaState>);
    this.showRemote();
    const hangUps = this.hangUps;
    let track: MediaStreamTrack | undefined;
    try {
      const stream = await this.getUserMedia(CONSTRAINTS[kind]);
      track = stream.getTracks().find((t) => t.kind === kind);
      for (const other of stream.getTracks()) if (other !== track) other.stop();
    } catch (error) {
      const blocked = (error as { name?: string }).name === 'NotAllowedError';
      const what = kind === 'audio' ? 'microphone' : 'camera';
      this.patch({
        [device]: blocked ? 'blocked' : 'off',
        error: blocked
          ? `The ${what} is blocked. Allow it in the browser's site settings to use it.`
          : `No ${what} could be started.`,
      } as Partial<MediaState>);
      return;
    }
    if (!track || this.stopped || this.hangUps !== hangUps) {
      track?.stop();
      this.patch({ [device]: 'off' } as Partial<MediaState>);
      return;
    }
    this.local[kind] = track;
    this.outgoing ??= this.createStream([]);
    this.outgoing.addTrack(track);
    this.link.addTrack(track, this.outgoing);
    this.patch({
      [device]: 'on',
      ...(kind === 'video' ? { preview: this.createStream([track]) } : {}),
    } as Partial<MediaState>);
    this.report();
  }

  /** Stops a local device and stops sending it. */
  private release(kind: Kind): void {
    const track = this.local[kind];
    if (!track) return;
    this.local[kind] = null;
    this.link.removeTrack(track);
    this.outgoing?.removeTrack(track);
    track.stop();
    if (kind === 'video') this.patch({ preview: null });
  }

  private showRemote(): void {
    const hungUp = this.state.get().hungUp;
    const stream = (track: MediaStreamTrack | null) => {
      if (hungUp || !live(track)) return null;
      let shown = this.shown.get(track);
      if (!shown) {
        shown = this.createStream([track]);
        this.shown.set(track, shown);
      }
      return shown;
    };
    this.patch({ friendVideo: stream(this.remote.video), friendAudio: stream(this.remote.audio) });
  }

  private report(): void {
    this.options.onLocalChange?.(this.state.get().mic === 'on', this.state.get().cam === 'on');
  }

  private patch(patch: Partial<MediaState>): void {
    this.state.update(patch);
  }
}

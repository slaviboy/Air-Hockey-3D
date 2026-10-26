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

// Video and voice on a player's card, kept out of the table's way: the picture fills the card's
// round avatar (a 4:3 window it is cropped to, in a taller top bar, on a phone held upright; on a
// large card, its top), and the switches sit beside the name. The player's own card shows their
// camera (mirrored, like a mirror) and the microphone and camera switches; the other player's card
// shows their camera while pictures arrive, and a switch to mute them on this device. Videos never
// play sound: the other player's voice comes from one audio element kept by the online play.

import type { Seat } from '../rules/types.ts';
import type { DeviceState } from '../net/OnlineMedia.ts';
import { LINE_ICONS } from './icons.ts';

/** What the cards show of video and voice in an online game. */
export interface MediaView {
  /** The seat of the player at this device. */
  readonly me: Seat;
  readonly friendName: string;
  readonly mic: DeviceState;
  readonly cam: DeviceState;
  readonly preview: MediaStream | null;
  readonly friendVideo: MediaStream | null;
  /** Sound is actually arriving from the other player. */
  readonly friendSound: boolean;
  readonly speakerMuted: boolean;
}

export interface MediaCommands {
  toggleMic(): void;
  toggleCam(): void;
  toggleSpeaker(): void;
}

type MakeButton = (icon: string, label: string, onClick: () => void) => HTMLButtonElement;

const DEVICE_LABEL: Record<'mic' | 'cam', Record<DeviceState, string>> = {
  mic: {
    off: 'Turn your microphone on',
    starting: 'Starting your microphone…',
    on: 'Turn your microphone off',
    blocked: 'Microphone blocked by the browser',
  },
  cam: {
    off: 'Turn your camera on',
    starting: 'Starting your camera…',
    on: 'Turn your camera off',
    blocked: 'Camera blocked by the browser',
  },
};

/** The video and the switches of one card. */
export class CardMedia {
  readonly video: HTMLVideoElement;
  readonly controls: HTMLElement;
  private readonly mic: HTMLButtonElement;
  private readonly cam: HTMLButtonElement;
  private readonly speaker: HTMLButtonElement;
  private readonly silent: HTMLElement;
  private shown: MediaStream | null = null;

  constructor(commands: MediaCommands, makeButton: MakeButton, videoClass: string) {
    this.video = document.createElement('video');
    this.video.className = videoClass;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.hidden = true;
    this.video.setAttribute('aria-hidden', 'true');

    this.controls = document.createElement('div');
    this.controls.className = 'card-media';
    this.controls.hidden = true;
    this.mic = makeButton(LINE_ICONS.micOff, DEVICE_LABEL.mic.off, () => commands.toggleMic());
    this.cam = makeButton(LINE_ICONS.cameraOff, DEVICE_LABEL.cam.off, () => commands.toggleCam());
    this.speaker = makeButton(LINE_ICONS.speaker, 'Mute', () => commands.toggleSpeaker());
    this.silent = document.createElement('span');
    this.silent.className = 'card-media-silent';
    this.silent.innerHTML = LINE_ICONS.micOff;
    this.silent.setAttribute('role', 'img');
    for (const b of [this.mic, this.cam, this.speaker]) b.classList.add('card-media-btn');
    this.controls.append(this.mic, this.cam, this.speaker, this.silent);
  }

  /** Draws the card for `seat`; returns whether a video shows. */
  render(view: MediaView | null, seat: Seat): boolean {
    this.controls.hidden = !view;
    if (!view) return this.show(null, false);
    const self = view.me === seat;
    this.mic.hidden = !self;
    this.cam.hidden = !self;
    this.speaker.hidden = self || !view.friendSound;
    this.silent.hidden = self || view.friendSound;
    if (self) {
      this.device(this.mic, 'mic', view.mic, LINE_ICONS.mic, LINE_ICONS.micOff);
      this.device(this.cam, 'cam', view.cam, LINE_ICONS.camera, LINE_ICONS.cameraOff);
      return this.show(view.cam === 'on' ? view.preview : null, true);
    }
    const label = `${view.speakerMuted ? 'Unmute' : 'Mute'} ${view.friendName}`;
    this.setButton(
      this.speaker,
      view.speakerMuted ? LINE_ICONS.speakerOff : LINE_ICONS.speaker,
      label,
    );
    this.speaker.setAttribute('aria-pressed', String(view.speakerMuted));
    const silent = `${view.friendName}'s microphone is off`;
    this.silent.setAttribute('aria-label', silent);
    this.silent.title = silent;
    return this.show(view.friendVideo, false);
  }

  private device(
    button: HTMLButtonElement,
    which: 'mic' | 'cam',
    state: DeviceState,
    on: string,
    off: string,
  ): void {
    this.setButton(button, state === 'on' ? on : off, DEVICE_LABEL[which][state]);
    button.setAttribute('aria-pressed', String(state === 'on'));
    button.disabled = state === 'starting';
    button.classList.toggle('blocked', state === 'blocked');
  }

  private setButton(button: HTMLButtonElement, icon: string, label: string): void {
    if (button.dataset.icon !== icon) {
      button.innerHTML = icon;
      button.dataset.icon = icon;
    }
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.tip = label;
  }

  private show(stream: MediaStream | null, mirrored: boolean): boolean {
    this.video.classList.toggle('mirrored', mirrored);
    if (stream !== this.shown) {
      this.shown = stream;
      this.video.srcObject = stream;
      if (stream) void this.video.play().catch(() => undefined);
    }
    this.video.hidden = !stream;
    return !!stream;
  }
}

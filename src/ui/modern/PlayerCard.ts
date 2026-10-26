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

// A player's card (Pool's): the initial in a ring, or the computer's portrait; the name; a tag (the
// computer's strength, or whose serve it is); a note under it; and the goals scored, with the
// goals to win as pips. It glows while the puck is in the player's half, and its ring runs down the
// 7 seconds they may keep it there. It is small, in the top bar, with a camera's picture inside the
// round avatar (in a call on a phone held upright the avatar grows to a 4:3 window the picture
// fills); or large, on its own beside the table, with the picture across its top like a call's.

import type { Seat } from '../../rules/types.ts';
import { el } from '../Dialog.ts';
import type { Portrait } from '../portraits.ts';

export interface PlayerView {
  readonly name: string;
  readonly score: number;
  /** The goals that win the match. */
  readonly target: number;
  /** A short tag under the name (the computer's strength, the serve), or null. */
  readonly tag: string | null;
  /** A line under it, or null. */
  readonly note: string | null;
  /** Whether the puck is in this player's half. */
  readonly active: boolean;
  /** The part of the 7 seconds left to this player (0–1), or null when not timed. */
  readonly clock: number | null;
  /** Seconds of it left, for the warning near the end. */
  readonly seconds: number | null;
  /** The computer's portrait in the avatar, or null for a person's initial. */
  readonly portrait: Portrait | null;
}

const RING = 2 * Math.PI * 21;

export class PlayerCard {
  readonly element: HTMLElement;
  private readonly name: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly score: HTMLElement;
  private readonly goals: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly note: HTMLElement;
  private readonly avatar: HTMLElement;
  private readonly initial: HTMLElement;
  private readonly portrait: HTMLImageElement;
  private readonly ring: SVGCircleElement;
  private last = '';
  private video: HTMLVideoElement | null = null;
  private large = false;

  constructor(seat: Seat) {
    this.element = el('div', `m-card player-card seat-${seat}`);
    this.element.dataset.testid = `player-${seat}`;
    const avatar = (this.avatar = el('div', 'player-avatar'));
    avatar.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="ring-track" cx="24" cy="24" r="21"/><circle class="ring-time" cx="24" cy="24" r="21" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>`;
    this.ring = avatar.querySelector('.ring-time')!;
    this.initial = el('span', 'player-initial');
    this.portrait = el('img', 'player-portrait');
    this.portrait.alt = '';
    this.portrait.hidden = true;
    this.portrait.draggable = false;
    avatar.append(this.initial, this.portrait);
    const text = el('div', 'player-text');
    this.name = el('div', 'player-name');
    this.tag = el('div', 'player-tag');
    // The row under the name that the 8-ball cards gave to the balls holds a note here.
    this.note = el('div', 'player-balls note');
    text.append(this.name, this.tag, this.note);
    this.score = el('div', 'player-score');
    this.goals = el('span', 'player-racks');
    this.pips = el('span', 'player-pips');
    this.pips.setAttribute('aria-hidden', 'true');
    this.score.append(this.goals, this.pips);
    this.element.append(avatar, text, this.score);
  }

  /**
   * Online: the player's camera (inside the avatar, or across the top of a large card), and the
   * microphone, camera and speaker switches beside the score.
   */
  attachMedia(video: HTMLVideoElement, controls: HTMLElement): void {
    this.video = video;
    this.score.before(controls);
    this.placeVideo();
  }

  /** Large, on its own beside the table, or small, in the top bar (the layout is in hockey.css). */
  setLarge(on: boolean): void {
    this.large = on;
    this.element.classList.toggle('large', on);
    this.placeVideo();
  }

  private placeVideo(): void {
    const video = this.video;
    const home = this.large ? this.element : this.avatar;
    if (!video || video.parentElement === home) return;
    home.prepend(video);
    // A video moved in the page may stop (Safari); a live picture carries on.
    if (video.srcObject) void video.play().catch(() => undefined);
  }

  /** Whether a picture shows in the avatar. */
  setVideo(on: boolean): void {
    this.element.classList.toggle('video-on', on);
  }

  render(view: PlayerView): void {
    this.element.classList.toggle('active', view.active);
    this.element.classList.toggle(
      'hurry',
      view.active && view.seconds !== null && view.seconds <= 3,
    );
    if (view.clock === null || !view.active) {
      this.ring.style.strokeDashoffset = '0';
      this.ring.classList.toggle('off', true);
    } else {
      this.ring.classList.toggle('off', false);
      this.ring.style.strokeDashoffset = String(RING * (1 - view.clock));
    }
    // Where the avatar is a call's window, the clock runs round its edge (hockey.css).
    this.avatar.style.setProperty(
      '--clock',
      view.clock === null || !view.active ? '0' : String(view.clock),
    );
    const key = [view.name, view.score, view.target, view.tag, view.note, view.portrait?.src].join(
      '|',
    );
    if (key === this.last) return;
    this.last = key;
    this.name.textContent = view.name;
    this.initial.textContent = view.name.trim().charAt(0).toUpperCase() || '?';
    this.portrait.hidden = view.portrait === null;
    this.initial.hidden = view.portrait !== null;
    this.element.classList.toggle('computer', view.portrait !== null);
    if (view.portrait) {
      this.portrait.src = view.portrait.src;
      this.portrait.alt = view.portrait.alt;
    }
    this.goals.textContent = String(view.score);
    this.pips.innerHTML = Array.from(
      { length: view.target },
      (_, i) => `<span class="pip${i < view.score ? ' won' : ''}"></span>`,
    ).join('');
    this.score.title = `${view.score} of ${view.target} ${view.target === 1 ? 'goal' : 'goals'}`;
    this.tag.textContent = view.tag ?? '';
    this.tag.hidden = !view.tag;
    this.note.textContent = view.note ?? '';
    this.note.hidden = !view.note;
    this.element.setAttribute(
      'aria-label',
      `${view.name}, ${view.score} ${view.score === 1 ? 'goal' : 'goals'}${view.tag ? `, ${view.tag}` : ''}`,
    );
  }
}

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

// The banner over the table after a goal: "Goal!" with who scored and the score now, in the
// interface's gold, there and gone again in the pause before the next serve (the layout and the
// animation are in hockey.css). A foul and the end of the match show in it as well.

import { el } from '../Dialog.ts';

/** How long the banner stays, milliseconds: about the pause after a goal. */
const SHOWN_MS = 1500;

export class GoalBanner {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly detail: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.element = el('div', 'goal-banner');
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'assertive');
    this.element.dataset.testid = 'goal-banner';
    this.title = el('div', 'goal-title');
    this.detail = el('div', 'goal-detail');
    this.element.append(this.title, this.detail);
    this.element.hidden = true;
  }

  /** Shows the banner: `kind` sets its colour (a goal for this device's player is gold). */
  show(title: string, detail: string, kind: 'ours' | 'theirs' | 'neutral' = 'neutral'): void {
    if (this.timer) clearTimeout(this.timer);
    this.title.textContent = title;
    this.detail.textContent = detail;
    this.element.dataset.kind = kind;
    this.element.hidden = false;
    // Restart the animation even when a banner is still showing.
    this.element.classList.remove('showing');
    void this.element.offsetWidth;
    this.element.classList.add('showing');
    this.timer = setTimeout(() => this.hide(), SHOWN_MS);
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.element.classList.remove('showing');
    this.element.hidden = true;
  }
}

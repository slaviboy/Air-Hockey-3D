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

// Short notes that float in under the players' cards and fade: a foul, a group taken, whose turn
// it is. Read out to screen readers too.

import { el } from '../Dialog.ts';

export type ToastKind = 'info' | 'foul' | 'good';

const SHOWN_MS = 2800;
const MAX_SHOWN = 3;

export class Toasts {
  readonly element: HTMLElement;

  constructor() {
    this.element = el('div', 'toasts');
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
  }

  show(text: string, kind: ToastKind = 'info'): void {
    const toast = el('div', `toast toast-${kind}`, text);
    this.element.append(toast);
    while (this.element.children.length > MAX_SHOWN) this.element.firstElementChild?.remove();
    setTimeout(() => {
      toast.classList.add('leaving');
      setTimeout(() => toast.remove(), 300);
    }, SHOWN_MS);
  }

  clear(): void {
    this.element.replaceChildren();
  }
}

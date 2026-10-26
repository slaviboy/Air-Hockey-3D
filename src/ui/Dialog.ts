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

// A modal dialog in the game's panel style. It traps focus, closes on Escape or a press beside it
// (resolving with the cancel value) and returns its answer as a promise.

export interface DialogHandle<T> {
  readonly body: HTMLElement;
  readonly root: HTMLElement;
  close(value: T): void;
}

export interface DialogOptions {
  /** False for a dialog a stray tap must not end: only its buttons (or Escape) close it. */
  readonly backdropCloses?: boolean;
}

let openCount = 0;

/** True while any dialog is open, so table shortcuts can stand aside. */
export function dialogOpen(): boolean {
  return openCount > 0;
}

export function openDialog<T>(
  title: string,
  cancelValue: T,
  build: (handle: DialogHandle<T>) => void,
  options: DialogOptions = {},
): Promise<T> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const root = document.createElement('div');
    root.className = 'dialog';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', title);
    const header = document.createElement('div');
    header.className = 'panel-header';
    const label = document.createElement('span');
    label.className = 'title';
    label.textContent = title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'X';
    closeButton.setAttribute('aria-label', 'Close');
    header.append(label, closeButton);
    const body = document.createElement('div');
    body.className = 'dialog-body';
    root.append(header, body);
    backdrop.append(root);

    const previous = document.activeElement as HTMLElement | null;
    let done = false;
    const close = (value: T) => {
      if (done) return;
      done = true;
      openCount--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previous?.focus?.();
      // The page never scrolls; an offset left over is a phone keyboard's, so put it back.
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(cancelValue);
      } else if (event.key === 'Tab') {
        const focusable = [
          ...root.querySelectorAll<HTMLElement>('button, select, input, textarea, [tabindex="0"]'),
        ].filter((el) => !el.hasAttribute('disabled'));
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    closeButton.addEventListener('click', () => close(cancelValue));
    if (options.backdropCloses !== false) {
      backdrop.addEventListener('pointerdown', (event) => {
        if (event.target === backdrop) close(cancelValue);
      });
    }
    document.addEventListener('keydown', onKey, true);
    openCount++;
    build({ body, root, close });
    document.body.append(backdrop);
    // On a touch screen a focused field opens the keyboard (and an iPhone zooms) before the player
    // has touched anything, while the sheet is still sliding in, so there the dialog itself takes
    // the focus and fields wait to be tapped.
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
      return;
    }
    (
      root.querySelector<HTMLElement>('[autofocus], .choice, .btn, select, input, textarea') ??
      closeButton
    ).focus();
  });
}

/** Creates an element with a class and optional text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

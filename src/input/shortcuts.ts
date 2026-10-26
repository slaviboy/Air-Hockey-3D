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

// The keyboard, laid out as in the sister games: the arrows, Page Up and Down and Home move the
// camera; T and F switch and turn the view; Esc pauses. W A S D drive this player's mallet (see
// KeyDriver), and with two players on one device the arrows drive the second player's instead of
// the camera. One table gives both what each key does and the help that lists them, so the two
// cannot drift apart.

const DEG = Math.PI / 180;

export type Command =
  | { readonly kind: 'orbit'; readonly azimuth: number; readonly elevation: number }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'home' }
  | { readonly kind: 'flip' }
  | { readonly kind: 'toggleView' }
  | { readonly kind: 'sound' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'newGame' }
  | { readonly kind: 'help' };

export const KEY_ROTATE = 5 * DEG;
export const KEY_TILT = 3 * DEG;
export const KEY_ZOOM = 0.9;

/** The keys that drive a mallet, by direction on screen. */
export const MALLET_KEYS = {
  wasd: { up: 'w', down: 's', left: 'a', right: 'd' },
  arrows: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
} as const;
export type KeySet = (typeof MALLET_KEYS)[keyof typeof MALLET_KEYS];

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>;

/** The key as the tables here name it: a letter in lower case, anything else as it is. */
export function keyName(event: Pick<KeyboardEvent, 'key'>): string {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

/**
 * The command a key press gives, or null for a key the game leaves alone (or that drives a
 * mallet: `arrowsDrive` when the arrows are the second player's).
 */
export function commandFor(event: KeyEventLike, arrowsDrive = false): Command | null {
  if (event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  const key = keyName(event);
  if (mod) return !event.shiftKey && key === 'n' ? { kind: 'newGame' } : null;
  if (event.shiftKey) return key === '?' ? { kind: 'help' } : null;
  if (arrowsDrive && key.startsWith('Arrow')) return null;
  switch (key) {
    case 'ArrowLeft':
      return { kind: 'orbit', azimuth: KEY_ROTATE, elevation: 0 };
    case 'ArrowRight':
      return { kind: 'orbit', azimuth: -KEY_ROTATE, elevation: 0 };
    case 'ArrowUp':
      return { kind: 'orbit', azimuth: 0, elevation: KEY_TILT };
    case 'ArrowDown':
      return { kind: 'orbit', azimuth: 0, elevation: -KEY_TILT };
    case 'PageUp':
      return { kind: 'zoom', factor: KEY_ZOOM };
    case 'PageDown':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM };
    case 'Home':
      return { kind: 'home' };
    case 't':
      return { kind: 'toggleView' };
    case 'f':
      return { kind: 'flip' };
    case 'm':
      return { kind: 'sound' };
    case 'Escape':
    case 'p':
      return { kind: 'pause' };
    case 'r':
      return { kind: 'restart' };
    case '?':
      return { kind: 'help' };
    default:
      return null;
  }
}

/** Every key and mouse control, for the help, grouped. */
export const CONTROLS_HELP: readonly {
  readonly title: string;
  readonly rows: readonly (readonly [keys: string, action: string])[];
}[] = [
  {
    title: 'Playing',
    rows: [
      ['Move the mouse over the table', 'Your mallet follows the pointer'],
      ['Drag a finger on the table', 'Your mallet follows the finger'],
      ['W A S D', 'Move your mallet (up, left, down, right on screen)'],
      ['Two players on one device', 'Each finger drives the mallet of its half'],
      ['', 'At a keyboard: W A S D and the arrows, one player each'],
      ['', 'The mouse drives the mallet of the half it is over'],
    ],
  },
  {
    title: 'Camera',
    rows: [
      ['Drag a rail corner or the floor', 'Turn and tilt the view'],
      ['Drag a rail side', 'Pan the view'],
      ['Right-drag anywhere', 'Turn and tilt'],
      ['Middle-drag anywhere', 'Pan'],
      ['Mouse wheel, PgUp / PgDn', 'Zoom'],
      ['← →', 'Turn the view'],
      ['↑ ↓', 'Tilt the view (3D)'],
      ['Home', 'Reset the view'],
      ['F', 'Look from the other end'],
      ['T', 'Top view / 3D view'],
      ['Two fingers', 'Twist to turn, pinch to zoom, drag to tilt and pan'],
    ],
  },
  {
    title: 'Game',
    rows: [
      ['Esc, P', 'Pause menu'],
      ['R', 'Restart the match (on this device)'],
      ['M', 'Sound on or off'],
      ['Ctrl+N', 'New game'],
      ['?', 'This list'],
    ],
  },
];

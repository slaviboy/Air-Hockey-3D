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

// The keyboard: the camera keys as in the sister games, the arrows handed to the second player's
// mallet on one device, the game's own keys, and every key the help lists does what it says.

import { describe, expect, it } from 'vitest';
import { CONTROLS_HELP, commandFor, KEY_ROTATE, KEY_TILT } from '../../src/input/shortcuts.ts';

const key = (k: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => ({
  key: k,
  shiftKey: mods.shift ?? false,
  ctrlKey: mods.ctrl ?? false,
  metaKey: false,
  altKey: mods.alt ?? false,
});

describe('the keyboard', () => {
  it('moves the camera with the arrows, Page Up and Down and Home, as in the sister games', () => {
    expect(commandFor(key('ArrowLeft'))).toEqual({
      kind: 'orbit',
      azimuth: KEY_ROTATE,
      elevation: 0,
    });
    expect(commandFor(key('ArrowUp'))).toEqual({ kind: 'orbit', azimuth: 0, elevation: KEY_TILT });
    expect((commandFor(key('PageUp')) as { factor: number }).factor).toBeLessThan(1);
    expect((commandFor(key('PageDown')) as { factor: number }).factor).toBeGreaterThan(1);
    expect(commandFor(key('Home'))).toEqual({ kind: 'home' });
    expect(commandFor(key('T'))).toEqual({ kind: 'toggleView' });
    expect(commandFor(key('f'))).toEqual({ kind: 'flip' });
  });

  it('gives the arrows to the second player’s mallet when two play on one device', () => {
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(commandFor(key(arrow), true)).toBeNull();
    }
    // The rest of the keyboard is the same.
    expect(commandFor(key('Home'), true)).toEqual({ kind: 'home' });
  });

  it('pauses, restarts and switches the sound, and leaves W A S D to the mallet', () => {
    expect(commandFor(key('Escape'))).toEqual({ kind: 'pause' });
    expect(commandFor(key('p'))).toEqual({ kind: 'pause' });
    expect(commandFor(key('r'))).toEqual({ kind: 'restart' });
    expect(commandFor(key('m'))).toEqual({ kind: 'sound' });
    for (const k of ['w', 'a', 's', 'd']) expect(commandFor(key(k))).toBeNull();
  });

  it('leaves Alt combinations and unknown keys to the browser', () => {
    expect(commandFor(key('ArrowLeft', { alt: true }))).toBeNull();
    expect(commandFor(key('z'))).toBeNull();
    expect(commandFor(key('r', { ctrl: true }))).toBeNull();
    expect(commandFor(key('n', { ctrl: true }))).toEqual({ kind: 'newGame' });
    expect(commandFor(key('?', { shift: true }))).toEqual({ kind: 'help' });
  });

  it('lists in the help every key it answers to', () => {
    const listed = CONTROLS_HELP.flatMap((s) => s.rows.map(([keys]) => keys)).join(' ');
    for (const k of ['Home', 'PgUp', 'PgDn', 'Esc', 'Ctrl+N', '?', 'W A S D']) {
      expect(listed).toContain(k);
    }
    for (const letter of ['T', 'F', 'M', 'R', 'P']) expect(listed).toContain(letter);
  });
});

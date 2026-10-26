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

// The settings: a new player keeps the zoom while the view turns; a tablet or a computer starts
// with large player cards and the menu bar, a phone with neither; a damaged entry falls back field
// by field; the game's own choices (finish, strength, goals to win) are kept or refused.

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  deviceDefaults,
  loadSettings,
  PHONE_SETTINGS,
  sanitize,
  saveSettings,
} from '../../src/app/Settings.ts';

const KEY = 'air-hockey.settings.v1';

function storage(items: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(items));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

describe('the settings', () => {
  it('keep the zoom while the view turns, for a new player', () => {
    expect(DEFAULT_SETTINGS.keepZoom).toBe(true);
    expect(loadSettings(storage()).keepZoom).toBe(true);
  });

  it('come back as they were saved', () => {
    const saved = storage();
    const mine = {
      ...DEFAULT_SETTINGS,
      finish: 'black',
      difficulty: 'hard',
      target: 10,
      name: 'Ada',
    } as const;
    saveSettings(mine, saved);
    expect(loadSettings(saved)).toEqual(mine);
  });

  it('tell a phone from a tablet or a computer by the screen', () => {
    try {
      for (const [width, height, phone] of [
        [390, 844, true],
        [844, 390, true],
        [820, 1180, false],
        [1920, 1080, false],
      ] as const) {
        vi.stubGlobal('screen', { width, height });
        expect(deviceDefaults()).toBe(phone ? PHONE_SETTINGS : DEFAULT_SETTINGS);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('start large cards and the menu bar on a tablet or a computer, not on a phone', () => {
    const big = { largeCards: true, menuBar: true };
    const small = { largeCards: false, menuBar: false };
    expect(loadSettings(storage(), DEFAULT_SETTINGS)).toMatchObject(big);
    expect(loadSettings(storage(), PHONE_SETTINGS)).toMatchObject(small);
    const before = storage({ [KEY]: JSON.stringify({ name: 'Ada' }) });
    expect(loadSettings(before, PHONE_SETTINGS)).toMatchObject({ name: 'Ada', ...small });
    const damaged = storage({ [KEY]: JSON.stringify({ largeCards: 'yes', menuBar: 1 }) });
    expect(loadSettings(damaged, PHONE_SETTINGS)).toMatchObject(small);
  });

  it('refuse what the game does not offer, field by field', () => {
    const odd = sanitize({
      finish: 'gold',
      difficulty: 'impossible',
      target: 4,
      volume: 3,
      view: 'side',
      name: '   ',
      name2: 'x'.repeat(40),
      mode: 'online',
    });
    expect(odd).toMatchObject({
      finish: DEFAULT_SETTINGS.finish,
      difficulty: DEFAULT_SETTINGS.difficulty,
      target: DEFAULT_SETTINGS.target,
      volume: DEFAULT_SETTINGS.volume,
      view: DEFAULT_SETTINGS.view,
      name: DEFAULT_SETTINGS.name,
      // An online match is never started from a stored choice.
      mode: DEFAULT_SETTINGS.mode,
    });
    expect(odd.name2).toHaveLength(24);
    expect(loadSettings(storage({ [KEY]: '{not json' }), PHONE_SETTINGS)).toEqual(PHONE_SETTINGS);
  });

  it('are off for hints on hover by default, and stay on once turned on', () => {
    expect(loadSettings(storage(), DEFAULT_SETTINGS).hints).toBe(false);
    const saved = storage();
    saveSettings({ ...DEFAULT_SETTINGS, hints: true }, saved);
    expect(loadSettings(saved, DEFAULT_SETTINGS).hints).toBe(true);
  });
});

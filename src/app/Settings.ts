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

// The player's preferences, kept in this browser (Pool's settings). Whatever is stored is checked
// field by field against the defaults, so a damaged or older entry never breaks the game; storage
// that is blocked simply means the defaults. A tablet or a computer starts with large cards and the
// menu bar, a phone with small cards in the top bar and the menu behind its button, which leave its
// small screen to the table.

import { DIFFICULTY_IDS, type DifficultyId } from '../ai/difficulty.ts';
import { DEFAULT_TARGET, TARGETS } from '../rules/match.ts';
import type { ViewMode } from '../scene/CameraRig.ts';
import { FINISHES, type FinishName } from '../scene/surfaces.ts';

export type QualitySetting = 'auto' | 'high' | 'low';
/** How the New Game sheet shows the computer's opponents: big cards in a slider, or a grid. */
export type LevelView = 'slider' | 'compact';
/** Who a new match on this device is against. */
export type LocalMode = 'computer' | 'local';

export interface Settings {
  readonly view: ViewMode;
  readonly sound: boolean;
  /** 0–1. */
  readonly volume: number;
  readonly quality: QualitySetting;
  /** The cabinet's finish. */
  readonly finish: FinishName;
  /** Turning the view keeps its zoom, instead of refitting the table to the screen at each angle. */
  readonly keepZoom: boolean;
  /**
   * The players' cards large, with room for a video call: beside the table, or in a row under the
   * buttons on a phone held upright. Otherwise they are small, in the top bar.
   */
  readonly largeCards: boolean;
  /** The menus along the top bar, as in a desktop program, instead of behind the menu button. */
  readonly menuBar: boolean;
  /** A tip under the pointer, naming a control and how to use it, while hovering over it. */
  readonly hints: boolean;
  /** The player's name (for two players on one device, the second name too). */
  readonly name: string;
  readonly name2: string;
  /** The last kind of match chosen on this device, for the New Game sheet. */
  readonly mode: LocalMode;
  /** The computer's strength. */
  readonly difficulty: DifficultyId;
  /** Goals to win a match. */
  readonly target: number;
  readonly levelView: LevelView;
}

export const DEFAULT_SETTINGS: Settings = {
  view: '3d',
  sound: true,
  volume: 0.8,
  quality: 'auto',
  finish: 'silver',
  keepZoom: true,
  largeCards: true,
  menuBar: true,
  hints: false,
  name: 'Player 1',
  name2: 'Player 2',
  mode: 'computer',
  difficulty: 'medium',
  target: DEFAULT_TARGET,
  levelView: 'slider',
};

export const PHONE_SETTINGS: Settings = { ...DEFAULT_SETTINGS, largeCards: false, menuBar: false };

/** The defaults for this device: a phone's screen is under 600 CSS pixels on its shorter side
 * (most are 360 to 430), a tablet's or a computer's larger. */
export function deviceDefaults(): Settings {
  const s = typeof screen === 'undefined' ? null : screen;
  return s && Math.min(s.width, s.height) < 600 ? PHONE_SETTINGS : DEFAULT_SETTINGS;
}

const KEY = 'air-hockey.settings.v1';

/** Keeps every field of a stored value that is valid, and the default for the rest. */
export function sanitize(value: unknown, d: Settings = DEFAULT_SETTINGS): Settings {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const oneOf = <T>(x: unknown, options: readonly T[], fallback: T): T =>
    options.includes(x as T) ? (x as T) : fallback;
  const flag = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback);
  const name = (x: unknown, fallback: string) =>
    typeof x === 'string' && x.trim().length > 0 ? x.trim().slice(0, 24) : fallback;
  return {
    view: oneOf(v.view, ['3d', 'top'] as const, d.view),
    sound: flag(v.sound, d.sound),
    volume: typeof v.volume === 'number' && v.volume >= 0 && v.volume <= 1 ? v.volume : d.volume,
    quality: oneOf(v.quality, ['auto', 'high', 'low'] as const, d.quality),
    finish: oneOf(v.finish, Object.keys(FINISHES) as FinishName[], d.finish),
    keepZoom: flag(v.keepZoom, d.keepZoom),
    largeCards: flag(v.largeCards, d.largeCards),
    menuBar: flag(v.menuBar, d.menuBar),
    hints: flag(v.hints, d.hints),
    name: name(v.name, d.name),
    name2: name(v.name2, d.name2),
    mode: oneOf(v.mode, ['computer', 'local'] as const, d.mode),
    difficulty: oneOf(v.difficulty, DIFFICULTY_IDS, d.difficulty),
    target: oneOf(v.target, TARGETS as readonly number[], d.target),
    levelView: oneOf(v.levelView, ['slider', 'compact'] as const, d.levelView),
  };
}

export function loadSettings(
  storage: Storage | null = safeStorage(),
  defaults: Settings = deviceDefaults(),
): Settings {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw), defaults) : defaults;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the settings last for this visit only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

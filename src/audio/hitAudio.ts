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

// What play sounds like, worked out from the simulation's events (Pool's shot audio): which sound
// each contact makes and how loud, from the speed of the impact; and a mixer that keeps a flurry of
// contacts from turning into noise, folding contacts that land together into one sound and capping
// how many play at once.

import type { MatchEvent } from '../game/Match.ts';

export type Voice = 'mallet' | 'rail' | 'post' | 'goal';

export interface Hit {
  readonly voice: Voice;
  /** 0–1. */
  readonly level: number;
}

/** The impact speed (m/s) at which each sound is at its loudest. */
const FULL: Record<Voice, number> = { mallet: 6, rail: 5, post: 4, goal: 1 };
/** Contacts slower than this (m/s) are not heard: a puck nudged, resting against a rail. */
export const SILENT_BELOW = 0.015;
/** The ear hears impacts roughly logarithmically; this sets where the curve bends (m/s). */
const KNEE = 0.06;

/** How loud a contact of this kind and speed sounds, 0–1; never quieter for a harder hit. */
export function loudness(voice: Voice, speed: number): number {
  if (!(speed > SILENT_BELOW)) return 0;
  return Math.min(1, Math.log1p(speed / KNEE) / Math.log1p(FULL[voice] / KNEE));
}

/** The sound an event makes, or null for one that makes none (or too soft to hear). */
export function hitFor(event: MatchEvent): Hit | null {
  let voice: Voice;
  let speed: number;
  switch (event.kind) {
    case 'mallet':
      [voice, speed] = ['mallet', event.speed];
      break;
    case 'rail':
      [voice, speed] = ['rail', event.speed];
      break;
    case 'post':
      [voice, speed] = ['post', event.speed];
      break;
    case 'goal':
      // The drop into the return sounds the same however the puck came in.
      [voice, speed] = ['goal', 1];
      break;
    default:
      return null;
  }
  const level = loudness(voice, speed);
  return level > 0 ? { voice, level } : null;
}

/** How long each sound rings, seconds (for counting the voices sounding). */
export const DURATION: Record<Voice, number> = {
  mallet: 0.18,
  rail: 0.26,
  post: 0.21,
  goal: 0.75,
};
/** Contacts of one kind closer together than this are heard as one, seconds. */
export const MERGE_WINDOW = 0.012;
/** At most this many sounds at once. */
export const MAX_VOICES = 14;

/**
 * Decides which contacts are played. Each is offered with the time it would start; it is played,
 * or dropped because a sound of its kind at least as loud starts within the merge window, or
 * because as many sounds as allowed are ringing.
 */
export class HitMixer {
  private sounding: { voice: Voice; at: number; end: number; level: number }[] = [];

  /** Whether to play this hit, starting at `at` (seconds on any steady clock). */
  accept(hit: Hit, at: number): boolean {
    this.sounding = this.sounding.filter((s) => s.end > at);
    const twin = this.sounding.find(
      (s) => s.voice === hit.voice && Math.abs(s.at - at) < MERGE_WINDOW,
    );
    if (twin && twin.level >= hit.level) return false;
    if (this.sounding.length >= MAX_VOICES) return false;
    this.sounding.push({ voice: hit.voice, at, end: at + DURATION[hit.voice], level: hit.level });
    return true;
  }

  /** How many sounds ring at this moment. */
  ringing(at: number): number {
    return this.sounding.filter((s) => s.at <= at && s.end > at).length;
  }

  reset(): void {
    this.sounding = [];
  }
}

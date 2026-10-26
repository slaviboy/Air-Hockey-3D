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

// How strong the computer plays, as data (the chess game's difficulty presets, for a hand instead of
// an engine): how late it sees the puck, how fast its mallet moves, how well it predicts where the
// puck will be and aims its own shots, and how readily it goes on the attack. Each level is a
// person with a portrait in the New Game sheet.

export const DIFFICULTY_IDS = ['easy', 'medium', 'hard'] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

export interface Difficulty {
  readonly id: DifficultyId;
  readonly label: string;
  /** A line under the portrait. */
  readonly blurb: string;
  /** How old the puck the computer sees is, seconds: its reaction time. */
  readonly reaction: number;
  /** Its mallet's top speed (m/s) and the most its velocity changes in a second (m/s²). */
  readonly maxSpeed: number;
  readonly accel: number;
  /** How far ahead it predicts the puck's path, seconds. */
  readonly lookahead: number;
  /** The error in where it expects to meet the puck, metres (each decision draws one). */
  readonly predictionNoise: number;
  /** The error in the direction of its shots, radians. */
  readonly aimError: number;
  /** 0–1: how readily it goes for the puck rather than waiting in front of its goal. */
  readonly aggression: number;
  /** How hard it strikes through the puck, m/s. */
  readonly strike: number;
  /** Whether it banks shots off the side rails as well as shooting straight. */
  readonly banks: boolean;
  /** 0–1: how far across the width it follows the puck while waiting, opening the goal's far side. */
  readonly shadow: number;
  /** How far out from its end rail it waits, metres (its mallet's centre). */
  readonly depth: number;
}

export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: 'easy',
    label: 'Easy',
    blurb: 'Slow to react, shoots straight',
    reaction: 0.42,
    maxSpeed: 1.7,
    accel: 11,
    lookahead: 0.4,
    predictionNoise: 0.13,
    aimError: 0.32,
    aggression: 0.3,
    strike: 2.2,
    banks: false,
    shadow: 0.85,
    depth: 0.3,
  },
  {
    id: 'medium',
    label: 'Medium',
    blurb: 'Quick hands, the odd bank shot',
    reaction: 0.34,
    maxSpeed: 2.1,
    accel: 15,
    lookahead: 0.7,
    predictionNoise: 0.1,
    aimError: 0.16,
    aggression: 0.6,
    strike: 3.4,
    banks: true,
    shadow: 0.75,
    depth: 0.27,
  },
  {
    id: 'hard',
    label: 'Hard',
    blurb: 'Reads every bounce, strikes hard',
    reaction: 0.1,
    maxSpeed: 4.2,
    accel: 45,
    lookahead: 1.4,
    predictionNoise: 0.015,
    aimError: 0.06,
    aggression: 0.85,
    strike: 4.6,
    banks: true,
    shadow: 0.3,
    depth: 0.17,
  },
];

export function difficulty(id: DifficultyId): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1]!;
}

export function isDifficultyId(value: unknown): value is DifficultyId {
  return DIFFICULTY_IDS.includes(value as DifficultyId);
}

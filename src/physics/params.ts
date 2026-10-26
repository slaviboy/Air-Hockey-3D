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

// How the puck and the mallets move: the constants of the simulation (docs/physics.md).

import { exp } from './dmath.ts';

/** The simulation's fixed step, seconds. The frame loop decides how many steps a frame takes. */
export const STEP = 1 / 240;

/** The puck's speed kept after bouncing off a rail, across the rail. */
export const RAIL_RESTITUTION = 0.88;
/** Friction against the rail: the tangential speed lost, as a share of the normal impulse. */
export const RAIL_FRICTION = 0.08;
/** The puck's speed kept after a mallet hit, relative to the mallet, across the contact. */
export const MALLET_RESTITUTION = 0.82;
/** Friction between mallet and puck, as for the rails. */
export const MALLET_FRICTION = 0.04;
/** Below this closing speed a contact does not bounce: the puck is pushed along instead. */
export const REST_SPEED = 0.05;

/** The air cushion's drag: the puck's speed falls by this share each second. */
export const DAMPING = 0.12;
/** The speed kept over one step, exp(−DAMPING · STEP). */
export const STEP_DECAY = exp(-DAMPING * STEP);
/** Slower than this, a puck is at rest. */
export const STOP_SPEED = 0.004;

/** The fastest the puck goes: hits beyond it are trimmed, keeping play followable. */
export const MAX_PUCK_SPEED = 6;
/**
 * No mallet moves faster than this, whoever drives it: above every player's and the computer's
 * limit, and below the puck's, so a struck puck always gets away from the mallet that struck it.
 */
export const MAX_MALLET_SPEED = 5.5;
/** A player's mallet: its top speed and how fast its velocity may change. */
export const PLAYER_MALLET = { maxSpeed: 5, accel: 90 } as const;

/**
 * A puck at rest in the band at the centre line, which neither mallet reaches, slides out of it
 * toward the half it is in, as on a table not quite level. Speeds under this are helped along.
 */
export const BAND_DRIFT_SPEED = 0.12;
/** The push out of the band, m/s². */
export const BAND_DRIFT_ACCEL = 0.6;

/** A contact's resolution leaves this gap, so the next step starts apart. */
export const SKIN = 1e-6;
/** Events resolved in one step at most; past it, the bodies are separated directly. */
export const MAX_EVENTS_PER_STEP = 8;

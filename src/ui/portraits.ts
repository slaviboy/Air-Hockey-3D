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

// The computer's portrait (the chess game's opponents): it grows with its strength, from a
// teenager at Easy to a man in his forties at Hard (public/portraits/, from the chess game).

import type { DifficultyId } from '../ai/difficulty.ts';

/** Who stands across the table at each level. */
const SITTERS: Record<DifficultyId, string> = {
  easy: 'a teenager',
  medium: 'a young man',
  hard: 'a man in his forties',
};

export interface Portrait {
  readonly src: string;
  readonly alt: string;
}

/** The computer's portrait at a difficulty. */
export function opponentPortrait(level: DifficultyId): Portrait {
  return {
    src: `${import.meta.env.BASE_URL}portraits/${level}.jpg`,
    alt: `Portrait of ${SITTERS[level]}`,
  };
}

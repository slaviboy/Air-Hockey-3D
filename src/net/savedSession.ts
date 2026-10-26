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

// The online game a tab is playing, kept in sessionStorage (this tab only, gone when it closes) so
// a reload can rejoin. What comes back is checked like anything else from outside, with the game's
// own codec for its terms and its table: a malformed entry counts as no entry.

import { SYNC_TYPE, type SavedSession, type SessionStorage } from './OnlineSession.ts';
import {
  cleanName,
  isInvite,
  isObject,
  isToken,
  type GameCodec,
  type WireMessage,
} from './protocol.ts';

const KEY = 'air-hockey:online';

/** The saved session if the value is exactly one; null for anything else. */
export function parseSaved<M extends WireMessage, S>(
  value: unknown,
  codec: GameCodec<M, S>,
): SavedSession<M, S> | null {
  if (!isObject(value)) return null;
  const s = value;
  if (!isInvite(s.invite)) return null;
  if (s.role !== 'host' && s.role !== 'guest') return null;
  if (!isToken(s.token)) return null;
  if (typeof s.name !== 'string' || typeof s.friendName !== 'string') return null;
  let terms: S | null = null;
  if (s.terms !== null) {
    if (!isObject(s.terms)) return null;
    terms = codec.parseTerms(s.terms);
    if (terms === null) return null;
  }
  let state: M | null = null;
  if (s.state !== null) {
    if (!isObject(s.state) || s.state.t !== SYNC_TYPE) return null;
    state = codec.parse(s.state);
    if (state === null) return null;
  }
  return {
    invite: { secret: s.invite.secret },
    role: s.role,
    token: s.token,
    name: cleanName(s.name, 'Player'),
    friendName: cleanName(s.friendName),
    terms,
    state,
  };
}

/** sessionStorage, quietly doing nothing where storage is blocked. */
export function tabStorage<M extends WireMessage, S>(
  codec: GameCodec<M, S>,
): SessionStorage<M, S> & { load(): SavedSession<M, S> | null } {
  return {
    load() {
      try {
        const raw = sessionStorage.getItem(KEY);
        return raw ? parseSaved(JSON.parse(raw), codec) : null;
      } catch {
        return null;
      }
    },
    save(session) {
      try {
        sessionStorage.setItem(KEY, JSON.stringify(session));
      } catch {
        // Private browsing or full storage: a reload simply cannot rejoin.
      }
    },
    clear() {
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // As above.
      }
    },
  };
}

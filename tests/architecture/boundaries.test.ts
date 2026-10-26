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

// Guard: each outside library has one door into the game. Trystero and peer connections are reached
// only through PeerLink, so the network addresses inside a connection have exactly one place to
// stay private.

import { describe, expect, it } from 'vitest';
import { read, trackedFiles } from './repoFiles.ts';

const sources = () => trackedFiles().filter((f) => /^src\/.*\.ts$/.test(f));

function importers(pattern: RegExp): string[] {
  return sources().filter((file) => pattern.test(read(file)));
}

describe('library boundaries', () => {
  it('only PeerLink imports Trystero', () => {
    const found = importers(/from\s+['"](?:trystero|@trystero-p2p)[^'"]*['"]/);
    expect(found.filter((file) => file !== 'src/net/PeerLink.ts')).toEqual([]);
  });

  it('only PeerLink deals with peer connections, and nothing puts the network on window', () => {
    const outside = sources().filter((f) => f !== 'src/net/PeerLink.ts');
    const offenders = outside.filter((file) =>
      /\bRTCPeerConnection\b|\bgetPeers\s*\(/.test(read(file)),
    );
    expect(offenders).toEqual([]);
    const leaks = sources().filter((file) =>
      /window\s*(?:as[^)]*\))?\s*\.\s*__\w*(?:peer|link|room|net|online)/i.test(read(file)),
    );
    expect(leaks).toEqual([]);
  });
});

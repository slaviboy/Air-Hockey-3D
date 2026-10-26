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

// Stand-ins for cameras, microphones and their streams, for media tests outside a browser.

/** A camera or microphone track with the parts the game uses. */
export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  constructor(readonly kind: 'audio' | 'video') {
    super();
  }
  stop() {
    this.readyState = 'ended';
  }
  mute(on: boolean) {
    this.muted = on;
    this.dispatchEvent(new Event(on ? 'mute' : 'unmute'));
  }
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  readonly tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return this.tracks;
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks.splice(this.tracks.indexOf(t), 1);
  }
}

export const asTrack = (track: FakeTrack) => track as unknown as MediaStreamTrack;
export const asStream = (stream: FakeStream) => stream as unknown as MediaStream;

/** The devices of a test: what was asked for and started, and the options to hand OnlineMedia. */
export function devices(denied = false) {
  const asked: MediaStreamConstraints[] = [];
  const started: FakeTrack[] = [];
  return {
    asked,
    started,
    options: {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        asked.push(constraints);
        if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
        const track = new FakeTrack(constraints.audio ? 'audio' : 'video');
        started.push(track);
        return asStream(new FakeStream([track]));
      },
      createStream: (tracks: MediaStreamTrack[]) =>
        asStream(new FakeStream(tracks as unknown as FakeTrack[])),
    },
  };
}

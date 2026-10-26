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

// The sounds of play: which contacts make which sound, louder for harder impacts; contacts that
// land together fold into one and only so many ring at once; and the synthesiser schedules them
// at their own times within a frame, silent when sound is off. The synthesiser runs against a fake
// AudioContext that records what it is asked to do.

import { describe, expect, it } from 'vitest';
import {
  DURATION,
  HitMixer,
  MAX_VOICES,
  MERGE_WINDOW,
  SILENT_BELOW,
  hitFor,
  loudness,
  type Voice,
} from '../../../src/audio/hitAudio.ts';
import { attack, SAMPLES, SoundManager } from '../../../src/audio/SoundManager.ts';

const VOICES: Voice[] = ['mallet', 'rail', 'post', 'goal'];

describe('the sound of a contact', () => {
  it('grows with the impact, from silence to full, and never falls back', () => {
    for (const voice of VOICES) {
      expect(loudness(voice, 0)).toBe(0);
      expect(loudness(voice, SILENT_BELOW * 0.9)).toBe(0);
      let last = 0;
      for (let speed = 0.02; speed <= 12; speed *= 1.3) {
        const level = loudness(voice, speed);
        expect(level).toBeGreaterThanOrEqual(last);
        expect(level).toBeLessThanOrEqual(1);
        last = level;
      }
      expect(last).toBe(1);
    }
  });

  it('comes from the right event, and none from the score or a serve', () => {
    expect(hitFor({ kind: 'mallet', seat: 0, speed: 2 })?.voice).toBe('mallet');
    expect(hitFor({ kind: 'rail', speed: 1 })?.voice).toBe('rail');
    expect(hitFor({ kind: 'post', speed: 1 })?.voice).toBe('post');
    const goal = hitFor({ kind: 'goal', seat: 0 });
    expect(goal?.voice).toBe('goal');
    expect(goal!.level).toBe(1);
    expect(hitFor({ kind: 'scored', scorer: 1 })).toBeNull();
    expect(hitFor({ kind: 'served', seat: 0 })).toBeNull();
    // A mallet that barely touches the puck makes no sound.
    expect(hitFor({ kind: 'mallet', seat: 1, speed: 0.001 })).toBeNull();
  });
});

describe('the mixer', () => {
  it('folds a softer contact of the same kind landing within the window into the first', () => {
    const mixer = new HitMixer();
    expect(mixer.accept({ voice: 'mallet', level: 0.8 }, 1)).toBe(true);
    expect(mixer.accept({ voice: 'mallet', level: 0.5 }, 1 + MERGE_WINDOW / 2)).toBe(false);
    // A louder one, another kind, or one just outside the window plays.
    expect(mixer.accept({ voice: 'mallet', level: 0.9 }, 1 + MERGE_WINDOW / 2)).toBe(true);
    expect(mixer.accept({ voice: 'rail', level: 0.3 }, 1.001)).toBe(true);
    expect(mixer.accept({ voice: 'mallet', level: 0.2 }, 1 + MERGE_WINDOW * 1.5)).toBe(true);
  });

  it('never lets more than the cap ring at once, and frees voices as they end', () => {
    const mixer = new HitMixer();
    let accepted = 0;
    for (let i = 0; i < 60; i++) {
      if (mixer.accept({ voice: 'goal', level: 1 }, i * (MERGE_WINDOW * 1.1))) accepted++;
      expect(mixer.ringing(i * (MERGE_WINDOW * 1.1))).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(accepted).toBeGreaterThanOrEqual(MAX_VOICES);
    expect(accepted).toBeLessThan(60);
    expect(mixer.accept({ voice: 'goal', level: 1 }, 100 + DURATION.goal)).toBe(true);
  });
});

/** An AudioContext that only remembers what was asked of it. */
class FakeParam {
  value = 0;
  readonly calls: { kind: string; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.calls.push({ kind: 'set', value, at });
    return this;
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    this.calls.push({ kind: 'ramp', value, at });
    return this;
  }
  setTargetAtTime(value: number, at: number) {
    this.value = value;
    this.calls.push({ kind: 'target', value, at });
    return this;
  }
}

class FakeNode {
  connect<T>(node: T): T {
    return node;
  }
}

class FakeContext {
  currentTime = 2;
  state = 'running';
  sampleRate = 8000;
  destination = new FakeNode();
  readonly gains: { gain: FakeParam }[] = [];
  readonly starts: number[] = [];
  createGain() {
    const node = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const starts = this.starts;
    return Object.assign(new FakeNode(), {
      buffer: null as unknown,
      loop: false,
      playbackRate: new FakeParam(),
      start(at = 0) {
        starts.push(at);
      },
      stop() {},
    });
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  createOscillator() {
    const starts = this.starts;
    return Object.assign(new FakeNode(), {
      type: '',
      frequency: new FakeParam(),
      start(at = 0) {
        starts.push(at);
      },
      stop() {},
    });
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
}

function setup() {
  const context = new FakeContext();
  const sound = new SoundManager(() => context as unknown as AudioContext, null);
  return { context, sound };
}

/** The loudest level any gain was set to at the start of the sounds made after `from`. */
const peak = (context: FakeContext, from: number) =>
  Math.max(
    ...context.gains
      .slice(from)
      .flatMap((g) => g.gain.calls.filter((c) => c.kind === 'set').map((c) => c.value)),
  );

describe('the synthesiser', () => {
  it('makes no sound while sound is off, and follows the volume', () => {
    const { context, sound } = setup();
    sound.configure(false, 0.6);
    sound.hit({ voice: 'mallet', level: 1 });
    sound.cue('foul');
    expect(context.starts).toEqual([]);
    sound.configure(true, 0.6);
    sound.hit({ voice: 'mallet', level: 1 });
    expect(context.starts.length).toBeGreaterThan(0);
    // The first gain made is the master volume.
    expect(context.gains[0]!.gain.value).toBeCloseTo(0.6, 9);
  });

  it('keeps the spacing of contacts within a frame, never before now', () => {
    const { context, sound } = setup();
    sound.hit({ voice: 'rail', level: 0.5 }, 0.02);
    const first = Math.min(...context.starts);
    context.starts.length = 0;
    sound.hit({ voice: 'post', level: 0.5 }, 0);
    const second = Math.min(...context.starts);
    expect(second - first).toBeCloseTo(0.02, 9);
    expect(first).toBeGreaterThanOrEqual(context.currentTime);
    context.starts.length = 0;
    // A contact long past is played at once, not in the past.
    sound.hit({ voice: 'mallet', level: 0.5 }, 5);
    expect(Math.min(...context.starts)).toBeGreaterThanOrEqual(context.currentTime);
  });

  it('plays a harder hit louder', () => {
    const { context, sound } = setup();
    sound.hit({ voice: 'mallet', level: 0.1 });
    const soft = peak(context, 1);
    context.currentTime += 1;
    const mark = context.gains.length;
    sound.hit({ voice: 'mallet', level: 0.9 });
    expect(peak(context, mark)).toBeGreaterThan(soft * 3);
  });

  it('caps the voices: contacts beyond the cap are dropped until voices end', () => {
    const { context, sound } = setup();
    // The first sound also sets up the master volume; get that out of the way.
    sound.cue('serve');
    const gainsPerPocket = () => {
      const mark = context.gains.length;
      sound.hit({ voice: 'goal', level: 0.7 });
      return context.gains.length - mark;
    };
    const each = gainsPerPocket();
    // Long-ringing goal sounds, each just outside the merge window of the one before: all ring
    // together, so only the cap decides how many start.
    let started = 1;
    for (let i = 1; i < 30; i++) {
      context.currentTime += MERGE_WINDOW * 1.05;
      if (gainsPerPocket() > 0) started++;
    }
    expect(each).toBeGreaterThan(0);
    expect(started).toBe(MAX_VOICES);
    // Once they have rung out, there is room again.
    context.currentTime += DURATION.goal + 0.1;
    expect(gainsPerPocket()).toBe(each);
  });
});

/** A context that also decodes clips: each "decoded" clip remembers its name and starts with
 * 10 ms of silence, as an MP3 decoder may add. */
class DecodingContext extends FakeContext {
  readonly played: { name: string; at: number; offset: number; rate: number; cutoff?: number }[] =
    [];
  decodeAudioData(bytes: ArrayBuffer) {
    const name = new TextDecoder().decode(bytes);
    const rate = 8000;
    const data = new Float32Array(rate / 5);
    for (let i = 80; i < data.length; i++) data[i] = Math.sin(i) * Math.exp(-(i - 80) / 400);
    return Promise.resolve({
      name,
      sampleRate: rate,
      length: data.length,
      getChannelData: () => data,
    });
  }
  override createBufferSource() {
    const played = this.played;
    let cutoff: number | undefined;
    const source = Object.assign(new FakeNode(), {
      buffer: null as { name: string } | null,
      loop: false,
      playbackRate: new FakeParam(),
      connect(node: { frequency?: FakeParam }) {
        if (node.frequency) cutoff = node.frequency.value;
        return node;
      },
      start(at = 0, offset = 0) {
        if (source.buffer) {
          played.push({
            name: source.buffer.name,
            at,
            offset,
            rate: source.playbackRate.value,
            cutoff,
          });
        }
      },
      stop() {},
    });
    return source;
  }
}

async function loadedSound() {
  const context = new DecodingContext();
  const sound = new SoundManager(
    () => context as unknown as AudioContext,
    null,
    (name) => Promise.resolve(new TextEncoder().encode(name).buffer as ArrayBuffer),
  );
  // The first sound makes the context, which starts loading the clips; that one is synthesised.
  sound.cue('serve');
  for (let i = 0; i < 5 && sound.loaded === 0; i++) await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { context, sound };
}

describe('the recorded hits', () => {
  it('loads every clip and plays the one for the situation', async () => {
    const { context, sound } = await loadedSound();
    expect(sound.loaded).toBe(new Set(Object.values(SAMPLES).flat()).size);
    const kinds: [Voice, number, readonly string[]][] = [
      ['mallet', 0.5, SAMPLES.mallet],
      ['mallet', 0.95, SAMPLES.malletHard],
      ['rail', 0.5, SAMPLES.rail],
      ['post', 0.5, SAMPLES.post],
      ['goal', 0.5, SAMPLES.goal],
    ];
    for (const [voice, level, set] of kinds) {
      context.currentTime += 1;
      sound.hit({ voice, level });
      expect(set).toContain(context.played.at(-1)!.name);
    }
  });

  it('starts each clip where its hit begins, skipping the silence ahead of it', async () => {
    const { context, sound } = await loadedSound();
    sound.hit({ voice: 'rail', level: 0.6 });
    const offset = context.played.at(-1)!.offset;
    // The hit begins at sample 80 of 8000 per second: 10 ms, less a millisecond of lead-in.
    expect(offset).toBeGreaterThan(0.008);
    expect(offset).toBeLessThan(0.0101);
  });

  it('darkens soft clacks and varies the pitch a little round the puck’s', async () => {
    const { context, sound } = await loadedSound();
    sound.hit({ voice: 'mallet', level: 0.2 });
    const soft = context.played.at(-1)!;
    context.currentTime += 1;
    sound.hit({ voice: 'mallet', level: 0.7 });
    const firm = context.played.at(-1)!;
    expect(soft.cutoff!).toBeLessThan(firm.cutoff!);
    // The two clicks only: the context has also played the noise of a synthesised sound, whose
    // rate varies more (0.94 to 1.06) and once in a dozen runs fell below these bounds.
    // A puck is lighter than a ball: its clacks play 6 % higher than the clips.
    for (const p of [soft, firm]) {
      expect(p.rate).toBeGreaterThanOrEqual(0.97 * 1.06);
      expect(p.rate).toBeLessThanOrEqual(1.03 * 1.06);
    }
  });

  it('falls back to synthesis when no clip has loaded', () => {
    const { context, sound } = setup();
    sound.hit({ voice: 'goal', level: 0.7 });
    expect(context.starts.length).toBeGreaterThan(0);
    expect(sound.loaded).toBe(0);
  });
});

describe('the attack of a clip', () => {
  it('is found just before the first loud sample', () => {
    const data = new Float32Array(1000);
    data[400] = 0.5;
    data[401] = -1;
    const buffer = { sampleRate: 1000, getChannelData: () => data } as unknown as AudioBuffer;
    expect(attack(buffer)).toBeCloseTo(0.399, 9);
  });
});

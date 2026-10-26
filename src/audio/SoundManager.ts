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

// The game's sounds (Pool's sound manager). Every contact plays a recorded hit, chosen for what
// happened and how hard:
//
//   mallet  the hard plastic of a mallet on the puck: one of five clacks, darkened for a soft hit;
//           a sharper crack for a very hard one.
//   rail    the puck into a rail: one of four thumps.
//   post    the puck off the rounded edge of a goal slot: a sharp knock.
//   goal    the puck dropping through the slot into the return.
//
// Each plays a few per cent higher or lower than recorded, so that repeats never sound alike. The
// hits are short clips cut from free recordings (public/sounds; docs/sounds.md says which and
// NOTICE.md where from), loaded when audio starts. Until they have loaded, or if they cannot be,
// the sounds are synthesised instead, as in the chess game. The table's blower hums quietly while
// a match is on, with the hiss of the puck on its air rising as it slides faster, and a few
// synthesised notes mark the game (a goal for this player or against them, a foul, a serve, the
// match won). Audio starts after the first click or key press, as browsers require; sounds wait
// while the page is hidden.

import { HitMixer, type Hit, type Voice } from './hitAudio.ts';

export type Cue = 'goal' | 'conceded' | 'foul' | 'serve' | 'match';

/** How far ahead of now sounds are scheduled, so that a frame's contacts keep their spacing. */
const LEAD = 0.03;

/** The recorded clips (public/sounds/<name>.mp3), by what they are played for. */
export const SAMPLES = {
  mallet: ['mallet-1', 'mallet-2', 'mallet-3', 'mallet-4', 'mallet-5'],
  malletHard: ['mallet-hard'],
  rail: ['rail-1', 'rail-2', 'rail-3', 'rail-4'],
  post: ['post-1', 'rail-3'],
  goal: ['goal-1', 'goal-2'],
} as const;

type SampleSet = keyof typeof SAMPLES;

/** Fetches a clip's encoded bytes by name. */
export type SampleSource = (name: string) => Promise<ArrayBuffer>;

interface Sample {
  readonly buffer: AudioBuffer;
  /** Where the hit begins in the decoded clip (decoders may add silence ahead of it), seconds. */
  readonly offset: number;
}

/** A mallet hit at least this loud uses the harder crack. */
const HARD_HIT = 0.82;

export class SoundManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private air: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private readonly mixer = new HitMixer();
  private readonly samples = new Map<string, Sample>();
  private volume = 0.8;
  private on = true;
  /** Whether the context may be made on demand (no page to wait for a click on, as in tests). */
  private readonly onDemand: boolean;

  constructor(
    private readonly createContext: () => AudioContext | null = defaultContext,
    target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window ===
    'undefined'
      ? null
      : window,
    private readonly source: SampleSource | null = null,
  ) {
    this.onDemand = target === null;
    if (!target) return;
    // Browsers let audio start only after the player has done something; until then, silence.
    const unlock = () => {
      void this.ensure()?.resume();
      target.removeEventListener('pointerdown', unlock);
      target.removeEventListener('keydown', unlock);
    };
    target.addEventListener('pointerdown', unlock);
    target.addEventListener('keydown', unlock);
  }

  /** Sound on or off, and the volume (0–1). */
  configure(on: boolean, volume: number): void {
    this.on = on;
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.on ? this.volume : 0, this.context.currentTime, 0.02);
    }
    if (!on) this.setAir(false, 0);
  }

  /** How many recorded clips are ready to play. */
  get loaded(): number {
    return this.samples.size;
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    const ctx = this.createContext();
    if (!ctx) return null;
    this.context = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.on ? this.volume : 0;
    this.master.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    void this.loadSamples(ctx);
    return ctx;
  }

  /** Fetches and decodes every clip; one that fails is simply left to the synthesiser. */
  private async loadSamples(ctx: AudioContext): Promise<void> {
    const source = this.source;
    if (!source) return;
    const names = new Set(Object.values(SAMPLES).flat());
    await Promise.all(
      [...names].map(async (name) => {
        try {
          const buffer = await ctx.decodeAudioData(await source(name));
          this.samples.set(name, { buffer, offset: attack(buffer) });
        } catch {
          // Not available: the synthesised sound stands in.
        }
      }),
    );
  }

  /** The context, when sound may play now. */
  private ready(): AudioContext | null {
    if (!this.on) return null;
    const ctx = this.onDemand ? this.ensure() : this.context;
    if (!ctx || ctx.state !== 'running') return null;
    if (typeof document !== 'undefined' && document.hidden) return null;
    return ctx;
  }

  /**
   * A contact, which happened `ago` seconds before this frame: it is scheduled the same time before
   * the frame after next, so the contacts of a frame keep their spacing (a rattle stays a rattle,
   * not a buzz in step with the frames).
   */
  hit(hit: Hit, ago = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    const at = ctx.currentTime + Math.max(0, LEAD - Math.max(0, ago));
    if (!this.mixer.accept(hit, at)) return;
    this.voice(hit.voice, at, hit.level);
  }

  /**
   * The table's blower while a match is on, and the hiss of the puck sliding on its air at
   * `speed` (m/s).
   */
  setAir(on: boolean, speed: number): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const level = this.on && on ? 0.018 + Math.min(1, speed / 5) * 0.05 : 0;
    if (!this.air) {
      if (level === 0 || ctx.state !== 'running') return;
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      this.air = { gain, filter };
    }
    const now = ctx.currentTime;
    this.air.gain.gain.setTargetAtTime(level, now, 0.08);
    this.air.filter.frequency.setTargetAtTime(220 + 900 * Math.min(1, speed / 5), now, 0.05);
  }

  /** A note for the game. */
  cue(cue: Cue): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    switch (cue) {
      case 'goal':
        // After the drop into the return.
        [523, 659, 784].forEach((f, i) => this.tone(t + 0.25 + i * 0.08, f, 0.7, 0.07));
        break;
      case 'conceded':
        this.tone(t + 0.25, 330, 0.25, 0.06, 'triangle');
        this.tone(t + 0.37, 262, 0.35, 0.06, 'triangle');
        break;
      case 'foul':
        this.tone(t, 233, 0.22, 0.07, 'triangle');
        this.tone(t + 0.12, 196, 0.3, 0.07, 'triangle');
        break;
      case 'serve':
        this.knock(t, 0.25, 1800, 6, 0.03);
        break;
      case 'match':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(t + 0.3 + i * 0.11, f, 1.2, 0.08));
        break;
    }
  }

  /**
   * Plays one of a set's clips (a random one) at time t; false when none has loaded. `pitch`
   * scales the playback rate; `brightness`, when given, is a low-pass cutoff in hertz.
   */
  private play(set: SampleSet, t: number, gain: number, pitch = 1, brightness?: number): boolean {
    const ctx = this.context;
    if (!ctx || !this.master) return false;
    const ready = SAMPLES[set].map((name) => this.samples.get(name)).filter((s) => s !== undefined);
    if (ready.length === 0) return false;
    const sample = ready[Math.floor(Math.random() * ready.length)]!;
    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = pitch * (0.97 + Math.random() * 0.06);
    const level = ctx.createGain();
    level.gain.value = Math.max(0, Math.min(1.2, gain));
    let head: AudioNode = source;
    if (brightness !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = brightness;
      filter.Q.value = 0.5;
      head = head.connect(filter);
    }
    head.connect(level).connect(this.master);
    source.start(t, sample.offset);
    return true;
  }

  /** A contact's sound, from its level 0–1: a recorded hit when one has loaded. */
  private voice(voice: Voice, t: number, level: number): void {
    switch (voice) {
      case 'mallet':
        // Soft hits are darker as well as quieter; a puck is lighter than a ball, so a little higher.
        if (
          this.play(
            level >= HARD_HIT ? 'malletHard' : 'mallet',
            t,
            0.1 + 0.9 * level,
            1.06,
            1800 + 16000 * level * level,
          )
        )
          return;
        break;
      case 'rail':
        if (this.play('rail', t, 0.15 + 0.75 * level, 1.08)) return;
        break;
      case 'post':
        if (this.play('post', t, 0.15 + 0.7 * level, 1.15)) return;
        break;
      case 'goal':
        if (this.play('goal', t, 0.35 + 0.6 * level)) return;
        break;
    }
    this.synthesise(voice, t, level);
  }

  /** A burst of noise through a band filter, falling away: the body of every synthesised hit. */
  private knock(
    t: number,
    level: number,
    frequency: number,
    q: number,
    decay: number,
    type: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.94 + Math.random() * 0.12;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, level), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    source.connect(filter).connect(gain).connect(this.master!);
    // Start partway into the noise, so that no two contacts sound exactly alike.
    source.start(t, Math.random() * 0.4);
    source.stop(t + decay + 0.02);
  }

  private tone(
    t: number,
    frequency: number,
    duration: number,
    level: number,
    type: OscillatorType = 'sine',
    endFrequency = frequency,
  ): void {
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (endFrequency !== frequency)
      osc.frequency.exponentialRampToValueAtTime(endFrequency, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, level), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.air = null;
  }

  /** A synthesised hit, from its level 0–1. Hard hits are brighter as well as louder. */
  private synthesise(voice: Voice, t: number, level: number): void {
    switch (voice) {
      case 'mallet':
        this.knock(t, 0.9 * level, 3200 + 2600 * level, 1.6, 0.03 + 0.02 * level);
        this.tone(t, 2400 + 500 * Math.random(), 0.035 + 0.025 * level, 0.18 * level);
        this.tone(t, 1150, 0.03, 0.08 * level);
        break;
      case 'rail':
        this.knock(t, 0.7 * level, 380, 0.9, 0.09, 'lowpass');
        this.tone(t, 115, 0.11, 0.35 * level, 'sine', 80);
        this.knock(t, 0.15 * level, 900, 2, 0.03);
        break;
      case 'post':
        this.knock(t, 0.8 * level, 950, 2.4, 0.06);
        this.tone(t, 160, 0.09, 0.3 * level, 'sine', 110);
        break;
      case 'goal': {
        // Through the slot, down the chute, and settling in the return.
        const l = 0.35 + 0.65 * level;
        this.knock(t, 0.25 * l, 1100, 2, 0.03);
        this.knock(t + 0.11, 0.8 * l, 260, 0.8, 0.16, 'lowpass');
        this.tone(t + 0.11, 150, 0.2, 0.45 * l, 'sine', 85);
        this.knock(t + 0.24, 0.18 * l, 2600, 2, 0.025);
        this.knock(t + 0.31, 0.08 * l, 2900, 2, 0.02);
        break;
      }
    }
  }
}

/** Where a decoded clip's hit begins: 1 ms before its first sample above a tenth of its peak. */
export function attack(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  let i = 0;
  while (i < data.length && Math.abs(data[i]!) < 0.1 * peak) i++;
  return Math.max(0, i / buffer.sampleRate - 0.001);
}

function defaultContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

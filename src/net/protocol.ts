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

// What two players' browsers say to each other in an online game, and the invitation link that
// brings them together. This file holds the session's envelope, the messages any game needs (who
// is there, the host's terms, giving up, a rematch, leaving, media); the game adds its own through
// a codec (src/game/gameMessages.ts for 8-ball). Everything that arrives from the other player is
// untrusted: parseMessage accepts only the exact shapes below, or the codec's, and drops anything
// else, so a modified client can never push an unexpected field or type into the game.

export const PROTOCOL_VERSION = 1;
/** No message is longer; anything bigger is dropped before it is read. */
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_NAME_LENGTH = 24;
/** A counter no real session comes near (shots, rejoins): anything beyond it is nonsense. */
export const MAX_COUNT = 1_000_000;

/** Anything sent over the link: a plain object with a type. */
export interface WireMessage {
  readonly t: string;
}

export type SessionMessage<S> =
  /**
   * Sent by both sides when the connection opens: the protocol and the build (players on different
   * builds might not simulate alike), the name, and the guest's token once it has one.
   */
  | {
      readonly t: 'hello';
      readonly v: number;
      readonly build: string;
      readonly name: string;
      readonly token?: string;
    }
  /** The host's terms for the match, and the guest's token for rejoining. */
  | { readonly t: 'setup'; readonly token: string; readonly terms: S }
  /** After shot `n` the sender's table differs from the one the other side reported. */
  | { readonly t: 'desync'; readonly n: number }
  /** The sender gives up the match. */
  | { readonly t: 'resign' }
  /** The sender wants a rematch, or accepts the one it was offered. */
  | { readonly t: 'rematch' }
  /** Whether the sender's microphone and camera are on. */
  | { readonly t: 'media'; readonly mic: boolean; readonly cam: boolean }
  /** The sender is leaving the game. */
  | { readonly t: 'bye' };

/** The message types the session itself handles; a game's codec may not use them. */
export const SESSION_TYPES: readonly string[] = [
  'hello',
  'setup',
  'desync',
  'resign',
  'rematch',
  'media',
  'bye',
];

export type Raw = Record<string, unknown>;

/** How a game reads its own messages and its host's terms. */
export interface GameCodec<M extends WireMessage, S> {
  /** One of the game's messages, exactly; null for anything else. Never sees a session type. */
  parse(data: Raw): M | null;
  /** The host's terms, from a setup message without its `t` and `token`. */
  parseTerms(data: Raw): S | null;
}

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const BUILD = /^[A-Za-z0-9._-]{1,40}$/;

export const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** True when the object has exactly these keys: no more, no fewer (optional ones may be absent). */
export function hasKeys(
  value: Raw,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((k) => Object.hasOwn(value, k)) &&
    keys.every((k) => required.includes(k) || optional.includes(k))
  );
}

/** A whole number from lo to hi. */
export const isInt = (value: unknown, lo: number, hi: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;

/**
 * A display name made safe: control and formatting characters (including the ones that reverse
 * text) are removed, spaces are collapsed, and it is cut to the maximum length.
 */
export function cleanName(value: string, fallback = 'Friend'): string {
  const cleaned = value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, MAX_NAME_LENGTH).join('').trim() || fallback;
}

/** The setup message as it travels: the terms beside the type and the token. */
export function setupMessage<S extends object>(token: string, terms: S): WireMessage {
  return { ...terms, t: 'setup', token };
}

/**
 * The message, if the data is exactly one of the session's shapes or one of the game's; null for
 * anything else.
 */
export function parseMessage<M extends WireMessage, S>(
  data: unknown,
  codec: GameCodec<M, S>,
): SessionMessage<S> | M | null {
  if (!isObject(data) || typeof data.t !== 'string') return null;
  switch (data.t) {
    case 'hello': {
      if (!hasKeys(data, ['t', 'v', 'build', 'name'], ['token'])) return null;
      if (!isInt(data.v, 1, 1000) || typeof data.name !== 'string') return null;
      if (typeof data.build !== 'string' || !BUILD.test(data.build)) return null;
      if (data.name.length > MAX_NAME_LENGTH * 4) return null;
      if (data.token !== undefined && !isToken(data.token)) return null;
      return {
        t: 'hello',
        v: data.v,
        build: data.build,
        name: cleanName(data.name),
        ...(data.token !== undefined ? { token: data.token as string } : {}),
      };
    }
    case 'setup': {
      if (!isToken(data.token)) return null;
      const rest: Raw = {};
      for (const key of Object.keys(data)) {
        if (key !== 't' && key !== 'token') rest[key] = data[key];
      }
      const terms = codec.parseTerms(rest);
      return terms === null ? null : { t: 'setup', token: data.token, terms };
    }
    case 'desync':
      if (!hasKeys(data, ['t', 'n']) || !isInt(data.n, 0, MAX_COUNT)) return null;
      return { t: 'desync', n: data.n };
    case 'resign':
    case 'rematch':
    case 'bye':
      return hasKeys(data, ['t']) ? { t: data.t } : null;
    case 'media':
      if (!hasKeys(data, ['t', 'mic', 'cam'])) return null;
      if (typeof data.mic !== 'boolean' || typeof data.cam !== 'boolean') return null;
      return { t: 'media', mic: data.mic, cam: data.cam };
    default: {
      const message = codec.parse(data);
      return message && !SESSION_TYPES.includes(message.t) ? message : null;
    }
  }
}

// --- the invitation link ---------------------------------------------------------------------

/**
 * An invitation: one random secret, which lives only in the link's hash (browsers never send the
 * hash to the web server). It encrypts the handshake and proves a player was invited, and the
 * room the two meet in is derived from it, so the link carries nothing else and stays short.
 */
export interface Invite {
  readonly secret: string;
}

const SECRET = /^[A-Za-z0-9_-]{22}$/;
const INVITE_HASH = /^#g=([A-Za-z0-9_-]{22})$/;

/** Random bytes as unpadded base64url. */
export function randomId(bytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * A fresh invitation: 128 random bits, far beyond guessing, in 22 characters, so the link and
 * its QR code stay small.
 */
export function createInvite(): Invite {
  return { secret: randomId(16) };
}

/**
 * The room the two players meet in on the relays, derived one way from the secret: the same for
 * both, different for every game, and telling nothing about the secret.
 */
export async function roomFor(invite: Invite): Promise<string> {
  const data = new TextEncoder().encode(`air-hockey room:${invite.secret}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return base64url(digest.subarray(0, 16));
}

/** A token the host gives its guest, so only that guest can take the seat back after a reload. */
export function createToken(): string {
  return randomId(16);
}

export function isInvite(value: unknown): value is Invite {
  return isObject(value) && typeof value.secret === 'string' && SECRET.test(value.secret);
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

/**
 * The link to send: the page's address without its query or hash (the friend keeps their own
 * settings), and the invitation in the hash.
 */
export function inviteUrl(page: string, invite: Invite): string {
  const url = new URL(page);
  return `${url.origin}${url.pathname}#g=${invite.secret}`;
}

/** The invitation in a location hash, if it is exactly one; null for anything else. */
export function parseInvite(hash: string): Invite | null {
  const match = INVITE_HASH.exec(hash);
  return match ? { secret: match[1]! } : null;
}

/**
 * The invitation in something a player pasted: the whole link, or just its `#g=…` part; null if
 * there is none.
 */
export function inviteFromText(text: string): Invite | null {
  const trimmed = text.trim();
  const at = trimmed.indexOf('#');
  return at < 0 ? null : parseInvite(trimmed.slice(at));
}

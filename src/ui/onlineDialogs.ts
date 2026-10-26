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

// The dialogs of online play (Pool's): the host's terms, the warning every player must accept
// before anything connects, the invitation link to send (with a QR code), a link to paste, the
// wait while connecting, and the other player's offers.

import type { Settings } from '../app/Settings.ts';
import type { Store } from '../core/Store.ts';
import type { OnlineState } from '../net/OnlineSession.ts';
import { MAX_NAME_LENGTH, cleanName, inviteFromText, type Invite } from '../net/protocol.ts';
import { TARGETS } from '../rules/match.ts';
import type { Reach } from '../table/geometry.ts';
import { el, openDialog } from './Dialog.ts';
import { segmented } from './modern/controls.ts';
import { zonePicker } from './modern/zonePicker.ts';
import type { HostTerms } from './online/hooks.ts';
import { qrCode } from './qr.ts';

export type ConsentKind = 'host' | 'guest' | 'rejoin' | 'rematch';

const INTRO: Record<ConsentKind, string> = {
  host: 'You will get a link to send to your friend. The match starts when they open it.',
  guest: 'You were invited to play air hockey online.',
  rejoin: 'You were playing an online match in this tab. Join it again?',
  rematch: 'Play another match against the same player?',
};

const TITLE: Record<ConsentKind, string> = {
  host: 'Play a friend online',
  guest: 'Join an online game',
  rejoin: 'Rejoin the online game',
  rematch: 'Rematch',
};

const CONTINUE: Record<ConsentKind, string> = {
  host: 'Create link',
  guest: 'Join game',
  rejoin: 'Rejoin',
  rematch: 'Rematch',
};

function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** A text field with its label. */
function field(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'field');
  row.append(el('span', '', label), control);
  return row;
}

/**
 * A row of choices with its heading. Not a <label>: that would name the first button after it
 * (the group carries its own name).
 */
function choices(label: string, control: HTMLElement): HTMLElement {
  const row = el('div', 'field');
  row.append(el('span', '', label), control);
  return row;
}

/**
 * The host's terms for an online match, as for a match on one device: the goals to win, the
 * mallets' zone (the same for both players) and the first serve; null when cancelled.
 */
export function onlineTermsDialog(settings: Settings): Promise<HostTerms | null> {
  return openDialog<HostTerms | null>('Play a friend online', null, ({ body, root, close }) => {
    root.classList.add('online-dialog');
    let target = String(settings.target);
    let reach: Reach = settings.reach;
    let server: 'toss' | 'host' | 'guest' = 'toss';
    const targets = segmented(
      'Goals to win',
      TARGETS.map((t) => [String(t), String(t)] as const),
      target,
      (v) => (target = v),
    );
    const zone = zonePicker(reach, (value) => (reach = value));
    const servers = segmented(
      'First serve',
      [
        ['toss', 'Coin toss'],
        ['host', 'You'],
        ['guest', 'Your friend'],
      ] as const,
      server,
      (v) => (server = v),
    );
    body.append(
      el('p', 'online-intro', 'Choose the match, then send your friend the link.'),
      choices('Goals to win', targets.element),
      choices('Mallet zone, the same for you both', zone.element),
      choices('First serve', servers.element),
    );
    const actions = el('div', 'dialog-actions');
    actions.append(
      button('Continue', () =>
        close({
          target: Number(target),
          reach,
          firstServe: server === 'toss' ? 'toss' : server === 'host' ? 0 : 1,
        }),
      ),
      button('Cancel', () => close(null), 'btn btn-quiet'),
    );
    body.append(actions);
  });
}

/** A link a friend sent, pasted in; null when cancelled. */
export function joinDialog(): Promise<Invite | null> {
  return openDialog<Invite | null>('Join a game', null, ({ body, root, close }) => {
    root.classList.add('online-dialog');
    const input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'https://…#g=…';
    input.setAttribute('aria-label', 'Game link');
    const error = el('p', 'online-status online-error');
    error.setAttribute('role', 'alert');
    const go = () => {
      const invite = inviteFromText(input.value);
      if (invite) close(invite);
      else error.textContent = 'That is not a game link. Copy the whole link your friend sent.';
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') go();
    });
    const actions = el('div', 'dialog-actions');
    actions.append(
      button('Join', go),
      button('Cancel', () => close(null), 'btn btn-quiet'),
    );
    body.append(
      el('p', 'online-intro', 'Paste the link your friend sent you, or simply open it.'),
      field('Game link', input),
      error,
      actions,
    );
  });
}

/**
 * The warning before any online game: the other player can find this computer's IP address, links
 * are for people the player trusts, and online play is for adults only. The 18+ box starts
 * unticked every time and nothing is remembered; Continue stays off until it is ticked. Resolves
 * with the player's name, or null if they back out (Cancel, X or Escape; a tap beside the dialog
 * would drop the invitation, so it does nothing). Nothing connects before this resolves.
 */
export function consentDialog(kind: ConsentKind, name: string): Promise<{ name: string } | null> {
  return openDialog<{ name: string } | null>(
    TITLE[kind],
    null,
    ({ body, root, close }) => {
      root.classList.add('online-dialog');
      const intro = el('p', 'online-intro', INTRO[kind]);

      const nameInput = el('input');
      nameInput.type = 'text';
      nameInput.maxLength = MAX_NAME_LENGTH;
      nameInput.autocomplete = 'off';
      nameInput.spellcheck = false;
      nameInput.value = name;
      const nameField = field('Your name (the other player sees it)', nameInput);

      const warning = el('div', 'online-warning');
      warning.setAttribute('role', 'note');
      const points = el('ul');
      const point = (strong: string, rest: string) => {
        const item = el('li');
        item.append(el('strong', '', strong), document.createTextNode(` ${rest}`));
        points.append(item);
      };
      point(
        'The other player will be able to find your IP address',
        '(your approximate location and internet provider): online play connects your device ' +
          'directly to theirs. Share game links only with people you know and trust.',
      );
      point(
        'Video and voice chat',
        'show your camera and microphone to the other player, but only after you turn them on. ' +
          'You can hang up at any time; the match goes on.',
      );
      point('Online play is for adults only.', 'Not for children.');
      warning.append(el('div', 'online-warning-title', 'Before you play online'), points);

      const consent = el('label', 'online-consent');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = false;
      box.required = true;
      consent.append(
        box,
        el(
          'span',
          '',
          'I am 18 or older and understand that my IP address will be visible to the other player.',
        ),
      );

      const go = button(CONTINUE[kind], () => {
        if (!box.checked) return;
        close({ name: cleanName(nameInput.value, 'Player') });
      });
      go.disabled = true;
      box.addEventListener('change', () => (go.disabled = !box.checked));
      const cancel = button('Cancel', () => close(null), 'btn btn-quiet');
      const actions = el('div', 'dialog-actions');
      actions.append(go, cancel);
      body.append(intro, nameField, warning, consent, actions);
    },
    { backdropCloses: false },
  );
}

export type WaitResult = 'playing' | 'cancelled' | 'failed';

/**
 * Waits for the other player: for the host it shows the invitation link with a Copy button and as
 * a QR code to scan, for the guest only the progress. Closes by itself when the game starts.
 * Cancel (or Escape) resolves 'cancelled'; a connection that fails shows why and resolves 'failed'
 * when dismissed. A tap beside it does nothing: closing ends the game the friend may be opening.
 */
export function waitDialog(state: Store<OnlineState>, link: string | null): Promise<WaitResult> {
  let unsubscribe = () => {};
  const done = openDialog<WaitResult>(
    link ? 'Invite a friend' : 'Joining the game',
    'cancelled',
    ({ body, root, close }) => {
      root.classList.add('online-dialog');
      if (link) {
        body.append(el('p', '', 'Send this link to your friend. It is for this match only.'));
        const row = el('div', 'online-link');
        const input = el('input');
        input.type = 'text';
        input.readOnly = true;
        input.value = link;
        // No width of its own (20 characters by default): the row gives it what is left beside
        // Copy, so it never pushes past the dialog's edge on a narrow screen.
        input.size = 1;
        input.setAttribute('aria-label', 'Game link');
        // setSelectionRange, not select(): iPhones ignore select() on a read-only field.
        const selectAll = () => input.setSelectionRange(0, input.value.length);
        input.addEventListener('focus', selectAll);
        const copy = button('Copy', () => {
          selectAll();
          void navigator.clipboard
            ?.writeText(link)
            .then(() => (copy.textContent = 'Copied'))
            .catch(() => (copy.textContent = 'Press Ctrl+C'));
        });
        copy.setAttribute('autofocus', '');
        row.append(input, copy);
        const figure = el('figure', 'online-qr');
        const code = el('div', 'online-qr-code');
        code.setAttribute('role', 'img');
        code.setAttribute('aria-label', 'QR code of the game link');
        const qr = qrCode(link);
        code.innerHTML = qr.svg;
        // Large, with whole pixels per module so every edge is sharp: about 5 px per module on a
        // computer and 4 on a phone, which cameras read at a glance.
        const target = Math.min(300, window.innerWidth * 0.62, window.innerHeight * 0.36);
        code.style.width = `${Math.max(3, Math.floor(target / qr.total)) * qr.total}px`;
        figure.append(
          code,
          el('figcaption', '', "Or let your friend scan it with their phone's camera."),
        );
        body.append(
          figure,
          row,
          el('p', 'online-reminder', 'Only share it with people you trust.'),
        );
      }
      const status = el('p', 'online-status');
      status.setAttribute('role', 'status');
      const cancel = button('Cancel', () => close('cancelled'), 'btn btn-quiet');
      const actions = el('div', 'dialog-actions');
      actions.append(cancel);
      body.append(status, actions);
      unsubscribe = state.subscribe((s) => {
        if (s.status === 'playing') {
          close('playing');
        } else if (s.status === 'failed' || s.status === 'closed') {
          status.textContent = s.message ?? 'The connection closed.';
          status.classList.add('online-error');
          cancel.textContent = 'Close';
          cancel.onclick = () => close('failed');
        } else {
          // A failed attempt leaves the host waiting, with a note on what happened.
          status.textContent =
            s.message ??
            (s.status === 'waiting' ? 'Waiting for your friend to open the link…' : 'Connecting…');
        }
      });
    },
    { backdropCloses: false },
  );
  return done.finally(() => unsubscribe());
}

/** The other player offers something, or something needs an answer; resolves true to accept. */
export function offerDialog(
  title: string,
  message: string,
  accept: string,
  decline = 'No, thanks',
): Promise<boolean> {
  return openDialog<boolean>(title, false, ({ body, root, close }) => {
    root.classList.add('online-dialog');
    const actions = el('div', 'dialog-actions');
    actions.append(
      button(accept, () => close(true)),
      button(decline, () => close(false), 'btn btn-quiet'),
    );
    body.append(el('p', '', message), actions);
  });
}

/** A note that needs no answer but must be seen (the online game is over, and why). */
export function noticeDialog(title: string, message: string): Promise<void> {
  return openDialog<void>(title, undefined, ({ body, root, close }) => {
    root.classList.add('online-dialog');
    const actions = el('div', 'dialog-actions');
    actions.append(button('OK', () => close()));
    body.append(el('p', '', message), actions);
  });
}

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

// Two players in two browser windows, connected from an invitation link over the real network
// (public Nostr relays find the two, then WebRTC connects them directly), as in Pool's. These
// tests need the internet, so they are kept out of CI. The development hook is gone during an
// online game, so the players move their mallets from the keyboard, and the match is read from
// the connection chip.

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

/** Addresses and connection details that must never reach the console. */
const LEAKS = [
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b(?:[0-9a-f]{1,4}:){3,}[0-9a-f]{0,4}\b/i,
  /candidate:/i,
  /\bv=0\b|a=ice-|a=fingerprint/,
];

test.skip(!!process.env.CI, 'needs the internet: public relays introduce the two players');
// Chromium's own test camera and microphone, allowed without a prompt.
test.use({
  launchOptions: {
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});
// The relays are public and sometimes slow to introduce the two, and two 3D pages in software
// rendering load a busy machine: a generous limit, and one more try before failing.
test.describe.configure({ timeout: 360_000, retries: 1 });

/** Counts peer connections, sockets and device requests from the first script on. */
async function countNetwork(page: Page) {
  await page.addInitScript(() => {
    const counts = { peers: 0, sockets: 0, devices: 0 };
    const ask = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (ask) {
      navigator.mediaDevices.getUserMedia = (constraints) => {
        counts.devices++;
        return ask(constraints);
      };
    }
    (window as unknown as { __testNetwork: typeof counts }).__testNetwork = counts;
    const Peer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
        super(...args);
        counts.peers++;
      }
    };
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args: ConstructorParameters<typeof WebSocket>) {
        super(...args);
        counts.sockets++;
      }
    };
  });
}

const network = (page: Page) =>
  page.evaluate(() => {
    const { peers, sockets } = (
      window as unknown as { __testNetwork: { peers: number; sockets: number } }
    ).__testNetwork;
    return { peers, sockets };
  });

const deviceRequests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __testNetwork: { devices: number } }).__testNetwork.devices,
  );

/** A player's window, at the main menu (or at an invitation); `clockMs` sets its clock off. */
/** Each test's windows, closed after it: two 3D pages left open would slow the next test's. */
const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});

async function player(browser: Browser, url = './', clockMs = 0) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  if (clockMs) {
    await page.addInitScript((offset) => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + offset;
    }, clockMs);
  }
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    logs.push(m.text());
    // The game's own word on why an online game ended, in the test's output.
    if (m.text().startsWith('online:')) {
      console.info(`[${url === './' ? 'host' : 'guest'}] ${m.text()}`);
    }
    // A public relay that is down or busy is the browser's complaint, not the game's.
    if (m.type() === 'error' && !/WebSocket connection to 'wss:/.test(m.text())) {
      errors.push(m.text());
    }
  });
  await countNetwork(page);
  await page.goto(url);
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached({ timeout: 60_000 });
  return { page, errors, logs, chip: page.getByTestId('online') };
}

type Side = Awaited<ReturnType<typeof player>>;

async function accept(page: Page, title: string, name: string, button: string) {
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  const go = dialog.getByRole('button', { name: button, exact: true });
  const box = dialog.getByRole('checkbox');
  await expect(box).not.toBeChecked();
  await expect(go).toBeDisabled();
  await dialog.getByRole('textbox').fill(name);
  await box.check();
  await expect(go).toBeEnabled();
  await go.click();
}

/** The host asks for an online match (the host serving first) and returns the link. */
async function createLink(page: Page, zone = 'Half'): Promise<string> {
  await page.locator('.mode-card[data-mode="online"]').click();
  const terms = page.getByRole('dialog', { name: 'Play a friend online' });
  const choose = (group: string, name: string) =>
    terms
      .getByRole('radiogroup', { name: group })
      .getByRole('radio', { name, exact: true })
      .click();
  await choose('First serve', 'You');
  await choose('Mallet zone', zone);
  const before = await network(page);
  await terms.getByRole('button', { name: 'Continue' }).click();
  // Nothing new may connect while the warning is up.
  await expect(page.getByRole('dialog', { name: 'Play a friend online' })).toContainText(
    'Before you play online',
  );
  expect(await network(page)).toEqual(before);
  await accept(page, 'Play a friend online', 'Ana', 'Create link');
  const field = page.getByRole('textbox', { name: 'Game link' });
  await expect(field).toHaveValue(/^http:\/\/localhost:\d+\/#g=[A-Za-z0-9_-]{22}$/);
  return field.inputValue();
}

async function joinAs(guest: Side, host: Side) {
  await accept(guest.page, 'Join an online game', 'Ben', 'Join game');
  await expect(host.page.getByRole('dialog', { name: 'Invite a friend' })).toHaveCount(0, {
    timeout: 150_000,
  });
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-status', 'playing', { timeout: 30_000 });
  }
}

/** Lets go of the focus, so that the keys move the mallet rather than pressing a button. */
const unfocus = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Holds a key for a while (the mallet heads that way while it is held). */
async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Makes the page look hidden (another tab), or shown again, as the browser would tell it. */
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((on) => {
    Object.defineProperty(document, 'hidden', { value: on, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

test('two players connect from a link, pass the puck, and count a goal once on both sides', async ({
  browser,
}) => {
  const host = await player(browser);
  const link = await createLink(host.page, '1/3');
  // The link carries the page and the secret only, and its QR code reads back to it.
  expect(new URL(link).search).toBe('');
  const qr = host.page.locator('.online-qr-code');
  await expect(qr).toBeVisible();
  await host.page
    .getByRole('dialog', { name: 'Invite a friend' })
    .evaluate((d) => Promise.all(d.getAnimations({ subtree: true }).map((a) => a.finished)));
  const png = PNG.sync.read(await qr.screenshot());
  expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(link);

  const guest = await player(browser, link);
  // The link leaves the address bar at once, and nothing connects before the warning is accepted.
  await expect(guest.page.getByRole('dialog', { name: 'Join an online game' })).toBeVisible();
  expect(new URL(guest.page.url()).hash).toBe('');
  expect(await network(guest.page)).toEqual({ peers: 0, sockets: 0 });
  await joinAs(guest, host);
  expect((await network(guest.page)).peers).toBeGreaterThan(0);
  await expect(host.chip).toHaveAttribute('data-seat', '0');
  await expect(guest.chip).toHaveAttribute('data-seat', '1');
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-score', '0-0');
    await expect(side.chip).toHaveAttribute('data-holder', '0');
    // The host's terms hold on both sides: the zone a third of the table, for both.
    await expect(side.page.locator('.race')).toContainText('zone 1/3');
    // The development hook is gone during an online game.
    expect(await side.page.evaluate(() => 'xxhockeyDebug'.replace('xx', '__') in window)).toBe(
      false,
    );
  }

  // Ben steps aside; Ana drives her mallet up through the puck on her spot, at Ben's goal.
  await unfocus(guest.page);
  await hold(guest.page, 'd', 500);
  await unfocus(host.page);
  await hold(host.page, 'w', 700);
  // Over the centre line, the puck is Ben's to play: both sides agree.
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-holder', '1', { timeout: 30_000 });
  }
  // Wherever it went, both sides count the same goals, and a goal counts once.
  await expect
    .poll(async () => host.chip.getAttribute('data-goals'), { timeout: 30_000 })
    .not.toBe('0');
  await expect
    .poll(async () => guest.chip.getAttribute('data-score'), { timeout: 15_000 })
    .toBe(await host.chip.getAttribute('data-score'));
  expect(await host.chip.getAttribute('data-goals')).toBe('1');

  // Ben's page goes into the background: play stands still on Ana's side too, and she is told.
  await setHidden(guest.page, true);
  await expect(host.page.getByTestId('status')).toContainText('left the game', {
    timeout: 15_000,
  });
  await setHidden(guest.page, false);
  await expect(host.page.getByTestId('status')).not.toContainText('left the game', {
    timeout: 15_000,
  });

  // A resignation reaches the other side.
  await guest.page.keyboard.press('Escape');
  await guest.page.locator('.pause-item[data-choice="resign"]').click();
  await guest.page
    .getByRole('dialog', { name: 'Resign the match?' })
    .getByRole('button', { name: 'Resign' })
    .click();
  await expect(
    host.page.getByRole('dialog', { name: 'You win the match' }).filter({ hasText: 'resigned' }),
  ).toBeVisible({ timeout: 20_000 });

  for (const side of [host, guest]) {
    expect(side.errors).toEqual([]);
    // Neither side ever took the other for a cheat.
    expect(side.logs.filter((line) => line.startsWith('online:'))).toEqual([]);
    for (const line of side.logs) {
      for (const leak of LEAKS) expect(line, line).not.toMatch(leak);
    }
  }
});

test('cameras and microphones are off until turned on, show on the cards, and hang up', async ({
  browser,
}) => {
  const host = await player(browser);
  const link = await createLink(host.page);
  const guest = await player(browser, link);
  await joinAs(guest, host);
  const card = (side: Side, seat: 0 | 1) => side.page.getByTestId(`player-${seat}`);
  const playing = (video: ReturnType<Page['locator']>) =>
    expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 45_000 })
      .toBeGreaterThan(0);

  // Nothing starts by itself, and there is no call to hang up.
  expect(await deviceRequests(host.page)).toBe(0);
  expect(await deviceRequests(guest.page)).toBe(0);
  await expect(card(host, 0).locator('video')).toBeHidden();
  const hangUp = card(host, 0).getByRole('button', { name: 'Hang up the call' });
  await expect(hangUp).toBeHidden();

  // Ana turns her camera and microphone on: her own card shows her, mirrored.
  await card(host, 0).getByRole('button', { name: 'Turn your camera on' }).click();
  await card(host, 0).getByRole('button', { name: 'Turn your microphone on' }).click();
  const preview = card(host, 0).locator('video.m-avatar-video');
  await playing(preview);
  await expect(preview).toHaveClass(/mirrored/);
  expect(await deviceRequests(host.page)).toBe(2);

  // Ben sees and hears her on her card, and can mute her on his side only.
  await playing(card(guest, 0).locator('video.m-avatar-video'));
  await expect(card(guest, 0)).toHaveClass(/video-on/);
  const mute = card(guest, 0).getByRole('button', { name: 'Mute Ana' });
  await expect(mute).toBeVisible({ timeout: 30_000 });
  await mute.click();
  await expect(card(guest, 0).getByRole('button', { name: 'Unmute Ana' })).toBeVisible();
  expect(
    await guest.page.evaluate(
      () => document.querySelector<HTMLAudioElement>('body > audio')?.muted,
    ),
  ).toBe(true);

  // Ana hangs up: her camera and microphone stop, and Ben's card of her goes dark. The match
  // goes on.
  await expect(hangUp).toBeVisible();
  await hangUp.click();
  await expect(preview).toBeHidden();
  await expect(card(host, 0).getByRole('button', { name: 'Turn your camera on' })).toBeVisible();
  await expect(
    card(host, 0).getByRole('button', { name: 'Turn your microphone on' }),
  ).toBeVisible();
  await expect(card(guest, 0).locator('video')).toBeHidden({ timeout: 30_000 });
  await expect(hangUp).toBeHidden();
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-status', 'playing');
  }

  // Ben never turned anything on, so nothing of his was ever asked for.
  expect(await deviceRequests(guest.page)).toBe(0);
  for (const side of [host, guest]) {
    expect(side.errors).toEqual([]);
    expect(side.logs.filter((line) => line.startsWith('online:'))).toEqual([]);
  }
});

test('players whose clocks are wrong still find each other', async ({ browser }) => {
  // The relays compare the times signals carry. One clock set three hours behind by hand, the
  // other five minutes fast: both must still meet, on the server's clock.
  const host = await player(browser, './', -3 * 3600_000);
  const link = await createLink(host.page);
  const guest = await player(browser, link, 5 * 60_000);
  await joinAs(guest, host);
  for (const side of [host, guest]) {
    await expect(side.chip).toHaveAttribute('data-score', '0-0');
    expect(side.errors).toEqual([]);
    expect(side.logs.filter((line) => line.startsWith('online:'))).toEqual([]);
  }
});

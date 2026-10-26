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

// A match in the browser, started from the menus: a goal counts once and the player scored on
// serves; the match ends at its target and a rematch starts again; the computer plays at each
// strength; the mallets keep to their zones; pausing stops time; two players share the keyboard.
// The development hook puts the puck where a test needs it.

import { expect, test, type Page } from '@playwright/test';

type Debug = NonNullable<Window['__hockeyDebug']>;

const debug = <T>(page: Page, f: (d: Debug) => T) =>
  page.evaluate(
    (source) => new Function('d', `return (${source})(d)`)(window.__hockeyDebug) as unknown,
    f.toString(),
  ) as Promise<T>;

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  return errors;
}

/** Starts a match from the main menu's card, through the New Game sheet. */
async function start(
  page: Page,
  mode: 'computer' | 'local',
  options: { level?: string; goals?: string; zone?: string; serve?: string } = {},
) {
  await page.locator(`.mode-card[data-mode="${mode}"]`).click();
  const sheet = page.getByRole('dialog', { name: 'New game' });
  await expect(sheet).toBeVisible();
  if (options.level)
    await sheet
      .getByRole('radio', { name: new RegExp(`^${options.level}`) })
      .first()
      .click();
  if (options.goals) {
    await sheet
      .getByRole('radiogroup', { name: 'Goals to win' })
      .getByRole('radio', { name: options.goals, exact: true })
      .click();
  }
  if (options.zone) {
    await sheet
      .getByRole('radiogroup', { name: 'Mallet zone' })
      .getByRole('radio', { name: options.zone, exact: true })
      .click();
  }
  await sheet
    .getByRole('radiogroup', { name: 'First serve' })
    .getByRole('radio', {
      name: options.serve ?? (mode === 'local' ? 'First player' : 'You'),
      exact: true,
    })
    .click();
  await sheet.getByRole('button', { name: 'Start game' }).click();
  await expect(sheet).toBeHidden();
}

/** Clears seat 1's mallet from its goal and shoots the puck into it. */
async function scoreForSeat0(page: Page) {
  await debug(page, (d) => {
    const { L } = d.table();
    d.drive(1, 0.12, L - 0.12);
  });
  await page.waitForTimeout(500);
  await debug(page, (d) => {
    const { W, L } = d.table();
    d.shoot(W / 2, L - 0.55, 0, 4);
  });
}

test('a goal counts once, and the player scored on serves next', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'local', { goals: '3' });
  await scoreForSeat0(page);
  await expect.poll(() => debug(page, (d) => d.match().score)).toEqual([1, 0]);
  await expect(page.getByTestId('goal-banner')).toContainText('Goal!');
  // Through the pause and the serve (game time: slower than the clock in software rendering):
  // still one goal, and the puck on seat 1's spot.
  await expect.poll(() => debug(page, (d) => d.match().phase), { timeout: 30_000 }).toBe('play');
  const after = await debug(page, (d) => ({ m: d.match(), p: d.puck(), t: d.table() }));
  expect(after.m.score).toEqual([1, 0]);
  expect(after.m.goals).toBe(1);
  expect(after.m.server).toBe(1);
  expect(after.m.phase).toBe('play');
  expect(after.p.live).toBe(true);
  expect(after.p.y).toBeGreaterThan(after.t.L / 2);
  await expect(page.getByTestId('status')).toContainText('serves');
  expect(errors).toEqual([]);
});

test('the match ends at its target, and a rematch starts it again', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'local', { goals: '3' });
  for (let goal = 1; goal <= 3; goal++) {
    await scoreForSeat0(page);
    await expect.poll(() => debug(page, (d) => d.match().score[0])).toBe(goal);
    if (goal < 3)
      await expect
        .poll(() => debug(page, (d) => d.match().phase), { timeout: 30_000 })
        .toBe('play');
  }
  const result = page.getByRole('dialog', { name: 'Player 1 wins the match' });
  await expect(result).toBeVisible();
  await expect(result).toContainText('3');
  expect(await debug(page, (d) => d.match())).toMatchObject({ phase: 'over', winner: 0 });
  await result.getByRole('button', { name: 'Rematch' }).click();
  expect(await debug(page, (d) => d.match())).toMatchObject({
    phase: 'play',
    score: [0, 0],
    server: 1,
  });
  expect(errors).toEqual([]);
});

for (const level of ['Easy', 'Medium', 'Hard']) {
  test(`the computer at ${level} goes for the puck`, async ({ page }) => {
    const errors = await open(page);
    await start(page, 'computer', { level });
    await expect(page.getByTestId('player-1')).toContainText(level);
    const before = await debug(page, (d) => d.mallet(1));
    // A slow puck into the computer's half.
    await debug(page, (d) => {
      const { W, L } = d.table();
      d.shoot(W * 0.3, L * 0.55, 0, 0.6);
    });
    await expect
      .poll(async () => {
        const now = await debug(page, (d) => d.mallet(1));
        return Math.hypot(now.x - before.x, now.y - before.y);
      })
      .toBeGreaterThan(0.05);
    expect(errors).toEqual([]);
  });
}

test('keeps each mallet in its zone, however far it is sent', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'local', { zone: '1/4' });
  await debug(page, (d) => {
    const { W, L } = d.table();
    d.drive(0, W / 2, L);
  });
  await page.waitForTimeout(1500);
  const { y, L } = await debug(page, (d) => ({ y: d.mallet(0).y, L: d.table().L }));
  // A quarter of the table from seat 0's end rail, less the mallet's radius (2 in).
  expect(y + 0.0508).toBeLessThanOrEqual(L * 0.25 + 1e-6);
  expect(y + 0.0508).toBeGreaterThan(L * 0.25 - 0.01);
  expect(errors).toEqual([]);
});

test('pausing stops time, and resuming goes on', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'computer', { level: 'Easy' });
  await page.keyboard.press('Escape');
  const paused = page.getByRole('dialog', { name: 'Paused' });
  await expect(paused).toBeVisible();
  const t0 = await debug(page, (d) => d.match().time);
  await page.waitForTimeout(600);
  expect(await debug(page, (d) => d.match().time)).toBe(t0);
  await paused.locator('.pause-item[data-choice="resume"]').click();
  await expect.poll(() => debug(page, (d) => d.match().time)).toBeGreaterThan(t0 + 0.2);
  expect(errors).toEqual([]);
});

test('two players share the keyboard: W A S D and the arrows', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'local');
  const before = await debug(page, (d) => [d.mallet(0), d.mallet(1)]);
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.down('d');
  await page.keyboard.down('ArrowUp');
  // Held until both have gone a few centimetres, in game time (slow in software rendering).
  for (const seat of [0, 1] as const) {
    await expect
      .poll(async () => {
        const now = await debug(page, (d) => [d.mallet(0), d.mallet(1)]);
        return Math.hypot(now[seat]!.x - before[seat]!.x, now[seat]!.y - before[seat]!.y);
      })
      .toBeGreaterThan(0.05);
  }
  await page.keyboard.up('d');
  await page.keyboard.up('ArrowUp');
  expect(errors).toEqual([]);
});

test('R restarts the match from 0–0', async ({ page }) => {
  const errors = await open(page);
  await start(page, 'local', { goals: '3' });
  await scoreForSeat0(page);
  await expect.poll(() => debug(page, (d) => d.match().score)).toEqual([1, 0]);
  await expect.poll(() => debug(page, (d) => d.match().phase), { timeout: 30_000 }).toBe('play');
  await page.keyboard.press('r');
  expect(await debug(page, (d) => d.match())).toMatchObject({ score: [0, 0], goals: 0 });
  expect(errors).toEqual([]);
});

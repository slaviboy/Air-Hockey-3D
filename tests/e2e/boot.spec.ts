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

// The site starts: the page loads without errors and the 3D canvas is on screen.

import { expect, test } from '@playwright/test';

test('starts with a 3D canvas and no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
  await expect(page.locator('#app[data-ready="true"]')).toBeAttached();
  await expect(page.locator('canvas.scene-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

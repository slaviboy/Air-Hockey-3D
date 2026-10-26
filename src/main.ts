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

import './styles/base.css';
import './styles/modern.css';
import './styles/hockey.css';
import './styles/sheet.css';
import './styles/online.css';
import { App } from './app/App.ts';
import { installDebugHook } from './app/debugHook.ts';
import { loadSettings, saveSettings } from './app/Settings.ts';
import { Store } from './core/Store.ts';
import { UiRoot } from './ui/UiRoot.ts';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const params = new URLSearchParams(location.search);
const settings = new Store(loadSettings());
settings.subscribe((value) => saveSettings(value));

// Automated browsers get no shadows or antialiasing (fast enough in software), unless ?quality=
// says otherwise; then the player's setting.
const asked = params.get('quality');
const chosen = settings.get().quality;
const quality =
  asked === 'low' || asked === 'high'
    ? asked
    : navigator.webdriver
      ? 'low'
      : chosen === 'auto'
        ? 'high'
        : chosen;

const app = new App(root, import.meta.env.BASE_URL, settings, quality);
const ui = new UiRoot(app);
installDebugHook(app);
app.ready
  .then(() => {
    root.dataset.ready = 'true';
    // ?menu=0 starts straight into a match against the computer (the tests that need no menu).
    if (params.get('menu') === '0') void ui.play();
    else void ui.menu();
  })
  .catch((error: Error) => {
    console.error(error);
    const message = document.createElement('div');
    message.className = 'load-error';
    message.textContent = `The game could not start: ${error.message}`;
    document.body.append(message);
  });

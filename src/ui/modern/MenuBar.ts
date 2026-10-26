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

// A desktop-style menu bar built from data, as in the chess game. Click a menu to open it; while
// one is open, hovering another switches to it (on a touch screen, tapping it does). Alt+letter
// opens a menu, the arrow keys move through items and submenus, Enter chooses and Escape closes.
// Labels mark their access key with "&" ("&Game"). Check marks, shortcuts and submenu arrows are
// drawn as icons and key caps. Menus keep on the screen: near its right edge they open leftward,
// or on a narrow screen, over the menu.

import { LINE_ICONS } from '../icons.ts';

export interface MenuItem {
  readonly label?: string;
  readonly shortcut?: string;
  readonly action?: () => void;
  readonly checked?: () => boolean;
  readonly enabled?: () => boolean;
  readonly submenu?: () => MenuItem[];
  readonly separator?: boolean;
}

export interface Menu {
  readonly label: string;
  readonly items: () => MenuItem[];
}

/** The least room between a menu and the window's edge, in CSS pixels. */
const EDGE = 8;

function accessKey(label: string): string | undefined {
  const i = label.indexOf('&');
  return i >= 0 ? label[i + 1]?.toLowerCase() : undefined;
}

function labelHtml(label: string): string {
  const i = label.indexOf('&');
  if (i < 0) return escapeHtml(label);
  return `${escapeHtml(label.slice(0, i))}<u>${escapeHtml(label[i + 1] ?? '')}</u>${escapeHtml(label.slice(i + 2))}`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

export class MenuBar {
  readonly element: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private open: {
    index: number;
    list: HTMLElement;
    sub?: HTMLElement;
    /** The entry the submenu belongs to. */
    subEntry?: HTMLElement;
  } | null = null;

  /** `available` says whether Alt+letter may open a menu (the bar shows, and no dialog is open). */
  constructor(
    private readonly menus: readonly Menu[],
    private readonly available: () => boolean = () => true,
  ) {
    this.element = document.createElement('nav');
    this.element.className = 'menubar';
    this.element.setAttribute('role', 'menubar');
    this.element.setAttribute('aria-label', 'Main menu');
    menus.forEach((menu, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menubar-item';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = labelHtml(menu.label);
      button.addEventListener('click', () =>
        this.open?.index === index ? this.close() : this.show(index),
      );
      // Hovering switches menus with a mouse. A tap enters and clicks at once, so on a touch
      // screen the click alone decides (or the menu it just opened would close again).
      button.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        if (this.open && this.open.index !== index) this.show(index);
      });
      button.addEventListener('keydown', (event) => this.onBarKey(event, index));
      this.buttons.push(button);
      this.element.append(button);
    });
    document.addEventListener('pointerdown', (event) => {
      if (
        this.open &&
        !this.element.contains(event.target as Node) &&
        !this.open.list.contains(event.target as Node)
      ) {
        this.close();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && this.available()) {
        const index = this.menus.findIndex((m) => accessKey(m.label) === event.key.toLowerCase());
        if (index >= 0) {
          event.preventDefault();
          this.show(index, true);
        }
      }
    });
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  close(): void {
    if (!this.open) return;
    this.open.sub?.remove();
    this.open.list.remove();
    this.buttons[this.open.index]?.setAttribute('aria-expanded', 'false');
    this.buttons[this.open.index]?.classList.remove('open');
    this.open = null;
  }

  private show(index: number, focusFirst = false): void {
    this.close();
    const button = this.buttons[index]!;
    const list = this.buildList(this.menus[index]!.items(), () => this.close());
    const rect = button.getBoundingClientRect();
    list.style.left = `${rect.left}px`;
    list.style.top = `${rect.bottom}px`;
    document.body.append(list);
    // A bar near the right edge (with the controls on the left): the menu moves left to fit.
    const over = list.getBoundingClientRect().right - (window.innerWidth - EDGE);
    if (over > 0) list.style.left = `${Math.max(EDGE, rect.left - over)}px`;
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('open');
    this.open = { index, list };
    if (focusFirst)
      list.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
  }

  private buildList(items: MenuItem[], done: () => void): HTMLElement {
    const list = document.createElement('div');
    list.className = 'menu';
    list.setAttribute('role', 'menu');
    for (const item of items) {
      if (item.separator) {
        const rule = document.createElement('div');
        rule.className = 'menu-separator';
        rule.setAttribute('role', 'separator');
        list.append(rule);
        continue;
      }
      const entry = document.createElement('div');
      const checked = item.checked?.();
      entry.className = 'menu-entry';
      entry.tabIndex = -1;
      entry.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (checked !== undefined) entry.setAttribute('aria-checked', String(checked));
      const enabled = item.enabled?.() ?? true;
      if (!enabled) entry.setAttribute('aria-disabled', 'true');
      entry.innerHTML = `<span class="menu-check">${checked ? LINE_ICONS.check : ''}</span><span class="menu-label">${labelHtml(item.label ?? '')}</span><span class="menu-shortcut">${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}${item.submenu ? LINE_ICONS.chevronRight : ''}</span>`;
      const activate = () => {
        if (!enabled) return;
        if (item.submenu) {
          this.openSub(entry, item.submenu());
          return;
        }
        done();
        item.action?.();
      };
      entry.addEventListener('click', activate);
      entry.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        entry.focus();
        if (item.submenu && enabled) this.openSub(entry, item.submenu());
        else if (!list.classList.contains('submenu')) this.closeSub();
      });
      entry.addEventListener('keydown', (event) =>
        this.onListKey(event, entry, activate, !!item.submenu),
      );
      list.append(entry);
    }
    return list;
  }

  private openSub(entry: HTMLElement, items: MenuItem[]): void {
    if (!this.open) return;
    // Already open from this entry (hovered, then clicked): keep it rather than build it again.
    if (this.open.sub && this.open.subEntry === entry) return;
    this.closeSub();
    const sub = this.buildList(items, () => this.close());
    sub.classList.add('submenu');
    const rect = entry.getBoundingClientRect();
    sub.style.left = `${rect.right - 2}px`;
    sub.style.top = `${rect.top - 3}px`;
    document.body.append(sub);
    // Without the room on the right, it opens to the left of its entry; without it on either side
    // (a narrow screen), under its entry, over the menu, against the screen's right edge.
    if (sub.getBoundingClientRect().right > window.innerWidth - EDGE) {
      sub.classList.add('leftward');
      sub.style.left = `${rect.left + 2 - sub.offsetWidth}px`;
      if (sub.getBoundingClientRect().left < EDGE) {
        sub.classList.replace('leftward', 'over');
        sub.style.left = `${Math.max(EDGE, window.innerWidth - EDGE - sub.offsetWidth)}px`;
        sub.style.top = `${rect.bottom}px`;
      }
    }
    this.open.sub = sub;
    this.open.subEntry = entry;
    sub.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  private closeSub(): void {
    this.open?.sub?.remove();
    if (this.open) {
      this.open.sub = undefined;
      this.open.subEntry = undefined;
    }
  }

  private onBarKey(event: KeyboardEvent, index: number): void {
    const count = this.buttons.length;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = (index + (event.key === 'ArrowRight' ? 1 : count - 1)) % count;
      this.buttons[next]!.focus();
      if (this.open) this.show(next, true);
    } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.show(index, true);
    } else if (event.key === 'Escape') {
      this.close();
    }
  }

  private onListKey(
    event: KeyboardEvent,
    entry: HTMLElement,
    activate: () => void,
    hasSub: boolean,
  ): void {
    const list = entry.parentElement!;
    const entries = [
      ...list.querySelectorAll<HTMLElement>('.menu-entry:not([aria-disabled="true"])'),
    ];
    const i = entries.indexOf(entry);
    event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        entries[(i + 1) % entries.length]?.focus();
        break;
      case 'ArrowUp':
        event.preventDefault();
        entries[(i - 1 + entries.length) % entries.length]?.focus();
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (hasSub) {
          activate();
          this.open?.sub?.querySelector<HTMLElement>('.menu-entry')?.focus();
        } else if (this.open) {
          const next = (this.open.index + 1) % this.buttons.length;
          this.show(next, true);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (list.classList.contains('submenu')) {
          this.closeSub();
          this.open?.list
            .querySelector<HTMLElement>('.menu-entry:focus-within, .menu-entry')
            ?.focus();
        } else if (this.open) {
          const prev = (this.open.index - 1 + this.buttons.length) % this.buttons.length;
          this.show(prev, true);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activate();
        break;
      case 'Escape': {
        event.preventDefault();
        const index = this.open?.index ?? 0;
        this.close();
        this.buttons[index]?.focus();
        break;
      }
      default: {
        const key = event.key.toLowerCase();
        const match = entries.find((e) => e.querySelector('u')?.textContent?.toLowerCase() === key);
        if (match) {
          event.preventDefault();
          match.click();
        }
      }
    }
  }
}

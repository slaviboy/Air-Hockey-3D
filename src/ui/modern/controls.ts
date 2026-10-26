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

// Small controls of the modern interface: icon buttons with tooltips, switches, and groups of
// choices (segmented pills or cards) that behave like radio buttons.

import { el } from '../Dialog.ts';
import { LINE_ICONS } from '../icons.ts';

/** A button showing only an icon; the label names it for screen readers and its tooltip. */
export function iconButton(
  icon: string,
  label: string,
  onClick: () => void,
  className = 'm-icon-btn',
): HTMLButtonElement {
  const button = el('button', className);
  button.type = 'button';
  button.innerHTML = icon;
  button.setAttribute('aria-label', label);
  button.dataset.tip = label;
  button.addEventListener('click', onClick);
  return button;
}

/** A labelled on/off switch; returns the row and its checkbox. */
export function switchRow(
  label: string,
  checked: boolean,
  onChange: (on: boolean) => void,
): [HTMLElement, HTMLInputElement] {
  const row = el('label', 'm-switch-row');
  const input = el('input', 'm-switch');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  row.append(el('span', '', label), input);
  return [row, input];
}

export interface Choice<T extends string> {
  readonly value: T;
  /** Text, or markup when the choice is drawn. */
  readonly label: string;
  readonly html?: string;
}

export interface ChoiceGroup<T extends string> {
  readonly element: HTMLElement;
  readonly value: T;
  /** Shows another choice as chosen without reporting it (to keep two views of one choice in step). */
  select(value: T): void;
}

/**
 * A row (or grid) of mutually exclusive choices that behaves like radio buttons: one is checked,
 * the arrow keys move the choice and Tab enters the group at the checked one.
 */
export function choiceGroup<T extends string>(
  label: string,
  choices: ReadonlyArray<Choice<T>>,
  current: T,
  onChange: (value: T) => void,
  className: string,
  itemClass: string,
): ChoiceGroup<T> {
  const group = el('div', className);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  const buttons: HTMLButtonElement[] = [];
  let value = current;
  const mark = () => {
    for (const b of buttons) {
      const on = b.dataset.value === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  const choose = (next: T, focus = false) => {
    if (next !== value) {
      value = next;
      mark();
      onChange(next);
    }
    if (focus) buttons.find((b) => b.dataset.value === next)?.focus();
  };
  choices.forEach((choice, index) => {
    const button = el('button', itemClass);
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.value = choice.value;
    if (choice.html) {
      button.innerHTML = choice.html;
      button.setAttribute('aria-label', choice.label);
    } else {
      button.textContent = choice.label;
      button.title = choice.label;
    }
    button.addEventListener('click', () => choose(choice.value));
    button.addEventListener('keydown', (event) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      choose(choices[(index + step + choices.length) % choices.length]!.value, true);
    });
    buttons.push(button);
    group.append(button);
  });
  mark();
  return {
    element: group,
    get value() {
      return value;
    },
    select(next: T) {
      value = next;
      mark();
    },
  };
}

/**
 * A slider of big cards: the chosen one in the middle, its neighbours smaller and fainter on either
 * side, the rest out of sight. The arrows, a click on a neighbour, a swipe or the arrow keys choose
 * the next one, which slides to the middle. It never ends: past the last card comes the first.
 */
export function carousel<T extends string>(
  label: string,
  /** What one card is, for the arrows' names ("Next opponent"). */
  noun: string,
  choices: ReadonlyArray<Choice<T>>,
  current: T,
  onChange: (value: T) => void,
  itemClass: string,
): ChoiceGroup<T> {
  const root = el('div', 'm-carousel');
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', label);
  root.setAttribute('aria-roledescription', 'slider of choices');
  const stage = el('div', 'm-carousel-stage');
  const track = el('div', 'm-carousel-track');
  stage.append(track);
  const n = choices.length;
  const half = Math.floor(n / 2);
  let index = Math.max(
    0,
    choices.findIndex((c) => c.value === current),
  );

  const cards = choices.map((choice, i) => {
    const card = el('button', `${itemClass} m-carousel-card`);
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.dataset.value = choice.value;
    if (choice.html) {
      card.innerHTML = choice.html;
      card.setAttribute('aria-label', choice.label);
    } else {
      card.textContent = choice.label;
    }
    card.addEventListener('click', () => {
      if (swiped) return;
      if (i !== index) choose(i, true);
    });
    card.addEventListener('keydown', (event) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      choose(index + step, true);
    });
    track.append(card);
    return card;
  });

  /** Places every card by its distance from the chosen one, the short way round. */
  const layout = () => {
    cards.forEach((card, i) => {
      const d = ((((i - index) % n) + n + half) % n) - half;
      card.style.setProperty('--d', String(d));
      card.dataset.pos = d === 0 ? 'center' : Math.abs(d) === 1 ? 'side' : 'away';
      const chosen = d === 0;
      card.setAttribute('aria-checked', String(chosen));
      card.tabIndex = chosen ? 0 : -1;
      if (Math.abs(d) > 1) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
    });
  };

  const choose = (next: number, focus = false) => {
    const wrapped = ((next % n) + n) % n;
    if (wrapped !== index) {
      index = wrapped;
      layout();
      onChange(choices[index]!.value);
    }
    if (focus) cards[index]!.focus({ preventScroll: true });
  };

  const prev = iconButton(LINE_ICONS.prev, `Previous ${noun}`, () => choose(index - 1));
  const next = iconButton(LINE_ICONS.next, `Next ${noun}`, () => choose(index + 1));
  prev.classList.add('m-carousel-arrow', 'prev');
  next.classList.add('m-carousel-arrow', 'next');

  // A swipe on a touch screen moves one card; the click that ends it does not count.
  let startX: number | null = null;
  let swiped = false;
  stage.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    swiped = false;
  });
  stage.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    startX = null;
    if (Math.abs(dx) < 40) return;
    swiped = true;
    choose(index + (dx < 0 ? 1 : -1));
    setTimeout(() => (swiped = false), 0);
  });

  root.append(prev, stage, next);
  layout();
  return {
    element: root,
    get value() {
      return choices[index]!.value;
    },
    select(value: T) {
      const i = choices.findIndex((c) => c.value === value);
      if (i < 0 || i === index) return;
      index = i;
      layout();
    },
  };
}

/** A segmented control: a pill of short text choices. */
export function segmented<T extends string>(
  label: string,
  choices: ReadonlyArray<readonly [T, string]>,
  current: T,
  onChange: (value: T) => void,
  className = 'm-segmented',
): ChoiceGroup<T> {
  return choiceGroup(
    label,
    choices.map(([value, text]) => ({ value, label: text })),
    current,
    onChange,
    className,
    'm-segment',
  );
}

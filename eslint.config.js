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

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'public/', 'test-results/', 'playwright-report/', 'blender/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // Command-line scripts report to the terminal.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // The simulation must compute the same bits in every browser (see
    // tests/architecture/determinism.test.ts): the side that takes the puck over carries on the
    // other side's simulation, and the tests replay rallies exactly. No approximated Math functions,
    // no ** operator, no clocks or random numbers. Exponentials come from src/physics/dmath.ts.
    files: ['src/physics/**', 'src/table/**', 'src/rules/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...[
          'sin',
          'cos',
          'tan',
          'asin',
          'acos',
          'atan',
          'atan2',
          'sinh',
          'cosh',
          'tanh',
          'asinh',
          'acosh',
          'atanh',
          'exp',
          'expm1',
          'log',
          'log1p',
          'log2',
          'log10',
          'pow',
          'cbrt',
          'hypot',
          'random',
        ].map((property) => ({
          object: 'Math',
          property,
          message: 'Not exactly rounded: use src/physics/dmath.ts.',
        })),
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Not exactly rounded.' },
        { selector: "AssignmentExpression[operator='**=']", message: 'Not exactly rounded.' },
      ],
      'no-restricted-globals': ['error', 'Date', 'performance', 'crypto', 'window', 'document'],
    },
  },
);

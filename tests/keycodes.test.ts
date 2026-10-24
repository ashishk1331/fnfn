import assert from 'node:assert/strict';
import test from 'node:test';

import { isFnChord, isFnKey, keyLabel, keyName } from '../src/shared/keycodes';

test('Fn and Fn + Esc are distinct Linux key codes', () => {
  assert.equal(isFnKey(464), true);
  assert.equal(isFnChord(464), false);

  assert.equal(isFnChord(465), true);
  assert.equal(isFnKey(465), false);

  assert.equal(keyName(464), 'KEY_FN');
  assert.equal(keyLabel(465), 'Fn + Esc');
});

test('ordinary keys are not mistaken for Fn', () => {
  assert.equal(isFnKey(97), false);
  assert.equal(isFnChord(97), false);
  assert.equal(keyName(97), 'KEY_RIGHTCTRL');
  assert.equal(keyLabel(97), 'Right Ctrl');
  assert.equal(keyName(100), 'KEY_RIGHTALT');
  assert.equal(keyLabel(100), 'Right Alt');
});

test('function keys use their real Linux key codes', () => {
  assert.equal(keyName(59), 'KEY_F1');
  assert.equal(keyName(68), 'KEY_F10');
  assert.equal(keyName(87), 'KEY_F11');
  assert.equal(keyName(88), 'KEY_F12');
  assert.equal(keyLabel(87), 'F11');
  assert.equal(keyLabel(88), 'F12');
});

test('lock keys are not mislabeled as F11 and F12', () => {
  assert.equal(keyName(69), 'KEY_NUMLOCK');
  assert.equal(keyLabel(69), 'Num Lock');
  assert.equal(keyName(70), 'KEY_SCROLLLOCK');
  assert.equal(keyLabel(70), 'Scroll Lock');
});

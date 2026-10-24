/**
 * A small, human-friendly subset of Linux input-event key codes.
 * Full table: /usr/include/linux/input-event-codes.h
 */

interface KeyInfo {
  name: string;
  label: string;
}

const KEYS: Record<number, KeyInfo> = {
  1: { name: 'KEY_ESC', label: 'Esc' },
  14: { name: 'KEY_BACKSPACE', label: 'Backspace' },
  15: { name: 'KEY_TAB', label: 'Tab' },
  28: { name: 'KEY_ENTER', label: 'Enter' },
  29: { name: 'KEY_LEFTCTRL', label: 'Left Ctrl' },
  42: { name: 'KEY_LEFTSHIFT', label: 'Left Shift' },
  54: { name: 'KEY_RIGHTSHIFT', label: 'Right Shift' },
  56: { name: 'KEY_LEFTALT', label: 'Left Alt' },
  57: { name: 'KEY_SPACE', label: 'Space' },
  58: { name: 'KEY_CAPSLOCK', label: 'Caps Lock' },
  69: { name: 'KEY_NUMLOCK', label: 'Num Lock' },
  70: { name: 'KEY_SCROLLLOCK', label: 'Scroll Lock' },
  97: { name: 'KEY_RIGHTCTRL', label: 'Right Ctrl' },
  100: { name: 'KEY_RIGHTALT', label: 'Right Alt' },
  110: { name: 'KEY_INSERT', label: 'Insert' },
  119: { name: 'KEY_PAUSE', label: 'Pause' },
  125: { name: 'KEY_LEFTMETA', label: 'Left Meta' },
  126: { name: 'KEY_RIGHTMETA', label: 'Right Meta' },
  138: { name: 'KEY_HELP', label: 'Help' },
  183: { name: 'KEY_F13', label: 'F13' },
  184: { name: 'KEY_F14', label: 'F14' },
  185: { name: 'KEY_F15', label: 'F15' },
  186: { name: 'KEY_F16', label: 'F16' },
  187: { name: 'KEY_F17', label: 'F17' },
  188: { name: 'KEY_F18', label: 'F18' },
  189: { name: 'KEY_F19', label: 'F19' },
  190: { name: 'KEY_F20', label: 'F20' },
  191: { name: 'KEY_F21', label: 'F21' },
  192: { name: 'KEY_F22', label: 'F22' },
  193: { name: 'KEY_F23', label: 'F23' },
  194: { name: 'KEY_F24', label: 'F24' },
  226: { name: 'KEY_MEDIA', label: 'Media' },
  240: { name: 'KEY_UNKNOWN', label: 'Unknown' },
  247: { name: 'KEY_RFKILL', label: 'Radio off' },
  248: { name: 'KEY_MICMUTE', label: 'Mic Mute' },
  464: { name: 'KEY_FN', label: 'Fn' },
  465: { name: 'KEY_FN_ESC', label: 'Fn + Esc' },
};

const LETTERS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
];

const LETTER_CODES = [
  30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31,
  20, 22, 47, 17, 45, 21, 44,
];

LETTERS.forEach((letter, index) => {
  KEYS[LETTER_CODES[index]] = {
    name: `KEY_${letter}`,
    label: letter,
  };
});

for (let index = 0; index <= 9; index += 1) {
  KEYS[2 + index] = {
    name: `KEY_${index}`,
    label: String(index),
  };
}

// F1-F10 are contiguous, but F11 and F12 live after the navigation cluster.
const FUNCTION_CODES = [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88];

FUNCTION_CODES.forEach((code, index) => {
  KEYS[code] = { name: `KEY_F${index + 1}`, label: `F${index + 1}` };
});

export function keyName(code: number): string {
  return KEYS[code]?.name ?? `KEY_CODE_${code}`;
}

export function keyLabel(code: number): string {
  return KEYS[code]?.label ?? `Code ${code}`;
}

export function isFnKey(code: number): boolean {
  return code === 464;
}

export function isFnChord(code: number): boolean {
  return code === 465;
}

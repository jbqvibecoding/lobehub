import { describe, expect, it } from 'vitest';

import { keyAction, pagePoint } from '../input';

const key = (
  value: string,
  modifiers: Partial<Record<'alt' | 'ctrl' | 'meta' | 'shift', boolean>> = {},
) => ({
  altKey: !!modifiers.alt,
  ctrlKey: !!modifiers.ctrl,
  key: value,
  metaKey: !!modifiers.meta,
  shiftKey: !!modifiers.shift,
});

describe('keyAction', () => {
  it('types characters, including capitals and spaces', () => {
    expect(keyAction(key('a'))).toEqual({ kind: 'type', text: 'a' });
    expect(keyAction(key('A', { shift: true }))).toEqual({ kind: 'type', text: 'A' });
    expect(keyAction(key(' '))).toEqual({ kind: 'type', text: ' ' });
    expect(keyAction(key('中'))).toEqual({ kind: 'type', text: '中' });
  });

  it('presses named keys and shortcuts by name', () => {
    expect(keyAction(key('Backspace'))).toEqual({ key: 'Backspace', kind: 'key' });
    expect(keyAction(key('a', { ctrl: true }))).toEqual({ key: 'Control+a', kind: 'key' });
    expect(keyAction(key('V', { meta: true, shift: true }))).toEqual({
      key: 'Meta+Shift+v',
      kind: 'key',
    });
  });

  it('ignores keys that do nothing on their own', () => {
    expect(keyAction(key('Shift', { shift: true }))).toBeUndefined();
    expect(keyAction(key('Control', { ctrl: true }))).toBeUndefined();
    expect(keyAction(key('F13'))).toBeUndefined();
  });
});

describe('pagePoint', () => {
  it('scales a click on the drawn picture back to page pixels', () => {
    expect(
      pagePoint(
        { clientX: 110, clientY: 60 },
        { height: 400, left: 10, top: 10, width: 640 },
        { height: 800, width: 1280 },
      ),
    ).toEqual({ x: 200, y: 100 });
  });
});

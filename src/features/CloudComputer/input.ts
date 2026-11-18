import type { CloudComputerAction } from '@/services/cloudComputer';

/** Keys sent by name: everything that is not a character typed into the page. */
const NAMED_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Delete',
  'End',
  'Enter',
  'Escape',
  'Home',
  'PageDown',
  'PageUp',
  'Tab',
]);

interface KeyLike {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * What a key pressed over the screen does on the cloud computer: a character is typed, a named key
 * or a shortcut (Ctrl/⌘ + key) is pressed. Undefined for keys that do nothing on their own (Shift).
 */
export const keyAction = (event: KeyLike): CloudComputerAction | undefined => {
  const key = event.key === ' ' ? 'Space' : event.key;
  const chord = event.ctrlKey || event.metaKey || event.altKey;

  if (chord) {
    if (!/^\w+$/.test(key) || ['Alt', 'Control', 'Meta', 'Shift'].includes(key)) return;
    const parts = [
      event.ctrlKey && 'Control',
      event.metaKey && 'Meta',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      key.length === 1 ? key.toLowerCase() : key,
    ].filter(Boolean);
    return { key: parts.join('+'), kind: 'key' };
  }

  if (NAMED_KEYS.has(key)) return { key, kind: 'key' };
  if (event.key.length === 1) return { kind: 'type', text: event.key };
};

/**
 * Where a click on the picture lands on the page: the picture is drawn scaled, so the point is
 * scaled back to the page's own pixels.
 */
export const pagePoint = (
  click: { clientX: number; clientY: number },
  drawn: { height: number; left: number; top: number; width: number },
  page: { height: number; width: number },
) => ({
  x: Math.round(((click.clientX - drawn.left) * page.width) / drawn.width),
  y: Math.round(((click.clientY - drawn.top) * page.height) / drawn.height),
});

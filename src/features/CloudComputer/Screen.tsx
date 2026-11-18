'use client';

import { createStaticStyles, cx } from 'antd-style';
import type { KeyboardEvent, MouseEvent, WheelEvent } from 'react';
import { memo, useRef } from 'react';

import type { CloudComputerAction } from '@/services/cloudComputer';

import { keyAction, pagePoint } from './input';

/** Wheel movement is gathered for this long and sent as one scroll. */
const SCROLL_BATCH_MS = 150;

const styles = createStaticStyles(({ css, cssVar }) => ({
  driving: css`
    cursor: crosshair;
    outline: 2px solid ${cssVar.colorPrimary};
    outline-offset: 2px;
  `,
  frame: css`
    overflow: hidden;

    width: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;

    background: ${cssVar.colorFillQuaternary};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
  image: css`
    user-select: none;
    display: block;
    width: 100%;
    height: auto;
  `,
}));

interface ScreenProps {
  /** The person holds the browser: clicks, scrolls and keys go to the page. */
  canDrive: boolean;
  label: string;
  onAction: (action: CloudComputerAction) => void;
  screen: { base64: string; height: number; width: number };
}

/** The cloud computer's screen, and while the person holds it, their mouse and keyboard on it. */
const Screen = memo<ScreenProps>(({ canDrive, label, onAction, screen }) => {
  const image = useRef<HTMLImageElement>(null);
  const pendingScroll = useRef({ deltaY: 0, timer: undefined as number | undefined });

  const click = (event: MouseEvent<HTMLDivElement>) => {
    if (!canDrive || !image.current) return;
    const rect = image.current.getBoundingClientRect();
    onAction({ kind: 'click', ...pagePoint(event, rect, screen) });
  };

  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!canDrive) return;
    const pending = pendingScroll.current;
    pending.deltaY += event.deltaY;
    if (pending.timer !== undefined) return;
    pending.timer = window.setTimeout(() => {
      const deltaY = Math.max(-5000, Math.min(5000, Math.round(pending.deltaY)));
      pending.deltaY = 0;
      pending.timer = undefined;
      if (deltaY) onAction({ deltaY, kind: 'scroll' });
    }, SCROLL_BATCH_MS);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canDrive) return;
    const action = keyAction(event);
    if (!action) return;
    event.preventDefault();
    onAction(action);
  };

  return (
    <div
      aria-label={label}
      className={cx(styles.frame, canDrive && styles.driving)}
      role={'application'}
      tabIndex={0}
      onClick={click}
      onKeyDown={keyDown}
      onWheel={wheel}
    >
      <img
        alt={label}
        className={styles.image}
        draggable={false}
        height={screen.height}
        ref={image}
        src={`data:image/png;base64,${screen.base64}`}
        width={screen.width}
      />
    </div>
  );
});

Screen.displayName = 'CloudComputerScreen';

export default Screen;

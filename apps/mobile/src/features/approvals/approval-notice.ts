import { useSyncExternalStore } from 'react';

/**
 * A line shown above the approvals list for a few seconds: what became of an answer given from
 * a notification button, since that answer is given before the list is on screen.
 */
let notice: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export const showApprovalNotice = (text: string | null, durationMs = 6000) => {
  notice = text;
  clearTimeout(timer);
  if (text) timer = setTimeout(() => showApprovalNotice(null), durationMs);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useApprovalNotice = () => useSyncExternalStore(subscribe, () => notice);

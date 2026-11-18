/** What `computer.view` answers: the cloud computer's state, who holds it, and its screen. */
export interface ComputerView {
  control?: {
    helpRequested: boolean;
    holder: 'bot' | 'human';
    reason?: string;
    secretWanted?: string;
  };
  screen?: { base64: string; height: number; url: string; width: number };
  status: 'off' | 'running' | 'unavailable';
}

/** One tap, key, scroll or piece of text, in the page's own pixels. */
export type ComputerAction =
  | { kind: 'click'; x: number; y: number }
  | { key: string; kind: 'key' }
  | { deltaY: number; kind: 'scroll' }
  | { kind: 'type'; text: string };

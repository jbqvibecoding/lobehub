import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { getSandboxProviderKind } from '@/server/services/sandbox/factory';
import {
  OpenBotComputer,
  OpenBotRequestError,
} from '@/server/services/sandbox/providers/openbotComputer';

const log = debug('lobe-server:cloud-computer');

/** What the person sees the request as when they take the browser without the Bot asking. */
const MANUAL_TAKEOVER_REASON = 'The owner took over from the Biber app.';

/** The computer's control state, as agent-computer reports it (`shared/computer-control.ts`). */
interface ControlState {
  holder: 'bot' | 'human';
  reason?: string;
  request?: { id: string; source: string; status: string; url?: string };
  requested: boolean;
  secretWanted?: string;
  transitioning: boolean;
}

interface Screenshot {
  base64: string;
  capturedAt: string;
  height: number;
  url: string;
  width: number;
}

export type ComputerInput =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; deltaY: number }
  | { kind: 'type'; text: string };

export interface CloudComputerView {
  control?: {
    /** The Bot asked for a person and nobody has taken it yet. */
    helpRequested: boolean;
    holder: 'bot' | 'human';
    /** Why the Bot asked, while its request is open. */
    reason?: string;
    /** The page asks for a value the Bot must not see (a password). */
    secretWanted?: string;
  };
  screen?: Screenshot;
  /**
   * `unavailable`: this deployment has no cloud computers. `off`: there is one, not running (it
   * starts when the assistant next needs it, or from the page). `running`: as it says.
   */
  status: 'off' | 'running' | 'unavailable';
}

const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

/**
 * The cloud computer page (web, desktop and phone): the user's OpenBot computer, watched through
 * screenshots and driven by a person once they take over. Everything goes through this server,
 * because computers are reachable only on the deployment's private network.
 *
 * Looking never starts a computer, and a person can only click and type while they hold the wheel,
 * which the computer itself enforces. What a person types goes to the browser only: it is never
 * logged, stored or shown to a model.
 */
export class CloudComputerService {
  private readonly computer: OpenBotComputer;

  constructor(userId: string, topicId?: string) {
    this.computer = new OpenBotComputer({ topicId, userId });
  }

  /** Whether this deployment runs cloud computers at all. */
  isAvailable() {
    return getSandboxProviderKind() === 'openbot' && !this.computer.missingConfig();
  }

  /** What the page shows: the computer's state, who holds it, and (when asked) a screenshot. */
  async view({ withScreen = true }: { withScreen?: boolean } = {}): Promise<CloudComputerView> {
    if (!this.isAvailable()) return { status: 'unavailable' };

    const url = await this.computer.runningUrl();
    if (!url) return { status: 'off' };

    try {
      const [control, screen] = await Promise.all([
        this.computer.call<ControlState>(url, '/control'),
        withScreen
          ? this.computer.call<Screenshot>(url, '/screenshot').catch((error) => {
              // A browser between pages has no picture for a moment; the next poll gets one.
              log('screenshot failed: %s', (error as Error).message);
              return undefined;
            })
          : undefined,
      ]);
      return { control: summarise(control), screen, status: 'running' };
    } catch (error) {
      if (error instanceof OpenBotRequestError) throw error;
      // Not answering at the cached address: it stopped since. Ask the supervisor afresh next time.
      log('computer not answering: %s', (error as Error).message);
      this.computer.forget();
      return { status: 'off' };
    }
  }

  /** Starts the computer, for a person who wants to look at it before the assistant needs it. */
  async start(): Promise<CloudComputerView> {
    this.assertAvailable();
    await this.computer.ensure();
    log('started');
    return this.view({ withScreen: false });
  }

  /**
   * Takes the browser: answers the Bot's open request for help, or raises one in the person's own
   * name and takes it. The computer waits for the Bot's action in flight to finish first.
   */
  async takeOver(): Promise<CloudComputerView> {
    const url = await this.runningOrThrow();
    const asked = await this.mapErrors(() =>
      this.computer.call<ControlState>(url, '/control/request', {
        body: JSON.stringify({ reason: MANUAL_TAKEOVER_REASON, source: 'manual' }),
        method: 'POST',
      }),
    );
    if (asked.holder !== 'human') {
      const requestId = asked.request?.id;
      if (!requestId) throw conflict('The computer did not open a request to take over');
      await this.mapErrors(() =>
        this.computer.call<ControlState>(url, '/control/take', {
          body: JSON.stringify({ requestId }),
          method: 'POST',
        }),
      );
    }
    log('taken over (bot asked: %s)', asked.request?.source === 'model');
    return this.view({ withScreen: false });
  }

  /** Gives the browser back to the Bot, which looks at the page afresh before it acts again. */
  async handBack(): Promise<CloudComputerView> {
    const url = await this.runningOrThrow();
    const state = await this.mapErrors(() => this.computer.call<ControlState>(url, '/control'));
    if (state.holder === 'human' && state.request?.id) {
      await this.mapErrors(() =>
        this.computer.call<ControlState>(url, '/control/release', {
          body: JSON.stringify({ requestId: state.request!.id }),
          method: 'POST',
        }),
      );
      log('handed back');
    }
    return this.view({ withScreen: false });
  }

  /** One click, key, scroll or piece of text from the person holding the browser. */
  async input(input: ComputerInput) {
    const url = await this.runningOrThrow();
    const { kind, ...body } = input;
    // Never log `body`: it can be a password the person is typing.
    await this.mapErrors(() =>
      this.computer.call(url, `/human/${kind}`, { body: JSON.stringify(body), method: 'POST' }),
    );
    return { ok: true };
  }

  private assertAvailable() {
    if (!this.isAvailable()) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'This deployment has no cloud computers',
      });
    }
  }

  private async runningOrThrow() {
    this.assertAvailable();
    const url = await this.computer.runningUrl();
    if (!url) throw conflict('The cloud computer is not running');
    return url;
  }

  /** The computer's own refusals (take control first, not waiting any more) become a conflict. */
  private async mapErrors<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof OpenBotRequestError && error.status < 500) {
        throw conflict(error.message);
      }
      throw error;
    }
  }
}

const summarise = (control: ControlState): CloudComputerView['control'] => ({
  helpRequested: control.requested && control.request?.source !== 'manual',
  holder: control.holder,
  reason: control.requested && control.request?.source !== 'manual' ? control.reason : undefined,
  secretWanted: control.secretWanted,
});

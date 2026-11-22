import { isActivatingKey, isConsequentialControl } from '@lobechat/agent-policy';
import type {
  ClickParams,
  ClickWithApprovalParams,
  NavigateParams,
  PressKeyParams,
  PressKeyWithApprovalParams,
  RequestHelpParams,
  ScrollParams,
  TypeParams,
} from '@lobechat/builtin-tool-computer';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import debug from 'debug';

import { NotificationModel } from '@/database/models/notification';
import type { LobeChatDatabase } from '@/database/type';
import { sandboxEnv } from '@/envs/sandbox';
import { expiringCache } from '@/server/services/messenger/expiringCache';
import { PushChannel } from '@/server/services/push/PushChannel';
import { getSandboxProviderKind } from '@/server/services/sandbox/factory';
import {
  OpenBotComputer,
  OpenBotRequestError,
} from '@/server/services/sandbox/providers/openbotComputer';

const log = debug('lobe-server:computer-tools');

/** How long the server remembers what a snapshot showed, to judge the actions taken on it. */
const SNAPSHOT_TTL_SECONDS = 30 * 60;

/** The push sent when Biber asks for the user: fixed words, since a push leaves the app. */
const HELP_PUSH = {
  en: { content: 'Open the cloud computer to help it continue.', title: 'Biber needs you' },
  zh: { content: '打开云电脑，帮它完成这一步。', title: 'Biber 需要你' },
};

/** Whether this deployment gives Biber a browser: an OpenBot computer, configured. */
export const isCloudComputerAvailable = () =>
  getSandboxProviderKind() === 'openbot' &&
  !!sandboxEnv.OPENBOT_SUPERVISOR_URL &&
  !!sandboxEnv.OPENBOT_SUPERVISOR_TOKEN &&
  !!sandboxEnv.OPENBOT_COMPUTER_TOKEN;

interface SnapshotElement {
  checked?: boolean;
  disabled?: boolean;
  name: string;
  ref: string;
  role: string;
  value?: string;
}

interface ComputerSnapshot {
  elements: SnapshotElement[];
  snapshotId: number;
  title: string;
  truncated: boolean;
  url: string;
}

interface PageText {
  challenge?: { reason?: string } | null;
  text?: string;
  title?: string;
  truncated?: boolean;
  url?: string;
}

/** What the server keeps of a snapshot: the names it shows, never the values typed into fields. */
interface RememberedSnapshot {
  elements: { name: string; ref: string; role: string }[];
  site: string;
  snapshotId: number;
}

const siteOf = (url: string) => {
  try {
    const { origin, protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : url;
  } catch {
    return url;
  }
};

const failure = (type: string, message: string): BuiltinServerRuntimeOutput => ({
  content: message,
  error: { message, type },
  success: false,
});

const quoted = (value: string) => JSON.stringify(value);

const pageText = (result: PageText, verb: string) => {
  const lines = [`${verb} ${result.url ?? ''}${result.title ? ` · ${result.title}` : ''}`];
  if (result.challenge) {
    lines.push(
      'The page is showing a check only a person can pass. Call requestHelp, saying the user needs to get past it.',
    );
  }
  lines.push('', result.text?.trim() || '(no readable text)');
  if (result.truncated) lines.push('', '(the text was cut short; scroll and read for more)');
  return lines.join('\n');
};

/**
 * Biber's hands on its cloud computer's browser. Every action goes to the user's own computer, and
 * the server judges each one from its own record of the page, not from what the model says: a
 * button that pays, orders, sends or deletes is refused here and goes through the approved path,
 * which first checks that the button and site it names are the ones the page showed.
 */
export class ComputerToolsService {
  private readonly computer: OpenBotComputer;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    topicId?: string,
  ) {
    this.computer = new OpenBotComputer({ topicId, userId });
  }

  private get snapshotKey() {
    return `computer:snapshot:${this.computer.id}`;
  }

  /** Runs one call to the computer, turning its refusals into answers the model can act on. */
  private async run(
    doing: string,
    call: (url: string) => Promise<BuiltinServerRuntimeOutput>,
  ): Promise<BuiltinServerRuntimeOutput> {
    if (!isCloudComputerAvailable()) {
      return failure('ComputerUnavailable', 'This deployment has no cloud computer.');
    }
    const missing = this.computer.missingConfig();
    if (missing) return failure('ComputerUnavailable', missing);

    try {
      return await call(await this.computer.ensure());
    } catch (error) {
      if (error instanceof OpenBotRequestError && error.status < 500) {
        log('userId=%s %s refused: %s', this.userId, doing, error.message);
        return failure('ComputerRefused', error.message);
      }
      if (error instanceof OpenBotRequestError) {
        log('userId=%s %s failed: %s', this.userId, doing, error.message);
        return failure('ComputerFailed', `Could not ${doing}: ${error.message}`);
      }
      log('userId=%s %s unreachable: %s', this.userId, doing, (error as Error).message);
      this.computer.forget();
      return failure(
        'ComputerUnreachable',
        `Could not ${doing}: the cloud computer did not answer.`,
      );
    }
  }

  private post<T>(url: string, path: string, body: object = {}) {
    return this.computer.call<T>(url, path, { body: JSON.stringify(body), method: 'POST' });
  }

  private async remembered(): Promise<RememberedSnapshot | undefined> {
    const raw = await expiringCache.get(this.snapshotKey);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as RememberedSnapshot;
    } catch {
      return undefined;
    }
  }

  /** The snapshot an action names, or why it cannot be used. */
  private async snapshotFor(snapshotId: number | undefined) {
    const snapshot = await this.remembered();
    if (!snapshot || snapshot.snapshotId !== snapshotId) {
      return {
        error: failure(
          'ComputerStaleSnapshot',
          'That snapshot is out of date or unknown. Take a new snapshot and use its refs and snapshotId.',
        ),
      };
    }
    return { snapshot };
  }

  private elementIn(snapshot: RememberedSnapshot, ref: string) {
    return snapshot.elements.find((element) => element.ref === ref);
  }

  private consequentialOn(snapshot: RememberedSnapshot) {
    return snapshot.elements.filter((element) => isConsequentialControl(element));
  }

  async navigate(args: NavigateParams) {
    return this.run('open the page', async (url) => {
      const result = await this.post<PageText>(url, '/navigate', { url: args.url });
      await expiringCache.del(this.snapshotKey);
      log('userId=%s navigated to %s', this.userId, siteOf(result.url ?? ''));
      return { content: pageText(result, 'Opened'), success: true };
    });
  }

  async read() {
    return this.run('read the page', async (url) => {
      const result = await this.computer.call<PageText>(url, '/read');
      return { content: pageText(result, 'Reading'), success: true };
    });
  }

  async snapshot() {
    return this.run('look at the page', async (url) => {
      const result = await this.post<ComputerSnapshot & { challenge?: unknown }>(url, '/snapshot');
      const site = siteOf(result.url);
      const remembered: RememberedSnapshot = {
        elements: result.elements.map(({ name, ref, role }) => ({ name, ref, role })),
        site,
        snapshotId: result.snapshotId,
      };
      await expiringCache.set(this.snapshotKey, JSON.stringify(remembered), SNAPSHOT_TTL_SECONDS);

      const lines = [
        `Site: ${site} · snapshotId ${result.snapshotId}`,
        `Page: ${result.title || '(untitled)'} (${result.url})`,
        '',
        ...result.elements.map((element) => {
          const parts = [`- ${element.ref} ${element.role} ${quoted(element.name)}`];
          if (element.value !== undefined && element.value !== '') {
            parts.push(`= ${quoted(element.value)}`);
          }
          if (element.checked !== undefined)
            parts.push(element.checked ? '(checked)' : '(unchecked)');
          if (element.disabled) parts.push('(disabled)');
          if (isConsequentialControl(element)) parts.push('· needs approval: clickWithApproval');
          return parts.join(' ');
        }),
      ];
      if (result.elements.length === 0) lines.push('(nothing to act on)');
      if (result.truncated) lines.push('', '(the list was cut short; scroll and snapshot again)');
      if (result.challenge) {
        lines.push('', 'The page is showing a check only a person can pass: call requestHelp.');
      }
      return { content: lines.join('\n'), success: true };
    });
  }

  async scroll(args: ScrollParams) {
    return this.run('scroll', async (url) => {
      await this.post(url, '/scroll', { deltaY: args.deltaY });
      return { content: 'Scrolled. Take a new snapshot before acting.', success: true };
    });
  }

  async click(args: ClickParams) {
    const { error, snapshot } = await this.snapshotFor(args.snapshotId);
    if (error) return error;
    const element = this.elementIn(snapshot, args.ref);
    if (!element) {
      return failure('ComputerUnknownRef', `No ${args.ref} in that snapshot. Take a new snapshot.`);
    }
    if (isConsequentialControl(element)) {
      log('userId=%s click on a %s held for approval', this.userId, element.role);
      return failure(
        'ComputerNeedsApproval',
        `${quoted(element.name)} on ${snapshot.site} pays, orders, sends or deletes something, so the user approves it first. If the user asked for it, call clickWithApproval with ref ${args.ref}, snapshotId ${snapshot.snapshotId}, element ${quoted(element.name)} and site ${quoted(snapshot.site)}.`,
      );
    }
    return this.act('click', args.ref, () => ({ ref: args.ref, snapshotId: args.snapshotId }));
  }

  async type(args: TypeParams) {
    const { error, snapshot } = await this.snapshotFor(args.snapshotId);
    if (error) return error;
    if (!this.elementIn(snapshot, args.ref)) {
      return failure('ComputerUnknownRef', `No ${args.ref} in that snapshot. Take a new snapshot.`);
    }
    const holding = args.submit ? this.consequentialOn(snapshot)[0] : undefined;
    if (holding) {
      return failure(
        'ComputerNeedsApproval',
        `Pressing Enter on this page could submit ${quoted(holding.name)} on ${snapshot.site}, which the user approves first. Type without submit, then call pressKeyWithApproval with key "Enter", ref ${args.ref}, snapshotId ${snapshot.snapshotId}, element ${quoted(holding.name)} and site ${quoted(snapshot.site)}.`,
      );
    }
    // The text itself is never logged nor echoed back: it can be anything the model put in a form.
    return this.act('type', args.ref, () => ({
      ref: args.ref,
      snapshotId: args.snapshotId,
      submit: args.submit === true,
      text: args.text,
    }));
  }

  async pressKey(args: PressKeyParams) {
    if (!args.ref && !isActivatingKey(args.key)) {
      return this.act('key', undefined, () => ({ key: args.key }));
    }
    const { error, snapshot } = await this.snapshotFor(args.snapshotId);
    if (error) return error;
    const element = args.ref ? this.elementIn(snapshot, args.ref) : undefined;
    if (args.ref && !element) {
      return failure('ComputerUnknownRef', `No ${args.ref} in that snapshot. Take a new snapshot.`);
    }
    if (isActivatingKey(args.key)) {
      const holding =
        element && isConsequentialControl(element) ? element : this.consequentialOn(snapshot)[0];
      if (holding) {
        return failure(
          'ComputerNeedsApproval',
          `${args.key} here could press or submit ${quoted(holding.name)} on ${snapshot.site}, which the user approves first. If the user asked for it, call pressKeyWithApproval with key ${quoted(args.key)}${args.ref ? `, ref ${args.ref}` : ''}, snapshotId ${snapshot.snapshotId}, element ${quoted(holding.name)} and site ${quoted(snapshot.site)}.`,
        );
      }
    }
    return this.act('key', args.ref, () => ({
      key: args.key,
      ...(args.ref && { ref: args.ref, snapshotId: args.snapshotId }),
    }));
  }

  /** The approved click: only on the button and site the page itself showed. */
  async clickWithApproval(args: ClickWithApprovalParams) {
    const { error, snapshot } = await this.snapshotFor(args.snapshotId);
    if (error) return error;
    const element = this.elementIn(snapshot, args.ref);
    if (!element || element.name !== args.element?.trim() || snapshot.site !== args.site?.trim()) {
      log('userId=%s approved click did not match the page', this.userId);
      return failure(
        'ComputerMismatch',
        'The approved button or site is not what that snapshot showed, so nothing was clicked. Take a new snapshot and ask again with its exact names.',
      );
    }
    return this.act('click', args.ref, () => ({ ref: args.ref, snapshotId: args.snapshotId }));
  }

  /** The approved key press: only on a page that shows the button the user was told about. */
  async pressKeyWithApproval(args: PressKeyWithApprovalParams) {
    const { error, snapshot } = await this.snapshotFor(args.snapshotId);
    if (error) return error;
    const named = this.consequentialOn(snapshot).some(
      (element) => element.name === args.element?.trim(),
    );
    const refKnown = !args.ref || !!this.elementIn(snapshot, args.ref);
    if (!named || !refKnown || snapshot.site !== args.site?.trim()) {
      log('userId=%s approved key press did not match the page', this.userId);
      return failure(
        'ComputerMismatch',
        'The approved button or site is not what that snapshot showed, so no key was pressed. Take a new snapshot and ask again with its exact names.',
      );
    }
    return this.act('key', args.ref, () => ({
      key: args.key,
      ...(args.ref && { ref: args.ref, snapshotId: args.snapshotId }),
    }));
  }

  /** Asks the user to take over, and lets their phone know. */
  async requestHelp(args: RequestHelpParams) {
    return this.run('ask for help', async (url) => {
      const state = await this.post<{ request?: { id?: string } }>(url, '/control/request', {
        reason: args.reason?.slice(0, 500),
        source: 'model',
      });
      await this.notify(state.request?.id).catch((error) =>
        log('userId=%s help push failed: %s', this.userId, (error as Error).message),
      );
      return {
        content:
          'Asked the user to take over the browser; they have been notified. Tell them what you need, and wait: once they hand it back, take a new snapshot before acting.',
        success: true,
      };
    });
  }

  private async act(
    action: 'click' | 'key' | 'type',
    ref: string | undefined,
    body: () => object,
  ): Promise<BuiltinServerRuntimeOutput> {
    return this.run(action === 'key' ? 'press the key' : action, async (url) => {
      const result = await this.post<{ url?: string }>(url, `/${action}`, body());
      log('userId=%s %s %s', this.userId, action, ref ?? 'page');
      const done = action === 'click' ? 'Clicked' : action === 'type' ? 'Typed into' : 'Pressed on';
      return {
        content: `${done} ${ref ?? 'the page'}; the page is now at ${result.url ?? 'the same address'}. Read or take a new snapshot to see what changed.`,
        success: true,
      };
    });
  }

  private async notify(requestId: string | undefined) {
    const notification = await new NotificationModel(this.db, this.userId).create({
      actionUrl: '/computer',
      category: 'agent',
      content: HELP_PUSH.en.content,
      dedupeKey: requestId ? `computer-help:${requestId}` : undefined,
      title: HELP_PUSH.en.title,
      type: 'computer_help',
    });
    if (!notification) return;
    await new PushChannel().deliver({
      actionUrl: '/computer',
      content: HELP_PUSH.en.content,
      data: { kind: 'computer' },
      notificationId: notification.id,
      title: HELP_PUSH.en.title,
      translations: HELP_PUSH,
      userId: this.userId,
    });
  }
}

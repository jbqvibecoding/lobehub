import { createHmac } from 'node:crypto';

import debug from 'debug';
import { sha256 } from 'js-sha256';

import { sandboxEnv } from '@/envs/sandbox';

const log = debug('lobe-server:sandbox:openbot-computer');

/** How long a resolved computer URL is reused before the supervisor is asked again. */
const COMPUTER_URL_TTL_MS = 60_000;

export interface OpenBotComputerState {
  botId?: string;
  error?: string;
  /** Docker's state (`running`, `exited`, …), or `absent` when the computer was never made. */
  status?: string;
  /** Where to reach it; given only while it runs. */
  url?: string;
}

/** A request the supervisor or a computer answered with an error, with the HTTP status it used. */
export class OpenBotRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenBotRequestError';
  }
}

/**
 * Every public IPv4 range (0/8, 10/8, 100.64/10, 127/8, 172.16/12, 192.168/16 and 224/3 left out)
 * and the global IPv6 unicast range without 6to4, which can wrap a private IPv4 address. 169.254/16
 * sits inside 168/6 here, but the computer refuses cloud metadata addresses whatever the policy.
 */
const PUBLIC_INTERNET = [
  '1.0.0.0/8',
  '2.0.0.0/7',
  '4.0.0.0/6',
  '8.0.0.0/7',
  '11.0.0.0/8',
  '12.0.0.0/6',
  '16.0.0.0/4',
  '32.0.0.0/3',
  '64.0.0.0/3',
  '96.0.0.0/6',
  '100.0.0.0/10',
  '100.128.0.0/9',
  '101.0.0.0/8',
  '102.0.0.0/7',
  '104.0.0.0/5',
  '112.0.0.0/5',
  '120.0.0.0/6',
  '124.0.0.0/7',
  '126.0.0.0/8',
  '128.0.0.0/3',
  '160.0.0.0/5',
  '168.0.0.0/6',
  '172.0.0.0/12',
  '172.32.0.0/11',
  '172.64.0.0/10',
  '172.128.0.0/9',
  '173.0.0.0/8',
  '174.0.0.0/7',
  '176.0.0.0/4',
  '192.0.0.0/9',
  '192.128.0.0/11',
  '192.160.0.0/13',
  '192.169.0.0/16',
  '192.170.0.0/15',
  '192.172.0.0/14',
  '192.176.0.0/12',
  '192.192.0.0/10',
  '193.0.0.0/8',
  '194.0.0.0/7',
  '196.0.0.0/6',
  '200.0.0.0/5',
  '208.0.0.0/4',
  '2000::/15',
  '2003::/16',
  '2004::/14',
  '2008::/13',
  '2010::/12',
  '2020::/11',
  '2040::/10',
  '2080::/9',
  '2100::/8',
  '2200::/7',
  '2400::/6',
  '2800::/5',
  '3000::/4',
];

/**
 * The network policy a computer is given (agent-computer `egress.ts`). A computer refuses every
 * connection until it has one: the OpenBot API server pushed it, and Biber's server does in its place.
 */
export const egressPolicyFor = (setting: 'all' | 'none' | 'public' = 'public') => {
  if (setting === 'all') return { mode: 'allow_all', rules: [] };
  if (setting === 'none') return { mode: 'deny_all', rules: [] };
  return {
    mode: 'allowlist_only',
    rules: PUBLIC_INTERNET.map((value) => ({ type: 'cidr', value })),
  };
};

const computerUrlCache = new Map<string, { expiresAt: number; url: string }>();

/** Test hook: the cache is module state shared by every instance. */
export const clearOpenBotComputerCache = () => computerUrlCache.clear();

/**
 * The token one computer accepts: an HMAC of its id under OPENBOT_COMPUTER_TOKEN. The supervisor
 * gives each computer only its own (`computerTokenFor` in apps/computer/supervisor/src/environment.ts;
 * keep the two identical), so a command running on one user's computer can read its token and still
 * reach no other user's computer.
 */
export const computerTokenFor = (secret: string, computerId: string) =>
  createHmac('sha256', secret).update(`computer:${computerId}`).digest('hex');

/**
 * One user's OpenBot computer (or one conversation's, with `OPENBOT_COMPUTER_SCOPE=topic`), as the
 * supervisor and the computer itself see it. The sandbox tools run commands through it, and the
 * cloud computer page watches and drives its browser through it.
 */
export class OpenBotComputer {
  private readonly computerToken: string;
  private readonly scope: 'topic' | 'user';
  private readonly supervisorToken: string;
  private readonly supervisorUrl: string;

  constructor(private readonly owner: { topicId?: string; userId: string }) {
    this.supervisorUrl = (sandboxEnv.OPENBOT_SUPERVISOR_URL || '').replace(/\/+$/, '');
    this.supervisorToken = sandboxEnv.OPENBOT_SUPERVISOR_TOKEN || '';
    this.computerToken = sandboxEnv.OPENBOT_COMPUTER_TOKEN || '';
    this.scope = sandboxEnv.OPENBOT_COMPUTER_SCOPE || 'user';
  }

  /** Why the computer cannot be reached at all, or undefined when it is configured. */
  missingConfig() {
    if (!this.supervisorUrl || !this.supervisorToken || !this.computerToken) {
      return 'OPENBOT_SUPERVISOR_URL, OPENBOT_SUPERVISOR_TOKEN and OPENBOT_COMPUTER_TOKEN are required';
    }
    if (this.scope === 'topic' && !this.owner.topicId) {
      return 'Each conversation has its own computer here (OPENBOT_COMPUTER_SCOPE=topic); name the conversation';
    }
  }

  /** The supervisor only accepts plain ids of at most 64 characters, so the scope is hashed. */
  get id() {
    if (this.scope === 'topic') {
      return `t-${sha256(`${this.owner.userId}:${this.owner.topicId}`).slice(0, 40)}`;
    }

    return `u-${sha256(this.owner.userId).slice(0, 40)}`;
  }

  /** Asks the supervisor for this computer, starting it when it is not running. */
  async ensure(): Promise<string> {
    const computerId = this.id;
    const cached = computerUrlCache.get(computerId);

    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const state = await this.request<OpenBotComputerState>(
      `${this.supervisorUrl}/computers/${computerId}/ensure`,
      { headers: { Authorization: `Bearer ${this.supervisorToken}` }, method: 'POST' },
    );

    if (!state.url) {
      throw new Error(`OpenBot supervisor returned no address for computer ${computerId}`);
    }

    log('Computer %s is %s at %s', computerId, state.status, state.url);
    return this.remember(state.url);
  }

  /** The computer as it is, without starting it. */
  async describe(): Promise<OpenBotComputerState> {
    const state = await this.request<OpenBotComputerState>(
      `${this.supervisorUrl}/computers/${this.id}`,
      { headers: { Authorization: `Bearer ${this.supervisorToken}` }, method: 'GET' },
    );
    if (state.status === 'running' && state.url) await this.remember(state.url);
    else computerUrlCache.delete(this.id);
    return state;
  }

  /** The address of the running computer, or undefined when it is not running. */
  async runningUrl(): Promise<string | undefined> {
    const cached = computerUrlCache.get(this.id);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const state = await this.describe();
    return state.status === 'running' ? state.url?.replace(/\/+$/, '') : undefined;
  }

  /** Forgets the cached address, after the computer stopped answering at it. */
  forget() {
    computerUrlCache.delete(this.id);
  }

  /** One call to the computer's own API, as this computer's bot. */
  call<T>(computerUrl: string, path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${computerTokenFor(this.computerToken, this.id)}`);
    headers.set('x-openbot-bot-id', this.id);
    return this.request<T>(`${computerUrl}${path}`, { ...init, headers });
  }

  /**
   * Keeps a computer's address once it has its network policy. The policy lives in the computer's
   * memory, so it is pushed whenever the address is looked up afresh (a computer that restarted is
   * found again then), and an address is not kept until the push has landed.
   */
  private async remember(rawUrl: string) {
    const url = rawUrl.replace(/\/+$/, '');
    await this.call(url, '/egress-policy', {
      body: JSON.stringify({ policy: egressPolicyFor(sandboxEnv.OPENBOT_COMPUTER_EGRESS) }),
      method: 'PUT',
    });
    computerUrlCache.set(this.id, { expiresAt: Date.now() + COMPUTER_URL_TTL_MS, url });
    return url;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, { ...init, headers });
    const body = await response.text();
    let json: any;
    try {
      json = body ? JSON.parse(body) : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      throw new OpenBotRequestError(
        typeof json?.error === 'string'
          ? json.error
          : `OpenBot request failed with HTTP ${response.status}`,
        response.status,
      );
    }

    return json as T;
  }
}

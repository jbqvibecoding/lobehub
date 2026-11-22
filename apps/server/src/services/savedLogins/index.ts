import debug from 'debug';

import { SavedLoginModel } from '@/database/models/savedLogin';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-server:saved-logins');

export const SAVED_LOGIN_LIMIT = 50;

/** Why a login could not be saved, for the phone to explain. */
export type SavedLoginFailure = 'limit' | 'site';

export class SavedLoginError extends Error {
  readonly reason: SavedLoginFailure;

  constructor(reason: SavedLoginFailure, message: string) {
    super(message);
    this.name = 'SavedLoginError';
    this.reason = reason;
  }
}

/** Only for local testing against a site on this machine: allows plain http. Never in production. */
const allowsHttp = () => process.env.SAVED_LOGINS_ALLOW_HTTP === '1';

/**
 * The one site a login may be typed into, from what the user wrote: `qq.com` becomes
 * `https://qq.com`, a path is dropped, and only https is taken.
 */
export const siteFromInput = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) throw new SavedLoginError('site', 'Enter the website');
  let url: URL;
  try {
    url = new URL(/^[a-z][\d+.a-z-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new SavedLoginError('site', 'That is not a website address');
  }
  const httpOk = url.protocol === 'http:' && allowsHttp();
  if ((url.protocol !== 'https:' && !httpOk) || !url.hostname || url.username || url.password) {
    throw new SavedLoginError('site', 'Only https websites can have a saved login');
  }
  return url.origin;
};

/** What may be shown of a user name: a•••@qq.com, •••• 1234, ad•••. */
export const accountHintFor = (username: string) => {
  const name = username.trim();
  if (!name) return '';
  const at = name.lastIndexOf('@');
  if (at > 0) return `${name[0]}•••${name.slice(at)}`;
  const digits = name.replaceAll(/\D/g, '');
  if (digits.length >= 7 && digits.length === name.replaceAll(/[\s()+-]/g, '').length) {
    return `•••• ${digits.slice(-4)}`;
  }
  return `${name.slice(0, Math.min(2, name.length - 1))}•••`;
};

const labelFor = (site: string) => new URL(site).hostname.replace(/^www\./, '');

/**
 * The website logins a user saved on the phone for Biber to sign in with. The user name and
 * password are encrypted with the key vault and leave this service only to be typed into the one
 * site they were saved for; nothing here returns them.
 */
export class SavedLoginService {
  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  private async logins() {
    return new SavedLoginModel(this.db, this.userId, await KeyVaultsGateKeeper.initWithEnvKey());
  }

  /** The user's logins as the phone and Biber see them: no user name, no password. */
  async list() {
    const logins = await (await this.logins()).list();
    return logins.map((login) => ({
      account: login.accountHint,
      id: login.id,
      label: login.label,
      lastUsedAt: login.lastUsedAt,
      site: login.origin,
    }));
  }

  async create(input: { label?: string; password: string; site: string; username?: string }) {
    const site = siteFromInput(input.site);
    const logins = await this.logins();
    if ((await logins.list()).length >= SAVED_LOGIN_LIMIT) {
      throw new SavedLoginError('limit', `At most ${SAVED_LOGIN_LIMIT} saved logins`);
    }
    const username = input.username?.trim() ?? '';
    const saved = await logins.create({
      accountHint: accountHintFor(username),
      label: input.label?.trim() || labelFor(site),
      origin: site,
      password: input.password,
      username,
    });
    log('userId=%s saved a login for %s', this.userId, site);
    return { account: saved.accountHint, id: saved.id, label: saved.label, site: saved.origin };
  }

  async remove(id: string) {
    const removed = await (await this.logins()).remove(id);
    log('userId=%s removed login %s: %s', this.userId, id, removed);
    return removed;
  }

  /** The login decrypted, for the server to type into its site; never for a client or a model. */
  async secretFor(id: string) {
    return (await this.logins()).secretFor(id);
  }

  async touch(id: string) {
    await (await this.logins()).touch(id);
  }
}

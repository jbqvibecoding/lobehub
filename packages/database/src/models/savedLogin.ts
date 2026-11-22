import { and, asc, eq } from 'drizzle-orm';

import type { SavedLoginItem } from '../schemas/savedLogin';
import { savedLogins } from '../schemas/savedLogin';
import type { LobeChatDatabase } from '../type';
import type { CredentialsGateKeeper } from './personalAccount';

/** What may be shown about a saved login: everything but its credentials. */
export type SavedLoginSummary = Omit<SavedLoginItem, 'credentials'>;

/** The user name and password of a saved login, for the server to type and nothing else. */
export interface SavedLoginSecret {
  password: string;
  username: string;
}

const withoutCredentials = ({ credentials: _credentials, ...rest }: SavedLoginItem) => rest;

/**
 * One user's saved website logins. The user name and password are encrypted on the way in, and
 * only `secretFor` decrypts them; the key vault is required, so nothing here can store them in
 * plain text.
 */
export class SavedLoginModel {
  private readonly db: LobeChatDatabase;
  private readonly gateKeeper: CredentialsGateKeeper;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string, gateKeeper: CredentialsGateKeeper) {
    this.db = db;
    this.userId = userId;
    this.gateKeeper = gateKeeper;
  }

  private mine = (id: string) => and(eq(savedLogins.userId, this.userId), eq(savedLogins.id, id));

  /** The user's saved logins, without credentials, by site then name. */
  async list(): Promise<SavedLoginSummary[]> {
    const rows = await this.db
      .select()
      .from(savedLogins)
      .where(eq(savedLogins.userId, this.userId))
      .orderBy(asc(savedLogins.origin), asc(savedLogins.label), asc(savedLogins.createdAt));
    return rows.map(withoutCredentials);
  }

  /** One of the user's saved logins, without credentials; undefined when it is not theirs. */
  async find(id: string): Promise<SavedLoginSummary | undefined> {
    const [row] = await this.db.select().from(savedLogins).where(this.mine(id)).limit(1);
    return row ? withoutCredentials(row) : undefined;
  }

  /** The login with its user name and password decrypted, for the server to type. */
  async secretFor(
    id: string,
  ): Promise<(SavedLoginSummary & { secret: SavedLoginSecret }) | undefined> {
    const [row] = await this.db.select().from(savedLogins).where(this.mine(id)).limit(1);
    if (!row) return undefined;
    const { plaintext } = await this.gateKeeper.decrypt(row.credentials);
    const secret = JSON.parse(plaintext) as SavedLoginSecret;
    return { ...withoutCredentials(row), secret };
  }

  async create(login: {
    accountHint: string;
    label: string;
    origin: string;
    password: string;
    username: string;
  }): Promise<SavedLoginSummary> {
    const credentials = await this.gateKeeper.encrypt(
      JSON.stringify({ password: login.password, username: login.username }),
    );
    const [row] = await this.db
      .insert(savedLogins)
      .values({
        accountHint: login.accountHint,
        credentials,
        label: login.label,
        origin: login.origin,
        userId: this.userId,
      })
      .returning();
    return withoutCredentials(row);
  }

  /** Notes that the login was just used. */
  async touch(id: string) {
    await this.db.update(savedLogins).set({ lastUsedAt: new Date() }).where(this.mine(id));
  }

  /** Deletes the login, credentials and all. Whether there was one. */
  async remove(id: string) {
    const removed = await this.db
      .delete(savedLogins)
      .where(this.mine(id))
      .returning({ id: savedLogins.id });
    return removed.length > 0;
  }
}

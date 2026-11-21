import { and, eq } from 'drizzle-orm';

import type {
  PersonalAccountItem,
  PersonalAccountKind,
  PersonalAccountProvider,
  PersonalAccountStatus,
} from '../schemas/personalAccount';
import { personalAccounts } from '../schemas/personalAccount';
import type { LobeChatDatabase } from '../type';

/** Encrypts and decrypts credentials; the server passes its key vault. */
export interface CredentialsGateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

/** What may be shown about an account: everything but its credentials. */
export type PersonalAccountSummary = Omit<PersonalAccountItem, 'credentials'>;

/** An account with its credentials decrypted, for the server's own use only. */
export type PersonalAccountWithCredentials = PersonalAccountSummary & { credentials: string };

const withoutCredentials = ({ credentials: _credentials, ...rest }: PersonalAccountItem) => rest;

/**
 * One user's connected mailbox and calendar. Credentials are encrypted on the way in and only
 * `find` decrypts them; nothing here can store them in plain text, since the key vault is
 * required.
 */
export class PersonalAccountModel {
  private readonly db: LobeChatDatabase;
  private readonly gateKeeper: CredentialsGateKeeper;
  private readonly userId: string;

  constructor(db: LobeChatDatabase, userId: string, gateKeeper: CredentialsGateKeeper) {
    this.db = db;
    this.userId = userId;
    this.gateKeeper = gateKeeper;
  }

  private mine = (kind: PersonalAccountKind) =>
    and(eq(personalAccounts.userId, this.userId), eq(personalAccounts.kind, kind));

  /** The user's accounts, without credentials. */
  async list(): Promise<PersonalAccountSummary[]> {
    const rows = await this.db
      .select()
      .from(personalAccounts)
      .where(eq(personalAccounts.userId, this.userId));
    return rows.map(withoutCredentials);
  }

  /** The user's account of this kind, credentials decrypted; undefined when none is connected. */
  async find(kind: PersonalAccountKind): Promise<PersonalAccountWithCredentials | undefined> {
    const [row] = await this.db.select().from(personalAccounts).where(this.mine(kind)).limit(1);
    if (!row) return undefined;
    const { plaintext } = await this.gateKeeper.decrypt(row.credentials);
    return { ...withoutCredentials(row), credentials: plaintext };
  }

  /** Connects an account of this kind, replacing the one connected before. */
  async save(account: {
    credentials: string;
    kind: PersonalAccountKind;
    label: string;
    provider: PersonalAccountProvider;
    settings: Record<string, unknown>;
  }): Promise<PersonalAccountSummary> {
    const credentials = await this.gateKeeper.encrypt(account.credentials);
    const values = {
      credentials,
      label: account.label,
      lastError: null,
      provider: account.provider,
      settings: account.settings,
      status: 'active' as const,
      updatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(personalAccounts)
      .values({ ...values, kind: account.kind, userId: this.userId })
      .onConflictDoUpdate({
        set: values,
        target: [personalAccounts.userId, personalAccounts.kind],
      })
      .returning();
    return withoutCredentials(row);
  }

  /** New credentials (a refreshed token), a new status, or the last error. */
  async update(
    kind: PersonalAccountKind,
    patch: {
      credentials?: string;
      label?: string;
      lastError?: string | null;
      settings?: Record<string, unknown>;
      status?: PersonalAccountStatus;
    },
  ) {
    const { credentials, ...rest } = patch;
    await this.db
      .update(personalAccounts)
      .set({
        ...rest,
        ...(credentials !== undefined && {
          credentials: await this.gateKeeper.encrypt(credentials),
        }),
        updatedAt: new Date(),
      })
      .where(this.mine(kind));
  }

  /** Disconnects the account; its credentials go with it. Whether there was one. */
  async remove(kind: PersonalAccountKind) {
    const removed = await this.db
      .delete(personalAccounts)
      .where(this.mine(kind))
      .returning({ id: personalAccounts.id });
    return removed.length > 0;
  }
}

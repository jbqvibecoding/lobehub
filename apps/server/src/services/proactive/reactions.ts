import { BriefModel } from '@/database/models/brief';
import { NotificationModel } from '@/database/models/notification';
import { ProactiveMessageModel } from '@/database/models/proactiveMessage';
import type { LobeChatDatabase } from '@/database/type';

/**
 * The phone reports a tap on an unprompted message: the ledger counts it as opened, and the inbox
 * row and the routine's brief it showed are marked read. Returns the message's state, or null
 * when it is not the user's.
 */
export const reportProactiveOpened = async (db: LobeChatDatabase, userId: string, id: string) => {
  const ledger = new ProactiveMessageModel(db, userId);
  const message = (await ledger.markOpened(id)) ?? (await ledger.findById(id));
  if (!message) return null;

  if (message.notificationId) {
    await new NotificationModel(db, userId).markAsRead([message.notificationId]);
  }
  if (message.briefId) await new BriefModel(db, userId).markRead(message.briefId);

  return { state: message.state };
};

/**
 * The phone reports "Not now" on an unprompted message: the ledger counts it as unwanted, which
 * makes Biber bring up that kind of thing less. Returns null when the message is not the user's.
 */
export const reportProactiveDismissed = async (
  db: LobeChatDatabase,
  userId: string,
  id: string,
) => {
  const ledger = new ProactiveMessageModel(db, userId);
  const message = (await ledger.markDismissed(id)) ?? (await ledger.findById(id));
  if (!message) return null;

  if (message.notificationId) {
    await new NotificationModel(db, userId).markAsRead([message.notificationId]);
  }

  return { state: message.state };
};

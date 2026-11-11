import { unregisterPush } from '@/features/push/register-for-push';
import type { ApiClient } from '@/lib/api-client';
import { authClient } from '@/lib/auth-client';

/** Stops pushes to this phone, then ends the session. */
export const signOut = async (api: ApiClient) => {
  // A failed unregister must not keep the user signed in; the server drops dead tokens later
  await unregisterPush(api).catch(() => undefined);
  await authClient.signOut();
};

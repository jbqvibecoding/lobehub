import { UserMemoryIdentityModel } from '@/database/models/userMemory/identity';
import { UserMemoryKeyFactsModel } from '@/database/models/userMemory/keyFacts';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import type { LobeChatDatabase } from '@/database/type';
import type { ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';

/** As many identities as the web chat injects. */
const IDENTITY_LIMIT = 25;

/**
 * What an agent run on the server (chat apps, the phone, tasks) is told about the person: the
 * persona summary, plus the key facts read from the memories themselves, so a fact the summary's
 * last rewrite left out still reaches the agent. Key facts are who the person is (as the web chat
 * injects) and the rules they set for the assistant. Undefined when there is nothing to tell.
 */
export const loadUserMemoryForRun = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<ServerUserMemoryConfig | undefined> => {
  const [persona, identities, preferences] = await Promise.all([
    new UserPersonaModel(db, userId).getLatestPersonaDocument(),
    new UserMemoryIdentityModel(db, userId).queryForInjection(IDENTITY_LIMIT),
    new UserMemoryKeyFactsModel(db, userId).standingInstructions(),
  ]);

  if (!persona?.persona && identities.length === 0 && preferences.length === 0) return undefined;

  return {
    fetchedAt: Date.now(),
    memories: {
      contexts: [],
      experiences: [],
      identities,
      ...(persona?.persona && {
        persona: { narrative: persona.persona, tagline: persona.tagline },
      }),
      preferences,
    },
  };
};

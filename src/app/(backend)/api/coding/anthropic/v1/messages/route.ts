import { getServerDB } from '@/database/core/db-adaptor';
import { forwardMessages } from '@/server/services/codingGateway';

// A coding call can think and write for minutes
export const maxDuration = 300;

/**
 * Anthropic's Messages API for Claude Code runs in the cloud sandbox: authenticated by the run
 * token, charged to the user's credits, sent on with the platform's key. See
 * `@/server/services/codingGateway`.
 */
export const POST = async (req: Request) => forwardMessages(await getServerDB(), req);

import { BUILTIN_OUTBOUND_CALLS, findSecrets } from '@lobechat/agent-policy';
import { type GlobalInterventionAuditConfig } from '@lobechat/types';

import { type AuditedToolCall, isExternalTool } from './createExternalSensitiveActionAudit';

export const OUTBOUND_SECRET_AUDIT_TYPE = 'outboundSecret';

/**
 * A third-party tool call whose arguments carry a password, a key, a card or an identity number
 * waits for the user, whatever the tool does and even when the user always allows it: sending
 * a secret out is how a prompt-injected agent leaks it. Biber's own calls that write to other
 * people (a mail, a calendar invitation) are checked the same way. Headless runs get it back as
 * blocked.
 */
export const createOutboundSecretGlobalAudit = (): GlobalInterventionAuditConfig => ({
  policy: 'always',
  resolver: async (toolArgs, metadata) => {
    const call = metadata?.toolCall as AuditedToolCall | undefined;
    if (!call) return false;
    const sendsOut =
      isExternalTool(call) || BUILTIN_OUTBOUND_CALLS.has(`${call.identifier}/${call.apiName}`);
    return sendsOut && findSecrets(toolArgs).length > 0;
  },
  type: OUTBOUND_SECRET_AUDIT_TYPE,
});

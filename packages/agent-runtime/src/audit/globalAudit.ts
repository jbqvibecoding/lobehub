import { type GlobalInterventionAuditConfig } from '@lobechat/types';

import { createExternalSensitiveActionGlobalAudit } from './createExternalSensitiveActionAudit';
import { createOutboundSecretGlobalAudit } from './createOutboundSecretAudit';
import { createSecurityBlacklistGlobalAudit } from './createSecurityBlacklistAudit';

export const createDefaultGlobalAudits = (): GlobalInterventionAuditConfig[] => [
  createSecurityBlacklistGlobalAudit(),
  createExternalSensitiveActionGlobalAudit(),
  createOutboundSecretGlobalAudit(),
  createSecurityBlacklistGlobalAudit('required'),
];

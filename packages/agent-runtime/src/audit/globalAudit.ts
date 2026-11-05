import { type GlobalInterventionAuditConfig } from '@lobechat/types';

import { createExternalSensitiveActionGlobalAudit } from './createExternalSensitiveActionAudit';
import { createSecurityBlacklistGlobalAudit } from './createSecurityBlacklistAudit';

export const createDefaultGlobalAudits = (): GlobalInterventionAuditConfig[] => [
  createSecurityBlacklistGlobalAudit(),
  createExternalSensitiveActionGlobalAudit(),
  createSecurityBlacklistGlobalAudit('required'),
];

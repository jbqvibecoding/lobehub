import {
  CLOUD_COMPUTER_SANDBOX_ENVIRONMENT,
  MARKET_SANDBOX_ENVIRONMENT,
  sandboxEnvironmentFor,
  systemPrompt,
} from '@lobechat/builtin-tool-cloud-sandbox';
import { describe, expect, it } from 'vitest';

describe('the cloud sandbox prompt', () => {
  it('leaves what the sandbox has to the deployment', () => {
    expect(systemPrompt).toContain('{{sandbox_environment}}');
    expect(systemPrompt).not.toContain('AWS Bedrock');
    expect(systemPrompt).not.toContain('python-pptx');
  });

  it('describes the cloud computer on openbot, and the Market image elsewhere', () => {
    expect(sandboxEnvironmentFor('openbot')).toBe(CLOUD_COMPUTER_SANDBOX_ENVIRONMENT);
    expect(sandboxEnvironmentFor('market')).toBe(MARKET_SANDBOX_ENVIRONMENT);
    expect(sandboxEnvironmentFor(undefined)).toBe(MARKET_SANDBOX_ENVIRONMENT);

    expect(CLOUD_COMPUTER_SANDBOX_ENVIRONMENT).toContain('pip is not available');
    expect(CLOUD_COMPUTER_SANDBOX_ENVIRONMENT).toContain('pptxgenjs');
    expect(CLOUD_COMPUTER_SANDBOX_ENVIRONMENT).toContain('Not available: LibreOffice');
    expect(MARKET_SANDBOX_ENVIRONMENT).toContain('LibreOffice - Office document processing');
  });
});

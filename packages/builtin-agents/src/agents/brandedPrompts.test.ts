import type * as BusinessConst from '@lobechat/business-const';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 });

/**
 * The built-in agents' prompts are what the assistant answers "who are you?"
 * with. Under Biber's branding and under any other brand, no upstream name may
 * survive.
 */
const loadPrompts = async (branding?: Partial<typeof BusinessConst>) => {
  vi.resetModules();
  if (branding) {
    vi.doMock('@lobechat/business-const', async (importOriginal) => ({
      ...(await importOriginal<typeof BusinessConst>()),
      ...branding,
    }));
    // Under vitest 5 a `doMock` only lands once the test file itself imports
    // something, so pull the mocked module in before the prompts.
    await import('@lobechat/business-const');
  }

  const [inbox, agentBuilder, supervisor] = await Promise.all([
    import('./inbox/systemRole'),
    import('./agent-builder/systemRole'),
    import('./group-supervisor/systemRole'),
  ]);

  return {
    agentBuilder: agentBuilder.systemRoleTemplate,
    inbox: inbox.createSystemRole(),
    inboxNamed: inbox.createSystemRole({ name: 'Mia' }),
    supervisor: supervisor.supervisorSystemRole,
  };
};

afterEach(() => {
  vi.doUnmock('@lobechat/business-const');
  vi.resetModules();
});

describe('built-in agent prompts', () => {
  it('introduce Biber under Biber’s own branding', async () => {
    const prompts = await loadPrompts();

    expect(prompts.inbox).toContain('You are Biber, an AI Agent');
    expect(prompts.agentBuilder).toContain(
      'You are Biber, an Agent Builder integrated into Biber.',
    );
    expect(prompts.supervisor).toContain(
      'You are Biber, an intelligent team coordinator developed by Biber,',
    );
  });

  it('introduce the renamed assistant and product under custom branding', async () => {
    const prompts = await loadPrompts({ BRANDING_INBOX_TITLE: 'Acme AI', BRANDING_NAME: 'Acme' });

    expect(prompts.inbox).toContain('You are Acme AI, an AI Agent');
    expect(prompts.agentBuilder).toContain(
      'You are Acme AI, an Agent Builder integrated into Acme.',
    );
    expect(prompts.supervisor).toContain(
      'You are Acme AI, an intelligent team coordinator developed by Acme,',
    );
    for (const prompt of [prompts.inbox, prompts.agentBuilder, prompts.supervisor]) {
      expect(prompt).not.toMatch(
        /You are Lobe\b|\bLobe ?AI\b|developed by LobeHub|integrated into LobeHub/,
      );
    }
  });

  it('still prefer the name the user gave the assistant', async () => {
    const prompts = await loadPrompts({ BRANDING_INBOX_TITLE: 'Acme AI', BRANDING_NAME: 'Acme' });

    expect(prompts.inboxNamed).toContain('You are Mia, an AI Agent');
  });
});

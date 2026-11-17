import { afterEach, describe, expect, it, vi } from 'vitest';

import { messengerReplies, messengerReplyLocale } from './replies';

const region = vi.hoisted(() => ({ APP_REGION: 'global' as string }));
vi.mock('@/envs/region', () => ({ regionEnv: region }));

afterEach(() => {
  region.APP_REGION = 'global';
});

describe('messengerReplyLocale', () => {
  it("follows the platform's audience in the international edition", () => {
    expect(messengerReplyLocale('feishu')).toBe('zh-CN');
    expect(messengerReplyLocale('wechat')).toBe('zh-CN');
    expect(messengerReplyLocale('telegram')).toBe('en-US');
    expect(messengerReplyLocale('lark')).toBe('en-US');
  });

  it('answers in Chinese everywhere in the mainland edition', () => {
    region.APP_REGION = 'cn';
    expect(messengerReplyLocale('lark')).toBe('zh-CN');
    expect(messengerReplyLocale(undefined)).toBe('zh-CN');
  });
});

describe('messengerReplies', () => {
  it('gives the help text in the language of the platform', () => {
    expect(messengerReplies('feishu').help).toContain('/agents：查看你的助理');
    expect(messengerReplies('telegram').help).toContain('/agents — list your agents');
  });
});

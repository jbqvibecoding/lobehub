import { afterEach, describe, expect, it, vi } from 'vitest';

import { messengerReplies, messengerReplyLocale } from './replies';
import { getMessengerSystemStrings } from './systemReply';

const region = vi.hoisted(() => ({ APP_REGION: 'global' as string }));
vi.mock('@/envs/region', () => ({ regionEnv: region }));

afterEach(() => {
  region.APP_REGION = 'global';
});

describe('messengerReplyLocale', () => {
  it("follows the platform's audience in the international edition", () => {
    expect(messengerReplyLocale('feishu')).toBe('zh-CN');
    expect(messengerReplyLocale('wechatmp')).toBe('zh-CN');
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
  it("gives Biber's own replies in the language of the platform", () => {
    expect(messengerReplies('feishu').linked()).toContain('绑定成功');
    expect(messengerReplies('telegram').linked()).toContain('Linked.');
  });
});

describe('getMessengerSystemStrings', () => {
  it('gives the command replies in the language of the platform', () => {
    expect(getMessengerSystemStrings('feishu').help).toContain('/agents：查看你的助理');
    expect(getMessengerSystemStrings('telegram').help).toContain('/agents — list your agents');
    expect(getMessengerSystemStrings('telegram').help).not.toContain('LobeHub');
  });

  it('answers commands in Chinese on every platform in the mainland edition', () => {
    region.APP_REGION = 'cn';
    expect(getMessengerSystemStrings('lark').noActiveAgent).toBe(
      '还没有选择助理。发送 /agents 选择一个。',
    );
  });

  it("keeps the personal WeChat bot's QR-code wording", () => {
    expect(getMessengerSystemStrings('wechat').needLink).toContain('重新扫码');
    expect(getMessengerSystemStrings('wechat').help).not.toContain('/start');
  });
});

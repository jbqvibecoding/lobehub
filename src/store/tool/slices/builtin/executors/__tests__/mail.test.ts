import { MailApiName } from '@lobechat/builtin-tool-mail';
import { mailExecutor } from '@lobechat/builtin-tool-mail/client/executor';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), search: vi.fn(), send: vi.fn() }));

vi.mock('@/services/mail', () => ({
  mailService: { read: mocks.read, search: mocks.search, send: mocks.send },
}));

describe('mailExecutor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands each call to the server, which holds the mailbox', async () => {
    const answer = { content: 'Sent “Re: Lunch”.', success: true };
    mocks.send.mockResolvedValue(answer);
    const params = { body: 'Yes', replyToId: 'INBOX:7', to: ['ana@example.com'] };

    const result = await mailExecutor.invoke(MailApiName.sendMail, params, {} as any);

    expect(mocks.send).toHaveBeenCalledWith(params);
    expect(result).toEqual(answer);
  });

  it('turns a failed request into an error the model can read', async () => {
    mocks.search.mockRejectedValue(new Error('network down'));

    const result = await mailExecutor.invoke(MailApiName.searchMail, {}, {} as any);

    expect(result).toEqual({
      content: 'network down',
      error: { message: 'network down', type: 'MailRequestFailed' },
      success: false,
    });
  });
});

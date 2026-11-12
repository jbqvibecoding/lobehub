import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PushChannel } from '../PushChannel';
import type { PushDeliveryContext, PushTicketRecord } from '../types';

const mockListByUserId = vi.fn();
const mockDeleteOfProvider = vi.fn();

vi.mock('@/database/models/pushToken', () => ({
  deletePushTokensOfProvider: (...args: unknown[]) => mockDeleteOfProvider(...args),
  PushTokenModel: vi.fn(() => ({
    listByUserId: mockListByUserId,
  })),
}));

vi.mock('@/database/server', () => ({ serverDB: {} }));

const ctx: PushDeliveryContext = {
  actionUrl: '/image?topic=t1',
  content: 'Your image is ready.',
  notificationId: 'notif-1',
  title: 'Image Generated',
  userId: 'user-1',
};

const makeExpoMock = (overrides: Partial<any> = {}) => ({
  chunkPushNotifications: (msgs: any[]) => [msgs],
  chunkPushNotificationReceiptIds: (ids: string[]) => [ids],
  isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken['),
  sendPushNotificationsAsync: vi.fn(),
  ...overrides,
});

describe('PushChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_tokens when the user has no push_tokens row', async () => {
    mockListByUserId.mockResolvedValueOnce([]);

    const expo = makeExpoMock();
    const channel = new PushChannel(expo as any);

    const result = await channel.deliver(ctx);

    expect(result).toEqual({ failedReason: 'no_tokens', status: 'failed' });
    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('returns invalid_tokens when all stored tokens are malformed', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'a', expoToken: 'not-a-real-token' },
      { deviceId: 'b', expoToken: 'also-bad' },
    ]);

    const expo = makeExpoMock({
      isExpoPushToken: () => false,
    });
    const channel = new PushChannel(expo as any);

    const result = await channel.deliver(ctx);
    expect(result.status).toBe('failed');
    expect(result.failedReason).toBe('invalid_tokens');
  });

  it('sends one Expo message per token and embeds ticket→token mapping', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]' },
      { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-1', status: 'ok' },
      { id: 'ticket-2', status: 'ok' },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('sent');
    const records = JSON.parse(result.providerMessageId!) as PushTicketRecord[];
    expect(records).toEqual([
      { expoToken: 'ExponentPushToken[A]', ticketId: 'ticket-1' },
      { expoToken: 'ExponentPushToken[B]', ticketId: 'ticket-2' },
    ]);

    const sentMessages = expo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toMatchObject({
      body: ctx.content,
      channelId: 'default',
      data: { notificationId: 'notif-1', url: '/image?topic=t1' },
      priority: 'high',
      sound: 'default',
      title: ctx.title,
      to: 'ExponentPushToken[A]',
    });
  });

  it('drops send-time errors but still returns sent if at least one ticket succeeded', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'a', expoToken: 'ExponentPushToken[A]' },
      { deviceId: 'b', expoToken: 'ExponentPushToken[B]' },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-1', status: 'ok' },
      {
        details: { error: 'DeviceNotRegistered' },
        message: 'token-b dead',
        status: 'error',
      },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('sent');
    const records = JSON.parse(result.providerMessageId!) as PushTicketRecord[];
    expect(records).toEqual([{ expoToken: 'ExponentPushToken[A]', ticketId: 'ticket-1' }]);
  });

  it('returns all_send_failed when every ticket fails at send time', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      {
        details: { error: 'DeviceNotRegistered' },
        message: 'dead',
        status: 'error',
      },
    ]);

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result.status).toBe('failed');
    expect(result.failedReason).toBe('all_send_failed');
  });

  it('returns rate_limited on 429 without throwing', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockRejectedValueOnce(
      Object.assign(new Error('rate'), { statusCode: 429 }),
    );

    const channel = new PushChannel(expo as any);
    const result = await channel.deliver(ctx);

    expect(result).toEqual({ failedReason: 'rate_limited', status: 'failed' });
  });

  it('rethrows non-429 send errors so NotificationService can log', async () => {
    mockListByUserId.mockResolvedValueOnce([{ deviceId: 'a', expoToken: 'ExponentPushToken[A]' }]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockRejectedValueOnce(new Error('network down'));

    const channel = new PushChannel(expo as any);
    await expect(channel.deliver(ctx)).rejects.toThrow('network down');
  });

  it('writes to each phone in the language it registered with', async () => {
    mockListByUserId.mockResolvedValueOnce([
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[A]', locale: 'zh-Hans-CN' },
      { deviceId: 'pixel', expoToken: 'ExponentPushToken[B]', locale: 'de-DE' },
      { deviceId: 'ipad', expoToken: 'ExponentPushToken[C]', locale: null },
    ]);

    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([
      { id: 'ticket-1', status: 'ok' },
      { id: 'ticket-2', status: 'ok' },
      { id: 'ticket-3', status: 'ok' },
    ]);

    await new PushChannel(expo as any).deliver({
      ...ctx,
      translations: { zh: { content: '图片已生成。', title: '生成完成' } },
    });

    const sent = expo.sendPushNotificationsAsync.mock.calls[0][0];
    expect(sent.map((m: any) => [m.title, m.body])).toEqual([
      ['生成完成', '图片已生成。'],
      [ctx.title, ctx.content],
      [ctx.title, ctx.content],
    ]);
  });
});

describe('PushChannel with phone makers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const vendorRows = [
    { deviceId: 'mate', expoToken: 'hw-1', locale: 'zh-CN', provider: 'huawei' },
    { deviceId: 'mi', expoToken: 'mi-1', locale: 'zh-CN', provider: 'xiaomi' },
  ];

  it('sends each maker its own tokens and forgets the ones it reports gone', async () => {
    mockListByUserId.mockResolvedValueOnce(vendorRows);
    const huawei = { send: vi.fn().mockResolvedValue({ invalidTokens: [] }) };
    const xiaomi = { send: vi.fn().mockResolvedValue({ invalidTokens: ['mi-1'] }) };
    const expo = makeExpoMock();
    const channel = new PushChannel(expo as any, { huawei, xiaomi });

    const result = await channel.deliver({
      ...ctx,
      translations: { zh: { content: '图片好了', title: '生成完成' } },
    });

    expect(result).toEqual({ status: 'delivered' });
    expect(huawei.send).toHaveBeenCalledWith(['hw-1'], { body: '图片好了', title: '生成完成' });
    expect(mockDeleteOfProvider).toHaveBeenCalledWith({}, 'xiaomi', ['mi-1']);
    expect(expo.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });

  it('still sends to Expo phones, and fails only when no maker took the message', async () => {
    mockListByUserId.mockResolvedValueOnce([
      vendorRows[0],
      { deviceId: 'iphone', expoToken: 'ExponentPushToken[abc]', provider: 'expo' },
    ]);
    const huawei = { send: vi.fn().mockRejectedValue(new Error('huawei down')) };
    const expo = makeExpoMock();
    expo.sendPushNotificationsAsync.mockResolvedValueOnce([{ id: 'ticket-1', status: 'ok' }]);

    const result = await new PushChannel(expo as any, { huawei }).deliver(ctx);

    expect(result.status).toBe('sent');
    expect(expo.sendPushNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('skips tokens of a maker this deployment has no keys for', async () => {
    mockListByUserId.mockResolvedValueOnce([vendorRows[1]]);

    const result = await new PushChannel(makeExpoMock() as any, {}).deliver(ctx);

    expect(result).toEqual({ failedReason: 'invalid_tokens', status: 'failed' });
  });
});

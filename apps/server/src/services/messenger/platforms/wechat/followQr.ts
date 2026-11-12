import debug from 'debug';

import { getMessengerWechatConfig } from '@/config/messenger';

import { createWechatMpApi } from './api';

const log = debug('lobe-server:messenger:wechat:qr');

/**
 * What the Official Account's follow QR code encodes, for the web page to draw. Undefined when the
 * account is not configured or WeChat cannot be reached; the page then says so.
 */
export const wechatFollowQrUrl = async (): Promise<string | undefined> => {
  const config = await getMessengerWechatConfig();
  if (!config) return undefined;
  try {
    return await createWechatMpApi(config).followQrUrl();
  } catch (error) {
    log('could not get the follow QR code: %O', error);
    return undefined;
  }
};

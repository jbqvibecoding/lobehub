import { isMainlandRegion } from '@lobechat/region';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { regionEnv } from '@/envs/region';
import { CalendarConnectError, CalendarService } from '@/server/services/calendar';

const log = debug('lobe-server:calendar:callback');

const page = (status: number, title: string, body: string) =>
  new NextResponse(
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 32px 24px; text-align: center; line-height: 1.5;">
    <h2 style="font-weight: 600;">${title}</h2>
    <p>${body}</p>
  </body>
</html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' }, status },
  );

/**
 * Feishu sends the user back here after they authorize Biber on their calendar, in the system
 * browser the phone opened. The `state` says whose calendar it is; this page only says how it went,
 * and the phone picks the connection up when the user returns to it.
 */
export const GET = async (req: NextRequest) => {
  const zh = isMainlandRegion(regionEnv.APP_REGION);
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';

  if (!code) {
    return page(
      400,
      zh ? '没有授权' : 'Not authorized',
      zh
        ? '飞书没有给出授权。回到 Biber 再试一次。'
        : 'Feishu did not authorize Biber. Go back to Biber and try again.',
    );
  }

  try {
    await CalendarService.completeFeishuAuth(await getServerDB(), { code, state });
    return page(
      200,
      zh ? '已连接飞书日历' : 'Feishu calendar connected',
      zh ? '可以回到 Biber 了。' : 'You can go back to Biber now.',
    );
  } catch (error) {
    const reason = error instanceof CalendarConnectError ? error.reason : 'feishu';
    log('Feishu calendar callback failed: %s', reason);
    if (reason === 'state') {
      return page(
        400,
        zh ? '链接已失效' : 'This link has expired',
        zh
          ? '回到 Biber，重新点一次“连接飞书日历”。'
          : 'Go back to Biber and tap “Connect Feishu calendar” again.',
      );
    }
    return page(
      502,
      zh ? '没能连接' : 'Could not connect',
      zh
        ? '飞书暂时没有响应，稍后在 Biber 里再试一次。'
        : 'Feishu did not answer as expected. Try again from Biber later.',
    );
  }
};

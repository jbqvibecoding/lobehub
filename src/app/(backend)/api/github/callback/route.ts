import { isMainlandRegion } from '@lobechat/region';
import debug from 'debug';
import { type NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { regionEnv } from '@/envs/region';
import { GithubConnectionError, GithubConnectionService } from '@/server/services/githubApp';

const log = debug('lobe-server:github:callback');

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const page = (status: number, title: string, body: string) =>
  new NextResponse(
    `<!doctype html>
<html>
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escape(title)}</title></head>
  <body style="font-family: system-ui, sans-serif; padding: 32px 24px; text-align: center; line-height: 1.5;">
    <h2 style="font-weight: 600;">${escape(title)}</h2>
    <p>${escape(body)}</p>
  </body>
</html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' }, status },
  );

/**
 * GitHub sends the user back here after they install the Biber GitHub App, in the system browser
 * the phone opened, with the installation, an OAuth code and the `state` the phone's link carried.
 * The installation is kept only when the code shows this user may use it.
 */
export const GET = async (req: NextRequest) => {
  const zh = isMainlandRegion(regionEnv.APP_REGION);
  const params = req.nextUrl.searchParams;
  const code = params.get('code');
  const installationId = Number(params.get('installation_id'));
  const state = params.get('state') ?? '';

  if (!code || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return page(
      400,
      zh ? '没有完成安装' : 'Not installed',
      zh
        ? 'GitHub 没有给出安装和授权。回到 Biber 再试一次。'
        : 'GitHub did not send the installation back. Go back to Biber and try again.',
    );
  }

  try {
    const { login } = await GithubConnectionService.completeConnection(await getServerDB(), {
      code,
      installationId,
      state,
    });
    return page(
      200,
      zh ? `已连接 GitHub：${login}` : `GitHub connected: ${login}`,
      zh ? '可以回到 Biber 了。' : 'You can go back to Biber now.',
    );
  } catch (error) {
    const reason = error instanceof GithubConnectionError ? error.code : 'github';
    log('GitHub callback failed: %s %O', reason, error);
    if (reason === 'BAD_REQUEST') {
      return page(
        400,
        zh ? '链接已失效' : 'This link has expired',
        zh
          ? '回到 Biber，重新点一次“连接 GitHub”。'
          : 'Go back to Biber and tap “Connect GitHub” again.',
      );
    }
    if (reason === 'FORBIDDEN') {
      return page(
        403,
        zh ? '这个安装不属于你' : 'Not your installation',
        zh
          ? '只能连接你自己能使用的安装。回到 Biber 再试一次。'
          : 'Only an installation you can use can be connected. Go back to Biber and try again.',
      );
    }
    return page(
      502,
      zh ? '没能连接' : 'Could not connect',
      zh
        ? 'GitHub 暂时没有响应，稍后在 Biber 里再试一次。'
        : 'GitHub did not answer as expected. Try again from Biber later.',
    );
  }
};

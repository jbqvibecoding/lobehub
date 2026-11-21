import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { isMainlandRegion } from '@lobechat/region';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { ConnectorModel } from '@/database/models/connector';
import { regionEnv } from '@/envs/region';
import { isComposioClientAvailable } from '@/libs/composio';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { CalendarConnectError, CalendarService } from '@/server/services/calendar';
import { MailConnectError, MailService } from '@/server/services/mail';
import { MAIL_PRESET_IDS } from '@/server/services/mail/presets';
import { setBiberTool } from '@/server/services/personalAccounts/biberTools';

import { composioRouter } from '../lambda/composio';
import { composioToolsRouter } from '../tools/composio';

const log = debug('lobe-server:mobile:accounts');

/** The Composio toolkits the phone offers in the global edition: mail and calendars. */
export const ACCOUNT_APPS = ['gmail', 'google-calendar', 'outlook-mail'] as const;
type AccountApp = (typeof ACCOUNT_APPS)[number];

const appType = (app: AccountApp) => COMPOSIO_APP_TYPES.find((type) => type.identifier === app)!;

const accountsProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) =>
  opts.next({
    ctx: {
      calendar: new CalendarService(opts.ctx.serverDB, opts.ctx.userId),
      mail: new MailService(opts.ctx.serverDB, opts.ctx.userId),
    },
  }),
);

/** Whose Composio connection for an app, from the connector the web and the phone both write. */
const composioConnection = async (ctx: { serverDB: any; userId: string }, app: AccountApp) => {
  const [connector] = await new ConnectorModel(ctx.serverDB, ctx.userId).queryByIdentifiers([app]);
  return connector?.metadata?.composio;
};

const port = z.number().int().min(1).max(65_535);

/**
 * "Email & calendar" on the phone: what the user can connect in this edition, connecting it, and
 * disconnecting it. The mainland edition connects a mailbox over IMAP and a Feishu calendar; the
 * global edition connects Gmail, Google Calendar and Outlook through Composio. Whatever is
 * connected becomes Biber's tool, and stops being one when disconnected.
 */
export const accountsRouter = router({
  list: accountsProcedure.query(async ({ ctx }) => {
    if (isMainlandRegion(regionEnv.APP_REGION)) {
      const [mail, calendar] = await Promise.all([ctx.mail.status(), ctx.calendar.status()]);
      return {
        calendar: {
          available: await CalendarService.available(),
          connected: !!calendar,
          label: calendar?.label,
          needsReconnect: calendar?.status === 'needs_reauth',
        },
        edition: 'cn' as const,
        mail: {
          connected: !!mail,
          label: mail?.label,
          needsReconnect: mail?.status === 'needs_reauth',
          presets: [...MAIL_PRESET_IDS],
        },
      };
    }

    const available = isComposioClientAvailable();
    const apps = await Promise.all(
      ACCOUNT_APPS.map(async (app) => {
        const composio = available ? await composioConnection(ctx, app) : undefined;
        let status = composio?.status;

        // Back from authorizing in the browser: finish the connection the web would finish
        if (composio && status !== 'ACTIVE') {
          try {
            const caller = composioRouter.createCaller(ctx as any);
            const remote = await caller.getConnection({
              connectedAccountId: composio.connectedAccountId,
            });
            if (remote.status === 'ACTIVE') {
              const { tools } = await composioToolsRouter
                .createCaller(ctx as any)
                .listActions({ appSlug: composio.appSlug });
              await caller.updateComposioPlugin({
                appSlug: composio.appSlug,
                authConfigId: composio.authConfigId,
                connectedAccountId: composio.connectedAccountId,
                identifier: app,
                label: appType(app).label,
                status: 'ACTIVE',
                tools,
              });
              await setBiberTool(ctx.serverDB, ctx.userId, app, true);
              status = 'ACTIVE';
              log('userId=%s finished connecting %s', ctx.userId, app);
            }
          } catch (error) {
            log('userId=%s checking %s failed: %O', ctx.userId, app, error);
          }
        }

        return { app, label: appType(app).label, status: status ?? 'NONE' };
      }),
    );
    return { apps, available, edition: 'global' as const };
  }),

  /** Starts a Composio connection; the phone opens the page it gives in the browser. */
  connectComposio: accountsProcedure
    .input(z.object({ app: z.enum(ACCOUNT_APPS) }))
    .mutation(async ({ ctx, input }) => {
      if (!isComposioClientAvailable()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'COMPOSIO_UNAVAILABLE' });
      }
      const type = appType(input.app);
      const { redirectUrl } = await composioRouter.createCaller(ctx as any).createConnection({
        appSlug: type.appSlug,
        identifier: input.app,
        label: type.label,
      });
      return { url: redirectUrl as string };
    }),

  disconnectComposio: accountsProcedure
    .input(z.object({ app: z.enum(ACCOUNT_APPS) }))
    .mutation(async ({ ctx, input }) => {
      const composio = await composioConnection(ctx, input.app);
      if (composio) {
        await composioRouter.createCaller(ctx as any).deleteConnection({
          connectedAccountId: composio.connectedAccountId,
          identifier: input.app,
        });
      }
      await setBiberTool(ctx.serverDB, ctx.userId, input.app, false);
      return { disconnected: !!composio };
    }),

  /** Logs in to the mailbox and keeps it; a refusal says why in its message (`MAIL_AUTH` …). */
  connectMail: accountsProcedure
    .input(
      z.object({
        address: z.string().trim().max(320),
        password: z.string().min(1).max(200),
        preset: z.enum(MAIL_PRESET_IDS).optional(),
        servers: z
          .object({
            imapHost: z.string().trim().max(253),
            imapPort: port,
            smtpHost: z.string().trim().max(253),
            smtpPort: port,
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const account = await ctx.mail.connect(input);
        return { label: account.label };
      } catch (error) {
        if (error instanceof MailConnectError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `MAIL_${error.reason.toUpperCase()}`,
          });
        }
        throw error;
      }
    }),

  disconnectMail: accountsProcedure.mutation(async ({ ctx }) => ({
    disconnected: await ctx.mail.disconnect(),
  })),

  /** The Feishu page to authorize Biber on; the phone opens it in the browser. */
  feishuCalendarAuthUrl: accountsProcedure.mutation(async ({ ctx }) => {
    try {
      return { url: await ctx.calendar.feishuAuthUrl() };
    } catch (error) {
      if (error instanceof CalendarConnectError) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'FEISHU_UNAVAILABLE' });
      }
      throw error;
    }
  }),

  disconnectCalendar: accountsProcedure.mutation(async ({ ctx }) => ({
    disconnected: await ctx.calendar.disconnect(),
  })),
});

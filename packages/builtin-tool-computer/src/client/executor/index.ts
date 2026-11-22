import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { computerToolsService } from '@/services/computerTools';

import { ComputerIdentifier } from '../../manifest';
import type {
  ClickParams,
  ClickWithApprovalParams,
  NavigateParams,
  PressKeyParams,
  PressKeyWithApprovalParams,
  RequestHelpParams,
  ScrollParams,
  TypeParams,
} from '../../types';
import { ComputerApiName } from '../../types';

/**
 * Runs the cloud computer tool from the browser when the web chat executes tools there. Every call
 * goes to the server, which drives the user's own computer and judges each action as it does when
 * it runs the tool itself. The run's topic picks the computer where each conversation has its own.
 */
class ComputerExecutor extends BaseExecutor<typeof ComputerApiName> {
  readonly identifier = ComputerIdentifier;
  protected readonly apiEnum = ComputerApiName;

  private run = async (call: () => Promise<BuiltinToolResult>): Promise<BuiltinToolResult> => {
    try {
      return await call();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: message,
        error: { message, type: 'ComputerRequestFailed' },
        success: false,
      };
    }
  };

  private topic = (ctx: BuiltinToolContext) => ({ topicId: ctx.topicId ?? undefined });

  click = (params: ClickParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.click({ ...params, ...this.topic(ctx) }));

  clickWithApproval = (params: ClickWithApprovalParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.clickWithApproval({ ...params, ...this.topic(ctx) }));

  navigate = (params: NavigateParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.navigate({ ...params, ...this.topic(ctx) }));

  pressKey = (params: PressKeyParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.pressKey({ ...params, ...this.topic(ctx) }));

  pressKeyWithApproval = (params: PressKeyWithApprovalParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.pressKeyWithApproval({ ...params, ...this.topic(ctx) }));

  read = (_params: unknown, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.read(this.topic(ctx)));

  requestHelp = (params: RequestHelpParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.requestHelp({ ...params, ...this.topic(ctx) }));

  scroll = (params: ScrollParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.scroll({ ...params, ...this.topic(ctx) }));

  snapshot = (_params: unknown, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.snapshot(this.topic(ctx)));

  type = (params: TypeParams, ctx: BuiltinToolContext) =>
    this.run(() => computerToolsService.type({ ...params, ...this.topic(ctx) }));
}

export const computerExecutor = new ComputerExecutor();

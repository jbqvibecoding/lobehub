import type {
  ClickParams,
  ClickWithApprovalParams,
  NavigateParams,
  PressKeyParams,
  PressKeyWithApprovalParams,
  RequestHelpParams,
  ScrollParams,
  TypeParams,
} from '@lobechat/builtin-tool-computer';
import { ComputerIdentifier } from '@lobechat/builtin-tool-computer';

import { ComputerToolsService } from '@/server/services/computerTools';

import { type ServerRuntimeRegistration } from './types';

/** The cloud computer's browser wherever the server runs tools: phone chat, chat apps, tasks. */
export const computerRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for the cloud computer tool');
    }
    const computer = new ComputerToolsService(context.serverDB, context.userId, context.topicId);

    return {
      click: (args: ClickParams) => computer.click(args),
      clickWithApproval: (args: ClickWithApprovalParams) => computer.clickWithApproval(args),
      navigate: (args: NavigateParams) => computer.navigate(args),
      pressKey: (args: PressKeyParams) => computer.pressKey(args),
      pressKeyWithApproval: (args: PressKeyWithApprovalParams) =>
        computer.pressKeyWithApproval(args),
      read: () => computer.read(),
      requestHelp: (args: RequestHelpParams) => computer.requestHelp(args),
      scroll: (args: ScrollParams) => computer.scroll(args),
      snapshot: () => computer.snapshot(),
      type: (args: TypeParams) => computer.type(args),
    };
  },
  identifier: ComputerIdentifier,
};

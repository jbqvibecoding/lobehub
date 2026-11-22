import type {
  ClickParams,
  ClickWithApprovalParams,
  NavigateParams,
  PressKeyParams,
  PressKeyWithApprovalParams,
  RequestHelpParams,
  RequestSecretParams,
  ScrollParams,
  SignInParams,
  TypeParams,
} from '@lobechat/builtin-tool-computer';

import { lambdaClient } from '@/libs/trpc/client';

type OnTopic<T> = T & { topicId?: string };

/** The cloud computer's browser, run from the web chat: the server drives the user's computer. */
export const computerToolsService = {
  click: (params: OnTopic<ClickParams>) => lambdaClient.computerTools.click.mutate(params),
  clickWithApproval: (params: OnTopic<ClickWithApprovalParams>) =>
    lambdaClient.computerTools.clickWithApproval.mutate(params),
  listLogins: (params: OnTopic<object>) => lambdaClient.computerTools.listLogins.mutate(params),
  navigate: (params: OnTopic<NavigateParams>) => lambdaClient.computerTools.navigate.mutate(params),
  pressKey: (params: OnTopic<PressKeyParams>) => lambdaClient.computerTools.pressKey.mutate(params),
  pressKeyWithApproval: (params: OnTopic<PressKeyWithApprovalParams>) =>
    lambdaClient.computerTools.pressKeyWithApproval.mutate(params),
  read: (params: OnTopic<object>) => lambdaClient.computerTools.read.mutate(params),
  requestHelp: (params: OnTopic<RequestHelpParams>) =>
    lambdaClient.computerTools.requestHelp.mutate(params),
  requestSecret: (params: OnTopic<RequestSecretParams>) =>
    lambdaClient.computerTools.requestSecret.mutate(params),
  scroll: (params: OnTopic<ScrollParams>) => lambdaClient.computerTools.scroll.mutate(params),
  signIn: (params: OnTopic<SignInParams>) => lambdaClient.computerTools.signIn.mutate(params),
  snapshot: (params: OnTopic<object>) => lambdaClient.computerTools.snapshot.mutate(params),
  type: (params: OnTopic<TypeParams>) => lambdaClient.computerTools.type.mutate(params),
};

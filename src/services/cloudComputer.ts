import { lambdaClient } from '@/libs/trpc/client';

export type CloudComputerAction = Parameters<
  typeof lambdaClient.computer.input.mutate
>[0]['action'];

export type CloudComputerView = Awaited<ReturnType<typeof lambdaClient.computer.view.query>>;

/** The user's cloud computer: watch it, take over its browser, and hand it back. */
class CloudComputerService {
  view = async () => lambdaClient.computer.view.query({ withScreen: true });

  start = async () => lambdaClient.computer.start.mutate();

  takeOver = async () => lambdaClient.computer.takeOver.mutate();

  handBack = async () => lambdaClient.computer.handBack.mutate();

  input = async (action: CloudComputerAction) => lambdaClient.computer.input.mutate({ action });
}

export const cloudComputerService = new CloudComputerService();

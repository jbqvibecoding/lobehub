import { isMainlandRegion } from '@lobechat/region';

import { regionEnv } from '@/envs/region';
import { type BotReplyLocale, getBotReplyLocale } from '@/server/services/bot/platforms/const';

/**
 * The language the shared bots answer in. The mainland edition answers in Chinese everywhere; the
 * international edition follows the platform's audience (Feishu and WeChat in Chinese, the others
 * in English).
 */
export const messengerReplyLocale = (platform: string | undefined): BotReplyLocale =>
  isMainlandRegion(regionEnv.APP_REGION) ? 'zh-CN' : getBotReplyLocale(platform);

interface MessengerReplies {
  agentAlreadyActive: (title: string) => string;
  agentNotFound: string;
  agentPickerPrompt: string;
  agentsList: (lines: string) => string;
  agentsUsage: (count: number) => string;
  agentSwitched: (title: string) => string;
  agentSwitchedToast: (title: string) => string;
  alreadyInScope: (name: string) => string;
  alreadyLinked: string;
  checkDmForLink: string;
  help: string;
  linked: (activeAgentName?: string) => string;
  linkInvite: (platformName: string, url: string) => string;
  listActiveMarker: string;
  listCurrentMarker: string;
  multipleHumans: string;
  newConversation: string;
  noActiveAgent: string;
  noAgentsYet: string;
  nothingToStop: string;
  notLinked: string;
  notLinkedToast: string;
  personalScope: string;
  scopeNotFound: string;
  scopePickerPrompt: string;
  scopesList: (lines: string) => string;
  scopeSwitched: (scope: string, agent?: string) => string;
  scopeUnavailable: string;
  somethingWentWrong: string;
  stopRequested: string;
  switchUsage: (count: number) => string;
  temporarilyUnavailable: string;
  unableToStop: string;
  unknownAction: string;
  unknownCommand: (name: string) => string;
  useDirectMessage: (command: string) => string;
}

const REPLIES: Record<'en-US' | 'zh-CN', MessengerReplies> = {
  'en-US': {
    agentAlreadyActive: (title) => `${title} is already the active agent.`,
    agentNotFound: 'Agent not found.',
    agentPickerPrompt: 'Tap an agent to make it the active one:',
    agentSwitched: (title) =>
      `Switched active agent to: ${title}. Your next message will go there.`,
    agentSwitchedToast: (title) => `Switched to ${title}.`,
    agentsList: (lines) =>
      `Your agents:\n${lines}\n\nReply with /agents <n> to switch the active agent.`,
    agentsUsage: (count) => `Usage: /agents <n>, where n is between 1 and ${count}.`,
    alreadyInScope: (name) => `You're already in ${name}.`,
    alreadyLinked:
      'Your account is already linked to Biber. Send /agents to switch the active agent, or /new to start a fresh conversation.',
    checkDmForLink: 'Check your DM with Biber for the link button.',
    help: [
      'Commands:',
      '• /start — bind (or rebind) your Biber account',
      '• /switch — switch the active scope (personal or a workspace)',
      '• /agents — list your agents and switch the active one',
      '• /new — start a new conversation',
      '• /stop — stop the current execution',
      '• /feedback <message> — send feedback to the Biber team (no AI reply)',
    ].join('\n'),
    linkInvite: (platformName, url) =>
      `Welcome to Biber!\n\nTo continue, link your ${platformName} account to Biber. The link expires in 30 minutes:\n\n${url}\n\nAfter linking, send /agents anytime to see your agents and switch between them.`,
    linked: (activeAgentName) =>
      activeAgentName
        ? `Linked. Your Biber account is now connected.\n\nActive agent: ${activeAgentName}\n\nSend your first message now, or /agents anytime to switch.`
        : 'Linked. Your Biber account is now connected.\n\nSend /agents to see your agents and pick one.',
    listActiveMarker: ' (active)',
    listCurrentMarker: ' (current)',
    multipleHumans:
      "Multiple people are talking in this thread now. From here on I'll only respond when you @mention me.",
    newConversation: 'Started a new conversation. Your next message begins a fresh topic.',
    noActiveAgent: 'No active agent selected. Send /agents to pick one.',
    noAgentsYet: 'You have no agents yet. Create one in Biber, then come back to /agents.',
    notLinked: 'You need to /start to bind your account first.',
    notLinkedToast: 'Not linked. Send /start first.',
    nothingToStop: 'No active execution to stop.',
    personalScope: 'Personal',
    scopeNotFound: 'Scope not found.',
    scopePickerPrompt: 'Tap a scope to switch:',
    scopeSwitched: (scope, agent) =>
      agent
        ? `Switched to ${scope}. Now chatting with ${agent}. Send /agents to change.`
        : `Switched to ${scope}. No agents here yet — create one in Biber, then /agents.`,
    scopeUnavailable:
      'Your active workspace is no longer available. Send /switch to choose another scope.',
    scopesList: (lines) => `Scopes:\n${lines}\n\nReply with /switch <n> to switch scope.`,
    somethingWentWrong: 'Something went wrong.',
    stopRequested: 'Stop requested.',
    switchUsage: (count) => `Usage: /switch <n>, where n is between 1 and ${count}.`,
    temporarilyUnavailable: 'Biber is temporarily unavailable. Please try again in a moment.',
    unableToStop: 'Unable to stop the current execution.',
    unknownAction: 'Unknown action.',
    unknownCommand: (name) => `Unknown command: /${name}`,
    useDirectMessage: (command) =>
      `Open your direct message with the Biber bot and send \`${command}\` there.`,
  },
  'zh-CN': {
    agentAlreadyActive: (title) => `${title} 已经是当前助理了。`,
    agentNotFound: '找不到这个助理。',
    agentPickerPrompt: '点一个助理，设为当前助理：',
    agentSwitched: (title) => `已切换到助理：${title}。你的下一条消息会发给它。`,
    agentSwitchedToast: (title) => `已切换到 ${title}。`,
    agentsList: (lines) => `你的助理：\n${lines}\n\n回复 /agents <序号> 切换当前助理。`,
    agentsUsage: (count) => `用法：/agents <序号>，序号在 1 到 ${count} 之间。`,
    alreadyInScope: (name) => `你已经在 ${name} 里了。`,
    alreadyLinked: '你的账号已经绑定了 Biber。发送 /agents 切换当前助理，或发送 /new 开始新对话。',
    checkDmForLink: '请在和 Biber 的私聊里点绑定按钮。',
    help: [
      '可用命令：',
      '• /start：绑定（或重新绑定）你的 Biber 账号',
      '• /switch：切换当前空间（个人或某个工作空间）',
      '• /agents：查看你的助理并切换当前助理',
      '• /new：开始新对话',
      '• /stop：停止正在执行的任务',
      '• /feedback <内容>：直接给 Biber 团队反馈（不会触发 AI 回复）',
    ].join('\n'),
    linkInvite: (platformName, url) =>
      `欢迎使用 Biber！\n\n请先把你的${platformName}账号绑定到 Biber，链接 30 分钟内有效：\n\n${url}\n\n绑定后随时发送 /agents 查看并切换你的助理。`,
    linked: (activeAgentName) =>
      activeAgentName
        ? `绑定成功，你的 Biber 账号已连接。\n\n当前助理：${activeAgentName}\n\n现在就可以发消息了，发送 /agents 可以随时切换。`
        : '绑定成功，你的 Biber 账号已连接。\n\n发送 /agents 查看并选择一个助理。',
    listActiveMarker: '（当前）',
    listCurrentMarker: '（当前）',
    multipleHumans: '这个对话里现在有好几个人在说话。之后只有 @我 时我才会回复。',
    newConversation: '已开始新对话，下一条消息会开启新话题。',
    noActiveAgent: '还没有选择助理。发送 /agents 选择一个。',
    noAgentsYet: '你还没有助理。先在 Biber 里创建一个，再回来发送 /agents。',
    notLinked: '请先发送 /start 绑定账号。',
    notLinkedToast: '尚未绑定，请先发送 /start。',
    nothingToStop: '当前没有正在执行的任务可以停止。',
    personalScope: '个人',
    scopeNotFound: '找不到这个空间。',
    scopePickerPrompt: '点一个空间来切换：',
    scopeSwitched: (scope, agent) =>
      agent
        ? `已切换到 ${scope}，现在和 ${agent} 对话。发送 /agents 可以更换。`
        : `已切换到 ${scope}。这里还没有助理，先在 Biber 里创建一个，再发送 /agents。`,
    scopeUnavailable: '你当前的工作空间已不可用。发送 /switch 选择其他空间。',
    scopesList: (lines) => `可切换的空间：\n${lines}\n\n回复 /switch <序号> 切换空间。`,
    somethingWentWrong: '出了点问题，请稍后再试。',
    stopRequested: '已发出停止请求。',
    switchUsage: (count) => `用法：/switch <序号>，序号在 1 到 ${count} 之间。`,
    temporarilyUnavailable: 'Biber 暂时不可用，请稍后再试。',
    unableToStop: '无法停止当前执行。',
    unknownAction: '未知操作。',
    unknownCommand: (name) => `未知命令：/${name}`,
    useDirectMessage: (command) => `请打开和 Biber 机器人的私聊，在那里发送 ${command}。`,
  },
};

/** The shared bots' own replies (commands, prompts, toasts) in the language for `platform`. */
export const messengerReplies = (platform: string | undefined): MessengerReplies => {
  const locale = messengerReplyLocale(platform);
  return locale === 'zh-CN' ? REPLIES['zh-CN'] : REPLIES['en-US'];
};

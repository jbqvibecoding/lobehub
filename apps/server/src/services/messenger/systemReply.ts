import { messengerReplyLocale } from './replies';

interface MessengerSystemStrings {
  accountAlreadyLinked: string;
  activeAgentAlready: (title: string) => string;
  activeAgentAlreadyToast: (title: string) => string;
  activeAgentChanged: (title: string) => string;
  activeAgentChangedToast: (title: string) => string;
  activeMarker: string;
  agentNotFound: string;
  agentsEmpty: string;
  agentsHeading: string;
  agentsHint: string;
  agentsPicker: string;
  agentsPrivateHeading: string;
  agentsUsage: (count: number) => string;
  agentsWorkspaceHeading: string;
  checkDirectMessage: string;
  currentMarker: string;
  genericError: string;
  help: string;
  modeAgentLabel: string;
  modeChangedToast: (label: string) => string;
  modeChatLabel: string;
  modeDirectMessageOnly: string;
  modePicker: string;
  needLink: string;
  newDirectMessageOnly: string;
  newStarted: string;
  noActiveAgent: string;
  notLinked: string;
  personalScope: string;
  privateSuffix: string;
  receiveMessagesPicker: string;
  scopeAlready: (name: string) => string;
  scopeNotFound: string;
  scopePicker: string;
  scopesHeading: string;
  scopesHint: string;
  scopesUsage: (count: number) => string;
  scopeSwitched: (name: string, agentTitle?: string) => string;
  staleAgent: string;
  staleScope: string;
  startDirectMessageOnly: string;
  stopDirectMessageOnly: string;
  stopNotActive: string;
  stopRequested: string;
  stopUnable: string;
  unknownAction: string;
  unknownCommand: (name: string) => string;
}

const EN_US: MessengerSystemStrings = {
  accountAlreadyLinked:
    'Your account is already linked to Biber. Send /agents to switch the active agent, or /new to start a fresh conversation.',
  activeAgentAlready: (title) => `${title} is already the active agent.`,
  activeAgentAlreadyToast: (title) => `${title} is already active.`,
  activeAgentChanged: (title) =>
    `Switched active agent to: ${title}. Your next message will go there.`,
  activeAgentChangedToast: (title) => `Switched to ${title}.`,
  activeMarker: 'active',
  agentNotFound: 'Agent not found.',
  agentsEmpty: 'You have no agents yet. Create one in Biber, then come back to /agents.',
  agentsHeading: 'Your agents:',
  agentsHint: 'Reply with /agents <n> to switch the active agent.',
  agentsPicker: 'Tap an agent to make it the active one:',
  agentsPrivateHeading: 'Private agents:',
  agentsUsage: (count) => `Usage: /agents <n>, where n is between 1 and ${count}.`,
  agentsWorkspaceHeading: 'Workspace agents:',
  checkDirectMessage: 'Check your DM with Biber for the link button.',
  currentMarker: 'current',
  genericError: 'Something went wrong.',
  help: [
    'Commands:',
    '• /start — bind (or rebind) your Biber account',
    '• /switch — switch the active scope (personal or a workspace)',
    '• /agents — list your agents and switch the active one',
    '• /new — start a new conversation',
    '• /mode — show or switch the conversation mode (agent | chat)',
    '• /stop — stop the current execution',
    '• /feedback <message> — send feedback to the Biber team (no AI reply)',
  ].join('\n'),
  modeAgentLabel: 'Agent Mode',
  modeChangedToast: (label) => `Switched to ${label}.`,
  modeChatLabel: 'Chat Mode',
  modeDirectMessageOnly: 'Open your direct message with the Biber bot and send `/mode` there.',
  modePicker: 'Pick the conversation mode:',
  needLink: 'You need to /start to bind your account first.',
  newDirectMessageOnly: 'Open your direct message with the Biber bot and send `/new` there.',
  newStarted: 'Started a new conversation. Your next message begins a fresh topic.',
  noActiveAgent: 'No active agent selected. Send /agents to pick one.',
  notLinked: 'Not linked. Send /start first.',
  personalScope: 'Personal',
  privateSuffix: ' (private)',
  receiveMessagesPicker: 'Pick an agent to receive your messages:',
  scopeAlready: (name) => `You're already in ${name}.`,
  scopeNotFound: 'Scope not found.',
  scopePicker: 'Tap a scope to switch:',
  scopeSwitched: (name, agentTitle) =>
    agentTitle
      ? `Switched to ${name}. Now chatting with ${agentTitle}. Send /agents to change.`
      : `Switched to ${name}. No agents here yet — create one in Biber, then /agents.`,
  scopesHeading: 'Scopes:',
  scopesHint: 'Reply with /switch <n> to switch scope.',
  scopesUsage: (count) => `Usage: /switch <n>, where n is between 1 and ${count}.`,
  startDirectMessageOnly:
    'Open your direct message with the Biber bot and send `/start` there to link your account.',
  staleAgent:
    'Your active agent is no longer available — it may have been deleted or moved to another workspace. Send /agents to pick another one.',
  staleScope: 'Your active workspace is no longer available. Send /switch to choose another scope.',
  stopDirectMessageOnly: 'Open your direct message with the Biber bot and send `/stop` there.',
  stopNotActive: 'No active execution to stop.',
  stopRequested: 'Stop requested.',
  stopUnable: 'Unable to stop the current execution.',
  unknownAction: 'Unknown action.',
  unknownCommand: (name) => `Unknown command: /${name}`,
};

// Biber's Chinese replies call agents 助理, as the rest of the product does.
const ZH_CN: MessengerSystemStrings = {
  accountAlreadyLinked:
    '你的账号已经绑定了 Biber。发送 /agents 切换当前助理，或发送 /new 开始新对话。',
  activeAgentAlready: (title) => `${title} 已经是当前助理了。`,
  activeAgentAlreadyToast: (title) => `${title} 已经是当前助理。`,
  activeAgentChanged: (title) => `已切换到助理：${title}。你的下一条消息会发给它。`,
  activeAgentChangedToast: (title) => `已切换到 ${title}。`,
  activeMarker: '当前',
  agentNotFound: '找不到这个助理。',
  agentsEmpty: '你还没有助理。先在 Biber 里创建一个，再回来发送 /agents。',
  agentsHeading: '你的助理：',
  agentsHint: '回复 /agents <序号> 切换当前助理。',
  agentsPicker: '点一个助理，设为当前助理：',
  agentsPrivateHeading: '私人助理：',
  agentsUsage: (count) => `用法：/agents <序号>，序号在 1 到 ${count} 之间。`,
  agentsWorkspaceHeading: '工作空间的助理：',
  checkDirectMessage: '请在和 Biber 的私聊里点绑定按钮。',
  currentMarker: '当前',
  genericError: '出了点问题，请稍后再试。',
  help: [
    '可用命令：',
    '• /start：绑定（或重新绑定）你的 Biber 账号',
    '• /switch：切换当前空间（个人或某个工作空间）',
    '• /agents：查看你的助理并切换当前助理',
    '• /new：开始新对话',
    '• /mode：查看或切换对话模式（agent 或 chat）',
    '• /stop：停止正在执行的任务',
    '• /feedback <内容>：直接给 Biber 团队反馈（不会触发 AI 回复）',
  ].join('\n'),
  modeAgentLabel: 'Agent 模式',
  modeChangedToast: (label) => `已切换到${label}。`,
  modeChatLabel: 'Chat 模式',
  modeDirectMessageOnly: '请打开和 Biber 机器人的私聊，在那里发送 /mode。',
  modePicker: '请选择对话模式：',
  needLink: '请先发送 /start 绑定账号。',
  newDirectMessageOnly: '请打开和 Biber 机器人的私聊，在那里发送 /new。',
  newStarted: '已开始新对话，下一条消息会开启新话题。',
  noActiveAgent: '还没有选择助理。发送 /agents 选择一个。',
  notLinked: '尚未绑定，请先发送 /start。',
  personalScope: '个人',
  privateSuffix: '（私人）',
  receiveMessagesPicker: '选一个助理来接收你的消息：',
  scopeAlready: (name) => `你已经在 ${name} 里了。`,
  scopeNotFound: '找不到这个空间。',
  scopePicker: '点一个空间来切换：',
  scopeSwitched: (name, agentTitle) =>
    agentTitle
      ? `已切换到 ${name}，现在和 ${agentTitle} 对话。发送 /agents 可以更换。`
      : `已切换到 ${name}。这里还没有助理，先在 Biber 里创建一个，再发送 /agents。`,
  scopesHeading: '可切换的空间：',
  scopesHint: '回复 /switch <序号> 切换空间。',
  scopesUsage: (count) => `用法：/switch <序号>，序号在 1 到 ${count} 之间。`,
  startDirectMessageOnly: '请打开和 Biber 机器人的私聊，在那里发送 /start 绑定账号。',
  staleAgent: '当前助理已不可用，可能已被删除或移到了其他工作空间。发送 /agents 重新选择。',
  staleScope: '你当前的工作空间已不可用。发送 /switch 选择其他空间。',
  stopDirectMessageOnly: '请打开和 Biber 机器人的私聊，在那里发送 /stop。',
  stopNotActive: '当前没有正在执行的任务可以停止。',
  stopRequested: '已发出停止请求。',
  stopUnable: '无法停止当前执行。',
  unknownAction: '未知操作。',
  unknownCommand: (name) => `未知命令：/${name}`,
};

/** Upstream's personal WeChat bot, linked by scanning a QR code in the web app (no /start). */
const WECHAT_ZH_CN: MessengerSystemStrings = {
  ...ZH_CN,
  help: [
    '可用命令：',
    '• /switch：切换当前空间（个人或某个工作空间）',
    '• /agents：查看你的助理并切换当前助理',
    '• /new：开始新对话',
    '• /mode：查看或切换对话模式（agent 或 chat）',
    '• /stop：停止正在执行的任务',
    '• /feedback <内容>：直接给 Biber 团队反馈（不会触发 AI 回复）',
  ].join('\n'),
  needLink: '这个微信账号还没有连接，请到 Biber 的聊天应用设置里重新扫码。',
  notLinked: '这个微信账号还没有连接，请到 Biber 的聊天应用设置里重新扫码。',
};

/**
 * The shared bots' system replies (commands, prompts, toasts). The language follows
 * `messengerReplyLocale`: Chinese everywhere in the mainland edition, by platform elsewhere.
 */
export const getMessengerSystemStrings = (platform: string): MessengerSystemStrings => {
  if (platform === 'wechat') return WECHAT_ZH_CN;
  return messengerReplyLocale(platform) === 'zh-CN' ? ZH_CN : EN_US;
};

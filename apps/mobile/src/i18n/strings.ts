import { getLocales } from 'expo-localization';

const en = {
  alreadyAnswered: 'Already answered on another device.',
  approve: 'Approve',
  approvePrompt: 'Approve this action',
  approvalsEmpty:
    'Nothing is waiting for you. When an agent wants to send, pay or delete something, it shows up here.',
  approvalsError: 'Could not load what is waiting for you.',
  approvalsRefreshError: 'Could not refresh. Showing the last list.',
  approvalsTitle: 'Needs you',
  email: 'Email',
  mainlandEdition: 'Mainland China edition',
  password: 'Password',
  reject: 'Reject',
  respondError: 'That did not go through. Try again.',
  retry: 'Try again',
  signIn: 'Sign in',
  signInError: 'Sign-in failed. Check your email and password.',
  signInWithApple: 'Continue with Apple',
  signInWithGoogle: 'Continue with Google',
  signOut: 'Sign out',
};

const zh: typeof en = {
  alreadyAnswered: '已在另一台设备上处理。',
  approve: '批准',
  approvePrompt: '批准这项操作',
  approvalsEmpty: '暂时没有需要你决定的事。Agent 想要发送、付款或删除时，会出现在这里。',
  approvalsError: '没能加载待你处理的事项。',
  approvalsRefreshError: '刷新失败，显示的是上次的列表。',
  approvalsTitle: '需要你',
  email: '邮箱',
  mainlandEdition: '中国大陆版',
  password: '密码',
  reject: '拒绝',
  respondError: '没有提交成功，请重试。',
  retry: '重试',
  signIn: '登录',
  signInError: '登录失败，请检查邮箱和密码。',
  signInWithApple: '使用 Apple 登录',
  signInWithGoogle: '使用 Google 登录',
  signOut: '退出登录',
};

export type StringKey = keyof typeof en;

const strings = getLocales()[0]?.languageCode === 'zh' ? zh : en;

export const t = (key: StringKey) => strings[key];

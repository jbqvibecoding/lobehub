/** Where a mailbox is reached: its IMAP server for reading, its SMTP server for sending. */
export interface MailServers {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export const MAIL_PRESET_IDS = ['qq', '163', '126', 'exmail', 'aliyun', 'qiye163'] as const;
export type MailPresetId = (typeof MAIL_PRESET_IDS)[number];

/**
 * The mailboxes people in mainland China use most, all over SSL (IMAP 993, SMTP 465). Each takes
 * the mail address as the user name and an authorization code ("授权码", a password for mail apps
 * the user generates in the mailbox's settings) rather than the account password, except the
 * enterprise mailboxes, which take the mailbox password unless the admin requires a client one.
 */
export const MAIL_PRESETS: Record<MailPresetId, MailServers & { domains: string[] }> = {
  '126': {
    domains: ['126.com'],
    imapHost: 'imap.126.com',
    imapPort: 993,
    smtpHost: 'smtp.126.com',
    smtpPort: 465,
  },
  '163': {
    domains: ['163.com', 'yeah.net'],
    imapHost: 'imap.163.com',
    imapPort: 993,
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
  },
  'aliyun': {
    domains: [],
    imapHost: 'imap.qiye.aliyun.com',
    imapPort: 993,
    smtpHost: 'smtp.qiye.aliyun.com',
    smtpPort: 465,
  },
  'exmail': {
    domains: [],
    imapHost: 'imap.exmail.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.exmail.qq.com',
    smtpPort: 465,
  },
  'qiye163': {
    domains: [],
    imapHost: 'imap.qiye.163.com',
    imapPort: 993,
    smtpHost: 'smtp.qiye.163.com',
    smtpPort: 465,
  },
  'qq': {
    domains: ['qq.com', 'foxmail.com', 'vip.qq.com'],
    imapHost: 'imap.qq.com',
    imapPort: 993,
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
  },
};

/** The preset a personal address belongs to (`ada@qq.com` → `qq`); none for company domains. */
export const presetForAddress = (address: string): MailPresetId | undefined => {
  const domain = address.split('@').at(-1)?.toLowerCase();
  return MAIL_PRESET_IDS.find((id) => domain && MAIL_PRESETS[id].domains.includes(domain));
};

import { BRANDING_EMAIL } from '@lobechat/business-const';

interface EmailSupportCopy {
  contactSupport?: string;
  joinDiscord?: string;
}

const DEFAULT_SUPPORT_COPY = {
  contactSupport: 'Contact support',
  joinDiscord: 'Join Discord',
} satisfies Required<EmailSupportCopy>;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const EMAIL_SUPPORT_ADDRESS = BRANDING_EMAIL.support;
export const EMAIL_SUPPORT_REPLY_TO = BRANDING_EMAIL.replyTo;

// Biber's emails point to its support address only: it has no community Discord of its own, and
// `SOCIAL_URL.discord` is LobeHub's. `joinDiscord` stays in the copy type for the templates.
export const getEmailSupportHtml = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
}: EmailSupportCopy = {}) => {
  const supportEmail = escapeHtml(EMAIL_SUPPORT_ADDRESS);

  return `<a href="mailto:${supportEmail}" style="color: #6b7280; text-decoration: underline;">${escapeHtml(contactSupport)}</a>`;
};

export const getEmailSupportText = ({
  contactSupport = DEFAULT_SUPPORT_COPY.contactSupport,
}: EmailSupportCopy = {}) => `${contactSupport}: ${EMAIL_SUPPORT_ADDRESS}`;

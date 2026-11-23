import { describe, expect, it } from 'vitest';

import { EMAIL_SUPPORT_ADDRESS, getEmailSupportHtml, getEmailSupportText } from './support';

describe('email support helpers', () => {
  it("points to Biber's support address and not to LobeHub's Discord", () => {
    const html = getEmailSupportHtml();
    const text = getEmailSupportText();

    expect(EMAIL_SUPPORT_ADDRESS).toBe('support@biber.ai');
    expect(html).toContain('href="mailto:support@biber.ai"');
    expect(html).not.toContain('discord');
    expect(text).toBe('Contact support: support@biber.ai');
  });

  it('escapes localized labels before rendering HTML', () => {
    const html = getEmailSupportHtml({
      contactSupport: '<script>alert("support")</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAP_PORTS, isPublicAddress, MailHostError, resolveMailHost } from '../host';
import { presetForAddress } from '../presets';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup }));

afterEach(() => {
  delete process.env.MAIL_ALLOW_PRIVATE_HOSTS;
  lookup.mockReset();
});

describe('mail servers the user types in', () => {
  it.each([
    '10.0.0.5',
    '127.0.0.1',
    '192.168.1.20',
    '172.20.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:10.1.2.3',
  ])('%s is private', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['14.18.175.154', '220.181.12.12', '2408:8000::1'])('%s is public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it('connects to the address it checked and keeps the name for the certificate', async () => {
    lookup.mockResolvedValue({ address: '14.18.175.154', family: 4 });

    await expect(resolveMailHost('IMAP.QQ.com', 993, IMAP_PORTS)).resolves.toEqual({
      address: '14.18.175.154',
      servername: 'imap.qq.com',
      trustSelfSigned: false,
    });
  });

  it('refuses a name that points into a private network', async () => {
    lookup.mockResolvedValue({ address: '10.0.0.5', family: 4 });

    await expect(resolveMailHost('mail.example.com', 993, IMAP_PORTS)).rejects.toBeInstanceOf(
      MailHostError,
    );
  });

  it('refuses ports mail is not served on', async () => {
    await expect(resolveMailHost('imap.qq.com', 6379, IMAP_PORTS)).rejects.toThrow(
      'not a mail port',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('allows a local test server, self-signed, only when told to', async () => {
    process.env.MAIL_ALLOW_PRIVATE_HOSTS = '1';

    await expect(resolveMailHost('127.0.0.1', 3993, IMAP_PORTS)).resolves.toEqual({
      address: '127.0.0.1',
      servername: '127.0.0.1',
      trustSelfSigned: true,
    });
  });

  it('knows the provider of a personal address', () => {
    expect(presetForAddress('ada@QQ.com')).toBe('qq');
    expect(presetForAddress('ada@163.com')).toBe('163');
    expect(presetForAddress('ada@acme.cn')).toBeUndefined();
  });
});

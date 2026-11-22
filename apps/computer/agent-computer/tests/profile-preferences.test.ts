import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockProfilePreferences } from '../src/profile-preferences';

let dir: string;
const preferences = async () =>
  JSON.parse(await readFile(join(dir, 'Default', 'Preferences'), 'utf8'));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'profile-'));
});
afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

describe('lockProfilePreferences', () => {
  test('a new profile saves no passwords, cards or addresses, and keeps WebRTC in the proxy', async () => {
    await lockProfilePreferences(dir);

    const written = await preferences();
    expect(written.credentials_enable_service).toBe(false);
    expect(written.credentials_enable_autosignin).toBe(false);
    expect(written.profile.password_manager_enabled).toBe(false);
    expect(written.autofill).toEqual({
      credit_card_enabled: false,
      enabled: false,
      profile_enabled: false,
    });
    expect(written.webrtc.ip_handling_policy).toBe('disable_non_proxied_udp');
  });

  test('an existing profile keeps what else it remembers, but not saving passwords again', async () => {
    await mkdir(join(dir, 'Default'), { recursive: true });
    await writeFile(
      join(dir, 'Default', 'Preferences'),
      JSON.stringify({
        credentials_enable_service: true,
        homepage: 'https://example.com',
        profile: { name: 'Bot', password_manager_enabled: true },
        webrtc: { multiple_routes_enabled: false },
      }),
    );

    await lockProfilePreferences(dir);

    const written = await preferences();
    expect(written.homepage).toBe('https://example.com');
    expect(written.profile).toEqual({ name: 'Bot', password_manager_enabled: false });
    expect(written.credentials_enable_service).toBe(false);
    expect(written.webrtc).toEqual({
      ip_handling_policy: 'disable_non_proxied_udp',
      multiple_routes_enabled: false,
    });
  });

  test('starts clean from Preferences Chromium never finished writing', async () => {
    await mkdir(join(dir, 'Default'), { recursive: true });
    await writeFile(join(dir, 'Default', 'Preferences'), '{"profile": {');

    await lockProfilePreferences(dir);

    expect((await preferences()).profile.password_manager_enabled).toBe(false);
  });
});

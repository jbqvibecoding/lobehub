import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** What every Bot profile is held to, whatever it remembered before. */
const LOCKED = {
  /*
   * WebRTC kept inside the proxy. Chromium sends WebRTC over UDP straight past an HTTP proxy unless
   * told not to, so a page in a Bot's browser could reach the network around the egress filter.
   * `disable_non_proxied_udp` allows only UDP through a proxy, and an HTTP proxy carries none, so
   * WebRTC goes over the proxy or not at all. A preference rather than the
   * `--force-webrtc-ip-handling-policy` switch, which current Chromium no longer reads (measured:
   * the switch on the command line, packets still sent).
   */
  webrtc: { ip_handling_policy: 'disable_non_proxied_udp' },
  /*
   * No saved passwords, card numbers or addresses. A login typed into the page (by the server from
   * a saved login, or by a person who took over) must not land in the profile's own password store:
   * the Bot's shell runs beside this directory and could read it back.
   */
  credentials_enable_service: false,
  credentials_enable_autosignin: false,
  profile: { password_manager_enabled: false },
  autofill: { credit_card_enabled: false, enabled: false, profile_enabled: false },
} as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** `base` with every key of `locked` set, nested objects merged rather than replaced. */
const lockInto = (
  base: Record<string, unknown>,
  locked: Record<string, unknown>,
): Record<string, unknown> => {
  const merged = { ...base };
  for (const [key, value] of Object.entries(locked)) {
    merged[key] = isObject(value) ? lockInto(isObject(base[key]) ? base[key] : {}, value) : value;
  }
  return merged;
};

/**
 * Writes the locked preferences into a profile before Chromium reads it, merged into whatever
 * Preferences the profile already has, so nothing else it remembers is lost.
 */
export async function lockProfilePreferences(profileDir: string) {
  const file = join(profileDir, 'Default', 'Preferences');
  let preferences: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (isObject(parsed)) preferences = parsed;
  } catch {
    // No Preferences yet (a new profile), or one Chromium never finished writing: start clean.
  }
  const locked = lockInto(preferences, LOCKED);
  if (JSON.stringify(locked) === JSON.stringify(preferences)) return;
  await mkdir(join(profileDir, 'Default'), { recursive: true });
  await writeFile(file, JSON.stringify(locked));
}

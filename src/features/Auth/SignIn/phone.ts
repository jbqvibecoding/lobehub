/**
 * A mainland China mobile number as typed (`138 0013 8000`, `+86 138-0013-8000`, `8613800138000`)
 * in the E.164 form the server takes, or undefined when it is not one. A number typed with a
 * country code must use +86.
 */
export const normalizeMainlandMobile = (input: string): string | undefined => {
  const compact = input.replaceAll(/[\s()-]/g, '');
  let national: string;
  if (compact.startsWith('+')) {
    if (!compact.startsWith('+86')) return undefined;
    national = compact.slice(3);
  } else {
    national = compact.length === 13 && compact.startsWith('86') ? compact.slice(2) : compact;
  }
  return /^1[3-9]\d{9}$/.test(national) ? `+86${national}` : undefined;
};

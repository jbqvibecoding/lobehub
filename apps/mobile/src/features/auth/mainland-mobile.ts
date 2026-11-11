/**
 * A mainland China mobile number as typed (`138 0013 8000`, `+86 138-0013-8000`) in the E.164
 * form the server takes, or undefined when it is not one. The server checks it again.
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

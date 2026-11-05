import * as LocalAuthentication from 'expo-local-authentication';

/**
 * Approving lets the agent act with the user's accounts, so it asks for Face ID, Touch ID or the
 * device passcode first. A device with nothing enrolled approves without the extra step.
 */
export const confirmWithBiometrics = async (promptMessage: string): Promise<boolean> => {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  if (!hasHardware || !isEnrolled) return true;

  const result = await LocalAuthentication.authenticateAsync({ promptMessage });
  return result.success;
};

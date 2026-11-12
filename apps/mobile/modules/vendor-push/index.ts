import { requireOptionalNativeModule } from 'expo';

/** The phone makers whose push services the app can register with (mainland Android). */
export type VendorPushProvider = 'honor' | 'huawei' | 'oppo' | 'vivo' | 'xiaomi';

export interface VendorPushToken {
  provider: VendorPushProvider;
  token: string;
}

interface VendorPushNativeModule {
  /** Registers with this phone maker's push service; null when the phone has none built in. */
  register: () => Promise<VendorPushToken | null>;
}

/** Absent on iOS and in builds without the module (Expo Go, Global edition). */
const native = requireOptionalNativeModule<VendorPushNativeModule>('VendorPush');

export const isVendorPushAvailable = () => native !== null;

export const registerVendorPush = async (): Promise<VendorPushToken | null> =>
  native ? native.register() : null;

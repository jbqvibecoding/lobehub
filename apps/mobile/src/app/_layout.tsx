import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router/stack';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useNotificationRouting } from '@/features/push/use-notification-routing';
import { authClient } from '@/lib/auth-client';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 30_000 } },
});

/** On a phone, "focus" is the app coming back to the foreground. */
const useForegroundRefetch = () => {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
};

const Navigator = () => {
  const { data: session, isPending } = authClient.useSession();
  useNotificationRouting();

  // Nothing is decided until the stored session has loaded, so a cold start never flashes sign-in
  if (isPending) return null;

  const signedIn = !!session;

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
};

export default function RootLayout() {
  useForegroundRefetch();

  return (
    <QueryClientProvider client={queryClient}>
      <Navigator />
    </QueryClientProvider>
  );
}

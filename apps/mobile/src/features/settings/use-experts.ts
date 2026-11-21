import { useQuery } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';

import type { ApiClient } from '@/lib/api-client';

import type { Expert } from './types';

export const expertsKey = ['experts'] as const;

/** The expert roster in the phone's language, with the ones the user has added. */
export const useExperts = (api: ApiClient) => {
  const locale = getLocales()[0]?.languageTag;
  return useQuery({
    queryFn: () => api.query('experts.list', { locale }) as Promise<Expert[]>,
    queryKey: expertsKey,
  });
};

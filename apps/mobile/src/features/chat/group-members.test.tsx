import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { Expert } from '@/features/settings/types';
import type { ApiClient } from '@/lib/api-client';

import { GroupMembers } from './group-members';
import type { GroupMember } from './types';

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

const biber: GroupMember = {
  avatar: '/avatars/biber.png',
  backgroundColor: null,
  id: 'agt_biber',
  isHost: true,
  title: 'Biber',
};
const researcher: GroupMember = {
  avatar: '🔎',
  backgroundColor: '#eef',
  id: 'agt_researcher',
  isHost: false,
  title: 'Researcher',
};
const writer: GroupMember = { ...researcher, id: 'agt_writer', title: 'Writer' };

const roster: Expert[] = [
  { ...researcher, agentId: 'agt_researcher', description: '', id: 'researcher' } as Expert,
  { ...writer, agentId: 'agt_writer', description: '', id: 'writer' } as Expert,
  {
    agentId: 'agt_seo',
    avatar: '📈',
    backgroundColor: '#efe',
    description: '',
    id: 'seo',
    title: 'SEO Consultant',
  },
];

const renderMembers = async (members: GroupMember[] = [biber, researcher, writer]) => {
  const query = jest.fn(async (path: string) =>
    path === 'chat.group' ? { members, title: 'Launch' } : roster,
  );
  const mutation = jest.fn(async () => ({ members }));
  await render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            mutations: { retry: false },
            queries: { gcTime: Infinity, retry: false },
          },
        })
      }
    >
      <GroupMembers api={{ mutation, query } as unknown as ApiClient} groupId="group-1" />
    </QueryClientProvider>,
  );
  return { mutation, query };
};

describe('GroupMembers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows Biber hosting, who cannot be removed, and the experts who can', async () => {
    const { query } = await renderMembers();

    expect(await screen.findByText('Hosts the group')).toBeOnTheScreen();
    expect(query).toHaveBeenCalledWith('chat.group', { groupId: 'group-1' });
    expect(
      screen.queryByRole('button', { name: 'Remove Biber from the group?' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove Researcher from the group?' })).toBeEnabled();
  });

  it('removes an expert once the user confirms', async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    const { mutation } = await renderMembers();

    await user.press(await screen.findByRole('button', { name: 'Remove Writer from the group?' }));

    expect(alert).toHaveBeenCalledWith(
      'Remove Writer from the group?',
      'What they said stays in the chat.',
      expect.any(Array),
    );
    expect(mutation).toHaveBeenCalledWith('chat.updateGroup', {
      groupId: 'group-1',
      removeExpertIds: ['agt_writer'],
    });
  });

  it('adds one of the user’s other experts', async () => {
    const user = userEvent.setup();
    const { mutation } = await renderMembers();

    expect(
      screen.queryByRole('button', { name: 'Add Researcher to the group' }),
    ).not.toBeOnTheScreen();
    await user.press(
      await screen.findByRole('button', { name: 'Add SEO Consultant to the group' }),
    );

    expect(mutation).toHaveBeenCalledWith('chat.updateGroup', {
      addExpertIds: ['agt_seo'],
      groupId: 'group-1',
    });
  });

  it('keeps the last expert, since a group needs one', async () => {
    await renderMembers([biber, researcher]);

    expect(
      await screen.findByRole('button', { name: 'Remove Researcher from the group?' }),
    ).toBeDisabled();
  });
});

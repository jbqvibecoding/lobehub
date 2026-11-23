import { render, screen, userEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { FileCard } from './file-card';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const deck = {
  id: 'file-1',
  name: 'Quarterly review.pptx',
  size: 51_200,
  url: 'https://biber.example/f/file-1',
};

afterEach(() => jest.restoreAllMocks());

describe('FileCard', () => {
  it('shows what the file is and opens it', async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await render(<FileCard file={deck} />);

    expect(screen.getByText('Quarterly review.pptx')).toBeOnTheScreen();
    expect(screen.getByText('PPTX · 50 KB')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Open Quarterly review.pptx' }));

    expect(open).toHaveBeenCalledWith('https://biber.example/f/file-1');
  });

  it('says so when the file cannot be opened', async () => {
    const user = userEvent.setup();
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no app'));
    await render(<FileCard file={deck} />);

    await user.press(screen.getByRole('button', { name: 'Open Quarterly review.pptx' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't open the file.");
  });
});

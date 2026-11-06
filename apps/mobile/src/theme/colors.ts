import { useColorScheme } from 'react-native';

const light = {
  accent: '#2f6fed',
  background: '#f2f2f7',
  border: '#d1d1d6',
  card: '#ffffff',
  danger: '#d70015',
  label: '#000000',
  secondaryLabel: '#6c6c70',
  success: '#248a3d',
  warning: '#c93400',
};

const dark: typeof light = {
  accent: '#5b8cff',
  background: '#000000',
  border: '#38383a',
  card: '#1c1c1e',
  danger: '#ff453a',
  label: '#ffffff',
  secondaryLabel: '#98989f',
  success: '#30d158',
  warning: '#ff9f0a',
};

export type Palette = typeof light;

export const useColors = (): Palette => (useColorScheme() === 'dark' ? dark : light);

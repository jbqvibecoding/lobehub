import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/theme/colors';

/** An emoji avatar is shown as it is; an image path (Biber's logo) as the name's first letter. */
const isEmoji = (avatar: string | null | undefined): avatar is string =>
  !!avatar && avatar.length <= 8 && !/[/:.]/.test(avatar);

/** An agent's avatar in a circle; decorative, since its name is always shown or spoken beside it. */
export const AgentAvatar = ({
  avatar,
  backgroundColor,
  size = 24,
  title,
}: {
  avatar?: string | null;
  backgroundColor?: string | null;
  size?: number;
  title?: string | null;
}) => {
  const colors = useColors();
  const emoji = isEmoji(avatar);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.circle,
        {
          backgroundColor: backgroundColor || colors.border,
          borderRadius: size / 2,
          height: size,
          width: size,
        },
      ]}
    >
      <Text
        style={
          emoji
            ? { fontSize: size * 0.55 }
            : { color: colors.label, fontSize: size * 0.45, fontWeight: '600' }
        }
      >
        {emoji ? avatar : (title?.trim()[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});

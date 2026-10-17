import React, { useState } from 'react';
import { StyleProp, Text, TouchableOpacity, useWindowDimensions, View, ViewStyle } from 'react-native';
import { COLORS } from './config';

// 10-foot layout: design at 1920x1080 and scale to the actual window.
export function useS() {
  const { width } = useWindowDimensions();
  const k = (width || 1920) / 1920;
  return (n: number) => Math.round(n * k);
}

type FocusableProps = {
  label: string;
  icon?: string;
  onPress: () => void;
  preferred?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: 'primary' | 'ghost' | 'chip';
  testID?: string;
  onFocused?: () => void;
};

// D-pad focusable button with an obvious focus state (scale + glow + colour change).
export function Focusable({ label, icon, onPress, preferred, style, variant = 'ghost', testID, onFocused }: FocusableProps) {
  const S = useS();
  const [focused, setFocused] = useState(false);
  const primary = variant === 'primary';
  const chip = variant === 'chip';
  const bg = focused ? (primary ? COLORS.accent : '#F4F1EA') : primary ? 'rgba(255,181,71,0.16)' : 'rgba(255,255,255,0.06)';
  const fg = focused ? '#14100A' : primary ? COLORS.accent : COLORS.ink;
  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.85}
      hasTVPreferredFocus={!!preferred}
      onFocus={() => { setFocused(true); onFocused && onFocused(); }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: S(chip ? 20 : 22),
          paddingHorizontal: S(chip ? 26 : 34),
          borderRadius: S(chip ? 18 : 40),
          backgroundColor: bg,
          borderWidth: S(3),
          borderColor: focused ? (primary ? '#FFD596' : '#FFFFFF') : 'rgba(255,255,255,0.10)',
          transform: [{ scale: focused ? 1.05 : 1 }],
          marginBottom: S(chip ? 14 : 0),
        },
        style,
      ]}>
      {icon ? (
        <View style={{ width: S(46), height: S(46), borderRadius: S(23), alignItems: 'center', justifyContent: 'center', marginRight: S(18),
          backgroundColor: focused ? 'rgba(0,0,0,0.12)' : 'rgba(255,181,71,0.15)' }}>
          <Text style={{ color: focused ? '#14100A' : COLORS.accent, fontSize: S(24), fontWeight: '700' }}>{icon}</Text>
        </View>
      ) : null}
      <Text style={{ color: fg, fontSize: S(chip ? 32 : 34), fontWeight: '700' }}>{label}</Text>
      {chip && focused ? <Text style={{ marginLeft: 'auto', color: '#14100A', fontSize: S(30), fontWeight: '800' }}>›</Text> : null}
    </TouchableOpacity>
  );
}

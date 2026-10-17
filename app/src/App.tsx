import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Cast } from './ct/config';
import { PairScreen } from './ct/PairScreen';
import { PlayerScreen } from './ct/PlayerScreen';

// Cast to Your TV for Fire TV: pair screen (QR + code) -> player with subtitles -> "Ask the TV".
export const App = () => {
  const [cast, setCast] = useState<Cast | null>(null);
  const onCast = useCallback((c: Cast) => setCast(c), []);
  const onExit = useCallback(() => setCast(null), []);
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0F1A' }}>
      {cast ? <PlayerScreen cast={cast} onExit={onExit} /> : <PairScreen onCast={onCast} />}
    </View>
  );
};

export default App;

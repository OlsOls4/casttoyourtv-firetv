import React, { useMemo } from 'react';
import { View } from 'react-native';
import { qrMatrix } from './qr';

// Renders a QR code with plain Views: each row's dark runs are merged into one View.
export function QRCode({ value, size, color = '#0B0F1A' }: { value: string; size: number; color?: string }) {
  const rows = useMemo(() => qrMatrix(value), [value]);
  const n = rows.length;
  const cell = Math.floor(size / n);
  return (
    <View style={{ width: cell * n, height: cell * n }}>
      {rows.map((row, r) => {
        const runs: { x: number; w: number }[] = [];
        let c = 0;
        while (c < n) {
          if (row[c]) {
            const x = c;
            while (c < n && row[c]) c++;
            runs.push({ x, w: c - x });
          } else c++;
        }
        return (
          <View key={r} style={{ height: cell, width: cell * n }}>
            {runs.map(run => (
              <View key={run.x} style={{ position: 'absolute', left: run.x * cell, top: 0, width: run.w * cell, height: cell, backgroundColor: color }} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

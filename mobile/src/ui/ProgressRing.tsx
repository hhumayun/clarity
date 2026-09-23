import React from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle } from "react-native-svg";

type Props = {
  /** 0..1 of the ring still drawn. It empties as time runs down. */
  remaining: number;
  size: number;
  stroke: number;
  color: string;
  trackColor: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * A ring that empties clockwise from the top, with the content centred in
 * it. The small gap at the top of a full ring is the round cap meeting
 * itself, which matches the design.
 */
export function ProgressRing({ remaining, size, stroke, color, trackColor, children, style }: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = Math.max(0, Math.min(1, remaining));
  // Leave a hair of a gap even when full, so the start of the ring reads.
  const drawn = fraction >= 1 ? circumference - stroke * 0.9 : circumference * fraction;
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        {fraction > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${drawn} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2}) translate(0 0)`}
          />
        ) : null}
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  svg: { position: "absolute", top: 0, left: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});

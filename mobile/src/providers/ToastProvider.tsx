import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ToastContextValue = {
  show: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(0);

  const show = useCallback(
    (next: string) => {
      const id = ++current.current;
      setMessage(next);
      opacity.stopAnimation();
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(
          ({ finished }) => {
            // Only clear if no newer toast arrived while this one faded.
            if (finished && id === current.current) setMessage(null);
          },
        );
      }, 2600);
    },
    [opacity],
  );
  const rise = opacity.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {message ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.toast, { bottom: insets.bottom + 88, opacity, transform: [{ translateY: rise }] }]}
        >
          <Text style={styles.text}>{message}</Text>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 24,
    right: 24,
    backgroundColor: "#24211c", // Morning Paper text
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  text: {
    color: "#f6f2ea", // Morning Paper bg
    fontFamily: "NunitoSans_600SemiBold",
    fontSize: 15,
    textAlign: "center",
  },
});

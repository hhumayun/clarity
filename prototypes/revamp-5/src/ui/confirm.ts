import { ActionSheetIOS, Alert } from "react-native";

/**
 * A destructive confirmation the system's way: an action sheet on the
 * iPhone, an alert on Android, the browser's confirm on the web.
 */
export function confirm({ title, message, action }: { title: string; message?: string; action: string }): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.env.EXPO_OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, message, options: [action, "Cancel"], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
        (index) => resolve(index === 0),
      );
    } else if (process.env.EXPO_OS === "android") {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: action, style: "destructive", onPress: () => resolve(true) },
      ]);
    } else {
      resolve(typeof window !== "undefined" ? window.confirm([title, message].filter(Boolean).join("\n\n")) : false);
    }
  });
}

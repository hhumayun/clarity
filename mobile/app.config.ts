import type { ConfigContext, ExpoConfig } from "expo/config";

// The development build (eas.json's "development" profile) is its own app,
// "Clarity Dev", with its own bundle id, so it sits beside the App Store app
// on the phone rather than replacing it. Everything else is app.json.
const DEV = process.env.APP_VARIANT === "development";
const DEV_ID = "app.claritynotes.mobile.dev";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: DEV ? "Clarity Dev" : (config.name ?? "Clarity Notes"),
  slug: config.slug ?? "clarity-notes",
  ios: { ...config.ios, bundleIdentifier: DEV ? DEV_ID : config.ios?.bundleIdentifier },
  android: { ...config.android, package: DEV ? DEV_ID : config.android?.package },
});

import * as WebBrowser from "expo-web-browser";
import React, { useRef } from "react";
import { StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { asScript, useEditorBridge, type NoteEditorProps } from "./bridge";
import { EDITOR_PAGE } from "./page";
import { PAGE_RECEIVER } from "./protocol";

export type { EditorSeed, NoteEditorHandle } from "./bridge";

/**
 * A note's words, rich: the editor page (built into the app, see
 * src/editor/protocol.ts) in a plain web view. The page is a string inside
 * the app's code, so a note opens with no connection, in Expo Go too.
 */
export function NoteEditorView(props: NoteEditorProps) {
  const web = useRef<WebView>(null);
  const { receive, restart } = useEditorBridge(props, (message) => web.current?.injectJavaScript(asScript(PAGE_RECEIVER, message)));
  const background = props.look.colors.card;

  // iOS can end a web view's process (memory): load the page again, and it
  // takes back the words it last sent.
  const startAgain = () => {
    restart();
    web.current?.reload();
  };

  return (
    <WebView
      ref={web}
      source={{ html: EDITOR_PAGE }}
      originWhitelist={["*"]}
      onMessage={(event: WebViewMessageEvent) => receive(event.nativeEvent.data)}
      // The page's own colour before its first paint, so no white flash in dark mode.
      injectedJavaScriptBeforeContentLoaded={`document.documentElement.style.background=${JSON.stringify(background)};true;`}
      style={[styles.web, { backgroundColor: background }]}
      containerStyle={{ backgroundColor: background }}
      // No bar of its own above the keyboard (the note page has the tools),
      // and the keyboard may come up when the page puts the cursor in the text.
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
      setSupportMultipleWindows={false}
      webviewDebuggingEnabled={__DEV__}
      // The page never leaves itself; a web address opens in the browser.
      onShouldStartLoadWithRequest={(request) => {
        if (/^https?:/i.test(request.url)) {
          void WebBrowser.openBrowserAsync(request.url);
          return false;
        }
        return true;
      }}
      onContentProcessDidTerminate={startAgain}
      onRenderProcessGone={startAgain}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1 },
});

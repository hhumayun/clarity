# Clarity revamp 5: "Sage"

A redesign of Clarity guided by Rosebud's design language, built as a separate Expo Go prototype with sample data and no backend. It is not part of the app: nothing here is imported by `mobile/` or the web app.

- **The design:** [DESIGN.md](DESIGN.md), and the same document as one page with live specimens in `docs/design.html` (rebuild with `node docs/build-presentation.mjs`).
- **Screens:** `docs/screens/`.

## Run it

Expo SDK 57; Expo Go on the phone.

```sh
cd prototypes/revamp-5
npm install
npx expo start
```

Scan the QR code Expo prints with Expo Go. To reach the phone from a remote machine, put a tunnel in front of Metro and pass its address: `EXPO_PACKAGER_PROXY_URL=https://<tunnel> npx expo start`.

`src/lib/parseTask.test.ts` holds the quick-add parser's tests, a plain script: `node src/lib/parseTask.test.ts` (Node 24, which strips the types).

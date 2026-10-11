# Solomon client portal (mobile app)

The first step of a mobile app for Solomon clients: one screen showing a
license summary. Built with [Expo](https://expo.dev) + [Expo Router](https://docs.expo.dev/router/introduction/),
so it runs on iPhone, Android, and the web from one codebase.

Right now it shows **sample data only** (the same Acme Robotics Ltd test
deal used in `../legal/generate-agreement.js` and the webhook demo
scripts) — there's no login and no connection to real client data yet.
That's the next step.

## See it on your own phone

No app store, no cost, no account beyond the free one below.

1. Install **Expo Go** from the App Store (iPhone) or Play Store (Android).
2. On a computer with this repo checked out, open a terminal in this
   folder (`solomon-app/`) and run:
   ```
   npm install
   npx expo start
   ```
3. A QR code appears in the terminal. Open the Camera app (iPhone) or the
   Expo Go app itself (Android) and scan it. The app opens on your phone.

Your phone and the computer need to be on the same Wi-Fi network for this
to work. If that's awkward, `npx expo start --tunnel` routes around it at
the cost of a slightly slower connection.

## Project layout

- `src/app/` — screens (Expo Router: one file per screen, `_layout.tsx`
  defines the navigator). This is where new screens go.
- `src/components/` — reusable UI pieces.
- `src/data/` — sample data for now; will become real API calls.
- `src/theme.ts` — shared colors, matching the rest of Deverout's Solomon
  branding (ink / parchment / brass).

## Checks

```
npx tsc --noEmit    # typecheck
npx expo lint       # lint
npx expo-doctor     # project health check
```

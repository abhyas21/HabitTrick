# Habit Trick

Habit Trick is an existing React, TypeScript, and Vite habit tracker. It uses Supabase Auth and PostgreSQL for account-specific habits and completion history, with realtime updates across signed-in clients. The same frontend is served as a website, an installable PWA, and a separately installed Android app built with Capacitor.

## Run locally

Requirements: Node.js 20 or later.

```sh
npm install
npm run dev -- --host 0.0.0.0
```

Vite serves the laptop website at `http://localhost:5173/`. The same server can be opened on another device on the same Wi-Fi network at `http://<computer-ipv4-address>:5173/` (find the address with `ipconfig`).

## Android APK

The Android app uses the same React frontend and `.env.local` Supabase configuration as the website. Capacitor packages the production Vite output from `dist`; it does not load the development machine's address. The Android application ID is `com.habittrick.app`, and its launcher label is **Habit Trick**. The Android project includes app icons and a matching splash screen derived from `public/icon-512.png`.

Requirements: Android Studio/Android SDK (API 36 and build tools), Java 21, and an ADB-authorized Android phone for installation. Set `ANDROID_HOME` or add the SDK's `platform-tools` to `PATH` if your shell does not already find `adb`. This project includes `android/local.properties` only on the current machine (it is ignored by Git); set its `sdk.dir` to your SDK folder on other machines.

Build the production frontend, sync it into Android, and build the debug APK:

```sh
npm run android:build
```

The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`. To install it on the connected device and launch Habit Trick:

```sh
npm run android:install
```

To open Android Studio instead, run `npx cap open android`. After changing the React app, use `npm run android:build` again so the APK contains the latest assets. The native app uses the packaged production bundle and requires no live Vite connection.

```sh
npm run dev -- --host 0.0.0.0
ipconfig
```

Open `http://<computer-ipv4-address>:5173` in the phone browser. This is for development preview; PWA installation requires HTTPS (or localhost on the same device), so use the deployed HTTPS site to install.

## Environment and Supabase

Copy `.env.example` to `.env.local` and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy `VITE_SUPABASE_ANON_KEY`)

These are browser-safe project values. Never use a Supabase service-role key in a `VITE_` variable or frontend code. Keep `.env.local` out of version control.

In Supabase Auth, set the Site URL to the production HTTPS origin and add the production origin, `http://localhost:5173`, and `habittrick://auth/callback` to the redirect allow list. Website password recovery returns to the website origin; Android password recovery returns through the `habittrick://auth/callback` app link. The Capacitor App plugin exchanges the Supabase PKCE code when Android reopens the app. Keep email confirmations enabled. To send a numeric signup code, set the **Confirm signup** email template to use `{{ .Token }}` rather than `{{ .ConfirmationURL }}`. The code flow uses Supabase Auth OTP verification and its resend limits. The checked-in `supabase/templates/confirmation.html` is the local template; it does not update the hosted project's dashboard template. Configure production SMTP and verify delivery with a real inbox.

Habit and completion data remain protected by the existing Row Level Security policies. No database migration is required for the web/PWA setup.

## PWA

Vite's existing `vite-plugin-pwa` configuration generates the web app manifest and service worker during `npm run build`. The manifest uses the Habit Trick logo in standard 192 and 512 pixel icons and a 512 pixel maskable icon, with standalone display. The service worker precaches the app shell and static assets, and falls back to the app shell for navigation while offline. It does not cache Supabase API responses. The app's existing offline month cache is scoped by authenticated user ID and month; offline edits remain disabled.

Where a browser supports the install prompt, Habit Trick shows an **Install app** button. Other browsers may expose installation in their own browser menu. Install availability still depends on browser support, secure HTTPS hosting, and the browser's PWA criteria.

## Deploy to Vercel

The repository includes `vercel.json`; Vercel builds with `npm run build` and serves the `dist` directory. Import this repository into Vercel and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the project's environment variables for each deployment environment. Deploy using HTTPS, then set that deployment's origin as the Supabase Auth Site URL and add it to the redirect allow list.

Other static hosts can use the same build output:

```sh
npm run build
npm run preview
```

Deploy the contents of `dist`. Configure SPA fallback to `/index.html` if the host does not provide it automatically. Set the same two public Supabase environment variables in that host's build environment.

## Checks

```sh
npm test
npm run build
```

`npm run build` runs TypeScript project checks before producing the Vite/PWA production output. `npm run android:build` also syncs those production assets and creates a debug APK. Live email delivery, account verification, password reset through the Android deep link, and cross-device synchronization still require testing with a real account and Supabase redirect settings.

# Linkit for iOS

A native SwiftUI client for [Linkit](../README.md): profiles, direct messages and group
chat on top of any Linkit instance, signed in with **Auth Mini**.

## Requirements

- Xcode 26 or newer (iOS 17.4+ deployment target)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) — the Xcode project is generated from
  `project.yml` and is not committed

```bash
brew install xcodegen
cd ios
xcodegen generate
open Linkit.xcodeproj
```

Select the `Linkit` scheme and run on a simulator or an iPhone. Running on a real device
needs your own signing team: set `DEVELOPMENT_TEAM` in `project.yml` (or pick a team in
Xcode after generating).

## Features

- **Auth Mini sign-in** — the instance login page opens in an in-app web view; the redirect
  back to the instance origin delivers the session, which is refreshed automatically
  (`/session/refresh`) and stored in the keychain.
- **Conversations** — direct and group conversations with live updates over the
  `/api/events` SSE stream, unread badges, cursor-paged history, and read state.
- **Messaging** — text, `@` mentions (`<@user_id>` tokens), urgent messages, image and file
  attachments (upload from photos or files, view images in-app, preview files with Quick
  Look).
- **Groups** — create groups, add members (any member), remove members and rename or delete
  a group (owner).
- **People directory** — search by username or user ID, open direct messages from a
  person's profile.
- **Profile** — edit username, intro and avatar; theme (system/light/dark) and language
  (English/中文) preferences are owned by the signed-in profile, matching the web app.
- **Any instance** — the server address can be changed on the sign-in screen; the app reads
  `/api/config` for the Auth Mini issuer and public origin.

Not in this first version: Bot management, API keys, private notes, Bark bindings, push
notifications (APNs) and the admin pages.

## Architecture

```
Linkit/
├── App/            AppModel (root state), RootView, MainShell, LocaleController
├── Core/           models, APIClient, AuthSession, EventHub (SSE), AppStore,
│                   ConversationModel, AttachmentLoader, Mentions, LoginCallback
└── Features/       Login, Chats, Directory, Profile, Shared views
```

- `AppModel` owns the `AuthSession`, `APIClient`, `AppStore`, `EventHub` and
  `LocaleController`. `RootView` switches between sign-in and the tab shell as the session
  phase changes.
- `APIClient` speaks the Linkit HTTP API with `Authorization: Bearer <Auth Mini JWT>`; a
  `401` is answered with one forced token refresh and one retry.
- `EventHub` keeps one authenticated SSE connection open and reconnects with backoff.
  Events route into `AppStore` (conversation list, unread badge) and the open
  `ConversationModel` (live messages, read state).
- Attachments are downloaded lazily and cached in memory (`AttachmentLoader`); avatars are
  resolved through the public profile API and cached per user.

### Sign-in flow

1. `AuthSession.beginLogin()` builds `https://<issuer>/web/#/login?redirect_uri=<origin>/#/auth/callback&state=<uuid>`
   (loopback instances additionally pass `aud`).
2. The login page runs in `AuthWebView`; when it redirects back to the instance origin with
   the tokens in the hash route, `LoginCallback` parses and validates them (including
   `state`).
3. The rotating `refresh_token` and `session_id` go to the keychain; access tokens stay in
   memory and refresh themselves before expiry.

## Tests

```bash
cd ios
xcodegen generate
xcodebuild -project Linkit.xcodeproj -scheme Linkit \
  -destination 'platform=iOS Simulator,name=iPhone 17' test
```

Unit tests cover the pure logic: mention tokenization/rendering, the Auth Mini callback
parser, model decoding (including the always-null-able `avatar_attachment_id`), the SSE
frame parser and profile update encoding.

## Continuous integration

`.github/workflows/ios.yml` runs on macOS runners for changes under `ios/`: it generates
the project with XcodeGen, builds for the simulator, runs the unit tests, and captures a
simulator screenshot artifact.

## Roadmap

- Bot management, API keys and private notes pages (parity with the web app)
- Push notifications (registering an APNs device with Linkit's notification pipeline)
- Markdown rendering for messages, full-screen gallery for images
- App Store / TestFlight distribution

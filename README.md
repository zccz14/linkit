# Linkit

Linkit is an open-source, Auth Mini-powered profile and instant-messaging app
distributed as one Rust binary. It includes user profiles, a searchable
directory, direct messages, group conversations, media attachments, PWA
installation, browser-notification subscription storage, and native Bot API
tokens.

## Features

- **Profiles and people directory** — username, nickname, avatar, motto, and
  search.
- **Messaging** — direct and group conversations, image/file attachments, read
  state, cursor-paged history, and immediate SSE refresh.
- **Open-page links** — external apps may open `/?open=profile` to edit the
  profile or `/?open=message&username=alice` to begin a direct message.
- **PWA and notifications** — installable manifest, service worker, and an API
  for signed-in browsers to register push subscriptions. A push provider can
  later deliver to those stored subscriptions without changing the client API.
- **Direct Bark notifications** — an iPhone running Bark binds directly to its Linkit user and receives APNs notifications without Linkit exposing a public Bark push API.
- **Bilingual UI** — English and Chinese interfaces, with an in-app language
  picker and browser-language default on first visit.
- **Native Bots** — each Bot has a durable UUID, one human owner, an `sk-…`
  bearer token, owner transfer, and token rotation. Bots can message a joined
  group or directly message any Linkit user.
- **Auth Mini** — setup verifies its `root_user_id` against an Auth Mini JWT;
  normal app requests validate JWTs against the configured issuer and audience.

## Quick start

Download the matching archive from the [latest GitHub Release](https://github.com/zccz14/linkit/releases/latest), verify its SHA-256 checksum, extract it, and run `./linkit`.

The app listens on `0.0.0.0:8080`, serves the embedded Web UI, and creates its
private SQLite database and attachment store under `~/.linkit/`. No environment
variables are required.

Open the app, enter your Auth Mini issuer, app hostname audience, public origin,
and Auth Mini subject as `root_user_id`, then sign in with the matching user and
initialize the instance. The default production issuer is `https://auth.ntnl.io`.

## Bot API

Create a Bot as its owner in the Linkit UI. The generated token is shown exactly
once and starts with `sk-`. Send a direct message using its token and the
recipient's Linkit username:

```bash
curl https://linkit.ntnl.io/bot/v1/messages \
  -H 'Authorization: Bearer sk-…' \
  -H 'Content-Type: application/json' \
  -d '{"recipient_username":"alice","body":"Hello from Linkit Bot"}'
```

For a group, add the Bot in the owner-managed group path and supply its
`conversation_id` instead. A Bot cannot post into a group it has not joined.

See [the Bot direct-message guide](docs/bot-direct-messages.md) for the full
creation flow, token handling, response contract, and error handling.

## Bark device binding

Linkit sends conversation and Bot notifications directly to Bark on iPhone
through APNs. It does not expose Bark URL V1/V2 push endpoints.

Open **Settings → Notifications** while signed in to obtain your private Bark
Server Base URL and QR code. In Bark on iPhone, add a server and scan that QR
code. Bark calls the Base URL's `/ping` and `/register` endpoints; registration
uploads its APNs device token and Linkit binds that device to the signed-in
Linkit user who owns the Base URL.

The Base URL is a high-entropy capability, not a user ID. Linkit only stores a
hash of it, redacts it from HTTP logs, and exposes it only to its owner through
the authenticated settings API. Treat the URL like a device-binding secret:
do not share it. Regenerating it removes existing devices and invalidates the
old URL; revoking it removes both the URL and all bound devices.

When a message is created, Linkit selects only bound devices of conversation
members, skips the human sender, and delivers directly to APNs with its Bark
Provider Key. A Bot message can notify every bound conversation member. Clicking
a delivered Bark notification opens that message's conversation at Linkit's
configured public origin.

Linkit keeps only the minimal Bark iOS lifecycle surface:

```text
GET  /api/bark/b/<private-capability>/ping
GET  /api/bark/b/<private-capability>/register
POST /api/bark/b/<private-capability>/register
```

The registration request accepts Bark's current `device_key`/`device_token`
field names and its legacy `key`/`devicetoken` names. Sending
`devicetoken=deleted` unbinds the matching device. The APNs Provider Key is a
root-owned runtime file, not part of this repository or release archive.

## Development

```bash
npm --prefix web ci
npm --prefix web run check
npm --prefix web run build
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
cargo run
```

The frontend is built before Rust because `web/dist` is embedded in the binary.

## Release and deployment

`main` is protected by the `pr-check` gate. A version tag runs the release
workflow, producing Linux x86_64, Linux ARM64, and macOS ARM64 archives with
checksums. The Linux x86_64 release is checksum-verified and atomically deployed
through AWS Systems Manager to the configured EC2 instance.

Bootstrap a new Ubuntu host with `deploy/bootstrap-ubuntu.sh`, configure
`linkit.ntnl.io` DNS, obtain its TLS certificate with Certbot, and set repository
variables `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`, and `EC2_INSTANCE_ID`.

## Design boundary

Linkit intentionally does not include an administrative console yet. Setup is
the one-time configuration boundary. Auth Mini owns sign-in and session issuance;
Linkit owns downstream authorization, profiles, conversations, Bot ownership,
and message data.

## License

[MIT](LICENSE)

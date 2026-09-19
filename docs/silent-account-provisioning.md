# Silent account and profile provisioning

A valid Auth Mini JWT is sufficient to begin using Linkit. The authentication
middleware performs this flow for every protected API request:

```text
Verify JWT → ensure human account + profile → route authorization → business logic
```

It is not limited to `/api/me`, a frontend login callback or a registration form.
For example, a first request to `/api/users` or `/api/conversations` also provisions
the verified JWT subject before the handler runs. A directory token is not
required for this on-demand behavior.

## The ensure contract

- Use the verified JWT `sub` as `users.id`; request bodies cannot choose the
  authenticated account.
- Create a missing human user and profile in one transaction.
- Preserve existing users' creation timestamps and all existing profile fields.
- Repair an existing human user's missing profile on the next authenticated API
  request. Already complete accounts take an indexed, read-only fast path.
- Give a new profile an empty intro, no avatar and a default username such as
  `user_7a28d10f93ac`. The twelve lowercase hexadecimal characters come from a
  SHA-256 digest of the user ID, not an email address or other Auth Mini data.
- Enforce the existing case-insensitive unique username constraint. If a username
  is already taken, append `_2`, `_3`, and so on until a free candidate is found.
- Let users edit the generated username through the normal profile editor/API.
  Later requests and synchronization never reset it.

New users have real profiles, so they are visible in the directory, searchable,
resolvable through the public profile API and available for direct messages.

## Other creation paths

The same transactional helper is used by instance setup, Auth Mini directory
synchronization and human-user provisioning when adding group members by ID.
Startup backfills missing profiles for all existing local human users before
serving requests, even when directory synchronization is disabled. Native Bot
creation and Bot authentication keep their separate semantics.

## Authorization and failure boundaries

JWT signature, issuer, audience, expiry and other token claims are checked by the
existing Auth Mini verifier before any provisioning. Invalid JWTs never create
users or profiles. Silent registration is not an authorization grant: Root-only
routes, conversation membership checks and all other route permissions continue
to apply. A request denied by a route may already have provisioned its valid JWT
subject. A JWT subject cannot take over a local Bot ID or convert it to a human.

Public unauthenticated lookup endpoints do not create arbitrary target accounts.
Provisioning failures return an API error rather than continuing with a partial
account. Missing-user creation and profile creation roll back together, including
inside a failed directory import or group creation transaction.

## Concurrency and verification

On the provisioning path, the first transactional operation is a write, which
serializes concurrent creators with SQLite's writer lock. Profile existence is
checked again under that lock, preserving concurrent profile edits and avoiding
stale-read transaction upgrades. Only a username collision is retried; unrelated
database errors propagate. The username search is finite because other writers
cannot add new collisions during the transaction.

Tests cover signed-JWT middleware entry points, expired/wrong-audience/wrong-issuer
and tampered tokens, missing-profile repair, default username collisions, custom
profile preservation, startup backfill, concurrent first requests, read-only hot
paths, transactional rollback, group/sync entry points and human/Bot isolation.

New branches distinguish complete/missing accounts, existing/missing profiles,
Bot/human identities and username collisions. These are domain and failure
boundaries; no compatibility fallback or separate registration mode is added.

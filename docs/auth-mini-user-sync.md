# Auth Mini user ID synchronization

Linkit's Root User can configure a dedicated Auth Mini directory token at
**System → Auth Mini user sync**. Auth Mini remains the source of human user IDs;
Linkit keeps its profiles, Bots, conversations and messages locally.

## Configuration

1. Sign in to Auth Mini as its administrator.
2. Open **Admin → Users → User ID directory token** and generate a token.
3. Copy the once-displayed `am_uid_…` token into Linkit's **Auth Mini user sync** page.
4. Choose **Save and sync**. Linkit validates the token against its configured
   Auth Mini issuer, imports the complete ID list and saves the token only after
   the whole operation succeeds.

Linkit synchronizes on startup and every 60 seconds after configuration. **Sync
now** triggers a manual pull. The page shows the last successful synchronization,
its Auth Mini ID count and any most recent synchronization error.

This is polling-based eventual synchronization, not real-time replication. A
failed poll retains the previous successful state and retries on the next tick.
Removing the token stops future pulls without deleting local data. Replacing or
revoking it in Auth Mini immediately prevents future reads with the old token;
update Linkit's configuration after replacement.

## Data boundary

The backend requests:

```http
GET /integration/user-ids
Authorization: Bearer am_uid_<secret>
```

The complete response is:

```json
{"user_ids":["00000000-0000-4000-8000-000000000001"]}
```

No email addresses, names, credentials or sessions are requested. Linkit checks
that the complete response matches this schema and contains canonical UUIDs
before starting its import transaction. Responses above 32 MiB are rejected with
an explicit error rather than partially imported. Requests time out after 15
seconds and do not follow redirects. HTTPS is required except on loopback for
local development, using the existing Auth Mini issuer configuration.

Synchronization inserts missing human `users` records idempotently. It does not
create placeholder profiles or overwrite usernames, intros, avatars or creation
timestamps. Users without profiles become searchable by UUID in the user picker;
the profile directory continues to list completed profiles. A collision with a
local Bot ID rejects the whole import. Local IDs missing from a later snapshot
are retained: synchronization does not delete or deactivate accounts, remove
Bots, erase history or replace Linkit's authentication checks.

## Linkit administration API

All routes require the configured Root User's authenticated session. The
directory token itself cannot authenticate to these routes.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/auth-mini-directory` | Read non-secret sync status |
| PUT | `/api/admin/auth-mini-directory` | Validate, synchronize and save `{"token":"am_uid_…"}` |
| DELETE | `/api/admin/auth-mini-directory` | Remove the token and disable automatic pulls |
| POST | `/api/admin/auth-mini-directory/sync` | Synchronize using the saved token |

Responses contain only `configured`, `last_synced_at` (Unix seconds or null),
`user_count` and `last_error`. They use `Cache-Control: no-store`. The token is
write-only: it is not returned by settings or public configuration APIs and is
not stored in browser storage. Linkit must retain the recoverable token in its
private server-side SQLite database to make requests; protect database backups
as secrets. The existing data directory and database permissions are 0700/0600.

## Verification and complexity

Tests cover administrative access, token redaction, invalid/revoked tokens,
invalid snapshots, all-or-nothing imports, empty directories, repeated imports,
profile/Bot preservation, UUID lookup, disabled synchronization and redirect
rejection. The periodic task and manual/configuration operations share one lock,
so an in-flight pull cannot restore a token after it is removed or replaced.

New branches are limited to authorization, optional configuration, upstream
failures, response validation and the Bot/human ID boundary. Failed snapshots
never enter the import transaction. No compatibility fallback is introduced.

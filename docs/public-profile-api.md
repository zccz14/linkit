# External public profile lookup

Linkit provides an exact, public profile lookup for downstream products such as
1Exchange and OpenAI LB. The endpoint accepts an Auth Mini user ID (the JWT
subject), not a username search term. It does not provide list or search
operations.

## Lookup

```text
GET /api/public/profiles/{user_id}
```

A successful response contains only the minimal display profile:

```json
{
  "user_id": "auth-mini-subject",
  "username": "alice",
  "display_name": "Alice",
  "avatar_url": "https://linkit.ntnl.io/api/public/profiles/auth-mini-subject/avatar"
}
```

`avatar_url` is `null` when the profile has no current image avatar.

The URL is generated from Linkit's configured `public_origin`; it is not built
from a caller-supplied `Host` header. `404` means no Linkit profile exists for
the requested user ID.

## Avatar boundary

The optional avatar URL serves only the image attachment currently selected as
that profile's avatar. It does not accept an attachment ID and cannot be used
to download message files or arbitrary user uploads.

This API intentionally omits profiles' motto, conversations, Bark devices,
notification capabilities, Bot credentials, and all other non-display data.

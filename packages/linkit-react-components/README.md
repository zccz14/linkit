# Linkit React Components

`linkit-react-components` provides small, reusable Linkit identity and profile controls for React applications. Every component must be rendered below `AuthMiniProvider → LinkitProvider`; the package reuses the outer Auth Mini session and never owns login callbacks, token refresh, passwords, cookies, or token audiences.

```tsx
<AuthMiniProvider authMiniBaseUrl="https://auth.ntnl.io" audiences={["app.example.com", "linkit.ntnl.io"]} autoRedirectToLogin={false}>
  <LinkitProvider linkitBaseUrl="https://linkit.ntnl.io">
    <LinkitAppHeaderUser lang="zh-CN" />
  </LinkitProvider>
</AuthMiniProvider>
```

## API

- `LinkitProvider` supplies authenticated Linkit requests, `getMe`, `getProfile`, `updateProfile`, `upload`, `searchUsers`, and `openDirectConversation`.
- `useLinkit` reads that provider context.
- `LinkitAvatar` renders a profile avatar with a Base UI fallback.
- `LinkitUserDisplay` renders a profile `username`; when the profile is unavailable it renders the localized unknown-user label and the complete source `user_id`.
- `LinkitConversationDisplay` renders a group or direct conversation identity.
- `LinkitAppHeaderUser` renders an application-header account trigger and Base UI dialog for username, motto, avatar upload, UID copy, passkey registration, sign-in-method settings, and sign out.
- `LinkitUserPicker` searches username prefixes and UUID-character `user_id` prefixes, then writes the chosen `user_id` in controlled or uncontrolled form usage.
- `LinkitUserInfo` is an inline avatar, username, and complete `user_id` display. Its Base UI popover opens by click, keyboard, or desktop hover and presents the available profile motto plus a real Linkit direct-message action. Pass a prefetched `profile` for dense tables; otherwise the component fetches the public profile only after its popover opens.

## Username and profile semantics

A Linkit username is the sole human-readable user identity. Linkit trims it before persistence, keeps SQLite `NOCASE` uniqueness semantics, permits Unicode and punctuation, and rejects empty, control-character, and over-80-character values. Consumers must render it as text and URL-encode it when it appears in a path or query.

`LinkitProfile` contains `user_id`, `username`, optional `avatar_url`, optional `motto`, optional `avatar_attachment_id`, and optional `updated_at`. There is no nickname or `display_name` field.

## Public data and CORS

`getProfile(userId)` reads the minimal public profile without sending a Bearer token. Public profile data contains `user_id`, `username`, the user-authored `motto`, and optional versioned public `avatar_url`; search data remains limited to `user_id`, `username`, and optional avatar URL. Neither response exposes attachment IDs, email, login methods, sessions, or security data. Authenticated API calls require an outer token whose `aud` includes `linkit.ntnl.io`; Bearer CORS never enables credentials. The `LinkitUserInfo` direct-message action opens a protected Linkit conversation through `openDirectConversation(username)` and navigates a new Linkit window using only the returned conversation ID—no token is added to the URL.

## Styles and dependencies

Import `linkit-react-components/styles.css`. That stylesheet includes the App Header, UserInfo, and UserPicker form/listbox states. The package uses public Base UI primitives and shadcn-style semantic slots, rather than importing a consumer application's private `@/components/ui` files. Peer dependencies are React, React DOM, `@base-ui/react`, `lucide-react`, and `auth-mini-react-components`.

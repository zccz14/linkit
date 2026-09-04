# Linkit React Components

`linkit-react-components` provides small, reusable Linkit identity and profile controls for React applications. Every component must be rendered below `AuthMiniProvider → LinkitProvider`; the package reuses the outer Auth Mini session and never owns login callbacks, token refresh, passwords, cookies, or token audiences.

```tsx
<AuthMiniProvider
  authMiniBaseUrl="https://auth.ntnl.io"
  audiences={["app.example.com", "linkit.ntnl.io"]}
  autoRedirectToLogin={false}
>
  <LinkitProvider linkitBaseUrl="https://linkit.ntnl.io">
    <LinkitAppHeaderUser lang="zh-CN" />
  </LinkitProvider>
</AuthMiniProvider>
```

## API

- `LinkitProvider` supplies authenticated Linkit requests, identity/profile methods, uploads, message/conversation reads and writes, member-authorized event subscriptions, and attachment downloads. It owns Auth Mini bearer use and the single refresh retry; consuming applications never receive or persist a token.
- `useLinkit` reads that provider context.
- `LinkitAvatar` renders a fixed-size profile avatar from its public, versioned `avatar_url` through a native `<img src>`; the browser reuses that URL through its normal HTTP cache, and a same-size initial fallback appears if the image fails.
- `LinkitUserDisplay` renders a profile `username`; when the profile is unavailable it renders the localized unknown-user label and the complete source `user_id`.
- `LinkitConversationDisplay` renders a group or direct conversation identity.
- `LinkitAppHeaderUser` renders an application-header account trigger and Base UI dialog for username, motto, avatar upload, UID copy, passkey registration, sign-in-method settings, and sign out.
- `LinkitUserPicker` searches username prefixes and UUID-character `user_id` prefixes, then writes the chosen `user_id` in controlled or uncontrolled form usage.
- `LinkitUserInfo` is an inline avatar, username, and complete `user_id` display. Its Base UI popover opens by click, keyboard, or desktop hover and presents the available profile motto plus a real Linkit direct-message action. Pass a prefetched `profile` for dense tables; otherwise the component fetches the public profile only after its popover opens.
- `LinkitEmbeddedConversation` mounts a complete member-authorized direct or group conversation for a specific `conversationId`: it loads history, supports earlier-message paging, receives new message events with a bounded polling fallback, renders attachments, and includes file upload, urgent-message and accessible message-compose controls. The component never accepts a token, user ID, or membership flag from its consumer.

## Embedded conversation

Use `LinkitEmbeddedConversation` when an authenticated host application needs to place one specific Linkit conversation directly in a task surface. The current Auth Mini session is used by `LinkitProvider`; server membership checks remain authoritative for both direct and group chats. A nonexistent or inaccessible conversation renders a localized unavailable state and does not expose any message data.

```tsx
<LinkitEmbeddedConversation
  conversationId="0d6d2b49-1d1f-4b92-ae53-47f0a7c2b613"
  lang="zh-CN"
/>
```

The component supports message history, earlier-message paging, event-driven updates with a five-second authenticated cursor fallback, file attachments, urgent messages, Enter-to-send, Shift+Enter line breaks, loading, empty, error, retry, and mobile layout states. It calls Linkit APIs only through the provider; do not proxy membership or send access tokens through component props. Import `linkit-react-components/styles.css` as usual.

## Username and profile semantics

A Linkit username is the sole human-readable user identity. Linkit trims it before persistence, keeps SQLite `NOCASE` uniqueness semantics, permits Unicode and punctuation, and rejects empty, control-character, and over-80-character values. Consumers must render it as text and URL-encode it when it appears in a path or query.

`LinkitProfile` contains `user_id`, `username`, optional `avatar_url`, optional `motto`, optional `avatar_attachment_id`, and optional `updated_at`. There is no nickname or `display_name` field.

## Public data and CORS

`getProfile(userId)` reads the minimal public profile without sending a Bearer token. Public profile data contains `user_id`, `username`, the user-authored `motto`, and optional versioned public `avatar_url`; search data remains limited to `user_id`, `username`, and optional avatar URL. Neither response exposes attachment IDs, email, login methods, sessions, or security data. Authenticated API calls require an outer token whose `aud` includes `linkit.ntnl.io`; Bearer CORS never enables credentials. The `LinkitUserInfo` direct-message action opens a protected Linkit conversation through `openDirectConversation(username)` and navigates a new Linkit window using only the returned conversation ID—no token is added to the URL.

## Styles and dependencies

Import `linkit-react-components/styles.css`. That stylesheet includes the App Header, UserInfo, and UserPicker form/listbox states. The package uses public Base UI primitives and shadcn-style semantic slots, rather than importing a consumer application's private `@/components/ui` files. Peer dependencies are React, React DOM, `@base-ui/react`, `lucide-react`, and `auth-mini-react-components`.

### Portal layering contract

`LinkitUserInfo` renders its Base UI popover through `PopoverPrimitive.Portal` so it can escape local overflow clipping. The consuming application owns the document-level stacking context: apply `isolation: isolate` to the React mount root that calls `createRoot` (for the standard Vite mount, `#root`). Keep the application layer scale coherent—for example, ordinary content < popovers/menus < sticky UI < modal backdrop < dialog < toast.

```css
#root {
  isolation: isolate;
}
```

The package deliberately does **not** target `#root`, `body`, `html`, `:root`, or any host application root. It also deliberately assigns no elevated `z-index` to `.linkit-user-info__popup`, so consumer dialogs, sheets, and toast layers remain authoritative.

## User picker selection modes

`LinkitUserPicker` owns the authenticated Linkit lookup UI: it keeps the 180ms debounce, cancels obsolete searches, accepts username and UUID-character prefixes, and returns at most the results enforced by Linkit. Consumers must not recreate that search UI locally.

Single selection is retained as the compatibility surface for existing Linkit, 1Exchange, and OpenAI-LB consumers. It supports controlled `value` or legacy uncontrolled `defaultValue`, with `onValueChange(userId, user)`. The owner is Linkit React Components; removal requires consumer migration, a major-version plan, package regression tests, and consumer builds.

```tsx
<LinkitUserPicker
  name="investor_id"
  value={investorId}
  onValueChange={(userId, user) => setInvestorId(userId)}
/>
```

Multi selection is controlled-first. Pass `multiple`, a `string[]` of selected Linkit user IDs, and `onValueChange`. The picker deduplicates IDs while preserving selection order; it displays readable username chips, supports individual removal, clear-all, and Backspace removal, and excludes already selected results. With `name`, it emits one hidden input per selected ID so normal form submission preserves the ordered values.

```tsx
<LinkitUserPicker
  multiple
  name="member_ids"
  value={memberIds}
  onValueChange={(userIds, users) => setMemberIds(userIds)}
  label="Members"
  lang="en"
/>
```

The `users` callback argument contains the selected search records known to the picker. Server APIs must accept and authorize IDs independently: clients cannot treat picker output as permission to add a user, and selected chips intentionally do not expose raw IDs as ordinary visual identity.

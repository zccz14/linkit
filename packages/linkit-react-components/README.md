# Linkit React Components

`linkit-react-components` provides small, reusable Linkit identity and profile controls for React applications. Every component must be rendered below `AuthMiniProvider → LinkitProvider`; the package reuses the outer Auth Mini session and never owns login callbacks, token refresh, passwords, cookies, or token audiences.

```tsx
<AuthMiniProvider
  authMiniBaseUrl="https://auth.ntnl.io"
  audiences={["app.example.com", "linkit.ntnl.io"]}
  autoRedirectToLogin={false}
>
  <LinkitProvider lang="zh-CN" linkitBaseUrl="https://linkit.ntnl.io">
    <LinkitMyInfo />
  </LinkitProvider>
</AuthMiniProvider>
```

## API

- `LinkitProvider` supplies authenticated Linkit requests, identity/profile methods, uploads, message/conversation reads and writes, member-authorized event subscriptions, and attachment downloads. It owns Auth Mini bearer use, the single refresh retry, the one shared Linkit event stream, and the debounced in-memory batch cache used by `LinkitUserInfo`; consuming applications never receive or persist a token. It also publishes the signed-in viewer's language preference through `useLinkit()`: `languages` is the stored priority list and `lang` is the effective copy language (see [Language preference](#language-preference)).
- `useLinkit` reads that provider context.
- `LinkitAvatar` renders a fixed-size profile avatar from its public, versioned `avatar_url` through a native `<img src>`; the browser reuses that URL through its normal HTTP cache, and a same-size initial fallback appears if the image fails.
- `LinkitUserDisplay` renders a profile `username`; when the profile is unavailable it renders the localized unknown-user label and the complete source `user_id`.
- `LinkitConversationDisplay` renders a group or direct conversation identity.
- `LinkitMyInfo` renders the package-owned application-header account trigger, Linkit inbox action with unread-message badge, and Base UI dialog for username, intro, language preference, avatar upload, UID copy, passkey registration, sign-in-method settings, and sign out. It accepts no props: language, profile state, unread count, navigation, save, and sign-out behavior are owned by `LinkitProvider` and available through `useLinkit`. The unread badge follows the provider's event stream and dedicated unread endpoint; the component itself performs no polling.
- `LinkitUserPicker` searches username prefixes and UUID-character `user_id` prefixes, then writes the chosen `user_id` in controlled or uncontrolled form usage.
- `LinkitUserInfo` accepts only `userId` and optional `compact`. Its inline avatar, username, complete `user_id`, localized fixed copy, cached public profile lookup, private note, and Linkit direct-message action are owned by `LinkitProvider`. Multiple uncached IDs are deduplicated and fetched through debounced profile and private-note batches; a direct-message action always opens the corresponding Linkit conversation in a new window. A private note belongs only to the authenticated viewer, overrides the inline display name, remains available when the target has not initialized a Linkit profile, and is never included in public profile data.
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

## Events and unread state

While the outer Auth Mini session is authenticated, `LinkitProvider` keeps exactly one `GET /api/events` SSE connection per page and fans its events out to `subscribeToEvents(listener)` consumers. The stream carries three event kinds: `message` (a conversation message, also used by `subscribeToConversationMessages` and `LinkitEmbeddedConversation`), `unread` (the viewer's authoritative total unread count), and `refresh` (conversation list metadata such as group rename, deletion, or membership changes). The provider reconnects with bounded backoff, and it reconciles the unread total through `GET /api/unread-count` after every (re)connect and whenever the page becomes visible again; between reconciliations it trusts the last confirmed count or the latest `unread` event. Consumers therefore never poll `GET /api/conversations` to keep a badge current.

## Username and profile semantics

A Linkit username is the sole human-readable user identity. Linkit trims it before persistence, keeps SQLite `NOCASE` uniqueness semantics, permits Unicode and punctuation, and rejects empty, control-character, and over-80-character values. Consumers must render it as text and URL-encode it when it appears in a path or query.

`LinkitProfile` contains `user_id`, `username`, optional `avatar_url`, optional `intro`, optional `lang`, optional `avatar_attachment_id`, and optional `updated_at`. There is no nickname or `display_name` field. `lang` is a comma-separated language priority list such as `zh-CN,en-US`; an empty string means the viewer has not set a preference. It is private personalization: only the authenticated profile (`GET /api/me`, `PUT /api/profile`) carries it, and public profile data never includes it.

`LinkitUserNote` contains the target `user_id`, the viewer-owned `name`, and `updated_at`. It is read and written only by `LinkitProvider`'s authenticated user-info flow; applications must not proxy or persist another user's note data.

## Language preference

The signed-in Linkit profile owns the language preference, so applications that embed the package do not need to render their own language switch. `LinkitMyInfo` edits the preference inside the profile dialog (automatic / 中文 / English) and saves it with the rest of the profile through `PUT /api/profile`.

- `useLinkit().languages` is the stored priority list, already split and trimmed, for example `["zh-CN", "en-US"]`; it is empty when the viewer is signed out or has not set a preference.
- `useLinkit().lang` is the effective copy language of the Linkit components themselves. A stored preference that starts with `zh` or `en` wins over the `lang` prop; otherwise the prop stays the fallback.

Consuming applications should react to `languages` and negotiate their own locale from it instead of rendering a separate language switch:

```tsx
const { languages } = useLinkit();
useEffect(() => {
  const next = negotiate(languages, supportedLocales); // undefined keeps the current locale
  if (next) setLocale(next);
}, [languages]);
```

Saves that omit `lang` keep the stored preference (older package versions do not send it); an explicit empty string clears it back to automatic. Once every consumer depends on `>=0.4.0`, the server can make `lang` a required field.

## Public data and CORS

`getProfile(userId)` reads the minimal public profile without sending a Bearer token. `LinkitUserInfo` uses `POST /api/public/profiles/batch` internally for debounced batches of up to 100 IDs; missing profiles are represented by their absence from the returned list and cached as unavailable. Public profile data contains `user_id`, `username`, the user-authored `intro`, and optional versioned public `avatar_url`; search data remains limited to `user_id`, `username`, and optional avatar URL. Neither response exposes attachment IDs, email, login methods, sessions, or security data. Authenticated API calls require an outer token whose `aud` includes `linkit.ntnl.io`; every Linkit route—public, authenticated, or unmatched—answers `Access-Control-Allow-Origin: *`, and CORS never enables credentials. The `LinkitUserInfo` direct-message action opens a protected Linkit conversation through `openDirectConversation(username)` and navigates a new Linkit window using only the returned conversation ID—no token is added to the URL.

When the outer Auth Mini session is authenticated, `LinkitUserInfo` separately batches its private notes through `POST /api/user-notes/batch`, then saves or deletes a note through the corresponding `/api/user-notes/{user_id}` route. The server derives the note owner exclusively from that Bearer identity; neither the SDK nor the API accepts an owner ID, and the target ID does not need a Linkit profile or local Linkit user row.

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

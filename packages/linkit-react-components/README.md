# linkit-react-components

Authenticated Linkit provider and compact React display primitives.

`LinkitProvider` must be nested inside `AuthMiniProvider`; it reuses the Auth Mini Browser SDK session and refresh flow rather than owning login.

```tsx
<AuthMiniProvider authMiniBaseUrl="https://auth.example.com" autoRedirectToLogin>
  <LinkitProvider linkitBaseUrl="https://linkit.example.com">
    <App />
  </LinkitProvider>
</AuthMiniProvider>
```

```tsx
const { getProfile, request } = useLinkit();
<LinkitUserDisplay profile={profile} showUsername />
<LinkitConversationDisplay conversation={conversation} />
```

The provider only accepts relative Linkit API paths, so an Auth Mini bearer token cannot be sent to an arbitrary caller-supplied origin.

## Cross-app bearer access

`LinkitProvider` uses bearer tokens from the enclosing Auth Mini session. Linkit accepts configured trusted Auth Mini consumer audiences, including `1ex.ntnl.io` in the default shared-profile deployment. Requests use CORS without cookies or `Access-Control-Allow-Credentials`; an Auth Mini issuer and an allowed audience are both still required.

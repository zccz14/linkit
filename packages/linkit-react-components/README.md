# linkit-react-components

`linkit-react-components` 为需要显示 Linkit 用户和会话信息的 React 应用提供轻量组件与认证请求上下文。它面向身份展示，不提供完整即时通讯界面，也不管理 Auth Mini 登录流程。

## 依赖关系

`LinkitProvider` 必须嵌套在 `AuthMiniProvider` 内。它复用外层 Auth Mini Browser SDK 的 access token 和 refresh 流程：包本身不创建登录跳转、不处理 callback，也不会自行扩大 token 的 audience。

```tsx
import { AuthMiniProvider } from "auth-mini-react-components";
import {
  LinkitProvider,
  LinkitAppHeaderUser,
  LinkitUserDisplay,
  useLinkit,
} from "linkit-react-components";
import "linkit-react-components/styles.css";

function CurrentUser() {
  const { getMe } = useLinkit();
  // 在应用自己的数据层中调用 getMe()，并缓存结果。
  return null;
}

export function App() {
  return (
    <AuthMiniProvider
      authMiniBaseUrl="https://auth.ntnl.io"
      audiences={["app.example.com", "linkit.ntnl.io"]}
      autoRedirectToLogin
    >
      <LinkitProvider linkitBaseUrl="https://linkit.ntnl.io">
        <header>
          <LinkitAppHeaderUser lang="zh-CN" />
        </header>
        <CurrentUser />
      </LinkitProvider>
    </AuthMiniProvider>
  );
}
```

`audiences` 的具体可用性由已安装的 `auth-mini-react-components` 版本决定。跨应用使用 Linkit 时，外层 Auth Mini token 的 `aud` 必须包含 `linkit.ntnl.io`；同时必须保留当前应用 callback hostname 的 audience。

## 公开 API

### `LinkitProvider`

为子树提供 Linkit API 上下文。

```tsx
<LinkitProvider linkitBaseUrl="https://linkit.ntnl.io">
  <App />
</LinkitProvider>
```

| 属性 | 说明 |
| --- | --- |
| `linkitBaseUrl` | Linkit 的 HTTP(S) 基础地址，例如 `https://linkit.ntnl.io`。 |
| `children` | 需要访问 Linkit context 的 React 子树。 |

Provider 只接受相对 API path，例如 `/api/me`。这避免调用方把 Auth Mini Bearer token 发送到任意第三方 URL。

### `useLinkit()`

读取 Provider 提供的认证 Linkit 请求能力。

```tsx
function ProfileButton() {
  const { getMe, getProfile, updateProfile, upload, request } = useLinkit();

  async function load() {
    const me = await getMe();
    const profile = await getProfile(me.id);
    const data = await request<{ ok: boolean }>("/api/example");
    return { me, profile, data, updateProfile, upload };
  }

  return <button onClick={() => void load()}>读取 Linkit 资料</button>;
}
```

返回值：

| 字段 | 说明 |
| --- | --- |
| `linkitBaseUrl` | 已规范化的 Linkit 基础地址。 |
| `request(path, init?)` | 对相对 Linkit API path 发起 Bearer 请求。遇到一次 `401` 时复用外层 Auth Mini SDK refresh 后重试一次。 |
| `getMe()` | 请求当前 Linkit 用户的 `/api/me`。 |
| `getProfile(userId)` | 请求指定用户的公开 Linkit profile。 |
| `updateProfile(profile)` | 使用当前用户的 Linkit Profile API 保存 username、display name、motto 和已上传头像 ID。 |
| `upload(file)` | 上传当前用户拥有的附件，供 Profile 头像保存时引用。 |

对于密集表格，应优先使用业务后端已批量提供的 profile map，而不是让每一行调用 `getProfile()`，以避免 N+1 浏览器请求。

### `LinkitAppHeaderUser`

用于应用顶部栏的完整登录状态与个人资料入口。它**必须**放在 `AuthMiniProvider → LinkitProvider` 之下；未登录时调用外层 `AuthMiniProvider` 的既有登录流程，绝不接触密码、cookie、refresh token 或 audience 配置。

```tsx
import { LinkitAppHeaderUser } from "linkit-react-components";
import "linkit-react-components/styles.css";

<header className="app-header">
  <LinkitAppHeaderUser
    lang="zh-CN"
    className="app-header-user"
    securitySettingsTarget="_blank"
  />
</header>
```

已登录时，组件显示头像与昵称；激活后以原生无障碍 `dialog` 打开资料编辑器，支持：

- 上传头像、编辑用户名、昵称与格言；保存使用 Linkit 的 `/api/attachments` 与 `/api/profile`，并显示 loading、错误、成功与未保存状态；
- 显示完整 UID，提供复制按钮；clipboard 不可用或失败时给出可见、可朗读的手动复制提示；
- 在同一资料弹窗内组合 `AuthMiniButton`，复用 Auth Mini 已发布的通行密钥注册与登录方式管理 UI；不复制认证安全逻辑；
- 调用外层 `signOut()` 登出，登出后回到可点击的登录按钮。

| 属性 | 说明 |
| --- | --- |
| `lang` | `zh` / `zh-CN` 使用中文，其它值使用英文。默认 `en`。 |
| `className` | 应用 header trigger 的样式类。 |
| `loginLabel` | 未登录按钮的可选文案。 |
| `labels` | 局部覆盖中英文可见文案。 |
| `securitySettingsUrl` / `securitySettingsTarget` | 透传给复用的 `AuthMiniButton` 安全入口。 |
| `onProfileSaved` / `onSignedOut` | 保存或登出完成后的可选通知回调。 |

`styles.css` 是该组件必要样式，包含 44px 触控目标、焦点环、窄屏重排和减少动态效果的处理。原生 dialog 负责 Escape、焦点陷阱和关闭后的焦点恢复。

### `LinkitAvatar`

显示 Linkit profile 头像；没有头像时显示 display name 或 `fallback` 的首字符。

```tsx
<LinkitAvatar profile={profile} size="sm" fallback="未知用户" />
```

| 属性 | 说明 |
| --- | --- |
| `profile` | 含 `display_name`、可选 `avatar_url` 的 Linkit profile。 |
| `size` | `sm`、`md` 或 `lg`。 |
| `fallback` | profile 不可用时用于头像首字符和无障碍标签的文本。 |

### `LinkitUserDisplay`

在表格、审计记录、账户菜单和详情页中显示用户身份。

```tsx
<LinkitUserDisplay
  profile={profile}
  userId={investment.user_id}
  compact
  showUsername
  unknownLabel="未知用户"
/>
```

| 属性 | 说明 |
| --- | --- |
| `profile` | 已获得的 Linkit profile；可为 `null` 或 `undefined`。 |
| `userId` | 原始 Auth Mini / Linkit 用户 ID。profile 不可用时必须传入，以便提供可追溯 fallback。 |
| `compact` | 使用更小头像和更紧凑间距，适合表格单元格。 |
| `showUsername` | 正常 profile 存在时显示 `@username`。 |
| `unknownLabel` | profile 不可用时的本地化主文案；默认 `Unknown user`，中文应用可传入 `未知用户`。 |

正常 profile 存在时，组件显示头像、display name 和可选 username。

profile 缺失、删除、无权限或请求失败时，组件显示：

```text
未知用户
<完整 user_id>
```

英文环境对应为：

```text
Unknown user
<full user_id>
```

user ID 使用次级等宽文本、完整值 `title` 属性和原生文本选择能力，便于复制与审计；它不会替代主身份文案，也不会在有效 profile 存在时重复显示。

### `LinkitConversationDisplay`

显示 Linkit 直接会话或群聊身份。

```tsx
<LinkitConversationDisplay conversation={conversation} compact />
```

- 群聊显示群聊 title、群头像或 `#` fallback；
- 直接会话显示对方 profile 的头像和 display name；
- 非紧凑群聊额外显示 `Group` 次级说明。

## 数据类型

```ts
type LinkitProfile = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  motto?: string | null;
  avatar_attachment_id?: string | null;
  updated_at?: number;
};

type LinkitConversation = {
  id: string;
  kind: "direct" | "group";
  title?: string | null;
  avatar_url?: string | null;
  counterpart?: LinkitProfile | null;
};

type LinkitMe = {
  id: string;
  root: boolean;
  profile?: LinkitProfile | null;
};
```

## 跨域与安全边界

在不同 Origin 的应用中使用 Linkit API，需要同时满足：

1. Linkit 部署允许无 cookie 的 Bearer CORS preflight；
2. 浏览器请求携带来自外层 `AuthMiniProvider` 的 access token；
3. token `aud` 包含 `linkit.ntnl.io`；
4. Linkit 仍验证 issuer、签名、过期时间、token 类型和 audience membership。

CORS 只允许浏览器发起请求，不授予资源访问权限。Linkit 不应启用 `Access-Control-Allow-Credentials`，本包也不使用 cookie 身份。

## 安装

```bash
npm install linkit-react-components auth-mini-react-components
```

`react` 与 `react-dom` 为 peer dependencies。

## 组件范围

本包只负责认证 Linkit 数据访问、紧凑身份/会话展示，以及可复用的 header 用户资料入口。消息列表、编辑器、通知设置、群组管理和业务域对象仍应由消费应用自行实现。

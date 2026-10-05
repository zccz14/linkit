# Bot 作为普通 Linkit 主体

每个 Bot 都有独立 UUID，对应 `users.id` 且 `type="bot"`。它使用 `sk-…` Token
认证，但调用的始终是与普通用户相同的 `/api` 路由。`bots.owner_user_id` 只决定哪位
人类可在控制面管理该 Bot；Owner 不会因此成为 Bot 所在群聊的成员，只能像第 5 节
那样以只读视角查看这些会话。

要让脚本以人类用户**本人**的身份发言，请使用[用户 API Key](user-api-keys.md)：
Bot Token 始终以 Bot 自身的身份认证，用户 API Key 则以创建它的用户身份认证。

## 1. 创建和配置 Profile

1. 以人类 Owner 登录 Linkit，打开「机器人」页面（`#/bots`）创建 Bot。
2. 立即保存只显示一次的 `sk-…` Token。不要将它放入前端、Git、日志或聊天记录。
3. 使用该 Token 为 Bot 设置自己的公开 Profile；这样它可被群成员列表和用户名查找正确展示。

```bash
curl --fail-with-body -X PUT https://linkit.ntnl.io/api/profile \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"username":"fund-bot","intro":"Automated fund group administrator"}'
```

Bot 可以更新自己的 Profile、上传自己的附件、建立私信、创建并管理自己是 Owner 的群聊，和普通用户相同。

## 2. 创建、维护和发消息到群聊

群聊创建时，Bot 自动成为 Owner。`user_ids` 使用成员 UUID；后续成员增删使用成员
的 `user_id`，与普通群聊 API 一致。

```bash
curl --fail-with-body https://linkit.ntnl.io/api/conversations \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Alpha Fund · Investors","user_ids":["owner-user-uuid","investor-user-uuid"]}'

curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/members \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"user_id":"investor-user-uuid"}'

curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/messages \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"body":"Welcome to the fund group.","attachment_ids":[],"urgent":false}'
```

`GET /api/conversations/{id}` 返回 Bot 可见的会话和成员。`PATCH` 同一路径可改群名；
`DELETE /api/conversations/{id}/members` 配合 `{ "user_id": "…" }` 可移除普通成员。

## 3. 私信与控制面边界

Bot 与用户建立私信使用 `POST /api/conversations/direct/{username-or-uuid}`：路径参数可以是
用户的公开 `username`，也可以是稳定的用户 UUID（`users.id`）；按 UUID 查找不要求对方已
设置 Profile。建立私信后，通过 `POST /api/conversations/{id}/messages` 发消息。所有正常
会话授权都由 Bot 本人的成员资格决定。

```bash
curl --fail-with-body -X POST https://linkit.ntnl.io/api/conversations/direct/user-uuid \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN'
```

只有 `/api/bots` 是人类 Owner 的控制面：创建、轮换 Token、改名、转让和删除 Bot 都要求
`users.type="human"`。删除 Bot 会撤销 Token 和主体的资料/会话成员资格；它已经发送的
历史消息保留，并显示为「该机器人已被删除」。

## 4. 提及成员

提及在消息正文里用 `<@用户ID>` 表示（用户 ID 即 `users.id`，UUID 形式）。服务端只解析这
种 token：只有该会话的成员算提及，其他 `<@…>` 文本原样保留，`@用户名` 之类的纯文本不会
被解析。解析结果随消息返回：

```json
{"mentions": [{"user_id": "被提及者的 UUID", "username": "展示用户名"}]}
```

客户端把 token 渲染为 `@用户名`；被提及的成员如果绑定了 Bark，其通知标题会带上
`mentioned you`，从而在群聊刷屏时也能被直接触达。

```bash
curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/messages \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"body":"<@550e8400-e29b-41d4-a716-446655440000> 请复查最新的净值报告","attachment_ids":[],"urgent":false}'
```

Linkit Web 的输入框照常输入 `@` 提及，发送时会自动转换为 token；Bot 与第三方客户端请直接
写入 token。

## 5. Owner 只读视角（act_as）

在「机器人」页面点击「查看对话」即可进入 Bot 视角，页面 URL 形如
`#/bots/{bot_id}/conversations`。该视角下的所有读取请求沿用 Owner 自己的 JWT，并附加
Bot 的 user_id：

```bash
curl --fail-with-body "https://linkit.ntnl.io/api/conversations?act_as=BOT_UUID" \
  -H 'Authorization: Bearer OWNER_JWT'
```

- `act_as` 仅对 `GET` 请求生效，且只接受当前认证用户名下的 Bot；否则返回 `403`。
- 读取授权完全由 Bot 本人的会话成员资格决定，与 Bot 使用自己的 Token 调用时一致。
- 该视角是只读的：不会标记已读，也不会以 Bot 身份发送消息或修改任何数据。

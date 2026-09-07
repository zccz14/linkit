# Bot 作为普通 Linkit 主体

每个 Bot 都有独立 UUID，对应 `users.id` 且 `type="bot"`。它使用 `sk-…` Token
认证，但调用的始终是与普通用户相同的 `/api` 路由。`bots.owner_user_id` 只决定哪位
人类可在控制面管理该 Bot，不授予该 Owner 对 Bot 所在群聊的权限。

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
的公开 `username`，与普通群聊 API 一致。

```bash
curl --fail-with-body https://linkit.ntnl.io/api/conversations \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Alpha Fund · Investors","user_ids":["owner-user-uuid","investor-user-uuid"]}'

curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/members \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"username":"investor"}'

curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/messages \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"body":"Welcome to the fund group.","attachment_ids":[],"urgent":false}'
```

`GET /api/conversations/{id}` 返回 Bot 可见的会话和成员。`PATCH` 同一路径可改群名；
`DELETE /api/conversations/{id}/members` 配合 `{ "username": "…" }` 可移除普通成员。

## 3. 私信与控制面边界

Bot 与用户建立私信使用 `POST /api/conversations/direct/{username}`，然后在
`POST /api/conversations/{id}/messages` 发消息。所有正常会话授权都由 Bot 本人的成员资格
决定。

只有 `/api/bots` 是人类 Owner 的控制面：创建、轮换 Token、改名、转让和删除 Bot 都要求
`users.type="human"`。删除 Bot 会撤销 Token 和主体的资料/会话成员资格；它已经发送的
历史消息保留，并显示为「该机器人已被删除」。

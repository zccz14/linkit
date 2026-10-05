# 用户 API Key：以本人身份发言

每个用户 API Key 都是 `uk-…` 形式的 Token，认证为创建它的那个人类用户本人：
脚本和工具调用普通 `/api` 路由时，使用的就是该用户自己的 Profile、会话成员资格、
@ 提及、已读状态和通知。它是 [Bot Token](bot-direct-messages.md) 的人类对应物——
Bot Token 以 Bot 的身份发言，用户 API Key 以你自己的身份发言。

## 1. 创建与保存

1. 登录 Linkit，打开「API 密钥」页面（`#/settings/api-keys`）。
2. 点击「新建 API Key」，为将使用它的脚本或机器起个名字，然后立即保存只显示一次的
   `uk-…` Token。不要将它放入前端、Git、日志或聊天记录。
3. 不再使用时在同一页面「撤销」。撤销立即生效：撤销后的下一次请求返回 `401`。

用户 API Key 的控制面是人类专用：Bot Token 调用 `/api/user-api-keys` 会得到
`403`；Key 永远解析为其创建者本人，无法认证为其他主体。

## 2. 以本人身份发言

用与 Web 界面相同、普通用户使用的消息路由发送即可：

```bash
curl --fail-with-body https://linkit.ntnl.io/api/conversations/CONVERSATION_ID/messages \
  -H 'Authorization: Bearer uk-REPLACE_WITH_YOUR_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"body":"状态报告：由脚本自动发送。","attachment_ids":[],"urgent":false}'
```

消息与从 Web 界面发送完全一致：`sender_kind` 为 `user`、`sender_name` 为你的用户名，
`<@user_id>` 提及、未读与 Bark 通知照常工作（提及与通知格式见 Bot 指南第 4 节）。

Key 可调用整个已认证 API 面（`/api/...`），例如读取自己的会话列表：

```bash
curl --fail-with-body https://linkit.ntnl.io/api/conversations \
  -H 'Authorization: Bearer uk-REPLACE_WITH_YOUR_KEY'
```

## 3. 管理 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/user-api-keys` | 列出本人的 Key：`id`、`name`、`token_prefix`、`created_at` |
| POST | `/api/user-api-keys` | 创建 Key，请求体 `{"name":"…"}`；响应是 `uk-…` Token 唯一一次出现的地方 |
| DELETE | `/api/user-api-keys/{id}` | 撤销本人的 Key；不属于自己的 Key 返回 `404` |

Key 仅以 SHA-256 哈希存储，Linkit 无法再次显示完整 Token。

## 4. 边界与轮换

- Key 携带其用户本人身份的完整权限，请像对待密码一样对待它：只保存在服务端脚本或
  密钥管理工具里。
- 轮换 = 先在「API 密钥」页面创建新 Key、替换脚本中使用的 Token，再撤销旧 Key。
- 撤销不可恢复；受影响的脚本在换成新 Key 之前会持续收到 `401`。

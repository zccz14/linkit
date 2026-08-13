# 使用 Bot 发送私信

Bot 使用 `sk-…` Token 调用 `POST /bot/v1/messages`。使用接收方的
`recipient_username` 可为任意已有 Linkit 用户自动创建私信会话并发送消息；同一
Bot 对同一用户名之后的发送会继续使用这个会话。

## 标识符

Linkit 用户资料有两个标识符：

| 标识符 | 示例 | 用途 |
| --- | --- | --- |
| `user_id` | `031a393d-8a0a-4ca0-8cb1-313e0d71dfa9` | Auth Mini subject，也是资料记录的所有者 ID。 |
| `username` | `alice` | 用户在 Linkit 中公开、唯一的名称，也是 Bot 私信 API 的接收方字段。 |

当前 Bot API 仅支持 `recipient_username`，不支持直接使用 `user_id` 发送私信，也没有按 `user_id`
反查用户名的公开 API。外部应用应在获得用户资料时同时保存 `username`，或请用户提供用户名。除非 UUID
本身就是用户名，不要将 `user_id` 填入 `recipient_username`。

## 1. 创建 Bot

1. 以 Bot Owner 登录 Linkit，打开「机器人」页面（`#/bots`）。
2. 选择「新建机器人」，填写名称并创建。
3. 立即复制生成的 `sk-…` Token。该完整 Token 只会在创建或轮换时显示；Bot
   列表只显示前缀。Bot UUID 可在「管理」窗口查看。

Token 等同于该 Bot 的发送权限。将它保存在密钥管理服务中，不要放入前端、
Git 仓库、日志或聊天记录。Owner 可在同一页面轮换 Token 或转让 Bot。

## 2. 通过用户名发送私信

下面的请求会让 Bot 向用户名为 `alice` 的用户发送一条私信。将地址、Token、用户名
和正文替换为实际值：

```bash
curl --fail-with-body https://linkit.ntnl.io/bot/v1/messages \
  -H 'Authorization: Bearer sk-REPLACE_WITH_THE_BOT_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "recipient_username": "alice",
    "body": "Hello from Linkit Bot"
  }'
```

成功时服务返回 HTTP 200 与消息对象。其中 `conversation_id` 是自动创建或复用的
私信会话，`sender_kind` 为 `"bot"`，`sender_id` 是 Bot UUID：

```json
{
  "id": "message-uuid",
  "conversation_id": "conversation-uuid",
  "sender_kind": "bot",
  "sender_id": "bot-uuid",
  "sender_name": "Support Bot",
  "body": "Hello from Linkit Bot",
  "created_at": 1780000000,
  "attachments": []
}
```

`body` 最多 10,000 个字符，且不能仅为空白。Bot 不能传入用户上传的
`attachment_ids`。

## 4. 与群聊发送的区别

私信与群聊只能指定一种接收方：

- 私信：传 `recipient_username`。Linkit 会自动创建或复用该 Bot 和该用户的私信会话。
- 群聊：传 `conversation_id`。Bot Owner 必须先在该群聊的管理界面将 Bot 加入群聊，
  否则服务返回 403。

同一个请求同时提供或同时遗漏 `conversation_id` 和 `recipient_username` 时，服务返回 HTTP 400。

## 常见响应

| HTTP 状态 | 含义 | 处理方式 |
| --- | --- | --- |
| 200 | 消息已创建。 | 保存 `id` 或 `conversation_id` 以便审计。 |
| 400 | 接收方字段不正确、正文为空或超过限制，或 Bot 传入了用户附件。 | 每次只提供一种接收方并按上述请求格式修正。 |
| 401 | Token 缺失、不是 `Bearer` 格式，或 Token 已失效。 | 使用当前 Owner 持有的 Bot Token。 |
| 403 | Bot 未加入指定的群聊。 | 由 Bot Owner 先将 Bot 加入该群。 |
| 404 | `recipient_username` 不存在。 | 确认该用户已存在于 Linkit。 |

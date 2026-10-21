# 公开 Profile API

`GET /api/public/profiles/{user_id}` 按用户 ID 返回最小公开身份资料，人类用户与机器人都适用：

```json
{
  "user_id": "...",
  "username": "alice",
  "intro": "...",
  "avatar_url": "https://linkit.ntnl.io/api/public/profiles/.../avatar?v=..."
}
```

`avatar_url` 仅指向公开头像端点，使用 Profile 更新时间作为缓存版本；不会公开附件 ID、登录方式、会话或安全数据。

尚未创建 Profile 的 Bot 使用其控制面身份：`username` 是机器人名称，`intro` 为空，
`avatar_url` 来自 Owner 在「机器人」页面设置的头像。Bot 创建自己的 Profile 后，以
Profile 的用户名、简介和头像为准；Profile 未设置头像时才回落到控制面头像。

`POST /api/public/profiles/batch` 接受最多 100 个去重后的用户 ID，并返回存在的资料列表：

```json
{"user_ids":["...", "..."]}
```

缺失的用户资料不会出现在返回列表中。该端点与单条查询一样是公开跨域 API，不接受或使用 Bearer token。

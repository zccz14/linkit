# 公开 Profile API

`GET /api/public/profiles/{user_id}` 返回最小公开身份资料：

```json
{
  "user_id": "...",
  "username": "alice",
  "motto": "...",
  "avatar_url": "https://linkit.ntnl.io/api/public/profiles/.../avatar?v=..."
}
```

`avatar_url` 仅指向公开头像端点，使用 Profile 更新时间作为缓存版本；不会公开附件 ID、登录方式、会话或安全数据。

`POST /api/public/profiles/batch` 接受最多 100 个去重后的用户 ID，并返回存在的资料列表：

```json
{"user_ids":["...", "..."]}
```

缺失的用户资料不会出现在返回列表中。该端点与单条查询一样是公开跨域 API，不接受或使用 Bearer token。

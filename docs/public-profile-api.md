# 公开 Profile API

`GET /api/public/profiles/{user_id}` 返回最小公开身份资料：

```json
{
  "user_id": "...",
  "username": "alice",
  "avatar_url": "https://linkit.ntnl.io/api/public/profiles/.../avatar?v=..."
}
```

`avatar_url` 仅指向公开头像端点，使用 Profile 更新时间作为缓存版本；不会公开附件 ID、motto、登录方式、会话或安全数据。

# 用户搜索 API

`GET /api/users/search?query=<username-prefix>` 只在已认证 Bearer API 中可用。

- `query` 使用 Rust Unicode `trim` 去除首尾空白；空值返回 `[]`，不会列出用户。
- 搜索只匹配 `username` 的大小写不敏感前缀，最多返回 5 条。
- 每条结果仅包含 `user_id`、`username` 和可选的公开 `avatar_url`；不包含 motto、附件 ID、登录方式、会话或安全数据。
- `%`、`_`、`\` 会作为普通字符转义；请求方必须使用 URL 查询编码。

# 用户选择搜索 API

`GET /api/users/search?query=<prefix>` 为已认证的 Linkit 客户端提供用户选择 typeahead。

- 仅通过现有 Bearer middleware、issuer 和受信 Auth Mini audience 校验后可调用；
- `query` 会去除首尾空白，按 `username` 或 `display_name` 的大小写不敏感前缀检索；空白值返回 `[]`，不会列出用户；
- 结果最多 5 个，仅包含 `user_id`、`username`、`display_name` 与可选公开 `avatar_url`；不包含 email、motto、附件 ID、登录方式、会话或安全数据；
- username 已有 `UNIQUE COLLATE NOCASE` 索引；display name 增加相同 collation 的索引，匹配 typeahead 的有界查询计划。

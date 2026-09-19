# 用户搜索 API

`GET /api/users/search?query=<username-or-uuid-prefix>` 只在已认证 Bearer API 中可用。

- 仅通过现有 Bearer middleware、issuer 和受信 Auth Mini audience 校验后可调用；
- `query` 使用 Rust Unicode `trim` 去除首尾空白。空值返回 `[]`，不会列出用户；
- 正常输入按 `username` 大小写不敏感前缀检索。当且仅当输入完全由 ASCII `0-9`、`a-f`、`A-F` 与连字符组成时，也按 `user_id` 大小写不敏感前缀检索；
- username 与 UUID 字符集 user_id 的结果会合并、稳定排序、按 `user_id` 去重，最多返回 5 条。仅含 UUID 字符的合法 username 仍参与 username 检索；包含其他字符的 ID-like 输入不会触发 user_id 查询；
- 每条结果仅包含 `user_id`、`username` 和可选的公开 `avatar_url`；不包含 email、intro、附件 ID、登录方式、会话或安全数据；
- username 前缀继续使用 `UNIQUE COLLATE NOCASE` 索引。UUID 字符集仅包含不会成为 `LIKE` 通配符的字符，user_id 前缀路径使用 `users_id_nocase` 索引并左连接个人资料，保持有界、可解释的 typeahead 查询计划；
- `%`、`_`、`\\` 会在 username 查询中作为普通字符转义；请求方必须使用 URL 查询编码。

## 静默注册的用户

真人用户通过有效 JWT 调用受保护接口，或通过 [用户 ID 同步](auth-mini-user-sync.md)
被发现时，后端会自动补齐账户与 profile。默认用户名形如 `user_7a28d10f93ac`，
用户随后可以修改；自动生成时若重名，会依次追加 `_2`、`_3` 等后缀。
这些用户可直接通过用户名和 UUID 前缀搜索，无需先填写资料。

若某个条目仍未设置 profile（例如 Bot），搜索结果的 `username` 使用 UUID，
`avatar_url` 为 null。该显示值不会创建个人资料，也不会占用对应用户名。
添加群成员等操作应使用 `user_id`。

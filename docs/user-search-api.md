# 用户搜索 API

`GET /api/users/search?query=<username-user-id-or-note-fragment>` 只在已认证 Bearer API 中可用。

- 仅通过现有 Bearer middleware、issuer 和受信 Auth Mini audience 校验后可调用；
- `query` 使用 Rust Unicode `trim` 去除首尾空白。空值返回 `[]`，不会列出用户；
- 正常输入对 `username` 与调用者自己的私有备注名做大小写不敏感的子串（fuzzy）检索。当且仅当输入完全由 ASCII `0-9`、`a-f`、`A-F` 与连字符组成时，也对 `user_id` 做大小写不敏感子串检索；
- 备注保持私有：每个调用者只能通过自己写入的备注名检索到目标用户，且目标必须仍是 Linkit 已知用户（存在于 `users`）；
- 三类结果会合并、按 `user_id` 去重，最多返回 5 条。排序为：`user_id` 全量匹配、`username` 全量匹配、`username` 前缀匹配，然后才是其余模糊匹配（来源次序为 username、备注、user_id，同来源按 username 排序）；
- 每条结果仅包含 `user_id`、`username` 和可选的公开 `avatar_url`；不包含 email、intro、备注名、附件 ID、登录方式、会话或安全数据；
- 子串匹配无法沿用前缀索引：查询计划改为扫描 `profiles`、`users`（仅 UUID 字符集输入）和调用者的 `user_notes`，输出条数仍固定上限 5 条、`query` 长度上限 80 字符；
- `%`、`_`、`\` 会在 username 与备注查询中作为普通字符转义；请求方必须使用 URL 查询编码。

## 静默注册的用户

真人用户通过有效 JWT 调用受保护接口，或通过 [用户 ID 同步](auth-mini-user-sync.md)
被发现时，后端会自动补齐账户与 profile。默认用户名形如 `user_7a28d10f93ac`，
用户随后可以修改；自动生成时若重名，会依次追加 `_2`、`_3` 等后缀。
这些用户可直接通过用户名、UUID 片段或备注搜索，无需先填写资料。

若某个条目仍未设置 profile（例如 Bot），搜索结果的 `username` 使用 UUID，
`avatar_url` 为 null。该显示值不会创建个人资料，也不会占用对应用户名。
添加群成员、发起私信等操作应使用 `user_id`。

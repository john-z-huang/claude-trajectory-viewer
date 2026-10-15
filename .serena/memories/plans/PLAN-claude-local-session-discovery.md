# Claude 本机会话自动发现计划

- 仓库：`/Users/johannyellow/codebase/claude-code-jsonl-viewer`。
- 完整需求、调查依据、实现顺序、接口建议、数据边界、合成数据验收和 Agent 阅读地图见：`/Users/johannyellow/codebase/claude-code-jsonl-viewer/docs/claude-local-session-discovery.md`。开始后续实现前先读该文档。
- 状态：实现已完成；合成测试 18/18、生产构建和 `git diff --check` 均通过。实现阶段没有用真实本机数据做自动化验证；本会话后来经用户授权，对 CSP `frame_messages.msg_json` 的 thinking 字段做了窄范围只读结构与计数核对，没有记录思考文本。真实安装环境的普遍兼容性仍未验证。

## 实施核验摘要（2026-10-15）
- 本地 Node 服务、四类来源发现、opaque ID API、分页记录和手动刷新已实现；会话 UI 移除 JSONL 上传/目录选择，独立 workflow JSON 入口保留。
- CSP SQLite 使用只读模式和五表/列 allowlist；跳过数据库符号链接；测试覆盖合成数据库哈希和外部链接目标未变化。
- `npm test` 18/18、`npm run build`、`git diff --check` 通过。
- 实现阶段的合成验证未读取真实本机会话、audit、CSP 行或 artifact；本会话后来另经用户授权检查了 CSP thinking 字段形状与计数，但未读取或记录其正文。真实数据格式的普遍兼容性仍需用户在本机启动后确认。

## 需求与决策
- 本地 Node 服务启动时自动发现 Claude Code、Claude-3p 和 CSP Claude Science 会话；提供手动刷新；会话流不保留 JSONL 上传或本机目录选择入口。独立 workflow JSON 视图保持现状。
- Claude Desktop Code（第三方登录模式）元数据通过 `cliSessionId` 关联 transcript JSONL；Claude Desktop Cowork（`local-agent-mode-sessions`）的 audit 作为补充记录，默认折叠高频 system 事件。
- CSP 查询项目、frames、frame messages 和 artifact 元数据；artifact 只显示元数据/路径。
- 规划 localhost API：来源状态、会话列表、opaque ID 详情、分页记录、手动刷新。请求不得传任意本地路径。

## 调查事实与边界
- 2026-10-15 本机文件名快照：`~/.claude/projects` 有 33 个 JSONL；Claude-3p `claude-code-sessions` 有 16 个 JSON 元数据文件，Cowork `local-agent-mode-sessions` 有 35 个 JSON、6 个普通 JSONL 和 6 个 `audit.jsonl`。较早规划记录中的 Claude-3p 数量为 14，后续清点更新为 16；所有计数都是瞬时观察，不是实现条件。
- Claude-3p 配置结构含 `inferenceGatewayApiKey` 字段；配置值、API key、其他凭据不得读取、复制或写入文档/日志。不得读 `.audit-key` 或验证 HMAC。
- CSP DB 模式：`~/.csp/sandbox/home/.claude-science/orgs/*/operon-cli.db`；只读 schema 观察到 62 表，相关表为 `projects`、`frames`、`frame_messages`、`artifacts`、`artifact_versions`。用户后来授权的窄范围检查确认 337 条 assistant 记录中有 61 个 `content[].thinking` 块（56 个非空、5 个空，均集中在一组会话；首屏 100 条记录含 43 个非空块），不记录正文。自动化测试仍仅用合成数据；不得递归扫描整个 `.csp`、读秘密表、写数据库或打开 artifact。
- 测试只能使用合成 JSONL/SQLite fixtures，禁止真实 transcript 或数据库行；对合成输入验证读取前后哈希不变。各来源缺失、权限失败或 schema 漂移需局部降级。

## 后续 Agent 导航
- 先读上述规划文档，再读 `README.md`、`package.json`、`src/App.jsx`、`src/lib/claudeCode/parser.js`、`source.js`、`browserDirectory.js` 和相关 `test/` 文件。
- `task.md`、`task2.md`、`task3.md` 仅供历史背景；跳过 `node_modules/`、`dist/`、本机真实会话正文、密钥文件及整个 `.csp` 树。

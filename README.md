# Claude Code JSONL Viewer

本地浏览器查看器，用于自动发现并浏览 Claude Code、Claude Desktop Code（第三方登录模式）、Claude Desktop Cowork（Local Agent Mode）与 Claude Science / CSP 会话。会话由本地 Node.js 服务从固定的本机来源读取，不需要上传 JSONL 或选择会话目录。独立的 Workflow JSON 查看入口保留，可手动载入单个 `.json` 文件。

## 本地运行

需要 Node.js **22.13.0 或更高版本**。项目用 Node 内置 `node:sqlite` 以只读模式访问 Claude Science 数据库。

```bash
npm install
npm run dev
```

开发模式由同一个 Node 进程提供本地 API 和 Vite middleware，默认地址为 `http://127.0.0.1:4399`。服务只绑定 `127.0.0.1`。启动时会扫描一次，页面也提供“手动刷新来源”。

构建和启动生产版本：

```bash
npm run build
npm start
```

生产服务默认在 `http://127.0.0.1:4400` 提供 `dist/` 和本地 API。可用 `PORT` 环境变量更改端口；绑定地址仍固定为 `127.0.0.1`。

## 自动发现的来源

- **Claude Code**：递归发现 `~/.claude/projects/` 下的 `.jsonl` 会话文件，使用现有 Claude Code JSONL parser 展示时间线和元数据。
- **Claude Desktop Code（第三方登录模式）**：从 `~/Library/Application Support/Claude-3p/claude-code-sessions/` 读取会话元数据，并通过 `cliSessionId` 关联 JSONL transcript。配置目录只作为路径线索，不读取配置文件或其中的值。
- **Claude Desktop Cowork（Local Agent Mode 存储目录）**：发现 `~/Library/Application Support/Claude-3p/local-agent-mode-sessions/` 下的嵌套会话 JSONL 和 `audit.jsonl`。可关联的审计记录随会话展示；高频 `system` 审计事件默认折叠。
- **Claude Science / CSP**：只检查 `~/.csp/sandbox/home/.claude-science/orgs/*/operon-cli.db`。数据库只读打开，只查询 `projects`、`frames`、`frame_messages`、`artifacts`、`artifact_versions` 这五张允许表。项目、root/child frames、消息和工具记录会映射到查看器；附件只展示元数据或路径，不打开附件正文。

每个来源单独报告可用、部分可用、未找到或读取失败状态。缺少来源、权限错误、损坏记录或数据库 schema 漂移不会阻止其他来源继续显示。详情和分页记录 API 只接受当前扫描生成的不透明会话 ID，不接受文件系统路径。

## 本机数据边界

- 会话内容只由绑定回环地址的本地服务读取并交给本机浏览器，不上传或发送到远程服务。
- 服务端不接受客户端提供的目录或文件路径，也不会递归扫描整个 `~/.csp/`。
- Claude-3p `configLibrary` 配置值、API key、Cowork `.audit-key` 均不读取；不验证审计 HMAC。
- SQLite 连接以只读模式打开，查询限定在上述表和元数据列；不会查询密钥、token 或 credential 表。
- 会话页面不再提供 JSONL 文件上传或本机目录选择入口。Workflow JSON 页面仍保留单个 `.json` 文件的本地载入方式。

## Workflow JSON 查看

切换到“单 Workflow”并载入单个 `.json` 文件，可以查看 `script`、`phases`、`logs`、`result` 和 `workflowProgress`。脚本按代码块显示，摘要、提示和结果文本按 Markdown 显示；Workflow 进度数组保留原始顺序。

## API

- `GET /api/sources`：来源状态和上次扫描时间。
- `GET /api/sessions?source=<source>&offset=<n>&limit=<n>`：分页会话摘要列表。
- `GET /api/sessions/:opaqueId`：当前发现会话的元数据、frames 和 artifact 元数据。
- `GET /api/sessions/:opaqueId/records?cursor=<cursor>`：按不透明游标分页读取 JSONL 记录或 CSP 消息。
- `POST /api/refresh`：重新扫描所有固定来源。

API 仅服务于本机页面，无 CORS 跨域访问支持。

## 解析器与测试

Claude Code 文件解析代码位于 `src/lib/claudeCode/`。`parser.js` 实现纯解析逻辑，`source.js` 提供 JSON / JSONL 容错解码和路径辅助方法。自动发现和来源适配器位于 `server/discovery.js`，HTTP API 位于 `server/api.js`，同进程开发和生产服务器位于 `server/index.js`。

测试只使用隔离的合成 JSONL 与 SQLite fixtures：

```bash
npm test
npm run build
```

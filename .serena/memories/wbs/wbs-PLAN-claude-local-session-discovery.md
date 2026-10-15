# Claude 本机会话自动发现改造 WBS

> 状态口径：截至 2026-10-15，规划工作包均已实现；合成测试 18/18、生产构建和 `git diff --check` 通过。实现验证使用合成数据；本会话后来经用户授权只对 CSP thinking 字段作了窄范围结构/计数检查，没有记录正文。真实环境数据的普遍兼容性未验证。无工期与日期估算。
> 规划基线：`mem:plans/PLAN-claude-local-session-discovery`。
> 需求、调查证据、数据边界与验收背景：`/Users/johannyellow/codebase/claude-code-jsonl-viewer/docs/claude-local-session-discovery.md`。
> 目标仓库：`/Users/johannyellow/codebase/claude-code-jsonl-viewer`。

## 0. 任务基线与全局约束

- 目标：以单个本地 Node.js 服务启动时自动发现 Claude Code、Claude-3p 和 CSP Claude Science 会话；前端提供刷新和统一浏览能力。
- 产品决策：会话流不保留 JSONL 上传或本机目录选择入口；独立 workflow JSON 视图保持现状；审计记录保留，高频 `system` 事件默认折叠。
- 安全边界：服务仅绑定 localhost 回环地址；客户端只使用已发现会话的不透明 ID，不传文件系统路径；来源之间故障隔离。
- 数据边界：不读取配置文件中的值/密钥，不读取 `.audit-key`，不验证 HMAC；CSP 不递归扫描整个 `.csp`，不读秘密表、真实 transcript/audit 正文或 artifact 文件内容；数据库只读。自动化测试仅用合成数据。本会话经用户授权后只对 CSP `frame_messages.msg_json` 的 thinking 字段形状和计数作了窄范围只读检查，没有记录正文；后续不得扩大该检查范围。
- 验证边界：所有自动化测试使用隔离合成 JSONL / SQLite fixtures；禁止测试依赖本机真实会话数据。

## 1. 本地服务与统一发现基础

### 1.1 运行环境和启动入口
- 工作项：在 `package.json` 声明支持 Node 版本（规划基线为 >=22.13.0）并定义开发、生产启动脚本；确认所用 `node:sqlite` 和 Vite middleware 能力与实际依赖版本匹配。
- 输出：可重复使用的 Node 服务入口和明确的 npm 启动命令。
- 验收：开发模式由一个 Node 进程同时提供本机 API 与 Vite 前端；生产模式由本机服务提供构建后的前端；缺少或不兼容 Node 版本时给出可读启动错误。
- 依赖：无。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 1.2 HTTP 服务和进程边界
- 工作项：建立同源本机 HTTP 服务，绑定 `127.0.0.1`；接入开发 Vite middleware 和生产 `dist` 静态资源。
- 输出：API 与 React UI 共用的本地进程/来源。
- 验收：服务不会监听外部网卡；无需第二个会话数据进程；前端请求不把 transcript 或数据库内容发往远程端点。
- 依赖：1.1。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 1.3 统一来源状态和会话索引
- 工作项：定义服务端内部来源状态、会话摘要/详情、记录分页边界；将来源路径映射保留在服务端，并为 API 暴露不透明会话 ID。
- 输出：供各适配器、API 和界面共享的内部数据访问边界。
- 验收：每条会话能标记来源并映射到其服务端记录；API 输入无法构造任意本机路径；缺失字段不会导致跨来源路径访问。
- 依赖：1.2。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 2. 会话来源适配器

### 2.1 Claude Code 常规 JSONL
- 工作项：从用户主目录下的 `~/.claude/projects/**/*.jsonl` 发现会话；复用现有 JSONL parser；按服务端索引读取记录。
- 输出：Claude Code 会话摘要和可分页轨迹记录。
- 验收：启动扫描与手动刷新都能发现新增/变化文件；损坏行或未知事件以可读记录/告警保留，不使整场会话失败；不记录真实 transcript 正文到日志。
- 依赖：1.3。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 2.2 Claude-3p 会话元数据和 transcript 关联
- 工作项：读取 `~/Library/Application Support/Claude-3p/claude-code-sessions` 中允许的元数据/索引，使用 `cliSessionId` 将元数据关联到对应 transcript JSONL；仅将 configLibrary 文件作为该登录模式存在的路径线索，不解析其中配置值。
- 输出：包含会话元数据及关联 transcript 的 Claude-3p 会话。
- 验收：元数据可关联匹配的 transcript；关联缺失或冲突报告为来源/会话级可读状态；不读取、返回或记录配置值、API key 或其他凭据。
- 依赖：1.3、2.1 的 JSONL 读取能力。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 2.3 Claude Desktop Cowork 会话与 audit
- 工作项：发现 `local-agent-mode-sessions` 下的元数据、该来源内嵌的 session JSONL 以及 `audit.jsonl`，将可关联事件合并到对应会话轨迹。
- 输出：含 Cowork transcript 与审计补充事件的会话详情。
- 验收：审计记录保留且可查看；高频 `system` 类事件默认折叠并可展开；实现路径不读取 `.audit-key`，不做 HMAC 验证。
- 依赖：1.3、2.1 的 JSONL 读取能力。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 2.4 Claude Science / CSP SQLite
- 工作项：只按 `~/.csp/sandbox/home/.claude-science/orgs/*/operon-cli.db` 模式定位数据库，以 SQLite 只读方式查询 allowlist 中的 `projects`、`frames`、`frame_messages`、`artifacts`、`artifact_versions`；按项目、root/child frames、消息/工具记录组织；artifact 只呈现元数据和路径。
- 输出：CSP 项目和会话轨迹适配器，以及缺失/权限/schema 错误状态。
- 验收：frame 层级可表达 root 与 child 关系；消息依 `frame_id` 归属并依 `idx` 稳定排序；artifact 内容文件不打开；不运行 migration、不写 DB/sidecar、不查询秘密/token/credential 表；未知或漂移 schema 局部报错。
- 依赖：1.3、1.1 的 Node SQLite 运行能力。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 2.5 多来源容错和刷新
- 工作项：汇总适配器的扫描状态；来源缺失、拒绝访问或格式/schema 异常只影响该来源；手动刷新重建可用发现索引。
- 输出：统一来源状态及可刷新会话索引。
- 验收：一个来源失败时其余成功来源仍可列出和打开；UI/API 可见来源级错误摘要及扫描状态；刷新不需要常驻文件 watcher。
- 依赖：2.1–2.4。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 3. 本地 API

### 3.1 来源与会话列表/详情
- 工作项：提供来源状态、会话列表和会话详情读取接口；列表支持界面所需的来源标签、过滤/分页。
- 输出：`GET /api/sources`、`GET /api/sessions`、`GET /api/sessions/:opaqueId`。
- 验收：详情只解析当前发现索引中的不透明 ID；不存在/过期 ID 返回可读错误；无接口接受路径、文件名或 DB 路径作为读目标。
- 依赖：2.5。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 3.2 分页轨迹读取
- 工作项：按会话不透明 ID 和游标读取 JSONL、audit、CSP 消息等记录页。
- 输出：`GET /api/sessions/:opaqueId/records?cursor=...`。
- 验收：页序稳定；非法游标或跨会话游标不能转化为任意路径读取；大记录集按页提供，不要求一次载入全部会话记录。
- 依赖：3.1、2.1–2.4。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 3.3 手动刷新
- 工作项：提供请求触发来源重新扫描和发现索引刷新。
- 输出：`POST /api/refresh`。
- 验收：刷新结束后会话列表与来源状态体现新扫描结果；失败仍按来源隔离并返回可读状态。
- 依赖：2.5。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 4. React 会话浏览界面

### 4.1 自动发现首页与来源控制
- 工作项：将首页会话数据流改为从本机 API 自动加载；展示来源状态、来源标识/筛选和刷新操作。
- 输出：基于服务发现结果的会话列表与状态反馈。
- 验收：应用打开后无需用户选文件/目录即可查看发现的会话；刷新可重新获取来源状态及列表；来源错误可读且不遮蔽可用来源。
- 依赖：3.1、3.3。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 4.2 统一详情和来源特有内容
- 工作项：展示 Claude Code、Claude Desktop Code（第三方登录模式）transcript、Claude Desktop Cowork audit 事件以及 CSP 项目/frames/messages/tools/artifact 元数据；轨迹按需分页。
- 输出：多来源统一详情视图及必要的来源特有呈现。
- 验收：可浏览 root/child frame 关系和消息顺序；audit 的 system 高频项初始折叠且可展开；artifact 仅显示元数据/路径；不存在读取 artifact 文件内容的 UI 请求。
- 依赖：3.2、2.2–2.4。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 4.3 移除会话手动输入入口并保留 workflow JSON
- 工作项：从会话流程移除 JSONL 上传、本机目录选择和相关入口/状态；独立 workflow JSON 视图保持当前行为。
- 输出：无需人工导入的会话流。
- 验收：会话 UI 不显示 JSONL 上传或目录选择入口；workflow JSON 功能仍可按原流程使用，且不被当成会话来源。
- 依赖：4.1；workflow 视图需通过现有测试/操作验证边界。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 5. 合成数据测试与构建验收

### 5.1 来源适配器合成测试
- 工作项：为 Claude Code、Claude Desktop Code 元数据关联、Claude Desktop Cowork audit 和 CSP 数据访问准备隔离 fixtures。
- 输出：覆盖成功、缺失、损坏/未知记录、关联失败和 schema 漂移的自动化测试。
- 验收：不读本机真实 transcripts、audit 行或 CSP 数据库行；合成 audit 验证保留和默认折叠语义；合成 CSP 覆盖项目、root/child frame、消息排序及 artifact/version 元数据。
- 依赖：2.1–2.5。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 5.2 API 与安全边界测试
- 工作项：覆盖 API 列表、详情、分页、刷新、来源隔离和 ID/游标校验。
- 输出：本地 API 行为与路径边界测试。
- 验收：请求没有传任意本地路径的能力；无效 ID/游标不触发文件读取；来源失败不会隐藏其他来源。
- 依赖：3.1–3.3。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 5.3 UI 和旧流程回归
- 工作项：验证自动加载、来源状态、刷新、多来源详情、audit 折叠和 workflow JSON 边界。
- 输出：前端验收测试或与项目现有测试体系一致的 UI 回归覆盖。
- 验收：会话流没有上传/目录选择入口；独立 workflow JSON 视图仍工作。
- 依赖：4.1–4.3。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 5.4 只读性、完整验证和构建
- 工作项：对合成文件/数据库计算读取前后 SHA-256；运行 `npm test` 和 `npm run build`。
- 输出：测试与生产构建结果。
- 验收：合成输入哈希前后相同；无读真实会话/数据库行的测试；测试和构建均通过，或将失败清楚定位。
- 依赖：5.1–5.3。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 6. 用户文档与交付核对

### 6.1 README 对齐
- 工作项：更新 README 启动方式、Node 版本、自动发现/刷新流程、支持来源、只读和隐私边界；移除过时的会话上传/目录选择说明。
- 输出：与实际产品行为一致的 README。
- 验收：README 不再声称会话流需上传 JSONL 或选择本机目录；保留独立 workflow JSON 说明；路径、权限和 Node 启动说明与实现一致。
- 依赖：1–4 的产品实现与 5 的验证结果。
- 状态：已实现 / 对应测试、构建或代码复核通过。

### 6.2 最终验收映射
- 工作项：逐项核对目标、来源兼容、接口边界、旧入口移除、workflow JSON 保留、只读隐私和构建结果。
- 输出：按本 WBS 验收项记录完成/失败/未运行状态。
- 验收：每个成功标准均有对应测试、构建或界面证据；任何未实现来源、未验证安全边界或失败检查均明确记录；未将规划内容表述为已交付功能。
- 依赖：5.4、6.1。
- 状态：已实现 / 对应测试、构建或代码复核通过。

## 实施验收记录（2026-10-15）

- 实现文件：`server/discovery.js`、`server/api.js`、`server/index.js`、`src/App.jsx`、`src/styles.css`；测试位于 `test/discovery.test.js`、`test/api.test.js`、`test/server.test.js`。
- 入口行为：会话页启动自动发现并支持手动刷新；无会话 JSONL 上传/目录选择；workflow JSON 独立入口保留。
- 安全核对：localhost 回环监听；当前发现列表 opaque ID；CSP 只读五表/列 allowlist、拒绝数据库符号链接；所有新增来源/API 测试使用临时合成 fixtures。
- 验证：`npm test` 18/18 通过；`npm run build` 通过；`git diff --check` 通过。
- 限制：未用真实本机数据验证 Claude Code、Claude-3p 或 CSP 的现场 schema/目录差异；5.3 前端行为依据源码结构和生产构建核验，没有真实数据浏览器验收。

## 顺序与依赖汇总

- 主链：`1.1 → 1.2 → 1.3 → 2.1–2.4 → 2.5 → 3.1–3.3 → 4.1–4.3 → 5.1–5.4 → 6.1–6.2`。
- 可并行切片：2.1–2.4 在统一会话/来源边界（1.3）确定后可并行；各接口测试可随 3.x 推进；UI 测试可随 4.x 推进。最终集成验收仍依赖所有强依赖项完成。
- 禁止越界项不是待办：读取 configLibrary 值/凭据、读取 `.audit-key` 或校验 HMAC、递归扫描整个 `.csp`、读取真实 transcript/audit 正文、查询秘密表、读取 artifact 内容、写真实 DB 或允许任意客户端路径，均不属于本 WBS 的实现或测试范围。真实 SQLite 数据不得用于自动化测试；本会话唯一例外是用户已授权并完成的 CSP thinking 字段窄范围结构/计数核对，未来无需也不得扩展该检查。

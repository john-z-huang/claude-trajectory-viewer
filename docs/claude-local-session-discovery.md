# Claude 本机会话发现：规划与调查记录

> 状态：需求、调查与实现范围记录；实际扫描行为以 `server/discovery.js` 为准。
> 调查快照日期：2026-10-15（本机只读检查摘要）。数量、目录布局和 schema 都是当时观察值，不能当作产品常量。

## 1. 目标与已确定的产品行为

把当前以浏览器上传 JSONL、选择本地目录为主的会话查看流程，改为由一个本地 Node.js 进程在启动时自动发现会话记录。界面提供手动刷新，不保留 JSONL 上传和目录选择入口。独立的 workflow JSON 视图不在本次会话发现范围内。

来源范围覆盖以下模式：

1. Claude Code 通常使用的 `~/.claude/projects/**/*.jsonl` 会话轨迹。
2. Claude Desktop Code（第三方登录模式）：读取 `claude-code-sessions/**/*.json` 元数据，并使用 `cliSessionId` / `sessionId` 关联 `~/.claude/projects/**/*.jsonl` transcript。
3. Claude Desktop Cowork：读取 `local-agent-mode-sessions/**` 下的 JSON 元数据、嵌套 JSONL transcript 和关联/汇总的 `audit.jsonl`；不读取 `.audit-key`，不验证 HMAC。
4. Claude Science 的 CSP 登录模式：在确认的 `operon-cli.db` 中只读查询会话相关数据，组织为项目、root/child frames、消息和工具记录；可显示 artifact 的元数据和路径，但不读取 artifact 文件内容。

Claude-3p 下的 `configLibrary/*.json` 仅作为登录/路由配置存在的线索，不是会话记录；实现不读取配置内容。Claude Desktop Code 与 Cowork 当前都没有配置 SQLite 执行记录读取。

多来源采用独立发现适配器和统一的会话列表/详情视图。所有来源可单独缺失或失败，仍显示其余可用来源。审计记录保留，默认折叠高频 `system` 事件，用户可展开检查。

**拟定成功标准：**

- 打开应用后无需上传或手选目录，即可列出发现到的本机会话；手动刷新能重新扫描。
- 会话查看流程不再提供 JSONL 上传或本机目录选择入口；独立的 workflow JSON 视图保持现状。
- 可从列表打开 Claude Code、Claude Desktop Code、Claude Desktop Cowork 和 Claude Science 会话并浏览其轨迹。
- Claude Desktop Code 元数据可和匹配的 Claude Code JSONL 记录关联；Cowork 会话 JSONL 与审计数据可作为补充记录查看。
- Claude Science frames、消息/工具记录和 artifact 元数据可通过 CSP 数据库查询展示。
- 服务只在本机回环地址提供，不接受任意路径读取；数据库只读，密钥和 artifact 内容不进入查看器。

## 2. 证据等级与本机存储调查

本节区分实现代码事实、本机只读观察、官方文档事实和推断。目录与文件数量均为 2026-10-15 的瞬时快照，不能作为实现条件。CSP 后续只针对 `frame_messages.msg_json` 的 `content[].thinking` 形状及计数做了窄范围检查，因此不再声称完全没有检查真实 SQLite 行；没有把任何思考文本、真实 transcript/audit 正文、配置值、令牌或其他秘密写入本文。

### Claude Code 常规记录

- **本机观察：** `~/.claude/projects` 存在，调查时观察到 33 个 `.jsonl` 文件。
- **规划含义：** 将该目录作为自动发现的根之一，递归枚举 JSONL；文件数量会随使用变化。
- **后续 Agent 注意：** 查看器应沿用项目现有 JSONL 解析逻辑，并逐行处理损坏记录；不要在文档、日志或验证输出中复制真实 transcript 正文。

### Claude Desktop Code（第三方登录模式）

- **本机观察（2026-10-15）：** `~/Library/Application Support/Claude-3p/claude-code-sessions/**/*.json` 文件名清点得到 16 个 JSON 元数据文件；`~/.claude/projects/**/*.jsonl` 有 33 个 JSONL transcript。此项仅检查路径与文件名/扩展名，没有读取真实 metadata 或 transcript 正文。
- **实现事实：** `sourcePaths` 将 Code 模式元数据根目录设为 `claude-code-sessions`。`scanClaude3p` 递归读取其中的 JSON 元数据，并通过 `cliSessionId` / `sessionId` 将其关联到已发现的 `~/.claude/projects/**/*.jsonl` transcript。无法唯一匹配的元数据会作为单独会话显示或报告歧义。
- **配置线索：** `~/Library/Application Support/Claude-3p/configLibrary/*.json` 只是登录/路由配置线索，不是会话记录；实现不读取配置内容、密钥或 API key。
- **字段名观察：** 本机调查曾观察到配置中存在 `inferenceGatewayApiKey` 字段名。本文只记录字段名，不读取、记录或展示其值。
- **SQLite 边界：** 该模式当前未配置 SQLite 执行记录读取。精准会话目录的文件名检查未发现 SQLite 文件；Claude-3p 根目录下另有数据库文件名观察，见下方“Claude-3p SQLite 文件名观察”，不能据此认定它们是 Code 会话记录。

### Claude Desktop Cowork

- **本机观察（2026-10-15）：** `~/Library/Application Support/Claude-3p/local-agent-mode-sessions/**` 文件名清点得到 35 个 JSON 文件、6 个普通会话 JSONL 和 6 个 `audit.jsonl`。路径布局包含嵌套的 `.claude/projects/session/*.jsonl` 会话 transcript 与审计流；数量是瞬时观察，不是实现常量。未读取这些文件的正文。
- **实现事实：** `scanLocalAgentMode` 递归读取 Cowork 根目录下的 JSON 元数据和 JSONL transcript，使用文件标识与元数据中的 `cliSessionId` / `sessionId` 关联会话；`audit.jsonl` 按可用会话标识关联或作为审计流汇总展示。扫描排除 `.audit-key`，不验证 HMAC。
- **SQLite 边界：** 该模式当前未配置 SQLite 执行记录读取。Claude-3p 根目录及 Cowork partitions 下观察到的数据库文件名见下节；未检查其 schema 或行，不能据此推断它们保存会话记录。

### Claude-3p SQLite 文件名观察

- **本机观察（2026-10-15）：** 扩展检查 Claude-3p 应用支持目录时，观察到 Claude-3p 根目录及 Cowork `partitions/<partition-id>/` 下有名为 `declarative_performance_observer.db` 的文件；另观察到 `GPUPersistentCache/GPUCache/<cache-id>/cache.db`。这里的 `<partition-id>` 和 `<cache-id>` 是路径模板，不是特定记录值。
- **证据边界：** 只检查文件名和目录位置，没有打开这些数据库、读取 schema 或行。当前查看器对 Claude Desktop Code 与 Claude Desktop Cowork 都没有配置 SQLite 执行记录来源；不能确认上述数据库与会话轨迹有关，也不应把它们作为会话存储路径。

- **审计边界：** Cowork 审计记录可在界面中默认折叠高频 `system` 事件；**不读取 `.audit-key`，不验证 HMAC**。不因事件签名机制而访问密钥材料。

### Claude Science / CSP

- **本机观察（2026-10-15）：** 数据库路径模式为 `~/.csp/sandbox/home/.claude-science/orgs/*/operon-cli.db`，当时发现 1 个数据库和 6 组会话。较早的只读 schema 检查观察到 62 张表；该数量会随版本变化。
- **schema 观察：** 与会话浏览相关且实现采用白名单的表为：
  - `projects`：项目元数据。
  - `frames`：观察到 `parent_frame_id`、`root_frame_id`、`is_hidden` 等层级/显示字段。
  - `frame_messages`：观察到 `frame_id`、`idx`、`msg_json`、`msg_uuid` 等消息定位与载荷字段。
  - `artifacts`、`artifact_versions`：artifact 与版本元数据。
- **窄范围消息形状检查：** 对 CSP `frame_messages.msg_json` 做了只读、范围受限的字段形状与计数核对：337 条 assistant 记录中共观察到 61 个 `content[].thinking` 块，其中 56 个非空、5 个为空；非空块都出现在同一组会话中。这里的 56 是块数，不代表 56 条不同消息。当前会话记录 API 首屏（前 100 条记录）返回了 43 个非空 thinking 块。此核对不包含思考文本，也没有检查或记录消息正文、附件正文。
- **展示核对：** 对样本中非空 thinking 块的 API 返回与 Markdown 渲染链路做了检查，非空块均能生成非空渲染结果；界面为可展示的 CSP 助手思考块提供“思考”标签。Claude Science 的“会话记录”标题下按当前已加载页汇总助手消息数和含可展示思考块的消息数，其余消息只说明来源中未记录可展示字段，不推断或补造思考内容。该汇总按消息计算，与上面的 thinking 块计数是不同口径。
- **签名边界：** 没有解密或验证思考块 signature，也没有从 signature 推导思考内容。Cowork 审计另遵守前文所述边界，不读取 `.audit-key`，不验证 HMAC。
- **未确认项：** 本次核对只确认上述局部字段形状与计数，不据此声称已确认全部消息 JSON 结构、所有外键关系或每个 artifact 字段语义。实现仍需以合成 fixture 覆盖查询与适配逻辑；发现 schema 漂移时应返回来源状态，而不是猜测数据。
- **已定边界：** 只访问上述精确数据库路径模式和允许的会话表；不递归扫描整个 `.csp`，该目录包含大量运行时文件、日志和凭据。不得读取秘密、token 或 credential 表；只展示 artifact 元数据和路径，不打开 artifact 指向的文件。

### 已实现的界面行为（代码事实）

- `Claude Science Frames` 使用默认收起的原生折叠区域；收起时显示标题和 frame 数量，展开后显示 frame 信息。
- artifact 元数据区域默认收起，只呈现名称/标题、类型或媒体类型、更新时间和版本数等核心字段；每个 artifact 的路径另放在默认收起的“查看路径”区域。查看器不打开 artifact 文件。
- 每条会话记录默认呈现按角色提取的正文/工具信息；每条记录的“原始 JSON”控件默认收起，点击后才显示对应 JSONL 原始行或 CSP `msg_json` 字符串。原始 JSON 不作为默认正文。
- CSP 助手思考内容只在来源已有可展示字段时渲染；解析器会检查消息内及记录根部的 `thinking`、`reasoning`、`reasoning_content`、`analysis` 等字段，即使 `content` 已包含正文也不会忽略这些同级思考字段；空 `text` 不会遮蔽非空思考字段。思考按 Markdown 渲染，并按当前已加载页汇总含可展示思考的助手消息数。没有这类已保存字段时，界面如实汇总来源情况，不生成或恢复缺失内容。

### 证据类型

- **实现代码事实**以 `server/discovery.js`、`server/api.js`、`server/index.js`、`src/App.jsx` 与 `src/lib/claudeCode/parser.js` 当前代码为准，描述扫描路径、来源关联、解析和界面行为；它们不证明其他客户端版本使用相同存储格式。
- **本机只读观察**表示上面所述目录、文件名、schema/字段形状和快照计数，只适用于 2026-10-15 这次本机检查，不保证其他机器、用户、版本或未来时间相同。CSP thinking 检查只写入字段路径和计数，不写入思考文本。
- **官方文档确认**只确认对应官方 API/工具的接口语义与能力，不能替代本机文件布局或客户端存储调查，见“参考资料”。
- **方案/推断**表示对兼容范围、关联策略或后续实现的解释，不是已实现行为或独立验证的本机事实。

## 3. 实现架构与本地 API

### 进程与数据流

以一个 Node.js 进程承载本地 HTTP API，并在开发模式集成 Vite middleware；生产模式服务已构建的前端资源。服务只绑定 `127.0.0.1`，不启动远程服务或上传会话内容。Node 负责目录发现、JSONL/SQLite 读取、会话关联和分页；React 通过本机 API 展示结果。启动时执行一次发现，手动刷新触发新的发现，不要求常驻文件监听。

使用来源适配器隔离 Claude Code、Claude Desktop Code、Claude Desktop Cowork 和 CSP 的路径/格式差异。缺少来源目录、权限拒绝、损坏 JSONL 或数据库 schema 不匹配应转成可读的来源状态并局部降级；一个来源不可用不应隐藏其他来源。

### API 提案

下表列出本地接口路径和用途；响应字段及运行行为以 `server/index.js` 与 `server/discovery.js` 的实现为准：

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/sources` | 返回启用来源的发现状态、错误摘要和最近扫描信息。 |
| `GET` | `/api/sessions` | 返回可筛选/分页的已发现会话摘要及来源标签。 |
| `GET` | `/api/sessions/:opaqueId` | 返回该会话元数据和来源信息。 |
| `GET` | `/api/sessions/:opaqueId/records?cursor=...` | 分页读取该会话轨迹记录。 |
| `POST` | `/api/refresh` | 重新扫描配置的来源根目录并更新发现索引。 |

路径由服务端的来源配置和发现索引决定。请求只能引用已发现列表中的不透明会话 ID；任何 API 都不接收客户端传入的文件系统路径，也不提供任意文件读取接口。

CSP 数据库使用 Node 内置 `node:sqlite` 的只读连接；建议 `engines` 最低 Node 版本为 22.13.0，以便使用该版本文档中的同步 SQLite 查询接口。查询按 allowlist 限定表和字段；不运行 schema migration、不写事务、不修复数据库，也不触碰 SQLite 伴随文件。必要时按页读取大结果，避免把完整会话集合一次载入内存。

## 4. 隐私、路径和故障边界

实现和文档遵守以下本地访问范围：

| 数据 | 允许用途 | 明确禁止 |
|---|---|---|
| `~/.claude/projects/**/*.jsonl` | Claude Code transcript 发现与查看。 | 发现范围之外的任意路径读取。 |
| `~/Library/Application Support/Claude-3p/claude-code-sessions/**/*.json` | Claude Desktop Code 元数据；按 `cliSessionId` / `sessionId` 关联已发现 JSONL。 | 读取或推断配置凭据；把 configLibrary 当作会话记录来源。 |
| `~/Library/Application Support/Claude-3p/configLibrary/*.json` | 仅作为 Claude Desktop Code 登录/路由配置存在的线索。 | 读取配置值、API key 或其他凭据；将配置文件解析为会话。 |
| `~/Library/Application Support/Claude-3p/local-agent-mode-sessions/**` | Claude Desktop Cowork JSON 元数据、嵌套 session JSONL 和 `audit.jsonl`。 | 读取 `.audit-key`、验证 HMAC、复制敏感审计秘密；读取该模式的 SQLite 执行记录（当前未配置该来源）。 |
| `~/.csp/sandbox/home/.claude-science/orgs/*/operon-cli.db` | 只读查询经确认的项目、frame、消息和 artifact 元数据表。 | 整棵扫描 `.csp`、秘密表、写入数据库、打开 artifact 文件。 |

截至 2026-10-15 的文件名快照中，Claude Desktop Code 元数据目录有 16 个 `.json`，Cowork 目录有 35 个 `.json`、6 个普通会话 `.jsonl` 和 6 个 `audit.jsonl`；`~/.claude/projects` 有 33 个 `.jsonl`。Claude-3p 应用支持目录的扩展文件名检查观察到 `declarative_performance_observer.db`（Claude-3p 根目录及 Cowork partitions）和 GPU cache 下的 `cache.db`；没有读取其 schema 或行，也没有将其确认为会话记录来源。所有数量都是瞬时本机观察，不是实现条件。

用户主目录使用 Node 的 home-directory 能力解析，不把当前机器的用户名写死为配置。扫描失败要显示具体来源级状态和可读错误，同时继续提供其他成功来源。任何 UI/日志只输出定位和诊断所需的非秘密信息；不要记录 transcript 正文、token、密钥值或数据库行到日志。

## 5. 实施步骤与验收

### 实施顺序

1. 在 `package.json` 明确 Node 版本与开发/生产启动脚本；新增本机 Node HTTP 服务，API 和静态前端同源，开发时挂载 Vite middleware。
2. 增加来源扫描和适配层：Claude Code JSONL，Claude Desktop Code metadata 与 transcript 关联，Claude Desktop Cowork JSONL/audit，以及 CSP 只读 SQLite。将发现的源状态、会话元数据和分页轨迹统一提供给 API。
3. 调整 React 首页：自动显示发现会话，加入手动刷新、来源状态和来源筛选；移除 JSONL 上传和目录选择入口；审计 system 高频事件默认折叠；显示 CSP frames/messages/artifact metadata。独立 workflow JSON 视图保持现状。
4. 增加合成 fixtures 覆盖发现与适配，执行项目的 `npm test` 和 `npm run build`。完成后更新 README 的启动、数据访问、隐私说明，以及 JSONL 上传/目录选择入口已移除的说明。

### 验收用例

- 多来源同时存在时都能发现；来源缺失/无权限时其他来源仍可用；启动扫描与手动刷新反映新记录。
- 元数据关联正确使用 session/CLI session ID；相同来源的 child frame 可回溯到 root frame；消息按 `idx` 稳定排序；未知或损坏 JSONL 行不会使整份会话失败。
- `audit.jsonl` 合成事件可完整保留，并确认 system 类高频事件默认折叠且可展开；流程不需要 `.audit-key`。
- 合成 SQLite fixture 覆盖项目、root/child frame、消息 JSON、artifact 与 artifact version；缺表或列时报告 CSP 来源错误并继续服务其他来源。
- API 拒绝或根本不提供客户端路径参数；详情只接受已发现的不透明会话 ID；分页游标不能跨越到任意本地路径。
- 所有 JSONL 与 SQLite 测试输入均为隔离合成数据。对合成数据库和文件在测试前后比较 SHA-256，确认读取路径没有写入；绝不为测试读取本机真实 transcript 正文或 SQLite rows。
- 确认会话视图不再显示 JSONL 上传或目录选择入口；独立 workflow JSON 视图保持现状。

## 6. 后续 Code Agent 阅读地图

先读本规划文档，再按下列最小阅读路线了解项目。当前仓库基于 React + Vite，并包含本地 Node 会话发现服务；会话页自动发现记录，独立 workflow JSON 视图保留单独输入流程。此次仓库清单中未发现 `AGENTS.md` 或 `CONTRIBUTING`。

### 必读

1. `README.md)：现有用户流程、运行说明与已记录行为。
2. `package.json)：React/Vite 依赖和脚本；调查时未见明确的 `engines` 约束。
3. `src/App.jsx`：自动发现首页、来源状态、会话详情与独立 workflow JSON 视图入口。
4. `src/lib/claudeCode/parser.js)：JSONL 事件解析。
5. `src/lib/claudeCode/source.js` 与 `src/lib/claudeCode/browserDirectory.js)：当前来源表示及浏览器目录读取路径。
6. `test/`：优先读与 parser、source、browserDirectory 对应的合成数据测试，再按改动读相关测试。

### 仅在需要时阅读

- `task.md`、`task2.md`、`task3.md)：仅用于追溯历史背景，不是当前实施规范。
- 其他 UI/样式文件：仅当界面改动需要理解时再读。

### 不要扫描或打开

- `node_modules/`、`dist/` 等依赖/构建目录。
- 后续不得继续读取、复制或输出本机真实 JSONL transcript 正文、`audit.jsonl` 正文或 CSP SQLite 行。本文仅保留已获准窄范围 CSP `content[].thinking` 字段形状及计数摘要，不包含任何思考文本。
- configLibrary 中的任何值、`.audit-key`、token/credential 文件或数据库表。
- 整个 `~/.csp` 目录、其中的运行时目录、日志和 conda 环境。

本文对本机数据只保留目录、文件名、字段/表名和计数摘要；不包含真实思考文本、transcript/audit 正文、配置值、密钥或附件内容。如果后续实现无法基于这些结构事实编写适配器，应先提出最小化、脱敏的合成 schema fixture 方案，不能以“兼容”为由继续浏览真实会话或密钥数据。

## 7. 参考资料

- [Node.js v22.13.0 SQLite API](https://nodejs.org/download/release/v22.13.0/docs/api/sqlite.html)：`DatabaseSync` 与 `readOnly` 连接选项、同步查询能力。官方文档将 `readOnly` 列为连接配置项。
- [Vite JavaScript API](https://vite.dev/guide/api-javascript.html)：`createServer`、middleware mode，以及将 Vite middleware 接入父级 Node HTTP server 的方式。它支持“一进程提供 API 和开发前端”的方案；生产前端则由本地服务提供构建产物。
- [Anthropic Thinking 文档](https://platform.claude.com/docs/en/build-with-claude/thinking)：说明 Claude Messages API 的 thinking content block、返回内容形状及显示配置。`thinking.display` 文档描述 `summarized` 与 `omitted` 两种展示方式；省略时 thinking 字段可为空，adaptive thinking 也可能不生成 thinking block，summarized 文本是摘要而非原始思维链。它只确认 API 层语义，不证明 Claude Desktop Code 或 Cowork 的本地文件布局、持久化格式或是否保存 thinking 字段；Desktop 存储行为以本机只读观察和当前扫描实现为依据。
- [Anthropic Extended thinking 文档](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)：补充旧式 extended thinking API 配置说明。该 API 文档同样不能用来推断 Claude Desktop 本地会话文件格式。

外部 API 能力以实现时实际支持的 Node/Vite 版本为准；依赖升级后重新核实选项和启动行为。Anthropic API 文档描述 API 接口，不作为 Claude Desktop 存储行为的证据。

## 8. 实施状态与验证记录

- **实现范围：** 本地 Node 服务、四类来源发现、不透明会话 ID API、分页记录和手动刷新已实现；会话页面自动发现，不提供 JSONL 上传或目录选择；独立 Workflow JSON 入口保留。Claude Desktop Code 与 Claude Desktop Cowork 在页面中按各自模式名称区分，后者仍使用 `local-agent-mode-sessions` 作为存储目录名。
- **安全与测试边界：** CSP SQLite 使用只读连接和五表/列 allowlist；自动化验证使用合成 JSONL/SQLite fixtures。本文未写入真实思考文本、transcript/audit 正文、配置值、密钥或 artifact 内容。
- **验证记录（2026-10-15）：** 实现阶段 `npm test` 18/18 通过，`npm run build` 与 `git diff --check` 通过。该记录来自实现阶段的验收结果，不代表所有客户端版本和本机数据格式均已覆盖。
- **兼容性限制：** 自动化测试没有使用本机真实会话或数据库。之后仅在用户授权的窄范围调查中检查了 CSP `frame_messages.msg_json` thinking 字段的结构和计数；这不验证其他 Claude Desktop / Claude Code 版本的存储格式，也不代表可以恢复来源中未持久化的思考内容。

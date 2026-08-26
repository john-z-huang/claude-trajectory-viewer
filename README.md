# Claude Code JSONL Viewer

用于查看 Claude Code / workflow 执行记录的本地浏览器工具，支持三类输入：

- 单个主 Session 的 `.jsonl` 文件
- 单个 workflow 描述的 `.json` 文件
- 由浏览器选择的本机 Claude Code Workflow 目录；会递归解析该目录及子目录中的全部 `.json` 与 `.jsonl` 文件

项目基于 Vite + React。所有目录文件均由浏览器在用户授权后直接从本机读取，项目不包含目录地址输入或本地文件读取接口。

## Figma 设计稿

[查看 Claude Code JSONL Viewer Figma 设计稿](https://www.figma.com/design/5YBfXQfd6LSe2TrsDtSg07)

## 功能概览

- 单 Session 视图
  - 默认加载仓库内样本 `8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl`
  - 支持上传新的 `.jsonl` 文件
  - 按时间线展示 `user`、`assistant`、`attachment`、`system`、`queue-operation`
  - 将 `mode`、`permission-mode`、`ai-title`、`last-prompt`、`file-history-snapshot`、`atis-latch`、`cost-state` 等元数据单独归档
  - 兼容当前 Claude Code 的 `session_id`、数组/字符串两种 `message.content`、工具结果和 sidechain Agent 记录

- 单 Workflow 视图
  - 支持上传新的 `.json` 文件
  - 展示 `script`、`phases`、`logs`、`result` 和 `workflowProgress`
  - `script` 按代码块渲染，`promptPreview` / `resultPreview` / `result.results[]` 按 Markdown 渲染
  - `workflowProgress` 不做列表聚合，直接按数组原始顺序展示单次 workflow 的阶段与 Agent 轨迹

- Workflow 目录视图
  - 点击“选择 Workflow 目录”打开系统目录选择器，无需手动输入本机地址
  - 会递归读取目录及所有子目录中的 `.json` 与 `.jsonl`，不再要求存在 `wf_*.json`
  - 目录文件只在浏览器和本机解析 Lib 中处理，不会发送到远程服务
  - 所有已解析文件都会出现在左侧文件清单，普通 JSON、元配置 JSON、Session JSONL、journal 都可查看结构化结果
  - 存在 `workflows/wf_*.json` 时，仍会按 `wf_*` 标识把它与 `subagents/workflows/wf_*/` 合并为增强的 Workflow 展示
  - 以 `journal.jsonl` 中的 `started` 记录作为主顺序
  - 从对应 `agent-*.jsonl` 的首个时间线时间戳回填 Sub Agent 启动时间
  - 左侧生成主 Session 和 Sub Agent 的入口，右侧展示选中 Sub Agent 的完整内容；主 Session、Workflow 可一键切换到对应视图

## 展示规则

### 时间线排序

- 主排序字段是 `timestamp`
- 当 `timestamp` 相同或缺失时，回退到 JSONL 原始 `lineNumber`

### 上下文关联

- `uuid`：当前记录唯一标识
- `parentUuid`：将消息、附件、工具结果串联为上下文树
- `sessionId`：标识整个 Session
- `session_id`：当前版本部分 Session/sidechain 记录使用的 Session 标识别名
- `runId` / `taskId`：标识单次 workflow 运行及其所属任务
- `phaseIndex`：将 workflow 中的 Agent 执行记录挂回对应阶段

### 主要展示字段

- `type`
- `message.content`
- `attachment`
- `content`
- `subtype`
- `operation`
- `script`
- `phases`
- `workflowProgress`
- `logs`
- `result`

### Markdown 渲染

以下内容会优先按 Markdown 展示：

- `message.content` 为字符串时
- `assistant.message.content[].text`
- `assistant.message.content[].thinking`
- `attachment.content.file.content`
- `attachment.content`
- `attachment.addedLines`

工具调用、队列事件和原始记录则保留 code / JSON 视图，方便排查字段细节。

`toolUseResult.stdout`、`toolUseResult.stderr`、`toolUseResult.output` 和数组形式的 `tool_result.content` 会拆成可读内容块；无法识别的 content block 仍保留 JSON。

workflow 页面里这些内容也会按 Markdown 展示：

- `summary`
- `workflowProgress[].promptPreview`
- `workflowProgress[].resultPreview`
- `logs[]`
- `result.results[]`

以下字段默认只作为辅助统计或保留在原始 JSON 中，不放进主正文流：

- `defaultModel`
- `workflowProgress[].model`
- `workflowProgress[].fallbackModel`
- `totalTokens`
- `totalToolCalls`
- `scriptPath`

## Dynamic workflow 目录结构

下面是一种常见的会话目录布局；其中 workflow 描述 JSON 是可选的，不是读取目录的前提：

```text
<project-session-root>/
  <sessionId>.jsonl
  <sessionId>/
    workflows/
      wf_xxx.json             # 可选
    subagents/
      workflows/
        wf_xxx/
          journal.jsonl
          agent-<agentId>.jsonl
          agent-<agentId>.meta.json
```

说明：

- `journal.jsonl`
  - 提供 Sub Agent 调用顺序
  - 常见记录类型为 `started` 和 `result`
- `agent-*.jsonl`
  - 对应某个 Sub Agent 的完整会话内容
- `agent-*.meta.json`
  - 对应 Sub Agent 的元配置，例如 `agentType`、`spawnDepth`
- `workflows/wf_*.json`（如果存在）
  - workflow 的脚本、阶段、进度、日志和最终结果；解析器会按 `wf_*` 与 Sub Agent 目录关联

如果缺少 `journal.jsonl`，页面会退回按各 Session 的起始时间排序，并给出告警。任何其他 `.json` 或 `.jsonl` 文件仍会被解析并加入文件清单。

## 选择本机 Workflow 目录

在 `Workflow 目录` 首页点击“选择 Workflow 目录”，然后在系统目录选择器中选取目录，例如：

```text
/Users/johannyellow/.claude/projects/-Users-johannyellow-codebase-papers
```

浏览器会在获得授权后递归读取该目录及所有子目录中的 `.json` 和 `.jsonl` 文件，并把文本交给浏览器内的解析 Lib。页面不会显示或传递绝对路径，只显示所选目录名。

Chromium 系浏览器会使用 File System Access API；其他支持 `webkitdirectory` 的浏览器会自动回退到目录文件选择控件，但页面仍只有同一个“选择 Workflow 目录”按钮。

```bash
npm run dev
```

## 解析 Lib

Claude Code 文件解析已集中在 `src/lib/claudeCode/`，不依赖 React 或浏览器 UI：

- `source.js`：JSON / JSONL 容错解码、时间戳与路径规范化、所有 `.json` / `.jsonl` 的目录文件识别
- `parser.js`：Session、journal、可选 workflow 描述，以及动态工作流目录的纯解析逻辑；目录结果包含 `parsedFiles` 全量文件索引
- `browserDirectory.js`：将浏览器目录选择器或回退控件的本机文件递归转换为目录解析所需的 entries
- `index.js`：唯一公开入口，提供以下 API
  - `parseClaudeCodeSessionJsonl(text, sourceName)`
  - `parseClaudeCodeJournalJsonl(text, sourceName)`
  - `parseClaudeCodeWorkflowJson(text, sourceName)`
  - `parseClaudeCodeDirectory(entries)`
  - `isSupportedClaudeCodeDirectoryFile(fileOrPath)`
  - `parseJsonlText(text)` / `parseJsonText(text, sourceName)`
  - `collectClaudeCodeDirectoryEntries(directoryHandle)`
  - `collectClaudeCodeDirectoryUploadEntries(files)`

`App.jsx` 只负责触发目录选择、维护加载状态，并将 Lib 返回的 entries 交给解析器。旧的 `src/lib/sessionParser.js` 仅保留为兼容旧导入路径的转发层。

## 本地运行

```bash
npm install
npm run dev
```

默认开发地址由 Vite 输出，通常是：

```text
http://localhost:5173
```

## 构建

```bash
npm run build
npm run preview
```

## 测试

```bash
npm test
```

## 技术栈

- React 19
- Vite
- `react-markdown`
- `remark-gfm`

## 当前限制

- 浏览器只可读取用户在选择器中明确授权的目录，无法按任意绝对路径访问本机文件系统，也不会向页面暴露完整绝对路径
- Chromium 系浏览器建议使用 File System Access API；其他浏览器需要支持 `webkitdirectory` 回退能力
- 无法读取的 JSON / JSONL 会在目录概览中计数
- `journal.jsonl` 只用于建立调用顺序和结果摘要，不单独渲染成完整时间线页面

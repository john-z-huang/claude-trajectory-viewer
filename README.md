# Claude Code JSONL Viewer

用于查看 Claude Code Session JSONL 的前端工具，支持两类输入：

- 单个主 Session 的 `.jsonl` 文件
- 含多个 Sub Agent Session 的目录，自动按 `journal.jsonl` 中的调用顺序组织展示

当前项目是一个基于 Vite + React 的纯前端查看器，不依赖后端服务。

## 功能概览

- 单 Session 视图
  - 默认加载仓库内样本 `8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl`
  - 支持上传新的 `.jsonl` 文件
  - 按时间线展示 `user`、`assistant`、`attachment`、`system`、`queue-operation`
  - 将 `mode`、`permission-mode`、`ai-title`、`last-prompt`、`file-history-snapshot` 等元数据单独归档

- Sub Agent 目录视图
  - 支持选择整个 `workflows` 目录，或单个 `wf_*` 目录
  - 自动识别 `journal.jsonl`、`agent-*.jsonl`、`*.meta.json`
  - 以 `journal.jsonl` 中的 `started` 记录作为主顺序
  - 从对应 `agent-*.jsonl` 的首个时间线时间戳回填 Sub Agent 启动时间
  - 左侧生成可快速跳转的 Session 列表，右侧展示选中 Sub Agent 的完整内容

## 展示规则

### 时间线排序

- 主排序字段是 `timestamp`
- 当 `timestamp` 相同或缺失时，回退到 JSONL 原始 `lineNumber`

### 上下文关联

- `uuid`：当前记录唯一标识
- `parentUuid`：将消息、附件、工具结果串联为上下文树
- `sessionId`：标识整个 Session

### 主要展示字段

- `type`
- `message.content`
- `attachment`
- `content`
- `subtype`
- `operation`

### Markdown 渲染

以下内容会优先按 Markdown 展示：

- `message.content` 为字符串时
- `assistant.message.content[].text`
- `assistant.message.content[].thinking`
- `attachment.content.file.content`
- `attachment.content`
- `attachment.addedLines`

工具调用、队列事件和原始记录则保留 code / JSON 视图，方便排查字段细节。

## Sub Agent 目录结构

目录解析依赖如下文件组织：

```text
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

如果缺少 `journal.jsonl`，页面会退回按各 Session 的起始时间排序，并给出告警。

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

## 技术栈

- React 19
- Vite
- `react-markdown`
- `remark-gfm`

## 当前限制

- 目录上传依赖浏览器对 `webkitdirectory` 的支持
- 目前只解析前端可直接读取的本地文件，不直接访问 Claude 本地数据目录
- `journal.jsonl` 只用于建立调用顺序和结果摘要，不单独渲染成完整时间线页面

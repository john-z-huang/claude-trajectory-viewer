# Claude Code JSONL Viewer

一个前端项目，用来展示 Claude Code 单个 Session 的 JSONL 文件内容。

## 结论

- 时间顺序主字段是 `timestamp`。样本中所有真正参与会话时间线的记录都有这个字段。
- 为了避免同一 `timestamp` 或缺失时间戳时顺序不稳定，展示层应当回退到 JSONL 原始行号。
- 上下文关联主要依赖 `uuid`、`parentUuid`、`sessionId`。
- 最重要的展示字段是 `type`、`message.content`、`attachment`、`content`、`subtype`、`operation`。
- 适合按 Markdown 渲染的字段包括：
  - `message.content` 为字符串时
  - `assistant.message.content[].text`
  - `assistant.message.content[].thinking`
  - `attachment.content.file.content`
  - `attachment.content`
  - `attachment.addedLines`

## 启动

```bash
npm install
npm run dev
```

默认会加载仓库里的真实样本 `8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl`，也可以在页面中上传新的 `.jsonl` 文件。

## 页面能力

- 按时间线展示 `user`、`assistant`、`attachment`、`system`、`queue-operation`
- 自动过滤 `mode`、`permission-mode`、`ai-title`、`last-prompt` 这类元数据到单独区域
- 对 Markdown 内容用 `react-markdown + remark-gfm` 渲染
- 对工具调用、队列事件和原始记录保留 JSON / code 视图，便于排查字段细节

# 会话对话 JSON Markdown 渲染改造计划

- 记录日期：2026-10-19
- 状态：范围内实现已完成；未运行测试或构建。
- Serena 计划名：`archive-plans/PLAN-session-json-markdown-rendering`

## 目标与范围

会话查看器遇到不同类型的对话 JSON 时，从对象和数组中提取有价值、可读的内容，以 Markdown 呈现在正文区域，避免把整个 JSON 对象作为正文展示。完整原始 JSON 仍可通过现有折叠详情查看。

范围文件：

- `src/lib/claudeCode/parser.js`：JSONL 时间线记录、通用记录字段、嵌套内容块和工具调用输入的解析。
- `src/App.jsx`：发现会话记录正文及工具调用输入的提取和 Markdown 呈现。

保持 user、assistant、thinking、tool_use/server_tool_use、tool_result 的既有呈现语义；保留工具名称并展示可读参数。结构性元数据和 raw 载荷不递归作为正文展示。发现会话的 `RawJsonDetails` 保留完整原始 JSON 的折叠查看入口。

## Git 基线代码事实（改造前）

- JSONL 路径：`parseSessionText` 将时间线记录交给 `extractBlocks`；后者对 user/assistant、attachment、system、queue-operation 使用专门提取器，其他记录回退到 `extractGenericRecordBlocks`。
- 基线 `extractGenericRecordBlocks` 跳过已知结构字段；message 走消息提取器，content/text/output/stdout/stderr/result/summary 走 `extractValueBlocks`；其他对象字段直接走 `toJsonBlock`。
- 基线 `extractValueBlocks` 只展平数组；带 type 的数组项交给 `extractContentItem`，其他值交给 `toTextBlock`。基线 `toTextBlock` 遇到非字符串会转为 `toJsonBlock`，因此对象会成为 JSON 代码块。
- 基线 `extractContentItem` 对 text/thinking 和普通文本有专门分支；tool_result 读取 content；tool_use/server_tool_use 将 id/name/input 序列化为 JSON 块；未识别对象最终也走 `toJsonBlock`。
- 发现会话路径：`extractReadableText` 处理原始标量和数组；对象只按 text、content、output、stdout、stderr、result 顺序检查，并返回第一个可读值，没有匹配时返回空文本；不会遍历其他任意嵌套字段。
- `extractContentParts`、`getReadableRecordParts` 与 `RecordBody` 将发现会话记录转换为正文内容；工具调用只展示工具名。若没有提取到正文，`RecordBody` 才回退使用记录 blocks。`SessionRecordCard` 保留 `RawJsonDetails` 折叠原始 JSON。

## 改造结果

- JSONL 解析可递归遍历数组和对象，提取非结构性字段中的可读文本，并给嵌套字段添加 Markdown 标签。
- 工具调用输入会保留工具名称，并将可读参数渲染为 Markdown；tool_result 的内容和通用记录的可读字段可从嵌套对象中提取。
- 发现会话记录正文可递归读取嵌套对象与数组，并使用 Markdown 字段标签；工具输入支持对象和数组形式。
- 结构性字段（包括标识符、时间戳、会话元数据及 raw 载荷）会被过滤；Markdown 标签中的特殊字符会转义。
- 已识别的 thinking 内容继续显示；redacted thinking 使用隐藏提示，不输出其内部对象。
- 没有可读内容的载荷不会伪造正文；完整原始 JSON 继续由现有折叠详情提供查看。

## 复核与限制

- 改动仅涉及上述两个范围文件；`git diff --check` 无输出。
- 针对改动区间的 Serena 诊断未返回诊断项。
- 未运行测试或构建；未读取真实会话 JSONL 数据。
- 验证只覆盖代码结构复核及合成数据形状的逻辑推演，未确认真实会话数据中所有字段形式。
- 不改动发现/存储后端、样式、依赖或其他范围外文件；不执行 Git 提交、推送或其他外部操作。

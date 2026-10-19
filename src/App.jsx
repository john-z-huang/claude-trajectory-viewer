import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  parseClaudeCodeWorkflowJson,
} from "./lib/claudeCode/index.js";

const TYPE_TABS = [
  { value: "all", label: "全部" },
  { value: "user", label: "user" },
  { value: "assistant", label: "assistant" },
  { value: "attachment", label: "attachment" },
  { value: "system", label: "system" },
  { value: "queue-operation", label: "queue" },
];

const WORKFLOW_PROGRESS_TABS = [
  { value: "all", label: "全部" },
  { value: "workflow_phase", label: "phase" },
  { value: "workflow_agent", label: "agent" },
];

const VIEW_TABS = [
  { value: "sessions", label: "本机会话" },
  { value: "workflow", label: "单 Workflow" },
];

function buildTypeTabs(typeCounts, baseTabs) {
  const knownTypes = new Set(baseTabs.map((tab) => tab.value));
  const extraTabs = typeCounts
    .filter((item) => !knownTypes.has(item.type))
    .map((item) => ({ value: item.type, label: item.type }));

  return baseTabs.concat(extraTabs);
}

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function formatCompactDateTime(value) {
  if (!value) {
    return "未找到时间";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未找到时间";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "N/A";
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDuration(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "N/A";
  }

  if (value < 1000) {
    return `${value} ms`;
  }

  if (value < 60_000) {
    return `${(value / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function buildResultPreview(value) {
  if (value === null || value === undefined || value === "") {
    return "尚未发现返回结果";
  }

  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return buildResultPreview(value.map((item) => buildResultPreview(item)).join("\n"));
    }

    const preferredValue =
      value.summary ??
      value.title ??
      value.result ??
      value.text ??
      value.content ??
      value.message ??
      value.description;

    if (preferredValue !== undefined && preferredValue !== null) {
      return buildResultPreview(preferredValue);
    }

    return buildResultPreview(JSON.stringify(value));
  }

  const firstLine = String(value)
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "尚未发现返回结果";
  }

  const normalized = firstLine.replace(/[`*#-]+/g, "").trim();
  return normalized.length > 88 ? `${normalized.slice(0, 88)}...` : normalized;
}

function MetadataList({ items }) {
  return (
    <div className="key-value-list">
      {items.map((item) => (
        <div className="key-value-row" key={item.key}>
          <span>{item.key}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function ContentBlock({ block }) {
  if (!block?.text) {
    return null;
  }

  if (block.renderMode === "markdown") {
    return (
      <section className="block">
        <div className="block-label">{block.label}</div>
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
      </section>
    );
  }

  if (block.renderMode === "code") {
    return (
      <section className="block">
        <div className="block-label">{block.label}</div>
        <pre className="code-block">{block.text}</pre>
      </section>
    );
  }

  return (
    <section className="block">
      <div className="block-label">{block.label}</div>
      <pre className="plain-block">{block.text}</pre>
    </section>
  );
}

function visibleScalar(value) {
  return ["string", "number", "boolean"].includes(typeof value) && String(value).trim()
    ? String(value)
    : "";
}

function firstVisibleScalar(...values) {
  return values.map(visibleScalar).find(Boolean) || "";
}

const STRUCTURAL_CONTENT_KEYS = new Set([
  "type", "role", "timestamp", "created_at", "updated_at", "uuid", "parent_uuid",
  "session_id", "agent_id", "tool_use_id", "cwd", "git_branch", "version", "line_number",
  "is_sidechain", "is_timeline_record", "is_meta_record", "raw",
]);

function isStructuralContentKey(key) {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
  return STRUCTURAL_CONTENT_KEYS.has(normalized)
    || /(?:^|_)(?:id|uuid)$/.test(normalized)
    || /(?:^|_)timestamp(?:_|$)/.test(normalized)
    || /^raw(?:_|$)/.test(normalized);
}

function escapeMarkdownLabel(value) {
  return String(value).replace(/[\\`*_{}\[\]()#+.!|>~-]/g, "\\$&");
}

function extractReadableText(value) {
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(extractReadableText).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).flatMap(([key, nested]) => {
    if (isStructuralContentKey(key) || nested === null || nested === undefined) return [];
    const text = extractReadableText(nested);
    return text.trim() ? [`**${escapeMarkdownLabel(key)}:** ${text}`] : [];
  }).join("\n\n");
}

function extractThoughtParts(value) {
  if (typeof value === "string") {
    return value.trim() ? [{ kind: "markdown", label: "思考", text: value }] : [];
  }
  if (Array.isArray(value)) return value.flatMap(extractThoughtParts);
  if (!value || typeof value !== "object") return [];

  const keys = value.type === "thinking"
    ? ["thinking", "text", "content"]
    : ["thinking", "reasoning", "reasoning_content", "reasoningContent", "analysis", "thoughts", "summary", "text", "content", "parts"];
  return keys.flatMap((key) => (
    value[key] === undefined || value[key] === null ? [] : extractThoughtParts(value[key])
  ));
}

function collectThoughtParts(value) {
  if (Array.isArray(value)) return value.flatMap(collectThoughtParts);
  if (!value || typeof value !== "object") return [];
  if (value.type === "thinking") return extractThoughtParts(value);

  const parts = ["thinking", "reasoning", "reasoning_content", "reasoningContent", "analysis", "thoughts"]
    .flatMap((key) => (
      value[key] === undefined || value[key] === null ? [] : extractThoughtParts(value[key])
    ));
  if (Array.isArray(value.content)) parts.push(...collectThoughtParts(value.content));
  else if (value.content?.type === "thinking") parts.push(...extractThoughtParts(value.content));
  return parts;
}

function extractContentParts(content) {
  if (typeof content === "string") {
    return content.trim() ? [{ kind: "markdown", label: "正文", text: content }] : [];
  }
  if (!Array.isArray(content)) {
    if (content && typeof content === "object" && ["tool_use", "server_tool_use"].includes(content.type)) {
      const name = firstVisibleScalar(content.name, content.tool_name) || "未知工具";
      const input = extractReadableText(content.input);
      return [
        { kind: "tool", name },
        ...(input.trim() ? [{ kind: "markdown", label: `工具输入 · ${name}`, text: input }] : []),
      ];
    }
    if (content && typeof content === "object" && content.type === "thinking") {
      const text = extractReadableText(content.thinking) || extractReadableText(content.text) || extractReadableText(content.content);
      return text.trim() ? [{ kind: "markdown", label: "思考", text }] : [];
    }
    if (content && typeof content === "object" && content.type === "redacted_thinking") {
      return [{ kind: "markdown", label: "思考", text: "思考内容已隐藏。" }];
    }
    if (content && typeof content === "object" && content.type === "tool_result") {
      const text = extractReadableText(content.content ?? content.result);
      return [{ kind: "markdown", label: "工具结果", text: text || "工具未返回可读取的文本结果。" }];
    }
    const text = extractReadableText(content);
    return text.trim() ? [{ kind: "markdown", label: "正文", text }] : [];
  }

  const toolNames = new Map(content
    .filter((item) => item && typeof item === "object" && ["tool_use", "server_tool_use"].includes(item.type) && item.id)
    .map((item) => [item.id, firstVisibleScalar(item.name, item.tool_name)]));
  return content.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [{ kind: "markdown", label: "正文", text: item }] : [];
    if (!item || typeof item !== "object") return [];
    if (["tool_use", "server_tool_use"].includes(item.type)) {
      const name = firstVisibleScalar(item.name, item.tool_name) || "未知工具";
      const input = extractReadableText(item.input);
      return [
        { kind: "tool", name },
        ...(input.trim() ? [{ kind: "markdown", label: `工具输入 · ${name}`, text: input }] : []),
      ];
    }
    if (item.type === "redacted_thinking") {
      return [{ kind: "markdown", label: "思考", text: "思考内容已隐藏。" }];
    }
    if (item.type === "tool_result") {
      const text = extractReadableText(item.content ?? item.result);
      return [{
        kind: "markdown",
        label: `工具结果${toolNames.get(item.tool_use_id) ? ` · ${toolNames.get(item.tool_use_id)}` : ""}`,
        text: text || "工具未返回可读取的文本结果。",
      }];
    }
    if (item.type === "text" || item.type === "thinking") {
      const text = item.type === "thinking"
        ? extractReadableText(item.thinking) || extractReadableText(item.text) || extractReadableText(item.content)
        : extractReadableText(item.text ?? item.content);
      return text.trim() ? [{ kind: "markdown", label: item.type === "thinking" ? "思考" : "正文", text }] : [];
    }
    const text = extractReadableText(item);
    return text.trim() ? [{ kind: "markdown", label: "正文", text }] : [];
  });
}

function getReadableRecordParts(record) {
  const rootRecord = record && typeof record === "object" ? record : {};
  const nestedMessage = rootRecord.message;
  const message = nestedMessage && typeof nestedMessage === "object" && !Array.isArray(nestedMessage)
    ? nestedMessage
    : nestedMessage !== undefined && nestedMessage !== null
      ? { ...rootRecord, content: nestedMessage }
      : rootRecord;
  const contentValues = [message.content, message.text]
    .filter((value) => value !== undefined && value !== null);
  let parts = contentValues.flatMap(extractContentParts);
  if (!parts.length && message !== rootRecord) {
    parts = [rootRecord.content, rootRecord.text]
      .filter((value) => value !== undefined && value !== null)
      .flatMap(extractContentParts);
  }
  if (["tool_use", "server_tool_use", "tool_result"].includes(message.type)
    && !parts.some((part) => part.kind === "tool"
      || (message.type === "tool_result" && part.label?.startsWith("工具结果")))) {
    parts.push(...extractContentParts([message]));
  }

  const thoughtSources = message === rootRecord ? [message] : [message, rootRecord];
  const thoughtParts = thoughtSources.flatMap(collectThoughtParts);
  const existingThoughts = new Set(parts
    .filter((part) => part.kind === "markdown" && part.label === "思考")
    .map((part) => part.text));
  for (const part of thoughtParts) {
    if (existingThoughts.has(part.text)) continue;
    existingThoughts.add(part.text);
    parts.push(part);
  }

  const toolResult = rootRecord.toolUseResult ?? rootRecord.tool_use_result;
  if (toolResult !== undefined && toolResult !== null) {
    if (typeof toolResult === "object" && !Array.isArray(toolResult)) {
      const name = firstVisibleScalar(toolResult.name, toolResult.tool_name, toolResult.toolName);
      for (const key of ["stdout", "stderr", "output", "content", "result"]) {
        const text = extractReadableText(toolResult[key]);
        if (text.trim()) parts.push({ kind: "markdown", label: `工具结果${name ? ` · ${name}` : ` · ${key}`}`, text });
      }
    } else {
      const text = extractReadableText(toolResult);
      if (text.trim()) parts.push({ kind: "markdown", label: "工具结果", text });
    }
  }

  if (!parts.some((part) => part.label?.startsWith("工具结果"))) {
    const toolName = firstVisibleScalar(message.name, message.tool_name, message.toolName, rootRecord.toolName, rootRecord.tool_name);
    for (const key of ["result", "output", "stdout", "stderr"]) {
      const value = message[key] ?? rootRecord[key];
      const text = extractReadableText(value);
      if (text.trim()) parts.push({ kind: "markdown", label: `工具结果${toolName ? ` · ${toolName}` : ` · ${key}`}`, text });
    }
  }

  if (!parts.length) {
    const summaryFields = [
      ["子类型", rootRecord.subtype],
      ["操作", rootRecord.operation],
      ["工具", rootRecord.toolName ?? rootRecord.tool_name],
      ["状态", rootRecord.status],
      ["结束原因", rootRecord.stopReason ?? rootRecord.stop_reason],
      ["耗时", rootRecord.durationMs ?? rootRecord.duration_ms],
      ["消息数", rootRecord.messageCount ?? rootRecord.message_count],
      ["级别", rootRecord.level],
    ].filter(([, value]) => visibleScalar(value));
    if (summaryFields.length) {
      parts = [{ kind: "summary", label: "摘要", text: summaryFields.map(([label, value]) => `${label}：${visibleScalar(value)}`).join(" · ") }];
    }
  }
  return parts;
}

function recordRoleLabel(record) {
  const role = firstVisibleScalar(record?.message?.role, record?.role, record?.speaker);
  const labels = { user: "用户", assistant: "助手", tool: "工具", system: "系统" };
  return labels[role?.toLowerCase()] || role || firstVisibleScalar(record?.headline, record?.subtype, record?.type) || "会话记录";
}

function RecordBody({ record }) {
  const parts = getReadableRecordParts(record);
  const hasExtractedContent = parts.some((part) => part.kind === "markdown" || part.kind === "tool");
  const fallbackBlocks = !hasExtractedContent && Array.isArray(record?.blocks)
    ? record.blocks.filter((block) => block?.text)
    : [];
  if (parts.length === 0 && fallbackBlocks.length === 0) {
    return <div className="timeline-empty">暂无可提取的正文或摘要，可展开原始 JSON 查看。</div>;
  }
  return (
    <div className="timeline-body">
      {fallbackBlocks.length ? fallbackBlocks.map((block, index) => (
        <ContentBlock block={block} key={`${block.label || "record-block"}-${index}`} />
      )) : parts.map((part, index) => {
        if (part.kind === "tool") {
          return (
            <section className="block record-tool-call" key={`tool-${index}`}>
              <div className="block-label">工具调用</div>
              <code className="record-tool-name">{part.name}</code>
            </section>
          );
        }
        if (part.kind === "summary") {
          return <section className="block" key={`summary-${index}`}><div className="block-label">{part.label}</div><p className="record-summary">{part.text}</p></section>;
        }
        return <ContentBlock block={{ ...part, renderMode: "markdown" }} key={`${part.label}-${index}`} />;
      })}
    </div>
  );
}

function RawJsonDetails({ value }) {
  if (typeof value !== "string" || !value.length) return null;
  return (
    <details className="raw-json">
      <summary>原始 JSON</summary>
      <pre className="plain-block">{value}</pre>
    </details>
  );
}

function SessionRecordCard({ record, rawJson, label, context, timestamp }) {
  const eventType = firstVisibleScalar(record?.type, record?.subtype, "记录");
  return (
    <article className="timeline-card discovered-record">
      <div className="timeline-topline">
        <div>
          <div className="timeline-type">{label || recordRoleLabel(record)}</div>
          <div className="timeline-subline">
            <span>{formatDateTime(timestamp ?? record?.timestamp ?? record?.created_at ?? record?.createdAt)}</span>
            {context ? <span>{context}</span> : null}
          </div>
        </div>
        <div className="timeline-badge">{eventType}</div>
      </div>
      <RecordBody record={record} />
      <RawJsonDetails value={rawJson ?? record?.raw} />
    </article>
  );
}

function displayArtifactValue(artifact, keys, fallback = "未提供") {
  return firstVisibleScalar(...keys.map((key) => artifact?.[key])) || fallback;
}

function ArtifactSummaryItem({ artifact }) {
  const paths = [
    ["附件路径", artifact?.path],
    ["文件路径", artifact?.file_path],
    ["相对路径", artifact?.relative_path],
    ...(Array.isArray(artifact?.versions) ? artifact.versions.flatMap((version, index) => [
      [`版本 ${index + 1} 路径`, version?.path],
      [`版本 ${index + 1} 文件路径`, version?.file_path],
      [`版本 ${index + 1} 相对路径`, version?.relative_path],
    ]) : []),
  ].filter(([, value]) => visibleScalar(value));
  const title = displayArtifactValue(artifact, ["title", "name", "artifact_id", "id"], "未命名附件");
  const mediaType = displayArtifactValue(artifact, ["mime_type", "media_type", "kind", "type"]);
  const updatedAt = displayArtifactValue(artifact, ["updated_at", "updatedAt", "created_at", "createdAt"], "");
  const versions = Array.isArray(artifact?.versions) ? artifact.versions.length : 0;
  return (
    <article className="artifact-summary-item">
      <h3>{title}</h3>
      <dl className="artifact-core-fields">
        <div><dt>类型 / 媒体类型</dt><dd>{mediaType}</dd></div>
        <div><dt>更新时间</dt><dd>{updatedAt ? formatDateTime(updatedAt) : "未提供"}</dd></div>
        <div><dt>版本数</dt><dd>{formatCount(versions)}</dd></div>
      </dl>
      <details className="artifact-paths">
        <summary>查看路径</summary>
        {paths.length ? (
          <ul>{paths.map(([label, value], index) => <li key={`${label}-${index}`}><span>{label}：</span><code>{visibleScalar(value)}</code></li>)}</ul>
        ) : <p>未提供路径。</p>}
      </details>
    </article>
  );
}

function getSessionMetadataItems(detail, sourceLabels) {
  const metadata = detail?.metadata && typeof detail.metadata === "object" && !Array.isArray(detail.metadata)
    ? detail.metadata
    : {};
  const claude3p = metadata.claude3p && typeof metadata.claude3p === "object" && !Array.isArray(metadata.claude3p)
    ? metadata.claude3p
    : {};
  const project = metadata.project && typeof metadata.project === "object" && !Array.isArray(metadata.project)
    ? metadata.project
    : {};
  const items = [];
  const add = (key, label, value) => {
    if (/(key|token|secret|password|credential|authorization)/i.test(key)) return;
    const text = visibleScalar(value);
    if (text) items.push({ key: label, value: text });
  };

  add("session.title", "会话标题", detail?.title);
  add("session.updatedAt", "更新时间", detail?.updatedAt ? formatDateTime(detail.updatedAt) : "");
  add("session.sources", "来源", Array.isArray(detail?.sources)
    ? detail.sources.map((source) => sourceLabels.get(source) || source).join("、")
    : "");
  add("metadata.fileName", "文件名", metadata.fileName);
  if (Number.isFinite(metadata.fileSize) && metadata.fileSize >= 0) {
    const size = metadata.fileSize < 1024
      ? `${formatCount(metadata.fileSize)} B`
      : `${(metadata.fileSize / 1024).toFixed(1)} KB`;
    add("metadata.fileSize", "文件大小", size);
  }
  const createdAt = metadata.createdAt ?? metadata.created_at ?? claude3p.createdAt ?? claude3p.created_at;
  add("metadata.createdAt", "创建时间", createdAt ? formatDateTime(createdAt) : "");
  add("metadata.cwd", "工作目录", metadata.cwd ?? metadata.workingDirectory ?? claude3p.cwd ?? claude3p.workingDirectory);
  add("metadata.claude3p.title", "Claude Desktop Code 标题", claude3p.title);
  add("metadata.project.name", "项目名称", project.name ?? project.title);
  add("metadata.rootFrameId", "Root Frame ID", metadata.rootFrameId);
  const frameCount = metadata.frameCount ?? detail?.frames?.length;
  if (Number.isFinite(frameCount)) add("metadata.frameCount", "Frame 数量", formatCount(frameCount));
  const artifactCount = metadata.artifactCount ?? detail?.artifacts?.length;
  if (Number.isFinite(artifactCount)) add("metadata.artifactCount", "Artifact 数量", formatCount(artifactCount));
  if (Array.isArray(detail?.streams)) add("session.streamCount", "记录流数量", formatCount(detail.streams.length));
  return items;
}

function GuidePanel({ title, items }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {items.map((item) => (
        <div className="field-item" key={item.field}>
          <code>{item.field}</code>
          <p>{item.purpose}</p>
        </div>
      ))}
    </section>
  );
}

function BlockPanel({ title, blocks, emptyText }) {
  const visibleBlocks = blocks.filter((block) => block?.text);

  return (
    <section className="panel">
      <h2>{title}</h2>
      {visibleBlocks.length > 0 ? (
        <div className="timeline-body">
          {visibleBlocks.map((block, index) => (
            <ContentBlock block={block} key={`${title}-${index}`} />
          ))}
        </div>
      ) : (
        <div className="timeline-empty">{emptyText}</div>
      )}
    </section>
  );
}

function TimelineCard({ record }) {
  return (
    <SessionRecordCard
      record={record}
      label={recordRoleLabel(record)}
      context={`line ${record.lineNumber} · ${record.contextLabel || (record.parentUuid ? "parent" : "root")}`}
      rawJson={record.raw}
    />
  );
}

function WorkflowPanels({ workflowData }) {
  const summaryItems = [
    { key: "Workflow", value: workflowData.summary.title },
    { key: "runId", value: workflowData.summary.runId || "N/A" },
    { key: "taskId", value: workflowData.summary.taskId || "N/A" },
    { key: "状态", value: workflowData.summary.status || "N/A" },
    { key: "阶段数", value: formatCount(workflowData.summary.phaseCount) },
    { key: "Agent 数", value: formatCount(workflowData.summary.agentCount) },
    { key: "开始时间", value: formatDateTime(workflowData.summary.startedAt) },
    { key: "结束时间", value: formatDateTime(workflowData.summary.endedAt) },
    { key: "耗时", value: formatDuration(workflowData.summary.durationMs) },
    { key: "总 Tokens", value: formatCount(workflowData.summary.totalTokens) },
    { key: "总 Tool Calls", value: formatCount(workflowData.summary.totalToolCalls) },
  ];

  return (
    <>
      <section className="panel">
        <h2>样本结论</h2>
        <MetadataList items={summaryItems} />
      </section>

      <GuidePanel title="必要字段" items={workflowData.fieldGuide.essential} />
      <GuidePanel
        title="顺序与上下文"
        items={workflowData.fieldGuide.ordering.concat(workflowData.fieldGuide.linkage)}
      />
      <GuidePanel title="Markdown 字段" items={workflowData.fieldGuide.markdown} />
      <GuidePanel title="可忽略字段" items={workflowData.fieldGuide.ignored} />

      <section className="panel">
        <h2>阶段定义</h2>
        {workflowData.phases.map((phase, index) => (
          <div className="field-item" key={`${phase.title}-${index}`}>
            <code>
              phase {index + 1} · {phase.title}
            </code>
            <p>{phase.detail || "未提供阶段说明"}</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>进度类型分布</h2>
        <div className="pill-list">
          {workflowData.summary.progressTypeCounts.map((item) => (
            <span className="pill" key={item.type}>
              {item.type}: {item.count}
            </span>
          ))}
        </div>
      </section>

      {workflowData.errors.length > 0 ? (
        <section className="panel">
          <h2>解析错误</h2>
          {workflowData.errors.map((item, index) => (
            <div className="field-item" key={`${item.file}-${index}`}>
              <code>{item.file}</code>
              <p>{item.error}</p>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}

function TimelineSection({
  sessionData,
  selectedType,
  onSelectType,
  title = "时间线",
  subtitle,
}) {
  const filteredTimeline = useMemo(() => {
    if (selectedType === "all") {
      return sessionData.timeline;
    }

    return sessionData.timeline.filter((record) => record.type === selectedType);
  }, [selectedType, sessionData]);

  return (
    <>
      <div className="content-toolbar">
        <div>
          <h2>{title}</h2>
          <p>{subtitle || `当前展示 ${filteredTimeline.length} / ${sessionData.timeline.length} 条可排序记录`}</p>
        </div>
        <div className="tab-row">
          {buildTypeTabs(sessionData.summary.timelineTypeCounts, TYPE_TABS).map((tab) => (
            <button
              className={tab.value === selectedType ? "tab active" : "tab"}
              key={tab.value}
              onClick={() => onSelectType(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline">
        {filteredTimeline.map((record) => (
          <TimelineCard key={`${record.lineNumber}-${record.type}-${record.uuid || "meta"}`} record={record} />
        ))}
      </div>

      <section className="panel metadata-panel">
        <h2>非时间线元数据</h2>
        <details className="raw-json">
          <summary>展开查看 {sessionData.metadata.length} 条元数据</summary>
          <pre className="code-block">
            {JSON.stringify(
              sessionData.metadata.map(({ raw, isTimelineRecord, isMetaRecord, ...item }) => item),
              null,
              2,
            )}
          </pre>
        </details>
      </section>
    </>
  );
}

function WorkflowProgressSection({
  workflowData,
  selectedType,
  onSelectType,
}) {
  const filteredProgress = useMemo(() => {
    if (selectedType === "all") {
      return workflowData.progress;
    }

    return workflowData.progress.filter((record) => record.type === selectedType);
  }, [selectedType, workflowData]);

  return (
    <>
      <div className="content-toolbar">
        <div>
          <h2>Workflow 进度</h2>
          <p>当前展示 {filteredProgress.length} / {workflowData.progress.length} 条 workflowProgress 记录</p>
        </div>
        <div className="tab-row">
          {buildTypeTabs(workflowData.summary.progressTypeCounts, WORKFLOW_PROGRESS_TABS).map((tab) => (
            <button
              className={tab.value === selectedType ? "tab active" : "tab"}
              key={tab.value}
              onClick={() => onSelectType(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline">
        {filteredProgress.map((record) => (
          <TimelineCard key={`${record.lineNumber}-${record.type}-${record.headline}`} record={record} />
        ))}
      </div>
    </>
  );
}

function WorkflowView({
  loading,
  error,
  workflowData,
  selectedType,
  onSelectType,
  onFileChange,
}) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Workflow Viewer</p>
          <h1>按 JSON 结构还原单次 Workflow 的阶段、脚本与结果</h1>
          <p className="hero-text">
            可直接上传单个 <code>.json</code> 文件。展示时会把 <code>script</code> 按代码块渲染，把
            <code>promptPreview</code>、
            <code>resultPreview</code>、<code>result</code> 里的 Markdown 内容按正文方式展开。
          </p>
        </div>

        <label className="upload-panel">
          <span>载入新的 Workflow</span>
          <input accept=".json,.txt" type="file" onChange={onFileChange} />
        </label>
      </section>

      {loading ? <section className="panel status-panel">正在解析 Workflow JSON...</section> : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {workflowData ? (
        <section className="layout">
          <aside className="sidebar">
            <WorkflowPanels workflowData={workflowData} />
          </aside>

          <section className="content">
            <section className="panel selected-session-hero">
              <div className="selected-session-header">
                <div>
                  <p className="eyebrow">Selected Workflow</p>
                  <h2>{workflowData.summary.title}</h2>
                  <p className="selected-session-text">
                    workflow 主顺序来自 <code>workflowProgress</code> 数组原始顺序，Agent 卡片上额外展示真实启动时间、
                    所属阶段和结果摘要。
                  </p>
                </div>
                <div className="pill-list">
                  <span className="pill">status: {workflowData.summary.status || "N/A"}</span>
                  <span className="pill">phases: {formatCount(workflowData.summary.phaseCount)}</span>
                  <span className="pill">agents: {formatCount(workflowData.summary.agentCount)}</span>
                </div>
              </div>
            </section>

            {workflowData.summaryBlock ? (
              <BlockPanel title="Workflow 摘要" blocks={[workflowData.summaryBlock]} emptyText="未提供摘要" />
            ) : null}

            <BlockPanel
              title="Workflow Script"
              blocks={workflowData.scriptBlock ? [workflowData.scriptBlock] : []}
              emptyText="未提供 script 字段"
            />

            <BlockPanel
              title="Workflow Logs"
              blocks={workflowData.logBlocks}
              emptyText="未提供 workflow 级日志"
            />

            <BlockPanel
              title="Workflow Result"
              blocks={workflowData.resultBlocks}
              emptyText="未提供最终结果"
            />

            <WorkflowProgressSection
              workflowData={workflowData}
              selectedType={selectedType}
              onSelectType={onSelectType}
            />

            <section className="panel metadata-panel">
              <h2>原始 Workflow JSON</h2>
              <details className="raw-json" open={false}>
                <summary>展开查看完整 JSON</summary>
                <pre className="code-block">{JSON.stringify(workflowData.data, null, 2)}</pre>
              </details>
            </section>
          </section>
        </section>
      ) : null}
    </>
  );
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败 (${response.status})`);
  return payload;
}

function SourceState({ source }) {
  const labels = { available: "可用", warning: "部分可用", unavailable: "未找到", error: "读取失败", scanning: "扫描中" };
  return (
    <div className={`source-state source-${source.status}`}>
      <span className="source-state-dot" />
      <div>
        <strong>{source.label}</strong>
        <span>{labels[source.status] || source.status}</span>
      </div>
      {source.message ? <small>{source.message}</small> : null}
    </div>
  );
}

function DiscoveredRecord({ item }) {
  if (item.category === "timeline" && item.record) {
    return <TimelineCard record={item.record} />;
  }
  if (item.category === "error") {
    return (
      <article className="panel record-error">
        <div className="timeline-topline">
          <strong>第 {item.lineNumber} 行解析错误</strong>
          <span className="timeline-badge">解析错误</span>
        </div>
        <p>{item.error}</p>
        <RawJsonDetails value={item.rawLine} />
      </article>
    );
  }
  if (item.category === "csp-message") {
    return (
      <SessionRecordCard
        record={item.message}
        rawJson={item.rawJson}
        label={`Claude Science · ${recordRoleLabel(item.message)}`}
        context={`frame ${item.frameId} · idx ${item.lineNumber}`}
      />
    );
  }
  const record = item.record || {};
  return (
    <SessionRecordCard
      record={record}
      rawJson={record.raw}
      label={recordRoleLabel(record)}
      context={`第 ${item.lineNumber} 行 · ${item.streamKind}`}
    />
  );
}

function SessionDiscoveryView() {
  const [sources, setSources] = useState([]);
  const [scannedAt, setScannedAt] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [records, setRecords] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [recordError, setRecordError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ offset: "0", limit: "100" });
    if (sourceFilter !== "all") query.set("source", sourceFilter);
    Promise.all([requestJson("/api/sources"), requestJson(`/api/sessions?${query}`)])
      .then(([sourceData, sessionData]) => {
        if (!active) return;
        setSources(sourceData.sources || []);
        setScannedAt(sourceData.scannedAt || null);
        setSessions(sessionData.items || []);
        setTotal(sessionData.total || 0);
        setNextOffset((sessionData.offset || 0) + (sessionData.items || []).length);
        setSelectedId((previous) => (sessionData.items || []).some((item) => item.id === previous)
          ? previous
          : sessionData.items?.[0]?.id || "");
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "无法读取本机来源状态");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [sourceFilter, refreshVersion]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setRecords([]);
    setNextCursor(null);
    setRecordError("");
    if (!selectedId) return () => { active = false; };
    Promise.all([
      requestJson(`/api/sessions/${encodeURIComponent(selectedId)}`),
      requestJson(`/api/sessions/${encodeURIComponent(selectedId)}/records`),
    ])
      .then(([session, page]) => {
        if (!active) return;
        setDetail(session);
        setRecords(page.items || []);
        setNextCursor(page.nextCursor || null);
      })
      .catch((loadError) => {
        if (active) setRecordError(loadError instanceof Error ? loadError.message : "无法读取会话详情");
      });
    return () => { active = false; };
  }, [selectedId, refreshVersion]);

  async function refreshSources() {
    setRefreshing(true);
    setError("");
    try {
      const snapshot = await requestJson("/api/refresh", { method: "POST" });
      setSources(snapshot.sources || []);
      setScannedAt(snapshot.scannedAt || null);
      setRefreshVersion((version) => version + 1);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadMoreSessions() {
    setLoadingMore(true);
    try {
      const query = new URLSearchParams({ offset: String(nextOffset), limit: "100" });
      if (sourceFilter !== "all") query.set("source", sourceFilter);
      const page = await requestJson(`/api/sessions?${query}`);
      setSessions((items) => [...items, ...(page.items || [])]);
      setNextOffset((page.offset || 0) + (page.items || []).length);
      setTotal(page.total || 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法继续读取会话列表");
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadMoreRecords() {
    if (!nextCursor || !selectedId) return;
    setLoadingMore(true);
    setRecordError("");
    try {
      const page = await requestJson(`/api/sessions/${encodeURIComponent(selectedId)}/records?cursor=${encodeURIComponent(nextCursor)}`);
      setRecords((items) => [...items, ...(page.items || [])]);
      setNextCursor(page.nextCursor || null);
    } catch (loadError) {
      setRecordError(loadError instanceof Error ? loadError.message : "无法继续读取会话记录");
    } finally {
      setLoadingMore(false);
    }
  }

  const sourceLabels = new Map(sources.map((source) => [source.id, source.label]));
  const metadataItems = detail ? getSessionMetadataItems(detail, sourceLabels) : [];
  const auditSystemItems = records.filter((item) => item.streamKind === "audit" && item.record?.type === "system");
  const firstAuditSystemIndex = records.findIndex((item) => item.streamKind === "audit" && item.record?.type === "system");
  const isClaudeScienceSession = detail?.sources?.includes("claude-science") || false;
  const cspAssistantRecords = isClaudeScienceSession
    ? records.filter((item) => item.category === "csp-message" && recordRoleLabel(item.message) === "助手")
    : [];
  const cspAssistantThoughtCount = cspAssistantRecords.filter((item) => (
    getReadableRecordParts(item.message).some((part) => part.kind === "markdown" && part.label === "思考")
  )).length;

  return (
    <>
      <section className="hero discovery-hero">
        <div className="hero-copy">
          <p className="eyebrow">Local Session Discovery</p>
          <h1>自动发现本机 Claude 会话</h1>
          <p className="hero-text">
            本地 Node 服务启动时扫描 Claude Code、Claude Desktop Code（第三方登录模式）、Claude Desktop Cowork 与 Claude Science 来源。会话数据只在本机读取和展示。
          </p>
        </div>
        <div className="discovery-actions">
          <button className="primary-action" disabled={refreshing} onClick={refreshSources} type="button">
            {refreshing ? "正在刷新…" : "手动刷新来源"}
          </button>
          <small>上次扫描：{formatDateTime(scannedAt)}</small>
        </div>
      </section>

      <section className="source-grid">
        {sources.map((source) => <SourceState key={source.id} source={source} />)}
      </section>

      {error ? <section className="panel error-panel">{error}</section> : null}
      {loading ? <section className="panel status-panel">正在载入本机会话索引…</section> : null}

      {!loading ? (
        <section className="layout discovery-layout">
          <aside className="sidebar">
            <section className="panel">
              <div className="session-list-heading">
                <h2>发现的会话</h2>
                <span>{formatCount(total)}</span>
              </div>
              <div className="tab-row source-filter-tabs">
                <button className={sourceFilter === "all" ? "tab active" : "tab"} onClick={() => setSourceFilter("all")} type="button">全部</button>
                {sources.map((source) => (
                  <button className={sourceFilter === source.id ? "tab active" : "tab"} key={source.id} onClick={() => setSourceFilter(source.id)} type="button">
                    {source.label}
                  </button>
                ))}
              </div>
              <div className="session-nav-list discovered-session-list">
                {sessions.map((session) => (
                  <button className={selectedId === session.id ? "session-nav-card active" : "session-nav-card"} key={session.id} onClick={() => setSelectedId(session.id)} type="button">
                    <div className="session-nav-topline">
                      <strong>{session.title}</strong>
                      <span>{session.streamCount} 路记录</span>
                    </div>
                    <div className="session-nav-meta">
                      <span>{session.sources.map((source) => sourceLabels.get(source) || source).join("、")}</span>
                      <span>{formatCompactDateTime(session.updatedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
              {sessions.length === 0 ? <p className="timeline-empty">当前来源没有发现会话。</p> : null}
              {sessions.length < total ? (
                <button className="secondary-action full-width-action" disabled={loadingMore} onClick={loadMoreSessions} type="button">
                  {loadingMore ? "正在载入…" : "加载更多会话"}
                </button>
              ) : null}
            </section>
          </aside>

          <section className="content">
            {recordError ? <section className="panel error-panel">{recordError}</section> : null}
            {detail ? (
              <>
                <section className="panel selected-session-hero">
                  <div className="selected-session-header">
                    <div>
                      <p className="eyebrow">{detail.sources.map((source) => sourceLabels.get(source) || source).join(" · ")}</p>
                      <h2>{detail.title}</h2>
                      <p className="selected-session-text">本机更新时间：{formatDateTime(detail.updatedAt)} · 当前 ID 仅在本次发现索引中有效。</p>
                    </div>
                    <div className="pill-list">
                      {detail.streams.map((stream, index) => <span className="pill" key={`${stream.kind}-${index}`}>{stream.label}</span>)}
                    </div>
                  </div>
                </section>

                <section className="panel">
                  <h2>会话元数据</h2>
                  {metadataItems.length ? <MetadataList items={metadataItems} /> : <p className="timeline-empty">没有可展示的已知元数据字段。</p>}
                </section>

                {detail.frames?.length ? (
                  <details className="panel csp-frames-panel">
                    <summary className="csp-frames-summary">
                      <span className="csp-frames-title">Claude Science Frames</span>
                      <span className="csp-frames-count">{formatCount(detail.frames.length)} 个 frames</span>
                    </summary>
                    <div className="csp-frames-content">
                      {detail.frames.map((frame, index) => <div className="field-item" key={frame.frame_id || frame.id || index}><code>{frame.title || frame.name || frame.frame_id || frame.id}</code><pre className="plain-block">{JSON.stringify(frame, null, 2)}</pre></div>)}
                    </div>
                  </details>
                ) : null}

                {detail.artifacts?.length ? (
                  <details className="panel artifact-panel">
                    <summary className="artifact-panel-summary">
                      <span className="artifact-panel-title">附件元数据与路径</span>
                      <span className="artifact-panel-count">{formatCount(detail.artifacts.length)} 个 artifacts</span>
                    </summary>
                    <div className="artifact-panel-content">
                      {detail.artifacts.map((artifact, index) => <ArtifactSummaryItem artifact={artifact} key={artifact.artifact_id || artifact.id || index} />)}
                    </div>
                  </details>
                ) : null}

                <div className="content-toolbar discovered-record-toolbar">
                  <div>
                    <h2>会话记录</h2>
                    {isClaudeScienceSession ? (
                      <p className="record-summary">
                        当前已加载的 Claude Science 助手消息 {formatCount(cspAssistantRecords.length)} 条，其中 {formatCount(cspAssistantThoughtCount)} 条包含来源记录的可展示思考块；其余助手消息的来源记录中未发现可展示的思考字段。
                      </p>
                    ) : <p>分批读取，原始顺序按文件行或 CSP 消息序号保留。</p>}
                  </div>
                </div>
                <div className="timeline">
                  {records.map((item, index) => {
                    if (item.streamKind === "audit" && item.record?.type === "system") {
                      if (index !== firstAuditSystemIndex) return null;
                      return (
                        <details className="collapsed-audit" key="audit-system-events">
                          <summary>展开 {auditSystemItems.length} 条 system 审计事件</summary>
                          <div className="timeline">
                            {auditSystemItems.map((auditItem, auditIndex) => <DiscoveredRecord item={auditItem} key={`audit-${auditIndex}-${auditItem.lineNumber}`} />)}
                          </div>
                        </details>
                      );
                    }
                    return <DiscoveredRecord item={item} key={`${item.streamKind}-${item.lineNumber}-${index}`} />;
                  })}
                </div>
                {records.length === 0 && !recordError ? <section className="panel timeline-empty">此会话暂无可展示记录。</section> : null}
                {nextCursor ? <button className="secondary-action" disabled={loadingMore} onClick={loadMoreRecords} type="button">{loadingMore ? "正在载入…" : "加载更多记录"}</button> : null}
              </>
            ) : !recordError && sessions.length === 0 ? (
              <section className="panel empty-panel">尚未发现可展示的会话。检查来源状态后可手动刷新。</section>
            ) : !recordError ? (
              <section className="panel status-panel">选择左侧会话查看详情。</section>
            ) : null}
          </section>
        </section>
      ) : null}
    </>
  );
}

function App() {
  const [viewMode, setViewMode] = useState("sessions");
  const [workflowData, setWorkflowData] = useState(null);
  const [selectedWorkflowType, setSelectedWorkflowType] = useState("all");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");

  async function handleWorkflowFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorkflowLoading(true);
    setWorkflowError("");
    try {
      setWorkflowData(parseClaudeCodeWorkflowJson(await file.text(), file.name));
      setSelectedWorkflowType("all");
      setViewMode("workflow");
    } catch (fileError) {
      setWorkflowError(fileError instanceof Error ? fileError.message : "文件读取失败");
    } finally {
      setWorkflowLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="view-switcher">
        <div><p className="eyebrow">Viewer Mode</p><h2>选择展示入口</h2></div>
        <div className="tab-row">
          {VIEW_TABS.map((tab) => <button className={viewMode === tab.value ? "tab active" : "tab"} key={tab.value} onClick={() => setViewMode(tab.value)} type="button">{tab.label}</button>)}
        </div>
      </section>
      {viewMode === "sessions" ? <SessionDiscoveryView /> : null}
      {viewMode === "workflow" ? (
        <WorkflowView
          error={workflowError}
          loading={workflowLoading}
          onFileChange={handleWorkflowFileChange}
          onSelectType={setSelectedWorkflowType}
          selectedType={selectedWorkflowType}
          workflowData={workflowData}
        />
      ) : null}
    </main>
  );
}

export default App;

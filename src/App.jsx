import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  collectClaudeCodeDirectoryEntries,
  collectClaudeCodeDirectoryUploadEntries,
  parseClaudeCodeDirectory,
  parseClaudeCodeSessionJsonl,
  parseClaudeCodeWorkflowJson,
} from "./lib/claudeCode/index.js";

const DEFAULT_SESSION_URL = new URL(
  "../8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl",
  import.meta.url,
).href;

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
  { value: "subagents", label: "Workflow 目录" },
  { value: "session", label: "单 Session" },
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
    <article className={`timeline-card timeline-${record.type}`}>
      <div className="timeline-topline">
        <div>
          <div className="timeline-type">{record.headline}</div>
          <div className="timeline-subline">
            <span>{formatDateTime(record.timestamp)}</span>
            <span>line {record.lineNumber}</span>
            <span>{record.contextLabel || (record.parentUuid ? "parent" : "root")}</span>
          </div>
        </div>
        <div className="timeline-badge">{record.type}</div>
      </div>

      {record.blocks.length > 0 ? (
        <div className="timeline-body">
          {record.blocks.map((block, index) => (
            <ContentBlock block={block} key={`${record.uuid || record.lineNumber}-${index}`} />
          ))}
        </div>
      ) : (
        <div className="timeline-empty">该记录没有可提取的正文，保留原始 JSON 供排查。</div>
      )}

      <details className="raw-json">
        <summary>原始 JSON</summary>
        <pre className="code-block">{JSON.stringify(record, null, 2)}</pre>
      </details>
    </article>
  );
}

function SessionPanels({ sessionData, extraPanels = [] }) {
  const summaryItems = [
    { key: "Session", value: sessionData.summary.sessionId || "N/A" },
    { key: "标题", value: sessionData.summary.title },
    { key: "总记录数", value: formatCount(sessionData.summary.recordCount) },
    { key: "时间线记录", value: formatCount(sessionData.summary.timelineCount) },
    { key: "元数据记录", value: formatCount(sessionData.summary.metadataCount) },
    { key: "开始时间", value: formatDateTime(sessionData.summary.startedAt) },
    { key: "结束时间", value: formatDateTime(sessionData.summary.endedAt) },
    { key: "总费用 (USD)", value: sessionData.summary.costUSD ?? "N/A" },
    { key: "累计耗时", value: formatDuration(sessionData.summary.totalDurationMs) },
  ];

  return (
    <>
      {extraPanels}

      <section className="panel">
        <h2>样本结论</h2>
        <MetadataList items={summaryItems} />
      </section>

      <GuidePanel title="必要字段" items={sessionData.fieldGuide.essential} />
      <GuidePanel
        title="顺序与上下文"
        items={sessionData.fieldGuide.ordering.concat(sessionData.fieldGuide.linkage)}
      />
      <GuidePanel title="Markdown 字段" items={sessionData.fieldGuide.markdown} />

      <section className="panel">
        <h2>记录类型分布</h2>
        <div className="pill-list">
          {sessionData.summary.typeCounts.map((item) => (
            <span className="pill" key={item.type}>
              {item.type}: {item.count}
            </span>
          ))}
        </div>
      </section>

      {sessionData.errors.length > 0 ? (
        <section className="panel">
          <h2>解析错误</h2>
          {sessionData.errors.map((item) => (
            <div className="field-item" key={item.lineNumber}>
              <code>line {item.lineNumber}</code>
              <p>{item.error}</p>
            </div>
          ))}
        </section>
      ) : null}
    </>
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

function getParsedFileKindLabel(parsedFile) {
  const labels = {
    "agent-session": "Sub Agent Session",
    journal: "journal",
    json: "普通 JSON",
    meta: "元配置 JSON",
    session: "Session",
    workflow: "Workflow 描述",
  };

  return labels[parsedFile.kind] || parsedFile.kind;
}

function getParsedFileDisplayValue(parsedFile) {
  const result = parsedFile.result;

  if (parsedFile.parser === "json" || parsedFile.parser === "workflow") {
    return result?.data ?? null;
  }

  return {
    summary: result?.summary || {},
    errors: result?.errors || [],
    records: (result?.records || []).map(({ raw, ...record }) => record),
  };
}

function ParsedDirectoryFileView({ parsedFile }) {
  const result = parsedFile.result;
  const summaryItems = [
    { key: "类型", value: getParsedFileKindLabel(parsedFile) },
    { key: "格式", value: parsedFile.format.toUpperCase() },
    { key: "解析器", value: parsedFile.parser },
    { key: "错误", value: formatCount(parsedFile.errors.length) },
  ];

  if (typeof result?.summary?.recordCount === "number") {
    summaryItems.push({ key: "记录数", value: formatCount(result.summary.recordCount) });
  }

  return (
    <>
      <section className="panel selected-session-hero">
        <div className="selected-session-header">
          <div>
            <p className="eyebrow">Parsed Directory File</p>
            <h2>{parsedFile.relativePath}</h2>
            <p className="selected-session-text">
              该文件来自当前 Workflow 目录扫描，展示的是独立于 UI 的解析结果。
            </p>
          </div>
          <div className="pill-list">
            <span className="pill">{getParsedFileKindLabel(parsedFile)}</span>
            <span className="pill">{parsedFile.format.toUpperCase()}</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>文件概览</h2>
        <MetadataList items={summaryItems} />
      </section>

      {parsedFile.errors.length > 0 ? (
        <section className="panel">
          <h2>解析错误</h2>
          {parsedFile.errors.map((item, index) => (
            <div className="field-item" key={`${parsedFile.key}-${index}`}>
              <code>{item.file || parsedFile.relativePath}</code>
              <p>{item.error}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <h2>解析后的内容</h2>
        <details className="raw-json" open>
          <summary>展开查看结构化结果</summary>
          <pre className="code-block">{JSON.stringify(getParsedFileDisplayValue(parsedFile), null, 2)}</pre>
        </details>
      </section>
    </>
  );
}

function MainSessionView({
  loading,
  error,
  sessionData,
  selectedType,
  onSelectType,
  onFileChange,
}) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Claude Code Session Viewer</p>
          <h1>按 JSONL 原始结构还原单次 Session</h1>
          <p className="hero-text">
            页面默认加载仓库里的真实样本，也支持本地上传新的
            <code>.jsonl</code> 文件。时间线按 <code>timestamp</code> 排序，遇到同一时间或缺失时间时回退到原始
            line number，避免打乱上下文。
          </p>
        </div>

        <label className="upload-panel">
          <span>载入新的 Session</span>
          <input accept=".jsonl,.txt" type="file" onChange={onFileChange} />
        </label>
      </section>

      {loading ? <section className="panel status-panel">正在解析 JSONL Session...</section> : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {sessionData ? (
        <section className="layout">
          <aside className="sidebar">
            <SessionPanels sessionData={sessionData} />
          </aside>

          <section className="content">
            <TimelineSection sessionData={sessionData} selectedType={selectedType} onSelectType={onSelectType} />
          </section>
        </section>
      ) : null}
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

function SubAgentDirectoryView({
  loading,
  error,
  directoryData,
  directorySource,
  directoryInputRef,
  selectedSession,
  selectedParsedFile,
  selectedType,
  onSelectType,
  onSelectSession,
  onSelectParsedFile,
  onDirectoryChange,
  onSelectWorkflowDirectory,
  onOpenMainSession,
  onOpenWorkflow,
}) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Dynamic Workflow Directory Viewer</p>
          <h1>读取一个 Workflow 目录，浏览所有 JSON 与 JSONL</h1>
         <p className="hero-text">
            选择本机 Workflow 目录后，页面会递归读取该目录及其子目录内的全部
            <code>.json</code> 与 <code>.jsonl</code> 文件。<code>wf_*.json</code> 仅在存在时作为
            Workflow 描述增强展示，不再是目录解析的前提。
         </p>
       </div>

        <div className="directory-load-actions">
          <button
            className="directory-picker-button"
            disabled={loading}
            onClick={onSelectWorkflowDirectory}
            type="button"
          >
            {loading ? "正在读取目录..." : "选择 Workflow 目录"}
          </button>
          <p>
            浏览器会请求读取所选目录的权限，并只在本机递归解析其中的 <code>.json</code> 与
            <code>.jsonl</code> 文件。
          </p>
          <input
            aria-label="选择 Workflow 目录"
            className="directory-file-input"
            directory=""
            multiple
            onChange={onDirectoryChange}
            ref={directoryInputRef}
            type="file"
            webkitdirectory=""
          />
        </div>
     </section>

      {loading ? <section className="panel status-panel">正在解析 Session 目录...</section> : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {!loading && !error && !directoryData ? (
       <section className="panel empty-panel">
          点击“选择 Workflow 目录”并在系统选择器中选取目录。系统会递归解析其中所有 `.json` 和 `.jsonl` 文件。
       </section>
      ) : null}

      {directoryData ? (
        <section className="layout subagent-page-layout">
          <aside className="sidebar">
            <section className="panel">
              <h2>目录概览</h2>
              <MetadataList
               items={[
                  { key: "所选目录", value: directorySource?.directoryName || "未选择" },
                 { key: "目录", value: directoryData.rootName },
                  { key: "已解析文件", value: formatCount(directoryData.summary.parsedFileCount) },
                  { key: "JSON 文件", value: formatCount(directoryData.summary.jsonFileCount) },
                  { key: "JSONL 文件", value: formatCount(directoryData.summary.jsonlFileCount) },
                 { key: "工作流数", value: formatCount(directoryData.summary.workflowCount) },
                 { key: "会话数", value: formatCount(directoryData.summary.sessionCount) },
                 { key: "主 Session 数", value: formatCount(directoryData.summary.mainSessionCount) },
                  { key: "Workflow 描述数", value: formatCount(directoryData.summary.workflowFileCount) },
                 { key: "journal 数", value: formatCount(directoryData.summary.journalCount) },
                  { key: "跳过文件", value: formatCount(directorySource?.skippedFiles?.length || 0) },
                 { key: "警告", value: formatCount(directoryData.summary.warningCount) },
                 { key: "错误", value: formatCount(directoryData.summary.errorCount) },
               ]}
              />
            </section>

            <section className="panel">
              <h2>全部解析文件</h2>
              <p className="directory-file-note">
                目录中每个 JSON / JSONL 均可点击查看解析结果；命名不符合旧 workflow 规则的 JSON 也会保留。
              </p>
              <div className="session-nav-list directory-file-list">
                {directoryData.parsedFiles.map((parsedFile) => (
                  <button
                    className={
                      selectedParsedFile?.key === parsedFile.key
                        ? "session-nav-card active"
                        : "session-nav-card"
                    }
                    key={parsedFile.key}
                    onClick={() => onSelectParsedFile(parsedFile.key)}
                    type="button"
                  >
                    <div className="session-nav-topline">
                      <strong>{parsedFile.format.toUpperCase()}</strong>
                      <span>{getParsedFileKindLabel(parsedFile)}</span>
                    </div>
                    <div className="session-nav-title">{parsedFile.relativePath}</div>
                    <div className="session-nav-meta">
                      <span>parser: {parsedFile.parser}</span>
                      <span>{parsedFile.errors.length} 个错误</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {directoryData.mainSessions.length > 0 ? (
              <section className="panel">
                <h2>主 Session</h2>
                <div className="session-nav-list">
                  {directoryData.mainSessions.map((entry) => (
                    <button
                      className="session-nav-card"
                      key={entry.key}
                      onClick={() => onOpenMainSession(entry)}
                      type="button"
                    >
                      <div className="session-nav-topline">
                        <strong>主 Agent</strong>
                        <span>{formatCount(entry.sessionData.summary.recordCount)} 条记录</span>
                      </div>
                      <div className="session-nav-title">{entry.sourceName}</div>
                      <div className="session-nav-meta">
                        <span>{formatCompactDateTime(entry.sessionData.summary.startedAt)}</span>
                        <span>{entry.sessionData.summary.sessionId || "unknown session"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="panel">
              <h2>工作流</h2>
              {directoryData.workflows.map((workflow) => (
                <div className="field-item" key={workflow.key}>
                  <code>{workflow.label}</code>
                  <p>
                    {workflow.summary.sessionCount} 个 Session，started {workflow.summary.startedCount}，result{" "}
                    {workflow.summary.resultCount}
                  </p>
                  {workflow.workflowData ? (
                    <button
                      className="tab"
                      onClick={() => onOpenWorkflow(workflow.workflowData)}
                      type="button"
                    >
                      打开 Workflow
                    </button>
                  ) : null}
                </div>
              ))}
            </section>

            <section className="panel">
              <h2>按顺序跳转</h2>
              <div className="session-nav-list">
                {directoryData.orderedSessions.map((entry) => (
                  <button
                    className={selectedSession?.key === entry.key ? "session-nav-card active" : "session-nav-card"}
                    key={entry.key}
                    onClick={() => {
                      onSelectSession(entry.key);
                      onSelectParsedFile("");
                    }}
                    type="button"
                  >
                    <div className="session-nav-topline">
                      <strong>#{entry.globalSequence}</strong>
                      <span>{entry.workflowLabel}</span>
                    </div>
                    <div className="session-nav-title">{entry.sourceName}</div>
                    <div className="session-nav-meta">
                      <span>{formatCompactDateTime(entry.sessionData.summary.startedAt)}</span>
                      <span>{entry.agentId || "unknown agent"}</span>
                    </div>
                    <p>{buildResultPreview(entry.journalResultRecord?.result)}</p>
                  </button>
                ))}
              </div>
            </section>

            {directoryData.workflows.some((workflow) => workflow.warnings.length > 0) ? (
              <section className="panel">
                <h2>顺序告警</h2>
                {directoryData.workflows.flatMap((workflow) =>
                  workflow.warnings.map((warning) => (
                    <div className="field-item" key={`${workflow.key}-${warning}`}>
                      <code>{workflow.label}</code>
                      <p>{warning}</p>
                    </div>
                  )),
                )}
              </section>
            ) : null}

            {directoryData.errors.length > 0 ? (
              <section className="panel">
                <h2>目录解析错误</h2>
                {directoryData.errors.map((item, index) => (
                  <div className="field-item" key={`${item.file}-${index}`}>
                    <code>{item.file}</code>
                    <p>{item.error}</p>
                  </div>
                ))}
              </section>
            ) : null}
          </aside>

          <section className="content">
            {selectedParsedFile ? (
              <ParsedDirectoryFileView parsedFile={selectedParsedFile} />
            ) : selectedSession ? (
              <>
                <section className="panel selected-session-hero">
                  <div className="selected-session-header">
                    <div>
                      <p className="eyebrow">Selected Sub Agent</p>
                      <h2>
                        #{selectedSession.globalSequence} {selectedSession.sourceName}
                      </h2>
                      <p className="selected-session-text">
                        入口顺序来自 {selectedSession.workflowLabel}/journal.jsonl，第{" "}
                        {selectedSession.journalStartedRecord?.lineNumber || "?"} 行启动记录；启动时间取自该
                        Session 首个时间线时间戳。
                      </p>
                    </div>
                    <div className="pill-list">
                      <span className="pill">agentId: {selectedSession.agentId || "N/A"}</span>
                      <span className="pill">spawnDepth: {selectedSession.meta?.spawnDepth ?? "N/A"}</span>
                      <span className="pill">agentType: {selectedSession.meta?.agentType || "N/A"}</span>
                    </div>
                  </div>
                </section>

                <div className="session-panels-grid">
                  <SessionPanels
                    sessionData={selectedSession.sessionData}
                    extraPanels={[
                      <section className="panel" key="subagent-order">
                        <h2>调用顺序</h2>
                        <MetadataList
                          items={[
                            { key: "全局顺序", value: `#${selectedSession.globalSequence}` },
                            { key: "工作流", value: selectedSession.workflowLabel },
                            { key: "启动时间", value: formatDateTime(selectedSession.sessionData.summary.startedAt) },
                            {
                              key: "journal 行号",
                              value: selectedSession.journalStartedRecord?.lineNumber || "未找到",
                            },
                          ]}
                        />
                      </section>,
                      <section className="panel" key="subagent-meta">
                        <h2>元配置</h2>
                        <pre className="code-block">
                          {JSON.stringify(selectedSession.meta || {}, null, 2)}
                        </pre>
                      </section>,
                      <section className="panel" key="subagent-result">
                        <h2>journal 返回结果</h2>
                        {typeof selectedSession.journalResultRecord?.result === "string" ? (
                          <div className="markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {selectedSession.journalResultRecord.result}
                            </ReactMarkdown>
                          </div>
                        ) : selectedSession.journalResultRecord?.result ? (
                          <pre className="code-block">
                            {JSON.stringify(selectedSession.journalResultRecord.result, null, 2)}
                          </pre>
                        ) : (
                          <div className="timeline-empty">尚未在 journal.jsonl 中发现 result 记录。</div>
                        )}
                      </section>,
                    ]}
                  />
                </div>

                <TimelineSection
                  sessionData={selectedSession.sessionData}
                  selectedType={selectedType}
                  onSelectType={onSelectType}
                  title="Sub Agent 时间线"
                  subtitle={`当前展示 ${selectedSession.sessionData.timeline.length} 条可排序记录，展示规则与主 Agent 保持一致`}
                />
              </>
            ) : directoryData.mainSessions.length > 0 ? (
              <section className="panel empty-panel">
                目录中已找到主 Session，请从左侧打开；如需查看 Sub Agent，请确认选择范围包含
                <code>subagents/workflows</code>。
              </section>
            ) : (
              <section className="panel empty-panel">目录中没有可用的 Session。</section>
            )}
          </section>
        </section>
      ) : null}
    </>
  );
}

function App() {
  const [viewMode, setViewMode] = useState("subagents");
  const [sessionData, setSessionData] = useState(null);
  const [selectedType, setSelectedType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [workflowData, setWorkflowData] = useState(null);
  const [selectedWorkflowType, setSelectedWorkflowType] = useState("all");
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [workflowError, setWorkflowError] = useState("");

  const [subAgentData, setSubAgentData] = useState(null);
  const [directorySource, setDirectorySource] = useState(null);
  const workflowDirectoryInputRef = useRef(null);
  const [selectedSubAgentKey, setSelectedSubAgentKey] = useState("");
  const [selectedParsedFileKey, setSelectedParsedFileKey] = useState("");
  const [selectedSubAgentType, setSelectedSubAgentType] = useState("all");
  const [subAgentLoading, setSubAgentLoading] = useState(false);
  const [subAgentError, setSubAgentError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDefaultSession() {
      try {
        const response = await fetch(DEFAULT_SESSION_URL);
        const text = await response.text();

        if (!active) {
          return;
        }

        setSessionData(
          parseClaudeCodeSessionJsonl(text, "8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl"),
        );
      } catch (loadError) {
        if (!active) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "无法加载默认样本");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDefaultSession();

    return () => {
      active = false;
    };
  }, []);

  const selectedSubAgentSession = useMemo(() => {
    if (!subAgentData) {
      return null;
    }

    return (
      subAgentData.orderedSessions.find((entry) => entry.key === selectedSubAgentKey) ||
      subAgentData.orderedSessions[0] ||
      null
    );
  }, [selectedSubAgentKey, subAgentData]);

  const selectedParsedFile = useMemo(() => {
    if (!subAgentData || !selectedParsedFileKey) {
      return null;
    }

    return subAgentData.parsedFiles.find((entry) => entry.key === selectedParsedFileKey) || null;
  }, [selectedParsedFileKey, subAgentData]);

  function applyDirectoryEntries(entries, source) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("该目录及其子目录中没有可解析的 JSON 或 JSONL 文件。");
    }

    const parsedDirectory = parseClaudeCodeDirectory(entries);
    setSubAgentData(parsedDirectory);
    setDirectorySource(source);
    setSelectedParsedFileKey("");
    setSelectedSubAgentKey(parsedDirectory.orderedSessions[0]?.key || "");
    setSelectedSubAgentType("all");
    setViewMode("subagents");
  }

  async function handleWorkflowDirectorySelect() {
    if (typeof window.showDirectoryPicker !== "function") {
      workflowDirectoryInputRef.current?.click();
      return;
    }

    setSubAgentLoading(true);
    setSubAgentError("");

    try {
      const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
      const loadedDirectory = await collectClaudeCodeDirectoryEntries(directoryHandle);

      applyDirectoryEntries(loadedDirectory.entries, {
        directoryName: loadedDirectory.rootName,
        skippedFiles: loadedDirectory.skippedFiles,
      });
    } catch (directoryError) {
      if (directoryError?.name !== "AbortError") {
        setSubAgentError(directoryError instanceof Error ? directoryError.message : "目录读取失败");
      }
    } finally {
      setSubAgentLoading(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      setSessionData(parseClaudeCodeSessionJsonl(text, file.name));
      setViewMode("session");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "文件读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleWorkflowFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setWorkflowLoading(true);
    setWorkflowError("");

    try {
      const text = await file.text();
      setWorkflowData(parseClaudeCodeWorkflowJson(text, file.name));
      setSelectedWorkflowType("all");
      setViewMode("workflow");
    } catch (fileError) {
      setWorkflowError(fileError instanceof Error ? fileError.message : "文件读取失败");
    } finally {
      setWorkflowLoading(false);
    }
  }

  async function handleDirectoryChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";

    if (!files.length) {
      return;
    }

    setSubAgentLoading(true);
    setSubAgentError("");

    try {
      const loadedDirectory = await collectClaudeCodeDirectoryUploadEntries(files);

      applyDirectoryEntries(loadedDirectory.entries, {
        directoryName: loadedDirectory.rootName,
        skippedFiles: loadedDirectory.skippedFiles,
      });
    } catch (directoryError) {
      setSubAgentError(directoryError instanceof Error ? directoryError.message : "目录读取失败");
    } finally {
      setSubAgentLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="view-switcher">
        <div>
          <p className="eyebrow">Viewer Mode</p>
          <h2>选择展示入口</h2>
        </div>
        <div className="tab-row">
          {VIEW_TABS.map((tab) => (
            <button
              className={viewMode === tab.value ? "tab active" : "tab"}
              key={tab.value}
              onClick={() => setViewMode(tab.value)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {viewMode === "session" ? (
        <MainSessionView
          error={error}
          loading={loading}
          onFileChange={handleFileChange}
          onSelectType={setSelectedType}
          selectedType={selectedType}
          sessionData={sessionData}
        />
      ) : null}

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

      {viewMode === "subagents" ? (
        <SubAgentDirectoryView
          directoryData={subAgentData}
          directorySource={directorySource}
          directoryInputRef={workflowDirectoryInputRef}
          error={subAgentError}
          loading={subAgentLoading}
          onDirectoryChange={handleDirectoryChange}
          onOpenMainSession={(entry) => {
            setSessionData(entry.sessionData);
            setSelectedType("all");
            setViewMode("session");
          }}
          onOpenWorkflow={(data) => {
            setWorkflowData(data);
            setSelectedWorkflowType("all");
            setViewMode("workflow");
          }}
          onSelectParsedFile={setSelectedParsedFileKey}
          onSelectSession={setSelectedSubAgentKey}
          onSelectType={setSelectedSubAgentType}
          onSelectWorkflowDirectory={handleWorkflowDirectorySelect}
          selectedParsedFile={selectedParsedFile}
          selectedSession={selectedSubAgentSession}
          selectedType={selectedSubAgentType}
        />
      ) : null}
    </main>
  );
}

export default App;

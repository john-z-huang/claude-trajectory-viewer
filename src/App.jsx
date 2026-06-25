import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseSessionText, parseSubAgentDirectory } from "./lib/sessionParser";

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

const VIEW_TABS = [
  { value: "session", label: "单 Session" },
  { value: "subagents", label: "Sub Agent 目录" },
];

function formatDateTime(value) {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function buildResultPreview(value) {
  if (!value) {
    return "尚未发现返回结果";
  }

  const firstLine = value
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
  if (!block.text) {
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

function TimelineCard({ record }) {
  return (
    <article className={`timeline-card timeline-${record.type}`}>
      <div className="timeline-topline">
        <div>
          <div className="timeline-type">{record.headline}</div>
          <div className="timeline-subline">
            <span>{formatDateTime(record.timestamp)}</span>
            <span>line {record.lineNumber}</span>
            {record.parentUuid ? <span>parent</span> : <span>root</span>}
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
  ];

  return (
    <>
      {extraPanels}

      <section className="panel">
        <h2>样本结论</h2>
        <MetadataList items={summaryItems} />
      </section>

      <section className="panel">
        <h2>必要字段</h2>
        {sessionData.fieldGuide.essential.map((item) => (
          <div className="field-item" key={item.field}>
            <code>{item.field}</code>
            <p>{item.purpose}</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>顺序与上下文</h2>
        {sessionData.fieldGuide.ordering.concat(sessionData.fieldGuide.linkage).map((item) => (
          <div className="field-item" key={item.field}>
            <code>{item.field}</code>
            <p>{item.purpose}</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Markdown 字段</h2>
        {sessionData.fieldGuide.markdown.map((item) => (
          <div className="field-item" key={item.field}>
            <code>{item.field}</code>
            <p>{item.purpose}</p>
          </div>
        ))}
      </section>

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
          {TYPE_TABS.map((tab) => (
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
        <pre className="code-block">
          {JSON.stringify(
            sessionData.metadata.map((item) => ({
              type: item.type,
              lineNumber: item.lineNumber,
              sessionId: item.sessionId,
              mode: item.mode,
              permissionMode: item.permissionMode,
              aiTitle: item.aiTitle,
              lastPrompt: item.lastPrompt,
            })),
            null,
            2,
          )}
        </pre>
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

function SubAgentDirectoryView({
  loading,
  error,
  directoryData,
  selectedSession,
  selectedType,
  onSelectType,
  onSelectSession,
  onDirectoryChange,
}) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Sub Agent Directory Viewer</p>
          <h1>按 `journal.jsonl` 顺序浏览多个 Sub Agent Session</h1>
          <p className="hero-text">
            目录上传后会自动识别 <code>journal.jsonl</code>、<code>agent-*.jsonl</code> 和
            <code>*.meta.json</code>，用 journal 里的启动顺序作为主序，再回填每个 Sub Agent 的启动时间。
          </p>
        </div>

        <label className="upload-panel">
          <span>载入 Sub Agent 目录</span>
          <input directory="" multiple type="file" webkitdirectory="" onChange={onDirectoryChange} />
        </label>
      </section>

      {loading ? <section className="panel status-panel">正在解析目录中的 Sub Agent Session...</section> : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {!loading && !error && !directoryData ? (
        <section className="panel empty-panel">
          请选择包含 `journal.jsonl`、`agent-*.jsonl`、`*.meta.json` 的目录。支持直接选择 `workflows`
          目录，也支持选择某个单独的 `wf_*` 工作流目录。
        </section>
      ) : null}

      {directoryData ? (
        <section className="layout subagent-page-layout">
          <aside className="sidebar">
            <section className="panel">
              <h2>目录概览</h2>
              <MetadataList
                items={[
                  { key: "目录", value: directoryData.rootName },
                  { key: "工作流数", value: formatCount(directoryData.summary.workflowCount) },
                  { key: "会话数", value: formatCount(directoryData.summary.sessionCount) },
                  { key: "journal 数", value: formatCount(directoryData.summary.journalCount) },
                  { key: "警告", value: formatCount(directoryData.summary.warningCount) },
                  { key: "错误", value: formatCount(directoryData.summary.errorCount) },
                ]}
              />
            </section>

            <section className="panel">
              <h2>工作流</h2>
              {directoryData.workflows.map((workflow) => (
                <div className="field-item" key={workflow.key}>
                  <code>{workflow.label}</code>
                  <p>
                    {workflow.summary.sessionCount} 个 Session，started {workflow.summary.startedCount}，result{" "}
                    {workflow.summary.resultCount}
                  </p>
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
                    onClick={() => onSelectSession(entry.key)}
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
          </aside>

          <section className="content">
            {selectedSession ? (
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
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedSession.journalResultRecord?.result || "尚未在 journal.jsonl 中发现 result 记录。"}
                          </ReactMarkdown>
                        </div>
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
            ) : (
              <section className="panel empty-panel">目录中没有可用的 Sub Agent Session。</section>
            )}
          </section>
        </section>
      ) : null}
    </>
  );
}

function App() {
  const [viewMode, setViewMode] = useState("session");
  const [sessionData, setSessionData] = useState(null);
  const [selectedType, setSelectedType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [subAgentData, setSubAgentData] = useState(null);
  const [selectedSubAgentKey, setSelectedSubAgentKey] = useState("");
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

        setSessionData(parseSessionText(text, "8ab6ca2d-ece3-4e1f-8b10-beba29afd2d8.jsonl"));
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
      setSessionData(parseSessionText(text, file.name));
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "文件读取失败");
    } finally {
      setLoading(false);
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
      const supportedFiles = files.filter(
        (file) =>
          /\.(jsonl|meta\.json)$/i.test(file.name) &&
          !file.name.startsWith("."),
      );

      const entries = await Promise.all(
        supportedFiles.map(async (file) => ({
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
          text: await file.text(),
        })),
      );

      const parsedDirectory = parseSubAgentDirectory(entries);
      setSubAgentData(parsedDirectory);
      setSelectedSubAgentKey(parsedDirectory.orderedSessions[0]?.key || "");
      setSelectedSubAgentType("all");
      setViewMode("subagents");
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
      ) : (
        <SubAgentDirectoryView
          directoryData={subAgentData}
          error={subAgentError}
          loading={subAgentLoading}
          onDirectoryChange={handleDirectoryChange}
          onSelectSession={setSelectedSubAgentKey}
          onSelectType={setSelectedSubAgentType}
          selectedSession={selectedSubAgentSession}
          selectedType={selectedSubAgentType}
        />
      )}
    </main>
  );
}

export default App;

import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseSessionText } from "./lib/sessionParser";

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

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
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

function App() {
  const [sessionData, setSessionData] = useState(null);
  const [selectedType, setSelectedType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const filteredTimeline = useMemo(() => {
    if (!sessionData) {
      return [];
    }

    if (selectedType === "all") {
      return sessionData.timeline;
    }

    return sessionData.timeline.filter((record) => record.type === selectedType);
  }, [selectedType, sessionData]);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
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

  if (loading) {
    return <main className="shell loading-state">正在解析 JSONL Session...</main>;
  }

  if (error) {
    return <main className="shell error-state">{error}</main>;
  }

  if (!sessionData) {
    return <main className="shell error-state">没有可展示的数据。</main>;
  }

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
    <main className="shell">
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
          <input accept=".jsonl,.txt" type="file" onChange={handleFileChange} />
        </label>
      </section>

      <section className="layout">
        <aside className="sidebar">
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
        </aside>

        <section className="content">
          <div className="content-toolbar">
            <div>
              <h2>时间线</h2>
              <p>
                当前展示 {filteredTimeline.length} / {sessionData.timeline.length} 条可排序记录
              </p>
            </div>
            <div className="tab-row">
              {TYPE_TABS.map((tab) => (
                <button
                  className={tab.value === selectedType ? "tab active" : "tab"}
                  key={tab.value}
                  onClick={() => setSelectedType(tab.value)}
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
        </section>
      </section>
    </main>
  );
}

export default App;

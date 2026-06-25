const TIMELINE_TYPES = new Set([
  "user",
  "assistant",
  "attachment",
  "system",
  "queue-operation",
]);

const META_TYPES = new Set([
  "mode",
  "permission-mode",
  "ai-title",
  "last-prompt",
  "file-history-snapshot",
]);

const MARKDOWN_HINT =
  /(^|\n)(#{1,6}\s|[-*]\s|\d+\.\s|>\s)|```|\|.+\||\*\*|`[^`]+`/m;

function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, "\n");
}

function normalizeRelativePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

function getBaseName(path) {
  const normalized = normalizeRelativePath(path);
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  return parts.at(-1) || "";
}

function getDirectoryName(path) {
  const normalized = normalizeRelativePath(path);
  if (!normalized || !normalized.includes("/")) {
    return "";
  }

  return normalized.slice(0, normalized.lastIndexOf("/"));
}

function stripSharedRoot(entries) {
  const firstSegments = new Set(
    entries
      .map((entry) => normalizeRelativePath(entry.relativePath || entry.name))
      .filter(Boolean)
      .map((path) => path.split("/")[0]),
  );

  if (firstSegments.size !== 1) {
    return {
      rootName: "",
      files: entries.map((entry) => ({
        ...entry,
        relativePath: normalizeRelativePath(entry.relativePath || entry.name),
      })),
    };
  }

  const [rootName] = [...firstSegments];
  const prefix = `${rootName}/`;

  return {
    rootName,
    files: entries.map((entry) => {
      const originalPath = normalizeRelativePath(entry.relativePath || entry.name);
      const nextPath = originalPath.startsWith(prefix)
        ? originalPath.slice(prefix.length)
        : originalPath === rootName
          ? ""
          : originalPath;

      return {
        ...entry,
        relativePath: nextPath || entry.name,
      };
    }),
  };
}

function parseJsonLine(line, lineNumber) {
  try {
    return {
      value: JSON.parse(line),
      error: null,
      lineNumber,
      raw: line,
    };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
      lineNumber,
      raw: line,
    };
  }
}

function parseJsonLines(sourceText) {
  const normalized = normalizeLineEndings(sourceText);
  return normalized
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => parseJsonLine(line, lineNumber));
}

function sortTimeline(a, b) {
  if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
    return a.timestamp.localeCompare(b.timestamp);
  }

  if (a.timestamp && !b.timestamp) {
    return -1;
  }

  if (!a.timestamp && b.timestamp) {
    return 1;
  }

  return a.lineNumber - b.lineNumber;
}

function summarizeObject(value) {
  return Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined && item !== "")
    .map(([key, item]) => ({
      key,
      value:
        typeof item === "object" ? JSON.stringify(item, null, 2) : String(item),
    }));
}

function looksLikeMarkdown(text) {
  return MARKDOWN_HINT.test(text);
}

function pickRenderMode(text, preferredMode = "plain") {
  if (!text) {
    return "plain";
  }

  if (preferredMode === "markdown") {
    return "markdown";
  }

  return looksLikeMarkdown(text) ? "markdown" : "plain";
}

function toJsonBlock(label, value) {
  return {
    label,
    renderMode: "code",
    text: JSON.stringify(value, null, 2),
  };
}

function extractMessageBlocks(message) {
  if (!message) {
    return [];
  }

  if (typeof message.content === "string") {
    return [
      {
        label: "message.content",
        renderMode: pickRenderMode(message.content, "markdown"),
        text: message.content,
      },
    ];
  }

  if (!Array.isArray(message.content)) {
    return [];
  }

  return message.content.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    if (item.type === "text") {
      return [
        {
          label: `message.content[${index}].text`,
          renderMode: "markdown",
          text: item.text ?? "",
        },
      ];
    }

    if (item.type === "thinking") {
      return [
        {
          label: `message.content[${index}].thinking`,
          renderMode: "markdown",
          text: item.thinking ?? "",
        },
      ];
    }

    if (item.type === "tool_result") {
      return [
        {
          label: `message.content[${index}].tool_result`,
          renderMode: pickRenderMode(item.content, "plain"),
          text: item.content ?? "",
        },
      ];
    }

    if (item.type === "tool_use") {
      return [
        {
          label: `message.content[${index}].tool_use`,
          renderMode: "code",
          text: JSON.stringify(
            {
              id: item.id,
              name: item.name,
              input: item.input,
            },
            null,
            2,
          ),
        },
      ];
    }

    return [toJsonBlock(`message.content[${index}]`, item)];
  });
}

function extractAttachmentBlocks(attachment) {
  if (!attachment) {
    return [];
  }

  if (attachment.type === "file") {
    const file = attachment.content?.file;
    return [
      {
        label: attachment.displayPath || attachment.filename || "attachment.file",
        renderMode: pickRenderMode(file?.content ?? "", "markdown"),
        text: file?.content ?? "",
      },
    ];
  }

  if (attachment.type === "skill_listing") {
    return [
      {
        label: "attachment.content",
        renderMode: "markdown",
        text: attachment.content ?? "",
      },
    ];
  }

  if (attachment.type === "agent_listing_delta") {
    return [
      {
        label: "attachment.addedLines",
        renderMode: "markdown",
        text: (attachment.addedLines || []).join("\n"),
      },
    ];
  }

  if (attachment.type === "queued_command") {
    return [
      {
        label: "attachment.prompt",
        renderMode: "code",
        text: attachment.prompt ?? "",
      },
    ];
  }

  if (attachment.type === "opened_file_in_ide") {
    return [
      {
        label: "attachment.filename",
        renderMode: "plain",
        text: attachment.filename ?? "",
      },
    ];
  }

  if (attachment.type === "task_reminder") {
    return [
      {
        label: "attachment.task_reminder",
        renderMode: "plain",
        text: `itemCount: ${attachment.itemCount ?? 0}`,
      },
    ];
  }

  return [toJsonBlock(`attachment.${attachment.type || "unknown"}`, attachment)];
}

function extractSystemBlocks(record) {
  const summary = summarizeObject({
    subtype: record.subtype,
    level: record.level,
    stopReason: record.stopReason,
    durationMs: record.durationMs,
    messageCount: record.messageCount,
    hookCount: record.hookCount,
  });

  return summary.length
    ? [
        {
          label: "system.summary",
          renderMode: "plain",
          text: summary.map((item) => `${item.key}: ${item.value}`).join("\n"),
        },
      ]
    : [];
}

function extractQueueBlocks(record) {
  return record.content
    ? [
        {
          label: "queue.content",
          renderMode: "code",
          text: record.content,
        },
      ]
    : [];
}

function buildHeadline(record) {
  if (record.type === "user" || record.type === "assistant") {
    return record.message?.role || record.type;
  }

  if (record.type === "attachment") {
    return `attachment.${record.attachment?.type || "unknown"}`;
  }

  if (record.type === "system") {
    return `system.${record.subtype || "event"}`;
  }

  if (record.type === "queue-operation") {
    return `queue.${record.operation || "event"}`;
  }

  return record.type;
}

function extractBlocks(record) {
  if (record.type === "user" || record.type === "assistant") {
    const blocks = extractMessageBlocks(record.message);
    if (record.toolUseResult) {
      blocks.push(toJsonBlock("toolUseResult", record.toolUseResult));
    }
    return blocks;
  }

  if (record.type === "attachment") {
    return extractAttachmentBlocks(record.attachment);
  }

  if (record.type === "system") {
    return extractSystemBlocks(record);
  }

  if (record.type === "queue-operation") {
    return extractQueueBlocks(record);
  }

  return [];
}

function formatTypeCounts(records) {
  const counts = new Map();

  for (const record of records) {
    counts.set(record.type, (counts.get(record.type) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function buildFieldGuide() {
  return {
    ordering: [
      {
        field: "timestamp",
        purpose: "时间线主排序字段。样本里所有需要展示的对话/附件/系统事件都带有 ISO 时间戳。",
      },
      {
        field: "lineNumber",
        purpose: "同一 timestamp 或缺失 timestamp 时的稳定回退顺序，保证还原 JSONL 原始顺序。",
      },
    ],
    linkage: [
      {
        field: "uuid",
        purpose: "当前记录的唯一标识。",
      },
      {
        field: "parentUuid",
        purpose: "将消息、附件、工具结果串成会话上下文树。",
      },
      {
        field: "sessionId",
        purpose: "标识整个 Session。",
      },
    ],
    essential: [
      {
        field: "type",
        purpose: "决定记录该如何解释和展示。",
      },
      {
        field: "message.content",
        purpose: "用户/助手正文，最核心展示字段。",
      },
      {
        field: "attachment",
        purpose: "文件附件、技能列表、队列命令等扩展内容。",
      },
      {
        field: "content",
        purpose: "queue-operation 这类事件的主体内容。",
      },
      {
        field: "subtype / operation",
        purpose: "区分 system、queue-operation 的具体事件种类。",
      },
    ],
    markdown: [
      {
        field: "message.content (string)",
        purpose: "用户直接输入里可能包含 Markdown。",
      },
      {
        field: "assistant.message.content[].text",
        purpose: "助手最终输出经常包含标题、列表、表格和代码块。",
      },
      {
        field: "assistant.message.content[].thinking",
        purpose: "思考内容常带列表和段落结构，按 Markdown 更易读。",
      },
      {
        field: "attachment.content.file.content",
        purpose: "文件附件正文，样本中的 task.md 就是 Markdown。",
      },
      {
        field: "attachment.content / attachment.addedLines",
        purpose: "技能列表、Agent 列表等内容本身就是 Markdown 列表。",
      },
    ],
  };
}

function toSessionRecords(parsedLines) {
  const errors = parsedLines
    .filter((entry) => entry.error)
    .map(({ lineNumber, error, raw }) => ({
      lineNumber,
      error,
      raw,
    }));

  const records = parsedLines
    .filter((entry) => entry.value)
    .map(({ value, lineNumber, raw }) => ({
      ...value,
      lineNumber,
      raw,
      isTimelineRecord:
        TIMELINE_TYPES.has(value.type) || Boolean(value.timestamp),
      isMetaRecord: META_TYPES.has(value.type),
    }));

  return { errors, records };
}

function parseJsonObjectText(sourceText, sourceName) {
  try {
    return {
      data: JSON.parse(sourceText),
      error: null,
      sourceName,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
      sourceName,
    };
  }
}

function getAgentIdFromSourceName(sourceName) {
  const match = /agent-([^.]+)\.jsonl$/i.exec(sourceName);
  return match?.[1] || null;
}

function compareNullableTimestamps(left, right) {
  if (left && right && left !== right) {
    return left.localeCompare(right);
  }

  if (left && !right) {
    return -1;
  }

  if (!left && right) {
    return 1;
  }

  return 0;
}

function buildJournalSummary(records) {
  return {
    startedCount: records.filter((record) => record.type === "started").length,
    resultCount: records.filter((record) => record.type === "result").length,
  };
}

export function parseSessionText(sourceText, sourceName = "session.jsonl") {
  const parsedLines = parseJsonLines(sourceText);
  const { errors, records } = toSessionRecords(parsedLines);

  const timeline = records
    .filter((record) => record.isTimelineRecord)
    .sort(sortTimeline)
    .map((record) => ({
      ...record,
      headline: buildHeadline(record),
      blocks: extractBlocks(record),
    }));

  const metadata = records.filter((record) => !record.isTimelineRecord);
  const titleRecord = [...records].reverse().find((record) => record.type === "ai-title");
  const sessionIdRecord = records.find((record) => record.sessionId);
  const startedAt = timeline[0]?.timestamp ?? null;
  const endedAt = timeline.at(-1)?.timestamp ?? null;

  return {
    sourceName,
    records,
    errors,
    timeline,
    metadata,
    summary: {
      title: titleRecord?.aiTitle || sourceName.replace(/\.jsonl$/i, ""),
      sessionId: sessionIdRecord?.sessionId || null,
      recordCount: records.length,
      timelineCount: timeline.length,
      metadataCount: metadata.length,
      startedAt,
      endedAt,
      typeCounts: formatTypeCounts(records),
      timelineTypeCounts: formatTypeCounts(timeline),
    },
    fieldGuide: buildFieldGuide(),
  };
}

export function parseJournalText(sourceText, sourceName = "journal.jsonl") {
  const parsedLines = parseJsonLines(sourceText);
  const errors = parsedLines
    .filter((entry) => entry.error)
    .map(({ lineNumber, error, raw }) => ({
      lineNumber,
      error,
      raw,
    }));

  const records = parsedLines
    .filter((entry) => entry.value)
    .map(({ value, lineNumber, raw }) => ({
      ...value,
      lineNumber,
      raw,
    }));

  return {
    sourceName,
    records,
    errors,
    summary: buildJournalSummary(records),
  };
}

export function parseSubAgentDirectory(entries) {
  const supportedEntries = entries
    .map((entry) => ({
      ...entry,
      relativePath: normalizeRelativePath(entry.relativePath || entry.name),
    }))
    .filter((entry) => entry.relativePath)
    .filter((entry) => /\.(jsonl|meta\.json)$/i.test(entry.relativePath))
    .filter((entry) => !entry.relativePath.startsWith("."));

  const { rootName, files } = stripSharedRoot(supportedEntries);
  const workflows = new Map();

  for (const file of files) {
    const directoryPath = getDirectoryName(file.relativePath);
    const workflowKey = directoryPath || ".";
    const workflowLabel = workflowKey === "." ? rootName || "root" : getBaseName(workflowKey);

    if (!workflows.has(workflowKey)) {
      workflows.set(workflowKey, {
        key: workflowKey,
        label: workflowLabel,
        relativePath: workflowKey,
        sessionFiles: [],
        metaFiles: [],
        journalFile: null,
      });
    }

    const workflow = workflows.get(workflowKey);
    const baseName = getBaseName(file.relativePath);

    if (baseName === "journal.jsonl") {
      workflow.journalFile = file;
      continue;
    }

    if (/\.meta\.json$/i.test(baseName)) {
      workflow.metaFiles.push(file);
      continue;
    }

    if (/\.jsonl$/i.test(baseName)) {
      workflow.sessionFiles.push(file);
    }
  }

  const workflowList = [...workflows.values()]
    .map((workflow) => {
      const errors = [];
      const warnings = [];
      const metaByAgentId = new Map();
      const sessionByAgentId = new Map();
      const journal = workflow.journalFile
        ? parseJournalText(workflow.journalFile.text, workflow.journalFile.relativePath)
        : null;

      if (journal?.errors.length) {
        errors.push(
          ...journal.errors.map((item) => ({
            scope: "journal",
            file: journal.sourceName,
            ...item,
          })),
        );
      }

      for (const metaFile of workflow.metaFiles) {
        const parsedMeta = parseJsonObjectText(metaFile.text, metaFile.relativePath);
        const agentId = getAgentIdFromSourceName(metaFile.relativePath.replace(/\.meta\.json$/i, ".jsonl"));

        if (parsedMeta.error) {
          errors.push({
            scope: "meta",
            file: metaFile.relativePath,
            error: parsedMeta.error,
          });
          continue;
        }

        if (agentId) {
          metaByAgentId.set(agentId, parsedMeta.data);
        }
      }

      for (const sessionFile of workflow.sessionFiles) {
        const sessionData = parseSessionText(sessionFile.text, getBaseName(sessionFile.relativePath));
        const agentId =
          getAgentIdFromSourceName(sessionFile.relativePath) ||
          sessionData.records.find((record) => record.agentId)?.agentId ||
          null;

        const entry = {
          key: sessionFile.relativePath,
          agentId,
          relativePath: sessionFile.relativePath,
          sourceName: sessionData.sourceName,
          sessionData,
          meta: agentId ? metaByAgentId.get(agentId) || null : null,
          journalStartedRecord: null,
          journalResultRecord: null,
          workflowKey: workflow.key,
          workflowLabel: workflow.label,
          orderIndex: Number.POSITIVE_INFINITY,
        };

        if (!agentId) {
          warnings.push(`无法从 ${sessionFile.relativePath} 推断 agentId。`);
        } else {
          sessionByAgentId.set(agentId, entry);
        }
      }

      const orderedSessions = [];
      const seenAgentIds = new Set();

      if (journal) {
        journal.records.forEach((record, index) => {
          if (!record.agentId) {
            return;
          }

          const session = sessionByAgentId.get(record.agentId);
          if (!session) {
            warnings.push(
              `${journal.sourceName} 第 ${record.lineNumber} 行引用了缺失的 agent-${record.agentId}.jsonl。`,
            );
            return;
          }

          if (record.type === "started" && !seenAgentIds.has(record.agentId)) {
            session.journalStartedRecord = record;
            session.orderIndex = index;
            orderedSessions.push(session);
            seenAgentIds.add(record.agentId);
          }

          if (record.type === "result") {
            session.journalResultRecord = record;
          }
        });
      } else {
        warnings.push(`${workflow.label} 缺少 journal.jsonl，已退回按会话起始时间排序。`);
      }

      for (const session of sessionByAgentId.values()) {
        if (!seenAgentIds.has(session.agentId)) {
          orderedSessions.push(session);
        }
      }

      orderedSessions.sort((left, right) => {
        const leftHasOrder = Number.isFinite(left.orderIndex);
        const rightHasOrder = Number.isFinite(right.orderIndex);

        if (leftHasOrder && rightHasOrder && left.orderIndex !== right.orderIndex) {
          return left.orderIndex - right.orderIndex;
        }

        if (leftHasOrder && !rightHasOrder) {
          return -1;
        }

        if (!leftHasOrder && rightHasOrder) {
          return 1;
        }

        const timestampComparison = compareNullableTimestamps(
          left.sessionData.summary.startedAt,
          right.sessionData.summary.startedAt,
        );
        if (timestampComparison !== 0) {
          return timestampComparison;
        }

        return left.relativePath.localeCompare(right.relativePath);
      });

      orderedSessions.forEach((session, index) => {
        session.sequenceNumber = index + 1;
      });

      return {
        key: workflow.key,
        label: workflow.label,
        relativePath: workflow.relativePath,
        sessions: orderedSessions,
        journal,
        warnings,
        errors,
        summary: {
          sessionCount: orderedSessions.length,
          startedCount: journal?.summary.startedCount || 0,
          resultCount: journal?.summary.resultCount || 0,
        },
      };
    })
    .sort((left, right) => {
      const leftStart = left.sessions[0]?.sessionData.summary.startedAt || null;
      const rightStart = right.sessions[0]?.sessionData.summary.startedAt || null;
      const timestampComparison = compareNullableTimestamps(leftStart, rightStart);
      if (timestampComparison !== 0) {
        return timestampComparison;
      }

      return left.relativePath.localeCompare(right.relativePath);
    });

  const orderedSessions = workflowList.flatMap((workflow, workflowIndex) =>
    workflow.sessions.map((session, sessionIndex) => ({
      ...session,
      workflowSequence: workflowIndex + 1,
      globalSequence: sessionIndex + 1,
    })),
  );

  orderedSessions.forEach((session, index) => {
    session.globalSequence = index + 1;
  });

  return {
    rootName: rootName || "subagents",
    workflows: workflowList,
    orderedSessions,
    summary: {
      workflowCount: workflowList.length,
      sessionCount: orderedSessions.length,
      journalCount: workflowList.filter((workflow) => workflow.journal).length,
      errorCount: workflowList.reduce((count, workflow) => count + workflow.errors.length, 0),
      warningCount: workflowList.reduce((count, workflow) => count + workflow.warnings.length, 0),
    },
  };
}

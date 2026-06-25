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

export function parseSessionText(sourceText, sourceName = "session.jsonl") {
  const normalized = normalizeLineEndings(sourceText);
  const parsedLines = normalized
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => parseJsonLine(line, lineNumber));

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

/**
 * Claude Code 原始文件的无 UI 依赖工具。
 *
 * 这些函数只负责解码 JSON / JSONL、规范化目录路径和识别可解析文件；
 * 不引入 React，也不生成任何界面组件。
 */

export function normalizeRelativePath(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

export function getBaseName(path) {
  const normalized = normalizeRelativePath(path);
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("/");
  return parts.at(-1) || "";
}

export function getDirectoryName(path) {
  const normalized = normalizeRelativePath(path);
  if (!normalized || !normalized.includes("/")) {
    return "";
  }

  return normalized.slice(0, normalized.lastIndexOf("/"));
}

export function stripSharedRoot(entries = []) {
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

/**
 * 解码 JSONL，同时保留行号、原始文本和单行错误，便于调用方容错展示。
 */
export function parseJsonlText(sourceText) {
  return String(sourceText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => parseJsonLine(line, lineNumber));
}

/**
 * 解码单个 JSON 文件，而不让语法错误中断目录中其他文件的解析。
 */
export function parseJsonText(sourceText, sourceName = "source.json") {
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

export function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const normalized = new Date(value);
    if (!Number.isNaN(normalized.getTime())) {
      return normalized.toISOString();
    }
  }

  return null;
}

function getCandidatePath(fileOrPath) {
  if (typeof fileOrPath === "string") {
    return fileOrPath;
  }

  if (!fileOrPath || typeof fileOrPath !== "object") {
    return "";
  }

  return fileOrPath.webkitRelativePath || fileOrPath.relativePath || fileOrPath.name || "";
}

/**
 * 判断目录中的一个文件是否需要交给 Claude Code 解析器。
 *
 * dynamic workflow 的文件命名会随 Claude Code 版本变化，因此不再依赖
 * `wf_*.json`、`*.meta.json` 等特定文件名；只要是 JSON 或 JSONL 均会被保留。
 */
export function isSupportedClaudeCodeDirectoryFile(fileOrPath) {
  const relativePath = normalizeRelativePath(getCandidatePath(fileOrPath));
  const baseName = getBaseName(relativePath);

  if (!relativePath || !baseName) {
    return false;
  }

  return /\.(json|jsonl)$/i.test(baseName);
}

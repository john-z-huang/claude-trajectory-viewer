import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";
import { parseSessionText } from "../src/lib/claudeCode/parser.js";

const PAGE_SIZE = 60;
const JSONL_EXTENSION = ".jsonl";
const JSON_EXTENSION = ".json";

const SOURCE_INFO = [
  { id: "claude-code", label: "Claude Code" },
  { id: "claude-3p", label: "Claude Desktop Code（第三方登录模式）" },
  { id: "claude-local-agent-mode", label: "Claude Desktop Cowork" },
  { id: "claude-science", label: "Claude Science / CSP" },
];

const SQLITE_COLUMNS = {
  projects: ["id", "project_id", "name", "title", "cwd", "path", "created_at", "updated_at"],
  frames: [
    "id", "frame_id", "project_id", "parent_frame_id", "root_frame_id", "is_hidden",
    "name", "title", "kind", "type", "status", "created_at", "updated_at",
  ],
  frame_messages: ["frame_id", "idx", "msg_json", "msg_uuid"],
  artifacts: [
    "id", "artifact_id", "project_id", "frame_id", "name", "title", "path", "file_path",
    "relative_path", "mime_type", "media_type", "kind", "type", "created_at", "updated_at",
    "current_version_id",
  ],
  artifact_versions: [
    "id", "artifact_id", "version_id", "version", "name", "title", "path", "file_path",
    "relative_path", "mime_type", "media_type", "created_at", "updated_at",
  ],
};

function sourcePaths(homeDir) {
  const claude3p = path.join(homeDir, "Library", "Application Support", "Claude-3p");
  return {
    claudeCode: path.join(homeDir, ".claude", "projects"),
    claude3pSessions: path.join(claude3p, "claude-code-sessions"),
    localAgentMode: path.join(claude3p, "local-agent-mode-sessions"),
    cspOrgs: path.join(homeDir, ".csp", "sandbox", "home", ".claude-science", "orgs"),
  };
}

function shortError(error) {
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    return "没有权限读取该来源目录或文件。";
  }
  if (error?.code === "ENOENT") {
    return "来源目录或文件不存在。";
  }
  if (error?.code === "ERR_SQLITE_ERROR" || error?.code === "SQLITE_ERROR") {
    return "CSP 数据库无法读取，或数据库结构与已知版本不兼容。";
  }
  if (error instanceof Error && /^(CSP |SQLite 查询表)/.test(error.message)) return error.message;
  return "读取来源时发生未预期错误。";
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function listFiles(root, extensions) {
  const files = [];
  const warnings = [];
  let rootExists = true;

  async function visit(directory, isRoot = false) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isRoot && error?.code === "ENOENT") {
        rootExists = false;
        return;
      }
      warnings.push(shortError(error));
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (!isWithinRoot(root, fullPath) || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }

  await visit(root, true);
  return { files: files.sort(), warnings, rootExists };
}

async function getFileSummary(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return { updatedAt: stat.mtime.toISOString(), size: stat.size };
  } catch {
    return { updatedAt: null, size: null };
  }
}

function metadataFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  const fields = [
    ["sessionId", ["sessionId", "session_id"]],
    ["cliSessionId", ["cliSessionId", "cli_session_id"]],
    ["title", ["title", "name", "displayName"]],
    ["cwd", ["cwd", "workingDirectory"]],
    ["createdAt", ["createdAt", "created_at", "startedAt", "started_at"]],
    ["updatedAt", ["updatedAt", "updated_at", "endedAt", "ended_at"]],
  ];
  for (const [target, names] of fields) {
    for (const name of names) {
      const candidate = value[name];
      if (["string", "number"].includes(typeof candidate) && String(candidate).length <= 2048) {
        result[target] = candidate;
        break;
      }
    }
  }
  return result;
}

function makeSession({ source, sources = [source], title, sessionId, metadata = {}, streams = [], updatedAt = null, details = {} }) {
  return {
    id: randomUUID(),
    source,
    sources: [...new Set(sources)],
    title: title || "未命名会话",
    sessionId: sessionId || metadata.sessionId || metadata.cliSessionId || null,
    updatedAt: updatedAt || metadata.updatedAt || metadata.createdAt || null,
    metadata,
    streams,
    ...details,
  };
}

function displayFileName(filePath) {
  return path.basename(filePath);
}

async function scanClaudeCode(root) {
  const result = await listFiles(root, new Set([JSONL_EXTENSION]));
  if (!result.rootExists) {
    return {
      sessions: [],
      status: { id: "claude-code", status: "unavailable", message: "未找到 Claude Code 项目会话目录。", sessionCount: 0, warnings: [] },
    };
  }

  const sessions = [];
  for (const filePath of result.files) {
    const stat = await getFileSummary(filePath);
    const name = displayFileName(filePath);
    const id = path.basename(name, JSONL_EXTENSION);
    sessions.push(makeSession({
      source: "claude-code",
      title: id,
      sessionId: id,
      updatedAt: stat.updatedAt,
      metadata: { fileName: name, fileSize: stat.size },
      streams: [{ kind: "transcript", label: "Claude Code 会话轨迹", path: filePath, name }],
    }));
  }
  return {
    sessions,
    status: {
      id: "claude-code",
      status: result.warnings.length ? "warning" : "available",
      message: result.warnings[0] || null,
      sessionCount: sessions.length,
      warnings: result.warnings,
    },
  };
}

async function readJsonMetadata(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return { value: metadataFields(JSON.parse(text)), error: null };
  } catch (error) {
    return { value: {}, error: shortError(error) };
  }
}

function normalizedId(value) {
  if (value === null || value === undefined) return "";
  return path.basename(String(value)).replace(/\.jsonl?$/i, "").toLowerCase();
}

async function scanClaude3p(root, transcriptSessions) {
  const result = await listFiles(root, new Set([JSON_EXTENSION]));
  if (!result.rootExists) {
    return {
      sessions: [],
      status: { id: "claude-3p", status: "unavailable", message: "未找到 Claude Desktop Code 会话元数据目录。", sessionCount: 0, warnings: [] },
    };
  }

  const transcriptIndex = new Map();
  for (const session of transcriptSessions) {
    for (const stream of session.streams) {
      const key = normalizedId(stream.name);
      if (!key) continue;
      if (!transcriptIndex.has(key)) transcriptIndex.set(key, []);
      transcriptIndex.get(key).push(session);
    }
  }

  const sessions = [];
  const warnings = [...result.warnings];
  for (const metadataPath of result.files) {
    const { value: metadata, error } = await readJsonMetadata(metadataPath);
    if (error) {
      warnings.push(error);
      continue;
    }
    const cliKey = normalizedId(metadata.cliSessionId);
    const sessionKey = normalizedId(metadata.sessionId);
    const candidates = transcriptIndex.get(cliKey) || transcriptIndex.get(sessionKey) || [];
    const transcript = candidates.length === 1 ? candidates[0] : null;
    if (transcript) {
      transcript.sources = [...new Set([...transcript.sources, "claude-3p"])];
      transcript.metadata = { ...transcript.metadata, claude3p: metadata };
      if (metadata.title) transcript.title = String(metadata.title);
      if (metadata.sessionId || metadata.cliSessionId) transcript.sessionId = metadata.sessionId || metadata.cliSessionId;
    } else {
      const filenameId = path.basename(metadataPath, JSON_EXTENSION);
      sessions.push(makeSession({
        source: "claude-3p",
        title: metadata.title || filenameId,
        sessionId: metadata.sessionId || metadata.cliSessionId || filenameId,
        updatedAt: metadata.updatedAt || metadata.createdAt,
        metadata,
        streams: [],
        details: { associationStatus: candidates.length > 1 ? "ambiguous" : "transcript-not-found" },
      }));
      if (candidates.length > 1) warnings.push("某些 Claude Desktop Code 元数据匹配到多个 transcript，未自动合并。");
    }
  }

  return {
    sessions,
    status: {
      id: "claude-3p",
      status: warnings.length ? "warning" : "available",
      message: warnings[0] || null,
      sessionCount: transcriptSessions.filter((item) => item.sources.includes("claude-3p")).length + sessions.length,
      warnings,
    },
  };
}

function addSessionIds(value, output, depth = 0) {
  if (!value || typeof value !== "object" || depth > 3) return;
  for (const [key, child] of Object.entries(value)) {
    if (["sessionId", "session_id", "cliSessionId", "cli_session_id"].includes(key) && ["string", "number"].includes(typeof child)) {
      const id = normalizedId(child);
      if (id) output.add(id);
    } else if (child && typeof child === "object") {
      addSessionIds(child, output, depth + 1);
    }
  }
}

function eventIdentifiers(line) {
  try {
    const value = JSON.parse(line);
    const output = new Set();
    addSessionIds(value, output);
    return output;
  } catch {
    return new Set();
  }
}

function auditStream(pathValue, mode, ids = []) {
  return {
    kind: "audit",
    label: "Claude Desktop Cowork 审计",
    path: pathValue,
    name: displayFileName(pathValue),
    filter: { mode, ids: [...ids] },
  };
}

function auditFilterMatches(filter, line) {
  if (!filter || filter.mode === "all") return true;
  const identifiers = eventIdentifiers(line);
  if (filter.mode === "unmatched") {
    return ![...identifiers].some((id) => filter.ids.includes(id));
  }
  if (filter.mode === "unassociated") return identifiers.size === 0;
  return [...identifiers].some((id) => filter.ids.includes(id));
}

async function scanLocalAgentMode(root) {
  const result = await listFiles(root, new Set([JSON_EXTENSION, JSONL_EXTENSION]));
  if (!result.rootExists) {
    return {
      sessions: [],
      status: { id: "claude-local-agent-mode", status: "unavailable", message: "未找到 Claude Desktop Cowork 会话目录。", sessionCount: 0, warnings: [] },
    };
  }

  const warnings = [...result.warnings];
  const metadataFiles = result.files.filter((item) => path.extname(item).toLowerCase() === JSON_EXTENSION);
  const transcriptFiles = result.files.filter((item) => path.extname(item).toLowerCase() === JSONL_EXTENSION && path.basename(item).toLowerCase() !== "audit.jsonl" && path.basename(item) !== ".audit-key");
  const auditFiles = result.files.filter((item) => path.basename(item).toLowerCase() === "audit.jsonl");
  const metadataValues = [];
  for (const metadataPath of metadataFiles) {
    const { value, error } = await readJsonMetadata(metadataPath);
    if (error) warnings.push(error);
    else if (Object.keys(value).length) metadataValues.push(value);
  }

  const sessions = [];
  for (const filePath of transcriptFiles) {
    const basename = normalizedId(filePath);
    const metadata = metadataValues.find((item) => normalizedId(item.cliSessionId) === basename || normalizedId(item.sessionId) === basename) || {};
    const stat = await getFileSummary(filePath);
    const ids = new Set([basename, normalizedId(metadata.sessionId), normalizedId(metadata.cliSessionId)].filter(Boolean));
    sessions.push(makeSession({
      source: "claude-local-agent-mode",
      title: metadata.title || path.basename(filePath, JSONL_EXTENSION),
      sessionId: metadata.sessionId || metadata.cliSessionId || basename,
      metadata,
      updatedAt: stat.updatedAt,
      streams: [{ kind: "transcript", label: "Claude Desktop Cowork 会话轨迹", path: filePath, name: displayFileName(filePath) }],
      details: { _auditIds: [...ids] },
    }));
  }

  for (const auditPath of auditFiles) {
    const knownIds = new Set(sessions.flatMap((item) => item._auditIds || []));
    if (knownIds.size) {
      for (const session of sessions) {
        const ids = session._auditIds || [];
        session.streams.push(auditStream(auditPath, "matches", ids));
        delete session._auditIds;
      }
      const stat = await getFileSummary(auditPath);
      sessions.push(makeSession({
        source: "claude-local-agent-mode",
        title: "未关联的 Claude Desktop Cowork 审计事件",
        sessionId: `audit-${path.basename(auditPath)}`,
        updatedAt: stat.updatedAt,
        streams: [auditStream(auditPath, "unmatched", [...knownIds])],
        details: { auditOnly: true },
      }));
    } else if (sessions.length === 1) {
      sessions[0].streams.push(auditStream(auditPath, "all"));
    } else {
      const stat = await getFileSummary(auditPath);
      sessions.push(makeSession({
        source: "claude-local-agent-mode",
        title: "Claude Desktop Cowork 审计事件",
        sessionId: `audit-${path.basename(auditPath)}`,
        updatedAt: stat.updatedAt,
        streams: [auditStream(auditPath, "all")],
        details: { auditOnly: true },
      }));
    }
  }

  return {
    sessions,
    status: {
      id: "claude-local-agent-mode",
      status: warnings.length ? "warning" : "available",
      message: warnings[0] || null,
      sessionCount: sessions.length,
      warnings,
    },
  };
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableColumns(db, table) {
  if (!Object.hasOwn(SQLITE_COLUMNS, table)) {
    throw new Error("SQLite 查询表不在允许列表中。");
  }
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().map((row) => String(row.name));
}

function readAllowedRows(db, table, requiredColumns = []) {
  const available = tableColumns(db, table);
  if (!available.length) throw new Error(`CSP 数据库缺少 ${table} 表。`);
  const selected = SQLITE_COLUMNS[table].filter((column) => available.includes(column));
  const missing = requiredColumns.filter((column) => !selected.includes(column));
  if (missing.length) throw new Error(`CSP ${table} 表缺少必需字段：${missing.join(", ")}。`);
  return db.prepare(`SELECT ${selected.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)}`).all();
}

function firstValue(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "") return row[key];
  }
  return null;
}

function scalar(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return "[二进制值已省略]";
  return value;
}

function parseStoredJson(value) {
  const text = scalar(value);
  if (typeof text !== "string") return text ?? null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function omitAttachmentBodies(value, insideAttachment = false) {
  if (Array.isArray(value)) return value.map((item) => omitAttachmentBodies(item, insideAttachment));
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const attachmentField = /^(attachment|attachments|artifact|artifacts|fileArtifact|file_artifact)$/i.test(key);
    if ((insideAttachment || attachmentField) && /^(content|data|body|bytes|blob|base64)$/i.test(key)) {
      result[key] = "[附件正文已省略]";
    } else {
      result[key] = omitAttachmentBodies(child, insideAttachment || attachmentField);
    }
  }
  return result;
}

function artifactMetadata(row, versions) {
  const id = firstValue(row, ["artifact_id", "id"]);
  const versionRows = versions.filter((version) => String(firstValue(version, ["artifact_id"])) === String(id));
  return { ...row, versions: versionRows };
}

function cspSessionGroups(dbPath, projects, frames, artifacts, versions) {
  const projectById = new Map();
  for (const project of projects) {
    const id = firstValue(project, ["project_id", "id"]);
    if (id !== null) projectById.set(String(id), project);
  }

  const groups = new Map();
  for (const frame of frames) {
    const frameId = firstValue(frame, ["frame_id", "id"]);
    if (frameId === null) continue;
    const rootFrameId = firstValue(frame, ["root_frame_id"]) ?? frameId;
    const projectId = firstValue(frame, ["project_id"]);
    const groupKey = `${projectId ?? "unknown"}\u0000${rootFrameId}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { projectId: projectId === null ? null : String(projectId), rootFrameId: String(rootFrameId), frames: [] });
    }
    groups.get(groupKey).frames.push(frame);
  }

  const sessions = [];
  for (const group of groups.values()) {
    const project = group.projectId ? projectById.get(group.projectId) || null : null;
    const frameIds = group.frames.map((frame) => String(firstValue(frame, ["frame_id", "id"])));
    const root = group.frames.find((frame) => String(firstValue(frame, ["frame_id", "id"])) === group.rootFrameId)
      || group.frames.find((frame) => !firstValue(frame, ["parent_frame_id"]))
      || group.frames[0];
    const relatedArtifacts = artifacts.filter((artifact) => {
      const frameId = firstValue(artifact, ["frame_id"]);
      const projectId = firstValue(artifact, ["project_id"]);
      return (frameId !== null && frameIds.includes(String(frameId)))
        || (projectId !== null && group.projectId && String(projectId) === group.projectId);
    }).map((artifact) => artifactMetadata(artifact, versions));
    const title = firstValue(root, ["title", "name"])
      || firstValue(project, ["title", "name"])
      || `Claude Science frame ${group.rootFrameId}`;
    const metadata = {
      project: project ? {
        id: firstValue(project, ["project_id", "id"]),
        name: firstValue(project, ["title", "name"]),
        cwd: firstValue(project, ["cwd", "path"]),
      } : null,
      rootFrameId: group.rootFrameId,
      frameCount: group.frames.length,
      artifactCount: relatedArtifacts.length,
    };
    const safeFrames = group.frames.map((frame) => ({ ...frame }));
    sessions.push(makeSession({
      source: "claude-science",
      title: String(title),
      sessionId: `${group.projectId || "unknown"}:${group.rootFrameId}`,
      metadata,
      streams: [{ kind: "sqlite-messages", label: "Claude Science 消息/工具记录" }],
      details: {
        dbPath,
        projectId: group.projectId,
        frameIds,
        frames: safeFrames,
        artifacts: relatedArtifacts,
      },
    }));
  }
  return sessions;
}

function loadCspDatabase(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const projects = readAllowedRows(db, "projects", []);
    const frames = readAllowedRows(db, "frames", ["root_frame_id"]);
    const frameColumns = tableColumns(db, "frames");
    if (!frameColumns.includes("frame_id") && !frameColumns.includes("id")) {
      throw new Error("CSP frames 表缺少 frame_id/id 字段。");
    }
    readAllowedRows(db, "frame_messages", ["frame_id", "idx", "msg_json"]);
    const artifacts = readAllowedRows(db, "artifacts", []);
    const versions = readAllowedRows(db, "artifact_versions", []);
    return cspSessionGroups(dbPath, projects, frames, artifacts, versions);
  } finally {
    db.close();
  }
}

async function scanCsp(orgsRoot) {
  let orgEntries;
  try {
    orgEntries = await fs.readdir(orgsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        sessions: [],
        status: { id: "claude-science", status: "unavailable", message: "未找到 Claude Science CSP 数据目录。", sessionCount: 0, warnings: [] },
      };
    }
    return {
      sessions: [],
      status: { id: "claude-science", status: "error", message: shortError(error), sessionCount: 0, warnings: [] },
    };
  }

  const sessions = [];
  const warnings = [];
  let databaseCount = 0;
  for (const entry of orgEntries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const dbPath = path.join(orgsRoot, entry.name, "operon-cli.db");
    if (!isWithinRoot(orgsRoot, dbPath)) continue;
    try {
      const stat = await fs.lstat(dbPath);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      databaseCount += 1;
      sessions.push(...loadCspDatabase(dbPath));
    } catch (error) {
      warnings.push(`${entry.name}: ${shortError(error)}`);
    }
  }
  return {
    sessions,
    status: {
      id: "claude-science",
      status: warnings.length ? (sessions.length ? "warning" : "error") : databaseCount ? "available" : "unavailable",
      message: warnings[0] || (databaseCount ? null : "未找到 operon-cli.db。"),
      sessionCount: sessions.length,
      warnings,
    },
  };
}

function publicSession(session) {
  return {
    id: session.id,
    source: session.source,
    sources: session.sources,
    title: session.title,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
    metadata: session.metadata,
    streamCount: session.streams.length,
  };
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(cursor, streamCount) {
  if (!cursor) return { streamIndex: 0, offset: 0 };
  if (typeof cursor !== "string" || cursor.length > 512) throw new Error("分页游标无效。");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(value.streamIndex) || value.streamIndex < 0 || value.streamIndex > streamCount
      || !Number.isInteger(value.offset) || value.offset < 0 || value.offset > 100_000_000) {
      throw new Error("分页游标无效。");
    }
    return { streamIndex: value.streamIndex, offset: value.offset };
  } catch {
    throw new Error("分页游标无效。");
  }
}

function toParsedItems(text, stream, offset) {
  const lines = text.split("\n");
  const parsed = parseSessionText(text, stream.name);
  const timelineByLine = new Map(parsed.timeline.map((record) => [record.lineNumber, record]));
  const items = parsed.records.map((record) => {
    const relativeLine = record.lineNumber || 1;
    const timeline = timelineByLine.get(relativeLine);
    return {
      category: timeline ? "timeline" : "metadata",
      streamKind: stream.kind,
      lineNumber: offset + relativeLine,
      record: { ...(timeline || record), lineNumber: offset + relativeLine },
    };
  });
  for (const error of parsed.errors) {
    const relativeLine = error.lineNumber || 1;
    items.push({
      category: "error",
      streamKind: stream.kind,
      lineNumber: offset + relativeLine,
      error: error.error || "JSONL 行无法解析。",
      rawLine: lines[relativeLine - 1] || "",
    });
  }
  return items.sort((left, right) => left.lineNumber - right.lineNumber);
}

async function readJsonlPage(stream, offset, limit) {
  const input = createReadStream(stream.path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const selected = [];
  let physicalLine = 0;
  let matchingRecord = 0;
  let hasMore = false;
  try {
    for await (const line of lines) {
      physicalLine += 1;
      if (!line.trim()) continue;
      if (!auditFilterMatches(stream.filter, line)) continue;
      if (matchingRecord < offset) {
        matchingRecord += 1;
        continue;
      }
      if (selected.length >= limit) {
        hasMore = true;
        break;
      }
      selected.push({ line, physicalLine });
      matchingRecord += 1;
    }
  } finally {
    lines.close();
    input.destroy();
  }
  const text = selected.map((item) => item.line).join("\n");
  const items = toParsedItems(text, stream, 0);
  for (const item of items) {
    const compactLine = item.lineNumber;
    const sourceLine = selected[compactLine - 1]?.physicalLine;
    if (sourceLine) {
      item.lineNumber = sourceLine;
      if (item.record) item.record.lineNumber = sourceLine;
    }
  }
  return { items, nextOffset: offset + selected.length, hasMore };
}

function readCspMessagePage(session, offset, limit) {
  if (!session.frameIds?.length) return { items: [], nextOffset: offset, hasMore: false };
  const db = new DatabaseSync(session.dbPath, { readOnly: true });
  try {
    const available = tableColumns(db, "frame_messages");
    const required = ["frame_id", "idx", "msg_json"];
    if (required.some((column) => !available.includes(column))) throw new Error("CSP frame_messages schema 已变化。");
    const columns = required.concat(available.includes("msg_uuid") ? ["msg_uuid"] : []);
    const placeholders = session.frameIds.map(() => "?").join(", ");
    const statement = db.prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM "frame_messages" WHERE "frame_id" IN (${placeholders}) ORDER BY "frame_id", "idx" LIMIT ? OFFSET ?`);
    const rows = statement.all(...session.frameIds, limit + 1, offset);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      category: "csp-message",
      streamKind: "sqlite-messages",
      frameId: String(row.frame_id),
      lineNumber: Number(row.idx),
      uuid: row.msg_uuid ? String(row.msg_uuid) : null,
      message: omitAttachmentBodies(parseStoredJson(row.msg_json)),
      rawJson: typeof row.msg_json === "string" ? row.msg_json : null,
    }));
    return { items, nextOffset: offset + items.length, hasMore };
  } finally {
    db.close();
  }
}

function readStreamPage(session, stream, offset, limit) {
  if (stream.kind === "sqlite-messages") return readCspMessagePage(session, offset, limit);
  return readJsonlPage(stream, offset, limit);
}

export function createDiscoveryService({ homeDir = os.homedir(), roots = {}, pageSize = PAGE_SIZE } = {}) {
  const paths = { ...sourcePaths(homeDir), ...roots };
  let sessionsById = new Map();
  let sourceStatuses = SOURCE_INFO.map(({ id, label }) => ({ id, label, status: "scanning", message: null, sessionCount: 0, warnings: [] }));
  let lastScannedAt = null;
  let refreshing = null;

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const claudeResult = await scanClaudeCode(paths.claudeCode);
      const claude3pResult = await scanClaude3p(paths.claude3pSessions, claudeResult.sessions);
      const localResult = await scanLocalAgentMode(paths.localAgentMode);
      let cspResult;
      try {
        cspResult = await scanCsp(paths.cspOrgs);
      } catch (error) {
        cspResult = {
          sessions: [],
          status: { id: "claude-science", status: "error", message: shortError(error), sessionCount: 0, warnings: [] },
        };
      }

      const discovered = [...claudeResult.sessions, ...claude3pResult.sessions, ...localResult.sessions, ...cspResult.sessions];
      sessionsById = new Map(discovered.map((session) => [session.id, session]));
      const statusMap = new Map([claudeResult.status, claude3pResult.status, localResult.status, cspResult.status].map((item) => [item.id, item]));
      sourceStatuses = SOURCE_INFO.map(({ id, label }) => ({ label, ...statusMap.get(id) }));
      lastScannedAt = new Date().toISOString();
      return getSnapshot();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function getSnapshot() {
    return {
      sources: sourceStatuses.map((source) => ({ ...source, warnings: [...(source.warnings || [])] })),
      scannedAt: lastScannedAt,
    };
  }

  function listSessions({ source, offset = 0, limit = 100 } = {}) {
    const items = [...sessionsById.values()]
      .filter((session) => !source || session.source === source || session.sources.includes(source))
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    const page = items.slice(offset, offset + limit);
    return { items: page.map(publicSession), total: items.length, offset, limit };
  }

  function getSession(id) {
    const session = sessionsById.get(id);
    if (!session) return null;
    return {
      ...publicSession(session),
      associationStatus: session.associationStatus || null,
      frames: session.frames || [],
      artifacts: session.artifacts || [],
      streams: session.streams.map(({ kind, label }) => ({ kind, label })),
      recordCount: session.recordCount ?? null,
    };
  }

  async function getRecordsPage(id, cursor) {
    const session = sessionsById.get(id);
    if (!session) return null;
    const normalizedStreams = [...session.streams];
    if (session.frameIds?.length && !normalizedStreams.some((stream) => stream.kind === "sqlite-messages")) {
      normalizedStreams.push({ kind: "sqlite-messages", label: "Claude Science 消息/工具记录" });
    }
    const decoded = decodeCursor(cursor, normalizedStreams.length);
    let { streamIndex, offset } = decoded;
    const items = [];
    while (streamIndex < normalizedStreams.length && items.length < pageSize) {
      const stream = normalizedStreams[streamIndex];
      const remaining = pageSize - items.length;
      let page;
      try {
        page = await readStreamPage(session, stream, offset, remaining);
      } catch (error) {
        items.push({
          category: "error",
          streamKind: stream.kind,
          error: shortError(error),
        });
        streamIndex += 1;
        offset = 0;
        continue;
      }
      items.push(...page.items);
      if (page.hasMore) {
        offset = page.nextOffset;
        break;
      }
      streamIndex += 1;
      offset = 0;
    }
    const hasMore = streamIndex < normalizedStreams.length;
    return {
      items,
      nextCursor: hasMore ? encodeCursor({ streamIndex, offset }) : null,
      done: !hasMore,
      pageSize,
    };
  }

  return {
    refresh,
    getSnapshot,
    listSessions,
    getSession,
    getRecordsPage,
  };
}

export const discoveryInternals = {
  metadataFields,
  toParsedItems,
  decodeCursor,
  readAllowedRows,
};

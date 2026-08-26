import assert from "node:assert/strict";
import test from "node:test";

import {
  parseClaudeCodeDirectory,
  parseClaudeCodeSessionJsonl,
  parseClaudeCodeWorkflowJson,
} from "../src/lib/claudeCode/index.js";

function jsonl(records) {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

test("解析当前 Claude Code Session 的新元数据和消息内容", () => {
  const session = parseClaudeCodeSessionJsonl(
    jsonl([
      {
        type: "user",
        sessionId: "session-1",
        timestamp: "2026-08-26T00:00:00.000Z",
        message: { role: "user", content: "开始任务" },
      },
      {
        type: "assistant",
        sessionId: "session-1",
        timestamp: 1787702401000,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "先分析任务" },
            { type: "tool_use", id: "call-1", name: "Bash", input: { command: "pwd" } },
            { type: "text", text: "## 已开始" },
          ],
        },
      },
      {
        type: "user",
        sessionId: "session-1",
        timestamp: "2026-08-26T00:00:02.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              content: [{ type: "text", text: "命令完成" }],
            },
          ],
        },
        toolUseResult: { stdout: "命令完成", stderr: "", interrupted: false },
      },
      {
        type: "system",
        sessionId: "session-1",
        timestamp: "2026-08-26T00:00:03.000Z",
        subtype: "turn_duration",
        durationMs: 3000,
        content: "turn finished",
      },
      { type: "atis-latch", sessionId: "session-1", atis: "" },
      {
        type: "cost-state",
        sessionId: "session-1",
        startTime: 1787702400000,
        totalCostUSD: 1.25,
        totalDuration: 3000,
        totalAPIDuration: 2800,
        modelUsage: { model: { inputTokens: 10, outputTokens: 5 } },
      },
    ]),
    "session.jsonl",
  );

  assert.equal(session.errors.length, 0);
  assert.equal(session.summary.recordCount, 6);
  assert.equal(session.summary.timelineCount, 4);
  assert.equal(session.summary.metadataCount, 2);
  assert.equal(session.summary.sessionId, "session-1");
  assert.equal(session.summary.costUSD, 1.25);
  assert.equal(session.summary.totalDurationMs, 3000);
  assert.deepEqual(
    session.metadata.map((record) => record.type),
    ["atis-latch", "cost-state"],
  );

  const assistant = session.timeline.find((record) => record.type === "assistant");
  assert.deepEqual(
    assistant.blocks.map((block) => block.label),
    [
      "message.content[0].thinking",
      "message.content[1].tool_use",
      "message.content[2].text",
    ],
  );
  assert.equal(assistant.blocks[1].renderMode, "code");
  assert.equal(assistant.blocks[2].renderMode, "markdown");

  const toolResult = session.timeline.find(
    (record) => record.type === "user" && Array.isArray(record.message?.content),
  );
  assert.equal(toolResult.blocks[0].label, "message.content[0].tool_result[0].text");
  assert.ok(toolResult.blocks.some((block) => block.label === "toolUseResult.stdout"));
  assert.equal(session.timeline.at(-1).type, "system");
  assert.ok(session.timeline.at(-1).blocks.some((block) => block.label === "system.content"));
});

test("解析 dynamic workflow 的阶段、Agent 进度和结果", () => {
  const workflow = parseClaudeCodeWorkflowJson(
    JSON.stringify({
      runId: "wf_123",
      taskId: "task-1",
      workflowName: "demo-workflow",
      status: "completed",
      startTime: 1787702400000,
      timestamp: "2026-08-26T00:01:00.000Z",
      durationMs: 60000,
      phases: [{ title: "执行", detail: "完成任务" }],
      workflowProgress: [
        { type: "workflow_phase", index: 1, title: "执行" },
        {
          type: "workflow_agent",
          index: 1,
          label: "agent:demo",
          phaseIndex: 1,
          agentId: "agent-1",
          state: "done",
          startedAt: 1787702401000,
          promptPreview: "请执行任务",
          resultPreview: "完成任务",
        },
      ],
      logs: ["workflow started"],
      result: [{ summary: "done" }],
    }),
    "wf_123.json",
  );

  assert.equal(workflow.errors.length, 0);
  assert.equal(workflow.summary.title, "demo-workflow");
  assert.equal(workflow.summary.phaseCount, 1);
  assert.equal(workflow.summary.agentCount, 1);
  assert.equal(workflow.progress.length, 2);
  assert.equal(workflow.progress[0].blocks[0].label, "phase.detail");
  assert.equal(workflow.progress[1].blocks[1].label, "agent.promptPreview");
  assert.equal(workflow.resultBlocks[0].label, "result[0]");
});

test("读取真实 dynamic workflow 目录的主 Session、workflow JSON 和 Sub Agent", () => {
  const mainSession = jsonl([
    {
      type: "user",
      session_id: "main-session",
      timestamp: "2026-08-26T00:00:00.000Z",
      message: { role: "user", content: "run workflow" },
    },
  ]);
  const agentSession = (agentId) =>
    jsonl([
      {
        type: "user",
        agentId,
        isSidechain: true,
        timestamp: "2026-08-26T00:00:01.000Z",
        message: { role: "user", content: `run ${agentId}` },
      },
    ]);
  const workflowJson = JSON.stringify({
    runId: "wf_123",
    workflowName: "demo-workflow",
    status: "completed",
    startTime: 1787702400000,
    phases: [],
    workflowProgress: [],
  });
  const entries = [
    {
      name: "main-session.jsonl",
      relativePath: "project/033-session.jsonl",
      text: mainSession,
    },
    {
      name: "wf_123.json",
      relativePath: "project/033-session/workflows/wf_123.json",
      text: workflowJson,
    },
    {
      name: "journal.jsonl",
      relativePath: "project/033-session/subagents/workflows/wf_123/journal.jsonl",
      text: jsonl([
        { type: "started", key: "v2:a", agentId: "agent-a" },
        { type: "started", key: "v2:b", agentId: "agent-b" },
        { type: "result", key: "v2:b", agentId: "agent-b", result: "B done" },
      ]),
    },
    {
      name: "agent-a.jsonl",
      relativePath: "project/033-session/subagents/workflows/wf_123/agent-agent-a.jsonl",
      text: agentSession("agent-a"),
    },
    {
      name: "agent-b.jsonl",
      relativePath: "project/033-session/subagents/workflows/wf_123/agent-agent-b.jsonl",
      text: agentSession("agent-b"),
    },
    {
      name: "agent-agent-b.meta.json",
      relativePath: "project/033-session/subagents/workflows/wf_123/agent-agent-b.meta.json",
      text: JSON.stringify({ agentType: "general-purpose", spawnDepth: 1 }),
    },
    { name: ".DS_Store", relativePath: "project/.DS_Store", text: "ignored" },
  ];

  const directory = parseClaudeCodeDirectory(entries);
  assert.equal(directory.summary.mainSessionCount, 1);
  assert.equal(directory.summary.workflowCount, 1);
  assert.equal(directory.summary.workflowFileCount, 1);
  assert.equal(directory.summary.journalCount, 1);
  assert.equal(directory.summary.warningCount, 0);
  assert.equal(directory.mainSessions[0].sessionData.summary.sessionId, "main-session");

  const workflow = directory.workflows[0];
  assert.equal(workflow.key, "wf_123");
  assert.equal(workflow.workflowFile, "033-session/workflows/wf_123.json");
  assert.equal(workflow.workflowData.summary.title, "demo-workflow");
  assert.deepEqual(
    workflow.sessions.map((session) => session.agentId),
    ["agent-a", "agent-b"],
  );
  assert.equal(workflow.sessions[1].meta.agentType, "general-purpose");
  assert.equal(workflow.sessions[1].journalResultRecord.result, "B done");
  assert.deepEqual(
    directory.orderedSessions.map((session) => session.globalSequence),
    [1, 2],
  );
});

test("目录解析保留所有 JSON 和 JSONL 文件，并为普通 JSON 提供解析结果", () => {
  const directory = parseClaudeCodeDirectory([
    {
      name: "main.jsonl",
      relativePath: "workflow/main.jsonl",
      text: jsonl([{ type: "user", timestamp: "2026-08-26T00:00:00.000Z" }]),
    },
    {
      name: "settings.json",
      relativePath: "workflow/config/settings.json",
      text: JSON.stringify({ enabled: true, retryCount: 2 }),
    },
    {
      name: "events.jsonl",
      relativePath: "workflow/logs/events.jsonl",
      text: jsonl([{ type: "event", timestamp: "2026-08-26T00:00:01.000Z" }]),
    },
    {
      name: "broken.json",
      relativePath: "workflow/config/broken.json",
      text: "{",
    },
    {
      name: "ignored.txt",
      relativePath: "workflow/tool-results/ignored.txt",
      text: "not json",
    },
  ]);

  assert.equal(directory.summary.parsedFileCount, 4);
  assert.equal(directory.summary.jsonFileCount, 2);
  assert.equal(directory.summary.jsonlFileCount, 2);
  assert.equal(directory.summary.genericJsonFileCount, 2);
  assert.equal(directory.summary.errorCount, 1);
  assert.equal(directory.parsedFiles.length, 4);

  const settings = directory.parsedFiles.find(
    (file) => file.relativePath === "config/settings.json",
  );
  assert.equal(settings.kind, "json");
  assert.equal(settings.result.data.retryCount, 2);

  const events = directory.parsedFiles.find((file) => file.relativePath === "logs/events.jsonl");
  assert.equal(events.parser, "session");
  assert.equal(events.result.summary.recordCount, 1);

  assert.equal(directory.errors[0].file, "config/broken.json");
});

test("缺少 wf_ 描述 JSON 时仍可按 journal 组织 Dynamic Workflow", () => {
  const directory = parseClaudeCodeDirectory([
    {
      name: "main.jsonl",
      relativePath: "workflow/main.jsonl",
      text: jsonl([{ type: "user", timestamp: "2026-08-26T00:00:00.000Z" }]),
    },
    {
      name: "journal.jsonl",
      relativePath: "workflow/run/subagents/workflows/wf_without_descriptor/journal.jsonl",
      text: jsonl([{ type: "started", agentId: "agent-1" }]),
    },
    {
      name: "agent-agent-1.jsonl",
      relativePath:
        "workflow/run/subagents/workflows/wf_without_descriptor/agent-agent-1.jsonl",
      text: jsonl([{
        type: "user",
        agentId: "agent-1",
        timestamp: "2026-08-26T00:00:01.000Z",
      }]),
    },
  ]);

  assert.equal(directory.summary.workflowFileCount, 0);
  assert.equal(directory.summary.workflowCount, 1);
  assert.equal(directory.summary.parsedFileCount, 3);
  assert.equal(directory.workflows[0].workflowData, null);
  assert.equal(directory.workflows[0].sessions[0].agentId, "agent-1");
  assert.equal(directory.orderedSessions[0].globalSequence, 1);
});

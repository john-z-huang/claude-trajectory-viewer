import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedClaudeCodeDirectoryFile,
  parseJsonlText,
  parseJsonText,
} from "../src/lib/claudeCode/index.js";

test("JSONL 解码保留有效记录、行号和单行错误", () => {
  const lines = parseJsonlText(
    ['{"type":"user","message":"first"}', "{broken json}", "", '{"type":"assistant"}'].join(
      "\r\n",
    ),
  );

  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((line) => line.lineNumber),
    [1, 2, 4],
  );
  assert.equal(lines[0].value.type, "user");
  assert.equal(lines[1].value, null);
  assert.ok(lines[1].error);
  assert.equal(lines[2].value.type, "assistant");
});

test("JSON 解码将无效文件转换为可处理的错误结果", () => {
  const valid = parseJsonText('{"runId":"wf_1"}', "wf_1.json");
  const invalid = parseJsonText("{", "broken.json");

  assert.equal(valid.error, null);
  assert.equal(valid.data.runId, "wf_1");
  assert.equal(invalid.data, null);
  assert.equal(invalid.sourceName, "broken.json");
  assert.ok(invalid.error);
});

test("目录文件识别覆盖任意层级的 JSON 与 JSONL", () => {
  assert.equal(
    isSupportedClaudeCodeDirectoryFile({
      name: "agent-demo.jsonl",
      webkitRelativePath: "project/session/subagents/workflows/wf_1/agent-demo.jsonl",
    }),
    true,
  );
  assert.equal(isSupportedClaudeCodeDirectoryFile("project/session/workflows/wf_1.json"), true);
  assert.equal(
    isSupportedClaudeCodeDirectoryFile("project/session/agent-demo.meta.json"),
    true,
  );
  assert.equal(isSupportedClaudeCodeDirectoryFile("project/.cache/agent-demo.jsonl"), true);
  assert.equal(isSupportedClaudeCodeDirectoryFile("project/workflow.json"), true);
  assert.equal(isSupportedClaudeCodeDirectoryFile(".DS_Store"), false);
  assert.equal(isSupportedClaudeCodeDirectoryFile("project/tool-results/output.txt"), false);
});

/**
 * 兼容旧导入路径。
 *
 * 新代码请从 ./claudeCode/index.js 使用语义化的公开 API。
 */
export {
  parseClaudeCodeDirectory as parseSubAgentDirectory,
  parseClaudeCodeJournalJsonl as parseJournalText,
  parseClaudeCodeSessionJsonl as parseSessionText,
  parseClaudeCodeWorkflowJson as parseWorkflowText,
} from "./claudeCode/index.js";

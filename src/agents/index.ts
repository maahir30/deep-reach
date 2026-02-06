/**
 * Main recruiting agent orchestrator
 * 
 * Uses LangGraph DeepAgents for:
 * - State management (checkpoints)
 * - File system (artifact storage)
 * - Task planning (todos)
 * - Subagent spawning
 * 
 * The orchestrator receives all pipeline instructions upfront and autonomously
 * manages progression through stages, delegating to specialized subagents.
 */

// Re-export orchestrator and subagents
export {
  createRecruitingOrchestrator,
  runPipeline,
  type OrchestratorConfig,
  type PipelineResult,
} from "./orchestrator";

export {
  SUBAGENT_DEFINITIONS,
  assignToolsToSubagent,
  type SubagentDefinition,
} from "./subagents";

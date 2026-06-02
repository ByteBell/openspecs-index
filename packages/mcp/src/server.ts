import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListKnowledgeTool } from "./listKnowledgeTool.ts";
import { registerSmartSearchTool } from "./smartSearchTool.ts";
import { registerKeywordLookupTool } from "./keywordLookupTool.ts";
import { registerRetrieveFileTool } from "./retrieveFileTool.ts";
import { registerCacheAlignerTool } from "./cacheAlignerTool.ts";
import { registerSkillResources } from "./resourcesSkills.ts";

const SERVER_NAME = "bytebell-public";
const SERVER_VERSION = "0.0.0";

const INSTRUCTIONS = `Bytebell-public local knowledge graph.

Five tools are registered: list_knowledge (call first — enumerates
indexed repos and their knowledgeId UUIDs), smart_search (default —
fused six-channel search), keyword_lookup (reverse lookup of named
entities), retrieve_file (metadata, content, bulk_search), and
cache_aligner (stabilize prompts for KV cache optimization by reordering
static content to the prefix).

Two resources are exposed: bytebell://skills/index and
bytebell://skills/{skillName}/{filename}. Fetch the index once per
session, install the listed files to ~/.claude/skills/{skillName}, and
follow the per-task workflow files referenced from each SKILL.md.`;

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerListKnowledgeTool(server);
  registerSmartSearchTool(server);
  registerKeywordLookupTool(server);
  registerRetrieveFileTool(server);
  registerSkillResources(server);
  registerCacheAlignerTool(server);
  return server;
}

export const HOST = "host" as const;
export const CHALLENGER = "challenger" as const;
export const SIDES = [HOST, CHALLENGER] as const;

export const AGENT_CLAUDE = "claude-code" as const;
export const AGENT_CODEX = "codex" as const;
export const AGENTS = [AGENT_CLAUDE, AGENT_CODEX] as const;

export type Side = (typeof SIDES)[number];
export type AgentName = (typeof AGENTS)[number];

export function isSide(value: string): value is Side {
  return SIDES.includes(value as Side);
}

export function isAgent(value: string): value is AgentName {
  return AGENTS.includes(value as AgentName);
}

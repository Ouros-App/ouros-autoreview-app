export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface Finding {
  path: string;
  line?: number;
  severity: Severity;
  category: string;
  message: string;
}

export interface NimReview {
  score: number;
  summary: string;
  findings: Finding[];
}

export interface GateResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
}

export interface PullContext {
  owner: string;
  repo: string;
  pullNumber: number;
  installationId: number;
}

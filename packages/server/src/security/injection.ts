import type { LlmClient } from "../llm/client.js";

export interface InjectionResult {
  risk: "low" | "medium" | "high";
  category?: string;
  detail?: string;
  rawScore?: number;
}

interface PatternRule {
  risk: "high" | "medium";
  category: string;
  pattern: RegExp;
}

const rules: PatternRule[] = [
  // HIGH — instruction override
  { risk: "high", category: "instruction_override", pattern: /ignore\s+(all\s+)?previous\s+instructions/i },
  { risk: "high", category: "instruction_override", pattern: /disregard\s+(all\s+)?prior/i },
  { risk: "high", category: "instruction_override", pattern: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i },
  // HIGH — jailbreak
  { risk: "high", category: "jailbreak", pattern: /you\s+are\s+now\s+DAN/i },
  { risk: "high", category: "jailbreak", pattern: /jailbreak/i },
  { risk: "high", category: "jailbreak", pattern: /bypass\s+(your\s+)?(safety|content|filter)/i },
  // HIGH — role hijack
  { risk: "high", category: "role_hijack", pattern: /pretend\s+(you\s+are|to\s+be)\s+a/i },
  { risk: "high", category: "role_hijack", pattern: /act\s+as\s+if\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits)/i },
  // MEDIUM — encoded payload (base64 block >= 50 chars)
  { risk: "medium", category: "encoded_payload", pattern: /[A-Za-z0-9+/=]{50,}/ },
  // MEDIUM — embedded injection markers
  { risk: "medium", category: "embedded_injection", pattern: /\[SYSTEM\]/i },
  { risk: "medium", category: "embedded_injection", pattern: /<\|im_start\|>/i },
  { risk: "medium", category: "embedded_injection", pattern: /<\/?system>/i },
  // MEDIUM — prompt leak
  { risk: "medium", category: "prompt_leak", pattern: /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i },
  { risk: "medium", category: "prompt_leak", pattern: /reveal\s+(your|the)\s+instructions/i },
];

export class InjectionDetector {
  constructor(private llm?: LlmClient) {}

  async detect(message: string): Promise<InjectionResult> {
    try {
      // Rule-based detection: scan for highest-risk match
      let best: InjectionResult = { risk: "low" };

      for (const rule of rules) {
        if (rule.pattern.test(message)) {
          if (rule.risk === "high") {
            // Can't get higher — return immediately
            return { risk: "high", category: rule.category };
          }
          // First medium match wins (no need to keep scanning mediums)
          if (best.risk === "low") {
            best = { risk: "medium", category: rule.category };
          }
        }
      }

      // TODO: If rule-based returned "low" and LLM is available, call LLM for
      // deeper semantic analysis. For now this is a placeholder.
      // if (best.risk === "low" && this.llm?.isConfigured()) {
      //   best = await this.llmAnalyze(message);
      // }

      return best;
    } catch {
      // Fail-open: any unexpected error → low risk
      return { risk: "low" };
    }
  }
}

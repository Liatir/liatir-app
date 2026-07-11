const TECHNICAL_RESPONSE_PATTERNS = [
  /```/,
  /(?:^|\n)\s*(?:\$|>|#)\s+(?:which|env|docker|grep|ls|cat|cd|export)\b/im,
  /\b(?:docker\s+(?:run|inspect)|which\s+[a-z0-9_-]+|env\s*\||stack trace|call chain)\b/i,
  /\b(?:JSON|YAML)\s+(?:file|configuration|parameter|structure)/i,
  /\b(?:JavaScript|Node\.js)\s+(?:runtime|error|layer)/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|os error|executable|binary is not in)\b/i,
  /\b[a-z_$][\w$]*\.(?:split|map|filter|reduce)\s*\(/i,
  /\b(?:system PATH|environment variable|container image|internal developer|orchestration layer)\b/i,
  /(?:^|\n)\s*(?:uname\s+-a|docker\s+--version|[a-z]+\s+\|\s+grep)\b/im,
];

/** Detects content that must not be shown on Quenta's non-technical surface. */
export function quentaResponseNeedsPlainLanguageRepair(content: string): boolean {
  return TECHNICAL_RESPONSE_PATTERNS.some((pattern) => pattern.test(content));
}

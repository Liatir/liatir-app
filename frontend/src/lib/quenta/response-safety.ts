/**
 * Guards Quenta's non-technical surface against developer-facing answers.
 *
 * The rule this enforces is that Quenta talks to a biologist, not to a maintainer: it must never
 * answer with a shell command to run, a stack trace to read, or an environment to inspect.
 *
 * What it must *not* do is fight the content the feature exists to produce. Explaining a Result
 * means describing files, output formats and tool behaviour, so the patterns key on developer
 * *instructions and diagnostics*, never on the vocabulary of describing a scientific run. Three of
 * them used to do exactly that and made `explain-result` fail every time it was asked:
 *
 *   - a bare code fence, which is formatting rather than content, and which any model reaches for
 *     when quoting a value or a file name;
 *   - the bare word "executable", which is an ordinary way to describe the tool that ran;
 *   - "JSON file" and "JSON parameter", when saying where a result was written is the answer.
 *
 * The specific shell and error patterns below still match inside a fenced block, so dropping the
 * fence rule costs no real protection.
 */
const TECHNICAL_RESPONSE_PATTERNS = [
  /(?:^|\n)\s*(?:\$|>|#)\s+(?:which|env|docker|grep|ls|cat|cd|export)\b/im,
  /\b(?:docker\s+(?:run|inspect)|which\s+[a-z0-9_-]+|env\s*\||stack trace|call chain)\b/i,
  /\b(?:JSON|YAML)\s+configuration\b/i,
  /\b(?:JavaScript|Node\.js)\s+(?:runtime|error|layer)/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|os error|binary is not in)\b/i,
  /\b[a-z_$][\w$]*\.(?:split|map|filter|reduce)\s*\(/i,
  /\b(?:system PATH|environment variable|container image|internal developer|orchestration layer)\b/i,
  /(?:^|\n)\s*(?:uname\s+-a|docker\s+--version|[a-z]+\s+\|\s+grep)\b/im,
];

/** Detects content that must not be shown on Quenta's non-technical surface. */
export function quentaResponseNeedsPlainLanguageRepair(content: string): boolean {
  return TECHNICAL_RESPONSE_PATTERNS.some((pattern) => pattern.test(content));
}

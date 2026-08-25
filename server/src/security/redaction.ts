const SensitiveQuery =
  /([?&](?:access_token|api[_-]?key|auth|credential|key|password|secret|token)=)[^&#\s]*/gi
const Authorization = /\b(?:basic|bearer)\s+[a-z0-9._~+/=:-]+/gi
const Cookie = /\b(?:cookie|set-cookie)\s*:[^\r\n;]+(?:;[^\r\n]*)*/gi
const LocalPath = /(?:\/Users\/|\/home\/|\/tmp\/|[A-Za-z]:\\)[^\s;,)]+/g
const ApiKey = /\b(?:sk|pk|rk|api)[-_][a-z0-9_-]{8,}\b/gi
const Canary = /\b[A-Z][A-Z0-9_]{5,}\b/g

export const redactSensitiveText = (value: string): string =>
  value
    .replace(Authorization, "[REDACTED]")
    .replace(Cookie, "[REDACTED]")
    .replace(SensitiveQuery, "$1[REDACTED]")
    .replace(LocalPath, "[REDACTED_PATH]")
    .replace(ApiKey, "[REDACTED]")
    .replace(Canary, "[REDACTED]")

export const safeErrorCode = (
  error: unknown,
  code: string
): { readonly error: { readonly code: string } } => {
  void error
  return { error: { code } }
}

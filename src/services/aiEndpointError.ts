/**
 * Error for a non-OK /api/ai response. The server's error code
 * (`email_not_verified`, `quota_exceeded`, …) rides along on `code` so the UI
 * can show an actionable, localized message via safeAiErrorMessage instead of
 * the generic "analysis failed" fallback.
 */
export function aiEndpointError(status: number, errBody: string): Error {
  let code: string | undefined;
  try {
    const parsed = JSON.parse(errBody) as { error?: unknown };
    if (typeof parsed.error === 'string') code = parsed.error;
  } catch {
    /* non-JSON body */
  }
  const err: Error & { code?: string } = new Error(
    `DeepSeek API error ${status}: ${errBody.slice(0, 200)}`,
  );
  if (code) err.code = code;
  return err;
}

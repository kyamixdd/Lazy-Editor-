export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

/**
 * Resolve the configured Gemini model.
 * The retired 2.5 Flash default is upgraded automatically so stale Render
 * environment variables cannot keep breaking AI requests.
 */
export function resolveGeminiModel(configuredModel?: string): string {
  const model = (configuredModel || '').trim().replace(/^models\//, '');
  if (!model || model === 'gemini-2.5-flash') {
    return DEFAULT_GEMINI_MODEL;
  }
  return model;
}

const STORAGE_KEY = 'lazy_editor_gemini_api_key_v1';

/** Stored only in this browser profile; the server receives it per HTTPS request and never persists it. */
export function getGeminiApiKey(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveGeminiApiKey(key: string): void {
  window.localStorage.setItem(STORAGE_KEY, key.trim());
}

export function removeGeminiApiKey(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function getGeminiRequestHeaders(): Record<string, string> {
  const key = getGeminiApiKey();
  return key ? { 'X-Gemini-Api-Key': key } : {};
}

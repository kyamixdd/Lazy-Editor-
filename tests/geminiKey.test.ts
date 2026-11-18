import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getGeminiApiKey,
  getGeminiRequestHeaders,
  removeGeminiApiKey,
  saveGeminiApiKey,
} from '../src/utils/geminiKey';

function installLocalStorageMock() {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
    removeItem: (key: string) => { values.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
}

test('Gemini key is saved locally and exposed only as a request header', () => {
  installLocalStorageMock();
  saveGeminiApiKey('  test-gemini-key  ');
  assert.equal(getGeminiApiKey(), 'test-gemini-key');
  assert.deepEqual(getGeminiRequestHeaders(), {
    'X-Gemini-Api-Key': 'test-gemini-key',
  });
});

test('Gemini request headers are empty when no key is configured', () => {
  installLocalStorageMock();
  assert.equal(getGeminiApiKey(), '');
  assert.deepEqual(getGeminiRequestHeaders(), {});
});

test('Gemini key can be removed from local browser storage', () => {
  installLocalStorageMock();
  saveGeminiApiKey('test-gemini-key');
  removeGeminiApiKey();
  assert.equal(getGeminiApiKey(), '');
  assert.deepEqual(getGeminiRequestHeaders(), {});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GEMINI_MODEL, resolveGeminiModel } from '../src/utils/geminiModel';

test('uses Gemini 3.8 Flash when no model is configured', () => {
  assert.equal(resolveGeminiModel(), 'gemini-3.8-flash');
});

test('upgrades the retired Gemini 2.5 Flash model, including models/ prefix', () => {
  assert.equal(resolveGeminiModel('gemini-2.5-flash'), DEFAULT_GEMINI_MODEL);
  assert.equal(resolveGeminiModel('models/gemini-2.5-flash'), DEFAULT_GEMINI_MODEL);
});

test('preserves an explicitly configured supported model', () => {
  assert.equal(resolveGeminiModel('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(resolveGeminiModel('gemini-3.8-pro'), 'gemini-3.8-pro');
});

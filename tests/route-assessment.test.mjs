import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(here, '../extension/background/service-worker.js');
const chromeListener = { addListener() {} };
let storedState = {};
const chrome = {
  runtime: { onInstalled: chromeListener, onMessage: chromeListener, getManifest: () => ({ version: '1.2.3' }) },
  tabs: { onUpdated: chromeListener, onRemoved: chromeListener },
  storage: { local: { get: async () => storedState, set: async (value) => { storedState = value; } } },
  action: { setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} }
};
const context = {
  chrome, console, URL, Date, BigInt, Map, Set, Promise, Number, String, Array, Object,
  RegExp, Math, JSON, Error, setTimeout, clearTimeout
};
vm.runInNewContext(await readFile(workerPath, 'utf8'), context);
const assess = (fields) => context.assessTurn({ ...context.EMPTY_ROUTE_FIELDS, ...fields }, 'live', 'completed', ['page_fetch']);

test('一致的服务器报告字段只标记字段一致', () => {
  const result = assess({ requestedModel: 'GPT-5-2', resolvedModelSlug: 'gpt-5-2', serverModelSlug: 'gpt-5-2', responseModelSlug: 'gpt-4o', domModelSlug: 'gpt-4o' });
  assert.equal(result.verdict, 'normal');
  assert.equal(result.routeModel, 'gpt-5-2');
  assert.equal(result.modelLabel, 'gpt-4o');
  assert.match(result.reasons.join(' '), /标签与服务器报告模型字段不同/);
});

test('服务器字段不一致时标记冲突并不选择单一报告模型', () => {
  const result = assess({ requestedModel: 'gpt-5-2', resolvedModelSlug: 'gpt-5-2', serverModelSlug: 'gpt-4o', responseModelSlug: 'gpt-5-2' });
  assert.equal(result.verdict, 'conflict');
  assert.equal(result.routeModel, null);
});

test('仅有助手标签、缺少请求或缺少报告字段时无法确认', () => {
  const labelOnly = assess({ requestedModel: 'gpt-5-2', responseModelSlug: 'gpt-5-2' });
  assert.equal(labelOnly.verdict, 'unknown');
  assert.equal(labelOnly.routeModel, null);
  assert.equal(labelOnly.modelLabel, 'gpt-5-2');
  assert.equal(assess({ serverModelSlug: 'gpt-4o' }).verdict, 'unknown');
  assert.equal(assess({ requestedModel: 'auto', responseModelSlug: 'gpt-5-2' }).verdict, 'unknown');
});

test('显式路由不一致及专用任务分类保留各自语义', () => {
  const mismatch = assess({ requestedModel: 'gpt-5-2', resolvedModelSlug: 'gpt-4o', serverModelSlug: 'gpt-4o', responseModelSlug: 'gpt-5-2' });
  assert.equal(mismatch.verdict, 'mismatch');
  assert.equal(mismatch.routeModel, 'gpt-4o');
  assert.equal(assess({ requestedModel: 'gpt-5-2', resolvedModelSlug: 'gpt-4o', taskKind: 'image_generation' }).verdict, 'image_generation');
});

test('PoW 保留原值转换且默认外观配置可加载', async () => {
  const pow = context.parsePowDifficulty('07a120');
  assert.deepEqual(JSON.parse(JSON.stringify(pow)), { rawHex: '07a120', decimal: '500000' });
  assert.equal(context.DEFAULT_SETTINGS.theme, 'system');
  assert.equal(context.DEFAULT_SETTINGS.railWidthPx, 72);
  const state = await context.loadState();
  assert.equal(state.settings.railWidthPx, 72);
  assert.equal(state.settings.retentionLimit, 100);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWithAi, parseReply, aiConfig, DEFAULT_MODEL, DEFAULT_BASE_URL } from '../src/ai.js';

const config = { apiKey: 'test-key', model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL };
const reply = (content, extra = {}) =>
  new Response(JSON.stringify({ model: DEFAULT_MODEL, choices: [{ finish_reason: 'stop', message: { content } }], ...extra }), {
    status: 200,
  });
const good = JSON.stringify({
  rows: [
    { brand: 'Dell', model: 'PowerEdge R760', serial: '7XK2Q93', confidence: 'high', note: '' },
    { brand: 'NetApp', model: 'DS224C Shelf', serial: '', confidence: 'low', note: 'Covered by a stain' },
  ],
  vendor: 'Acme Systems',
  project: 'DC1 Compute Refresh',
  warnings: [],
});

test('is off until an API key is configured', async () => {
  assert.equal(aiConfig({}).apiKey, '');
  assert.equal(aiConfig({}).model, 'deepseek-v4.1-flash');
  await assert.rejects(extractWithAi({ text: 'x' }, { config: { ...config, apiKey: '' } }), { status: 503 });
});

test('sends an OpenAI-compatible request to OpenCode Go and returns checked rows', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return reply(good);
  };
  const result = await extractWithAi({ fileName: 'DO-1042.xlsx', text: 'Brand | Model | Serial\nDell | PowerEdge R760 | 7XK2Q93' }, { config, fetchImpl });
  assert.equal(sent.url, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
  assert.equal(sent.init.headers.authorization, 'Bearer test-key');
  assert.equal(sent.init.headers['user-agent'], 'asset-manager/0.1');
  assert.match(sent.init.headers['x-opencode-session'], /^[0-9a-f-]{36}$/);
  assert.equal(sent.body.model, 'deepseek-v4.1-flash');
  assert.deepEqual(sent.body.response_format, { type: 'json_object' });
  assert.match(sent.body.messages[1].content, /Dell \| PowerEdge R760 \| 7XK2Q93/);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].serial, '');
  assert.equal(result.vendor, 'Acme Systems');
  assert.equal(result.usedImages, false);
});

test('attaches page images, and retries with text only if images are refused', async () => {
  const calls = [];
  const sessions = new Set();
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(Array.isArray(body.messages[1].content));
    sessions.add(init.headers['x-opencode-session']);
    return calls.length === 1 ? new Response('{"error":"image input not supported"}', { status: 400 }) : reply(good);
  };
  const result = await extractWithAi(
    { text: 'Make Model Serial', images: ['data:image/jpeg;base64,AAAA', 'not-an-image'] },
    { config, fetchImpl },
  );
  assert.deepEqual(calls, [true, false]);
  assert.equal(sessions.size, 1); // the retry is part of the same conversation
  assert.equal(result.imagesRefused, true);
});

test('reads JSON wrapped in prose or code fences, and tolerates bad fields', () => {
  const parsed = parseReply('Here you go:\n```json\n{"rows":[{"brand":" Cisco ","model":"C9300","serial":"FOC1","confidence":"maybe"},{"brand":"","model":"","serial":""}],"warnings":"none"}\n```');
  assert.deepEqual(parsed.rows, [{ brand: 'Cisco', model: 'C9300', serial: 'FOC1', confidence: 'low', note: '' }]);
  assert.deepEqual(parsed.warnings, []);
  assert.throws(() => parseReply('Sorry, I cannot help with that.'), { status: 502 });
});

test('turns service errors into plain messages', async () => {
  const failWith = (status) => async () => new Response('{}', { status });
  await assert.rejects(extractWithAi({ text: 'x' }, { config, fetchImpl: failWith(401) }), /rejected the API key/);
  await assert.rejects(extractWithAi({ text: 'x' }, { config, fetchImpl: failWith(429) }), { status: 429 });
  await assert.rejects(extractWithAi({ text: 'x' }, { config, fetchImpl: failWith(503) }), /had a problem/);
  await assert.rejects(
    extractWithAi({ text: 'x' }, { config, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    /Couldn't reach the AI service/,
  );
  await assert.rejects(extractWithAi({ text: 'x'.repeat(200_001) }, { config, fetchImpl: failWith(200) }), { status: 413 });
});

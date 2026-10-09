import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiPlannerProvider } from '../../src/modules/planner/gemini.adapter.js';
import type { AiProviderError } from '../../src/modules/planner/provider.types.js';
import { parseEnvironment } from '../../src/shared/config/env.js';
import { successfulPlan } from '../fakes/fake-gemini.js';

const apiKey = 'AIzaSyUnitTestKeyMustStayInHeaderOnly-0123456789';
const environment = parseEnvironment({
  NODE_ENV: 'test',
  AI_ENABLED: 'true',
  CREDENTIAL_ENCRYPTION_ACTIVE_KEY_VERSION: 'test-v1',
  CREDENTIAL_ENCRYPTION_KEYRING: JSON.stringify({ 'test-v1': Buffer.alloc(32, 17).toString('base64') }),
  AI_MAX_INPUT_TOKENS: '10000',
  AI_MAX_OUTPUT_TOKENS: '2048',
});

function providerResponse(text: string, finishReason = 'STOP') {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 23 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini planner adapter', () => {
  it('sends the creator key in the API key header and validates structured output', async () => {
    let capturedRequest: Request | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return providerResponse(JSON.stringify(successfulPlan()));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GeminiPlannerProvider(environment).generate({
      apiKey,
      model: 'gemini-test-model',
      prompt: '{"goal":"Build a small task management API"}',
      signal: new AbortController().signal,
    });

    expect(result.value.planTitle).toBe('Task management API');
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 23 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.headers.get('x-goog-api-key')).toBe(apiKey);
    expect(capturedRequest?.url).not.toContain(apiKey);
    const requestBody = await capturedRequest!.clone().text();
    expect(requestBody).toContain('responseJsonSchema');
    expect(requestBody).toContain('application/json');
    expect(requestBody).not.toContain(apiKey);
  });

  it('maps malformed provider output and safety refusals to safe errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse('{not-json'))
      .mockResolvedValueOnce(providerResponse('', 'SAFETY'));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new GeminiPlannerProvider(environment);

    await expect(provider.generate({ apiKey, model: 'gemini-test-model', prompt: 'goal', signal: new AbortController().signal }))
      .rejects.toMatchObject<Partial<AiProviderError>>({ code: 'AI_OUTPUT_INVALID' });
    await expect(provider.generate({ apiKey, model: 'gemini-test-model', prompt: 'goal', signal: new AbortController().signal }))
      .rejects.toMatchObject<Partial<AiProviderError>>({ code: 'AI_REFUSED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps provider rate limiting without an SDK retry', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new GeminiPlannerProvider(environment).understand({
      apiKey,
      model: 'gemini-test-model',
      prompt: 'goal',
      signal: new AbortController().signal,
    })).rejects.toMatchObject<Partial<AiProviderError>>({ code: 'AI_RATE_LIMITED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

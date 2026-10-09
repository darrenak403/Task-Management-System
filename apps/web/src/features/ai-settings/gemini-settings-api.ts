import { api } from '@/lib/api-client';
import type { GeminiCredential } from '@/lib/dto';

const PATH = '/me/ai-provider-credentials/gemini';

/** Metadata only: the API never returns the key itself. */
export async function getGeminiCredential(signal?: AbortSignal): Promise<GeminiCredential> {
  return (await api<{ data: GeminiCredential }>(PATH, { signal })).data;
}

/** The server verifies the key with Gemini before storing it. */
export async function saveGeminiCredential(input: { key: string; model: string }): Promise<GeminiCredential> {
  return (await api<{ data: GeminiCredential }>(PATH, { method: 'PUT', body: input })).data;
}

export async function updateGeminiModel(model: string): Promise<GeminiCredential> {
  return (await api<{ data: GeminiCredential }>(PATH, { method: 'PATCH', body: { model } })).data;
}

/** Asks the server to check the stored key against Gemini. Costs no tokens. */
export async function testGeminiCredential(): Promise<GeminiCredential> {
  return (await api<{ data: GeminiCredential }>(`${PATH}/test`, { method: 'POST' })).data;
}

export function deleteGeminiCredential(): Promise<void> {
  return api(PATH, { method: 'DELETE' });
}

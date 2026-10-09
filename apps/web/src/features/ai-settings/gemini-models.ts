import { messages } from '@/i18n/messages';

/**
 * Gemini text models offered in the picker. Prices are USD per one million tokens on Google's paid tier,
 * copied from https://ai.google.dev/gemini-api/docs/pricing in October 2026. They are a guide, not a quote:
 * Google changes them, so the picker links to that page.
 */
export type GeminiModel = {
  id: string;
  name: string;
  /** Whether Google offers a free tier (with lower rate limits) for this model. */
  freeTier: boolean;
  inputPrice: number;
  outputPrice: number;
};

export const GEMINI_PRICING_URL = 'https://ai.google.dev/gemini-api/docs/pricing';

export const GEMINI_MODELS: readonly GeminiModel[] = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', freeTier: true, inputPrice: 0.75, outputPrice: 3.75 },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', freeTier: true, inputPrice: 0.3, outputPrice: 2.5 },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', freeTier: true, inputPrice: 0.25, outputPrice: 1.5 },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (preview)', freeTier: false, inputPrice: 2, outputPrice: 12 },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', freeTier: true, inputPrice: 0.3, outputPrice: 2.5 },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash-Lite', freeTier: true, inputPrice: 0.1, outputPrice: 0.4 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', freeTier: true, inputPrice: 1.25, outputPrice: 10 },
];

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "Free tier · $0.75 in / $3.75 out" */
export function priceLabel(model: GeminiModel): string {
  const text = messages().aiSettings.model;
  return text.price(model.freeTier ? text.freeTier : text.paidOnly, usd.format(model.inputPrice), usd.format(model.outputPrice));
}

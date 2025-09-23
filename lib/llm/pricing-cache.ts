import { configManager, type ProviderPricingEntry } from '@/lib/config/storage';
import type { ProviderId, ProviderModel } from '@/lib/llm/providers/types';
import type { OpenRouterModel } from '@/lib/llm/models-api';

const OPENROUTER_PROVIDER: ProviderId = 'openrouter';

function toPerMillion(value?: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  if (parsed < 0.01) {
    return parsed * 1_000_000;
  }

  return parsed;
}

export function registerPricingFromProviderModels(
  provider: ProviderId,
  models: ProviderModel[]
): void {
  if (!Array.isArray(models) || models.length === 0) {
    return;
  }

  const pricingMap: Record<string, ProviderPricingEntry> = {};

  for (const model of models) {
    if (!model?.pricing) {
      continue;
    }

    const entry: ProviderPricingEntry = {
      input: model.pricing.input,
      output: model.pricing.output,
      reasoning: model.pricing.reasoning
    };

    if (!Number.isFinite(entry.input) || !Number.isFinite(entry.output)) {
      continue;
    }

    pricingMap[model.id] = entry;
    pricingMap[`${provider}/${model.id}`] = entry;
  }

  if (provider === OPENROUTER_PROVIDER) {
    for (const [modelId, entry] of Object.entries(pricingMap)) {
      const slug = modelId.split('/').pop();
      if (slug && !pricingMap[slug]) {
        pricingMap[slug] = entry;
      }
    }
  }

  if (Object.keys(pricingMap).length > 0) {
    configManager.setProviderPricing(provider, pricingMap);
  }
}

export function registerOpenRouterPricingFromApi(models: OpenRouterModel[]): void {
  if (!Array.isArray(models) || models.length === 0) {
    return;
  }

  const pricingMap: Record<string, ProviderPricingEntry> = {};

  for (const model of models) {
    const input = toPerMillion(model.pricing?.prompt);
    const output = toPerMillion(model.pricing?.completion);
    const reasoning = toPerMillion(model.pricing?.internal_reasoning);

    if (input === undefined || output === undefined) {
      continue;
    }

    const entry: ProviderPricingEntry = {
      input,
      output,
      reasoning
    };

    pricingMap[model.id] = entry;
    pricingMap[`${OPENROUTER_PROVIDER}/${model.id}`] = entry;

    if (model.canonical_slug) {
      pricingMap[model.canonical_slug] = entry;
    }
  }

  if (Object.keys(pricingMap).length > 0) {
    configManager.setProviderPricing(OPENROUTER_PROVIDER, pricingMap);
  }
}

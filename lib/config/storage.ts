
import { ProviderId, ProviderModel } from '@/lib/llm/providers/types';
import { UsageInfo } from '@/lib/llm/types';

export interface SessionCost {
  sessionId: string;
  startTime: Date;
  totalCost: number;
  messageCount: number;
  providerBreakdown: Record<string, {
    cost: number;
    tokenUsage: {
      input: number;
      output: number;
    };
    requestCount: number;
  }>;
}

export interface CostSettings {
  showCosts?: boolean;
  dailyLimit?: number;
  projectLimit?: number;
  warningThreshold?: number;
}

export interface ModelCacheEntry {
  models: ProviderModel[];
  timestamp: string;
  expiresAt: string;
}

export interface ProviderPricingEntry {
  input: number;
  output: number;
  reasoning?: number;
}

export interface AppSettings {
  openRouterApiKey?: string;
  defaultModel?: string;
  selectedProvider?: ProviderId;
  providerKeys?: Partial<Record<ProviderId, string>>;
  providerModels?: Partial<Record<ProviderId, string>>;
  theme?: 'light' | 'dark' | 'system';
  costSettings?: CostSettings;
  currentSession?: SessionCost;
  lifetimeCosts?: {
    total: number;
    byProvider: Record<string, number>;
    lastReset?: Date;
  };
  hasSeenAboutModal?: boolean;
  hasSeenGuidedTour?: boolean;
  modelCache?: Partial<Record<ProviderId, ModelCacheEntry>>;
  modelPricing?: Partial<Record<ProviderId, Record<string, ProviderPricingEntry>>>;
}

class ConfigManager {
  private readonly STORAGE_KEY = 'deepstudio-settings';

  getSettings(): AppSettings {
    if (typeof window === 'undefined') {
      return {};
    }
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return {};
    
    const settings = JSON.parse(stored);
    
    if ('autoSave' in settings || 'autoSaveInterval' in settings) {
      delete settings.autoSave;
      delete settings.autoSaveInterval;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    }
    
    return settings;
  }

  setSetting<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): void {
    if (typeof window === 'undefined') {
      return;
    }
    const settings = this.getSettings();
    settings[key] = value;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
  }

  hasSeenTour(): boolean {
    return Boolean(this.getSettings().hasSeenGuidedTour);
  }

  setHasSeenTour(seen: boolean): void {
    this.setSetting('hasSeenGuidedTour', seen);
  }

  getApiKey(): string | null {
    const provider = this.getSelectedProvider();
    if (provider) {
      return this.getProviderApiKey(provider);
    }
    return this.getSettings().openRouterApiKey || null;
  }

  setApiKey(key: string): void {
    const provider = this.getSelectedProvider();
    if (provider) {
      this.setProviderApiKey(provider, key);
    }
    this.setSetting('openRouterApiKey', key);
  }

  getDefaultModel(): string {
    const provider = this.getSelectedProvider();
    if (provider) {
      return this.getProviderModel(provider) || this.getProviderDefaultModel(provider);
    }
    return this.getSettings().defaultModel || 'deepseek/deepseek-chat';
  }

  setDefaultModel(model: string): void {
    const provider = this.getSelectedProvider();
    if (provider) {
      this.setProviderModel(provider, model);
    }
    this.setSetting('defaultModel', model);
  }

  getSelectedProvider(): ProviderId {
    return this.getSettings().selectedProvider || 'openrouter';
  }

  setSelectedProvider(provider: ProviderId): void {
    this.setSetting('selectedProvider', provider);
  }

  getProviderApiKey(provider: ProviderId): string | null {
    const settings = this.getSettings();
    if (settings.providerKeys?.[provider]) {
      return settings.providerKeys[provider];
    }
    if (provider === 'openrouter' && settings.openRouterApiKey) {
      return settings.openRouterApiKey;
    }
    return null;
  }

  setProviderApiKey(provider: ProviderId, key: string): void {
    const settings = this.getSettings();
    const providerKeys = settings.providerKeys || {};
    providerKeys[provider] = key;
    this.setSetting('providerKeys', providerKeys);
    
    if (provider === 'openrouter') {
      this.setSetting('openRouterApiKey', key);
    }
  }

  getProviderModel(provider: ProviderId): string | null {
    const settings = this.getSettings();
    if (settings.providerModels?.[provider]) {
      return settings.providerModels[provider];
    }
    if (provider === 'openrouter' && settings.defaultModel) {
      return settings.defaultModel;
    }
    return null;
  }

  setProviderModel(provider: ProviderId, model: string): void {
    const settings = this.getSettings();
    const providerModels = settings.providerModels || {};
    providerModels[provider] = model;
    this.setSetting('providerModels', providerModels);
    
    if (provider === 'openrouter') {
      this.setSetting('defaultModel', model);
    }
  }

  getModelPricing(provider: ProviderId, model: string): ProviderPricingEntry | null {
    const settings = this.getSettings();
    const providerPricing = settings.modelPricing?.[provider];
    if (!providerPricing) {
      return null;
    }

    return (
      providerPricing[model] ||
      providerPricing[`${provider}/${model}`] ||
      (model.includes('/') ? providerPricing[model.split('/').pop() ?? ''] : null)
    ) || null;
  }

  setModelPricing(provider: ProviderId, model: string, pricing: ProviderPricingEntry): void {
    if (typeof window === 'undefined') {
      return;
    }

    const settings = this.getSettings();
    const modelPricing = { ...(settings.modelPricing || {}) };
    const providerPricing = { ...(modelPricing[provider] || {}) };
    providerPricing[model] = pricing;
    modelPricing[provider] = providerPricing;
    this.setSetting('modelPricing', modelPricing);
  }

  setProviderPricing(provider: ProviderId, pricingMap: Record<string, ProviderPricingEntry>): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (!pricingMap || Object.keys(pricingMap).length === 0) {
      return;
    }

    const settings = this.getSettings();
    const modelPricing = { ...(settings.modelPricing || {}) };
    const providerPricing = { ...(modelPricing[provider] || {}) };

    for (const [model, pricing] of Object.entries(pricingMap)) {
      providerPricing[model] = pricing;
    }

    modelPricing[provider] = providerPricing;
    this.setSetting('modelPricing', modelPricing);
  }

  clearProviderPricing(provider?: ProviderId): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (!provider) {
      this.setSetting('modelPricing', {});
      return;
    }

    const settings = this.getSettings();
    if (!settings.modelPricing?.[provider]) {
      return;
    }

    const modelPricing = { ...(settings.modelPricing || {}) };
    delete modelPricing[provider];
    this.setSetting('modelPricing', modelPricing);
  }

  private getProviderDefaultModel(provider: ProviderId): string {
    switch (provider) {
      case 'openrouter':
        return 'deepseek/deepseek-chat';
      case 'openai':
        return 'gpt-4o-mini';
      case 'anthropic':
        return 'claude-3-5-haiku-20241022';
      case 'groq':
        return 'llama-3.3-70b-versatile';
      case 'gemini':
        return 'gemini-1.5-flash';
      case 'ollama':
        return 'llama3.2:latest';
      case 'lmstudio':
        return 'local-model';
      case 'sambanova':
        return 'Meta-Llama-3.3-70B-Instruct';
      default:
        return 'deepseek/deepseek-chat';
    }
  }

  getTheme(): 'light' | 'dark' | 'system' {
    return this.getSettings().theme || 'dark';
  }

  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.setSetting('theme', theme);
  }

  clearSettings(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.STORAGE_KEY);
    }
  }

  getCostSettings(): CostSettings {
    return this.getSettings().costSettings || {
      showCosts: true,
      warningThreshold: 80
    };
  }

  setCostSettings(settings: CostSettings): void {
    this.setSetting('costSettings', settings);
    // Broadcast the change to reactive components
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('deepstudio-cost-settings-changed'));
    }
  }

  getCurrentSession(): SessionCost | null {
    const session = this.getSettings().currentSession;
    if (!session) {
      return null;
    }
    return {
      ...session,
      startTime: new Date(session.startTime)
    };
  }

  startNewSession(): SessionCost {
    const session: SessionCost = {
      sessionId: Date.now().toString(),
      startTime: new Date(),
      totalCost: 0,
      messageCount: 0,
      providerBreakdown: {}
    };
    this.setSetting('currentSession', session);
    return session;
  }

  updateSessionCost(usage: UsageInfo, cost: number): void {
    let session = this.getCurrentSession();
    if (!session) {
      session = this.startNewSession();
    }

    session.totalCost += cost;
    session.messageCount += 1;

    const provider = usage.provider || 'unknown';
    if (!session.providerBreakdown[provider]) {
      session.providerBreakdown[provider] = {
        cost: 0,
        tokenUsage: { input: 0, output: 0 },
        requestCount: 0
      };
    }

    session.providerBreakdown[provider].cost += cost;
    session.providerBreakdown[provider].tokenUsage.input += usage.promptTokens;
    session.providerBreakdown[provider].tokenUsage.output += usage.completionTokens;
    session.providerBreakdown[provider].requestCount += 1;

    const lifetimeCosts = this.getSettings().lifetimeCosts || {
      total: 0,
      byProvider: {}
    };
    lifetimeCosts.total += cost;
    lifetimeCosts.byProvider[provider] = (lifetimeCosts.byProvider[provider] || 0) + cost;

    this.setSetting('currentSession', session);
    this.setSetting('lifetimeCosts', lifetimeCosts);
  }

  adjustSessionCost(provider: string, deltaCost: number, tokenDelta?: { input: number; output: number }): void {
    if (!deltaCost && !tokenDelta) {
      return;
    }

    const session = this.getCurrentSession();
    if (!session) {
      return;
    }

    const providerKey = provider || 'unknown';

    session.totalCost += deltaCost;

    if (!session.providerBreakdown[providerKey]) {
      session.providerBreakdown[providerKey] = {
        cost: 0,
        tokenUsage: { input: 0, output: 0 },
        requestCount: 0
      };
    }

    session.providerBreakdown[providerKey].cost += deltaCost;

    if (tokenDelta) {
      session.providerBreakdown[providerKey].tokenUsage.input += tokenDelta.input;
      session.providerBreakdown[providerKey].tokenUsage.output += tokenDelta.output;
    }

    const lifetimeCosts = this.getSettings().lifetimeCosts || {
      total: 0,
      byProvider: {}
    };
    lifetimeCosts.total += deltaCost;
    lifetimeCosts.byProvider[providerKey] = (lifetimeCosts.byProvider[providerKey] || 0) + deltaCost;

    this.setSetting('currentSession', session);
    this.setSetting('lifetimeCosts', lifetimeCosts);
  }

  getLifetimeCosts() {
    return this.getSettings().lifetimeCosts || {
      total: 0,
      byProvider: {}
    };
  }

  resetLifetimeCosts(): void {
    this.setSetting('lifetimeCosts', {
      total: 0,
      byProvider: {},
      lastReset: new Date()
    });
  }

  checkCostLimits(): { warning: boolean; exceeded: boolean; message?: string } {
    const settings = this.getCostSettings();
    const session = this.getCurrentSession();
    
    if (!session || !settings.dailyLimit) {
      return { warning: false, exceeded: false };
    }

    const percentUsed = (session.totalCost / settings.dailyLimit) * 100;
    
    if (percentUsed >= 100) {
      return {
        warning: false,
        exceeded: true,
        message: `Daily limit of $${settings.dailyLimit.toFixed(2)} exceeded`
      };
    }

    if (settings.warningThreshold && percentUsed >= settings.warningThreshold) {
      return {
        warning: true,
        exceeded: false,
        message: `${percentUsed.toFixed(0)}% of daily limit used ($${session.totalCost.toFixed(2)} of $${settings.dailyLimit.toFixed(2)})`
      };
    }

    return { warning: false, exceeded: false };
  }

  // Model cache management
  getCachedModels(provider: ProviderId): ModelCacheEntry | null {
    const settings = this.getSettings();
    const cache = settings.modelCache?.[provider];
    
    if (!cache) return null;
    
    // Check if cache is expired
    const now = new Date();
    const expiresAt = new Date(cache.expiresAt);
    
    if (now > expiresAt) {
      // Cache expired, remove it
      this.clearModelCache(provider);
      return null;
    }
    
    return cache;
  }

  setCachedModels(provider: ProviderId, models: ProviderModel[]): void {
    const settings = this.getSettings();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    
    const cache = settings.modelCache || {};
    cache[provider] = {
      models,
      timestamp: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
    
    this.setSetting('modelCache', cache);
  }

  clearModelCache(provider?: ProviderId): void {
    if (provider) {
      const settings = this.getSettings();
      const cache = settings.modelCache || {};
      delete cache[provider];
      this.setSetting('modelCache', cache);
    } else {
      // Clear all cache
      this.setSetting('modelCache', {});
    }
  }

  isCacheValid(provider: ProviderId): boolean {
    const cache = this.getCachedModels(provider);
    return cache !== null;
  }
}

export const configManager = new ConfigManager();

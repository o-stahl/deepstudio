'use client';

import React, { useState, useEffect } from 'react';
import { configManager, AppSettings } from '@/lib/config/storage';
import { LLMClient } from '@/lib/llm/llm-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eye, EyeOff, Check, X, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { ModelSelector } from '@/components/model-selector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ProviderId } from '@/lib/llm/providers/types';
import { getAllProviders, getProvider } from '@/lib/llm/providers/registry';

interface ModelSettingsPanelProps {
  onClose?: () => void;
  onModelChange?: (modelId: string) => void;
}

export function ModelSettingsPanel({ onClose, onModelChange }: ModelSettingsPanelProps) {
  const [_settings, setSettings] = useState<AppSettings>({});
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(() => 
    configManager.getSelectedProvider()
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [validatingKey, setValidatingKey] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [currentApiKey, setCurrentApiKey] = useState('');

  useEffect(() => {
    // Load settings on mount
    const loadedSettings = configManager.getSettings();
    setSettings(loadedSettings);
    const provider = configManager.getSelectedProvider();
    setCurrentApiKey(configManager.getProviderApiKey(provider) || '');
  }, []);

  useEffect(() => {
    // Update API key when provider changes
    const key = configManager.getProviderApiKey(selectedProvider) || '';
    setCurrentApiKey(key);
    setKeyValid(null); // Reset validation
  }, [selectedProvider]);

  const _updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    configManager.setSetting(key, value);
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleProviderChange = (provider: ProviderId) => {
    setSelectedProvider(provider);
    configManager.setSelectedProvider(provider);
    // Load the API key for the new provider
    const key = configManager.getProviderApiKey(provider) || '';
    setCurrentApiKey(key);
    setKeyValid(null);
  };

  const handleApiKeyChange = (key: string) => {
    setCurrentApiKey(key);
    configManager.setProviderApiKey(selectedProvider, key);
    setKeyValid(null);
    
    // Clear cached models for this provider when API key changes
    configManager.clearModelCache(selectedProvider);
    
    // Dispatch event to notify other components that API key was updated
    window.dispatchEvent(new CustomEvent('apiKeyUpdated', {
      detail: { provider: selectedProvider, hasKey: !!key }
    }));
  };

  const validateApiKey = async () => {
    if (!currentApiKey) {
      toast.error('Please enter an API key');
      return;
    }

    setValidatingKey(true);
    try {
      const isValid = await LLMClient.validateApiKey(currentApiKey, selectedProvider);
      setKeyValid(isValid);
      
      if (isValid) {
        toast.success('API key is valid!');
      } else {
        toast.error('Invalid API key');
      }
    } catch {
      setKeyValid(false);
      toast.error('Failed to validate API key');
    } finally {
      setValidatingKey(false);
    }
  };

  const providerConfig = getProvider(selectedProvider);

  return (
    <div className="space-y-6">
        <div>
          <h3 className="font-medium text-sm">Model Settings</h3>
          <p className="text-muted-foreground text-xs mt-1">
            Configure your AI model and API connection
          </p>
      </div>

      {/* Provider Selection */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="provider">AI Provider</Label>
          <Select value={selectedProvider} onValueChange={handleProviderChange}>
            <SelectTrigger id="provider" className="w-full mt-2 !h-fit">
              <SelectValue placeholder="Select a provider">
                {selectedProvider && (
                  <div className="flex flex-col text-left">
                    <span className="font-medium">{providerConfig.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {providerConfig.description}
                    </span>
                  </div>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="max-h-[400px]">
              {getAllProviders().map(provider => (
                <SelectItem key={provider.id} value={provider.id}>
                  <div className="flex flex-col">
                    <span className="font-medium">{provider.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {provider.description}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* API Key (required for cloud providers, optional for local) */}
        {(providerConfig.apiKeyRequired || providerConfig.isLocal) && (
          <div>
            <Label htmlFor="api-key">
              {providerConfig.name} API Key
              {!providerConfig.apiKeyRequired && (
                <span className="text-muted-foreground text-xs ml-1">(optional)</span>
              )}
            </Label>
            <div className="flex gap-2 mt-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  value={currentApiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={providerConfig.apiKeyPlaceholder || 'API Key'}
                  className="pr-10"
                  data-tour-id="provider-key-input"
                />
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 h-7 w-7"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button
              onClick={validateApiKey}
              disabled={validatingKey || !currentApiKey}
              size="sm"
            >
              {validatingKey ? 'Validating...' : 'Validate'}
            </Button>
            {keyValid !== null && (
              <div className="flex items-center">
                {keyValid ? (
                  <Check className="h-5 w-5 text-green-500" />
                ) : (
                  <X className="h-5 w-5 text-red-500" />
                )}
              </div>
            )}
          </div>
          {providerConfig.apiKeyHelpUrl && (
            <p className="text-sm text-muted-foreground mt-2">
              Get your API key from{' '}
              <a 
                href={providerConfig.apiKeyHelpUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                {providerConfig.name} <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
          {providerConfig.isLocal && !providerConfig.apiKeyRequired && (
            <p className="text-sm text-muted-foreground mt-2">
              API key is optional for {providerConfig.name}. Only needed if you&apos;ve configured authentication on your local server.
            </p>
          )}
          </div>
        )}

        {!providerConfig.apiKeyRequired && providerConfig.isLocal && (
          <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">
            <p className="font-medium mb-1">Local Provider</p>
            <p>Make sure {providerConfig.name} is running on your machine.</p>
            <p>Default endpoint: <code className="text-xs">{providerConfig.baseUrl}</code></p>
            {selectedProvider === 'lmstudio' && (
              <div className="mt-2 text-xs">
                <p className="font-medium">For tool use support:</p>
                <p>• Load a model like qwen/qwen3-4b-thinking-2507</p>
                <p>• Start the local server in LM Studio</p>
                <p>• Models will be automatically discovered</p>
              </div>
            )}
          </div>
        )}

        {/* Model Selection */}
        <ModelSelector 
          provider={selectedProvider}
          onChange={(modelId) => {
            onModelChange?.(modelId);
          }}
          className="space-y-2"
        />
      </div>

      {/* Actions */}
      {onClose && (
        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose} size="sm">
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

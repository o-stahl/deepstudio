'use client';

import { useState, useEffect } from 'react';
import { configManager, CostSettings } from '@/lib/config/storage';

const COST_SETTINGS_CHANGE_EVENT = 'osw-studio-cost-settings-changed';

export function useCostSettings() {
  const [costSettings, setCostSettings] = useState<CostSettings>(() => 
    configManager.getCostSettings()
  );

  useEffect(() => {
    const handleCostSettingsChange = () => {
      setCostSettings(configManager.getCostSettings());
    };

    window.addEventListener(COST_SETTINGS_CHANGE_EVENT, handleCostSettingsChange);

    return () => {
      window.removeEventListener(COST_SETTINGS_CHANGE_EVENT, handleCostSettingsChange);
    };
  }, []);

  const shouldShowCosts = costSettings.showCosts !== false;

  return {
    costSettings,
    shouldShowCosts
  };
}

export function broadcastCostSettingsChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COST_SETTINGS_CHANGE_EVENT));
  }
}
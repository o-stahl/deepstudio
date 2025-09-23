'use client';

import React, { useState, useEffect } from 'react';
import { configManager, AppSettings, CostSettings } from '@/lib/config/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useTheme } from 'next-themes';
import { DollarSign, AlertTriangle, Info } from 'lucide-react';
import { CostCalculator } from '@/lib/llm/cost-calculator';
import { AboutModal } from '@/components/about-modal';

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [_settings, setSettings] = useState<AppSettings>({});
  const [costSettings, setCostSettings] = useState<CostSettings>({});
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);

  useEffect(() => {
    // Load settings on mount
    setSettings(configManager.getSettings());
    setCostSettings(configManager.getCostSettings());
    setMounted(true);
  }, []);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    configManager.setSetting(key, value);
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const clearSettings = () => {
    if (confirm('Are you sure you want to clear all settings?')) {
      configManager.clearSettings();
      setSettings({});
      toast.success('Settings cleared');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-medium text-sm">Application Settings</h3>
        <p className="text-muted-foreground text-xs mt-1">
          Configure your preferences and display options
        </p>
      </div>

      <div className="space-y-4">

        {/* Theme */}
        <div>
          <Label htmlFor="theme">Theme</Label>
          <Select 
            value={mounted ? theme : 'dark'}
            onValueChange={(value: 'light' | 'dark' | 'system') => {
              setTheme(value);
              updateSetting('theme', value);
            }}
          >
            <SelectTrigger id="theme" className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Cost Tracking Settings */}
        <div className="border-t pt-4 mt-4">
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Cost Tracking
          </h4>

          {/* Show Costs */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <Label htmlFor="show-costs">Display Costs</Label>
              <p className="text-sm text-muted-foreground">
                Show cost information in messages
              </p>
            </div>
            <Switch
              id="show-costs"
              checked={costSettings.showCosts !== false}
              onCheckedChange={(checked) => {
                const newCostSettings = { ...costSettings, showCosts: checked };
                configManager.setCostSettings(newCostSettings);
                setCostSettings(newCostSettings);
              }}
            />
          </div>

          {/* Daily Limit */}
          <div className="mb-4">
            <Label htmlFor="daily-limit">Daily Cost Limit (USD)</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                id="daily-limit"
                type="number"
                min="0"
                step="0.01"
                placeholder="No limit"
                value={costSettings.dailyLimit || ''}
                onChange={(e) => {
                  const value = e.target.value ? parseFloat(e.target.value) : undefined;
                  const newCostSettings = { ...costSettings, dailyLimit: value };
                  configManager.setCostSettings(newCostSettings);
                  setCostSettings(newCostSettings);
                }}
              />
              {costSettings.dailyLimit && (
                <span className="text-sm text-muted-foreground">
                  ${costSettings.dailyLimit.toFixed(2)}/day
                </span>
              )}
            </div>
          </div>

          {/* Project Limit */}
          <div className="mb-4">
            <Label htmlFor="project-limit">Project Cost Limit (USD)</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                id="project-limit"
                type="number"
                min="0"
                step="0.01"
                placeholder="No limit"
                value={costSettings.projectLimit || ''}
                onChange={(e) => {
                  const value = e.target.value ? parseFloat(e.target.value) : undefined;
                  const newCostSettings = { ...costSettings, projectLimit: value };
                  configManager.setCostSettings(newCostSettings);
                  setCostSettings(newCostSettings);
                }}
              />
              {costSettings.projectLimit && (
                <span className="text-sm text-muted-foreground">
                  ${costSettings.projectLimit.toFixed(2)}/project
                </span>
              )}
            </div>
          </div>

          {/* Warning Threshold */}
          <div className="mb-4">
            <Label htmlFor="warning-threshold">Warning Threshold (%)</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input
                id="warning-threshold"
                type="number"
                min="50"
                max="100"
                step="5"
                value={costSettings.warningThreshold || 80}
                onChange={(e) => {
                  const value = parseInt(e.target.value);
                  const newCostSettings = { ...costSettings, warningThreshold: value };
                  configManager.setCostSettings(newCostSettings);
                  setCostSettings(newCostSettings);
                }}
              />
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Warn at {costSettings.warningThreshold || 80}%
              </span>
            </div>
          </div>

          {/* Lifetime Costs */}
          <div className="border-t pt-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Lifetime Total</div>
                <div className="text-xs text-muted-foreground">
                  {CostCalculator.formatCost(configManager.getLifetimeCosts().total)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm('Reset lifetime cost tracking? This cannot be undone.')) {
                    configManager.resetLifetimeCosts();
                    toast.success('Lifetime costs reset');
                  }
                }}
              >
                Reset Stats
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4 border-t">
        <div className="flex gap-2">
          <Button 
            variant="destructive" 
            onClick={clearSettings}
          >
            Clear All Settings
          </Button>
          <Button
            variant="outline"
            onClick={() => setAboutModalOpen(true)}
          >
            <Info className="mr-2 h-4 w-4" />
            About DeepStudio
          </Button>
        </div>
        
        {onClose && (
          <Button onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <AboutModal 
        open={aboutModalOpen} 
        onOpenChange={setAboutModalOpen} 
      />
    </div>
  );
}
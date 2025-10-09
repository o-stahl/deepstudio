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
import { DollarSign, AlertTriangle, Info, Download, Upload, Database, ChevronDown, Palette } from 'lucide-react';
import { CostCalculator } from '@/lib/llm/cost-calculator';
import { AboutModal } from '@/components/about-modal';
import { BackupService } from '@/lib/vfs/backup-service';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [_settings, setSettings] = useState<AppSettings>({});
  const [costSettings, setCostSettings] = useState<CostSettings>({});
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState('');
  const [openSections, setOpenSections] = useState({
    application: true,  // Default open
    costTracking: false,
    dataManagement: false
  });

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

  const handleExportData = async () => {
    try {
      setIsExporting(true);
      await BackupService.exportAllData();
      toast.success('Data exported successfully!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.osws';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        setIsImporting(true);
        setImportProgress(0);
        setImportMessage('Validating file...');

        const validation = await BackupService.validateBackupFile(file);
        if (!validation.valid) {
          toast.error(`Invalid backup file: ${validation.reason}`);
          return;
        }

        const shouldReplace = confirm(
          `Import ${validation.metadata?.projectCount || 0} projects?\n\n` +
          'Choose OK to REPLACE all current data, or Cancel to MERGE with existing data.'
        );

        await BackupService.importAllData(file, {
          mode: shouldReplace ? 'replace' : 'merge',
          onProgress: (progress, message) => {
            setImportProgress(progress);
            setImportMessage(message);
          }
        });

        toast.success('Data imported successfully!');
        setTimeout(() => window.location.reload(), 1000);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Import failed');
      } finally {
        setIsImporting(false);
        setImportProgress(0);
        setImportMessage('');
      }
    };
    input.click();
  };

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  return (
    <div className="max-h-[calc(100vh-4rem)] overflow-y-auto">
      <div className="space-y-3 pb-4">
        
        {/* Application Settings Section */}
        <Collapsible
          open={openSections.application}
          onOpenChange={() => toggleSection('application')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              <h4 className="font-medium text-sm">Application Settings</h4>
            </div>
            <ChevronDown 
              className={`h-4 w-4 transition-transform duration-200 ${
                openSections.application ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pt-2 pb-3">
            <p className="text-muted-foreground text-xs mb-4">
              Configure your preferences and display options
            </p>
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
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Cost Tracking Section */}
        <Collapsible
          open={openSections.costTracking}
          onOpenChange={() => toggleSection('costTracking')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              <h4 className="font-medium text-sm">Cost Tracking</h4>
            </div>
            <ChevronDown 
              className={`h-4 w-4 transition-transform duration-200 ${
                openSections.costTracking ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pt-2 pb-3">
            <div className="space-y-4">
              {/* Show Costs */}
              <div className="flex items-center justify-between">
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
              <div>
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
              <div>
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
              <div>
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
          </CollapsibleContent>
        </Collapsible>

        {/* Data Management Section */}
        <Collapsible
          open={openSections.dataManagement}
          onOpenChange={() => toggleSection('dataManagement')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <h4 className="font-medium text-sm">Data Management</h4>
            </div>
            <ChevronDown 
              className={`h-4 w-4 transition-transform duration-200 ${
                openSections.dataManagement ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pt-2 pb-3">
            <p className="text-xs text-muted-foreground mb-4">
              Backup and restore your projects, conversations, and settings. Use this to migrate your data to OSWStudio or create backups.
            </p>

            <div className="space-y-3">
              {/* Export Data */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Export All Data</div>
                  <div className="text-xs text-muted-foreground">
                    Download a backup file containing all your projects and data
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportData}
                  disabled={isExporting}
                  className="flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
              </div>

              {/* Import Data */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Import Data</div>
                  <div className="text-xs text-muted-foreground">
                    Restore from a .osws backup file
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleImportData}
                  disabled={isImporting}
                  className="flex items-center gap-2"
                >
                  <Upload className="h-4 w-4" />
                  {isImporting ? 'Importing...' : 'Import'}
                </Button>
              </div>

              {/* Import Progress */}
              {isImporting && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span>{importMessage}</span>
                    <span>{importProgress}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className="bg-primary h-2 rounded-full transition-all duration-300" 
                      style={{ width: `${importProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Actions */}
      <div className="flex justify-between pt-4 px-3 border-t mt-4">
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
            About OSW Studio
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
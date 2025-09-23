'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Orchestrator } from '@/lib/llm/orchestrator';
import { testScenarios } from '@/lib/testing/test-scenarios';
import { ArrowLeft, Play, CheckCircle, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';
import { ModelSettingsPanel } from '@/components/settings/model-settings';
import { configManager } from '@/lib/config/storage';
import { AppHeader, HeaderAction } from '@/components/ui/app-header';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface TestResult {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'stopped';
  executionTime?: number;
  errors?: string[];
  details?: string;
  filesModified?: string[];
  toolCalls?: number;
  generationOutput?: string;
}

export default function TestGenerationPage() {
  const router = useRouter();
  const [testResults, setTestResults] = useState<TestResult[]>(
    testScenarios.map(scenario => ({
      id: scenario.id,
      name: scenario.name,
      status: 'pending'
    }))
  );
  const [runningTest, setRunningTest] = useState<string | null>(null);
  const [orchestratorInstances, setOrchestratorInstances] = useState<Map<string, Orchestrator>>(new Map());
  const [generationOutputs, setGenerationOutputs] = useState<Map<string, string>>(new Map());
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const generationOutputRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [overallStats, setOverallStats] = useState({
    total: 0,
    passed: 0,
    failed: 0,
    successRate: 0
  });
  
  // Model settings popover state
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [currentModel, setCurrentModel] = useState('');

  useEffect(() => {
    // Set the current model on the client to avoid hydration mismatch
    setCurrentModel(configManager.getDefaultModel());
  }, []);

  const getModelDisplayName = (modelId: string) => {
    if (!modelId) return 'Select Model';
    const parts = modelId.split('/');
    const modelName = parts[parts.length - 1];
    return modelName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const runSingleTest = async (scenarioId: string) => {
    const scenario = testScenarios.find(s => s.id === scenarioId);
    if (!scenario) return;

    const startTime = Date.now();
    setRunningTest(scenarioId);
    setExpandedTests(prev => new Set([...prev, scenarioId]));

    // Update status to running
    setTestResults(prev => prev.map(result => 
      result.id === scenarioId 
        ? { ...result, status: 'running', generationOutput: '' }
        : result
    ));

    try {
      const projectId = `test-${Date.now()}`;
      const orchestrator = new Orchestrator(
        projectId,
        undefined, // No existing conversation
        (message, step) => {
          if (message === 'assistant_delta' && ((step as any)?.text || (step as any)?.snapshot)) {
            const deltaText = (step as any).text as string | undefined;
            const snapshot = (step as any).snapshot as string | undefined;
            
            setGenerationOutputs(prev => {
              const newMap = new Map(prev);
              if (snapshot !== undefined) {
                newMap.set(scenarioId, snapshot);
              } else if (deltaText) {
                const current = newMap.get(scenarioId) || '';
                newMap.set(scenarioId, current + deltaText);
              }
              return newMap;
            });
            
            // Also update the test result for persistence
            setTestResults(prev => prev.map(result => 
              result.id === scenarioId 
                ? { ...result, generationOutput: snapshot || (result.generationOutput || '') + (deltaText || '') }
                : result
            ));
            
            // Auto-scroll to bottom of generation output
            setTimeout(() => {
              const outputElement = generationOutputRefs.current.get(scenarioId);
              if (outputElement) {
                outputElement.scrollTop = outputElement.scrollHeight;
              }
            }, 0);
          }
        }
      );
      
      // Store orchestrator instance for potential stopping
      setOrchestratorInstances(prev => {
        const newMap = new Map(prev);
        newMap.set(scenarioId, orchestrator);
        return newMap;
      });
      
      const result = await orchestrator.execute(scenario.prompt);

      setTestResults(prev => prev.map(testResult => 
        testResult.id === scenarioId 
          ? {
              ...testResult,
              status: result.success ? 'success' : 'failed',
              executionTime: Date.now() - startTime,
              errors: result.success ? undefined : [result.summary],
              details: result.summary,
              filesModified: [],
              toolCalls: result.stepsCompleted || 0
            }
          : testResult
      ));

      if (result.success) {
        toast.success(`Test passed: ${scenario.name}`);
      } else {
        toast.error(`Test failed: ${scenario.name} - ${result.summary}`);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      setTestResults(prev => prev.map(result => 
        result.id === scenarioId 
          ? {
              ...result,
              status: 'failed',
              executionTime: Date.now() - startTime,
              errors: [errorMessage],
              details: `Error: ${errorMessage}`
            }
          : result
      ));

      toast.error(`Test error: ${scenario.name}`);
    }

    // Clean up orchestrator instance
    setOrchestratorInstances(prev => {
      const newMap = new Map(prev);
      newMap.delete(scenarioId);
      return newMap;
    });
    
    setRunningTest(null);
    updateOverallStats();
  };

  const stopTest = (scenarioId: string) => {
    const orchestrator = orchestratorInstances.get(scenarioId);
    if (orchestrator) {
      orchestrator.stop();
      toast.info(`Stopping test: ${testScenarios.find(s => s.id === scenarioId)?.name}`);
    }
  };

  const runAllTests = async () => {
    const quickTests = ['style-background-gradient', 'ui-hamburger-menu', 'js-countdown-timer'];
    
    for (const testId of quickTests) {
      // Check if user has stopped execution
      if (runningTest === null) break;
      
      await runSingleTest(testId);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  };

  const updateOverallStats = () => {
    const completed = testResults.filter(r => r.status !== 'pending' && r.status !== 'running');
    const passed = testResults.filter(r => r.status === 'success');
    const failed = testResults.filter(r => r.status === 'failed' || r.status === 'stopped');
    
    setOverallStats({
      total: completed.length,
      passed: passed.length,
      failed: failed.length,
      successRate: completed.length > 0 ? (passed.length / completed.length) * 100 : 0
    });
  };

  const resetTests = () => {
    // Stop any running tests first
    orchestratorInstances.forEach((orchestrator, scenarioId) => {
      orchestrator.stop();
    });
    
    setTestResults(
      testScenarios.map(scenario => ({
        id: scenario.id,
        name: scenario.name,
        status: 'pending'
      }))
    );
    setOverallStats({ total: 0, passed: 0, failed: 0, successRate: 0 });
    setRunningTest(null);
    setOrchestratorInstances(new Map());
    setGenerationOutputs(new Map());
    setExpandedTests(new Set());
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'stopped': return <Square className="h-4 w-4 text-orange-500" />;
      case 'running': return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      default: return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const headerActions: HeaderAction[] = [
    {
      id: 'back',
      label: 'Back to Projects',
      icon: ArrowLeft,
      onClick: () => router.push('/'),
      variant: 'outline'
    }
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <AppHeader
        leftText="Model Tester"
        onLogoClick={() => router.push('/')}
        actions={headerActions}
      />

      {/* Main Content */}
      <div className="flex-1 overflow-auto bg-background p-6">
        <div className="max-w-6xl mx-auto">

        {/* Info Banner */}
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-1">How to Interpret Test Results</h3>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                These tests validate basic code generation capabilities across different task types. 
                A <strong>passing test</strong> means files were created/modified successfully. 
                A <strong>failing test</strong> indicates the model couldn&apos;t complete the task or didn&apos;t produce expected outputs.
              </p>
              <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
                <strong>Tip:</strong> Select your preferred provider and model below to test specific configurations. 
                The generation output will show you what the AI is thinking during execution.
              </div>
            </div>
          </div>
        </div>

        {/* Cost Warning Banner */}
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="text-amber-600 dark:text-amber-400 mt-0.5">💡</div>
            <div className="flex-1">
              <h3 className="font-medium text-amber-900 dark:text-amber-100 mb-1">Cost Warning</h3>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Running these tests can be <strong>very expensive</strong> and likely isn&apos;t necessary. 
                It&apos;s cheaper and easier to just use good models and research community feedback about agentic capabilities.
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-2">
                This tester is largely for evaluating how models perform with DeepStudio&apos;s implementation 
                and using those results to improve the agentic system.
              </p>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Total Tests</div>
            <div className="text-2xl font-bold">{overallStats.total}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Passed</div>
            <div className="text-2xl font-bold text-green-600">{overallStats.passed}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Failed</div>
            <div className="text-2xl font-bold text-red-600">{overallStats.failed}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-sm font-medium text-muted-foreground mb-1">Success Rate</div>
            <div className="text-2xl font-bold">{overallStats.successRate.toFixed(1)}%</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-4 mb-6">
          <Popover open={showModelSettings} onOpenChange={setShowModelSettings}>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <span>{getModelDisplayName(currentModel)}</span>
                {showModelSettings ? (
                  <ChevronDown className="h-4 w-4 ml-2" />
                ) : (
                  <ChevronUp className="h-4 w-4 ml-2" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96" align="start" side="bottom" sideOffset={4} avoidCollisions={false}>
              <ModelSettingsPanel 
                onClose={() => setShowModelSettings(false)}
                onModelChange={(modelId) => setCurrentModel(modelId)}
              />
            </PopoverContent>
          </Popover>
          <Button onClick={runAllTests} disabled={runningTest !== null}>
            <Play className="h-4 w-4 mr-2" />
            Run Quick Tests (5 tests)
          </Button>
          <Button variant="outline" onClick={resetTests} disabled={runningTest !== null}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        </div>

        {/* Test Results */}
        <div className="grid gap-4">
          {testResults.map((result) => {
            const scenario = testScenarios.find(s => s.id === result.id);
            return (
              <div key={result.id} className="bg-card border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 font-medium">
                      {getStatusIcon(result.status)}
                      {result.name}
                      <span className="text-sm font-normal text-muted-foreground">
                        ({scenario?.category})
                      </span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {scenario?.prompt.substring(0, 100)}...
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.executionTime && (
                      <span className="text-sm text-muted-foreground">
                        {(result.executionTime / 1000).toFixed(1)}s
                      </span>
                    )}
                    {result.status === 'running' && runningTest === result.id ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => stopTest(result.id)}
                      >
                        <Square className="h-3 w-3 mr-1" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => runSingleTest(result.id)}
                        disabled={runningTest !== null}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Test
                      </Button>
                    )}
                    {(result.status === 'running' || result.generationOutput || expandedTests.has(result.id)) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setExpandedTests(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(result.id)) {
                              newSet.delete(result.id);
                            } else {
                              newSet.add(result.id);
                            }
                            return newSet;
                          });
                        }}
                      >
                        {expandedTests.has(result.id) ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                {/* Generation Output Display */}
                {(result.status === 'running' || expandedTests.has(result.id)) && (result.generationOutput || generationOutputs.get(result.id)) && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="text-sm font-medium text-muted-foreground">Generation Output</div>
                      {result.status === 'running' && (
                        <div className="flex items-center gap-1">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          <span className="text-xs text-muted-foreground">Generating...</span>
                        </div>
                      )}
                    </div>
                    <div 
                      className="bg-muted/50 rounded-md p-3 max-h-64 overflow-y-auto"
                      ref={(el) => {
                        if (el) {
                          generationOutputRefs.current.set(result.id, el);
                        }
                      }}
                    >
                      <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80">
                        {result.generationOutput || generationOutputs.get(result.id) || ''}
                      </pre>
                    </div>
                  </div>
                )}
                
                {(result.status === 'success' || result.status === 'failed' || result.status === 'stopped') && (
                  <div className="mt-3 pt-3 border-t space-y-2">
                    {result.details && (
                      <div>
                        <strong>Result:</strong> {result.details}
                      </div>
                    )}
                    {result.toolCalls !== undefined && (
                      <div>
                        <strong>Tool Calls:</strong> {result.toolCalls}
                      </div>
                    )}
                    {result.filesModified && result.filesModified.length > 0 && (
                      <div>
                        <strong>Files:</strong> {result.filesModified.join(', ')}
                      </div>
                    )}
                    {result.errors && result.errors.length > 0 && (
                      <div className="text-red-600">
                        <strong>Errors:</strong> {result.errors.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

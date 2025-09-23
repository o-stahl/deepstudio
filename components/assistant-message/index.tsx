'use client';

import React from 'react';
import { 
  FileCode,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  RotateCcw,
  DollarSign,
  Zap,
  IterationCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/markdown-renderer';
import { CostCalculator } from '@/lib/llm/cost-calculator';
import { useCostSettings } from '@/lib/hooks/use-cost-settings';

interface ToolCall {
  name: string;
  parameters?: any;
  result?: any;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
}

type ToolMessageItem = {
  id: string;
  type: 'message' | 'tool' | 'divider';
  content?: string;
  name?: string;
  parameters?: any;
  result?: any;
  status?: 'pending' | 'executing' | 'completed' | 'failed';
  title?: string;
  subtitle?: string;
};

interface AssistantMessageProps {
  content?: string;
  toolCalls?: ToolCall[];
  toolMessages?: ToolMessageItem[];
  checkpointId?: string;
  onRestore?: (checkpointId: string) => void;
  onRetry?: (checkpointId: string) => void;
  isSavedCheckpoint?: boolean;
  isExecuting?: boolean;
  className?: string;
  cost?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    provider?: string;
    model?: string;
  };
}

const toolIcons: Record<string, React.ReactNode> = {
  // Current tool surface
  shell: <ChevronRight className="h-3 w-3 text-blue-500" />,
  json_patch: <FileCode className="h-3 w-3 text-orange-500" />,
  evaluation: <CheckCircle className="h-3 w-3 text-orange-500" />,
  
  // Task completion (still used in some views)
  complete_task: <CheckCircle className="h-3 w-3 text-green-500" />,
};

const statusIcons: Record<string, React.ReactNode> = {
  pending: <Loader2 className="h-3 w-3 animate-spin text-gray-400" />,
  executing: <Loader2 className="h-3 w-3 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-3 w-3 text-green-500" />,
  failed: <XCircle className="h-3 w-3 text-red-500" />,
};

export function AssistantMessage({
  content,
  toolCalls = [],
  toolMessages,
  checkpointId,
  onRestore,
  onRetry,
  isSavedCheckpoint,
  isExecuting = false,
  className,
  cost,
  usage
}: AssistantMessageProps) {
  const [expandedTools, setExpandedTools] = React.useState<Set<string>>(new Set());
  const [showUsageDetails, setShowUsageDetails] = React.useState(false);
  const { shouldShowCosts } = useCostSettings();
  const hasContent = Boolean(content && content.trim() !== '');

  const toggleToolExpansion = (id: string) => {
    const newExpanded = new Set(expandedTools);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedTools(newExpanded);
  };

  const checkpointActions = checkpointId && (onRestore || onRetry) && !isExecuting ? (
    <div className="pt-2 flex flex-wrap items-center gap-2" data-tour-id="checkpoint-actions">
      <Badge
        variant={isSavedCheckpoint ? 'default' : 'outline'}
        className="h-6 px-2 text-xs"
      >
        {isSavedCheckpoint ? 'Saved version' : 'Checkpoint'}
      </Badge>
      {onRestore && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRestore(checkpointId)}
          className="h-7 text-xs"
          data-tour-id="checkpoint-restore-button"
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Restore
        </Button>
      )}
      {onRetry && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRetry(checkpointId)}
          className="h-7 text-xs"
          data-tour-id="checkpoint-retry-button"
        >
          <IterationCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      )}
    </div>
  ) : null;

  if (toolMessages && toolMessages.length > 0) {
    return (
      <div className={cn("space-y-2", className)}>
        {hasContent && (
          <div className="text-sm text-foreground/90">
            <MarkdownRenderer content={content ?? ''} />
          </div>
        )}
        {shouldShowCosts && (cost !== undefined || usage) && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {cost !== undefined && (
              <Badge 
                variant="secondary" 
                className="text-xs cursor-pointer"
                onClick={() => setShowUsageDetails(!showUsageDetails)}
              >
                <DollarSign className="h-3 w-3 mr-1" />
                {CostCalculator.formatCost(cost)}
              </Badge>
            )}
            
            {usage && (
              <>
                <Badge variant="outline" className="text-xs">
                  <Zap className="h-3 w-3 mr-1" />
                  {usage.totalTokens.toLocaleString()} tokens
                </Badge>
                
                {usage.provider && (
                  <Badge variant="outline" className="text-xs">
                    {usage.provider}
                    {usage.model && ` / ${usage.model.split('/').pop()}`}
                  </Badge>
                )}
              </>
            )}
            
            {showUsageDetails && usage && (
              <div className="w-full mt-2 p-2 bg-muted/30 rounded text-xs space-y-1">
                <div>Input: {usage.promptTokens.toLocaleString()} tokens</div>
                <div>Output: {usage.completionTokens.toLocaleString()} tokens</div>
                <div>Total: {usage.totalTokens.toLocaleString()} tokens</div>
                {cost !== undefined && (
                  <div className="font-medium">Cost: {CostCalculator.formatCost(cost)}</div>
                )}
              </div>
            )}
          </div>
        )}
        
        {toolMessages.map((item) => {
          if (item.type === 'message') {
            return (
              <div key={item.id} className="text-sm text-foreground/90 bg-muted/20 px-3 py-2 rounded">
                <MarkdownRenderer content={item.content || ''} />
              </div>
            );
          } else if (item.type === 'divider') {
            return (
              <div key={item.id} className="flex items-center gap-2 my-2">
                <div className="flex-1 h-px bg-border" />
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                  {item.title || 'Section'}
                </div>
                <div className="flex-1 h-px bg-border" />
              </div>
            );
          } else {
            const tool = item;
            return (
              <div
                key={tool.id}
                className={cn(
                  "bg-muted/30 rounded-md transition-all",
                  expandedTools.has(tool.id) ? "p-2" : "p-1.5"
                )}
              >
                <button
                  onClick={() => toggleToolExpansion(tool.id)}
                  className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-1"
                >
                  <div className="flex items-center gap-1.5">
                    {tool.name === 'evaluation' ? (
                      tool.parameters?.goal_achieved ? (
                        <CheckCircle className="h-3 w-3 text-green-500" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-500" />
                      )
                    ) : (
                      (tool.name && toolIcons[tool.name === '' ? (tool.parameters?.tool || tool.name) : tool.name]) || <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="text-xs font-mono">
                      {tool.name === 'shell' && tool.parameters?.cmd?.[0] 
                        ? tool.parameters.cmd[0] 
                        : tool.name === '' 
                          ? (tool.parameters?.tool || tool.name) 
                          : tool.name}
                    </span>
                  </div>
                  
                  {tool.name === 'shell' && tool.parameters?.cmd ? (
                    <code className="text-xs text-muted-foreground">
                      {(() => {
                        const cmd = tool.parameters.cmd;
                        if (Array.isArray(cmd)) {
                          const cmdStr = cmd.slice(1).join(' ');
                          return cmdStr.substring(0, 50) + (cmdStr.length > 50 ? '...' : '');
                        } else if (typeof cmd === 'string') {
                          return cmd.substring(0, 50) + (cmd.length > 50 ? '...' : '');
                        } else {
                          return JSON.stringify(cmd).substring(0, 50);
                        }
                      })()}
                    </code>
                  ) : (tool.parameters?.path || tool.parameters?.file_path) && (
                    <code className="text-xs text-muted-foreground">
                      {tool.parameters.path || tool.parameters.file_path}
                    </code>
                  )}
                  
                  <div className="ml-auto">
                    {statusIcons[tool.status || 'completed']}
                  </div>
                </button>
                
                {(tool.name === 'complete_task' && tool.parameters?.summary) && (
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs text-green-600 dark:text-green-400">
                      {tool.parameters.summary}
                    </span>
                  </div>
                )}
                
                {(tool.name === '' && tool.parameters?.description) && (
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {tool.parameters.description}
                    </span>
                  </div>
                )}
                
                {tool.name === 'evaluation' && tool.parameters && (
                  <div className="px-2 py-1 mt-1 space-y-2">
                    {/* Reasoning - prominently displayed first */}
                    <div className="text-xs text-muted-foreground">
                      {tool.parameters.reasoning}
                    </div>
                    
                    {/* Status indicators */}
                    <div className="flex items-center gap-3 text-xs">
                      <div className="flex items-center gap-1">
                        {tool.parameters.goal_achieved ? (
                          <CheckCircle className="h-3 w-3 text-green-500" />
                        ) : (
                          <XCircle className="h-3 w-3 text-red-500" />
                        )}
                        <span className={tool.parameters.goal_achieved ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                          {tool.parameters.goal_achieved ? "Goal achieved" : "Goal not achieved"}
                        </span>
                      </div>
                      
                      {!tool.parameters.should_continue && (
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <span>•</span>
                          <span>Stopping</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {tool.result?.error && (
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs text-red-500">
                      Error: {tool.result.error}
                    </span>
                  </div>
                )}
                
                {tool.name === 'shell' && tool.result?.success === false && tool.result?.stderr && (
                  <div className="px-2 py-1 mt-1">
                    <span className="text-xs text-red-500">
                      {tool.result.stderr}
                    </span>
                  </div>
                )}

                {expandedTools.has(tool.id) && (
                  <div className="mt-2 pl-5 space-y-1 text-xs">
                    {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Parameters:</span>
                        <pre className="mt-1 p-2 bg-muted/50 rounded overflow-x-auto">
                          {JSON.stringify(tool.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                    
                    {tool.result && (
                      <div>
                        <span className="text-muted-foreground">Result:</span>
                        <pre className="mt-1 p-2 bg-muted/50 rounded overflow-x-auto max-h-32">
                          {typeof tool.result === 'string' 
                            ? tool.result 
                            : JSON.stringify(tool.result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          }
        })}
        
        {checkpointActions}
      </div>
    );
  }
  
  return (
    <div className={cn("space-y-2", className)}>
      {hasContent && (
        <div className="text-sm text-foreground/90">
          <MarkdownRenderer content={content ?? ''} />
        </div>
      )}

      {shouldShowCosts && (cost !== undefined || usage) && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {cost !== undefined && (
            <Badge 
              variant="secondary" 
              className="text-xs cursor-pointer"
              onClick={() => setShowUsageDetails(!showUsageDetails)}
            >
              <DollarSign className="h-3 w-3 mr-1" />
              {CostCalculator.formatCost(cost)}
            </Badge>
          )}
          
          {usage && (
            <>
              <Badge variant="outline" className="text-xs">
                <Zap className="h-3 w-3 mr-1" />
                {usage.totalTokens.toLocaleString()} tokens
              </Badge>
              
              {usage.provider && (
                <Badge variant="outline" className="text-xs">
                  {usage.provider}
                  {usage.model && ` / ${usage.model.split('/').pop()}`}
                </Badge>
              )}
            </>
          )}
          
          {showUsageDetails && usage && (
            <div className="w-full mt-2 p-2 bg-muted/30 rounded text-xs space-y-1">
              <div>Input: {usage.promptTokens.toLocaleString()} tokens</div>
              <div>Output: {usage.completionTokens.toLocaleString()} tokens</div>
              <div>Total: {usage.totalTokens.toLocaleString()} tokens</div>
              {cost !== undefined && (
                <div className="font-medium">Cost: {CostCalculator.formatCost(cost)}</div>
              )}
            </div>
          )}
        </div>
      )}

      {toolCalls.length > 0 && (
        <div className="space-y-1">
          {toolCalls.map((tool, index) => (
            <div
              key={index}
              className={cn(
                "bg-muted/30 rounded-md transition-all",
                expandedTools.has(String(index)) ? "p-2" : "p-1.5"
              )}
            >
              <button
                onClick={() => toggleToolExpansion(String(index))}
                className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-1"
              >
                <div className="flex items-center gap-1.5">
                  {tool.name === 'evaluation' ? (
                    tool.parameters?.goal_achieved ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )
                  ) : (
                    (tool.name && toolIcons[tool.name === '' ? (tool.parameters?.tool || tool.name) : tool.name]) || <ChevronRight className="h-3 w-3" />
                  )}
                  <span className="text-xs font-mono">
                    {tool.name === 'shell' && tool.parameters?.cmd?.[0] 
                      ? tool.parameters.cmd[0] 
                      : tool.name === '' 
                        ? (tool.parameters?.tool || tool.name) 
                        : tool.name}
                  </span>
                </div>
                
                {tool.name === 'shell' && tool.parameters?.cmd ? (
                  <code className="text-xs text-muted-foreground">
                    {(() => {
                      const cmd = tool.parameters.cmd;
                      // Handle different cmd formats
                      if (Array.isArray(cmd)) {
                        const cmdStr = cmd.slice(1).join(' ');
                        return cmdStr.substring(0, 50) + (cmdStr.length > 50 ? '...' : '');
                      } else if (typeof cmd === 'string') {
                        return cmd.substring(0, 50) + (cmd.length > 50 ? '...' : '');
                      } else {
                        return JSON.stringify(cmd).substring(0, 50);
                      }
                    })()}
                  </code>
                ) : (tool.parameters?.path || tool.parameters?.file_path) && (
                  <code className="text-xs text-muted-foreground">
                    {tool.parameters.path || tool.parameters.file_path}
                  </code>
                )}
                
                <div className="ml-auto">
                  {statusIcons[tool.status || 'completed']}
                </div>
              </button>
              
              {(tool.name === 'complete_task' && tool.parameters?.summary) && (
                <div className="px-2 py-1 mt-1">
                  <span className="text-xs text-green-600 dark:text-green-400">
                    {tool.parameters.summary}
                  </span>
                </div>
              )}
              
              {(tool.name === '' && tool.parameters?.description) && (
                <div className="px-2 py-1 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {tool.parameters.description}
                  </span>
                </div>
              )}
              
              {tool.result?.error && (
                <div className="px-2 py-1 mt-1">
                  <span className="text-xs text-red-500">
                    Error: {tool.result.error}
                  </span>
                </div>
              )}
              
              {tool.name === 'shell' && tool.result?.success === false && tool.result?.stderr && (
                <div className="px-2 py-1 mt-1">
                  <span className="text-xs text-red-500">
                    {tool.result.stderr}
                  </span>
                </div>
              )}

              {expandedTools.has(String(index)) && (
                <div className="mt-2 pl-5 space-y-1 text-xs">
                  {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                    <div>
                      <span className="text-muted-foreground">Parameters:</span>
                      <pre className="mt-1 p-2 bg-muted/50 rounded overflow-x-auto">
                        {JSON.stringify(tool.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {tool.result && (
                    <div>
                      <span className="text-muted-foreground">Result:</span>
                      <pre className="mt-1 p-2 bg-muted/50 rounded overflow-x-auto max-h-32">
                        {typeof tool.result === 'string' 
                          ? tool.result 
                          : JSON.stringify(tool.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {checkpointActions}
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingUp, AlertTriangle, Calculator } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { configManager } from '@/lib/config/storage';
import { CostCalculator } from '@/lib/llm/cost-calculator';
import { cn } from '@/lib/utils';
import { useCostSettings } from '@/lib/hooks/use-cost-settings';

interface CostSummaryProps {
  projectId?: string;
  className?: string;
  compact?: boolean;
}

export function CostSummary({ projectId: _projectId, className, compact = false }: CostSummaryProps) {
  const [sessionCost, setSessionCost] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const hasEstimatedCosts = false;
  const [costWarning, setCostWarning] = useState<{ warning: boolean; exceeded: boolean; message?: string }>({ 
    warning: false, 
    exceeded: false 
  });
  
  const { shouldShowCosts } = useCostSettings();

  useEffect(() => {
    if (!shouldShowCosts) {
      return;
    }

    const session = configManager.getCurrentSession();
    if (session) {
      setSessionCost(session.totalCost);
      setMessageCount(session.messageCount);
    } else {
      configManager.startNewSession();
    }

    const limitCheck = configManager.checkCostLimits();
    setCostWarning(limitCheck);

    const interval = setInterval(() => {
      const currentSession = configManager.getCurrentSession();
      if (currentSession) {
        setSessionCost(currentSession.totalCost);
        setMessageCount(currentSession.messageCount);
      }
      
      const limitCheck = configManager.checkCostLimits();
      setCostWarning(limitCheck);
    }, 2000);

    return () => clearInterval(interval);
  }, [shouldShowCosts]);

  if (!shouldShowCosts) {
    return null;
  }

  if (compact) {
    return (
      <Badge 
        variant={costWarning.exceeded ? "destructive" : costWarning.warning ? "secondary" : "outline"}
        className={cn("text-xs cursor-pointer", className)}
        onClick={() => setShowDetails(!showDetails)}
      >
        <DollarSign className="h-3 w-3 mr-1" />
        {sessionCost.toFixed(2)}
        {costWarning.warning && <AlertTriangle className="h-3 w-3 ml-1" />}
      </Badge>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Badge 
        variant={costWarning.exceeded ? "destructive" : costWarning.warning ? "secondary" : "outline"}
        className="text-xs cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
      >
        <DollarSign className="h-3 w-3 mr-1" />
        Session: {CostCalculator.formatCost(sessionCost)}
      </Badge>

      {messageCount > 0 && (
        <Badge variant="outline" className="text-xs">
          <TrendingUp className="h-3 w-3 mr-1" />
          {messageCount} {messageCount === 1 ? 'message' : 'messages'}
        </Badge>
      )}

      {hasEstimatedCosts && (
        <Badge variant="outline" className="text-xs text-yellow-600 dark:text-yellow-400">
          <Calculator className="h-3 w-3 mr-1" />
          Estimated
        </Badge>
      )}

      {costWarning.warning && !costWarning.exceeded && (
        <Badge variant="secondary" className="text-xs">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {costWarning.message}
        </Badge>
      )}

      {costWarning.exceeded && (
        <Badge variant="destructive" className="text-xs">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {costWarning.message}
        </Badge>
      )}

      {/* Detailed breakdown on click */}
      {showDetails && (
        <div className="absolute top-full mt-2 right-0 z-50 w-80 p-4 bg-popover border rounded-lg shadow-lg">
          <h3 className="font-semibold text-sm mb-3">Session Cost Breakdown</h3>
          
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Cost:</span>
              <span className="font-medium">
                {CostCalculator.formatCost(sessionCost)}
                {hasEstimatedCosts && <span className="text-xs text-yellow-600 dark:text-yellow-400 ml-1">*</span>}
              </span>
            </div>
            
            <div className="flex justify-between">
              <span className="text-muted-foreground">Messages:</span>
              <span>{messageCount}</span>
            </div>
            
            {messageCount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg per message:</span>
                <span>{CostCalculator.formatCost(sessionCost / messageCount)}</span>
              </div>
            )}

            {/* Provider breakdown */}
            {(() => {
              const session = configManager.getCurrentSession();
              if (session?.providerBreakdown) {
                const providers = Object.entries(session.providerBreakdown);
                if (providers.length > 0) {
                  return (
                    <div className="pt-2 mt-2 border-t">
                      <div className="font-medium mb-1">By Provider:</div>
                      {providers.map(([provider, data]) => (
                        <div key={provider} className="flex justify-between ml-2">
                          <span className="text-muted-foreground capitalize">{provider}:</span>
                          <span>
                            {CostCalculator.formatCost(data.cost)} 
                            <span className="text-muted-foreground ml-1">({data.requestCount} calls)</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }
              }
              return null;
            })()}

            {/* Lifetime stats */}
            {(() => {
              const lifetime = configManager.getLifetimeCosts();
              if (lifetime.total > 0) {
                return (
                  <div className="pt-2 mt-2 border-t">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Lifetime Total:</span>
                      <span className="font-medium">{CostCalculator.formatCost(lifetime.total)}</span>
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {/* Cost accuracy note */}
            {hasEstimatedCosts && (
              <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                <div className="flex items-start gap-1">
                  <span className="text-yellow-600 dark:text-yellow-400">*</span>
                  <span>Some costs are estimated based on normalized token counts. Actual costs may be different and will be corrected automatically.</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                configManager.startNewSession();
                setSessionCost(0);
                setMessageCount(0);
                setShowDetails(false);
              }}
              className="text-xs"
            >
              New Session
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowDetails(false)}
              className="text-xs"
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

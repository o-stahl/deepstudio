/**
 * OpenRouter Generation API service for accurate cost tracking
 * Uses native token counts instead of normalized counts for billing
 */

import { logger } from '@/lib/utils';

export interface GenerationUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost?: number;
  // Native token counts (what you're actually billed for)
  native_tokens_prompt?: number;
  native_tokens_completion?: number;
  native_tokens_total?: number;
}

export interface GenerationResponse {
  id: string;
  model: string;
  usage?: GenerationUsage;
  total_cost?: number;
  created_at?: string;
  provider?: string;
}

/**
 * Service for querying OpenRouter Generation API for accurate cost data
 */
export class GenerationAPIService {
  private static readonly BASE_URL = 'https://openrouter.ai/api/v1';
  
  /**
   * Get generation statistics from OpenRouter including native token counts
   */
  static async getGenerationStats(
    generationId: string, 
    apiKey: string
  ): Promise<GenerationResponse | null> {
    if (!generationId || !apiKey) {
      return null;
    }

    try {
      const response = await fetch(`${this.BASE_URL}/generation?id=${generationId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        logger.warn(`[GenerationAPI] Failed to fetch generation stats: ${response.status}`);
        return null;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      logger.error('[GenerationAPI] Error fetching generation stats:', error);
      return null;
    }
  }

  /**
   * Queue generation ID for later cost resolution
   * This allows us to fetch costs after the streaming request completes
   */
  static queueGenerationForCostUpdate(
    generationId: string,
    apiKey: string,
    projectId: string,
    provider: string,
    model: string,
    onCostUpdate: (cost: number, usage: GenerationUsage) => void
  ): void {
    // Delay the cost lookup to ensure the generation is fully processed
    setTimeout(async () => {
      const stats = await this.getGenerationStats(generationId, apiKey);
      if (stats?.usage) {
        const actualCost = stats.total_cost ?? stats.usage.total_cost ?? 0;
        
        logger.debug(`[GenerationAPI] Generation ${generationId}`, {
          normalized_tokens: stats.usage.total_tokens,
          native_tokens: stats.usage.native_tokens_total,
          actual_cost: actualCost
        });
        
        onCostUpdate(actualCost, stats.usage);
      }
    }, 3000); // Wait 3 seconds for OpenRouter to process the generation
  }

  /**
   * Extract generation ID from response headers
   */
  static extractGenerationId(headers: Headers): string | null {
    return headers.get('x-openrouter-generation-id');
  }

  /**
   * Extract cost information from response headers (if available)
   */
  static extractCostFromHeaders(headers: Headers): { cost?: number; usage?: Partial<GenerationUsage> } | null {
    const usageHeader = headers.get('x-openrouter-usage');
    const costHeader = headers.get('x-openrouter-cost');
    
    let usage: Partial<GenerationUsage> | undefined;
    let cost: number | undefined;
    
    if (usageHeader) {
      try {
        usage = JSON.parse(usageHeader);
      } catch (error) {
        logger.warn('[GenerationAPI] Failed to parse usage header:', error);
      }
    }
    
    if (costHeader) {
      const parsedCost = parseFloat(costHeader);
      if (!isNaN(parsedCost)) {
        cost = parsedCost;
      }
    }
    
    if (usage || cost !== undefined) {
      return { usage, cost };
    }
    
    return null;
  }
}
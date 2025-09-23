export interface TestScenario {
  id: string;
  name: string;
  category: 'ui' | 'style' | 'javascript' | 'complex';
  prompt: string;
  setupFiles?: Record<string, string>; // Initial files for the test
  expectedElements?: string[]; // CSS selectors to check for
  expectedPatterns?: RegExp[]; // Patterns to find in generated code
  timeout?: number; // Custom timeout for this test
}

export interface ValidationResult {
  syntaxValid: boolean;
  syntaxErrors?: string[];
  domElementsPresent: boolean;
  missingElements?: string[];
  patternsFound: boolean;
  missingPatterns?: string[];
  functionalityWorks: boolean;
  functionalityErrors?: string[];
}

export interface TestResult {
  id: string;
  scenario: string;
  category: string;
  prompt: string;
  success: boolean;
  filesModified: string[];
  filesCreated: string[];
  errors: string[];
  executionTime: number;
  llmCalls: number;
  validationResults: ValidationResult;
  timestamp: string;
  provider?: string;
  model?: string;
  toolCalls?: any[];
  llmResponses?: string[];
  generatedContent?: Record<string, string>; // Final file contents
  llmEvaluation?: {
    success: boolean;
    score: number;
    reasoning: string;
    aspects: {
      functionalityImplemented: boolean;
      codeQuality: boolean;
      requirementsMet: boolean;
      userExperienceGood: boolean;
    };
  };
}

export interface TestSuiteResult {
  timestamp: string;
  provider: string;
  model: string;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    successRate: number;
    averageTime: number;
    byCategory: Record<string, { total: number; passed: number; failed: number }>;
    commonFailures: Array<{ type: string; count: number; examples: string[] }>;
  };
}

export interface TestConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  verbose?: boolean;
  saveResults?: boolean;
  resultsPath?: string;
  timeout?: number;
  parallel?: boolean;
}
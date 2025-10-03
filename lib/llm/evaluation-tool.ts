import { ToolDefinition } from './types';

export const EVALUATION_TOOL_DEF: ToolDefinition = {
  name: 'evaluation',
  description: 'Periodically assess task progress, track what remains, identify blockers. Use every 5-10 steps on complex tasks to stay goal-oriented.',
  parameters: {
    type: 'object',
    properties: {
      goal_achieved: {
        type: 'boolean',
        description: 'Whether the original task/goal has been fully achieved'
      },
      progress_summary: {
        type: 'string',
        description: 'Brief summary of work completed so far (e.g., "Created 3 components: Header, Hero, Features")'
      },
      remaining_work: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of specific tasks still needed to complete the goal (e.g., ["Add pricing section", "Create footer", "Fix navigation bug"]). Empty array if goal_achieved is true.'
      },
      blockers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Current blockers preventing progress (e.g., ["Navigation component has TypeScript errors"]). Empty array if no blockers.'
      },
      reasoning: {
        type: 'string',
        description: 'Detailed explanation of current status and next steps'
      },
      should_continue: {
        type: 'boolean',
        description: 'Whether to continue working (false if complete or permanently blocked)'
      }
    },
    required: ['goal_achieved', 'progress_summary', 'remaining_work', 'reasoning', 'should_continue']
  }
};
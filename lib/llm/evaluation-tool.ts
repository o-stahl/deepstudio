import { ToolDefinition } from './types';

export const EVALUATION_TOOL_DEF: ToolDefinition = {
  name: 'evaluation',
  description: 'Evaluate if the task has been completed successfully. Use this periodically to assess progress.',
  parameters: {
    type: 'object',
    properties: {
      goal_achieved: {
        type: 'boolean',
        description: 'Whether the original task/goal has been fully achieved'
      },
      reasoning: {
        type: 'string',
        description: 'Detailed explanation of what was accomplished and why the goal is/is not achieved'
      },
      should_continue: {
        type: 'boolean',
        description: 'Whether to continue working on the task (false if complete or stuck)'
      }
    },
    required: ['goal_achieved', 'reasoning', 'should_continue']
  }
};
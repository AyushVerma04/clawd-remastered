import { v4 as uuidv4 } from 'uuid';
import { AICommand, TaskPlan, TaskStep } from '../../shared/types';
import logger from '../../shared/logger';

/**
 * Task Planner Service
 * Breaks AI commands into ordered, executable task steps.
 */
export class TaskPlanner {
  /** Convert an AICommand into a TaskPlan. */
  createPlan(command: AICommand, originalMessage: string): TaskPlan {
    const steps = this.buildSteps(command);

    const plan: TaskPlan = {
      id: uuidv4(),
      originalMessage,
      steps,
      status: 'pending',
      createdAt: new Date(),
    };

    logger.info(
      `Created plan ${plan.id} with ${steps.length} step(s) for: "${originalMessage}"`
    );

    return plan;
  }

  /** Build an ordered list of TaskSteps from a command. */
  private buildSteps(command: AICommand): TaskStep[] {
    // Multi-step tasks
    if (command.action === 'multi_step' && Array.isArray(command.params.steps)) {
      const rawSteps = command.params.steps as unknown as AICommand[];
      return rawSteps.map((step, idx) => ({
        order: idx + 1,
        command: step,
        description: this.describeAction(step),
        status: 'pending' as const,
      }));
    }

    // Single-step task
    return [
      {
        order: 1,
        command,
        description: this.describeAction(command),
        status: 'pending' as const,
      },
    ];
  }

  /** Generate a human-readable description of an action. */
  private describeAction(command: AICommand): string {
    const p = command.params;

    switch (command.action) {
      case 'open_app':
        return `Open application: ${p.app}`;
      case 'open_file':
        return `Open file: ${p.path}`;
      case 'open_folder':
        return `Open folder: ${p.path}`;
      case 'open_browser':
        return `Open URL: ${p.url}${p.browser ? ` in ${p.browser}` : ''}`;
      case 'search_web':
        return `Search the web for: ${p.query}`;
      case 'run_command':
        return `Run command: ${p.command}`;
      case 'create_file':
      case 'write_file':
        return `Create/write file: ${p.path}`;
      case 'read_file':
        return `Read file: ${p.path}`;
      case 'delete_file':
        return `Delete file: ${p.path}`;
      case 'clone_repo':
        return `Clone repository: ${p.url}`;
      case 'generate_content':
        return `Generate content about: ${p.topic}`;
      default:
        return `Unknown action: ${command.action}`;
    }
  }

  /** Get a summary of a task plan for display. */
  summarizePlan(plan: TaskPlan): string {
    const lines = [`📋 Task Plan (${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''}):`];
    for (const step of plan.steps) {
      const icon =
        step.status === 'completed'
          ? '✅'
          : step.status === 'failed'
          ? '❌'
          : step.status === 'in_progress'
          ? '⏳'
          : '⬜';
      lines.push(`  ${icon} ${step.order}. ${step.description}`);
    }
    return lines.join('\n');
  }
}

export default new TaskPlanner();

/**
 * Subtask dispatch tools — stub until subtask module is implemented in core.
 */

export interface DispatchSubtaskArgs {
  target: string;
  task_type: string;
  prompt: string;
  thread_id?: string;
  repo_id?: string;
  branch?: string;
  timeout_minutes?: number;
}

export interface SubtaskStatusArgs {
  task_id: string;
}

const notImplemented = (name: string) => ({
  content: [{ type: 'text' as const, text: `${name} is not yet implemented. Subtask dispatch coming soon.` }],
});

export async function handleDispatchSubtask(_args: DispatchSubtaskArgs) {
  return notImplemented('cv_dispatch_subtask');
}

export async function handleSubtaskStatus(_args: SubtaskStatusArgs) {
  return notImplemented('cv_subtask_status');
}

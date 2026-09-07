export const TASK_SUBMITTED_EVENT = "mora:task-submitted";

/** Wake app-wide observers after a task has been accepted and persisted. */
export function notifyTaskSubmitted(): void {
  window.dispatchEvent(new Event(TASK_SUBMITTED_EVENT));
}

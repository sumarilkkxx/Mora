export interface TaskRow {
  kind: string;
  id: string;
  projectId?: string | null;
  projectName?: string;
  stage?: string;
  label?: string | null;
  provider?: string;
  taskId?: string;
  model?: string;
  mediaType?: string;
  status?: string;
  total?: number;
  done?: number;
  failed?: number;
  createdAt?: string | null;
  completedAt?: string | null;
}

export interface TaskFeed {
  active: TaskRow[];
  attention: TaskRow[];
  recent: TaskRow[];
}

export const EMPTY_TASK_FEED: TaskFeed = { active: [], attention: [], recent: [] };

export function taskHref(row: TaskRow): string {
  switch (row.kind) {
    case "auto_edit":
      return row.projectId ? `/project/${row.projectId}/auto-edit?run=${row.id}` : "/projects";
    case "batch":
      return "/batch";
    case "paid":
    case "paid_unknown":
      return row.projectId ? `/project/${row.projectId}/assets` : "/projects";
    case "pipeline":
    case "pipeline_interrupted":
      return row.projectId ? `/project/${row.projectId}/script` : "/projects";
    case "done":
      return row.projectId ? `/project/${row.projectId}/export` : "/projects";
    default:
      return row.projectId ? `/project/${row.projectId}/video` : "/projects";
  }
}

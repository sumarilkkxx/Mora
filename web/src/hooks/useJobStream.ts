import { useEffect, useRef, useState } from "react";
import type { Job, JobCounts, TaskState } from "../api/client";
import { jobWsUrl } from "../api/client";

interface StreamState {
  job: Job | null;
  connected: boolean;
}

// 订阅某个 Job 的 WebSocket 进度流，实时维护 Job 与任务列表状态。
export function useJobStream(jobId: string | null): StreamState {
  const [job, setJob] = useState<Job | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let closed = false;
    const ws = new WebSocket(jobWsUrl(jobId));
    wsRef.current = ws;

    ws.onopen = () => !closed && setConnected(true);
    ws.onclose = () => !closed && setConnected(false);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      switch (data.type) {
        case "snapshot":
        case "status":
        case "job_started":
        case "job_completed":
        case "job_failed":
          setJob(data.job as Job);
          break;
        case "task_update": {
          const task = data.task as TaskState;
          const counts = data.counts as JobCounts;
          setJob((prev) => {
            if (!prev) return prev;
            const tasks = prev.tasks.map((t) =>
              t.id === task.id ? task : t,
            );
            if (!tasks.some((t) => t.id === task.id)) tasks.push(task);
            return { ...prev, tasks, counts };
          });
          break;
        }
        case "__end__":
          ws.close();
          break;
        default:
          break;
      }
    };

    return () => {
      closed = true;
      ws.close();
      wsRef.current = null;
    };
  }, [jobId]);

  return { job, connected };
}

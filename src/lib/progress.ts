export interface JobStatus {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  step: string;
  stepNumber: number;
  totalSteps: number;
  videoUrl?: string;
  error?: string;
}

// In-memory store (works for single-instance deployment)
const jobs = new Map<string, JobStatus>();

export function createJob(id: string): JobStatus {
  const job: JobStatus = {
    id,
    status: "pending",
    step: "Queued",
    stepNumber: 0,
    totalSteps: 10,
  };
  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, update: Partial<JobStatus>): void {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, update);
  }
}

export function getJob(id: string): JobStatus | undefined {
  return jobs.get(id);
}

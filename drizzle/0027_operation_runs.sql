CREATE TABLE IF NOT EXISTS operation_runs (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  subject_id text NOT NULL,
  request_key text NOT NULL,
  status text DEFAULT 'queued' NOT NULL,
  stage text DEFAULT 'queued' NOT NULL,
  attempt integer DEFAULT 0 NOT NULL,
  owner text,
  lease_until integer,
  checkpoint text,
  result text,
  error text,
  created_at integer,
  updated_at integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS operation_runs_request_key_unique ON operation_runs (request_key);

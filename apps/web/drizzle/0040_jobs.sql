CREATE TABLE "api_request_stats_daily" (
	"day" date NOT NULL,
	"service" varchar(32) NOT NULL,
	"endpoint" varchar(64) NOT NULL,
	"status" varchar(32) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"total_duration_ms" bigint DEFAULT 0 NOT NULL,
	"max_duration_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_api_request_stats_daily" PRIMARY KEY("day","service","endpoint","status")
);
--> statement-breakpoint
CREATE TABLE "job_stats_daily" (
	"day" date NOT NULL,
	"queue" varchar(64) NOT NULL,
	"enqueued" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"retried" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"discarded" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"reclaimed" integer DEFAULT 0 NOT NULL,
	"total_duration_ms" bigint DEFAULT 0 NOT NULL,
	"max_duration_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pk_job_stats_daily" PRIMARY KEY("day","queue")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"queue" varchar(64) NOT NULL,
	"dedup_key" varchar(128),
	"payload" jsonb NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"rerun_requested" boolean DEFAULT false NOT NULL,
	"run_after" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"locked_by" varchar(128),
	"locked_until" timestamp with time zone,
	"last_error" text,
	"trace_context" jsonb,
	"correlation_id" varchar(128) DEFAULT gen_random_uuid()::text NOT NULL,
	"tournament_id" integer,
	"requested_by_user_id" integer,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated" timestamp with time zone,
	"started" timestamp with time zone,
	"finished" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "ix_jobs_claim" ON "jobs" USING btree ("queue" text_ops,"priority" int4_ops DESC,"run_after" timestamptz_ops,"id" int8_ops) WHERE status = 0;--> statement-breakpoint
CREATE UNIQUE INDEX "ix_jobs_queue_dedup_key_active" ON "jobs" USING btree ("queue" text_ops,"dedup_key" text_ops) WHERE status IN (0, 1) AND dedup_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ix_jobs_running" ON "jobs" USING btree ("id" int8_ops) WHERE status = 1;--> statement-breakpoint
CREATE INDEX "ix_jobs_status_finished" ON "jobs" USING btree ("status" int4_ops,"finished" timestamptz_ops) WHERE status IN (2, 3, 4);--> statement-breakpoint
CREATE INDEX "ix_jobs_tournament_id" ON "jobs" USING btree ("tournament_id" int4_ops) WHERE tournament_id IS NOT NULL;--> statement-breakpoint
-- Wakes the data worker when a job becomes ready to claim. Notifications are
-- sent at commit and identical ones in a transaction merge, so a bulk insert
-- sends one per queue.
CREATE FUNCTION public.jobs_notify_ready()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('otr_jobs', NEW.queue);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_jobs_notify_ready
AFTER INSERT OR UPDATE OF status, run_after ON public.jobs
FOR EACH ROW
WHEN (NEW.status = 0 AND NEW.run_after <= now())
EXECUTE FUNCTION public.jobs_notify_ready();
--> statement-breakpoint
-- Every job is inserted, updated a few times and later deleted.
ALTER TABLE public.jobs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.05
);

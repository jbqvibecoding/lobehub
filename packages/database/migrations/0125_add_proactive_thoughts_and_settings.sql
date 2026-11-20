CREATE TABLE IF NOT EXISTS "proactive_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"level" text DEFAULT 'standard' NOT NULL,
	"quiet_start" integer DEFAULT 22 NOT NULL,
	"quiet_end" integer DEFAULT 8 NOT NULL,
	"time_zone" text,
	"cooldown_until" timestamp with time zone,
	"budget_date" text,
	"spent_today" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"topic_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proactive_thoughts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"seed" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text NOT NULL,
	"occurs_at" timestamp with time zone,
	"urgency" text DEFAULT 'window' NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"surfaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proactive_settings" DROP CONSTRAINT IF EXISTS "proactive_settings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_settings" ADD CONSTRAINT "proactive_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_thoughts" DROP CONSTRAINT IF EXISTS "proactive_thoughts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_thoughts" ADD CONSTRAINT "proactive_thoughts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proactive_thoughts_user_source_ref_unique" ON "proactive_thoughts" USING btree ("user_id","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_thoughts_status_idx" ON "proactive_thoughts" USING btree ("status");
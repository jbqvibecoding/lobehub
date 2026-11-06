CREATE TABLE IF NOT EXISTS "agent_action_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"event_type" text NOT NULL,
	"identifier" text NOT NULL,
	"api_name" text NOT NULL,
	"tool_class" text NOT NULL,
	"tool_call_id" text,
	"operation_id" text,
	"agent_id" text,
	"topic_id" text,
	"call_digest" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_action_audits" DROP CONSTRAINT IF EXISTS "agent_action_audits_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_action_audits" ADD CONSTRAINT "agent_action_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_action_audits_user_id_created_at_idx" ON "agent_action_audits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_action_audits_tool_call_id_idx" ON "agent_action_audits" USING btree ("tool_call_id");

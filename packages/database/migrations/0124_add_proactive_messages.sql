CREATE TABLE IF NOT EXISTS "proactive_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"kind" text NOT NULL,
	"routine_id" text,
	"thought_id" uuid,
	"task_id" text,
	"brief_id" text,
	"topic_id" text,
	"message_id" text,
	"notification_id" text,
	"title" text,
	"state" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"replied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "proactive_messages" DROP CONSTRAINT IF EXISTS "proactive_messages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_messages" ADD CONSTRAINT "proactive_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_messages_user_sent_idx" ON "proactive_messages" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_messages_state_sent_idx" ON "proactive_messages" USING btree ("state","sent_at");

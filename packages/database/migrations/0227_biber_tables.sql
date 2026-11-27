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
CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"out_trade_no" text NOT NULL,
	"plan" text NOT NULL,
	"billing_interval" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'CNY' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_transaction_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_credit_usages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"used_credits" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text NOT NULL,
	"provider_subscription_id" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"billing_interval" text,
	"status" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "personal_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"due_at" timestamp with time zone,
	"urgency" text DEFAULT 'window' NOT NULL,
	"weight" real DEFAULT 0.5 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"surfaced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_logins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"origin" text NOT NULL,
	"account_hint" text NOT NULL,
	"credentials" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memory_extraction_changes" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"extraction_id" varchar(255) NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"memory_id" varchar(255) NOT NULL,
	"live_memory_id" varchar(255),
	"before" jsonb NOT NULL,
	"after_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_memory_extractions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic_id" text,
	"added_memory_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interview" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'expo' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_action_audits" DROP CONSTRAINT IF EXISTS "agent_action_audits_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "agent_action_audits" ADD CONSTRAINT "agent_action_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" DROP CONSTRAINT IF EXISTS "payment_orders_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credit_usages" DROP CONSTRAINT IF EXISTS "user_credit_usages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_credit_usages" ADD CONSTRAINT "user_credit_usages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "user_subscriptions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_accounts" DROP CONSTRAINT IF EXISTS "personal_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_messages" DROP CONSTRAINT IF EXISTS "proactive_messages_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_messages" ADD CONSTRAINT "proactive_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_settings" DROP CONSTRAINT IF EXISTS "proactive_settings_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_settings" ADD CONSTRAINT "proactive_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proactive_thoughts" DROP CONSTRAINT IF EXISTS "proactive_thoughts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "proactive_thoughts" ADD CONSTRAINT "proactive_thoughts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_logins" DROP CONSTRAINT IF EXISTS "saved_logins_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "saved_logins" ADD CONSTRAINT "saved_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" DROP CONSTRAINT IF EXISTS "user_memory_extraction_changes_extraction_id_user_memory_extractions_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" ADD CONSTRAINT "user_memory_extraction_changes_extraction_id_user_memory_extractions_id_fk" FOREIGN KEY ("extraction_id") REFERENCES "public"."user_memory_extractions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" DROP CONSTRAINT IF EXISTS "user_memory_extraction_changes_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" ADD CONSTRAINT "user_memory_extraction_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" DROP CONSTRAINT IF EXISTS "user_memory_extraction_changes_live_memory_id_user_memories_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_extraction_changes" ADD CONSTRAINT "user_memory_extraction_changes_live_memory_id_user_memories_id_fk" FOREIGN KEY ("live_memory_id") REFERENCES "public"."user_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_extractions" DROP CONSTRAINT IF EXISTS "user_memory_extractions_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_extractions" ADD CONSTRAINT "user_memory_extractions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_extractions" DROP CONSTRAINT IF EXISTS "user_memory_extractions_topic_id_topics_id_fk";--> statement-breakpoint
ALTER TABLE "user_memory_extractions" ADD CONSTRAINT "user_memory_extractions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_action_audits_user_id_created_at_idx" ON "agent_action_audits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_action_audits_tool_call_id_idx" ON "agent_action_audits" USING btree ("tool_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_out_trade_no_unique" ON "payment_orders" USING btree ("out_trade_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_user_id_idx" ON "payment_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_credit_usages_user_id_period_start_unique" ON "user_credit_usages" USING btree ("user_id","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_user_id_provider_unique" ON "user_subscriptions" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_provider_customer_id_unique" ON "user_subscriptions" USING btree ("provider","provider_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_accounts_user_kind_unique" ON "personal_accounts" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_messages_user_sent_idx" ON "proactive_messages" USING btree ("user_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_messages_state_sent_idx" ON "proactive_messages" USING btree ("state","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proactive_thoughts_user_source_ref_unique" ON "proactive_thoughts" USING btree ("user_id","source_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_thoughts_status_idx" ON "proactive_thoughts" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_thoughts_status_due_idx" ON "proactive_thoughts" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_logins_user_id_idx" ON "saved_logins" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memory_extraction_changes_extraction_id_index" ON "user_memory_extraction_changes" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memory_extraction_changes_live_memory_id_index" ON "user_memory_extraction_changes" USING btree ("live_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memory_extractions_user_id_created_at_index" ON "user_memory_extractions" USING btree ("user_id","created_at");
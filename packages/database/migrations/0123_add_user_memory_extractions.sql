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
CREATE INDEX IF NOT EXISTS "user_memory_extraction_changes_extraction_id_index" ON "user_memory_extraction_changes" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memory_extraction_changes_live_memory_id_index" ON "user_memory_extraction_changes" USING btree ("live_memory_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_memory_extractions_user_id_created_at_index" ON "user_memory_extractions" USING btree ("user_id","created_at");

ALTER TABLE "proactive_thoughts" ADD COLUMN IF NOT EXISTS "due_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proactive_thoughts_status_due_idx" ON "proactive_thoughts" USING btree ("status","due_at");

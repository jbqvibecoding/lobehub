ALTER TABLE "push_tokens" ADD COLUMN IF NOT EXISTS "provider" text DEFAULT 'expo' NOT NULL;

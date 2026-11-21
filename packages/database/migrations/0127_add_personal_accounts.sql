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
ALTER TABLE "personal_accounts" DROP CONSTRAINT IF EXISTS "personal_accounts_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_accounts_user_kind_unique" ON "personal_accounts" USING btree ("user_id","kind");

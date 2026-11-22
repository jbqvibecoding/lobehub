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
ALTER TABLE "saved_logins" DROP CONSTRAINT IF EXISTS "saved_logins_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "saved_logins" ADD CONSTRAINT "saved_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_logins_user_id_idx" ON "saved_logins" USING btree ("user_id");

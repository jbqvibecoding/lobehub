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
ALTER TABLE "payment_orders" DROP CONSTRAINT IF EXISTS "payment_orders_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_out_trade_no_unique" ON "payment_orders" USING btree ("out_trade_no");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_user_id_idx" ON "payment_orders" USING btree ("user_id");

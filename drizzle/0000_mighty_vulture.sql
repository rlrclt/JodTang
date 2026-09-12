CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_id_account_id_key" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'cash' NOT NULL,
	"currency" char(3) DEFAULT 'THB' NOT NULL,
	"initial_balance" bigint DEFAULT 0 NOT NULL,
	"icon" text,
	"color" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "accounts_name_check" CHECK (btrim("accounts"."name") <> ''),
	CONSTRAINT "accounts_kind_check" CHECK ("accounts"."kind" in ('cash', 'bank', 'credit', 'ewallet', 'other')),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" = 'THB'),
	CONSTRAINT "accounts_initial_balance_check" CHECK ("accounts"."initial_balance" > -1000000000000000 and "accounts"."initial_balance" < 1000000000000000)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"period_month" date NOT NULL,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'THB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_id_category_id_period_month_key" UNIQUE("user_id","category_id","period_month"),
	CONSTRAINT "budgets_amount_check" CHECK ("budgets"."amount" > 0 and "budgets"."amount" < 1000000000000000),
	CONSTRAINT "budgets_currency_check" CHECK ("budgets"."currency" = 'THB'),
	CONSTRAINT "budgets_period_month_ck" CHECK ("budgets"."period_month" = date_trunc('month', "budgets"."period_month")::date)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_user_id_key" UNIQUE("id","user_id"),
	CONSTRAINT "categories_id_kind_user_id_key" UNIQUE("id","kind","user_id"),
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" in ('income', 'expense')),
	CONSTRAINT "categories_name_check" CHECK (btrim("categories"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"currency" char(3) DEFAULT 'THB' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurred_month_bkk" date GENERATED ALWAYS AS ((date_trunc('month', occurred_at at time zone interval '7 hours'))::date) STORED,
	"note" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" in ('income', 'expense', 'transfer')),
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount" > 0 and "transactions"."amount" < 1000000000000000),
	CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" = 'THB'),
	CONSTRAINT "transactions_shape_ck" CHECK (case when "transactions"."kind" = 'transfer'
            then "transactions"."to_account_id" is not null and "transactions"."to_account_id" <> "transactions"."account_id" and "transactions"."category_id" is null
            else "transactions"."to_account_id" is null and "transactions"."category_id" is not null
          end)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_key" UNIQUE("email"),
	CONSTRAINT "user_email_check" CHECK ("user"."email" is null or "user"."email" = lower(btrim("user"."email")))
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_user_id_fkey" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_user_id_fkey" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_user_id_fkey" FOREIGN KEY ("to_account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_kind_user_id_fkey" FOREIGN KEY ("category_id","kind","user_id") REFERENCES "public"."categories"("id","kind","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_uidx" ON "accounts" USING btree ("user_id",lower(btrim("name"))) WHERE archived_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_kind_name_uidx" ON "categories" USING btree ("user_id","kind",lower(btrim("name"))) WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_recent_idx" ON "transactions" USING btree ("user_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "transactions_user_month_idx" ON "transactions" USING btree ("user_id","occurred_month_bkk") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "transactions_user_kind_time_idx" ON "transactions" USING btree ("user_id","kind","occurred_at") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "transactions_user_category_time_idx" ON "transactions" USING btree ("user_id","category_id","occurred_at") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "transactions_account_idx" ON "transactions" USING btree ("account_id","user_id");--> statement-breakpoint
CREATE INDEX "transactions_to_account_idx" ON "transactions" USING btree ("to_account_id","user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- เติมมือ (drizzle-orm 0.45.2 ไม่มี index().include() — ดู docs/drizzle-mapping.md ข้อ 2)
-- 3 index นี้ทำให้หน้าสรุป/ยอดเดือนเป็น index-only scan (Heap Fetches 0) ห้ามให้ INCLUDE หาย
-- ---------------------------------------------------------------------------
drop index if exists "transactions_user_month_idx";--> statement-breakpoint
create index "transactions_user_month_idx" on "transactions" ("user_id", "occurred_month_bkk")
  include ("amount", "kind") where "deleted_at" is null;--> statement-breakpoint
drop index if exists "transactions_user_kind_time_idx";--> statement-breakpoint
create index "transactions_user_kind_time_idx" on "transactions" ("user_id", "kind", "occurred_at")
  include ("amount") where "deleted_at" is null;--> statement-breakpoint
drop index if exists "transactions_user_category_time_idx";--> statement-breakpoint
create index "transactions_user_category_time_idx" on "transactions" ("user_id", "category_id", "occurred_at")
  include ("amount") where "deleted_at" is null;
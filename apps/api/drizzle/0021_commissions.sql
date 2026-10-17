CREATE TABLE "commission_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"base" text DEFAULT 'net' NOT NULL,
	"criterion" text DEFAULT 'sold' NOT NULL,
	"finance_integration" boolean DEFAULT true NOT NULL,
	"staff_can_see_own" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"base" text NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	CONSTRAINT "commission_statement_lines_amount_ck" CHECK ("commission_statement_lines"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "commission_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"cutoff" date NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"due_date" date,
	"paid_on" date,
	"notes" text DEFAULT '' NOT NULL,
	"review_reason" text,
	"created_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_ck" CHECK (("commission_statements"."status" in ('open', 'review') or ("commission_statements"."closed_at" is not null and "commission_statements"."due_date" is not null and "commission_statements"."total" > 0))
        and (("commission_statements"."status" in ('paid', 'archived')) = ("commission_statements"."paid_on" is not null)))
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "commission_statement_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "commission_since" date;--> statement-breakpoint
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_statement_lines_sale_uq" ON "commission_statement_lines" USING btree ("statement_id","sale_id");--> statement-breakpoint
CREATE INDEX "commission_statement_lines_sale_idx" ON "commission_statement_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_statements_org_code_uq" ON "commission_statements" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "commission_statements_open_uq" ON "commission_statements" USING btree ("unit_id","user_id") WHERE "commission_statements"."status" in ('open', 'review');--> statement-breakpoint
CREATE INDEX "commission_statements_unit_status_idx" ON "commission_statements" USING btree ("unit_id","status");--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_commission_statement_id_commission_statements_id_fk" FOREIGN KEY ("commission_statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_entries_commission_idx" ON "financial_entries" USING btree ("commission_statement_id");--> statement-breakpoint
-- A categoria Comissões do plano inicial passa a ser a usada pelos extratos.
UPDATE "financial_categories" SET "system_key" = 'commissions'
WHERE "system_key" IS NULL AND "kind" = 'expense' AND "parent_id" IS NULL AND lower("name") = 'comissões'
  AND NOT EXISTS (SELECT 1 FROM "financial_categories" c2 WHERE c2."organization_id" = "financial_categories"."organization_id" AND c2."system_key" = 'commissions');

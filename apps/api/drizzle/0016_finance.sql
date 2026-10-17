CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" uuid,
	"system_key" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"direction" text NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"description" text NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"supplier_id" uuid,
	"client_id" uuid,
	"cost_center_id" uuid,
	"sale_id" uuid,
	"sale_receivable_id" uuid,
	"transfer_id" uuid,
	"group_id" uuid,
	"installment_number" smallint,
	"installment_total" smallint,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2),
	"due_date" date NOT NULL,
	"competence_date" date NOT NULL,
	"paid_on" date,
	"paid_by" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"cancel_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_entries_values_ck" CHECK ("financial_entries"."amount" > 0 and ("financial_entries"."paid_amount" is null or "financial_entries"."paid_amount" > 0)),
	CONSTRAINT "financial_entries_paid_ck" CHECK (("financial_entries"."status" <> 'paid' or ("financial_entries"."paid_on" is not null and "financial_entries"."paid_amount" is not null))
        and ("financial_entries"."status" <> 'open' or ("financial_entries"."paid_on" is null and "financial_entries"."paid_amount" is null))),
	CONSTRAINT "financial_entries_kind_ck" CHECK (("financial_entries"."kind" = 'transfer') = ("financial_entries"."transfer_id" is not null)
        and ("financial_entries"."kind" = 'transfer' or "financial_entries"."category_id" is not null)
        and ("financial_entries"."kind" <> 'income' or "financial_entries"."direction" = 'in')
        and ("financial_entries"."kind" <> 'expense' or "financial_entries"."direction" = 'out')),
	CONSTRAINT "financial_entries_installment_ck" CHECK (("financial_entries"."installment_number" is null) = ("financial_entries"."installment_total" is null)
        and ("financial_entries"."installment_number" is null or "financial_entries"."installment_number" between 1 and "financial_entries"."installment_total"))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_parent_id_financial_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_sale_receivable_id_sale_receivables_id_fk" FOREIGN KEY ("sale_receivable_id") REFERENCES "public"."sale_receivables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financial_accounts_org_name_uq" ON "financial_accounts" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "financial_categories_org_name_uq" ON "financial_categories" USING btree ("organization_id","kind",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "financial_categories_org_system_uq" ON "financial_categories" USING btree ("organization_id","system_key") WHERE "financial_categories"."system_key" is not null;--> statement-breakpoint
CREATE INDEX "financial_categories_parent_idx" ON "financial_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "financial_entries_org_date_idx" ON "financial_entries" USING btree ("organization_id",coalesce("paid_on", "due_date"));--> statement-breakpoint
CREATE INDEX "financial_entries_account_idx" ON "financial_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "financial_entries_open_idx" ON "financial_entries" USING btree ("organization_id","due_date") WHERE "financial_entries"."status" = 'open';--> statement-breakpoint
CREATE INDEX "financial_entries_sale_idx" ON "financial_entries" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "financial_entries_group_idx" ON "financial_entries" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "financial_entries_transfer_idx" ON "financial_entries" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_entries_receivable_uq" ON "financial_entries" USING btree ("sale_receivable_id","origin") WHERE "financial_entries"."sale_receivable_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_name_uq" ON "suppliers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_org_document_uq" ON "suppliers" USING btree ("organization_id","document") WHERE "suppliers"."document" <> '';
CREATE TABLE "insurer_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"insurer_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"financial_entry_id" uuid,
	"service_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"gloss_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"gloss_reason" text,
	"glossed_at" timestamp with time zone,
	"glossed_by" uuid,
	"status" text NOT NULL,
	"reconciled_on" date,
	"reconciled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurer_claims_values_ck" CHECK ("insurer_claims"."amount" > 0 and "insurer_claims"."gloss_amount" >= 0 and "insurer_claims"."gloss_amount" <= "insurer_claims"."amount"
        and ("insurer_claims"."status" = 'glossed') = ("insurer_claims"."gloss_amount" = "insurer_claims"."amount")
        and ("insurer_claims"."gloss_amount" = 0) = ("insurer_claims"."gloss_reason" is null)
        and ("insurer_claims"."status" = 'reconciled') = ("insurer_claims"."reconciled_on" is not null))
);
--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "insurer_copay_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "insurer_amount" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "requires_authorization" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "authorization_code" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "insurer_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "insurance_card_number" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "insurer_total" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_financial_entry_id_financial_entries_id_fk" FOREIGN KEY ("financial_entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_glossed_by_users_id_fk" FOREIGN KEY ("glossed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_claims" ADD CONSTRAINT "insurer_claims_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_claims_item_uq" ON "insurer_claims" USING btree ("sale_item_id");--> statement-breakpoint
CREATE INDEX "insurer_claims_org_date_idx" ON "insurer_claims" USING btree ("organization_id","service_date");--> statement-breakpoint
CREATE INDEX "insurer_claims_sale_idx" ON "insurer_claims" USING btree ("sale_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_insurer_ck" CHECK ("sale_items"."insurer_amount" >= 0 and "sale_items"."insurer_amount" <= "sale_items"."net_total"
        and ("sale_items"."insurer_copay_percent" is not null or ("sale_items"."insurer_amount" = 0 and not "sale_items"."requires_authorization")));--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_insurer_ck" CHECK (("sales"."insurer_id" is null) = ("sales"."insurance_card_number" is null)
        and "sales"."insurer_total" >= 0 and "sales"."insurer_total" <= "sales"."net_total"
        and ("sales"."insurer_id" is not null or "sales"."insurer_total" = 0));
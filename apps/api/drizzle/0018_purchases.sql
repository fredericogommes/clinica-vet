CREATE TABLE "purchase_installments" (
	"purchase_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "purchase_installments_purchase_id_number_pk" PRIMARY KEY("purchase_id","number"),
	CONSTRAINT "purchase_installments_ck" CHECK ("purchase_installments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"supplier_code" text DEFAULT '' NOT NULL,
	"ean" text DEFAULT '' NOT NULL,
	"supplier_unit" text DEFAULT '' NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"factor" numeric(14, 3) DEFAULT 1 NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"lot_code" text,
	"expires_on" date,
	CONSTRAINT "purchase_items_values_ck" CHECK ("purchase_items"."quantity" > 0 and "purchase_items"."factor" > 0 and "purchase_items"."total" >= 0
        and ("purchase_items"."lot_code" is null) = ("purchase_items"."expires_on" is null))
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"invoice_series" text DEFAULT '' NOT NULL,
	"invoice_key" text DEFAULT '' NOT NULL,
	"issued_on" date,
	"entered_on" date NOT NULL,
	"freight" numeric(14, 2) DEFAULT 0 NOT NULL,
	"other_costs" numeric(14, 2) DEFAULT 0 NOT NULL,
	"discount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"items_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_values_ck" CHECK ("purchases"."freight" >= 0 and "purchases"."other_costs" >= 0 and "purchases"."discount" >= 0
        and "purchases"."items_total" >= 0 and "purchases"."total" >= 0
        and "purchases"."total" = "purchases"."items_total" + "purchases"."freight" + "purchases"."other_costs" - "purchases"."discount"),
	CONSTRAINT "purchases_status_ck" CHECK (("purchases"."status" <> 'confirmed' or "purchases"."confirmed_at" is not null)
        and ("purchases"."status" <> 'cancelled' or ("purchases"."cancelled_at" is not null and "purchases"."cancel_reason" is not null)))
);
--> statement-breakpoint
CREATE TABLE "supplier_products" (
	"organization_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_code" text NOT NULL,
	"product_id" uuid NOT NULL,
	"factor" numeric(14, 3) DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_products_supplier_id_supplier_code_pk" PRIMARY KEY("supplier_id","supplier_code")
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_ck";--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "purchase_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_installments" ADD CONSTRAINT "purchase_installments_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_category_id_financial_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."financial_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_items_position_uq" ON "purchase_items" USING btree ("purchase_id","position");--> statement-breakpoint
CREATE INDEX "purchase_items_product_idx" ON "purchase_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_org_code_uq" ON "purchases" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_org_key_uq" ON "purchases" USING btree ("organization_id","invoice_key") WHERE "purchases"."invoice_key" <> '' and "purchases"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "purchases_org_date_idx" ON "purchases" USING btree ("organization_id","entered_on");--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_entries_purchase_idx" ON "financial_entries" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "stock_movements_purchase_idx" ON "stock_movements" USING btree ("purchase_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ck" CHECK ("stock_movements"."on_hand_after" >= 0 and "stock_movements"."shortfall" >= 0 and "stock_movements"."shortfall_after" >= 0
        and ("stock_movements"."kind" not in ('sale', 'sale_return') or "stock_movements"."sale_id" is not null)
        and ("stock_movements"."kind" not in ('purchase', 'purchase_cancel') or "stock_movements"."purchase_id" is not null)
        and ("stock_movements"."kind" not in ('sale', 'purchase_cancel') or "stock_movements"."quantity" < 0)
        and ("stock_movements"."kind" not in ('entry', 'sale_return', 'purchase') or "stock_movements"."quantity" > 0));
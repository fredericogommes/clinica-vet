CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"service_kind" text,
	"unit" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"list_price" numeric(14, 2) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"gross_total" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"commission_percent" numeric(5, 2) NOT NULL,
	CONSTRAINT "sale_items_values_ck" CHECK ("sale_items"."quantity" > 0 and "sale_items"."unit_price" >= 0 and "sale_items"."list_price" >= 0
        and "sale_items"."discount_amount" >= 0 and "sale_items"."discount_amount" <= "sale_items"."gross_total"
        and "sale_items"."net_total" = "sale_items"."gross_total" - "sale_items"."discount_amount"
        and "sale_items"."commission_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"code" integer NOT NULL,
	"status" text NOT NULL,
	"sale_type" text NOT NULL,
	"client_id" uuid,
	"patient_id" uuid,
	"discount_mode" text NOT NULL,
	"discount_value" numeric(14, 2) DEFAULT 0 NOT NULL,
	"gross_total" numeric(14, 2) NOT NULL,
	"discount_total" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_patient_client_ck" CHECK ("sales"."patient_id" is null or "sales"."client_id" is not null),
	CONSTRAINT "sales_totals_ck" CHECK ("sales"."gross_total" >= 0 and "sales"."discount_total" >= 0 and "sales"."discount_total" <= "sales"."gross_total"
        and "sales"."net_total" = "sales"."gross_total" - "sales"."discount_total" and "sales"."discount_value" >= 0),
	CONSTRAINT "sales_cancel_ck" CHECK (("sales"."status" = 'cancelled') = ("sales"."cancelled_at" is not null and "sales"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"discount_limit_percent" numeric(5, 2) DEFAULT 10 NOT NULL,
	"default_sale_type" text DEFAULT 'in_person_consumer' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_settings_discount_ck" CHECK ("sales_settings"."discount_limit_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discount_limit_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_items_sale_position_uq" ON "sale_items" USING btree ("sale_id","position");--> statement-breakpoint
CREATE INDEX "sale_items_product_idx" ON "sale_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sale_items_professional_idx" ON "sale_items" USING btree ("professional_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_org_code_uq" ON "sales" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "sales_org_created_idx" ON "sales" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_patient_idx" ON "sales" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "sales_client_idx" ON "sales" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_discount_limit_ck" CHECK ("users"."discount_limit_percent" is null or "users"."discount_limit_percent" between 0 and 100);
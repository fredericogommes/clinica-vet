CREATE TABLE "client_packages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"patient_id" uuid,
	"product_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sessions" smallint NOT NULL,
	"valid_until" date,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_packages_sessions_ck" CHECK ("client_packages"."sessions" between 2 and 100)
);
--> statement-breakpoint
CREATE TABLE "package_usages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_package_id" uuid NOT NULL,
	"used_on" date NOT NULL,
	"patient_id" uuid,
	"professional_id" uuid NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"undo_reason" text,
	CONSTRAINT "package_usages_undo_ck" CHECK (("package_usages"."undone_at" is null) = ("package_usages"."undone_by" is null) and ("package_usages"."undone_at" is null) = ("package_usages"."undo_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "package_service_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "package_sessions" smallint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "package_validity_days" smallint;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_packages" ADD CONSTRAINT "client_packages_service_id_products_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usages" ADD CONSTRAINT "package_usages_client_package_id_client_packages_id_fk" FOREIGN KEY ("client_package_id") REFERENCES "public"."client_packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usages" ADD CONSTRAINT "package_usages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usages" ADD CONSTRAINT "package_usages_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usages" ADD CONSTRAINT "package_usages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_usages" ADD CONSTRAINT "package_usages_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_packages_org_idx" ON "client_packages" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "client_packages_client_idx" ON "client_packages" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_packages_sale_idx" ON "client_packages" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "package_usages_package_idx" ON "package_usages" USING btree ("client_package_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_package_service_id_products_id_fk" FOREIGN KEY ("package_service_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_package_ck" CHECK (("products"."service_kind" = 'package') = ("products"."package_service_id" is not null)
        and ("products"."package_service_id" is null) = ("products"."package_sessions" is null)
        and ("products"."package_sessions" is null or "products"."package_sessions" between 2 and 100)
        and ("products"."package_validity_days" is null or ("products"."package_service_id" is not null
          and "products"."package_validity_days" between 1 and 1095)));
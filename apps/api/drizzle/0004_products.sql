CREATE TABLE "product_brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_commissions" (
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	CONSTRAINT "product_commissions_product_id_user_id_pk" PRIMARY KEY("product_id","user_id"),
	CONSTRAINT "product_commissions_percent_ck" CHECK ("product_commissions"."percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "product_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"kind" text NOT NULL,
	"service_kind" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"barcode" text,
	"brand_id" uuid,
	"group_id" uuid,
	"ncm" text,
	"origin" text DEFAULT '0' NOT NULL,
	"acquisition" text DEFAULT 'resale' NOT NULL,
	"cfop" text,
	"tax_situation" text,
	"municipal_service_code" text,
	"tax_profile" text DEFAULT '' NOT NULL,
	"sale_price" numeric(14, 2) NOT NULL,
	"cost" numeric(14, 2),
	"purpose" text DEFAULT 'sale' NOT NULL,
	"desired_markup" numeric(7, 2),
	"allow_price_change" boolean DEFAULT false NOT NULL,
	"show_in_price_list" boolean DEFAULT true NOT NULL,
	"discount_limit_percent" numeric(5, 2),
	"default_commission_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"tracks_stock" boolean DEFAULT false NOT NULL,
	"min_stock" numeric(14, 3),
	"ideal_stock" numeric(14, 3),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_kind_ck" CHECK (("products"."kind" = 'product' and "products"."service_kind" is null and "products"."municipal_service_code" is null)
        or ("products"."kind" = 'service' and "products"."service_kind" is not null and "products"."ncm" is null
          and "products"."barcode" is null and not "products"."tracks_stock")),
	CONSTRAINT "products_values_ck" CHECK ("products"."sale_price" >= 0 and ("products"."cost" is null or "products"."cost" >= 0)
        and ("products"."desired_markup" is null or "products"."desired_markup" >= 0)
        and ("products"."discount_limit_percent" is null or "products"."discount_limit_percent" between 0 and 100)
        and "products"."default_commission_percent" between 0 and 100
        and ("products"."min_stock" is null or "products"."min_stock" >= 0)
        and ("products"."ideal_stock" is null or "products"."ideal_stock" >= 0))
);
--> statement-breakpoint
ALTER TABLE "product_brands" ADD CONSTRAINT "product_brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_commissions" ADD CONSTRAINT "product_commissions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_commissions" ADD CONSTRAINT "product_commissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_product_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."product_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_group_id_product_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_brands_org_name_uq" ON "product_brands" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_groups_org_name_uq" ON "product_groups" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_code_uq" ON "products" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_barcode_uq" ON "products" USING btree ("organization_id","barcode") WHERE "products"."barcode" is not null;--> statement-breakpoint
CREATE INDEX "products_org_name_idx" ON "products" USING btree ("organization_id",lower("name"));
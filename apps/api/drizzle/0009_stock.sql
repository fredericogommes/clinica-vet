CREATE TABLE "stock_balances" (
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"on_hand" numeric(14, 3) DEFAULT 0 NOT NULL,
	"shortfall" numeric(14, 3) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_unit_id_product_id_pk" PRIMARY KEY("unit_id","product_id"),
	CONSTRAINT "stock_balances_ck" CHECK ("stock_balances"."on_hand" >= 0 and "stock_balances"."shortfall" >= 0 and ("stock_balances"."on_hand" = 0 or "stock_balances"."shortfall" = 0))
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"shortfall" numeric(14, 3) DEFAULT 0 NOT NULL,
	"on_hand_after" numeric(14, 3) NOT NULL,
	"shortfall_after" numeric(14, 3) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sale_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_ck" CHECK ("stock_movements"."on_hand_after" >= 0 and "stock_movements"."shortfall" >= 0 and "stock_movements"."shortfall_after" >= 0
        and ("stock_movements"."kind" not in ('sale', 'sale_return') or "stock_movements"."sale_id" is not null)
        and ("stock_movements"."kind" <> 'sale' or "stock_movements"."quantity" < 0)
        and ("stock_movements"."kind" not in ('entry', 'sale_return') or "stock_movements"."quantity" > 0))
);
--> statement-breakpoint
ALTER TABLE "product_groups" ADD COLUMN "blocks_sale_without_stock" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_product_idx" ON "stock_movements" USING btree ("unit_id","product_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_sale_idx" ON "stock_movements" USING btree ("sale_id");
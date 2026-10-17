CREATE TABLE "stock_lots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"code" text NOT NULL,
	"expires_on" date,
	"on_hand" numeric(14, 3) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_lots_ck" CHECK ("stock_lots"."on_hand" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movement_lots" (
	"movement_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	CONSTRAINT "stock_movement_lots_movement_id_lot_id_pk" PRIMARY KEY("movement_id","lot_id"),
	CONSTRAINT "stock_movement_lots_ck" CHECK ("stock_movement_lots"."quantity" <> 0)
);
--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_values_ck";--> statement-breakpoint
ALTER TABLE "stock_balances" DROP CONSTRAINT "stock_balances_ck";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracks_lots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "stock_movement_lots_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_lots_code_uq" ON "stock_lots" USING btree ("unit_id","product_id","code");--> statement-breakpoint
CREATE INDEX "stock_lots_expiry_idx" ON "stock_lots" USING btree ("unit_id","product_id","expires_on");--> statement-breakpoint
CREATE INDEX "stock_movement_lots_lot_idx" ON "stock_movement_lots" USING btree ("lot_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_values_ck" CHECK ("products"."sale_price" >= 0 and ("products"."cost" is null or "products"."cost" >= 0)
        and ("products"."desired_markup" is null or "products"."desired_markup" >= 0)
        and ("products"."discount_limit_percent" is null or "products"."discount_limit_percent" between 0 and 100)
        and "products"."default_commission_percent" between 0 and 100
        and ("products"."min_stock" is null or "products"."min_stock" >= 0)
        and ("products"."ideal_stock" is null or "products"."ideal_stock" >= 0)
        and (not "products"."tracks_lots" or "products"."tracks_stock"));--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_ck" CHECK ("stock_balances"."on_hand" >= 0 and "stock_balances"."shortfall" >= 0);
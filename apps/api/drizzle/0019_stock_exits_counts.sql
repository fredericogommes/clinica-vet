CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"expected" numeric(14, 3),
	"counted" numeric(14, 3),
	CONSTRAINT "stock_count_lines_ck" CHECK ("stock_count_lines"."counted" is null or "stock_count_lines"."counted" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"status" text NOT NULL,
	"group_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "stock_counts_ck" CHECK (("stock_counts"."status" = 'open') = ("stock_counts"."closed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "stock_exit_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exit_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 2),
	CONSTRAINT "stock_exit_items_ck" CHECK ("stock_exit_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "stock_exits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"reason" text NOT NULL,
	"occurred_on" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"total_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "stock_exits_ck" CHECK ("stock_exits"."total_cost" >= 0 and ("stock_exits"."cancelled_at" is null) = ("stock_exits"."cancel_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_ck";--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "exit_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "count_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_group_id_product_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."product_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exit_items" ADD CONSTRAINT "stock_exit_items_exit_id_stock_exits_id_fk" FOREIGN KEY ("exit_id") REFERENCES "public"."stock_exits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exit_items" ADD CONSTRAINT "stock_exit_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exit_items" ADD CONSTRAINT "stock_exit_items_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_exits" ADD CONSTRAINT "stock_exits_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_count_lines_uq" ON "stock_count_lines" USING btree ("count_id","product_id",coalesce("lot_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_org_code_uq" ON "stock_counts" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "stock_counts_unit_idx" ON "stock_counts" USING btree ("unit_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_exit_items_position_uq" ON "stock_exit_items" USING btree ("exit_id","position");--> statement-breakpoint
CREATE INDEX "stock_exit_items_product_idx" ON "stock_exit_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_exits_org_code_uq" ON "stock_exits" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "stock_exits_unit_date_idx" ON "stock_exits" USING btree ("unit_id","occurred_on");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_exit_id_stock_exits_id_fk" FOREIGN KEY ("exit_id") REFERENCES "public"."stock_exits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_exit_idx" ON "stock_movements" USING btree ("exit_id");--> statement-breakpoint
CREATE INDEX "stock_movements_count_idx" ON "stock_movements" USING btree ("count_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_ck" CHECK ("stock_movements"."on_hand_after" >= 0 and "stock_movements"."shortfall" >= 0 and "stock_movements"."shortfall_after" >= 0
        and ("stock_movements"."kind" not in ('sale', 'sale_return') or "stock_movements"."sale_id" is not null)
        and ("stock_movements"."kind" not in ('purchase', 'purchase_cancel') or "stock_movements"."purchase_id" is not null)
        and ("stock_movements"."kind" not in ('exit', 'exit_cancel') or "stock_movements"."exit_id" is not null)
        and ("stock_movements"."kind" not in ('sale', 'purchase_cancel', 'exit') or "stock_movements"."quantity" < 0)
        and ("stock_movements"."kind" not in ('entry', 'sale_return', 'purchase', 'exit_cancel') or "stock_movements"."quantity" > 0));
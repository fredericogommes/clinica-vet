CREATE TABLE "cash_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"cash_session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"method_name" text,
	"payment_kind" text,
	"sale_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_movements_amount_ck" CHECK ("cash_movements"."amount" > 0),
	CONSTRAINT "cash_movements_refund_ck" CHECK (("cash_movements"."kind" = 'refund') = ("cash_movements"."sale_id" is not null and "cash_movements"."payment_kind" is not null))
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"operator_id" uuid NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"opening_amount" numeric(14, 2) NOT NULL,
	"opening_notes" text DEFAULT '' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"expected_cash" numeric(14, 2),
	"counted_cash" numeric(14, 2),
	"closing_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_sessions_opening_ck" CHECK ("cash_sessions"."opening_amount" >= 0),
	CONSTRAINT "cash_sessions_closed_ck" CHECK (("cash_sessions"."status" = 'closed') = ("cash_sessions"."closed_at" is not null and "cash_sessions"."closed_by" is not null
        and "cash_sessions"."expected_cash" is not null and "cash_sessions"."counted_cash" is not null)),
	CONSTRAINT "cash_sessions_counted_ck" CHECK ("cash_sessions"."counted_cash" is null or "cash_sessions"."counted_cash" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales" DROP CONSTRAINT "sales_closed_ck";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "cash_session_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_movements_session_idx" ON "cash_movements" USING btree ("cash_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_org_code_uq" ON "cash_sessions" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_open_uq" ON "cash_sessions" USING btree ("unit_id","operator_id") WHERE "cash_sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "cash_sessions_unit_opened_idx" ON "cash_sessions" USING btree ("unit_id","opened_at");--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_payments_cash_session_idx" ON "sale_payments" USING btree ("cash_session_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_closed_ck" CHECK (("sales"."closed_at" is null) = ("sales"."closed_by" is null)
        and ("sales"."status" <> 'closed' or "sales"."closed_at" is not null)
        and ("sales"."status" not in ('quote', 'open') or "sales"."closed_at" is null));
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"acquirer" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"settlement_days" smallint DEFAULT 0 NOT NULL,
	"max_installments" smallint DEFAULT 1 NOT NULL,
	"fee_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_values_ck" CHECK ("payment_methods"."settlement_days" between 0 and 365 and "payment_methods"."max_installments" between 1 and 24
        and "payment_methods"."fee_percent" between 0 and 30
        and ("payment_methods"."max_installments" = 1 or "payment_methods"."kind" in ('credit', 'voucher')))
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"method_name" text NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"installments" smallint NOT NULL,
	"settlement_days" smallint NOT NULL,
	"fee_percent" numeric(5, 2) NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"received_by" uuid NOT NULL,
	CONSTRAINT "sale_payments_values_ck" CHECK ("sale_payments"."amount" > 0 and "sale_payments"."installments" between 1 and 24 and "sale_payments"."fee_percent" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "sale_receivables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_payment_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"fee_amount" numeric(14, 2) NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "sale_receivables_values_ck" CHECK ("sale_receivables"."amount" > 0 and "sale_receivables"."fee_amount" >= 0 and "sale_receivables"."net_amount" = "sale_receivables"."amount" - "sale_receivables"."fee_amount")
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_receivables" ADD CONSTRAINT "sale_receivables_sale_payment_id_sale_payments_id_fk" FOREIGN KEY ("sale_payment_id") REFERENCES "public"."sale_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_org_name_uq" ON "payment_methods" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "sale_payments_sale_position_uq" ON "sale_payments" USING btree ("sale_id","position");--> statement-breakpoint
CREATE INDEX "sale_payments_method_idx" ON "sale_payments" USING btree ("payment_method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_receivables_payment_number_uq" ON "sale_receivables" USING btree ("sale_payment_id","number");--> statement-breakpoint
CREATE INDEX "sale_receivables_due_idx" ON "sale_receivables" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_closed_ck" CHECK (("sales"."status" = 'closed') = ("sales"."closed_at" is not null and "sales"."closed_by" is not null));--> statement-breakpoint
-- Formas iniciais para instalações existentes, igual ao de uma organização nova (UUID v7 em SQL).
INSERT INTO "payment_methods" ("id", "organization_id", "name", "kind")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid,
       o."id", m.name, m.kind
FROM "organizations" o
CROSS JOIN (VALUES ('Dinheiro', 'cash'), ('PIX', 'pix')) AS m(name, kind);

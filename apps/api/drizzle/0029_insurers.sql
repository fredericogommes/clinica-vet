CREATE TABLE "insurer_prices" (
	"insurer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"copay_percent" numeric(5, 2),
	"requires_authorization" boolean NOT NULL,
	CONSTRAINT "insurer_prices_insurer_id_product_id_pk" PRIMARY KEY("insurer_id","product_id"),
	CONSTRAINT "insurer_prices_values_ck" CHECK ("insurer_prices"."price" >= 0 and ("insurer_prices"."copay_percent" is null or "insurer_prices"."copay_percent" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "insurers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" text DEFAULT '' NOT NULL,
	"payment_days" smallint NOT NULL,
	"copay_percent" numeric(5, 2) NOT NULL,
	"requires_authorization" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurers_values_ck" CHECK ("insurers"."payment_days" between 0 and 365 and "insurers"."copay_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "insurer_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "insurance_card_number" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "insurance_valid_until" date;--> statement-breakpoint
ALTER TABLE "insurer_prices" ADD CONSTRAINT "insurer_prices_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurer_prices" ADD CONSTRAINT "insurer_prices_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurers" ADD CONSTRAINT "insurers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insurer_prices_product_idx" ON "insurer_prices" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "insurers_org_name_uq" ON "insurers" USING btree ("organization_id",lower("name"));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_insurer_id_insurers_id_fk" FOREIGN KEY ("insurer_id") REFERENCES "public"."insurers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patients_insurer_idx" ON "patients" USING btree ("insurer_id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_insurance_ck" CHECK (("patients"."insurer_id" is null) = ("patients"."insurance_card_number" is null)
        and ("patients"."insurer_id" is not null or "patients"."insurance_valid_until" is null));
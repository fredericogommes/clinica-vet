CREATE TABLE "clinical_exam_results" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"reference_label" text
);
--> statement-breakpoint
CREATE TABLE "clinical_exam_values" (
	"event_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"section" text,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"data_type" text NOT NULL,
	"numeric_value" numeric(14, 4),
	"text_value" text,
	"low" numeric(14, 4),
	"high" numeric(14, 4),
	"flag" text,
	CONSTRAINT "clinical_exam_values_event_id_attribute_id_pk" PRIMARY KEY("event_id","attribute_id"),
	CONSTRAINT "clinical_exam_values_ck" CHECK (("clinical_exam_values"."data_type" = 'text' and "clinical_exam_values"."text_value" is not null and "clinical_exam_values"."numeric_value" is null
          and "clinical_exam_values"."flag" is null)
        or ("clinical_exam_values"."data_type" <> 'text' and "clinical_exam_values"."numeric_value" is not null and "clinical_exam_values"."text_value" is null))
);
--> statement-breakpoint
CREATE TABLE "exam_attributes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"data_type" text,
	"decimals" smallint,
	"max_length" smallint,
	"archived_at" timestamp with time zone,
	CONSTRAINT "exam_attributes_type_ck" CHECK (("exam_attributes"."kind" = 'section' and "exam_attributes"."data_type" is null)
        or ("exam_attributes"."kind" = 'field' and "exam_attributes"."data_type" is not null
          and ("exam_attributes"."data_type" <> 'decimal' or "exam_attributes"."decimals" between 0 and 4)
          and ("exam_attributes"."data_type" <> 'text' or "exam_attributes"."max_length" between 1 and 200)))
);
--> statement-breakpoint
CREATE TABLE "exam_reference_ranges" (
	"reference_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"low" numeric(14, 4),
	"high" numeric(14, 4),
	CONSTRAINT "exam_reference_ranges_reference_id_attribute_id_pk" PRIMARY KEY("reference_id","attribute_id"),
	CONSTRAINT "exam_reference_ranges_ck" CHECK (("exam_reference_ranges"."low" is not null or "exam_reference_ranges"."high" is not null)
        and ("exam_reference_ranges"."low" is null or "exam_reference_ranges"."high" is null or "exam_reference_ranges"."low" <= "exam_reference_ranges"."high"))
);
--> statement-breakpoint
CREATE TABLE "exam_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"exam_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	"label" text NOT NULL,
	"min_months" integer NOT NULL,
	"max_months" integer NOT NULL,
	CONSTRAINT "exam_references_months_ck" CHECK ("exam_references"."min_months" >= 0 and "exam_references"."max_months" >= "exam_references"."min_months" and "exam_references"."max_months" <= 9999)
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"service_id" uuid
);
--> statement-breakpoint
ALTER TABLE "clinical_exam_results" ADD CONSTRAINT "clinical_exam_results_event_id_clinical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_exam_results" ADD CONSTRAINT "clinical_exam_results_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_exam_values" ADD CONSTRAINT "clinical_exam_values_event_id_clinical_exam_results_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_exam_results"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_exam_values" ADD CONSTRAINT "clinical_exam_values_attribute_id_exam_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."exam_attributes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attributes" ADD CONSTRAINT "exam_attributes_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_reference_ranges" ADD CONSTRAINT "exam_reference_ranges_reference_id_exam_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."exam_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_reference_ranges" ADD CONSTRAINT "exam_reference_ranges_attribute_id_exam_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."exam_attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_references" ADD CONSTRAINT "exam_references_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_references" ADD CONSTRAINT "exam_references_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_service_id_products_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_exam_values_attribute_idx" ON "clinical_exam_values" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX "exam_attributes_exam_idx" ON "exam_attributes" USING btree ("exam_id","position");--> statement-breakpoint
CREATE INDEX "exam_references_exam_idx" ON "exam_references" USING btree ("exam_id","species_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exams_org_name_uq" ON "exams" USING btree ("organization_id",lower("name"));
CREATE TABLE "box_species" (
	"box_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	CONSTRAINT "box_species_box_id_species_id_pk" PRIMARY KEY("box_id","species_id")
);
--> statement-breakpoint
CREATE TABLE "boxes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"capacity" smallint NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boxes_capacity_ck" CHECK ("boxes"."capacity" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "hospitalization_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospitalization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"weight_kg" numeric(8, 3),
	"clinical_event_id" uuid,
	"appetite" text,
	"behavior" text,
	"feces" text,
	"urine" text,
	"vomit" text,
	"temperature" text,
	"heart_rate" smallint,
	"respiratory_rate" smallint,
	"systolic_pressure" smallint,
	"glucose" smallint,
	"dehydration" numeric(3, 1),
	CONSTRAINT "hospitalization_entries_weight_ck" CHECK (("hospitalization_entries"."kind" = 'weight') = ("hospitalization_entries"."weight_kg" is not null)
        and ("hospitalization_entries"."weight_kg" is null or "hospitalization_entries"."weight_kg" between 0.001 and 2000)),
	CONSTRAINT "hospitalization_entries_numbers_ck" CHECK (("hospitalization_entries"."heart_rate" is null or "hospitalization_entries"."heart_rate" between 10 and 400)
        and ("hospitalization_entries"."respiratory_rate" is null or "hospitalization_entries"."respiratory_rate" between 4 and 200)
        and ("hospitalization_entries"."systolic_pressure" is null or "hospitalization_entries"."systolic_pressure" between 20 and 350)
        and ("hospitalization_entries"."glucose" is null or "hospitalization_entries"."glucose" between 10 and 1500)
        and ("hospitalization_entries"."dehydration" is null or "hospitalization_entries"."dehydration" between 0 and 15))
);
--> statement-breakpoint
CREATE TABLE "hospitalizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"patient_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"veterinarian_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"expected_discharge_on" date,
	"box_id" uuid,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"outcome_notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospitalizations_end_ck" CHECK (("hospitalizations"."status" = 'admitted') = ("hospitalizations"."ended_at" is null)
        and ("hospitalizations"."ended_at" is null) = ("hospitalizations"."ended_by" is null)
        and ("hospitalizations"."status" <> 'admitted' or "hospitalizations"."outcome_notes" is null)
        and ("hospitalizations"."status" <> 'cancelled' or "hospitalizations"."outcome_notes" is not null))
);
--> statement-breakpoint
ALTER TABLE "box_species" ADD CONSTRAINT "box_species_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "box_species" ADD CONSTRAINT "box_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boxes" ADD CONSTRAINT "boxes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_hospitalization_id_hospitalizations_id_fk" FOREIGN KEY ("hospitalization_id") REFERENCES "public"."hospitalizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_clinical_event_id_clinical_events_id_fk" FOREIGN KEY ("clinical_event_id") REFERENCES "public"."clinical_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_veterinarian_id_users_id_fk" FOREIGN KEY ("veterinarian_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_box_id_boxes_id_fk" FOREIGN KEY ("box_id") REFERENCES "public"."boxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "boxes_unit_code_uq" ON "boxes" USING btree ("unit_id",upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "boxes_unit_name_uq" ON "boxes" USING btree ("unit_id",lower("name"));--> statement-breakpoint
CREATE INDEX "hospitalization_entries_hosp_idx" ON "hospitalization_entries" USING btree ("hospitalization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hospitalizations_org_code_uq" ON "hospitalizations" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "hospitalizations_patient_open_uq" ON "hospitalizations" USING btree ("patient_id") WHERE "hospitalizations"."status" = 'admitted';--> statement-breakpoint
CREATE INDEX "hospitalizations_unit_status_idx" ON "hospitalizations" USING btree ("unit_id","status");--> statement-breakpoint
CREATE INDEX "hospitalizations_box_idx" ON "hospitalizations" USING btree ("box_id");
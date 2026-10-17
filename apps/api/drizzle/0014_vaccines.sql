CREATE TABLE "clinical_vaccinations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"vaccine_id" uuid NOT NULL,
	"dose_number" smallint NOT NULL,
	"dose_label" text NOT NULL,
	"lot_number" text DEFAULT '' NOT NULL,
	"next_due_on" date,
	CONSTRAINT "clinical_vaccinations_dose_ck" CHECK ("clinical_vaccinations"."dose_number" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "vaccine_protocol_closures" (
	"patient_id" uuid NOT NULL,
	"vaccine_id" uuid NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by" uuid NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "vaccine_protocol_closures_patient_id_vaccine_id_pk" PRIMARY KEY("patient_id","vaccine_id")
);
--> statement-breakpoint
CREATE TABLE "vaccines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"primary_doses" smallint NOT NULL,
	"primary_interval_days" smallint,
	"booster_interval_days" smallint,
	"service_id" uuid,
	CONSTRAINT "vaccines_doses_ck" CHECK ("vaccines"."primary_doses" between 1 and 6
        and ("vaccines"."primary_doses" = 1 or "vaccines"."primary_interval_days" is not null)
        and ("vaccines"."primary_interval_days" is null or "vaccines"."primary_interval_days" between 1 and 1095)
        and ("vaccines"."booster_interval_days" is null or "vaccines"."booster_interval_days" between 1 and 1095))
);
--> statement-breakpoint
ALTER TABLE "clinical_vaccinations" ADD CONSTRAINT "clinical_vaccinations_event_id_clinical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_vaccinations" ADD CONSTRAINT "clinical_vaccinations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_vaccinations" ADD CONSTRAINT "clinical_vaccinations_vaccine_id_vaccines_id_fk" FOREIGN KEY ("vaccine_id") REFERENCES "public"."vaccines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccine_protocol_closures" ADD CONSTRAINT "vaccine_protocol_closures_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccine_protocol_closures" ADD CONSTRAINT "vaccine_protocol_closures_vaccine_id_vaccines_id_fk" FOREIGN KEY ("vaccine_id") REFERENCES "public"."vaccines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccine_protocol_closures" ADD CONSTRAINT "vaccine_protocol_closures_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccines" ADD CONSTRAINT "vaccines_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaccines" ADD CONSTRAINT "vaccines_service_id_products_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_vaccinations_patient_idx" ON "clinical_vaccinations" USING btree ("patient_id","vaccine_id");--> statement-breakpoint
CREATE INDEX "clinical_vaccinations_due_idx" ON "clinical_vaccinations" USING btree ("next_due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "vaccines_org_name_uq" ON "vaccines" USING btree ("organization_id",lower("name"));
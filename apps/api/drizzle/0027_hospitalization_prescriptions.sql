CREATE TABLE "hospitalization_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prescription_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"executed_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"weight_kg" numeric(8, 3),
	"amount" numeric(14, 3),
	"volume_ml" numeric(12, 2),
	CONSTRAINT "hospitalization_executions_skip_ck" CHECK ("hospitalization_executions"."status" = 'done' or length(trim("hospitalization_executions"."notes")) > 0)
);
--> statement-breakpoint
CREATE TABLE "hospitalization_prescriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hospitalization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose" numeric(12, 3) NOT NULL,
	"dose_unit" text NOT NULL,
	"concentration" numeric(12, 3),
	"route" text NOT NULL,
	"interval_hours" smallint NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"duration_days" smallint,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stopped_by" uuid,
	"stop_reason" text,
	CONSTRAINT "hospitalization_prescriptions_ck" CHECK ("hospitalization_prescriptions"."dose" > 0 and "hospitalization_prescriptions"."interval_hours" between 1 and 72
        and ("hospitalization_prescriptions"."duration_days" is null or "hospitalization_prescriptions"."duration_days" between 1 and 90)
        and ("hospitalization_prescriptions"."concentration" is null or "hospitalization_prescriptions"."concentration" > 0)
        and ("hospitalization_prescriptions"."stopped_at" is null) = ("hospitalization_prescriptions"."stopped_by" is null)
        and ("hospitalization_prescriptions"."stopped_at" is null) = ("hospitalization_prescriptions"."stop_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "hospitalization_executions" ADD CONSTRAINT "hospitalization_executions_prescription_id_hospitalization_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."hospitalization_prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_executions" ADD CONSTRAINT "hospitalization_executions_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_prescriptions" ADD CONSTRAINT "hospitalization_prescriptions_hospitalization_id_hospitalizations_id_fk" FOREIGN KEY ("hospitalization_id") REFERENCES "public"."hospitalizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_prescriptions" ADD CONSTRAINT "hospitalization_prescriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospitalization_prescriptions" ADD CONSTRAINT "hospitalization_prescriptions_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospitalization_executions_slot_uq" ON "hospitalization_executions" USING btree ("prescription_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "hospitalization_prescriptions_hosp_idx" ON "hospitalization_prescriptions" USING btree ("hospitalization_id");
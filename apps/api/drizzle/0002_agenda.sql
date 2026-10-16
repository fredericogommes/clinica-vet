CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "appointment_patients" (
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "appointment_patients_appointment_id_patient_id_pk" PRIMARY KEY("appointment_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	CONSTRAINT "appointment_types_duration_ck" CHECK ("appointment_types"."duration_minutes" between 15 and 720)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"fit_in" boolean DEFAULT false NOT NULL,
	"series_id" uuid,
	"confirmed_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_range_ck" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_fixed_hours" (
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "schedule_fixed_hours_unit_id_user_id_weekday_pk" PRIMARY KEY("unit_id","user_id","weekday"),
	CONSTRAINT "schedule_fixed_hours_range_ck" CHECK (0 <= "schedule_fixed_hours"."start_minute" and "schedule_fixed_hours"."start_minute" < "schedule_fixed_hours"."end_minute" and "schedule_fixed_hours"."end_minute" <= 1440 and "schedule_fixed_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "schedule_members" (
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_members_unit_id_user_id_pk" PRIMARY KEY("unit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_shifts_range_ck" CHECK (0 <= "schedule_shifts"."start_minute" and "schedule_shifts"."start_minute" < "schedule_shifts"."end_minute" and "schedule_shifts"."end_minute" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "unit_opening_hours" (
	"unit_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	CONSTRAINT "unit_opening_hours_unit_id_weekday_pk" PRIMARY KEY("unit_id","weekday"),
	CONSTRAINT "unit_opening_hours_range_ck" CHECK (0 <= "unit_opening_hours"."start_minute" and "unit_opening_hours"."start_minute" < "unit_opening_hours"."end_minute" and "unit_opening_hours"."end_minute" <= 1440 and "unit_opening_hours"."weekday" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "appointment_patients" ADD CONSTRAINT "appointment_patients_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_patients" ADD CONSTRAINT "appointment_patients_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_type_id_appointment_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_fixed_hours" ADD CONSTRAINT "schedule_fixed_hours_member_fk" FOREIGN KEY ("unit_id","user_id") REFERENCES "public"."schedule_members"("unit_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_members" ADD CONSTRAINT "schedule_members_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_members" ADD CONSTRAINT "schedule_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_shifts" ADD CONSTRAINT "schedule_shifts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_opening_hours" ADD CONSTRAINT "unit_opening_hours_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_patients_patient_idx" ON "appointment_patients" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointment_types_org_name_uq" ON "appointment_types" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "appointments_unit_starts_idx" ON "appointments" USING btree ("unit_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_client_idx" ON "appointments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "appointments_series_idx" ON "appointments" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "schedule_shifts_unit_date_idx" ON "schedule_shifts" USING btree ("unit_id","date");--> statement-breakpoint
-- Escrita à mão (o Drizzle não modela EXCLUDE): um profissional nunca tem dois agendamentos
-- ativos que se sobreponham, mesmo com duas recepções gravando ao mesmo tempo [RN-12].
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap" EXCLUDE USING gist ("professional_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint
-- Ponto de partida para instalações existentes, igual ao de uma organização nova:
-- Seg–Sáb 08:00–18:00 e tipos de atendimento comuns (UUID v7 gerado em SQL).
INSERT INTO "unit_opening_hours" ("unit_id", "weekday", "start_minute", "end_minute")
SELECT u."id", d.weekday, 480, 1080 FROM "units" u CROSS JOIN generate_series(1, 6) AS d(weekday);
--> statement-breakpoint
INSERT INTO "appointment_types" ("id", "organization_id", "name", "duration_minutes")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid,
       o."id", t.name, t.duration
FROM "organizations" o
CROSS JOIN (VALUES ('Consulta', 60), ('Retorno', 30), ('Vacinação', 30), ('Coleta de exames', 30), ('Cirurgia', 120), ('Banho e tosa', 90)) AS t(name, duration);

CREATE TABLE "clinical_event_pathologies" (
	"event_id" uuid NOT NULL,
	"pathology_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "clinical_event_pathologies_event_id_pathology_id_pk" PRIMARY KEY("event_id","pathology_id")
);
--> statement-breakpoint
CREATE TABLE "clinical_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"author_id" uuid NOT NULL,
	"appointment_id" uuid,
	"appointment_type_id" uuid,
	"template_id" uuid,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_events_status_ck" CHECK (("clinical_events"."status" = 'draft' and "clinical_events"."published_at" is null and "clinical_events"."voided_at" is null)
        or ("clinical_events"."status" = 'published' and "clinical_events"."published_at" is not null and "clinical_events"."voided_at" is null)
        or ("clinical_events"."status" = 'voided' and "clinical_events"."published_at" is not null and "clinical_events"."voided_at" is not null
            and "clinical_events"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "clinical_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_vitals" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"heart_rate" smallint,
	"respiratory_rate" smallint,
	"temperature" numeric(4, 1),
	"capillary_refill" numeric(3, 1),
	"weight_kg" numeric(8, 3),
	"body_score" smallint,
	CONSTRAINT "clinical_vitals_ranges_ck" CHECK (("clinical_vitals"."heart_rate" is null or "clinical_vitals"."heart_rate" between 10 and 400)
        and ("clinical_vitals"."respiratory_rate" is null or "clinical_vitals"."respiratory_rate" between 4 and 200)
        and ("clinical_vitals"."temperature" is null or "clinical_vitals"."temperature" between 30 and 45)
        and ("clinical_vitals"."capillary_refill" is null or "clinical_vitals"."capillary_refill" between 0 and 10)
        and ("clinical_vitals"."weight_kg" is null or "clinical_vitals"."weight_kg" between 0.001 and 2000)
        and ("clinical_vitals"."body_score" is null or "clinical_vitals"."body_score" between 1 and 9))
);
--> statement-breakpoint
CREATE TABLE "pathologies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code" text
);
--> statement-breakpoint
ALTER TABLE "appointment_types" ADD COLUMN "record_template" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_event_pathologies" ADD CONSTRAINT "clinical_event_pathologies_event_id_clinical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_event_pathologies" ADD CONSTRAINT "clinical_event_pathologies_pathology_id_pathologies_id_fk" FOREIGN KEY ("pathology_id") REFERENCES "public"."pathologies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_appointment_type_id_appointment_types_id_fk" FOREIGN KEY ("appointment_type_id") REFERENCES "public"."appointment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_template_id_clinical_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."clinical_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_events" ADD CONSTRAINT "clinical_events_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_files" ADD CONSTRAINT "clinical_files_event_id_clinical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_templates" ADD CONSTRAINT "clinical_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_vitals" ADD CONSTRAINT "clinical_vitals_event_id_clinical_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."clinical_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pathologies" ADD CONSTRAINT "pathologies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_event_pathologies_pathology_idx" ON "clinical_event_pathologies" USING btree ("pathology_id");--> statement-breakpoint
CREATE INDEX "clinical_events_patient_time_idx" ON "clinical_events" USING btree ("patient_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "clinical_events_author_idx" ON "clinical_events" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_files_event_uq" ON "clinical_files" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_templates_org_kind_name_uq" ON "clinical_templates" USING btree ("organization_id","kind",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pathologies_org_name_uq" ON "pathologies" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pathologies_org_code_uq" ON "pathologies" USING btree ("organization_id",upper("code")) WHERE "pathologies"."code" is not null;--> statement-breakpoint
-- Ponto de partida para instalações existentes, igual ao de uma organização nova: modelo de
-- prontuário da Consulta e um modelo de receita e um de documento (textos em starter-templates.ts).
UPDATE "appointment_types" SET "record_template" = $tpl$ANAMNESE
Queixa principal:
Ambiente:
Alimentação:
Vacinação:
Vermifugação:
Ectoparasitas:
Histórico reprodutivo:
História médica anterior:
Procedimentos realizados:

EXAME CLÍNICO
Olhos e mucosa ocular:
Cavidade oral:
Hidratação:
Pulso venoso jugular:
Pulso arterial:
Orelhas:
Linfonodos:
Pele e pelo:
Membros torácicos:
Tórax:
Membros pélvicos:
Abdome:
Urinário:
Genital:
Musculoesquelético:
Nervoso:

CONCLUSÕES
Suspeita diagnóstica:
Tratamento:
Exames solicitados:
Outras observações:$tpl$
WHERE "name" = 'Consulta' AND "record_template" = '';
--> statement-breakpoint
INSERT INTO "clinical_templates" ("id", "organization_id", "kind", "name", "body")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid, o."id", t.kind, t.name, t.body
FROM "organizations" o
CROSS JOIN (VALUES
  ('prescription', 'Receita simples', $tpl$Uso oral

1. $tpl$),
  ('document', 'Atestado de saúde', $tpl$Atesto, para os devidos fins, que examinei nesta data o animal {{animal}}, {{especie}}, {{raca}}, {{sexo}}, {{idade}}, microchip {{microchip}}, sob responsabilidade de {{responsavel}} ({{documento_responsavel}}), e que ele não apresenta sinais clínicos de doença infectocontagiosa.

{{unidade}}, {{data}}.$tpl$)
) AS t(kind, name, body);

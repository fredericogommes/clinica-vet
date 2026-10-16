CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TABLE "breeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"species_id" uuid NOT NULL,
	CONSTRAINT "breeds_id_species_uq" UNIQUE("id","species_id")
);
--> statement-breakpoint
CREATE TABLE "client_consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"is_whatsapp" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_origins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"person_type" text NOT NULL,
	"name" text NOT NULL,
	"nationality" text,
	"sex" text,
	"cpf" text,
	"cnpj" text,
	"rg" text,
	"birth_date" date,
	"origin_id" uuid,
	"profession" text,
	"municipal_registration" text,
	"notes" text,
	"cep" text,
	"street" text,
	"number" text,
	"complement" text,
	"district" text,
	"city" text,
	"state" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_counters" (
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "organization_counters_organization_id_name_pk" PRIMARY KEY("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "patient_owner_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text,
	"changed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" integer NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"deceased_on" date,
	"sex" text NOT NULL,
	"sterilized" boolean,
	"birth_date" date,
	"species_id" uuid,
	"breed_id" uuid,
	"coat_id" uuid,
	"microchip" text,
	"has_pedigree" boolean DEFAULT false NOT NULL,
	"pedigree_number" text,
	"markings" text[] DEFAULT '{}'::text[] NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "breeds" ADD CONSTRAINT "breeds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breeds" ADD CONSTRAINT "breeds_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_origins" ADD CONSTRAINT "client_origins_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_origin_id_client_origins_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."client_origins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coats" ADD CONSTRAINT "coats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_counters" ADD CONSTRAINT "organization_counters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_owner_history" ADD CONSTRAINT "patient_owner_history_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_owner_history" ADD CONSTRAINT "patient_owner_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_owner_history" ADD CONSTRAINT "patient_owner_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "public"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_breed_id_breeds_id_fk" FOREIGN KEY ("breed_id") REFERENCES "public"."breeds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_coat_id_coats_id_fk" FOREIGN KEY ("coat_id") REFERENCES "public"."coats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_breed_species_fk" FOREIGN KEY ("breed_id","species_id") REFERENCES "public"."breeds"("id","species_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "breeds_species_name_uq" ON "breeds" USING btree ("species_id",lower("name"));--> statement-breakpoint
CREATE INDEX "client_consents_client_channel_idx" ON "client_consents" USING btree ("client_id","channel","recorded_at");--> statement-breakpoint
CREATE INDEX "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_contacts_value_idx" ON "client_contacts" USING btree ("value");--> statement-breakpoint
CREATE UNIQUE INDEX "client_origins_org_name_uq" ON "client_origins" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_code_uq" ON "clients" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_cpf_uq" ON "clients" USING btree ("organization_id","cpf") WHERE "clients"."cpf" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_org_cnpj_uq" ON "clients" USING btree ("organization_id","cnpj") WHERE "clients"."cnpj" is not null;--> statement-breakpoint
CREATE INDEX "clients_org_name_idx" ON "clients" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "coats_org_name_uq" ON "coats" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "patient_owner_history_patient_idx" ON "patient_owner_history" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_owner_history_current_uq" ON "patient_owner_history" USING btree ("patient_id") WHERE "patient_owner_history"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_code_uq" ON "patients" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_org_microchip_uq" ON "patients" USING btree ("organization_id","microchip") WHERE "patients"."microchip" is not null;--> statement-breakpoint
CREATE INDEX "patients_client_idx" ON "patients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "patients_org_name_idx" ON "patients" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "species_org_name_uq" ON "species" USING btree ("organization_id",lower("name"));
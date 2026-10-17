CREATE TABLE "message_settings" (
	"organization_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"offset" smallint,
	"template" text NOT NULL,
	"provider_template" text DEFAULT '' NOT NULL,
	"active_since" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_settings_organization_id_trigger_pk" PRIMARY KEY("organization_id","trigger")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"client_id" uuid NOT NULL,
	"patient_id" uuid,
	"phone" text,
	"body" text NOT NULL,
	"params" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"channel" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_status_ck" CHECK (("messages"."status" = 'skipped') = ("messages"."skip_reason" is not null)
        and ("messages"."status" = 'sent') = ("messages"."sent_at" is not null and "messages"."channel" is not null))
);
--> statement-breakpoint
ALTER TABLE "message_settings" ADD CONSTRAINT "message_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_settings" ADD CONSTRAINT "message_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_dedupe_uq" ON "messages" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "messages_org_status_idx" ON "messages" USING btree ("organization_id","status","created_at");
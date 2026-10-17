CREATE TABLE "portal_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"link_token_hash" text,
	"link_expires_at" timestamp with time zone,
	"invited_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"activated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_accounts_link_ck" CHECK (("portal_accounts"."link_token_hash" is null) = ("portal_accounts"."link_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"show_appointments" boolean DEFAULT true NOT NULL,
	"show_weight" boolean DEFAULT true NOT NULL,
	"show_vaccines" boolean DEFAULT true NOT NULL,
	"show_exams" boolean DEFAULT false NOT NULL,
	"show_prescriptions" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_accounts" ADD CONSTRAINT "portal_accounts_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_account_id_portal_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."portal_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_client_uq" ON "portal_accounts" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_email_uq" ON "portal_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "portal_accounts_link_uq" ON "portal_accounts" USING btree ("link_token_hash") WHERE "portal_accounts"."link_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "portal_sessions_account_idx" ON "portal_sessions" USING btree ("account_id");
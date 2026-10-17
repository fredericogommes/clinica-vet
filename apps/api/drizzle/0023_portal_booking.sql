ALTER TABLE "appointments" ADD COLUMN "origin" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "booking_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "booking_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "booking_lead_hours" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD COLUMN "booking_window_days" smallint DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_settings" ADD CONSTRAINT "portal_settings_booking_ck" CHECK ("portal_settings"."booking_lead_hours" between 0 and 168 and "portal_settings"."booking_window_days" between 1 and 180);
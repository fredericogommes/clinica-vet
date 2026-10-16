ALTER TABLE "appointment_types" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "clinical_event_id" uuid;--> statement-breakpoint
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_service_id_products_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_clinical_event_id_clinical_events_id_fk" FOREIGN KEY ("clinical_event_id") REFERENCES "public"."clinical_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_items_clinical_event_uq" ON "sale_items" USING btree ("clinical_event_id") WHERE "sale_items"."clinical_event_id" is not null;
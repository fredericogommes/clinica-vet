ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_values_ck";--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "settles_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_settles_payment_id_sale_payments_id_fk" FOREIGN KEY ("settles_payment_id") REFERENCES "public"."sale_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_payments_settles_idx" ON "sale_payments" USING btree ("settles_payment_id");--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_values_ck" CHECK ("payment_methods"."settlement_days" between 0 and 365 and "payment_methods"."max_installments" between 1 and 24
        and "payment_methods"."fee_percent" between 0 and 30
        and ("payment_methods"."max_installments" = 1 or "payment_methods"."kind" in ('credit', 'voucher'))
        and ("payment_methods"."kind" <> 'account' or "payment_methods"."fee_percent" = 0));--> statement-breakpoint
-- Conta do cliente (fiado) para as clínicas que já existem, como nas novas.
INSERT INTO "payment_methods" ("id", "organization_id", "name", "kind", "settlement_days")
SELECT encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6), 52, 1), 53, 1), 'hex')::uuid, o."id", 'Conta do cliente', 'account', 30
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "payment_methods" m
  WHERE m."organization_id" = o."id" AND (m."kind" = 'account' OR lower(m."name") = 'conta do cliente')
);

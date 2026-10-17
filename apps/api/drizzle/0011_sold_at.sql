ALTER TABLE "sales" ADD COLUMN "sold_at" timestamp with time zone;--> statement-breakpoint
-- Vendas anteriores: a data da venda é a da criação (o orçamento convertido não deixou rastro).
UPDATE "sales" SET "sold_at" = "created_at" WHERE "status" IN ('open', 'closed') OR "closed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_unit_sold_idx" ON "sales" USING btree ("unit_id","sold_at");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_sold_ck" CHECK (("sales"."status" <> 'quote' or "sales"."sold_at" is null)
        and ("sales"."status" not in ('open', 'closed') or "sales"."sold_at" is not null));
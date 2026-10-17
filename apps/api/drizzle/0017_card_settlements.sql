CREATE TABLE "card_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_method_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"expected_date" date NOT NULL,
	"deposit_date" date NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"fee" numeric(14, 2) NOT NULL,
	"expected_net" numeric(14, 2) NOT NULL,
	"received_net" numeric(14, 2) NOT NULL,
	"adjustment_entry_id" uuid,
	"reconciled_by" uuid NOT NULL,
	"reconciled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "card_settlements_values_ck" CHECK ("card_settlements"."gross" > 0 and "card_settlements"."fee" >= 0 and "card_settlements"."expected_net" = "card_settlements"."gross" - "card_settlements"."fee"
        and "card_settlements"."received_net" > 0)
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "card_settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_adjustment_entry_id_financial_entries_id_fk" FOREIGN KEY ("adjustment_entry_id") REFERENCES "public"."financial_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_settlements" ADD CONSTRAINT "card_settlements_reconciled_by_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_settlements_org_date_idx" ON "card_settlements" USING btree ("organization_id","expected_date");--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_card_settlement_id_card_settlements_id_fk" FOREIGN KEY ("card_settlement_id") REFERENCES "public"."card_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_entries_settlement_idx" ON "financial_entries" USING btree ("card_settlement_id");
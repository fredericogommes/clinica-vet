CREATE TABLE "intelligence_favorites" (
	"user_id" uuid NOT NULL,
	"indicator" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "intelligence_favorites_user_id_indicator_pk" PRIMARY KEY("user_id","indicator")
);
--> statement-breakpoint
ALTER TABLE "intelligence_favorites" ADD CONSTRAINT "intelligence_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
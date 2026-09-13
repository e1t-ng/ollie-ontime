CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"verifier" text NOT NULL,
	"binding_hash" text NOT NULL,
	"return_to" text DEFAULT '/' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "gender" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_recommendations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "oauth_states_expiry" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_google_sub" ON "accounts" USING btree ("google_sub");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_credential" CHECK ("accounts"."password_hash" is not null or "accounts"."google_sub" is not null);
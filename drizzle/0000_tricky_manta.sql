CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"calendar" text NOT NULL,
	"data" text NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"owner" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"home_city" text DEFAULT '' NOT NULL,
	"time_zone" text DEFAULT '' NOT NULL,
	"location_sharing" text DEFAULT 'never' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"event" text NOT NULL,
	"user" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "calendars_owner" ON "calendars" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "events_owner" ON "events" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "events_token" ON "events" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_event_user" ON "responses" USING btree ("event","user");
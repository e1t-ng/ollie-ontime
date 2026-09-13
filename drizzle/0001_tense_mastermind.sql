ALTER TABLE "calendars" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "seq" bigserial NOT NULL;
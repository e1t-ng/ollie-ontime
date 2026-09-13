CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"poll_id" text NOT NULL,
	"user_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "availability_range" CHECK ("availability_blocks"."ends_at" > "availability_blocks"."starts_at"),
	CONSTRAINT "availability_status" CHECK ("availability_blocks"."status" in ('preferred','available','maybe','unavailable'))
);
--> statement-breakpoint
CREATE TABLE "event_members" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'Invited' NOT NULL,
	CONSTRAINT "event_members_event_id_user_id_pk" PRIMARY KEY("event_id","user_id"),
	CONSTRAINT "event_members_status" CHECK ("event_members"."status" in ('Invited','Going','Maybe','Not going'))
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" text PRIMARY KEY NOT NULL,
	"user_low" text NOT NULL,
	"user_high" text NOT NULL,
	"requester_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"blocked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_order" CHECK ("friendships"."user_low" < "friendships"."user_high"),
	CONSTRAINT "friendships_status" CHECK ("friendships"."status" in ('pending','accepted','blocked'))
);
--> statement-breakpoint
CREATE TABLE "poll_members" (
	"poll_id" text NOT NULL,
	"user_id" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "poll_members_poll_id_user_id_pk" PRIMARY KEY("poll_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"time_zone" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"min_participants" integer NOT NULL,
	"windows" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "polls_status" CHECK ("polls"."status" in ('open','confirmed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_poll_id_user_id_poll_members_poll_id_user_id_fk" FOREIGN KEY ("poll_id","user_id") REFERENCES "public"."poll_members"("poll_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_members" ADD CONSTRAINT "event_members_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_low_accounts_id_fk" FOREIGN KEY ("user_low") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_high_accounts_id_fk" FOREIGN KEY ("user_high") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_accounts_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_members" ADD CONSTRAINT "poll_members_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_members" ADD CONSTRAINT "poll_members_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_email" ON "accounts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_username" ON "accounts" USING btree ("username");--> statement-breakpoint
CREATE INDEX "auth_limits_expiry" ON "auth_limits" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "availability_poll_user" ON "availability_blocks" USING btree ("poll_id","user_id");--> statement-breakpoint
CREATE INDEX "event_members_user" ON "event_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair" ON "friendships" USING btree ("user_low","user_high");--> statement-breakpoint
CREATE INDEX "friendships_high" ON "friendships" USING btree ("user_high");--> statement-breakpoint
CREATE INDEX "poll_members_user" ON "poll_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "polls_owner" ON "polls" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry" ON "sessions" USING btree ("expires_at");
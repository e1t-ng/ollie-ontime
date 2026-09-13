CREATE TABLE "calendar_shares" (
	"owner_id" text NOT NULL,
	"viewer_id" text NOT NULL,
	"sharing" text NOT NULL,
	CONSTRAINT "calendar_shares_owner_id_viewer_id_pk" PRIMARY KEY("owner_id","viewer_id"),
	CONSTRAINT "calendar_shares_sharing" CHECK ("calendar_shares"."sharing" in ('none','busy','details')),
	CONSTRAINT "calendar_shares_distinct" CHECK ("calendar_shares"."owner_id" <> "calendar_shares"."viewer_id")
);
--> statement-breakpoint
CREATE TABLE "friend_group_members" (
	"group_id" text NOT NULL,
	"member_id" text NOT NULL,
	CONSTRAINT "friend_group_members_group_id_member_id_pk" PRIMARY KEY("group_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "friend_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '1' NOT NULL,
	"sharing" text DEFAULT 'busy' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_groups_sharing" CHECK ("friend_groups"."sharing" in ('none','busy','details'))
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "default_sharing" text DEFAULT 'busy' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_owner_id_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_viewer_id_accounts_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_group_id_friend_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."friend_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_group_members" ADD CONSTRAINT "friend_group_members_member_id_accounts_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_groups" ADD CONSTRAINT "friend_groups_owner_accounts_id_fk" FOREIGN KEY ("owner") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_shares_viewer" ON "calendar_shares" USING btree ("viewer_id");--> statement-breakpoint
CREATE INDEX "friend_group_members_member" ON "friend_group_members" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_groups_owner_name" ON "friend_groups" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "friend_groups_owner" ON "friend_groups" USING btree ("owner");
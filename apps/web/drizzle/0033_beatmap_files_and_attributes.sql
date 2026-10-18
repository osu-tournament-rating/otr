-- Derived rows with no calculator version to keep; the data worker recalculates
-- them from stored files. The table is empty in production (#403).
DELETE FROM "beatmap_attributes";--> statement-breakpoint
CREATE TABLE "beatmap_files" (
	"beatmap_id" integer NOT NULL,
	"checksum" varchar(32),
	"fetch_status" integer NOT NULL,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated" timestamp with time zone,
	CONSTRAINT "pk_beatmap_files" PRIMARY KEY("beatmap_id")
);
--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "ar" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "cs" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "od" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "hp" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "calculator" varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE "beatmap_attributes" ADD COLUMN "updated" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beatmap_files" ADD CONSTRAINT "fk_beatmap_files_beatmaps_beatmap_id" FOREIGN KEY ("beatmap_id") REFERENCES "public"."beatmaps"("id") ON DELETE cascade ON UPDATE no action;
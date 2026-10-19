CREATE TABLE "user_activity_daily" (
	"day" date NOT NULL,
	"player_id" integer NOT NULL,
	CONSTRAINT "pk_user_activity_daily" PRIMARY KEY("day","player_id")
);

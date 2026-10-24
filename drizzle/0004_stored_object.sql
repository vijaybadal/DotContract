CREATE TABLE "stored_object" (
	"key" text PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TRIGGER stored_object_append_only BEFORE UPDATE OR DELETE ON stored_object FOR EACH ROW EXECUTE FUNCTION clm_block_mutation();
--> statement-breakpoint
CREATE TRIGGER stored_object_no_truncate BEFORE TRUNCATE ON stored_object FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();

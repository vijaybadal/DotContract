-- Append-only protection for records of business significance.
-- The application never updates or deletes these rows; the database enforces it.
CREATE OR REPLACE FUNCTION clm_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clm: % is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION clm_block_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_decision_append_only BEFORE UPDATE OR DELETE ON approval_decision
  FOR EACH ROW EXECUTE FUNCTION clm_block_mutation();
--> statement-breakpoint
CREATE TRIGGER signing_authority_check_append_only BEFORE UPDATE OR DELETE ON signing_authority_check
  FOR EACH ROW EXECUTE FUNCTION clm_block_mutation();
--> statement-breakpoint
CREATE TRIGGER signature_event_append_only BEFORE UPDATE OR DELETE ON signature_event
  FOR EACH ROW EXECUTE FUNCTION clm_block_mutation();
--> statement-breakpoint
-- Document versions are immutable except for scan/analysis results written after upload.
CREATE OR REPLACE FUNCTION clm_document_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clm: document versions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id <> OLD.id OR NEW.document_id <> OLD.document_id OR NEW.version_no <> OLD.version_no
     OR NEW.file_name <> OLD.file_name OR NEW.sha256 <> OLD.sha256 OR NEW.storage_key <> OLD.storage_key
     OR NEW.size_bytes <> OLD.size_bytes OR NEW.uploaded_by_id <> OLD.uploaded_by_id
     OR NEW.created_at <> OLD.created_at OR NEW.is_material_change <> OLD.is_material_change THEN
    RAISE EXCEPTION 'clm: document versions are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER document_version_guard BEFORE UPDATE OR DELETE ON document_version
  FOR EACH ROW EXECUTE FUNCTION clm_document_version_guard();
--> statement-breakpoint
-- Full-text search over the repository (PostgreSQL FTS; see docs/ARCHITECTURE.md)
CREATE INDEX contract_fts_idx ON contract USING gin (
  to_tsvector('english', number || ' ' || title || ' ' || coalesce(description, '') || ' ' || coalesce(business_purpose, ''))
);

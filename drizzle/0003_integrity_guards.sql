-- Row-level triggers do not fire on TRUNCATE; block it on every append-only table.
CREATE OR REPLACE FUNCTION clm_block_truncate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'clm: % is append-only; TRUNCATE is not permitted', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
CREATE TRIGGER approval_decision_no_truncate BEFORE TRUNCATE ON approval_decision FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
CREATE TRIGGER signing_authority_check_no_truncate BEFORE TRUNCATE ON signing_authority_check FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
CREATE TRIGGER signature_event_no_truncate BEFORE TRUNCATE ON signature_event FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
CREATE TRIGGER document_version_no_truncate BEFORE TRUNCATE ON document_version FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
CREATE TRIGGER signing_authority_no_truncate BEFORE TRUNCATE ON signing_authority FOR EACH STATEMENT EXECUTE FUNCTION clm_block_truncate();
--> statement-breakpoint
-- Signing authority records are immutable once recorded. The only permitted change is revocation
-- (revoked_at and revoked_reason set once). Corrections are made by revoking and recording a new record.
CREATE OR REPLACE FUNCTION clm_signing_authority_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'clm: signing authority records cannot be deleted; revoke instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'clm: a revoked signing authority cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.user_id, NEW.legal_entity_id, NEW.source, NEW.delegated_from_user_id, NEW.max_amount, NEW.contract_type_keys,
      NEW.effective_from, NEW.effective_to, NEW.authorizing_reference, NEW.created_by_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.legal_entity_id, OLD.source, OLD.delegated_from_user_id, OLD.max_amount, OLD.contract_type_keys,
      OLD.effective_from, OLD.effective_to, OLD.authorizing_reference, OLD.created_by_id, OLD.created_at) THEN
    RAISE EXCEPTION 'clm: signing authority terms are immutable; revoke and record a new authority' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.revoked_at IS NULL OR NEW.revoked_reason IS NULL THEN
    RAISE EXCEPTION 'clm: the only permitted change to signing authority is revocation with a reason' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER signing_authority_guard BEFORE UPDATE OR DELETE ON signing_authority FOR EACH ROW EXECUTE FUNCTION clm_signing_authority_guard();

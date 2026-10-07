-- Audit events are append-only: reject UPDATE, DELETE and TRUNCATE for every role.
-- (Production should additionally run the app as a non-owner role granted only INSERT/SELECT here; see docs/security.md.)
CREATE OR REPLACE FUNCTION audit_event_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (% rejected)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_reject_change();
--> statement-breakpoint
CREATE TRIGGER audit_event_no_truncate
  BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_reject_change();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM PUBLIC;
--> statement-breakpoint
-- Effective dating must be coherent.
ALTER TABLE user_role_assignment
  ADD CONSTRAINT ura_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from);
--> statement-breakpoint
ALTER TABLE org_unit
  ADD CONSTRAINT org_unit_path_shape CHECK (path LIKE '/%/' AND depth >= 0);
--> statement-breakpoint
-- Hot path: active assignments for a user in a tenant.
CREATE INDEX ura_active_idx ON user_role_assignment (tenant_id, user_id) WHERE revoked_at IS NULL;

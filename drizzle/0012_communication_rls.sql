-- Phase 5: row-level security, grants and integrity rules for the Communication Hub (ADR-023).
-- announcement_transition() locks the notice and re-checks its state, so a notice approved twice, or approved by its
-- own author, fails (55000 / 42501) instead of applying. Content is frozen once a notice leaves draft.

GRANT SELECT, INSERT, UPDATE ON
  announcement, announcement_attachment, announcement_receipt, announcement_bookmark, guardian_message,
  notification_outbox, user_notification
TO campusos_app;
--> statement-breakpoint
GRANT DELETE ON announcement, announcement_attachment, announcement_bookmark TO campusos_app;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'announcement', 'announcement_attachment', 'announcement_receipt', 'announcement_bookmark', 'guardian_message',
    'notification_outbox', 'user_notification'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
--> statement-breakpoint

-- draft → pending (author submits) | draft → published (author publishes directly) | pending → published / rejected
-- (someone other than the author decides) | pending → draft (author recalls) | rejected → draft (author reopens) |
-- published → withdrawn (with a reason). Who may make each move is decided by the service; this enforces the order.
CREATE OR REPLACE FUNCTION announcement_transition(
  p_id uuid,
  p_to announcement_status,
  p_by uuid,
  p_note text,
  p_at timestamptz
) RETURNS announcement_status
LANGUAGE plpgsql AS $$
DECLARE
  a announcement;
BEGIN
  SELECT * INTO a FROM announcement WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;

  IF a.status = 'draft' AND p_to IN ('pending', 'published') THEN
    IF a.author_id IS DISTINCT FROM p_by THEN
      RAISE EXCEPTION 'only the author submits a draft' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE announcement
      SET status = p_to, submitted_at = p_at, decided_by = NULL, decided_at = NULL, decision_note = NULL,
          published_at = CASE WHEN p_to = 'published' THEN p_at END, updated_at = p_at
      WHERE id = p_id;
  ELSIF a.status = 'pending' AND p_to IN ('published', 'rejected') THEN
    IF a.author_id = p_by THEN
      RAISE EXCEPTION 'nobody approves their own notice' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE announcement
      SET status = p_to, decided_by = p_by, decided_at = p_at, decision_note = p_note,
          published_at = CASE WHEN p_to = 'published' THEN p_at END, updated_at = p_at
      WHERE id = p_id;
  ELSIF a.status IN ('pending', 'rejected') AND p_to = 'draft' THEN
    IF a.author_id IS DISTINCT FROM p_by THEN
      RAISE EXCEPTION 'only the author reopens a notice' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE announcement SET status = 'draft', submitted_at = NULL, updated_at = p_at WHERE id = p_id;
  ELSIF a.status = 'published' AND p_to = 'withdrawn' THEN
    UPDATE announcement
      SET status = 'withdrawn', withdrawn_by = p_by, withdrawn_at = p_at, withdraw_reason = p_note, updated_at = p_at
      WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'announcement is %', a.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN a.status;
END
$$;
--> statement-breakpoint

-- What recipients were sent (and an approver approved) never changes afterwards.
CREATE OR REPLACE FUNCTION announcement_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only drafts can be deleted' USING ERRCODE = 'object_not_in_prerequisite_state';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.title, NEW.summary, NEW.body, NEW.category, NEW.severity, NEW.audience, NEW.audience_unit_id,
    NEW.requires_ack, NEW.send_email, NEW.deadline, NEW.expires_at
  ) IS DISTINCT FROM (
    OLD.title, OLD.summary, OLD.body, OLD.category, OLD.severity, OLD.audience, OLD.audience_unit_id,
    OLD.requires_ack, OLD.send_email, OLD.deadline, OLD.expires_at
  ) THEN
    RAISE EXCEPTION 'a % notice cannot be edited', OLD.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER announcement_freeze BEFORE UPDATE OR DELETE ON announcement
  FOR EACH ROW EXECUTE FUNCTION announcement_freeze();
--> statement-breakpoint

-- Attachments change only while their notice is a draft (deleting a draft cascades).
CREATE OR REPLACE FUNCTION announcement_attachment_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status announcement_status;
BEGIN
  SELECT status INTO v_status FROM announcement WHERE id = coalesce(NEW.announcement_id, OLD.announcement_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'attachments of a % notice cannot change', v_status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER announcement_attachment_freeze BEFORE INSERT OR UPDATE OR DELETE ON announcement_attachment
  FOR EACH ROW EXECUTE FUNCTION announcement_attachment_freeze();
--> statement-breakpoint

REVOKE ALL ON FUNCTION announcement_transition(uuid, announcement_status, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION announcement_transition(uuid, announcement_status, uuid, text, timestamptz) TO campusos_app;

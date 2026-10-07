ALTER TABLE "announcement" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
-- The schedule is part of what an approver approves: frozen with the content once a notice leaves draft.
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
    NEW.requires_ack, NEW.send_email, NEW.deadline, NEW.expires_at, NEW.scheduled_for
  ) IS DISTINCT FROM (
    OLD.title, OLD.summary, OLD.body, OLD.category, OLD.severity, OLD.audience, OLD.audience_unit_id,
    OLD.requires_ack, OLD.send_email, OLD.deadline, OLD.expires_at, OLD.scheduled_for
  ) THEN
    RAISE EXCEPTION 'a % notice cannot be edited', OLD.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- Publication time honours the schedule: approving or publishing early still publishes at the scheduled moment.
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
  v_publish timestamptz;
BEGIN
  SELECT * INTO a FROM announcement WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  v_publish := greatest(p_at, coalesce(a.scheduled_for, p_at));

  IF a.status = 'draft' AND p_to IN ('pending', 'published') THEN
    IF a.author_id IS DISTINCT FROM p_by THEN
      RAISE EXCEPTION 'only the author submits a draft' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE announcement
      SET status = p_to, submitted_at = p_at, decided_by = NULL, decided_at = NULL, decision_note = NULL,
          published_at = CASE WHEN p_to = 'published' THEN v_publish END, updated_at = p_at
      WHERE id = p_id;
  ELSIF a.status = 'pending' AND p_to IN ('published', 'rejected') THEN
    IF a.author_id = p_by THEN
      RAISE EXCEPTION 'nobody approves their own notice' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE announcement
      SET status = p_to, decided_by = p_by, decided_at = p_at, decision_note = p_note,
          published_at = CASE WHEN p_to = 'published' THEN v_publish END, updated_at = p_at
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

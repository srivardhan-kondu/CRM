-- Phase 3: row-level security, grants and transactional functions for attendance (ADR-016, ADR-019).
--
-- Saving a session and deciding a request each run as one function call inside the caller's withTenant()
-- transaction, so a decision and its effect cannot separate, and a request decided twice fails instead of being
-- applied twice. The functions are SECURITY INVOKER: they run as campusos_app, under the same RLS policies.

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE ON
  attendance_policy, holiday, timetable_slot, class_session, student_leave, attendance_request
TO campusos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON attendance_record TO campusos_app;
--> statement-breakpoint

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_policy', 'holiday', 'timetable_slot', 'class_session', 'attendance_record', 'student_leave',
    'attendance_request'
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

-- ---------- Save a session ----------
-- Records a session as held (with one mark per student) or not held, replacing whatever was recorded before.
-- Every marked student must have been on the section's roll that day (section history), so a mark can never land
-- on another section's student.
CREATE OR REPLACE FUNCTION attendance_save(
  p_offering uuid,
  p_date date,
  p_starts_at text,
  p_ends_at text,
  p_proposed jsonb,
  p_by uuid,
  p_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := nullif(current_setting('app.tenant_id', true), '')::uuid;
  v_section uuid;
  v_status session_status := (p_proposed ->> 'status')::session_status;
  v_session uuid;
  v_outsider text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no tenant in scope' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT section_id INTO v_section FROM course_offering WHERE id = p_offering;
  IF v_section IS NULL THEN
    RAISE EXCEPTION 'unknown offering %', p_offering USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status = 'cancelled' AND coalesce(p_proposed ->> 'cancelReason', '') = '' THEN
    RAISE EXCEPTION 'a session that was not held needs a reason' USING ERRCODE = 'check_violation';
  END IF;

  SELECT m.key INTO v_outsider
  FROM jsonb_object_keys(coalesce(p_proposed -> 'marks', '{}'::jsonb)) AS m(key)
  WHERE NOT EXISTS (
    SELECT 1 FROM student_section_history h
    WHERE h.student_id = m.key::uuid
      AND h.section_id = v_section
      AND h.started_on <= p_date
      AND (h.ended_on IS NULL OR h.ended_on >= p_date)
  )
  LIMIT 1;
  IF v_outsider IS NOT NULL THEN
    RAISE EXCEPTION 'student % was not on this section''s roll on %', v_outsider, p_date
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO class_session (tenant_id, offering_id, date, starts_at, ends_at, status, cancel_reason, marked_by, marked_at)
  VALUES (
    v_tenant, p_offering, p_date, p_starts_at, p_ends_at, v_status,
    CASE WHEN v_status = 'cancelled' THEN p_proposed ->> 'cancelReason' END, p_by, p_at
  )
  ON CONFLICT (offering_id, date, starts_at) DO UPDATE
    SET ends_at = excluded.ends_at,
        status = excluded.status,
        cancel_reason = excluded.cancel_reason,
        marked_by = excluded.marked_by,
        marked_at = excluded.marked_at
  RETURNING id INTO v_session;

  DELETE FROM attendance_record WHERE session_id = v_session;
  IF v_status = 'held' THEN
    INSERT INTO attendance_record (tenant_id, session_id, student_id, status)
    SELECT v_tenant, v_session, m.key::uuid, m.value::attendance_mark
    FROM jsonb_each_text(coalesce(p_proposed -> 'marks', '{}'::jsonb)) AS m(key, value);
  END IF;
  RETURN v_session;
END
$$;
--> statement-breakpoint

-- ---------- Decide an attendance request ----------
-- p_decision: 'approved' | 'rejected' (by someone other than the requester) or 'withdrawn' (by the requester).
-- Approval applies the proposed session. A request that is no longer pending raises 55000.
CREATE OR REPLACE FUNCTION attendance_request_decide(
  p_request uuid,
  p_decision request_status,
  p_by uuid,
  p_note text,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r attendance_request;
BEGIN
  SELECT * INTO r FROM attendance_request WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance request % not found', p_request USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'attendance request is already %', r.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_decision = 'withdrawn' THEN
    IF r.requested_by <> p_by THEN
      RAISE EXCEPTION 'only the requester can withdraw a request' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE attendance_request SET status = 'withdrawn', decision_note = p_note WHERE id = p_request;
    RETURN;
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE attendance_request
    SET status = p_decision, decided_by = p_by, decided_at = p_at, decision_note = p_note
    WHERE id = p_request;
  IF p_decision = 'approved' THEN
    PERFORM attendance_save(r.offering_id, r.date, r.starts_at, r.ends_at, r.proposed, r.requested_by, p_at);
  END IF;
END
$$;
--> statement-breakpoint

-- ---------- Decide a student leave ----------
CREATE OR REPLACE FUNCTION student_leave_decide(
  p_leave uuid,
  p_decision request_status,
  p_by uuid,
  p_note text,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l student_leave;
BEGIN
  SELECT * INTO l FROM student_leave WHERE id = p_leave FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'leave % not found', p_leave USING ERRCODE = 'no_data_found';
  END IF;
  IF l.status <> 'pending' THEN
    RAISE EXCEPTION 'leave is already %', l.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_decision = 'withdrawn' THEN
    IF l.requested_by IS DISTINCT FROM p_by THEN
      RAISE EXCEPTION 'only the applicant can withdraw a leave' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE student_leave SET status = 'withdrawn', decision_note = p_note WHERE id = p_leave;
    RETURN;
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE student_leave
    SET status = p_decision, decided_by = p_by, decided_at = p_at, decision_note = p_note
    WHERE id = p_leave;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION attendance_save(uuid, date, text, text, jsonb, uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION attendance_request_decide(uuid, request_status, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION student_leave_decide(uuid, request_status, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendance_save(uuid, date, text, text, jsonb, uuid, timestamptz) TO campusos_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendance_request_decide(uuid, request_status, uuid, text, timestamptz) TO campusos_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION student_leave_decide(uuid, request_status, uuid, text, timestamptz) TO campusos_app;

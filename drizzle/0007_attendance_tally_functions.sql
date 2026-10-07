-- Phase 3: maintained attendance totals (ADR-019). Screens read attendance_tally instead of aggregating every mark per
-- request. The writers that change a total — saving a session, approving leave — refresh the affected rows in the
-- same transaction, so totals are never stale.

GRANT SELECT, INSERT, DELETE ON attendance_tally TO campusos_app;
--> statement-breakpoint
ALTER TABLE attendance_tally ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON attendance_tally
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- Recomputes totals for the given students (all when null) in the given offering (all when null). Approved OD turns an
-- absence into attendance; approved medical leave excuses it; OD wins when both cover a day (rules.ts).
CREATE OR REPLACE FUNCTION attendance_tally_refresh(p_students uuid[], p_offering uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM attendance_tally t
  WHERE (p_students IS NULL OR t.student_id = ANY (p_students))
    AND (p_offering IS NULL OR t.offering_id = p_offering);

  INSERT INTO attendance_tally (tenant_id, student_id, offering_id, held, attended, od, excused)
  SELECT m.tenant_id, m.student_id, m.offering_id,
    count(*) FILTER (WHERE m.effective <> 'excused'),
    count(*) FILTER (WHERE m.effective IN ('present', 'od')),
    count(*) FILTER (WHERE m.effective = 'od'),
    count(*) FILTER (WHERE m.effective = 'excused')
  FROM (
    SELECT r.tenant_id, r.student_id, cs.offering_id,
      CASE WHEN r.status = 'present' THEN 'present' ELSE coalesce((
        SELECT CASE WHEN bool_or(l.kind = 'od') THEN 'od' ELSE 'excused' END
        FROM student_leave l
        WHERE l.student_id = r.student_id
          AND l.status = 'approved'
          AND cs.date BETWEEN l.from_date AND l.to_date
        HAVING count(*) > 0
      ), 'absent') END AS effective
    FROM attendance_record r
    JOIN class_session cs ON cs.id = r.session_id AND cs.status = 'held'
    WHERE (p_students IS NULL OR r.student_id = ANY (p_students))
      AND (p_offering IS NULL OR cs.offering_id = p_offering)
  ) m
  GROUP BY m.tenant_id, m.student_id, m.offering_id;
END
$$;
--> statement-breakpoint

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
  v_affected uuid[];
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

  -- Everyone marked before or now has a total to recompute.
  SELECT array(
    SELECT student_id FROM attendance_record WHERE session_id = v_session
    UNION
    SELECT m.key::uuid FROM jsonb_object_keys(coalesce(p_proposed -> 'marks', '{}'::jsonb)) AS m(key)
  ) INTO v_affected;

  DELETE FROM attendance_record WHERE session_id = v_session;
  IF v_status = 'held' THEN
    INSERT INTO attendance_record (tenant_id, session_id, student_id, status)
    SELECT v_tenant, v_session, m.key::uuid, m.value::attendance_mark
    FROM jsonb_each_text(coalesce(p_proposed -> 'marks', '{}'::jsonb)) AS m(key, value);
  END IF;
  PERFORM attendance_tally_refresh(v_affected, p_offering);
  RETURN v_session;
END
$$;
--> statement-breakpoint

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
  -- Only approved leave changes how attendance counts.
  IF p_decision = 'approved' THEN
    PERFORM attendance_tally_refresh(ARRAY[l.student_id], NULL);
  END IF;
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION attendance_tally_refresh(uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION attendance_tally_refresh(uuid[], uuid) TO campusos_app;
--> statement-breakpoint

-- Backfill totals for attendance recorded before this migration (runs as the owner, every tenant).
SELECT attendance_tally_refresh(NULL, NULL);

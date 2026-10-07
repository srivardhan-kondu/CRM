-- Phase 4: row-level security, grants and state-transition functions for assessment and examinations (ADR-021).
-- Each transition locks its row and re-checks state, so a component approved twice, an exam published twice or a
-- revaluation completed twice fails (SQLSTATE 55000) instead of applying twice. SECURITY INVOKER, like Phase 3's.

GRANT SELECT, INSERT, UPDATE ON
  assessment_component, assessment_mark, exam_event, exam_schedule, exam_registration, course_result, condonation,
  revaluation_request
TO campusos_app;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assessment_component', 'assessment_mark', 'exam_event', 'exam_schedule', 'exam_registration', 'course_result',
    'condonation', 'revaluation_request'
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

-- ---------- Internal assessment ----------
-- p_marks: { "<student id>": { "marks": number | null, "absent": boolean } }. Only an open component takes marks, each
-- within the component maximum, for students currently in the offering's section.
CREATE OR REPLACE FUNCTION assessment_marks_save(p_component uuid, p_marks jsonb, p_by uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c assessment_component;
  v_section uuid;
  v_bad text;
BEGIN
  SELECT * INTO c FROM assessment_component WHERE id = p_component FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'component % not found', p_component USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'component is %', c.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  SELECT section_id INTO v_section FROM course_offering WHERE id = c.offering_id;

  SELECT m.key INTO v_bad
  FROM jsonb_each(p_marks) AS m(key, value)
  WHERE NOT EXISTS (SELECT 1 FROM student s WHERE s.id = m.key::uuid AND s.section_id = v_section)
     OR (NOT coalesce((m.value ->> 'absent')::boolean, false)
         AND (m.value ->> 'marks') IS NOT NULL
         AND (m.value ->> 'marks')::numeric > c.max_marks)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'invalid marks for student %', v_bad USING ERRCODE = 'check_violation';
  END IF;

  -- A blank entry clears the student's marks.
  DELETE FROM assessment_mark am
  USING jsonb_each(p_marks) AS m(key, value)
  WHERE am.component_id = p_component AND am.student_id = m.key::uuid
    AND NOT coalesce((m.value ->> 'absent')::boolean, false) AND (m.value ->> 'marks') IS NULL;

  INSERT INTO assessment_mark (tenant_id, component_id, student_id, marks, absent, entered_by, entered_at)
  SELECT c.tenant_id, p_component, m.key::uuid,
    CASE WHEN coalesce((m.value ->> 'absent')::boolean, false) THEN NULL ELSE (m.value ->> 'marks')::numeric END,
    coalesce((m.value ->> 'absent')::boolean, false), p_by, p_at
  FROM jsonb_each(p_marks) AS m(key, value)
  WHERE coalesce((m.value ->> 'absent')::boolean, false) OR (m.value ->> 'marks') IS NOT NULL
  ON CONFLICT (component_id, student_id) DO UPDATE
    SET marks = excluded.marks, absent = excluded.absent, entered_by = excluded.entered_by, entered_at = excluded.entered_at;
END
$$;
--> statement-breakpoint

-- open → submitted (teacher; every student in the section must have an entry), submitted → approved (someone else),
-- submitted → open (returned with a note).
CREATE OR REPLACE FUNCTION assessment_component_transition(
  p_component uuid,
  p_from component_status,
  p_to component_status,
  p_by uuid,
  p_note text,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c assessment_component;
  v_missing int;
BEGIN
  SELECT * INTO c FROM assessment_component WHERE id = p_component FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'component % not found', p_component USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status <> p_from THEN
    RAISE EXCEPTION 'component is %', c.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_from = 'open' AND p_to = 'submitted' THEN
    SELECT count(*) INTO v_missing
    FROM student s
    JOIN course_offering o ON o.section_id = s.section_id AND o.id = c.offering_id
    WHERE NOT EXISTS (SELECT 1 FROM assessment_mark m WHERE m.component_id = c.id AND m.student_id = s.id);
    IF v_missing > 0 THEN
      RAISE EXCEPTION '% students have no entry', v_missing USING ERRCODE = 'check_violation';
    END IF;
    UPDATE assessment_component
      SET status = 'submitted', submitted_by = p_by, submitted_at = p_at, return_note = NULL,
          decided_by = NULL, decided_at = NULL
      WHERE id = c.id;
  ELSIF p_from = 'submitted' AND p_to IN ('approved', 'open') THEN
    IF c.submitted_by = p_by THEN
      RAISE EXCEPTION 'nobody moderates their own marks' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE assessment_component
      SET status = p_to, decided_by = p_by, decided_at = p_at,
          return_note = CASE WHEN p_to = 'open' THEN p_note END
      WHERE id = c.id;
  ELSE
    RAISE EXCEPTION 'invalid transition % → %', p_from, p_to USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$$;
--> statement-breakpoint

-- ---------- Semester-end marks ----------
-- p_marks: { "<registration id>": { "marks": number | null, "absent": boolean } } for one course of a scheduled event.
CREATE OR REPLACE FUNCTION exam_marks_save(p_event uuid, p_course uuid, p_marks jsonb, p_by uuid, p_at timestamptz)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  e exam_event;
  v_count int;
BEGIN
  SELECT * INTO e FROM exam_event WHERE id = p_event FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam % not found', p_event USING ERRCODE = 'no_data_found';
  END IF;
  IF e.status <> 'scheduled' THEN
    RAISE EXCEPTION 'exam is %', e.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exam_registration r
    SET see_absent = coalesce((m.value ->> 'absent')::boolean, false),
        see_marks = CASE WHEN coalesce((m.value ->> 'absent')::boolean, false) THEN NULL
                         ELSE (m.value ->> 'marks')::numeric END,
        entered_by = p_by,
        entered_at = p_at
  FROM jsonb_each(p_marks) AS m(key, value)
  WHERE r.id = m.key::uuid AND r.event_id = p_event AND r.course_id = p_course;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> (SELECT count(*) FROM jsonb_object_keys(p_marks)) THEN
    RAISE EXCEPTION 'some registrations are not in this exam and course' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_count;
END
$$;
--> statement-breakpoint

-- Marks an event published. The caller inserts the computed results in the same transaction.
CREATE OR REPLACE FUNCTION exam_event_publish(p_event uuid, p_by uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  e exam_event;
BEGIN
  SELECT * INTO e FROM exam_event WHERE id = p_event FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam % not found', p_event USING ERRCODE = 'no_data_found';
  END IF;
  IF e.status <> 'scheduled' THEN
    RAISE EXCEPTION 'exam is already %', e.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE exam_event SET status = 'published', published_at = p_at, published_by = p_by WHERE id = p_event;
END
$$;
--> statement-breakpoint

-- ---------- Revaluation and condonation ----------
CREATE OR REPLACE FUNCTION revaluation_complete(p_request uuid, p_revalued numeric, p_by uuid, p_at timestamptz)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  r revaluation_request;
BEGIN
  SELECT * INTO r FROM revaluation_request WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revaluation % not found', p_request USING ERRCODE = 'no_data_found';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'revaluation is already %', r.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  UPDATE revaluation_request
    SET status = 'completed', revalued_see = p_revalued, decided_by = p_by, decided_at = p_at
    WHERE id = p_request;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION condonation_decide(
  p_id uuid,
  p_decision request_status,
  p_by uuid,
  p_note text,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  c condonation;
BEGIN
  SELECT * INTO c FROM condonation WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'condonation % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
  IF c.status <> 'pending' THEN
    RAISE EXCEPTION 'condonation is already %', c.status USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE condonation SET status = p_decision, decided_by = p_by, decided_at = p_at, decision_note = p_note
    WHERE id = p_id;
END
$$;
--> statement-breakpoint

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'assessment_marks_save(uuid, jsonb, uuid, timestamptz)',
    'assessment_component_transition(uuid, component_status, component_status, uuid, text, timestamptz)',
    'exam_marks_save(uuid, uuid, jsonb, uuid, timestamptz)',
    'exam_event_publish(uuid, uuid, timestamptz)',
    'revaluation_complete(uuid, numeric, uuid, timestamptz)',
    'condonation_decide(uuid, request_status, uuid, text, timestamptz)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO campusos_app', f);
  END LOOP;
END
$$;

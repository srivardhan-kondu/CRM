-- Phase 2: integrity checks and row-level security for tenant-owned business tables (ADR-011, ADR-016).
--
-- The connection role owns these tables and has BYPASSRLS on Neon, so policies alone would not bind it. The app
-- therefore runs business queries as `campusos_app`, a NOLOGIN role with no BYPASSRLS. Each transaction starts with
-- set_config('role', 'campusos_app', true) and set_config('app.tenant_id', <tenant>, true) (src/db/tenant.ts).
-- Missing or empty app.tenant_id matches no rows. Identity and access tables stay outside RLS (ADR-011); their loaders
-- filter tenant_id explicitly.

-- ---------- Integrity ----------
ALTER TABLE academic_term ADD CONSTRAINT academic_term_dates CHECK (ends_on > starts_on);
--> statement-breakpoint
ALTER TABLE programme ADD CONSTRAINT programme_shape CHECK (duration_years BETWEEN 1 AND 6 AND semesters BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE course ADD CONSTRAINT course_hours CHECK (
  credits BETWEEN 0 AND 30 AND lecture_hours >= 0 AND tutorial_hours >= 0 AND practical_hours >= 0
);
--> statement-breakpoint
ALTER TABLE curriculum_course ADD CONSTRAINT curriculum_course_semester CHECK (semester BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE batch ADD CONSTRAINT batch_years CHECK (graduation_year > admission_year);
--> statement-breakpoint
ALTER TABLE student_section_history ADD CONSTRAINT student_section_history_dates CHECK (ended_on IS NULL OR ended_on >= started_on);
--> statement-breakpoint
CREATE UNIQUE INDEX student_section_history_open_uq ON student_section_history (student_id) WHERE ended_on IS NULL;
--> statement-breakpoint
CREATE INDEX teaching_allocation_active_idx ON teaching_allocation (tenant_id, user_id) WHERE removed_at IS NULL;
--> statement-breakpoint

-- An active regulation's course list is frozen: courses can only be added to or removed from drafts.
CREATE OR REPLACE FUNCTION curriculum_course_require_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st curriculum_status;
BEGIN
  SELECT status INTO st FROM curriculum WHERE id = COALESCE(NEW.curriculum_id, OLD.curriculum_id);
  -- A cascade from deleting the curriculum itself finds no row; allow it.
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'regulation is % — only draft regulations can change their courses', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
--> statement-breakpoint
CREATE TRIGGER curriculum_course_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON curriculum_course
  FOR EACH ROW EXECUTE FUNCTION curriculum_course_require_draft();
--> statement-breakpoint

-- ---------- Application role ----------
-- Roles are cluster-wide (shared by the app and test databases), so creation is idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campusos_app') THEN
    CREATE ROLE campusos_app NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
-- Lets the connection role switch into campusos_app for the duration of a transaction.
GRANT campusos_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO campusos_app;
--> statement-breakpoint
-- Reference data the business queries join to (read-only; identity tables expose only display columns).
GRANT SELECT ON tenant, org_unit, academic_year, role, permission, role_permission TO campusos_app;
--> statement-breakpoint
GRANT SELECT (id, name, email, image) ON app_user TO campusos_app;
--> statement-breakpoint
GRANT SELECT ON tenant_membership, user_role_assignment, user_student_link TO campusos_app;
--> statement-breakpoint
GRANT INSERT ON audit_event TO campusos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  academic_term, programme, curriculum, course, batch, section, course_offering, teaching_allocation,
  faculty_profile, student, guardian, student_section_history
TO campusos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON curriculum_course TO campusos_app;
--> statement-breakpoint

-- ---------- Row-level security ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'academic_year', 'academic_term', 'programme', 'curriculum', 'curriculum_course', 'course', 'batch', 'section',
    'course_offering', 'teaching_allocation', 'faculty_profile', 'student', 'guardian', 'student_section_history'
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

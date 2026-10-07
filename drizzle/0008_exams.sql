CREATE TYPE "public"."component_status" AS ENUM('open', 'submitted', 'approved');--> statement-breakpoint
CREATE TYPE "public"."exam_kind" AS ENUM('regular', 'supplementary');--> statement-breakpoint
CREATE TYPE "public"."exam_session" AS ENUM('FN', 'AN');--> statement-breakpoint
CREATE TYPE "public"."exam_status" AS ENUM('scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."result_outcome" AS ENUM('pass', 'fail', 'absent', 'not_eligible');--> statement-breakpoint
CREATE TYPE "public"."revaluation_status" AS ENUM('pending', 'completed', 'withdrawn');--> statement-breakpoint
CREATE TABLE "assessment_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"max_marks" integer NOT NULL,
	"position" integer NOT NULL,
	"status" "component_status" DEFAULT 'open' NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"return_note" text,
	CONSTRAINT "assessment_component_max" CHECK ("assessment_component"."max_marks" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "assessment_mark" (
	"tenant_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"marks" numeric(5, 1),
	"absent" boolean DEFAULT false NOT NULL,
	"entered_by" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_mark_component_id_student_id_pk" PRIMARY KEY("component_id","student_id"),
	CONSTRAINT "assessment_mark_value" CHECK (("assessment_mark"."absent" and "assessment_mark"."marks" is null) or (not "assessment_mark"."absent" and "assessment_mark"."marks" >= 0 and "assessment_mark"."marks" * 2 = round("assessment_mark"."marks" * 2)))
);
--> statement-breakpoint
CREATE TABLE "condonation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"attendance_pct" numeric(4, 1) NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "condonation_decision" CHECK (("condonation"."status" in ('approved', 'rejected')) = ("condonation"."decided_at" is not null)),
	CONSTRAINT "condonation_no_self_approval" CHECK ("condonation"."decided_by" is null or "condonation"."decided_by" <> "condonation"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "course_result" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"attempt" integer NOT NULL,
	"credits" integer NOT NULL,
	"cie" numeric(5, 1) NOT NULL,
	"cie_max" integer NOT NULL,
	"see" numeric(5, 1),
	"see_max" integer NOT NULL,
	"total" numeric(5, 1) NOT NULL,
	"grade" text,
	"grade_point" integer NOT NULL,
	"outcome" "result_outcome" NOT NULL,
	"original_see" numeric(5, 1),
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "course_result_grade" CHECK ("course_result"."grade" is null or "course_result"."grade" in ('O','A+','A','B+','B','C','P','F','Ab')),
	CONSTRAINT "course_result_points" CHECK ("course_result"."grade_point" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "exam_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "exam_kind" NOT NULL,
	"term_id" uuid,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" "exam_status" DEFAULT 'scheduled' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "exam_event_dates" CHECK ("exam_event"."ends_on" >= "exam_event"."starts_on"),
	CONSTRAINT "exam_event_published" CHECK (("exam_event"."status" = 'published') = ("exam_event"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "exam_registration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"cie_carried" numeric(5, 1),
	"see_max" integer NOT NULL,
	"see_marks" numeric(5, 1),
	"see_absent" boolean DEFAULT false NOT NULL,
	"entered_by" uuid,
	"entered_at" timestamp with time zone,
	CONSTRAINT "exam_registration_see" CHECK (("exam_registration"."see_absent" and "exam_registration"."see_marks" is null) or (not "exam_registration"."see_absent" and ("exam_registration"."see_marks" is null or ("exam_registration"."see_marks" between 0 and "exam_registration"."see_max" and "exam_registration"."see_marks" * 2 = round("exam_registration"."see_marks" * 2)))))
);
--> statement-breakpoint
CREATE TABLE "exam_schedule" (
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"date" date NOT NULL,
	"session" "exam_session" NOT NULL,
	CONSTRAINT "exam_schedule_event_id_course_id_pk" PRIMARY KEY("event_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "revaluation_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"status" "revaluation_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revalued_see" numeric(5, 1),
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "revaluation_completed" CHECK (("revaluation_request"."status" = 'completed') = ("revaluation_request"."revalued_see" is not null))
);
--> statement-breakpoint
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_submitted_by_app_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_component" ADD CONSTRAINT "assessment_component_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_mark" ADD CONSTRAINT "assessment_mark_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_mark" ADD CONSTRAINT "assessment_mark_component_id_assessment_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."assessment_component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_mark" ADD CONSTRAINT "assessment_mark_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_mark" ADD CONSTRAINT "assessment_mark_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condonation" ADD CONSTRAINT "condonation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condonation" ADD CONSTRAINT "condonation_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condonation" ADD CONSTRAINT "condonation_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condonation" ADD CONSTRAINT "condonation_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condonation" ADD CONSTRAINT "condonation_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result" ADD CONSTRAINT "course_result_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result" ADD CONSTRAINT "course_result_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result" ADD CONSTRAINT "course_result_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result" ADD CONSTRAINT "course_result_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_result" ADD CONSTRAINT "course_result_event_id_exam_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."exam_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_event" ADD CONSTRAINT "exam_event_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_event" ADD CONSTRAINT "exam_event_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_event" ADD CONSTRAINT "exam_event_published_by_app_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_event_id_exam_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."exam_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_registration" ADD CONSTRAINT "exam_registration_entered_by_app_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_schedule" ADD CONSTRAINT "exam_schedule_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_schedule" ADD CONSTRAINT "exam_schedule_event_id_exam_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."exam_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_schedule" ADD CONSTRAINT "exam_schedule_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluation_request" ADD CONSTRAINT "revaluation_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluation_request" ADD CONSTRAINT "revaluation_request_result_id_course_result_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."course_result"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluation_request" ADD CONSTRAINT "revaluation_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revaluation_request" ADD CONSTRAINT "revaluation_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_component_offering_key_uq" ON "assessment_component" USING btree ("offering_id","key");--> statement-breakpoint
CREATE INDEX "assessment_component_status_idx" ON "assessment_component" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "assessment_mark_student_idx" ON "assessment_mark" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "condonation_open_uq" ON "condonation" USING btree ("student_id","term_id") WHERE "condonation"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE UNIQUE INDEX "course_result_attempt_uq" ON "course_result" USING btree ("student_id","course_id","term_id","attempt");--> statement-breakpoint
CREATE INDEX "course_result_student_idx" ON "course_result" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "course_result_event_idx" ON "course_result" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_event_tenant_code_uq" ON "exam_event" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_registration_uq" ON "exam_registration" USING btree ("event_id","student_id","course_id");--> statement-breakpoint
CREATE INDEX "exam_registration_course_idx" ON "exam_registration" USING btree ("event_id","course_id");--> statement-breakpoint
CREATE INDEX "exam_registration_student_idx" ON "exam_registration" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revaluation_one_per_result_uq" ON "revaluation_request" USING btree ("result_id") WHERE "revaluation_request"."status" <> 'withdrawn';
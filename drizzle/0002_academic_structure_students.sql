CREATE TYPE "public"."course_category" AS ENUM('core', 'elective', 'lab', 'project', 'foundation');--> statement-breakpoint
CREATE TYPE "public"."course_type" AS ENUM('theory', 'lab', 'project');--> statement-breakpoint
CREATE TYPE "public"."curriculum_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."faculty_status" AS ENUM('active', 'on_leave', 'relieved');--> statement-breakpoint
CREATE TYPE "public"."offering_status" AS ENUM('planned', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."programme_level" AS ENUM('ug', 'pg', 'diploma', 'doctoral');--> statement-breakpoint
CREATE TYPE "public"."teaching_role" AS ENUM('primary', 'co_teacher', 'lab');--> statement-breakpoint
CREATE TYPE "public"."term_kind" AS ENUM('odd', 'even', 'summer');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('F', 'M', 'X');--> statement-breakpoint
CREATE TYPE "public"."guardian_relation" AS ENUM('Father', 'Mother', 'Guardian');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'on_leave', 'detained', 'graduated', 'withdrawn');--> statement-breakpoint
CREATE TABLE "academic_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" "term_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"admission_year" integer NOT NULL,
	"graduation_year" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_unit_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "course_type" NOT NULL,
	"credits" integer NOT NULL,
	"lecture_hours" integer DEFAULT 0 NOT NULL,
	"tutorial_hours" integer DEFAULT 0 NOT NULL,
	"practical_hours" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_offering" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"status" "offering_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curriculum" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"programme_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" "curriculum_status" DEFAULT 'draft' NOT NULL,
	"effective_from_year" integer NOT NULL,
	"derived_from_id" uuid,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "curriculum_id_programme_uq" UNIQUE("id","programme_id")
);
--> statement-breakpoint
CREATE TABLE "curriculum_course" (
	"tenant_id" uuid NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"semester" integer NOT NULL,
	"category" "course_category" NOT NULL,
	CONSTRAINT "curriculum_course_curriculum_id_course_id_pk" PRIMARY KEY("curriculum_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "faculty_profile" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"designation" text NOT NULL,
	"department_id" uuid NOT NULL,
	"status" "faculty_status" DEFAULT 'active' NOT NULL,
	"max_weekly_hours" integer DEFAULT 16 NOT NULL,
	"joined_on" date,
	CONSTRAINT "faculty_profile_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "programme" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" "programme_level" NOT NULL,
	"duration_years" integer NOT NULL,
	"semesters" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section" (
	"org_unit_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"letter" text NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "teaching_role" DEFAULT 'primary' NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allocated_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"remove_reason" text
);
--> statement-breakpoint
CREATE TABLE "guardian" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" "guardian_relation" NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_number" text NOT NULL,
	"name" text NOT NULL,
	"gender" "gender" NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"programme_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"admitted_on" date NOT NULL,
	"hosteller" boolean DEFAULT false NOT NULL,
	"mentor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_section_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"started_on" date NOT NULL,
	"ended_on" date,
	"reason" text NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_term" ADD CONSTRAINT "academic_term_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_term" ADD CONSTRAINT "academic_term_academic_year_id_academic_year_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_year"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_programme_id_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_curriculum_programme_fk" FOREIGN KEY ("curriculum_id","programme_id") REFERENCES "public"."curriculum"("id","programme_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_owner_unit_id_org_unit_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_term_id_academic_term_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."academic_term"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offering" ADD CONSTRAINT "course_offering_section_id_section_org_unit_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("org_unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum" ADD CONSTRAINT "curriculum_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum" ADD CONSTRAINT "curriculum_programme_id_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_course" ADD CONSTRAINT "curriculum_course_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_course" ADD CONSTRAINT "curriculum_course_curriculum_id_curriculum_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "public"."curriculum"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_course" ADD CONSTRAINT "curriculum_course_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_profile" ADD CONSTRAINT "faculty_profile_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_profile" ADD CONSTRAINT "faculty_profile_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculty_profile" ADD CONSTRAINT "faculty_profile_department_id_org_unit_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme" ADD CONSTRAINT "programme_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programme" ADD CONSTRAINT "programme_department_id_org_unit_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_org_unit_id_org_unit_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_allocation" ADD CONSTRAINT "teaching_allocation_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_allocation" ADD CONSTRAINT "teaching_allocation_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_allocation" ADD CONSTRAINT "teaching_allocation_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian" ADD CONSTRAINT "guardian_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_programme_id_programme_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."programme"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_section_id_section_org_unit_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("org_unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student" ADD CONSTRAINT "student_mentor_user_id_app_user_id_fk" FOREIGN KEY ("mentor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_section_history" ADD CONSTRAINT "student_section_history_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_section_history" ADD CONSTRAINT "student_section_history_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_section_history" ADD CONSTRAINT "student_section_history_section_id_section_org_unit_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."section"("org_unit_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "academic_term_tenant_code_uq" ON "academic_term" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_term_one_current_uq" ON "academic_term" USING btree ("tenant_id") WHERE "academic_term"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "batch_tenant_code_uq" ON "batch" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "course_tenant_code_uq" ON "course" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "course_offering_term_course_section_uq" ON "course_offering" USING btree ("term_id","course_id","section_id");--> statement-breakpoint
CREATE INDEX "course_offering_section_idx" ON "course_offering" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_programme_code_uq" ON "curriculum" USING btree ("tenant_id","programme_id","code");--> statement-breakpoint
CREATE INDEX "curriculum_course_semester_idx" ON "curriculum_course" USING btree ("curriculum_id","semester");--> statement-breakpoint
CREATE UNIQUE INDEX "faculty_profile_employee_code_uq" ON "faculty_profile" USING btree ("tenant_id","employee_code");--> statement-breakpoint
CREATE INDEX "faculty_profile_department_idx" ON "faculty_profile" USING btree ("tenant_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "programme_tenant_code_uq" ON "programme" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "section_batch_letter_uq" ON "section" USING btree ("batch_id","letter");--> statement-breakpoint
CREATE UNIQUE INDEX "teaching_allocation_active_uq" ON "teaching_allocation" USING btree ("offering_id","user_id") WHERE "teaching_allocation"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "teaching_allocation_user_idx" ON "teaching_allocation" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "guardian_student_idx" ON "guardian" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_tenant_number_uq" ON "student" USING btree ("tenant_id","student_number");--> statement-breakpoint
CREATE INDEX "student_section_idx" ON "student" USING btree ("tenant_id","section_id");--> statement-breakpoint
CREATE INDEX "student_section_history_student_idx" ON "student_section_history" USING btree ("student_id");--> statement-breakpoint
-- NOT VALID: links seeded before Phase 2 reference students the Phase 2 seed creates. New and updated rows are checked
-- immediately; existing rows are validated by a later migration once every environment has been re-seeded.
ALTER TABLE "user_student_link" ADD CONSTRAINT "user_student_link_student_fk" FOREIGN KEY ("tenant_id","student_number") REFERENCES "public"."student"("tenant_id","student_number") ON DELETE no action ON UPDATE no action NOT VALID;
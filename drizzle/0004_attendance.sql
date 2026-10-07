CREATE TYPE "public"."attendance_mark" AS ENUM('present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."attendance_request_kind" AS ENUM('correction', 'late_submission');--> statement-breakpoint
CREATE TYPE "public"."leave_kind" AS ENUM('od', 'medical');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('held', 'cancelled');--> statement-breakpoint
CREATE TABLE "attendance_policy" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"threshold_pct" integer DEFAULT 75 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "attendance_policy_threshold" CHECK ("attendance_policy"."threshold_pct" between 50 and 100)
);
--> statement-breakpoint
CREATE TABLE "attendance_record" (
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "attendance_mark" NOT NULL,
	CONSTRAINT "attendance_record_session_id_student_id_pk" PRIMARY KEY("session_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"date" date NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"kind" "attendance_request_kind" NOT NULL,
	"proposed" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "attendance_request_times" CHECK (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at > starts_at),
	CONSTRAINT "attendance_request_decision" CHECK (("attendance_request"."status" in ('approved', 'rejected')) = ("attendance_request"."decided_at" is not null)),
	CONSTRAINT "attendance_request_no_self_approval" CHECK ("attendance_request"."decided_by" is null or "attendance_request"."decided_by" <> "attendance_request"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "class_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"date" date NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"status" "session_status" NOT NULL,
	"cancel_reason" text,
	"marked_by" uuid,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_session_times" CHECK (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at > starts_at),
	CONSTRAINT "class_session_cancel_reason" CHECK (("class_session"."status" = 'cancelled') = ("class_session"."cancel_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "holiday" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "student_leave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"kind" "leave_kind" NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "student_leave_dates" CHECK ("student_leave"."to_date" >= "student_leave"."from_date"),
	CONSTRAINT "student_leave_decision" CHECK (("student_leave"."status" in ('approved', 'rejected')) = ("student_leave"."decided_at" is not null)),
	CONSTRAINT "student_leave_no_self_approval" CHECK ("student_leave"."decided_by" is null or "student_leave"."decided_by" <> "student_leave"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "timetable_slot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"room" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "timetable_slot_weekday" CHECK ("timetable_slot"."weekday" between 1 and 7),
	CONSTRAINT "timetable_slot_times" CHECK (starts_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ends_at > starts_at),
	CONSTRAINT "timetable_slot_dates" CHECK ("timetable_slot"."effective_to" is null or "timetable_slot"."effective_to" >= "timetable_slot"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "programme" ADD COLUMN "attendance_threshold_pct" integer;--> statement-breakpoint
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_session_id_class_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_record" ADD CONSTRAINT "attendance_record_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_session" ADD CONSTRAINT "class_session_marked_by_app_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday" ADD CONSTRAINT "holiday_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave" ADD CONSTRAINT "student_leave_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave" ADD CONSTRAINT "student_leave_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave" ADD CONSTRAINT "student_leave_requested_by_app_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_leave" ADD CONSTRAINT "student_leave_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_slot" ADD CONSTRAINT "timetable_slot_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_record_student_idx" ON "attendance_record" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_request_one_pending_uq" ON "attendance_request" USING btree ("offering_id","date","starts_at") WHERE "attendance_request"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_request_tenant_status_idx" ON "attendance_request" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "class_session_offering_slot_uq" ON "class_session" USING btree ("offering_id","date","starts_at");--> statement-breakpoint
CREATE INDEX "class_session_tenant_date_idx" ON "class_session" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_tenant_date_uq" ON "holiday" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "student_leave_student_idx" ON "student_leave" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "student_leave_pending_idx" ON "student_leave" USING btree ("tenant_id") WHERE "student_leave"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "timetable_slot_offering_uq" ON "timetable_slot" USING btree ("offering_id","weekday","starts_at","effective_from");--> statement-breakpoint
CREATE INDEX "timetable_slot_tenant_weekday_idx" ON "timetable_slot" USING btree ("tenant_id","weekday");--> statement-breakpoint
ALTER TABLE "programme" ADD CONSTRAINT "programme_attendance_threshold" CHECK ("programme"."attendance_threshold_pct" is null or "programme"."attendance_threshold_pct" between 50 and 100);
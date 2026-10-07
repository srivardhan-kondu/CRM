CREATE TYPE "public"."announcement_category" AS ENUM('academic', 'examinations', 'results', 'placement', 'internships', 'scholarships', 'administrative', 'events', 'compliance', 'emergency', 'general');--> statement-breakpoint
CREATE TYPE "public"."announcement_severity" AS ENUM('critical', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'pending', 'published', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."message_template" AS ENUM('attendance_shortage', 'exam_eligibility', 'meeting', 'general');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."outbox_source" AS ENUM('announcement', 'reminder', 'guardian_message');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('queued', 'held', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."recipient_kind" AS ENUM('student', 'guardian', 'staff');--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seed_key" text,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"category" "announcement_category" NOT NULL,
	"severity" "announcement_severity" NOT NULL,
	"audience" jsonb NOT NULL,
	"audience_label" text NOT NULL,
	"audience_unit_id" uuid NOT NULL,
	"requires_ack" boolean DEFAULT false NOT NULL,
	"send_email" boolean DEFAULT false NOT NULL,
	"deadline" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"cta_label" text,
	"cta_phase" integer,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"author_id" uuid,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"withdrawn_by" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdraw_reason" text,
	"reminded_at" timestamp with time zone,
	CONSTRAINT "announcement_published" CHECK (("announcement"."status" in ('published', 'withdrawn')) = ("announcement"."published_at" is not null)),
	CONSTRAINT "announcement_no_self_approval" CHECK ("announcement"."decided_by" is null or "announcement"."decided_by" <> "announcement"."author_id"),
	CONSTRAINT "announcement_expiry" CHECK ("announcement"."expires_at" is null or "announcement"."published_at" is null or "announcement"."expires_at" > "announcement"."published_at")
);
--> statement-breakpoint
CREATE TABLE "announcement_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content_base64" text NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_attachment_size" CHECK ("announcement_attachment"."size_bytes" between 1 and 2097152)
);
--> statement-breakpoint
CREATE TABLE "announcement_bookmark" (
	"tenant_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_bookmark_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcement_receipt" (
	"tenant_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"recipient_key" text NOT NULL,
	"kind" "recipient_kind" NOT NULL,
	"student_id" uuid,
	"user_id" uuid,
	"delivered_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "announcement_receipt_announcement_id_recipient_key_pk" PRIMARY KEY("announcement_id","recipient_key"),
	CONSTRAINT "announcement_receipt_recipient" CHECK (("announcement_receipt"."kind" = 'staff' and "announcement_receipt"."user_id" is not null) or ("announcement_receipt"."kind" <> 'staff' and "announcement_receipt"."student_id" is not null)),
	CONSTRAINT "announcement_receipt_ack" CHECK ("announcement_receipt"."acknowledged_at" is null or "announcement_receipt"."read_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "guardian_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"template" "message_template" NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_name" text NOT NULL,
	"sender_role" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"reply" text,
	CONSTRAINT "guardian_message_ack" CHECK (("guardian_message"."acknowledged_at" is null) = ("guardian_message"."acknowledged_by" is null) and ("guardian_message"."reply" is null or "guardian_message"."acknowledged_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'email' NOT NULL,
	"recipient_kind" "recipient_kind" NOT NULL,
	"student_id" uuid,
	"user_id" uuid,
	"to_name" text NOT NULL,
	"to_address" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"source_type" "outbox_source" NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "outbox_status" NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"transport" text,
	CONSTRAINT "notification_outbox_address" CHECK ("notification_outbox"."status" = 'suppressed' or "notification_outbox"."to_address" is not null),
	CONSTRAINT "notification_outbox_sent" CHECK (("notification_outbox"."status" = 'sent') = ("notification_outbox"."sent_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "user_notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_audience_unit_id_org_unit_id_fk" FOREIGN KEY ("audience_unit_id") REFERENCES "public"."org_unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_app_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_decided_by_app_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_withdrawn_by_app_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_attachment" ADD CONSTRAINT "announcement_attachment_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_attachment" ADD CONSTRAINT "announcement_attachment_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_attachment" ADD CONSTRAINT "announcement_attachment_uploaded_by_app_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_bookmark" ADD CONSTRAINT "announcement_bookmark_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_bookmark" ADD CONSTRAINT "announcement_bookmark_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_bookmark" ADD CONSTRAINT "announcement_bookmark_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipt" ADD CONSTRAINT "announcement_receipt_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipt" ADD CONSTRAINT "announcement_receipt_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipt" ADD CONSTRAINT "announcement_receipt_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_receipt" ADD CONSTRAINT "announcement_receipt_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_message" ADD CONSTRAINT "guardian_message_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_message" ADD CONSTRAINT "guardian_message_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_message" ADD CONSTRAINT "guardian_message_sender_id_app_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardian_message" ADD CONSTRAINT "guardian_message_acknowledged_by_app_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification" ADD CONSTRAINT "user_notification_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_seed_key_uq" ON "announcement" USING btree ("tenant_id","seed_key");--> statement-breakpoint
CREATE INDEX "announcement_status_idx" ON "announcement" USING btree ("tenant_id","status","published_at");--> statement-breakpoint
CREATE INDEX "announcement_author_idx" ON "announcement" USING btree ("tenant_id","author_id");--> statement-breakpoint
CREATE INDEX "announcement_attachment_announcement_idx" ON "announcement_attachment" USING btree ("announcement_id");--> statement-breakpoint
CREATE INDEX "announcement_receipt_student_idx" ON "announcement_receipt" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "announcement_receipt_user_idx" ON "announcement_receipt" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "guardian_message_student_idx" ON "guardian_message" USING btree ("tenant_id","student_id","sent_at");--> statement-breakpoint
CREATE INDEX "guardian_message_sender_idx" ON "guardian_message" USING btree ("tenant_id","sender_id");--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("tenant_id","status","not_before");--> statement-breakpoint
CREATE INDEX "notification_outbox_source_idx" ON "notification_outbox" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "user_notification_user_idx" ON "user_notification" USING btree ("tenant_id","user_id","created_at");
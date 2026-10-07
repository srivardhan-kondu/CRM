CREATE TABLE "attendance_tally" (
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"offering_id" uuid NOT NULL,
	"held" integer NOT NULL,
	"attended" integer NOT NULL,
	"od" integer NOT NULL,
	"excused" integer NOT NULL,
	CONSTRAINT "attendance_tally_student_id_offering_id_pk" PRIMARY KEY("student_id","offering_id")
);
--> statement-breakpoint
ALTER TABLE "attendance_tally" ADD CONSTRAINT "attendance_tally_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_tally" ADD CONSTRAINT "attendance_tally_student_id_student_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."student"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_tally" ADD CONSTRAINT "attendance_tally_offering_id_course_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."course_offering"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_tally_tenant_student_idx" ON "attendance_tally" USING btree ("tenant_id","student_id");
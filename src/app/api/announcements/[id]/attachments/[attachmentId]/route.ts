import { NextResponse } from "next/server";
import { attachmentFor } from "@/domains/announcements/repository";
import { safeFileName } from "@/domains/announcements/rules";
import { recordAuditInBackground } from "@/lib/audit/record";
import { currentAuth } from "@/lib/authz/context";

/**
 * Permission-checked attachment download. There is no public URL: every request re-authenticates and re-checks that
 * the notice is visible to (or managed by) the caller. Unknown and out-of-audience files are the same 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const authed = await currentAuth();
  if (!authed) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { id, attachmentId } = await params;
  const file = await attachmentFor(authed, id, attachmentId);
  recordAuditInBackground({
    tenantId: authed.ctx.tenantId,
    actorUserId: authed.ctx.userId,
    actorEmail: authed.ctx.email,
    action: "announcement.attachment_download",
    resourceType: "announcement_attachment",
    resourceId: attachmentId,
    outcome: file ? "success" : "denied",
    reason: file ? undefined : "not visible to the user",
    metadata: { announcement: id },
  });
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = safeFileName(file.fileName);
  return new NextResponse(Buffer.from(file.contentBase64, "base64"), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.sizeBytes),
      // Always a download, never rendered in the app's origin.
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      ETag: `"${file.sha256}"`,
    },
  });
}

/**
 * A minimal, valid one-page PDF with a title and a few lines of text — SYNTHETIC attachments for seeded notices.
 * Text is limited to printable ASCII (the built-in Helvetica font has no other glyphs).
 */
export function syntheticPdf(title: string, lines: readonly string[]): Uint8Array {
  const ascii = (s: string) =>
    s
      .replace(/[–—]/g, "-")
      .replace(/[·•]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/₹/g, "Rs. ")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[\\()]/g, (m) => `\\${m}`);
  const text = [
    "BT",
    "/F1 16 Tf",
    "56 780 Td",
    `(${ascii(title)}) Tj`,
    "/F1 10 Tf",
    "0 -20 Td",
    "(SYNTHETIC DEMO DOCUMENT - CampusOS) Tj",
    "/F1 11 Tf",
    ...lines.flatMap((l) => ["0 -22 Td", `(${ascii(l)}) Tj`]),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

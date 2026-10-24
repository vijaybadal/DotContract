/** Generates small but valid .docx and .pdf files for demo data and tests. */
import JSZip from "jszip";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type TrackedChange = { after: string; insert?: string; remove?: string; author?: string };

/** Builds a .docx; `tracked` adds Word tracked insertions/deletions after the given paragraph text. */
export async function makeDocx(title: string, paragraphs: string[], tracked: TrackedChange[] = []): Promise<Buffer> {
  const date = "2026-01-01T00:00:00Z";
  let id = 1;
  const para = (text: string, bold = false) =>
    `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
  const body: string[] = [para(title, true)];
  const run = (t: string) => `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  for (const p of paragraphs) {
    const changes = tracked.filter((x) => x.after === p);
    const inline = changes.find((t) => t.remove && p.includes(t.remove));
    if (inline) {
      // Replace text inside the paragraph: before + <w:del>removed</w:del><w:ins>inserted</w:ins> + after
      const author = esc(inline.author ?? "Legal Reviewer");
      const [before, after] = [p.slice(0, p.indexOf(inline.remove!)), p.slice(p.indexOf(inline.remove!) + inline.remove!.length)];
      body.push(
        `<w:p>${run(before)}<w:del w:id="${id++}" w:author="${author}" w:date="${date}"><w:r><w:delText xml:space="preserve">${esc(inline.remove!)}</w:delText></w:r></w:del>` +
          (inline.insert ? `<w:ins w:id="${id++}" w:author="${author}" w:date="${date}">${run(inline.insert)}</w:ins>` : "") +
          `${run(after)}</w:p>`,
      );
    } else body.push(para(p));
    for (const t of changes.filter((x) => x !== inline)) {
      const author = esc(t.author ?? "Legal Reviewer");
      // A new paragraph inserted after p
      body.push(`<w:p><w:ins w:id="${id++}" w:author="${author}" w:date="${date}">${run(t.insert ?? "")}</w:ins></w:p>`);
    }
  }
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Minimal single-page PDF with Helvetica text lines. */
export function makePdf(lines: string[]): Buffer {
  const text = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 14 : 10} Tf 56 ${760 - i * 18} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`)
    .join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "binary");
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const STANDARD_TERMS = [
  "1. Term. This Agreement begins on the Effective Date and continues for the Initial Term stated in the Order Form.",
  "2. Fees. Customer will pay the fees stated in the Order Form within thirty (30) days of receipt of a correct invoice.",
  "3. Data. Customer retains all right, title and interest in Customer Data. Vendor may use Customer Data only to provide the Services.",
  "4. Security. Vendor will maintain administrative, physical and technical safeguards appropriate to the sensitivity of Customer Data.",
  "5. Renewal. This Agreement renews automatically for successive one-year terms unless either party gives notice of non-renewal.",
  "6. Termination. Either party may terminate for material breach not cured within thirty (30) days of written notice.",
  "7. Governing Law. This Agreement is governed by the laws of the State of Nebraska.",
];

import { api } from "@/lib/api";
import { NotFoundError } from "@/lib/errors";
import { REPORTS, toCsv } from "@/lib/reports";
import { todayIn } from "@/lib/dates";

export const GET = api<{ key: string }>(async (_req, actor, { key }) => {
  const r = REPORTS.find((x) => x.key === key);
  if (!r) throw new NotFoundError("Report");
  const csv = toCsv(await r.build(actor));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="clm-${key}-${todayIn()}.csv"`, "Cache-Control": "private, no-store" } });
});

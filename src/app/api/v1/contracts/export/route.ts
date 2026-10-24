import { api } from "@/lib/api";
import { contractInventory, toCsv } from "@/lib/reports";
import { filtersFrom } from "@/lib/contract-filters";
import { todayIn } from "@/lib/dates";

export const GET = api(async (req, actor) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const csv = toCsv(await contractInventory(actor, filtersFrom(sp)));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="contracts-${todayIn()}.csv"`, "Cache-Control": "private, no-store" } });
});

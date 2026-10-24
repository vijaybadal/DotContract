"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";

type Detail = { field?: string; code?: string; message: string };

export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; details?: Detail[] } | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, success: string | ((data: T) => string), after?: (data: T) => void) {
    setResult(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setResult({ ok: true, message: typeof success === "function" ? success(r.data as T) : success });
        after?.(r.data as T);
        router.refresh();
      } else {
        const d = r.details as unknown;
        let details: Detail[] | undefined;
        if (Array.isArray(d)) details = d as Detail[];
        else if (d && typeof d === "object" && "reasons" in d) details = (d as { reasons: Detail[] }).reasons;
        setResult({ ok: false, message: r.error, details });
        router.refresh(); // failed attempts can still change server state (e.g. a recorded authority check)
      }
    });
  }
  return { pending, result, run, setResult };
}

export function ActionMessage({ result }: { result: ReturnType<typeof useAction>["result"] }) {
  if (!result) return null;
  return (
    <div role={result.ok ? "status" : "alert"} className={`mt-3 rounded-md border-l-4 px-3 py-2 text-sm ${result.ok ? "border-green bg-green-wash" : "border-red bg-red-wash"}`}>
      <p className="font-semibold">{result.message}</p>
      {result.details && result.details.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-ink-soft">
          {result.details.map((d, i) => <li key={i}>{d.message}</li>)}
        </ul>
      )}
    </div>
  );
}

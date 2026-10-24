import type { Metadata } from "next";
import { requireActor } from "@/lib/auth/session";
import { compareVersions } from "@/lib/documents";
import { getContractDetail } from "@/lib/contracts";
import { Notice, PageHeader, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Compare versions" };
export const dynamic = "force-dynamic";

export default async function ComparePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const { id } = await params;
  const { from, to } = await searchParams;
  const actor = await requireActor();
  const { contract } = await getContractDetail(actor, id);
  const result = from && to ? await compareVersions(actor, from, to) : null;
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/contracts", label: "Contracts" }, { href: `/contracts/${id}?tab=documents`, label: contract.number }]}
        title="Compare versions"
        lede={result?.supported ? `${result.from.document}: v${result.from.versionNo} → v${result.to.versionNo}. ${result.added} words added, ${result.removed} removed.` : undefined}
      />
      {!result || !result.supported ? (
        <Notice tone="amber" title="These versions can't be compared as text">{result && !result.supported ? result.reason : "Choose two versions from the Documents tab."}</Notice>
      ) : (
        <Panel>
          <p className="mb-4 text-[0.8rem] text-muted">Word-level comparison of the text as if all tracked changes were accepted. Formatting changes are not shown; open the .docx in Word for the full redline.</p>
          <div className="prose-diff max-w-[75ch] whitespace-pre-wrap font-serif text-[0.95rem] leading-7">
            {result.parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}
          </div>
        </Panel>
      )}
    </>
  );
}

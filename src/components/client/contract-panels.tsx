"use client";
import { useRef, useState } from "react";
import * as A from "@/app/actions";
import { ActionMessage, useAction } from "./use-action";
import { btn } from "@/components/ui";

type Person = { id: string; name: string; title?: string | null };

export function TaskDecisionForm({ taskId, compact }: { taskId: string; compact?: boolean }) {
  const { pending, result, run } = useAction();
  const [comment, setComment] = useState("");
  const decide = (d: "APPROVE" | "RETURN" | "REJECT") =>
    run(() => A.decideTask(taskId, d, comment), d === "APPROVE" ? "Approved. The next step has been notified." : d === "RETURN" ? "Returned to the requester." : "Request rejected.");
  return (
    <div>
      <label className="field">
        <span>Comment <small>(required to return or reject)</small></span>
        <textarea className="input" rows={compact ? 2 : 3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btn.primary} disabled={pending} onClick={() => decide("APPROVE")}>Approve</button>
        <button className={btn.secondary} disabled={pending} onClick={() => decide("RETURN")}>Return for changes</button>
        <button className={btn.danger} disabled={pending} onClick={() => decide("REJECT")}>Reject</button>
      </div>
      <ActionMessage result={result} />
    </div>
  );
}

export function LegalTaskActions({ taskId, legalStatus }: { taskId: string; legalStatus: string }) {
  const { pending, result, run } = useAction();
  const [comment, setComment] = useState("");
  const act = (a: "START" | "NEGOTIATE" | "REQUEST_CHANGES" | "CLEAR", msg: string) => run(() => A.legalAction(taskId, a, comment), msg);
  return (
    <div>
      <label className="field">
        <span>Legal comment <small>(required to request changes)</small></span>
        <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        {legalStatus === "PENDING_REVIEW" && <button className={btn.secondary} disabled={pending} onClick={() => act("START", "Review started.")}>Start review</button>}
        {legalStatus !== "UNDER_NEGOTIATION" && <button className={btn.secondary} disabled={pending} onClick={() => act("NEGOTIATE", "Marked as under negotiation.")}>Mark under negotiation</button>}
        <button className={btn.secondary} disabled={pending} onClick={() => act("REQUEST_CHANGES", "Returned to the requester with Legal's changes.")}>Request changes</button>
        <button className={btn.primary} disabled={pending} onClick={() => act("CLEAR", "Cleared by Legal. Approval continues.")}>Clear agreement</button>
      </div>
      <p className="mt-2 text-[0.8rem] text-muted">Clearing records the exact agreement version you reviewed. Any later change to it requires Legal to clear again.</p>
      <ActionMessage result={result} />
    </div>
  );
}

export function LegalIssueForm({ contractId }: { contractId: string }) {
  const { pending, result, run } = useAction();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(
          () => A.addLegalIssue(contractId, { title: String(f.get("title")), clauseRef: String(f.get("clauseRef") || ""), detail: String(f.get("detail") || ""), severity: f.get("severity") as "LOW" }),
          "Issue logged.",
          () => ref.current?.reset(),
        );
      }}
    >
      <label className="field sm:col-span-2"><span>Issue</span><input name="title" className="input" required /></label>
      <label className="field"><span>Clause</span><input name="clauseRef" className="input" placeholder="§6.2" /></label>
      <label className="field"><span>Severity</span>
        <select name="severity" className="input" defaultValue="MODERATE"><option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option></select>
      </label>
      <label className="field sm:col-span-3"><span>Detail and recommended position</span><input name="detail" className="input" /></label>
      <div className="flex items-end"><button className={btn.secondary} disabled={pending}>Log issue</button></div>
      <div className="sm:col-span-4"><ActionMessage result={result} /></div>
    </form>
  );
}

export function ResolveIssue({ issueId }: { issueId: string }) {
  const { pending, result, run } = useAction();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) return <button className={btn.quiet} onClick={() => setOpen(true)}>Resolve</button>;
  return (
    <div className="mt-2 grid gap-2">
      <input className="input" placeholder="How was it resolved?" value={text} onChange={(e) => setText(e.target.value)} aria-label="Resolution" />
      <div className="flex gap-2">
        <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.resolveLegalIssue(issueId, "RESOLVED", text), "Issue resolved.")}>Resolved</button>
        <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.resolveLegalIssue(issueId, "ACCEPTED_RISK", text), "Risk accepted.")}>Accept risk</button>
      </div>
      <ActionMessage result={result} />
    </div>
  );
}

const KINDS: [string, string][] = [
  ["AGREEMENT", "Agreement (primary contract document)"],
  ["REDLINE", "Redline / markup"],
  ["SOW", "Statement of work"],
  ["EXHIBIT", "Exhibit or attachment"],
  ["QUOTE", "Quote or pricing"],
  ["SUPPORTING", "Supporting document"],
];

export function UploadForm({ contractId, documents, hasAgreement }: { contractId: string; documents: { id: string; title: string; kind: string }[]; hasAgreement: boolean }) {
  const { pending, result, run } = useAction();
  const [target, setTarget] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  const targetDoc = documents.find((d) => d.id === target);
  return (
    <form
      ref={ref}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        f.set("contractId", contractId);
        run(
          () => A.uploadDocumentAction(f),
          (d) => {
            const x = d as { versionNo: number; scan: string; trackedChanges: boolean | null; reopened: number };
            return `Uploaded as version ${x.versionNo}. ${x.scan === "CLEAN" ? "Malware scan passed." : "File quarantined by the malware scan."}${x.trackedChanges ? " Contains Word tracked changes." : ""}${x.reopened ? ` ${x.reopened} approval step(s) re-opened for re-approval.` : ""}`;
          },
          () => {
            ref.current?.reset();
            setTarget("");
          },
        );
      }}
    >
      <label className="field">
        <span>Add as</span>
        <select className="input" name="documentId" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">A new document</option>
          {documents.filter((d) => !["EXECUTED", "SIGNATURE_CERTIFICATE"].includes(d.kind)).map((d) => <option key={d.id} value={d.id}>New version of “{d.title}”</option>)}
        </select>
      </label>
      {!target && (
        <label className="field">
          <span>Document type</span>
          <select className="input" name="kind" defaultValue={hasAgreement ? "SUPPORTING" : "AGREEMENT"}>
            {KINDS.filter(([k]) => !(k === "AGREEMENT" && hasAgreement)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      )}
      {!target && <label className="field"><span>Title</span><input className="input" name="title" placeholder="Defaults to the file name" /></label>}
      <label className="field"><span>File <small>PDF, Word, Excel, text or image · up to 25 MB</small></span><input className="input" type="file" name="file" required /></label>
      <label className="field sm:col-span-2"><span>Version note</span><input className="input" name="note" placeholder="e.g. County redline sent to vendor" /></label>
      <div className="flex flex-wrap gap-5 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="confidential" /> Confidential (owner, administrators and Legal only)</label>
        {targetDoc?.kind === "AGREEMENT" && (
          <label className="flex items-center gap-2"><input type="checkbox" name="material" /> Material change — re-open Legal and final approval</label>
        )}
      </div>
      <div className="sm:col-span-2"><button className={btn.primary} disabled={pending}>{pending ? "Uploading…" : "Upload"}</button></div>
      <div className="sm:col-span-2"><ActionMessage result={result} /></div>
    </form>
  );
}

export function SendSignatureForm({
  contractId,
  authorized,
  everyone,
  vendorSigners,
}: {
  contractId: string;
  authorized: { userId: string; name: string; title: string | null; reference: string }[];
  everyone: Person[];
  vendorSigners: { name: string; email: string | null }[];
}) {
  const { pending, result, run } = useAction();
  const [signer, setSigner] = useState(authorized[0]?.userId ?? "");
  const vs = vendorSigners.find((v) => v.email);
  const [vName, setVName] = useState(vs?.name ?? "");
  const [vEmail, setVEmail] = useState(vs?.email ?? "");
  const others = everyone.filter((p) => !authorized.some((a) => a.userId === p.id));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="field sm:col-span-2">
        <span>Agency signatory</span>
        <select className="input" value={signer} onChange={(e) => setSigner(e.target.value)}>
          <optgroup label="Holds valid authority for this contract">
            {authorized.map((a) => <option key={a.userId} value={a.userId}>{a.name} — {a.title} ({a.reference})</option>)}
          </optgroup>
          <optgroup label="Other people (authority will be checked)">
            {others.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ""}</option>)}
          </optgroup>
        </select>
      </label>
      <label className="field"><span>Vendor signer name</span><input className="input" value={vName} onChange={(e) => setVName(e.target.value)} /></label>
      <label className="field"><span>Vendor signer email</span><input className="input" type="email" value={vEmail} onChange={(e) => setVEmail(e.target.value)} /></label>
      <div className="sm:col-span-2">
        <button
          className={btn.primary}
          disabled={pending || !signer}
          onClick={() => run(() => A.sendForSignature(contractId, { signerUserId: signer, vendorSignerName: vName || undefined, vendorSignerEmail: vEmail || undefined }), "Signature request sent. The vendor signs first, then the agency signatory.")}
        >
          Verify authority and send for signature
        </button>
        <ActionMessage result={result} />
      </div>
    </div>
  );
}

export function SignatureRequestActions({ requestId, isMock }: { requestId: string; isMock: boolean }) {
  const { pending, result, run } = useAction();
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      {isMock && (
        <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.simulateSigning(requestId), (d) => ((d as { executed: boolean }).executed ? "All parties signed (demo). Contract is now active." : "Signer completed (demo). Waiting on the next signer."))}>
          Simulate next signature (demo)
        </button>
      )}
      <input className="input max-w-xs" placeholder="Reason to void" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason to void" />
      <button className={btn.danger} disabled={pending} onClick={() => run(() => A.voidSignature(requestId, reason), "Signature request voided.")}>Void request</button>
      <div className="w-full"><ActionMessage result={result} /></div>
    </div>
  );
}

export function ExternalExecutionForm({ contractId, signers }: { contractId: string; signers: Person[] }) {
  const { pending, result, run } = useAction();
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        f.set("contractId", contractId);
        run(() => A.recordExternalExecution(f), "Executed agreement recorded. The contract is active and renewal tracking has started.");
      }}
    >
      <label className="field"><span>Signed by (agency)</span>
        <select className="input" name="signerUserId" required>{signers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.title ? ` — ${s.title}` : ""}</option>)}</select>
      </label>
      <label className="field"><span>Date signed</span><input className="input" type="date" name="signedOn" required /></label>
      <label className="field"><span>Vendor signer</span><input className="input" name="vendorSignerName" /></label>
      <label className="field"><span>Fully executed copy</span><input className="input" type="file" name="file" required /></label>
      <div className="sm:col-span-2"><button className={btn.secondary} disabled={pending}>Record executed agreement</button><ActionMessage result={result} /></div>
    </form>
  );
}

export function RenewalDecisionForm({ renewalId, current }: { renewalId: string; current: string }) {
  const { pending, result, run } = useAction();
  const [decision, setDecision] = useState(current === "PENDING" ? "RENEW" : current);
  const [note, setNote] = useState("");
  return (
    <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
      <label className="field"><span>Decision</span>
        <select className="input" value={decision} onChange={(e) => setDecision(e.target.value)}>
          {["RENEW", "RENEGOTIATE", "EXTEND", "REPLACE", "CONSOLIDATE", "TERMINATE"].map((d) => <option key={d} value={d}>{d[0] + d.slice(1).toLowerCase()}</option>)}
        </select>
      </label>
      <label className="field"><span>Rationale</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pricing, utilization, alternatives considered" /></label>
      <button className={btn.primary} disabled={pending} onClick={() => run(() => A.decideRenewalAction(renewalId, decision as "RENEW", note), "Renewal decision recorded.")}>Record decision</button>
      <div className="sm:col-span-3"><ActionMessage result={result} /></div>
    </div>
  );
}

export function ReassignForm({ taskId, people }: { taskId: string; people: Person[] }) {
  const { pending, result, run } = useAction();
  const [to, setTo] = useState(people[0]?.id ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <select className="input max-w-56" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Reassign to">
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className="input max-w-56" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for reassignment" />
      <button className={btn.secondary} disabled={pending || !to} onClick={() => run(() => A.reassignTask(taskId, to, reason), "Task reassigned.")}>Reassign</button>
      <div className="w-full"><ActionMessage result={result} /></div>
    </div>
  );
}

export function AdHocForm({ instanceId, people }: { instanceId: string; people: Person[] }) {
  const { pending, result, run } = useAction();
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="field"><span>Add an approver to the current stage</span>
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose a person</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` — ${p.title}` : ""}</option>)}
        </select>
      </label>
      <label className="field"><span>Step name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Records retention review" /></label>
      <button className={btn.secondary} disabled={pending || !who} onClick={() => run(() => A.addAdHocApprover(instanceId, who, name), "Approver added.")}>Add approver</button>
      <div className="w-full"><ActionMessage result={result} /></div>
    </div>
  );
}

export function AmendTermsForm({ contractId, totalValue, expirationDate }: { contractId: string; totalValue: string; expirationDate: string | null }) {
  const { pending, result, run } = useAction();
  const [value, setValue] = useState(totalValue);
  const [exp, setExp] = useState(expirationDate ?? "");
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end">
      <label className="field"><span>Total value</span><input className="input" type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></label>
      <label className="field"><span>Expiration</span><input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
      <label className="field"><span>Reason for the change</span><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.amendTerms(contractId, { totalValue: Number(value), expirationDate: exp || undefined }, reason), (d) => `Terms updated. ${(d as { reopened: number }).reopened} step(s) re-opened for re-approval.`)}>
        Change terms
      </button>
      <div className="sm:col-span-4"><ActionMessage result={result} /></div>
    </div>
  );
}

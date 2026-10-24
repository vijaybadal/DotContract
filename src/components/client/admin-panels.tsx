"use client";
import { useState } from "react";
import * as A from "@/app/actions";
import { ActionMessage, useAction } from "./use-action";
import { btn, cx } from "@/components/ui";

export function RunJobsButton() {
  const { pending, result, run } = useAction();
  return (
    <div className="flex flex-col items-end">
      <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.runJobsNow(), (d) => {
        const x = d as { renewals: { reminders: number; expired: number; autoRolled: number }; tasks: { reminded: number; escalated: number }; email: { sent: number; failed: number } };
        return `Ran scheduled jobs: ${x.renewals.reminders} renewal reminders, ${x.tasks.reminded} task reminders, ${x.tasks.escalated} escalations, ${x.email.sent} emails sent.`;
      })}>
        {pending ? "Running…" : "Run reminders now"}
      </button>
      <ActionMessage result={result} />
    </div>
  );
}

export function MarkAllReadButton() {
  const { pending, run } = useAction();
  return <button className={btn.secondary} disabled={pending} onClick={() => run(() => A.markAllNotificationsRead(), "All marked as read.")}>Mark all as read</button>;
}

type Opt = { id: string; name: string };

export function AuthorityForm({ users, entities, types }: { users: Opt[]; entities: Opt[]; types: { key: string; name: string }[] }) {
  const { pending, result, run } = useAction();
  const [source, setSource] = useState<"DIRECT" | "DELEGATED">("DIRECT");
  const [selTypes, setSelTypes] = useState<string[]>([]);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const max = String(f.get("maxAmount") || "");
        run(
          () =>
            A.createAuthority({
              userId: String(f.get("userId")),
              legalEntityId: String(f.get("legalEntityId")),
              source,
              delegatedFromUserId: source === "DELEGATED" ? String(f.get("delegatedFromUserId")) : null,
              maxAmount: max ? Number(max) : null,
              contractTypeKeys: selTypes,
              effectiveFrom: String(f.get("effectiveFrom")),
              effectiveTo: String(f.get("effectiveTo") || "") || null,
              authorizingReference: String(f.get("authorizingReference")),
              authorizingNote: String(f.get("authorizingNote") || "") || null,
            }),
          "Signing authority recorded.",
        );
      }}
    >
      <label className="field"><span>Signatory</span><select name="userId" className="input" required>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="field"><span>For legal entity</span><select name="legalEntityId" className="input" required>{entities.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
      <label className="field"><span>Basis</span>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value as "DIRECT")}><option value="DIRECT">Granted directly (ordinance, resolution, statute)</option><option value="DELEGATED">Delegated by another signatory</option></select>
      </label>
      {source === "DELEGATED" && <label className="field"><span>Delegated by</span><select name="delegatedFromUserId" className="input">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
      <label className="field"><span>Dollar limit <small>blank = no limit recorded</small></span><input name="maxAmount" type="number" min={0} className="input" /></label>
      <label className="field"><span>Effective from</span><input name="effectiveFrom" type="date" className="input" required /></label>
      <label className="field"><span>Effective to <small>blank = open-ended</small></span><input name="effectiveTo" type="date" className="input" /></label>
      <label className="field"><span>Authorizing document</span><input name="authorizingReference" className="input" required placeholder="Resolution, ordinance or memo number" /></label>
      <label className="field"><span>Notes</span><input name="authorizingNote" className="input" /></label>
      <fieldset className="sm:col-span-2 lg:col-span-3">
        <legend className="text-sm font-semibold">Limited to contract categories <small className="font-normal text-muted">(none selected = all)</small></legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {types.map((t) => (
            <label key={t.key} className="flex items-center gap-1.5"><input type="checkbox" checked={selTypes.includes(t.key)} onChange={(e) => setSelTypes(e.target.checked ? [...selTypes, t.key] : selTypes.filter((x) => x !== t.key))} />{t.name}</label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2 lg:col-span-3"><button className={btn.primary} disabled={pending}>Record authority</button><ActionMessage result={result} /></div>
    </form>
  );
}

export function RevokeAuthority({ id }: { id: string }) {
  const { pending, result, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className={btn.quiet} onClick={() => setOpen(true)}>Revoke</button>;
  return (
    <div className="flex flex-wrap gap-2">
      <input className="input w-48" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for revoking" />
      <button className={btn.danger} disabled={pending} onClick={() => run(() => A.revokeAuthority(id, reason), "Authority revoked.")}>Revoke</button>
      <ActionMessage result={result} />
    </div>
  );
}

type Step = { key: string; name: string; stage: number; kind: "APPROVAL" | "LEGAL_REVIEW"; roleKey: string; scope: string; condition: unknown; dueDays: number; reapproveOnMaterialChange: boolean };

export function WorkflowEditor({
  defKey,
  initial,
  roles,
  scopes,
  requestTypes,
}: {
  defKey: string;
  initial: { name: string; description: string | null; requestTypes: string[]; variables: Record<string, number | string | boolean>; steps: Step[] };
  roles: string[];
  scopes: string[];
  requestTypes: string[];
}) {
  const { pending, result, run } = useAction();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [types, setTypes] = useState(initial.requestTypes);
  const [vars, setVars] = useState(Object.entries(initial.variables).map(([k, v]) => ({ k, v: String(v) })));
  const [steps, setSteps] = useState(initial.steps.map((s) => ({ ...s, conditionText: s.condition == null ? "" : JSON.stringify(s.condition) })));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const upd = (i: number, patch: Partial<(typeof steps)[number]>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  function publish() {
    setJsonError(null);
    const parsed: Step[] = [];
    for (const s of steps) {
      let condition: unknown = null;
      if (s.conditionText.trim()) {
        try {
          condition = JSON.parse(s.conditionText);
        } catch {
          setJsonError(`The condition for "${s.name}" is not valid JSON.`);
          return;
        }
      }
      parsed.push({ key: s.key, name: s.name, stage: Number(s.stage), kind: s.kind, roleKey: s.roleKey, scope: s.scope, condition, dueDays: Number(s.dueDays), reapproveOnMaterialChange: s.reapproveOnMaterialChange });
    }
    const variables = Object.fromEntries(vars.filter((x) => x.k.trim()).map((x) => [x.k.trim(), x.v !== "" && !Number.isNaN(Number(x.v)) ? Number(x.v) : x.v === "true" ? true : x.v === "false" ? false : x.v]));
    run(() => A.publishWorkflow(defKey, { name, description, requestTypes: types, variables, steps: parsed }), (d) => `Published version ${(d as { version: number }).version}. New submissions use it; requests already in progress keep their version.`);
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Description</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">Used for request types</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {requestTypes.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" checked={types.includes(t)} onChange={(e) => setTypes(e.target.checked ? [...types, t] : types.filter((x) => x !== t))} />{t.replace(/_/g, " ").toLowerCase()}</label>)}
        </div>
      </fieldset>
      <fieldset className="rounded border border-rule p-3">
        <legend className="px-1 text-sm font-semibold">Policy values <small className="font-normal text-muted">referenced in conditions as policy.&lt;name&gt;</small></legend>
        {vars.map((x, i) => (
          <div key={i} className="mb-2 flex gap-2">
            <input className="input max-w-64" value={x.k} aria-label="Name" onChange={(e) => setVars(vars.map((y, j) => (j === i ? { ...y, k: e.target.value } : y)))} />
            <input className="input max-w-64" value={x.v} aria-label="Value" onChange={(e) => setVars(vars.map((y, j) => (j === i ? { ...y, v: e.target.value } : y)))} />
            <button type="button" className={btn.quiet} onClick={() => setVars(vars.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <button type="button" className={btn.quiet} onClick={() => setVars([...vars, { k: "", v: "" }])}>Add value</button>
      </fieldset>
      <div className="overflow-x-auto">
        <table className="tbl min-w-[60rem]">
          <thead><tr><th>Stage</th><th>Step</th><th>Kind</th><th>Role</th><th>Whose role</th><th>Applies when (JSON rule; blank = always)</th><th>Due (days)</th><th>Re-approve on material change</th><th /></tr></thead>
          <tbody>
            {steps.map((s, i) => (
              <tr key={i}>
                <td><input className="input w-16" type="number" min={1} value={s.stage} aria-label="Stage" onChange={(e) => upd(i, { stage: Number(e.target.value) })} /></td>
                <td><input className="input w-48" value={s.name} aria-label="Step name" onChange={(e) => upd(i, { name: e.target.value })} /><input className="input mt-1 w-48 text-[0.75rem]" value={s.key} aria-label="Step key" onChange={(e) => upd(i, { key: e.target.value })} /></td>
                <td><select className="input" value={s.kind} aria-label="Kind" onChange={(e) => upd(i, { kind: e.target.value as "APPROVAL" })}><option value="APPROVAL">Approval</option><option value="LEGAL_REVIEW">Legal review</option></select></td>
                <td><select className="input" value={s.roleKey} aria-label="Role" onChange={(e) => upd(i, { roleKey: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</select></td>
                <td><select className="input" value={s.scope} aria-label="Scope" onChange={(e) => upd(i, { scope: e.target.value })}>{scopes.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</select></td>
                <td><textarea className={cx("input w-80 text-[0.75rem]")} rows={2} value={s.conditionText} aria-label="Condition" onChange={(e) => upd(i, { conditionText: e.target.value })} /></td>
                <td><input className="input w-16" type="number" min={1} value={s.dueDays} aria-label="Due days" onChange={(e) => upd(i, { dueDays: Number(e.target.value) })} /></td>
                <td className="text-center"><input type="checkbox" checked={s.reapproveOnMaterialChange} aria-label="Re-approve on material change" onChange={(e) => upd(i, { reapproveOnMaterialChange: e.target.checked })} /></td>
                <td><button type="button" className={btn.quiet} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn.secondary} onClick={() => setSteps([...steps, { key: `step-${steps.length + 1}`, name: "New step", stage: Math.max(1, ...steps.map((s) => s.stage)), kind: "APPROVAL", roleKey: roles[0], scope: scopes[0], condition: null, conditionText: "", dueDays: 5, reapproveOnMaterialChange: false }])}>Add step</button>
        <button type="button" className={btn.primary} disabled={pending} onClick={publish}>Publish as new version</button>
      </div>
      {jsonError && <p role="alert" className="text-sm font-semibold text-red">{jsonError}</p>}
      <ActionMessage result={result} />
    </div>
  );
}

export function RoutingPreview({ definitionId, contracts }: { definitionId: string; contracts: { id: string; number: string; title: string }[] }) {
  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [out, setOut] = useState<{ steps: { stage: number; name: string; rule: string; applies: boolean; scope: string }[]; context: unknown } | null>(null);
  const { pending, result, run } = useAction();
  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="field"><span>Test against an existing contract</span>
          <select className="input" value={contractId} onChange={(e) => setContractId(e.target.value)}>{contracts.map((c) => <option key={c.id} value={c.id}>{c.number} — {c.title}</option>)}</select>
        </label>
        <button className={btn.secondary} disabled={pending || !contractId} onClick={() => run(() => A.previewWorkflow(definitionId, contractId), "Routing preview below.", (d) => setOut(d as typeof out))}>Preview routing</button>
      </div>
      {result && !result.ok && <ActionMessage result={result} />}
      {out && (
        <ul className="mt-3 space-y-1 text-sm">
          {out.steps.map((s, i) => (
            <li key={i} className="flex gap-2"><span className={cx("w-24 font-semibold", s.applies ? "text-green" : "text-muted")}>{s.applies ? "Applies" : "Skipped"}</span><span>Stage {s.stage} · {s.name} <span className="text-muted">— {s.rule}</span></span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

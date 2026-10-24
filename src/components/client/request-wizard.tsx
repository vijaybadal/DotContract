"use client";
/**
 * Contract request wizard. Drafts save at any step; submission validates completeness on the server
 * and starts the approval workflow that matches the request's attributes.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import * as A from "@/app/actions";
import { btn, cx } from "@/components/ui";
import { UploadForm } from "./contract-panels";

type Org = { id: string; name: string; parentId: string | null; isLegalEntity: boolean; kind: string };
type Ref = {
  orgs: Org[];
  types: { key: string; name: string; isSubscription: boolean; requiresParent: boolean; customFields: { key: string; label: string; type: string; required?: boolean }[] }[];
  vendors: { id: string; name: string }[];
  users: { id: string; name: string; title: string | null }[];
  parents: { id: string; number: string; title: string }[];
  myDepts: string[];
  canWaiveLegal: boolean;
};
export type WizardValues = {
  requestType: string;
  title: string;
  typeKey: string;
  vendorId: string;
  newVendorName: string;
  businessPurpose: string;
  description: string;
  requestingDeptId: string;
  contractingEntityId: string;
  administeringOrgId: string;
  benefitingAgencyIds: string[];
  financialAllocations: { orgId: string; pct: number }[];
  ownerId: string;
  serviceOwnerId: string;
  totalValue: string;
  annualValue: string;
  fundingSource: string;
  effectiveDate: string;
  expirationDate: string;
  autoRenew: boolean;
  renewalTermMonths: string;
  noticeDays: string;
  priceEscalation: string;
  parentContractId: string;
  dataSensitivity: string;
  riskLevel: string;
  legalRequired: boolean;
  confidential: boolean;
  purchasingNotes: string;
  customFieldValues: Record<string, string>;
  subscription: { product: string; plan: string; licensedQty: string; unitCost: string; billingFrequency: string } | null;
};

function F({ label, hint, error, children, span }: { label: string; hint?: string; error?: string; children: React.ReactNode; span?: boolean }) {
  return (
    <label className={cx("field", span && "sm:col-span-2")}>
      <span>{label}{hint && <small> · {hint}</small>}</span>
      {children}
      {error && <small role="alert" className="font-semibold text-red">{error}</small>}
    </label>
  );
}

const STEPS = ["Request", "Parties", "Cost and term", "Risk and review", "Documents and submit"];
const REQUEST_TYPES: [string, string][] = [
  ["NEW_CONTRACT", "New contract"],
  ["AMENDMENT", "Amendment to an existing contract"],
  ["RENEWAL", "Renewal"],
  ["EXTENSION", "Extension"],
  ["ADDITIONAL_PURCHASE", "Additional purchase or subscription"],
  ["TERMINATION", "Termination"],
  ["TRANSFER", "Contract transfer"],
  ["LEGAL_REVIEW", "Legal review only"],
];

export function RequestWizard({
  refData,
  initial,
  requestId: initialRequestId,
  contractId: initialContractId,
  documents = [],
  canSubmit = true,
  initialStep = 0,
  savedNumber,
}: {
  refData: Ref;
  initial: WizardValues;
  requestId?: string;
  contractId?: string;
  documents?: { id: string; title: string; kind: string }[];
  canSubmit?: boolean;
  initialStep?: number;
  savedNumber?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 0), STEPS.length - 1));
  const [v, setV] = useState<WizardValues>(initial);
  const [requestId, setRequestId] = useState(initialRequestId);
  const [contractId, setContractId] = useState(initialContractId);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; fields?: { field: string; message: string }[] } | null>(
    savedNumber ? { ok: true, text: `Draft saved as ${savedNumber}.` } : null,
  );

  const set = <K extends keyof WizardValues>(k: K, val: WizardValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const type = refData.types.find((t) => t.key === v.typeKey);
  const errors = useMemo(() => Object.fromEntries((msg?.fields ?? []).map((f) => [f.field, f.message])), [msg]);
  const govs = refData.orgs.filter((o) => o.isLegalEntity);
  const childrenOf = (id: string) => refData.orgs.filter((o) => o.parentId === id);
  const allocTotal = v.financialAllocations.reduce((a, f) => a + Number(f.pct || 0), 0);

  function payload() {
    const num = (s: string) => (s === "" ? null : Number(s));
    return {
      ...v,
      vendorId: v.vendorId || null,
      newVendorName: v.vendorId ? null : v.newVendorName || null,
      contractingEntityId: v.contractingEntityId || null,
      administeringOrgId: v.administeringOrgId || null,
      requestingDeptId: v.requestingDeptId || null,
      ownerId: v.ownerId || null,
      serviceOwnerId: v.serviceOwnerId || null,
      parentContractId: v.parentContractId || null,
      totalValue: num(v.totalValue),
      annualValue: num(v.annualValue),
      renewalTermMonths: num(v.renewalTermMonths),
      noticeDays: num(v.noticeDays),
      effectiveDate: v.effectiveDate || null,
      expirationDate: v.expirationDate || null,
      subscription: type?.isSubscription && v.subscription?.product ? { ...v.subscription, licensedQty: Number(v.subscription.licensedQty || 0), unitCost: Number(v.subscription.unitCost || 0) } : null,
    };
  }

  function save(then?: "next" | "submit") {
    setMsg(null);
    start(async () => {
      const r = await A.saveRequest(requestId ?? null, payload());
      if (!r.ok) {
        setMsg({ ok: false, text: r.error, fields: Array.isArray(r.details) ? (r.details as { field: string; message: string }[]) : undefined });
        return;
      }
      const d = r.data as { requestId: string; contractId?: string; requestNumber?: string };
      if (!requestId && then !== "submit") {
        // First save of a new request: continue on the saved request's own page at the intended step.
        const nextStep = then === "next" ? Math.min(step + 1, STEPS.length - 1) : step;
        router.replace(`/requests/${d.requestId}?step=${nextStep}&saved=${encodeURIComponent(d.requestNumber ?? "")}`);
        return;
      }
      if (!requestId) {
        setRequestId(d.requestId);
        setContractId(d.contractId);
      }
      if (then === "submit") {
        const s = await A.submitRequest(d.requestId);
        if (!s.ok) {
          setMsg({ ok: false, text: s.error, fields: Array.isArray(s.details) ? (s.details as { field: string; message: string }[]) : undefined });
          return;
        }
        router.push(`/requests/${d.requestId}?submitted=1`);
        router.refresh();
        return;
      }
      setMsg({ ok: true, text: "Draft saved." });
      if (then === "next") setStep((s) => Math.min(s + 1, STEPS.length - 1));
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="Request steps">
        <ol className="space-y-1">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={step === i ? "step" : undefined}
                className={cx("flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm", step === i ? "bg-panel font-semibold text-teal-ink shadow-[inset_3px_0_0_var(--color-teal)]" : "text-muted hover:bg-panel")}
              >
                <span className={cx("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.75rem] font-bold", step === i ? "bg-teal text-white" : "bg-rule text-ink-soft")}>{i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="rounded-md border border-rule bg-panel p-5">
        <h2 className="mb-4 text-lg font-semibold">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <F error={errors["requestType"]} label="What do you need?">
              <select className="input" value={v.requestType} onChange={(e) => set("requestType", e.target.value)}>
                {REQUEST_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </F>
            <F error={errors["typeKey"]} label="Contract category">
              <select className="input" value={v.typeKey} onChange={(e) => set("typeKey", e.target.value)}>
                {refData.types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </F>
            <F error={errors["title"]} label="Short title" hint="what the contract is for" span>
              <input className="input" value={v.title} onChange={(e) => set("title", e.target.value)} aria-invalid={Boolean(errors.title)} />
            </F>
            <F error={errors["vendorId"]} label="Vendor">
              <select className="input" value={v.vendorId} onChange={(e) => set("vendorId", e.target.value)} aria-invalid={Boolean(errors.vendorId)}>
                <option value="">Not in the list / not yet known</option>
                {refData.vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </F>
            {!v.vendorId && (
              <F error={errors["newVendorName"]} label="New vendor name" hint="added for Purchasing to verify">
                <input className="input" value={v.newVendorName} onChange={(e) => set("newVendorName", e.target.value)} />
              </F>
            )}
            <F error={errors["businessPurpose"]} label="Business purpose and justification" span>
              <textarea className="input" rows={4} value={v.businessPurpose} onChange={(e) => set("businessPurpose", e.target.value)} aria-invalid={Boolean(errors.businessPurpose)} />
            </F>
            <F error={errors["description"]} label="Scope description" hint="optional" span>
              <textarea className="input" rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
            </F>
            {(type?.requiresParent || !["NEW_CONTRACT", "LEGAL_REVIEW"].includes(v.requestType)) && (
              <F error={errors["parentContractId"]} label={type?.key === "SOW" ? "Master agreement this SOW is issued under" : "Existing contract"} span>
                <select className="input" value={v.parentContractId} onChange={(e) => set("parentContractId", e.target.value)} aria-invalid={Boolean(errors.parentContractId)}>
                  <option value="">Choose a contract</option>
                  {refData.parents.map((p) => <option key={p.id} value={p.id}>{p.number} — {p.title}</option>)}
                </select>
              </F>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <F error={errors["requestingDeptId"]} label="Requesting department">
              <select className="input" value={v.requestingDeptId} onChange={(e) => set("requestingDeptId", e.target.value)}>
                {govs.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {[g, ...childrenOf(g.id)].filter((o) => refData.myDepts.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.id === g.id ? `${g.name} (entity-wide)` : o.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </F>
            <F error={errors["contractingEntityId"]} label="Contracting legal entity" hint="the party bound by the contract">
              <select className="input" value={v.contractingEntityId} onChange={(e) => set("contractingEntityId", e.target.value)}>
                <option value="">Same as the requesting department&apos;s entity</option>
                {govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </F>
            <F error={errors["administeringOrgId"]} label="Administering organization" hint="who manages the contract day to day">
              <select className="input" value={v.administeringOrgId} onChange={(e) => set("administeringOrgId", e.target.value)}>
                <option value="">The requesting department</option>
                {govs.map((g) => (
                  <optgroup key={g.id} label={g.name}>
                    {[g, ...childrenOf(g.id)].map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </F>
            <div className="sm:col-span-2">
              <fieldset className="rounded border border-rule p-3">
                <legend className="px-1 text-sm font-semibold">Benefiting agencies</legend>
                <div className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                  {govs.map((g) => (
                    <div key={g.id}>
                      {[g, ...childrenOf(g.id)].map((o) => (
                        <label key={o.id} className={cx("flex items-center gap-2", o.id !== g.id && "pl-4")}>
                          <input
                            type="checkbox"
                            checked={v.benefitingAgencyIds.includes(o.id)}
                            onChange={(e) => set("benefitingAgencyIds", e.target.checked ? [...v.benefitingAgencyIds, o.id] : v.benefitingAgencyIds.filter((x) => x !== o.id))}
                          />
                          <span className={o.id === g.id ? "font-semibold" : ""}>{o.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="sm:col-span-2">
              <fieldset className="rounded border border-rule p-3">
                <legend className="px-1 text-sm font-semibold">Cost sharing <small className="font-normal text-muted">(leave empty if one agency pays)</small></legend>
                {v.financialAllocations.map((f, i) => (
                  <div key={i} className="mb-2 flex items-center gap-2">
                    <select className="input" value={f.orgId} aria-label="Paying agency" onChange={(e) => set("financialAllocations", v.financialAllocations.map((x, j) => (j === i ? { ...x, orgId: e.target.value } : x)))}>
                      {refData.orgs.filter((o) => o.kind !== "OFFICE").map((o) => <option key={o.id} value={o.id}>{o.name}{o.parentId ? ` (${refData.orgs.find((p) => p.id === o.parentId)?.name})` : ""}</option>)}
                    </select>
                    <input className="input w-24" type="number" min={0} max={100} value={f.pct} aria-label="Percent" onChange={(e) => set("financialAllocations", v.financialAllocations.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} />
                    <span className="text-sm">%</span>
                    <button type="button" className={btn.quiet} onClick={() => set("financialAllocations", v.financialAllocations.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <button type="button" className={btn.quiet} onClick={() => set("financialAllocations", [...v.financialAllocations, { orgId: govs[0]?.id ?? "", pct: 0 }])}>Add paying agency</button>
                  {v.financialAllocations.length > 0 && <span className={cx("text-sm", allocTotal === 100 ? "text-green" : "font-semibold text-red")}>Total {allocTotal}%</span>}
                </div>
                {errors.financialAllocations && <p className="mt-1 text-sm font-semibold text-red">{errors.financialAllocations}</p>}
              </fieldset>
            </div>
            <F error={errors["ownerId"]} label="Contract owner" hint="accountable for the business outcome">
              <select className="input" value={v.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
                {refData.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` — ${u.title}` : ""}</option>)}
              </select>
            </F>
            <F error={errors["serviceOwnerId"]} label="Service / technical owner">
              <select className="input" value={v.serviceOwnerId} onChange={(e) => set("serviceOwnerId", e.target.value)}>
                <option value="">None</option>
                {refData.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` — ${u.title}` : ""}</option>)}
              </select>
            </F>
            <p className="text-[0.8rem] text-muted sm:col-span-2">Who signs is decided later from the signing-authority registry. Being the owner or administrator does not grant authority to sign.</p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <F error={errors["totalValue"]} label="Estimated total value (USD)" hint="whole term">
              <input className="input" type="number" min={0} step="0.01" value={v.totalValue} onChange={(e) => set("totalValue", e.target.value)} aria-invalid={Boolean(errors.totalValue)} />
            </F>
            <F error={errors["annualValue"]} label="Annual value (USD)" hint="recurring cost per year">
              <input className="input" type="number" min={0} step="0.01" value={v.annualValue} onChange={(e) => set("annualValue", e.target.value)} />
            </F>
            <F error={errors["fundingSource"]} label="Funding source" span>
              <input className="input" value={v.fundingSource} onChange={(e) => set("fundingSource", e.target.value)} aria-invalid={Boolean(errors.fundingSource)} placeholder="Fund, cost center or budget line" />
            </F>
            <F error={errors["effectiveDate"]} label="Expected start">
              <input className="input" type="date" value={v.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} aria-invalid={Boolean(errors.effectiveDate)} />
            </F>
            <F error={errors["expirationDate"]} label="Expected end">
              <input className="input" type="date" value={v.expirationDate} onChange={(e) => set("expirationDate", e.target.value)} aria-invalid={Boolean(errors.expirationDate)} />
            </F>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.autoRenew} onChange={(e) => set("autoRenew", e.target.checked)} /> The vendor&apos;s terms renew automatically</label>
            {v.autoRenew && (
              <F error={errors["renewalTermMonths"]} label="Renewal term (months)">
                <input className="input" type="number" min={1} value={v.renewalTermMonths} onChange={(e) => set("renewalTermMonths", e.target.value)} aria-invalid={Boolean(errors.renewalTermMonths)} />
              </F>
            )}
            <F error={errors["noticeDays"]} label="Non-renewal notice period (days)" hint="from the contract">
              <input className="input" type="number" min={0} value={v.noticeDays} onChange={(e) => set("noticeDays", e.target.value)} />
            </F>
            <F error={errors["priceEscalation"]} label="Price escalation terms" span>
              <input className="input" value={v.priceEscalation} onChange={(e) => set("priceEscalation", e.target.value)} placeholder="e.g. up to 3% per renewal" />
            </F>
            {type?.isSubscription && (
              <fieldset className="grid gap-3 rounded border border-rule p-3 sm:col-span-2 sm:grid-cols-4">
                <legend className="px-1 text-sm font-semibold">Subscription</legend>
                {(["product", "plan", "licensedQty", "unitCost"] as const).map((k) => (
                  <label key={k} className="field">
                    <span>{{ product: "Product", plan: "Plan", licensedQty: "Licenses / seats", unitCost: "Annual cost per license" }[k]}</span>
                    <input
                      className="input"
                      type={k === "licensedQty" || k === "unitCost" ? "number" : "text"}
                      value={v.subscription?.[k] ?? ""}
                      onChange={(e) => set("subscription", { product: "", plan: "", licensedQty: "", unitCost: "", billingFrequency: "ANNUAL", ...v.subscription, [k]: e.target.value })}
                    />
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <F error={errors["dataSensitivity"]} label="Most sensitive data the vendor will handle">
              <select className="input" value={v.dataSensitivity} onChange={(e) => set("dataSensitivity", e.target.value)}>
                <option value="PUBLIC">Public</option><option value="INTERNAL">Internal</option><option value="CONFIDENTIAL">Confidential (PII, financial)</option><option value="RESTRICTED">Restricted (CJIS, health, payment card)</option>
              </select>
            </F>
            <F error={errors["riskLevel"]} label="Overall risk">
              <select className="input" value={v.riskLevel} onChange={(e) => set("riskLevel", e.target.value)}>
                <option value="LOW">Low</option><option value="MODERATE">Moderate</option><option value="HIGH">High</option>
              </select>
            </F>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.legalRequired} disabled={!refData.canWaiveLegal && v.legalRequired} onChange={(e) => set("legalRequired", e.target.checked)} /> Legal review required
              {!refData.canWaiveLegal && <small className="text-muted">· only a contract administrator can waive it</small>}
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.confidential} onChange={(e) => set("confidential", e.target.checked)} /> Restrict documents to owner, administrators and Legal</label>
            <F error={errors["purchasingNotes"]} label="Purchasing requirements" hint="procurement method, cooperative contract, bid number" span>
              <textarea className="input" rows={2} value={v.purchasingNotes} onChange={(e) => set("purchasingNotes", e.target.value)} />
            </F>
            {(type?.customFields ?? []).map((f) => (
              <F key={f.key} error={errors[`custom.${f.key}`]} label={f.label} hint={f.required ? "required for this category" : undefined} span={f.type === "text"}>
                <input className="input" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={v.customFieldValues[f.key] ?? ""} onChange={(e) => set("customFieldValues", { ...v.customFieldValues, [f.key]: e.target.value })} aria-invalid={Boolean(errors[`custom.${f.key}`])} />
              </F>
            ))}
            <p className="text-[0.8rem] text-muted sm:col-span-2">These answers decide who reviews the request — for example, confidential data and SaaS subscriptions route to Information Security.</p>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-2 rounded bg-canvas p-4 text-sm sm:grid-cols-2">
              {[
                ["Title", v.title],
                ["Category", type?.name],
                ["Vendor", refData.vendors.find((x) => x.id === v.vendorId)?.name ?? (v.newVendorName || "—")],
                ["Requesting department", refData.orgs.find((o) => o.id === v.requestingDeptId)?.name],
                ["Total value", v.totalValue ? `$${Number(v.totalValue).toLocaleString()}` : "—"],
                ["Term", v.effectiveDate && v.expirationDate ? `${v.effectiveDate} to ${v.expirationDate}` : "—"],
                ["Benefiting agencies", v.benefitingAgencyIds.map((id) => refData.orgs.find((o) => o.id === id)?.name).join(", ") || "—"],
                ["Data sensitivity", v.dataSensitivity.toLowerCase()],
              ].map(([k, val]) => (
                <div key={k} className="grid grid-cols-[10rem_1fr]"><dt className="text-muted">{k}</dt><dd className="font-medium">{val}</dd></div>
              ))}
            </dl>
            {contractId ? (
              <div>
                <h3 className="mb-2 font-semibold">Attach the vendor agreement and supporting documents</h3>
                <UploadForm contractId={contractId} documents={documents} hasAgreement={documents.some((d) => d.kind === "AGREEMENT")} />
                {documents.length > 0 && <p className="mt-2 text-sm text-muted">Attached: {documents.map((d) => d.title).join(", ")}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted">Save the draft to attach documents.</p>
            )}
          </div>
        )}

        {msg && (
          <div role={msg.ok ? "status" : "alert"} className={cx("mt-5 rounded-md border-l-4 px-3 py-2 text-sm", msg.ok ? "border-green bg-green-wash" : "border-red bg-red-wash")}>
            <p className="font-semibold">{msg.text}</p>
            {msg.fields && msg.fields.length > 0 && <ul className="mt-1 list-disc pl-5">{msg.fields.map((f) => <li key={f.field}>{f.message}</li>)}</ul>}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-rule pt-4">
          {step > 0 && <button type="button" className={btn.secondary} onClick={() => setStep(step - 1)}>Back</button>}
          <button type="button" className={btn.secondary} disabled={pending} onClick={() => save()}>Save draft</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className={btn.primary} disabled={pending} onClick={() => save("next")}>Save and continue</button>
          ) : (
            canSubmit && <button type="button" className={btn.primary} disabled={pending} onClick={() => save("submit")}>{pending ? "Submitting…" : "Submit for approval"}</button>
          )}
          {contractId && <Link href={`/contracts/${contractId}`} className="ml-auto text-sm font-semibold text-teal hover:underline">Open contract record</Link>}
        </div>
      </div>
    </div>
  );
}

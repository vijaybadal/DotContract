import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contractType, signingAuthorityCheck, user, vendorContact, contract as contractTbl, contractRelationship } from "@/db/schema";
import { requireActor } from "@/lib/auth/session";
import { getContractDetail } from "@/lib/contracts";
import { listDocuments, canSeeConfidential } from "@/lib/documents";
import { listEligibleTasks, workflowHistory, dueLabel } from "@/lib/workflow";
import { auditForContract } from "@/lib/audit";
import { authorizedSignatories, executionBlockers } from "@/lib/signing";
import { currentAgreementVersion } from "@/lib/agreement";
import { usersWithRole } from "@/lib/people";
import { isAppError } from "@/lib/errors";
import { daysBetween, formatDate, formatDateTime, monthsBetween, noticeDeadline, todayIn } from "@/lib/dates";
import { allocate, formatMoney, toNumber } from "@/lib/money";
import { describe as describeRule, type Rule } from "@/lib/rules";
import { DateText, Empty, KV, Money, Notice, PageHeader, Panel, Pill, Status, cx } from "@/components/ui";
import { LifecycleRail } from "@/components/lifecycle-rail";
import {
  AdHocForm,
  AmendTermsForm,
  ExternalExecutionForm,
  LegalIssueForm,
  LegalTaskActions,
  ReassignForm,
  RenewalDecisionForm,
  ResolveIssue,
  RetryCompletion,
  SendSignatureForm,
  SignatureRequestActions,
  TaskDecisionForm,
  UploadForm,
} from "@/components/client/contract-panels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contract" };

const TABS = [
  ["overview", "Overview"],
  ["documents", "Documents"],
  ["workflow", "Workflow"],
  ["approvals", "Approvals"],
  ["legal", "Legal"],
  ["signature", "Signature"],
  ["financials", "Financials"],
  ["renewals", "Renewals"],
  ["obligations", "Obligations"],
  ["relationships", "Relationships"],
  ["audit", "Audit history"],
] as const;

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const actor = await requireActor();
  let detail: Awaited<ReturnType<typeof getContractDetail>>;
  try {
    detail = await getContractDetail(actor, id);
  } catch (e) {
    if (isAppError(e) && e.status === 404) notFound();
    throw e;
  }
  const { contract: c, orgs, can } = detail;
  const today = todayIn(orgs.entity.timeZone);
  const myTasks = (await listEligibleTasks(actor)).filter((t) => t.contract.id === c.id);
  const deadline = noticeDeadline(c.expirationDate, c.noticeDays);

  return (
    <>
      <PageHeader
        crumbs={[{ href: "/contracts", label: "Contracts" }]}
        title={c.title}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink-soft">{c.number}</span>
            <span>{c.type.name}</span>
            {c.vendor && <><span aria-hidden>·</span><Link className="text-teal hover:underline" href={`/vendors/${c.vendor.id}`}>{c.vendor.name}</Link></>}
            {c.confidential && <Pill tone="red">Confidential</Pill>}
          </span>
        }
        actions={<Status value={c.status} />}
      />
      <div className="mb-5 rounded-md border border-rule bg-panel px-4 pb-3 pt-4">
        <LifecycleRail c={c} />
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[0.8rem] text-muted">
          <span>Approvals: <Status value={c.approvalStatus === "NOT_STARTED" ? "DRAFT" : c.approvalStatus} /></span>
          <span>Legal: <Status value={c.legalStatus} /></span>
          <span>Signature: <Status value={c.signatureStatus} /></span>
          {c.status === "ACTIVE" && deadline && <span>Notice deadline: <strong className={daysBetween(today, deadline) <= 30 ? "text-red" : "text-ink"}>{formatDate(deadline)}</strong></span>}
        </div>
      </div>

      {c.executionIsDemo && (
        <div className="mb-5"><Notice tone="red" title="Demo execution — this agreement has not been legally executed">It was completed through the development e-signature mock. Record the real execution through an approved provider or upload the signed copy.</Notice></div>
      )}

      {myTasks.length > 0 && tab !== "legal" && (
        <Panel title="Your action is needed" className="mb-5 border-teal">
          {myTasks.map(({ task, onBehalfOfUserId }) => (
            <div key={task.id} className="mb-4 last:mb-0">
              <p className="mb-2 text-sm">
                <strong>{task.name}</strong> · {dueLabel(task.dueAt)}
                {onBehalfOfUserId && <span className="text-muted"> · acting under an approval delegation</span>}
              </p>
              {task.kind === "LEGAL_REVIEW" ? (
                <Link className="font-semibold text-teal hover:underline" href={`/contracts/${c.id}?tab=legal`}>Open the Legal workspace</Link>
              ) : (
                <TaskDecisionForm taskId={task.id} />
              )}
            </div>
          ))}
        </Panel>
      )}

      <nav aria-label="Contract sections" className="mb-5 overflow-x-auto border-b border-rule">
        <ul className="flex min-w-max gap-1">
          {TABS.map(([k, label]) => (
            <li key={k}>
              <Link
                href={`/contracts/${c.id}?tab=${k}`}
                aria-current={tab === k ? "page" : undefined}
                className={cx("block border-b-2 px-3 py-2 text-sm", tab === k ? "border-teal font-semibold text-teal-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && <Overview detail={detail} today={today} />}
      {tab === "documents" && <Documents detail={detail} actorId={actor.id} />}
      {tab === "workflow" && <WorkflowTab detail={detail} />}
      {tab === "approvals" && <Approvals contractId={c.id} />}
      {tab === "legal" && <LegalTab detail={detail} myTasks={myTasks.filter((t) => t.task.kind === "LEGAL_REVIEW").map((t) => t.task)} />}
      {tab === "signature" && <SignatureTab detail={detail} />}
      {tab === "financials" && <Financials detail={detail} />}
      {tab === "renewals" && <Renewals detail={detail} today={today} />}
      {tab === "obligations" && <Obligations detail={detail} today={today} />}
      {tab === "relationships" && <Relationships detail={detail} />}
      {tab === "audit" && <Audit contractId={c.id} />}
    </>
  );
}

type Detail = Awaited<ReturnType<typeof getContractDetail>>;

function Overview({ detail, today }: { detail: Detail; today: string }) {
  const { contract: c, orgs, administeredOnBehalf } = detail;
  const benefiting = c.agencies.filter((a) => a.role === "BENEFITING");
  const financial = c.agencies.filter((a) => a.role === "FINANCIAL");
  const signer = c.signatureRequests.flatMap((r) => r.signers).find((s) => s.signerType === "AGENCY" && s.status === "SIGNED");
  const term = c.effectiveDate && c.expirationDate ? monthsBetween(c.effectiveDate, c.expirationDate) : null;
  const custom = (c.type.customFields ?? []).filter((f) => (c.customFieldValues as Record<string, unknown>)[f.key] != null);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-5">
        <Panel title="Purpose">
          <p className="max-w-prose text-[0.95rem] leading-relaxed">{c.businessPurpose || c.description || "No purpose recorded."}</p>
          {c.description && c.description !== c.businessPurpose && <p className="mt-2 max-w-prose text-sm text-muted">{c.description}</p>}
        </Panel>
        <Panel title="Term and value">
          <KV
            cols={3}
            items={[
              ["Total value", <Money key="t" value={c.totalValue} />],
              ["Annual value", <Money key="a" value={c.annualValue} />],
              ["Funding source", c.fundingSource],
              ["Effective", <DateText key="e" value={c.effectiveDate} />],
              ["Expires", <DateText key="x" value={c.expirationDate} />],
              ["Term", term != null ? `${term} months` : "—"],
              ["Renewal", c.autoRenew ? `Auto-renews for ${c.renewalTermMonths ?? "?"} months` : "Does not auto-renew"],
              ["Notice period", c.noticeDays ? `${c.noticeDays} days (by ${formatDate(noticeDeadline(c.expirationDate, c.noticeDays))})` : "—"],
              ["Price escalation", c.priceEscalation],
              ["Data sensitivity", c.dataSensitivity.toLowerCase()],
              ["Risk", c.riskLevel.toLowerCase()],
              ["Legal review", c.legalRequired ? "Required" : "Not required"],
            ]}
          />
          {c.expirationDate && c.status === "ACTIVE" && (
            <p className="mt-3 text-sm text-muted">{daysBetween(today, c.expirationDate)} days remain in the current term.</p>
          )}
        </Panel>
        {custom.length > 0 && (
          <Panel title={`${c.type.name} details`}>
            <KV items={custom.map((f) => [f.label, String((c.customFieldValues as Record<string, unknown>)[f.key])])} />
          </Panel>
        )}
        {c.subscriptions.length > 0 && (
          <Panel title="Subscription" flush>
            <table className="tbl">
              <thead><tr><th>Product</th><th>Plan</th><th className="num">Licensed</th><th className="num">Assigned</th><th className="num">Unit cost</th><th className="num">Annual</th></tr></thead>
              <tbody>
                {c.subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.product}</td><td>{s.plan}</td>
                    <td className="num">{s.licensedQty.toLocaleString()}</td>
                    <td className="num">{s.assignedQty?.toLocaleString() ?? "—"}{s.assignedQty != null && s.licensedQty > 0 && <span className="ml-1 text-muted">({Math.round((s.assignedQty / s.licensedQty) * 100)}%)</span>}</td>
                    <td className="num"><Money value={s.unitCost} /></td>
                    <td className="num"><Money value={toNumber(s.unitCost) * s.licensedQty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
      <div className="space-y-5">
        <Panel title="Parties and responsibilities">
          {administeredOnBehalf && (
            <p className="mb-3 rounded bg-teal-wash px-3 py-2 text-sm text-teal-ink">
              {orgs.adminPath.split(" › ")[0]} ({orgs.admin.name}) administers this contract on behalf of {orgs.entity.name}. Administration does not confer authority to sign.
            </p>
          )}
          <dl className="space-y-2.5 text-sm">
            {[
              ["Contracting legal entity", orgs.entity.name],
              ["Administering organization", orgs.adminPath],
              ["Requesting department", orgs.deptPath],
              ["Benefiting agencies", benefiting.length ? benefiting.map((a) => a.org.name).join(", ") : "—"],
              ["Financially responsible", financial.length ? financial.map((a) => `${a.org.name}${a.allocationPct ? ` (${Number(a.allocationPct)}%)` : ""}`).join(", ") : orgs.entity.name],
              ["Contract owner", c.owner.name],
              ["Service / technical owner", c.serviceOwner?.name ?? "—"],
              ["Legal reviewing authority", orgs.legal?.name ?? "—"],
              ["Purchasing", c.purchasingNotes ?? `${orgs.entity.name} purchasing`],
              ["Authorized signatory", signer ? signer.name : c.signatureStatus === "EXECUTED_EXTERNALLY" ? "Recorded at execution" : "Determined at signature"],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[11rem_1fr] gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Requests">
          {c.requests.length === 0 ? (
            <p className="text-sm text-muted">Imported record; no request history in the CLM.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {c.requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span><Link href={`/requests/${r.id}`} className="font-semibold hover:text-teal hover:underline">{r.number}</Link> · {r.type.replace(/_/g, " ").toLowerCase()} by {r.requester.name}</span>
                  <Status value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

async function Documents({ detail, actorId }: { detail: Detail; actorId: string }) {
  const { contract: c, can } = detail;
  const docs = await listDocuments(c.id);
  const actor = await requireActor();
  const seeConfidential = await canSeeConfidential(actor, c);
  const agreement = docs.find((d) => d.kind === "AGREEMENT");
  void actorId;
  return (
    <div className="space-y-5">
      {docs.length === 0 ? (
        <Panel><Empty title="No documents yet">Upload the vendor agreement so reviewers and Legal can work from it.</Empty></Panel>
      ) : (
        docs.map((d) => {
          const restricted = (d.confidential || c.confidential) && !seeConfidential;
          return (
            <Panel
              key={d.id}
              title={<span className="flex items-center gap-2">{d.title} <Pill tone={d.kind === "AGREEMENT" ? "teal" : d.kind === "EXECUTED" ? "green" : "neutral"}>{d.kind.replace(/_/g, " ").toLowerCase()}</Pill>{d.confidential && <Pill tone="red">Confidential</Pill>}</span>}
              actions={d.versions.length > 1 && !restricted ? <Link className="text-sm font-semibold text-teal hover:underline" href={`/contracts/${c.id}/compare?from=${d.versions[1].id}&to=${d.versions[0].id}`}>Compare latest two versions</Link> : undefined}
              flush
            >
              <table className="tbl">
                <thead><tr><th>Version</th><th>File</th><th>Uploaded</th><th>Checks</th><th>Note</th><th /></tr></thead>
                <tbody>
                  {d.versions.map((v, i) => (
                    <tr key={v.id}>
                      <td className="font-semibold">v{v.versionNo}{i === 0 && <span className="ml-1 text-[0.75rem] font-normal text-muted">current</span>}</td>
                      <td className="text-[0.85rem]">{v.fileName}<div className="text-[0.75rem] text-muted">{fmtBytes(v.sizeBytes)} · SHA-256 {v.sha256.slice(0, 12)}…</div></td>
                      <td className="text-[0.85rem]">{v.uploadedBy.name}<div className="text-[0.75rem] text-muted">{formatDateTime(v.createdAt)}</div></td>
                      <td className="space-x-1 space-y-1">
                        <Status value={v.scanStatus} />
                        {v.hasTrackedChanges && <Pill tone="amber">Tracked changes</Pill>}
                        {v.isMaterialChange && <Pill tone="amber">Material change</Pill>}
                      </td>
                      <td className="max-w-56 text-[0.85rem]">{v.note}</td>
                      <td className="text-right">
                        {restricted ? <span className="text-[0.8rem] text-muted">Restricted</span> : v.scanStatus === "CLEAN" ? <a className="text-sm font-semibold text-teal hover:underline" href={`/api/v1/documents/${v.id}`}>Download</a> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          );
        })
      )}
      {can.upload && (
        <Panel title="Upload a document or new version">
          <UploadForm contractId={c.id} documents={docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind }))} hasAgreement={Boolean(agreement)} />
          <p className="mt-3 text-[0.8rem] text-muted">
            Word redlines keep their tracked changes; open them in Word to review. Versions are never overwritten. Every download is recorded in the audit history.
          </p>
        </Panel>
      )}
    </div>
  );
}

async function WorkflowTab({ detail }: { detail: Detail }) {
  const { contract: c, can } = detail;
  const history = await workflowHistory(c.id);
  if (!history.length) return <Panel><Empty title="No approval workflow yet">The workflow starts when the request is submitted.</Empty></Panel>;
  const allUsers = can.administer ? await db.select({ id: user.id, name: user.name, title: user.title }).from(user).where(eq(user.active, true)) : [];
  return (
    <div className="space-y-5">
      {await Promise.all(
        history.map(async (inst, n) => {
          const stages = [...new Set(inst.tasks.map((t) => t.stage))].sort((a, b) => a - b);
          return (
            <Panel
              key={inst.id}
              title={<span>{inst.request.number} · {inst.definition.name} <span className="font-normal text-muted">v{inst.definition.version}</span></span>}
              actions={<Status value={inst.status === "RUNNING" ? "IN_REVIEW" : inst.status} />}
            >
              <p className="mb-4 text-[0.8rem] text-muted">Started {formatDateTime(inst.startedAt)}{inst.completedAt && ` · closed ${formatDateTime(inst.completedAt)}`}{n > 0 && " · earlier submission"}</p>
              <ol className="space-y-4">
                {await Promise.all(
                  stages.map(async (s) => (
                    <li key={s} className="grid gap-2 sm:grid-cols-[5rem_1fr]">
                      <span className="text-sm font-semibold text-muted">Stage {s}</span>
                      <ul className="grid gap-2 md:grid-cols-2">
                        {await Promise.all(
                          inst.tasks
                            .filter((t) => t.stage === s)
                            .map(async (t) => {
                              const people = can.administer && t.status === "PENDING" && !t.isAdHoc ? await usersWithRole(db, t.roleKey, t.scopeOrgId) : [];
                              return (
                                <li key={t.id} className={cx("rounded border px-3 py-2.5 text-sm", t.status === "PENDING" ? "border-amber/50 bg-amber-wash/40" : "border-rule")}>
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="font-semibold">{t.name}</span>
                                    <Status value={t.status} />
                                  </div>
                                  <p className="mt-1 text-[0.8rem] text-muted">
                                    {t.isAdHoc ? `Ad hoc · ${t.assignee?.name}` : `${t.roleKey.replace(/_/g, " ").toLowerCase()} · ${t.scopeOrg?.name ?? ""}`}
                                    {t.assignee && !t.isAdHoc && ` · assigned to ${t.assignee.name}`}
                                  </p>
                                  {t.status === "SKIPPED" && <p className="mt-1 text-[0.8rem] text-muted">{t.skipReason}</p>}
                                  {t.decidedBy && <p className="mt-1 text-[0.8rem]">{t.decidedBy.name} · {formatDateTime(t.decidedAt)}{t.comment && <> — “{t.comment}”</>}</p>}
                                  {t.status === "PENDING" && <p className="mt-1 text-[0.8rem] font-semibold text-amber">{dueLabel(t.dueAt)}</p>}
                                  {t.status === "SUPERSEDED" && <p className="mt-1 text-[0.8rem] text-muted">{t.skipReason}</p>}
                                  {people.length > 0 && (
                                    <details className="mt-1">
                                      <summary className="cursor-pointer text-[0.8rem] font-semibold text-teal">Reassign</summary>
                                      <ReassignForm taskId={t.id} people={people} />
                                    </details>
                                  )}
                                </li>
                              );
                            }),
                        )}
                      </ul>
                    </li>
                  )),
                )}
              </ol>
              {inst.status === "RUNNING" && can.administer && (
                <div className="mt-5 border-t border-rule pt-4"><AdHocForm instanceId={inst.id} people={allUsers} /></div>
              )}
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer font-semibold text-teal">Routing rules and the facts they were evaluated against</summary>
                <ul className="mt-2 space-y-1 text-[0.85rem]">
                  {inst.tasks.filter((t) => t.conditionSnapshot).map((t) => (
                    <li key={t.id}><strong>{t.name.split(" — ")[0]}:</strong> {describeRule(t.conditionSnapshot as Rule)}</li>
                  ))}
                </ul>
                <pre className="mt-2 max-h-72 overflow-auto rounded bg-canvas p-3 text-[0.75rem]">{JSON.stringify(inst.context, null, 2)}</pre>
              </details>
            </Panel>
          );
        }),
      )}
      {can.administer && ["IN_REVIEW", "IN_LEGAL", "PENDING_SIGNATURE"].includes(c.status) && (
        <Panel title="Change key terms during review">
          <p className="mb-3 text-sm text-muted">Changing the value or term is a material change: Legal and final approval are re-opened and must approve again.</p>
          <AmendTermsForm contractId={c.id} totalValue={c.totalValue} expirationDate={c.expirationDate} />
        </Panel>
      )}
    </div>
  );
}

async function Approvals({ contractId }: { contractId: string }) {
  const history = await workflowHistory(contractId);
  const decisions = history.flatMap((i) => i.tasks.flatMap((t) => t.decisions.map((d) => ({ ...d, step: t.name, version: i.definition.version, request: i.request.number }))));
  decisions.sort((a, b) => +b.createdAt - +a.createdAt);
  if (!decisions.length) return <Panel><Empty title="No decisions recorded yet" /></Panel>;
  return (
    <Panel title="Decision record" flush>
      <table className="tbl">
        <thead><tr><th>When</th><th>Step</th><th>Decision</th><th>By</th><th>Agreement version approved</th><th>Rules</th></tr></thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.id}>
              <td className="whitespace-nowrap text-[0.85rem]">{formatDateTime(d.createdAt)}</td>
              <td className="text-[0.85rem]">{d.step}<div className="text-[0.75rem] text-muted">{d.request}</div></td>
              <td><Pill tone={d.decision.includes("REJECT") ? "red" : d.decision.includes("RETURN") || d.decision.includes("CHANGES") ? "amber" : "green"}>{d.decision.replace(/_/g, " ").toLowerCase()}</Pill>{d.comment && <div className="mt-1 max-w-64 text-[0.8rem]">“{d.comment}”</div>}</td>
              <td className="text-[0.85rem]">{d.user.name}{d.onBehalfOf && <div className="text-[0.75rem] text-muted">on behalf of {d.onBehalfOf.name}</div>}</td>
              <td className="text-[0.75rem] text-muted">{d.documentSha256 ? `SHA-256 ${d.documentSha256.slice(0, 16)}…` : "No agreement uploaded"}</td>
              <td className="text-[0.75rem] text-muted">workflow v{d.definitionVersion}<br />context {d.contextHash.slice(0, 10)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-rule px-4 py-3 text-[0.8rem] text-muted">Decisions are append-only. Each one is pinned to the agreement file and routing configuration in effect when it was made.</p>
    </Panel>
  );
}

async function LegalTab({ detail, myTasks }: { detail: Detail; myTasks: { id: string; name: string }[] }) {
  const { contract: c, orgs, can } = detail;
  const agreement = await currentAgreementVersion(db, c.id);
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-5">
        <Panel title="Legal review" actions={<Status value={c.legalStatus} />}>
          <KV items={[["Reviewing office", orgs.legal?.name ?? "—"], ["Agreement under review", agreement ? `${agreement.fileName} (v${agreement.versionNo})` : "Not uploaded"]]} />
          {myTasks.length > 0 ? (
            <div className="mt-5 border-t border-rule pt-4">
              {myTasks.map((t) => <LegalTaskActions key={t.id} taskId={t.id} legalStatus={c.legalStatus} />)}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">{c.legalStatus === "CLEARED" ? "Legal has cleared this agreement." : "Legal actions appear here for the reviewing office when the Legal step is active."}</p>
          )}
        </Panel>
        <Panel title={`Issues and clause exceptions (${c.legalIssues.length})`} flush>
          {c.legalIssues.length === 0 ? (
            <Empty title="No issues logged" />
          ) : (
            <ul className="divide-y divide-rule-soft">
              {c.legalIssues.map((i) => (
                <li key={i.id} className="px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{i.clauseRef && <span className="mr-1 text-muted">{i.clauseRef}</span>}{i.title}</p>
                      {i.detail && <p className="mt-0.5 text-ink-soft">{i.detail}</p>}
                      <p className="mt-0.5 text-[0.8rem] text-muted">{i.raisedBy.name} · {formatDateTime(i.createdAt)}</p>
                      {i.resolution && <p className="mt-1 text-[0.85rem]">Resolution: {i.resolution}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5"><Pill tone={i.severity === "HIGH" ? "red" : i.severity === "MODERATE" ? "amber" : "neutral"}>{i.severity.toLowerCase()}</Pill><Status value={i.status} /></div>
                  </div>
                  {can.legal && i.status === "OPEN" && <ResolveIssue issueId={i.id} />}
                </li>
              ))}
            </ul>
          )}
          {can.legal && <div className="border-t border-rule p-4"><LegalIssueForm contractId={c.id} /></div>}
        </Panel>
      </div>
      <Panel title="Redlines">
        <p className="text-sm text-ink-soft">
          Upload the County or City markup as a <strong>new version of the agreement</strong> from the Documents tab. Tracked changes in .docx files are preserved and flagged, and
          each version can be compared word by word.
        </p>
        <p className="mt-3"><Link className="font-semibold text-teal hover:underline" href={`/contracts/${c.id}?tab=documents`}>Go to documents</Link></p>
        <p className="mt-4 text-[0.8rem] text-muted">The CLM does not edit Word track changes in the browser; reviewers work in Word and upload each round.</p>
      </Panel>
    </div>
  );
}

async function SignatureTab({ detail }: { detail: Detail }) {
  const { contract: c, can } = detail;
  const blockers = c.status === "PENDING_SIGNATURE" || c.signatureStatus === "READY" ? await executionBlockers(db, c) : [];
  const authorized = can.administer && c.status === "PENDING_SIGNATURE" ? await authorizedSignatories(db, c) : [];
  const everyone = can.administer ? await db.select({ id: user.id, name: user.name, title: user.title }).from(user).where(eq(user.active, true)) : [];
  const contacts = c.vendorId ? await db.select().from(vendorContact).where(eq(vendorContact.vendorId, c.vendorId)) : [];
  const checks = await db
    .select({ chk: signingAuthorityCheck, signer: user.name })
    .from(signingAuthorityCheck)
    .innerJoin(user, eq(user.id, signingAuthorityCheck.signerId))
    .where(eq(signingAuthorityCheck.contractId, c.id))
    .orderBy(desc(signingAuthorityCheck.createdAt));
  return (
    <div className="space-y-5">
      {c.status === "PENDING_SIGNATURE" && c.signatureStatus === "READY" && (
        <Panel title="Prepare the signature package">
          {blockers.length > 0 ? (
            <Notice tone="red" title="Execution is blocked">
              <ul className="list-disc pl-5">{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
            </Notice>
          ) : can.administer ? (
            <>
              <p className="mb-4 text-sm text-muted">
                Required approvals and Legal clearance are complete. The signatory&apos;s authority for {detail.orgs.entity.name} is checked now and again when signing completes.
                {authorized.length === 0 && " No one currently holds valid authority for this contract; record authority before sending."}
              </p>
              <SendSignatureForm
                contractId={c.id}
                authorized={authorized.map((a) => ({ userId: a.userId, name: a.name, title: a.title, reference: a.authority.authorizingReference }))}
                everyone={everyone}
                vendorSigners={contacts.filter((x) => x.isSigner).map((x) => ({ name: x.name, email: x.email }))}
              />
              <details className="mt-6 border-t border-rule pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-teal">Signed outside the CLM? Record the executed agreement</summary>
                <div className="mt-3"><ExternalExecutionForm contractId={c.id} signers={everyone} /></div>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted">Ready for a contract administrator to prepare the signature package.</p>
          )}
        </Panel>
      )}

      {c.signatureRequests.length > 0 && (
        <Panel title="Signature requests" flush>
          <ul className="divide-y divide-rule-soft">
            {[...c.signatureRequests].sort((a, b) => +b.sentAt - +a.sentAt).map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{r.provider === "mock" ? "Development mock provider" : r.provider} · {r.providerEnvelopeId}</span>
                  <span className="flex gap-1.5">{r.isMock && <Pill tone="red">Mock — not legally binding</Pill>}<Status value={r.status === "COMPLETED" ? "COMPLETED" : r.status} /></span>
                </div>
                <ol className="mt-2 space-y-1">
                  {[...r.signers].sort((a, b) => a.order - b.order).map((s) => (
                    <li key={s.id} className="flex items-center gap-2"><span className="w-5 text-muted">{s.order}.</span><span>{s.name}</span><span className="text-muted">({s.signerType.toLowerCase()})</span><Pill tone={s.status === "SIGNED" ? "green" : s.status === "SENT" ? "amber" : "neutral"}>{s.status.toLowerCase()}</Pill>{s.signedAt && <span className="text-[0.8rem] text-muted">{formatDateTime(s.signedAt)}</span>}</li>
                  ))}
                </ol>
                {can.administer && ["SENT", "PARTIALLY_SIGNED"].includes(r.status) && <SignatureRequestActions requestId={r.id} isMock={r.isMock} />}
                {can.administer && r.status === "COMPLETING" && <RetryCompletion requestId={r.id} />}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Signing authority checks" flush>
        {checks.length === 0 ? (
          <Empty title="No authority checks yet">Each attempt to send or record a signature checks the signatory against the signing-authority registry.</Empty>
        ) : (
          <table className="tbl">
            <thead><tr><th>When</th><th>Signatory</th><th>Phase</th><th>Result</th><th>Basis</th></tr></thead>
            <tbody>
              {checks.map(({ chk, signer }) => (
                <tr key={chk.id}>
                  <td className="whitespace-nowrap text-[0.85rem]">{formatDateTime(chk.createdAt)}</td>
                  <td>{signer}</td>
                  <td className="text-[0.85rem]">{chk.phase.toLowerCase()}</td>
                  <td>{chk.passed ? <Pill tone="green">Valid authority</Pill> : <Pill tone="red">Blocked</Pill>}</td>
                  <td className="text-[0.85rem]">{chk.passed ? "Authority verified" : (chk.reasons as { message: string }[]).map((r) => r.message).join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Financials({ detail }: { detail: Detail }) {
  const { contract: c } = detail;
  const fin = c.agencies.filter((a) => a.role === "FINANCIAL");
  const annual = toNumber(c.annualValue ?? c.totalValue);
  const split = fin.length ? allocate(annual, fin.map((f) => Number(f.allocationPct ?? 0))) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Commitments" flush>
        {c.commitments.length === 0 ? <Empty title="No commitments recorded" /> : (
          <table className="tbl">
            <thead><tr><th>Description</th><th>Type</th><th>Fiscal year</th><th className="num">Amount</th></tr></thead>
            <tbody>{c.commitments.map((f) => <tr key={f.id}><td>{f.description}</td><td className="text-[0.85rem]">{f.kind.replace(/_/g, " ").toLowerCase()}</td><td>{f.fiscalYear ? `FY${f.fiscalYear}` : "—"}</td><td className="num"><Money value={f.amount} /></td></tr>)}</tbody>
          </table>
        )}
        <p className="border-t border-rule px-4 py-3 text-[0.8rem] text-muted">Commitments are contractual obligations, not spending. Purchase orders, invoices and payments come from the ERP, the system of record.</p>
      </Panel>
      <Panel title="Cost allocation" flush>
        {fin.length === 0 ? <Empty title={`Fully funded by ${detail.orgs.entity.name}`} /> : (
          <table className="tbl">
            <thead><tr><th>Agency</th><th className="num">Share</th><th className="num">Annual amount</th></tr></thead>
            <tbody>{fin.map((f, i) => <tr key={f.id}><td>{f.org.name}</td><td className="num">{Number(f.allocationPct)}%</td><td className="num">{formatMoney(split[i])}</td></tr>)}</tbody>
          </table>
        )}
      </Panel>
      <Panel title="Purchase orders" flush>
        {c.purchaseOrders.length === 0 ? <Empty title="No purchase orders referenced" /> : (
          <table className="tbl">
            <thead><tr><th>PO number</th><th>Source</th><th className="num">Amount</th></tr></thead>
            <tbody>{c.purchaseOrders.map((p) => <tr key={p.id}><td>{p.poNumber}</td><td className="text-[0.85rem]">{p.source === "erp" ? "ERP" : "Entered manually"}</td><td className="num"><Money value={p.amount} /></td></tr>)}</tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Renewals({ detail, today }: { detail: Detail; today: string }) {
  const { contract: c, can } = detail;
  if (!c.renewals.length) return <Panel><Empty title="Renewal tracking starts when the contract is executed" /></Panel>;
  return (
    <div className="space-y-5">
      {[...c.renewals].sort((a, b) => (a.cycleExpiration < b.cycleExpiration ? 1 : -1)).map((r) => {
        const target = r.noticeDeadline ?? r.cycleExpiration;
        const left = daysBetween(today, target);
        return (
          <Panel key={r.id} title={`Term ending ${formatDate(r.cycleExpiration)}`} actions={<Status value={r.decision === "PENDING" ? "OPEN" : r.decision} />}>
            <KV cols={3} items={[
              ["Decide by", <span key="d" className={left < 0 ? "text-red" : left <= 30 ? "text-amber" : ""}>{formatDate(target)} ({left < 0 ? `${-left} days ago` : `${left} days`})</span>],
              ["If no action", c.autoRenew ? `Auto-renews for ${c.renewalTermMonths ?? "?"} months` : "Contract expires"],
              ["Renewal owner", r.owner.name],
              ["Price escalation", c.priceEscalation ?? "—"],
              ["Current annual value", <Money key="v" value={c.annualValue ?? c.totalValue} />],
              ["Decision", r.decision === "PENDING" ? "Not yet decided" : `${r.decision.toLowerCase()}${r.decisionNote ? ` — ${r.decisionNote}` : ""}`],
            ]} />
            {can.decideRenewal && r.decision === "PENDING" && c.status === "ACTIVE" && <div className="mt-5 border-t border-rule pt-4"><RenewalDecisionForm renewalId={r.id} current={r.decision} /></div>}
          </Panel>
        );
      })}
      <p className="text-[0.8rem] text-muted">Reminders go to the renewal owner, contract owner and service owner 180, 120, 90, 60 and 30 days before the decision date (configurable).</p>
    </div>
  );
}

function Obligations({ detail, today }: { detail: Detail; today: string }) {
  const { contract: c } = detail;
  if (!c.obligations.length) return <Panel><Empty title="No obligations recorded">Deliverables, certifications, insurance and exit obligations will be tracked here.</Empty></Panel>;
  return (
    <Panel flush title="Obligations">
      <table className="tbl">
        <thead><tr><th>Obligation</th><th>Category</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>{c.obligations.map((o) => {
          const overdue = o.status === "OVERDUE" || (o.status === "OPEN" && o.dueDate && o.dueDate < today);
          return <tr key={o.id}><td>{o.title}</td><td className="text-[0.85rem]">{o.category}</td><td className="text-[0.85rem]">{o.owner.name}</td><td><DateText value={o.dueDate} /></td><td><Status value={overdue ? "OVERDUE" : o.status} /></td></tr>;
        })}</tbody>
      </table>
    </Panel>
  );
}

async function Relationships({ detail }: { detail: Detail }) {
  const { contract: c } = detail;
  const rels = await db.select().from(contractRelationship).where(inArray(contractRelationship.fromId, [c.id]));
  const incoming = await db.select().from(contractRelationship).where(eq(contractRelationship.toId, c.id));
  const ids = [...rels.map((r) => r.toId), ...incoming.map((r) => r.fromId)];
  const others = ids.length ? await db.select({ id: contractTbl.id, number: contractTbl.number, title: contractTbl.title, status: contractTbl.status, typeId: contractTbl.typeId }).from(contractTbl).where(inArray(contractTbl.id, ids)) : [];
  const types = await db.select().from(contractType);
  const label: Record<string, [string, string]> = {
    SOW_UNDER: ["Statement of work under", "Statements of work"],
    AMENDS: ["Amends", "Amended by"],
    RENEWS: ["Renews", "Renewed by"],
    REPLACES: ["Replaces", "Replaced by"],
    RELATED: ["Related to", "Related to"],
  };
  const rows = [
    ...rels.map((r) => ({ rel: label[r.type][0], c: others.find((o) => o.id === r.toId)! })),
    ...incoming.map((r) => ({ rel: label[r.type][1], c: others.find((o) => o.id === r.fromId)! })),
  ].filter((r) => r.c);
  return (
    <Panel flush title="Related agreements">
      {rows.length === 0 ? <Empty title="No related agreements">Statements of work, amendments and renewals are linked here automatically.</Empty> : (
        <table className="tbl">
          <thead><tr><th>Relationship</th><th>Contract</th><th>Category</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td className="text-[0.85rem]">{r.rel}</td><td><Link className="font-semibold hover:text-teal hover:underline" href={`/contracts/${r.c.id}`}>{r.c.title}</Link><div className="text-[0.8rem] text-muted">{r.c.number}</div></td><td className="text-[0.85rem]">{types.find((t) => t.id === r.c.typeId)?.name}</td><td><Status value={r.c.status} /></td></tr>
          ))}</tbody>
        </table>
      )}
    </Panel>
  );
}

async function Audit({ contractId }: { contractId: string }) {
  const rows = await auditForContract(contractId);
  const users = await db.select({ id: user.id, name: user.name }).from(user);
  const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.name ?? "Unknown user" : "System");
  return (
    <Panel flush title={`${rows.length} recorded events`}>
      <ol className="divide-y divide-rule-soft">
        {rows.map((r) => (
          <li key={r.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[11rem_1fr]">
            <span className="text-[0.8rem] text-muted">{formatDateTime(r.at)}</span>
            <div>
              <p><strong>{r.action.replace(/_/g, " ").toLowerCase().replace(/^./, (x) => x.toUpperCase())}</strong> · {name(r.actorId)}</p>
              {r.data != null && (
                <details>
                  <summary className="cursor-pointer text-[0.8rem] text-teal">Details</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded bg-canvas p-2 text-[0.72rem]">{JSON.stringify(r.data, null, 2)}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-rule px-4 py-3 text-[0.8rem] text-muted">The audit log is append-only and hash-chained; administrators can verify the chain from Administration › Audit log.</p>
    </Panel>
  );
}

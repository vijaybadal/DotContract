"use server";
/**
 * Server actions used by the UI. Each one authenticates, calls the same service functions the REST
 * API uses (permissions are enforced there), and returns a plain result the client can display.
 * Next.js server actions verify the Origin header against the host (CSRF protection).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { notification, user } from "@/db/schema";
import { authMode, endSession, getActor, startSession } from "@/lib/auth/session";
import type { Actor } from "@/lib/authz";
import { canRunJobs, getOrgIndex } from "@/lib/authz";
import * as contracts from "@/lib/contracts";
import { uploadDocument, type DocKind } from "@/lib/documents";
import { isAppError } from "@/lib/errors";
import { runAllJobs } from "@/lib/jobs";
import { decideRenewal, type RenewalDecisionValue } from "@/lib/renewals";
import * as signing from "@/lib/signing";
import * as wf from "@/lib/workflow";
import { publishDefinitionVersion, previewRouting } from "@/lib/workflow-admin";
import { ForbiddenError } from "@/lib/errors";

export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; code?: string; details?: unknown };

async function run<T>(fn: (actor: Actor) => Promise<T>, revalidate: string[] = []): Promise<ActionResult<T>> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "Your session ended. Sign in again.", code: "UNAUTHENTICATED" };
  try {
    const data = await fn(actor);
    for (const p of revalidate) revalidatePath(p);
    return { ok: true, data };
  } catch (e) {
    if (isAppError(e)) return { ok: false, error: e.message, code: e.code, details: e.details };
    console.error(e);
    return { ok: false, error: "Something went wrong. The error was logged for the administrator." };
  }
}

// ───── Session
export async function signInAsDemoUser(formData: FormData) {
  if (authMode() !== "dev") throw new ForbiddenError("Demo sign-in is disabled.");
  const id = String(formData.get("userId") ?? "");
  const [u] = await db.select().from(user).where(and(eq(user.id, id), eq(user.isDemo, true), eq(user.active, true)));
  if (!u) redirect("/login?error=unknown");
  await startSession(u.id, "dev");
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  await endSession();
  redirect("/login");
}

// ───── Requests
export async function saveRequest(requestId: string | null, payload: unknown) {
  return run(async (a) => {
    if (requestId) {
      await contracts.updateRequest(a, requestId, payload);
      return { requestId };
    }
    return contracts.createRequest(a, payload);
  }, ["/requests", "/contracts"]);
}
export async function submitRequest(requestId: string) {
  return run((a) => contracts.submitRequest(a, requestId), ["/", "/requests", "/contracts", "/tasks"]);
}
export async function withdrawRequest(requestId: string, reason: string) {
  return run((a) => contracts.withdrawRequest(a, requestId, reason), ["/requests"]);
}

// ───── Approvals & legal
export async function decideTask(taskId: string, decision: wf.Decision, comment: string) {
  return run((a) => wf.decideTask(a, taskId, decision, comment || undefined), ["/", "/tasks", "/contracts"]);
}
export async function legalAction(taskId: string, action: wf.LegalAction, comment: string) {
  return run((a) => wf.legalAction(a, taskId, action, comment || undefined), ["/legal", "/contracts", "/tasks"]);
}
export async function reassignTask(taskId: string, toUserId: string, reason: string) {
  return run((a) => wf.reassignTask(a, taskId, toUserId, reason), ["/tasks", "/contracts"]);
}
export async function addAdHocApprover(instanceId: string, userId: string, name: string) {
  return run((a) => wf.addAdHocApprover(a, instanceId, userId, name), ["/contracts"]);
}
export async function addLegalIssue(contractId: string, input: { title: string; detail?: string; clauseRef?: string; severity?: "LOW" | "MODERATE" | "HIGH" }) {
  return run((a) => contracts.addLegalIssue(a, contractId, input), ["/contracts", "/legal"]);
}
export async function resolveLegalIssue(issueId: string, status: "RESOLVED" | "ACCEPTED_RISK", resolution: string) {
  return run((a) => contracts.resolveLegalIssue(a, issueId, status, resolution), ["/contracts", "/legal"]);
}
export async function amendTerms(contractId: string, patch: { totalValue?: number; expirationDate?: string }, reason: string) {
  return run((a) => contracts.amendTermsInReview(a, contractId, patch, reason), ["/contracts"]);
}

// ───── Documents
export async function uploadDocumentAction(formData: FormData) {
  return run(async (a) => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new (await import("@/lib/errors")).ValidationError("Choose a file to upload.");
    const res = await uploadDocument(a, {
      contractId: String(formData.get("contractId")),
      documentId: (formData.get("documentId") as string) || undefined,
      kind: ((formData.get("kind") as string) || "SUPPORTING") as DocKind,
      title: (formData.get("title") as string) || undefined,
      note: (formData.get("note") as string) || undefined,
      confidential: formData.get("confidential") === "on",
      isMaterialChange: formData.get("material") === "on",
      file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
    });
    return { versionNo: res.version.versionNo, scan: res.scan.status, trackedChanges: res.version.hasTrackedChanges, reopened: res.reopened };
  }, ["/contracts"]);
}

// ───── Signatures
export async function sendForSignature(contractId: string, input: signing.SendInput) {
  return run((a) => signing.sendForSignature(a, contractId, input), ["/signatures", "/contracts"]);
}
export async function simulateSigning(signatureRequestId: string) {
  return run((a) => signing.simulateMockSigning(a, signatureRequestId), ["/signatures", "/contracts", "/"]);
}
export async function voidSignature(signatureRequestId: string, reason: string) {
  return run((a) => signing.voidSignatureRequest(a, signatureRequestId, reason), ["/signatures", "/contracts"]);
}
export async function recordExternalExecution(formData: FormData) {
  return run(async (a) => {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new (await import("@/lib/errors")).ValidationError("Attach the executed agreement.");
    return signing.recordExternalExecution(a, String(formData.get("contractId")), {
      signerUserId: String(formData.get("signerUserId")),
      signedOn: String(formData.get("signedOn")),
      vendorSignerName: (formData.get("vendorSignerName") as string) || undefined,
      note: (formData.get("note") as string) || undefined,
      file: { name: file.name, type: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
    });
  }, ["/signatures", "/contracts", "/"]);
}
export async function createAuthority(input: signing.AuthorityInput) {
  return run((a) => signing.createAuthority(a, input), ["/admin/signing-authority"]);
}
export async function revokeAuthority(id: string, reason: string) {
  return run((a) => signing.revokeAuthority(a, id, reason), ["/admin/signing-authority"]);
}

// ───── Renewals, jobs, notifications
export async function decideRenewalAction(renewalId: string, decision: RenewalDecisionValue, note: string) {
  return run((a) => decideRenewal(a, renewalId, decision, note), ["/renewals", "/contracts"]);
}
export async function runJobsNow() {
  return run(async (a) => {
    if (!canRunJobs(a, await getOrgIndex())) throw new ForbiddenError("Only CLM administrators can run scheduled jobs on demand.");
    return runAllJobs();
  }, ["/", "/renewals", "/notifications"]);
}
export async function markAllNotificationsRead() {
  return run(async (a) => {
    await db.update(notification).set({ readAt: new Date() }).where(and(eq(notification.userId, a.id), isNull(notification.readAt)));
  }, ["/notifications"]);
}

// ───── Workflow administration
export async function publishWorkflow(key: string, input: unknown) {
  return run((a) => publishDefinitionVersion(a, key, input), ["/admin/workflows"]);
}
export async function previewWorkflow(definitionId: string, contractId: string) {
  return run((a) => previewRouting(a, definitionId, contractId));
}

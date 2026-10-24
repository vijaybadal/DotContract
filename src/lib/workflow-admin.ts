/**
 * Workflow administration: definitions are versioned and immutable once created. Editing a workflow
 * creates a new version; running instances keep the version they started with, and every decision
 * records the version it was made under.
 */
import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contract, contractRequest, workflowDefinition, workflowStepDefinition } from "@/db/schema";
import { writeAudit } from "./audit";
import { assertCanViewContract, canAdministerWorkflows, getOrgIndex, ROLE_KEYS, type Actor } from "./authz";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { applies, describe, validateRule, type Rule } from "./rules";
import { buildContext } from "./workflow";
import { REQUEST_TYPES } from "./contracts";

const stepSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9-]+$/, "Step keys use lowercase letters, digits and hyphens"),
  name: z.string().trim().min(2),
  stage: z.coerce.number().int().min(1).max(20),
  kind: z.enum(["APPROVAL", "LEGAL_REVIEW"]),
  roleKey: z.enum(ROLE_KEYS),
  scope: z.enum(["REQUESTING_DEPT", "BENEFITING_AGENCY", "CONTRACTING_ENTITY", "ADMINISTERING_ORG", "LEGAL_AUTHORITY"]),
  condition: z.unknown().nullable().optional(),
  dueDays: z.coerce.number().int().min(1).max(90),
  reapproveOnMaterialChange: z.boolean().default(false),
});
const defSchema = z.object({
  name: z.string().trim().min(3),
  description: z.string().trim().optional().nullable(),
  requestTypes: z.array(z.enum(REQUEST_TYPES)).min(1),
  variables: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  steps: z.array(stepSchema).min(1),
});
export type DefinitionInput = z.input<typeof defSchema>;

export async function listDefinitions() {
  return db.query.workflowDefinition.findMany({
    orderBy: [asc(workflowDefinition.key), desc(workflowDefinition.version)],
    with: { steps: { orderBy: [asc(workflowStepDefinition.stage), asc(workflowStepDefinition.key)] } },
  });
}

export async function publishDefinitionVersion(actor: Actor, key: string, raw: unknown) {
  const idx = await getOrgIndex();
  if (!canAdministerWorkflows(actor, idx)) throw new ForbiddenError("Only enterprise CLM administrators can change workflows.");
  const parsed = defSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Workflow definition is invalid.", parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })));
  const input = parsed.data;
  const keys = new Set<string>();
  for (const s of input.steps) {
    if (keys.has(s.key)) throw new ValidationError(`Duplicate step key ${s.key}.`);
    keys.add(s.key);
    const err = validateRule(s.condition ?? null);
    if (err) throw new ValidationError(`Condition for "${s.name}" is invalid: ${err}`);
  }
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(workflowDefinition).where(eq(workflowDefinition.key, key)).orderBy(desc(workflowDefinition.version)).limit(1);
    if (!prev) throw new NotFoundError("Workflow");
    await tx.update(workflowDefinition).set({ active: false }).where(eq(workflowDefinition.key, key));
    const [def] = await tx
      .insert(workflowDefinition)
      .values({ key, version: prev.version + 1, name: input.name, description: input.description ?? null, requestTypes: input.requestTypes, variables: input.variables, createdById: actor.id })
      .returning();
    await tx.insert(workflowStepDefinition).values(input.steps.map((s) => ({ ...s, condition: (s.condition ?? null) as never, definitionId: def.id })));
    await writeAudit(tx, { actorId: actor.id, action: "WORKFLOW_VERSION_PUBLISHED", entityType: "workflow_definition", entityId: def.id, data: { key, version: def.version, previous: prev.version, input } });
    return def;
  });
}

/** Routing preview ("rules sandbox"): which steps would apply to an existing contract under a definition. */
export async function previewRouting(actor: Actor, definitionId: string, contractId: string) {
  const def = await db.query.workflowDefinition.findFirst({ where: eq(workflowDefinition.id, definitionId), with: { steps: true } });
  if (!def) throw new NotFoundError("Workflow");
  const [c] = await db.select().from(contract).where(eq(contract.id, contractId));
  if (!c) throw new NotFoundError("Contract");
  await assertCanViewContract(actor, c);
  const [req] = await db.select().from(contractRequest).where(and(eq(contractRequest.contractId, c.id))).limit(1);
  const ctx = await buildContext(db, c, req?.type ?? "NEW_CONTRACT", def.variables);
  return {
    context: ctx,
    steps: def.steps
      .sort((a, b) => a.stage - b.stage)
      .map((s) => ({ stage: s.stage, name: s.name, roleKey: s.roleKey, scope: s.scope, rule: describe(s.condition as Rule), applies: applies(s.condition as Rule, ctx) })),
  };
}

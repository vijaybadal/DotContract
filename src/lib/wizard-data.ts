import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contractDocument } from "@/db/schema";
import { canAdministerWorkflows, getOrgIndex, isSystemAdmin, type Actor } from "./authz";
import { listContracts, referenceData } from "./contracts";
import type { WizardValues } from "@/components/client/request-wizard";

export async function wizardRef(actor: Actor) {
  const [ref, idx, parents] = await Promise.all([referenceData(), getOrgIndex(), listContracts(actor, { status: "ACTIVE", sort: "number" })]);
  const roles = ["REQUESTER", "CONTRACT_OWNER", "CLM_ADMIN"];
  const myDepts = isSystemAdmin(actor, idx)
    ? ref.orgs.map((o) => o.id)
    : [...new Set(actor.assignments.filter((a) => roles.includes(a.roleKey)).flatMap((a) => [a.orgId, ...(a.includeChildren ? idx.descendants(a.orgId) : [])]))];
  return {
    orgs: ref.orgs.map((o) => ({ id: o.id, name: o.name, parentId: o.parentId, isLegalEntity: o.isLegalEntity, kind: o.kind })),
    types: ref.types.map((t) => ({ key: t.key, name: t.name, isSubscription: t.isSubscription, requiresParent: t.requiresParent, customFields: t.customFields })),
    vendors: ref.vendors,
    users: ref.users,
    parents: parents.map((p) => ({ id: p.id, number: p.number, title: p.title })),
    myDepts,
    canWaiveLegal: canAdministerWorkflows(actor, idx) || actor.assignments.some((a) => a.roleKey === "CLM_ADMIN"),
  };
}

export function blankValues(actor: Actor, myDepts: string[]): WizardValues {
  return {
    requestType: "NEW_CONTRACT",
    title: "",
    typeKey: "SAAS",
    vendorId: "",
    newVendorName: "",
    businessPurpose: "",
    description: "",
    requestingDeptId: actor.primaryOrgId && myDepts.includes(actor.primaryOrgId) ? actor.primaryOrgId : (myDepts[0] ?? ""),
    contractingEntityId: "",
    administeringOrgId: "",
    benefitingAgencyIds: [],
    financialAllocations: [],
    ownerId: actor.id,
    serviceOwnerId: "",
    totalValue: "",
    annualValue: "",
    fundingSource: "",
    effectiveDate: "",
    expirationDate: "",
    autoRenew: false,
    renewalTermMonths: "",
    noticeDays: "",
    priceEscalation: "",
    parentContractId: "",
    dataSensitivity: "INTERNAL",
    riskLevel: "MODERATE",
    legalRequired: true,
    confidential: false,
    purchasingNotes: "",
    customFieldValues: {},
    subscription: null,
  };
}

type Loaded = {
  type: string;
  justification: string | null;
  contract: {
    id: string;
    title: string;
    description: string | null;
    businessPurpose: string | null;
    type: { key: string };
    vendorId: string | null;
    requestingDeptId: string;
    contractingEntityId: string;
    administeringOrgId: string;
    agencies: { orgId: string; role: string; allocationPct: string | null }[];
    ownerId: string;
    serviceOwnerId: string | null;
    totalValue: string;
    annualValue: string | null;
    fundingSource: string | null;
    effectiveDate: string | null;
    expirationDate: string | null;
    autoRenew: boolean;
    renewalTermMonths: number | null;
    noticeDays: number | null;
    priceEscalation: string | null;
    parentContractId: string | null;
    dataSensitivity: string;
    riskLevel: string;
    legalRequired: boolean;
    confidential: boolean;
    purchasingNotes: string | null;
    customFieldValues: Record<string, unknown>;
    subscriptions: { product: string; plan: string | null; licensedQty: number; unitCost: string; billingFrequency: string }[];
  };
};

export function valuesFrom(r: Loaded): WizardValues {
  const c = r.contract;
  const s = c.subscriptions[0];
  return {
    requestType: r.type,
    title: c.title,
    typeKey: c.type.key,
    vendorId: c.vendorId ?? "",
    newVendorName: "",
    businessPurpose: c.businessPurpose ?? "",
    description: c.description ?? "",
    requestingDeptId: c.requestingDeptId,
    contractingEntityId: c.contractingEntityId,
    administeringOrgId: c.administeringOrgId,
    benefitingAgencyIds: c.agencies.filter((a) => a.role === "BENEFITING").map((a) => a.orgId),
    financialAllocations: c.agencies.filter((a) => a.role === "FINANCIAL").map((a) => ({ orgId: a.orgId, pct: Number(a.allocationPct ?? 0) })),
    ownerId: c.ownerId,
    serviceOwnerId: c.serviceOwnerId ?? "",
    totalValue: Number(c.totalValue) ? String(Number(c.totalValue)) : "",
    annualValue: c.annualValue ? String(Number(c.annualValue)) : "",
    fundingSource: c.fundingSource ?? "",
    effectiveDate: c.effectiveDate ?? "",
    expirationDate: c.expirationDate ?? "",
    autoRenew: c.autoRenew,
    renewalTermMonths: c.renewalTermMonths?.toString() ?? "",
    noticeDays: c.noticeDays?.toString() ?? "",
    priceEscalation: c.priceEscalation ?? "",
    parentContractId: c.parentContractId ?? "",
    dataSensitivity: c.dataSensitivity,
    riskLevel: c.riskLevel,
    legalRequired: c.legalRequired,
    confidential: c.confidential,
    purchasingNotes: c.purchasingNotes ?? "",
    customFieldValues: Object.fromEntries(Object.entries(c.customFieldValues).map(([k, v]) => [k, String(v ?? "")])),
    subscription: s ? { product: s.product, plan: s.plan ?? "", licensedQty: String(s.licensedQty), unitCost: String(Number(s.unitCost)), billingFrequency: s.billingFrequency } : null,
  };
}

export async function docsFor(contractId: string) {
  return db.select({ id: contractDocument.id, title: contractDocument.title, kind: contractDocument.kind }).from(contractDocument).where(eq(contractDocument.contractId, contractId));
}

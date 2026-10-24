/**
 * Demonstration data. Everything here is SYNTHETIC: people, vendors, amounts, approval thresholds
 * and signing authorities are invented for demonstration and are NOT City, County or DOTComm policy.
 *
 * Organizations, users, vendors and legacy (already-executed) contracts are inserted directly.
 * In-flight requests are driven through the real services (create → submit → decide) so their
 * workflow state, audit trail and notifications are exactly what the application would produce.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";
import { DOCX_MIME, makeDocx, makePdf, STANDARD_TERMS } from "./fixtures";
import { writeAudit } from "@/lib/audit";
import { invalidateOrgCache, loadActor, ROLE_KEYS } from "@/lib/authz";
import { addDays, todayIn } from "@/lib/dates";
import { nextNumber } from "@/lib/counter";
import { uploadDocument } from "@/lib/documents";
import { createRequest, submitRequest, addLegalIssue } from "@/lib/contracts";
import { decideTask, legalAction } from "@/lib/workflow";
import { ForbiddenError } from "@/lib/errors";
import { ensureRenewalCycle, runRenewalReminders } from "@/lib/renewals";

const ROLE_INFO: Record<(typeof ROLE_KEYS)[number], [string, string]> = {
  SYSTEM_ADMIN: ["System Administrator", "Platform configuration and user administration"],
  CLM_ADMIN: ["Contract Administrator", "Administers contracts, signature packages and workflow configuration for an organization"],
  REQUESTER: ["Contract Requester", "Submits contract requests for a department"],
  CONTRACT_OWNER: ["Contract Owner", "Accountable for a contract's business outcome"],
  SERVICE_OWNER: ["Service Owner", "Technical owner of the service delivered under a contract"],
  PURCHASING_REVIEWER: ["Purchasing Reviewer", "Reviews procurement method and compliance"],
  FINANCE_REVIEWER: ["Finance Reviewer", "Confirms funding and budget availability"],
  LEGAL_REVIEWER: ["Legal Reviewer", "Reviews, negotiates and clears agreements for a legal office"],
  SECURITY_REVIEWER: ["Information Security Reviewer", "Reviews data protection and vendor security"],
  DEPARTMENT_APPROVER: ["Department Approver", "Approves requests for a department"],
  AGENCY_EXECUTIVE: ["Agency Executive", "Executive approval for an agency or administering organization"],
  DOTCOMM_MANAGEMENT: ["DOTComm Management", "DOTComm leadership review"],
  AUTHORIZED_SIGNATORY: ["Authorized Signatory", "May be named as signatory; actual authority comes from the signing-authority registry"],
  AUTHORITY_ADMIN: ["Signing Authority Administrator", "Records and revokes signing authority for a legal entity"],
  AUDITOR: ["Auditor (read-only)", "Read-only access to contracts, workflow and audit history"],
};

type OrgSpec = { code: string; name: string; kind: (typeof s.orgKind.enumValues)[number]; parent?: string; legal?: boolean; legalAuthority?: string };
const ORGS: OrgSpec[] = [
  { code: "DOTCOMM", name: "DOTComm", kind: "ENTERPRISE", legal: true, legalAuthority: "CTY-ATTY" },
  { code: "DOT-AA", name: "Applications & Analytics", kind: "DEPARTMENT", parent: "DOTCOMM" },
  { code: "DOT-INF", name: "Infrastructure & Operations", kind: "DEPARTMENT", parent: "DOTCOMM" },
  { code: "DOT-SEC", name: "Information Security", kind: "DEPARTMENT", parent: "DOTCOMM" },
  { code: "DOT-CTR", name: "Contracts & Vendor Management", kind: "DEPARTMENT", parent: "DOTCOMM" },
  { code: "CITY", name: "City of Omaha", kind: "GOVERNMENT", legal: true, legalAuthority: "CITY-LAW" },
  { code: "CITY-FIN", name: "Finance", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-OPD", name: "Police", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-OFD", name: "Fire", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-PLN", name: "Planning", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-PW", name: "Public Works", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-PUR", name: "Purchasing", kind: "DEPARTMENT", parent: "CITY" },
  { code: "CITY-LAW", name: "Law Department", kind: "OFFICE", parent: "CITY" },
  { code: "COUNTY", name: "Douglas County", kind: "GOVERNMENT", legal: true, legalAuthority: "CTY-ATTY" },
  { code: "CTY-TRS", name: "Treasurer", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-CLK", name: "Clerk", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-HR", name: "Human Resources", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-FIN", name: "Finance", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-ASR", name: "Assessor / Register of Deeds", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-PUR", name: "Purchasing", kind: "DEPARTMENT", parent: "COUNTY" },
  { code: "CTY-ATTY", name: "County Attorney — Civil Division", kind: "OFFICE", parent: "COUNTY" },
];

type UserSpec = { key: string; name: string; title: string; org: string; roles: [string, string, boolean?][] };
const USERS: UserSpec[] = [
  { key: "sam", name: "Sam Rivera", title: "Platform Administrator", org: "DOTCOMM", roles: [["SYSTEM_ADMIN", "DOTCOMM"]] },
  { key: "dana", name: "Dana Whitfield", title: "Contract Administrator", org: "DOT-CTR", roles: [["CLM_ADMIN", "DOTCOMM"]] },
  { key: "priya", name: "Priya Natarajan", title: "Applications Manager", org: "DOT-AA", roles: [["REQUESTER", "DOT-AA"], ["CONTRACT_OWNER", "DOT-AA"], ["SERVICE_OWNER", "DOT-AA"]] },
  { key: "marcus", name: "Marcus Hale", title: "Director, Applications & Analytics", org: "DOT-AA", roles: [["DEPARTMENT_APPROVER", "DOT-AA"]] },
  { key: "ken", name: "Ken Osei", title: "Director, Infrastructure & Security", org: "DOT-INF", roles: [["DEPARTMENT_APPROVER", "DOT-INF"], ["DEPARTMENT_APPROVER", "DOT-SEC"], ["DEPARTMENT_APPROVER", "DOT-CTR"]] },
  { key: "greg", name: "Greg Novak", title: "Infrastructure Manager", org: "DOT-INF", roles: [["REQUESTER", "DOT-INF"], ["CONTRACT_OWNER", "DOT-INF"]] },
  { key: "elaine", name: "Elaine Cho", title: "Executive Director & CIO", org: "DOTCOMM", roles: [["DOTCOMM_MANAGEMENT", "DOTCOMM"], ["AGENCY_EXECUTIVE", "DOTCOMM"], ["AUTHORIZED_SIGNATORY", "DOTCOMM"]] },
  { key: "aisha", name: "Aisha Rahman", title: "Information Security Officer", org: "DOT-SEC", roles: [["SECURITY_REVIEWER", "DOTCOMM"], ["SECURITY_REVIEWER", "CITY"], ["SECURITY_REVIEWER", "COUNTY"], ["CONTRACT_OWNER", "DOT-SEC"]] },
  { key: "raymond", name: "Raymond Ortiz", title: "County Purchasing Agent", org: "CTY-PUR", roles: [["PURCHASING_REVIEWER", "COUNTY"], ["PURCHASING_REVIEWER", "DOTCOMM"]] },
  { key: "linda", name: "Linda Park", title: "City Purchasing Manager", org: "CITY-PUR", roles: [["PURCHASING_REVIEWER", "CITY"]] },
  { key: "grace", name: "Grace Mbeki", title: "County Finance Analyst", org: "CTY-FIN", roles: [["FINANCE_REVIEWER", "COUNTY"], ["FINANCE_REVIEWER", "DOTCOMM"]] },
  { key: "tom", name: "Tom Brennan", title: "City Budget Analyst", org: "CITY-FIN", roles: [["FINANCE_REVIEWER", "CITY"]] },
  { key: "jonathan", name: "Jonathan Pryce", title: "Deputy County Attorney (Civil)", org: "CTY-ATTY", roles: [["LEGAL_REVIEWER", "CTY-ATTY"], ["AUTHORITY_ADMIN", "COUNTY"], ["AUTHORITY_ADMIN", "DOTCOMM"]] },
  { key: "maria", name: "Maria Delgado", title: "Assistant City Attorney", org: "CITY-LAW", roles: [["LEGAL_REVIEWER", "CITY-LAW"], ["AUTHORITY_ADMIN", "CITY"]] },
  { key: "kevin", name: "Kevin Lindqvist", title: "Treasurer IT Liaison", org: "CTY-TRS", roles: [["REQUESTER", "CTY-TRS"], ["CONTRACT_OWNER", "CTY-TRS"], ["REQUESTER", "CTY-ASR"]] },
  { key: "luis", name: "Luis Romero", title: "Treasurer Operations Manager", org: "CTY-TRS", roles: [["DEPARTMENT_APPROVER", "CTY-TRS"], ["DEPARTMENT_APPROVER", "CTY-ASR"]] },
  { key: "beth", name: "Beth Anders", title: "Chief Deputy Treasurer", org: "CTY-TRS", roles: [["AGENCY_EXECUTIVE", "CTY-TRS"], ["AGENCY_EXECUTIVE", "CTY-ASR"]] },
  { key: "paul", name: "Paul Haddad", title: "Records Manager", org: "CTY-CLK", roles: [["REQUESTER", "CTY-CLK"], ["CONTRACT_OWNER", "CTY-CLK"]] },
  { key: "ellen", name: "Ellen Price", title: "Chief Deputy Clerk", org: "CTY-CLK", roles: [["DEPARTMENT_APPROVER", "CTY-CLK"], ["AGENCY_EXECUTIVE", "CTY-CLK"]] },
  { key: "monique", name: "Monique Carter", title: "HR Systems Manager", org: "CTY-HR", roles: [["REQUESTER", "CTY-HR"], ["REQUESTER", "CTY-FIN"], ["CONTRACT_OWNER", "CTY-HR"], ["DEPARTMENT_APPROVER", "CTY-FIN"]] },
  { key: "harold", name: "Harold Jensen", title: "County Board Chair (demo signatory)", org: "COUNTY", roles: [["AUTHORIZED_SIGNATORY", "COUNTY"], ["AGENCY_EXECUTIVE", "COUNTY"]] },
  { key: "victoria", name: "Victoria Sloan", title: "City Chief Administrative Officer (demo signatory)", org: "CITY", roles: [["AUTHORIZED_SIGNATORY", "CITY"], ["AGENCY_EXECUTIVE", "CITY"]] },
  { key: "nina", name: "Nina Kowalski", title: "Public Safety IT Coordinator", org: "CITY-OPD", roles: [["REQUESTER", "CITY-OPD"], ["REQUESTER", "CITY-OFD"], ["CONTRACT_OWNER", "CITY-OPD"], ["CONTRACT_OWNER", "CITY-OFD"]] },
  { key: "james", name: "James Whitaker", title: "Deputy Chief, Police Support Services", org: "CITY-OPD", roles: [["DEPARTMENT_APPROVER", "CITY-OPD"], ["DEPARTMENT_APPROVER", "CITY-OFD"]] },
  { key: "sofia", name: "Sofia Reyes", title: "Planning Systems Analyst", org: "CITY-PLN", roles: [["REQUESTER", "CITY-PLN"], ["CONTRACT_OWNER", "CITY-PLN"]] },
  { key: "andre", name: "Andre Lewis", title: "Planning Director", org: "CITY-PLN", roles: [["DEPARTMENT_APPROVER", "CITY-PLN"], ["DEPARTMENT_APPROVER", "CITY-PW"]] },
  { key: "owen", name: "Owen Fitch", title: "Internal Auditor", org: "DOTCOMM", roles: [["AUDITOR", "DOTCOMM"]] },
];

const TYPES: { key: string; name: string; sub?: boolean; deliv?: boolean; parent?: boolean; fields?: s.CustomFieldDef[] }[] = [
  { key: "SAAS", name: "SaaS / Cloud Subscription", sub: true, fields: [{ key: "hostingLocation", label: "Data hosting location", type: "text" }, { key: "sso", label: "Supports SSO (yes/no)", type: "text" }] },
  { key: "SOFTWARE_LICENSE", name: "Software Licensing", sub: true },
  { key: "HARDWARE", name: "Hardware & Infrastructure", fields: [{ key: "deliveryDate", label: "Expected delivery date", type: "date" }] },
  { key: "PROFESSIONAL_SERVICES", name: "Professional Services", deliv: true, fields: [{ key: "deliverables", label: "Key deliverables & milestones", type: "text", required: true }, { key: "rates", label: "Rates / rate card", type: "text" }] },
  { key: "CONSULTING", name: "Consulting & Staff Augmentation", deliv: true, fields: [{ key: "rates", label: "Hourly rates by role", type: "text", required: true }, { key: "resources", label: "Committed resources", type: "text" }] },
  { key: "MANAGED_SERVICES", name: "Managed Services", fields: [{ key: "sla", label: "Key service levels", type: "text" }] },
  { key: "TELECOM", name: "Telecommunications" },
  { key: "SOFTWARE_MAINTENANCE", name: "Software Maintenance & Support" },
  { key: "MSA", name: "Master Services Agreement" },
  { key: "SOW", name: "Statement of Work", deliv: true, parent: true, fields: [{ key: "deliverables", label: "Deliverables & milestones", type: "text", required: true }, { key: "rates", label: "Rates", type: "text" }] },
  { key: "NDA", name: "Non-Disclosure Agreement" },
  { key: "DPA", name: "Data Processing / Security Agreement" },
  { key: "AMENDMENT", name: "Amendment / Renewal", parent: true },
  { key: "OTHER", name: "Other Technology Agreement" },
];

const VENDORS = [
  ["northwind", "Northwind Cloud Systems", "SaaS", "Email, collaboration and productivity suite", "APPROVED"],
  ["prairie", "Prairie GIS Solutions", "Software", "Enterprise GIS platform", "APPROVED"],
  ["keystone", "Keystone Public Safety Software", "Software", "CAD, records management, evidence management", "APPROVED_WITH_CONDITIONS"],
  ["riverbend", "Riverbend Networks", "Telecommunications", "Metro fiber, internet and voice circuits", "APPROVED"],
  ["bluestem", "Bluestem Data Center Services", "Managed services", "Colocation, backup and disaster recovery", "APPROVED"],
  ["heartland", "Heartland Tax Systems", "Software", "Tax collection and CAMA software", "APPROVED"],
  ["summit", "Summit Identity Inc.", "SaaS", "Identity, SSO and MFA", "APPROVED"],
  ["granite", "Granite Help Desk Software", "SaaS", "IT service management", "APPROVED"],
  ["meridian", "Meridian Payroll Cloud", "SaaS", "Payroll and HR", "APPROVED"],
  ["lakeside", "Lakeside Records Management", "Software / services", "Records management and digitization", "IN_REVIEW"],
  ["clearbrook", "Clearbrook Analytics Partners", "Consulting", "Data and analytics consulting", "NOT_REVIEWED"],
  ["platte", "Platte Valley Hardware Supply", "Hardware reseller", "End-user and network hardware", "NOT_REVIEWED"],
  ["sentinel", "Sentinel Watch Security", "Managed security", "24x7 security monitoring and EDR", "APPROVED"],
  ["civicflow", "CivicFlow Software", "SaaS", "Permitting and licensing portal", "APPROVED"],
] as const;

export async function seedDatabase(opts: { today?: string; inFlight?: boolean } = {}) {
  const today = opts.today ?? todayIn();
  const d = (n: number) => addDays(today, n);

  // ───── Reference data
  await db.insert(s.role).values(ROLE_KEYS.map((k) => ({ key: k, name: ROLE_INFO[k][0], description: ROLE_INFO[k][1] })));
  const org: Record<string, string> = {};
  for (const o of ORGS) {
    const [row] = await db
      .insert(s.organization)
      .values({ code: o.code, name: o.name, kind: o.kind, parentId: o.parent ? org[o.parent] : null, isLegalEntity: Boolean(o.legal) })
      .returning();
    org[o.code] = row.id;
  }
  for (const o of ORGS.filter((x) => x.legalAuthority)) {
    await db.update(s.organization).set({ legalAuthorityId: org[o.legalAuthority!] }).where(eq(s.organization.id, org[o.code]));
  }
  invalidateOrgCache();

  const u: Record<string, string> = {};
  for (const x of USERS) {
    const [row] = await db
      .insert(s.user)
      .values({ email: `${x.key}@demo.clm.invalid`, name: x.name, title: x.title, primaryOrgId: org[x.org], isDemo: true })
      .returning();
    u[x.key] = row.id;
    for (const [roleKey, orgCode, incl] of x.roles) {
      await db.insert(s.userRoleAssignment).values({ userId: row.id, roleKey, orgId: org[orgCode], includeChildren: incl ?? true });
    }
  }

  const type: Record<string, string> = {};
  for (const [i, t] of TYPES.entries()) {
    const [row] = await db
      .insert(s.contractType)
      .values({ key: t.key, name: t.name, isSubscription: Boolean(t.sub), requiresDeliverables: Boolean(t.deliv), requiresParent: Boolean(t.parent), customFields: t.fields ?? [], sortOrder: i })
      .returning();
    type[t.key] = row.id;
  }

  const v: Record<string, string> = {};
  for (const [i, [key, name, cls, prod, sec]] of VENDORS.entries()) {
    const [row] = await db
      .insert(s.vendor)
      .values({
        name,
        classification: cls,
        productsServices: prod,
        securityReviewStatus: sec,
        securityReviewedOn: sec === "NOT_REVIEWED" ? null : d(-200 + i * 7),
        insuranceExpiresOn: d(i % 4 === 0 ? 20 + i : 120 + i * 15),
        erpSupplierId: `SUP-${String(10040 + i * 7)}`,
        website: `https://${key}.example.com`,
        address: "Omaha, NE (demo)",
      })
      .returning();
    v[key] = row.id;
    await db.insert(s.vendorContact).values([
      { vendorId: row.id, name: `${name.split(" ")[0]} Account Manager`, email: `accounts@${key}.example.com`, role: "Account manager" },
      { vendorId: row.id, name: `${name.split(" ")[0]} Contracts`, email: `contracts@${key}.example.com`, role: "Authorized signer", isSigner: true },
    ]);
  }

  // ───── Settings (all DEMO values)
  await db.insert(s.appSetting).values([
    { key: "renewal.reminderDays", value: [180, 120, 90, 60, 30], note: "Default reminder schedule; configurable." },
    { key: "sod.requesterCannotApprove", value: true, note: "Segregation of duties default." },
  ]);

  // ───── Workflow definitions (thresholds are DEMO placeholders, not adopted policy)
  const [std] = await db
    .insert(s.workflowDefinition)
    .values({
      key: "standard-it-contract",
      version: 1,
      name: "Standard IT contract approval",
      description: "Demonstration routing. Replace thresholds and steps with the approval matrix adopted by the City, County and DOTComm.",
      requestTypes: ["NEW_CONTRACT", "AMENDMENT", "RENEWAL", "EXTENSION", "ADDITIONAL_PURCHASE", "TRANSFER", "TERMINATION"],
      variables: { financeReviewThreshold: 25000, executiveApprovalThreshold: 100000 },
      createdById: u.sam,
    })
    .returning();
  const tv = { var: "contract.totalValue" };
  await db.insert(s.workflowStepDefinition).values([
    { definitionId: std.id, key: "dept", name: "Department approval", stage: 1, roleKey: "DEPARTMENT_APPROVER", scope: "REQUESTING_DEPT", dueDays: 3 },
    { definitionId: std.id, key: "benefiting", name: "Benefiting agency approval", stage: 1, roleKey: "AGENCY_EXECUTIVE", scope: "BENEFITING_AGENCY", condition: { var: "parties.crossAgency" }, dueDays: 5 },
    { definitionId: std.id, key: "purchasing", name: "Purchasing review", stage: 2, roleKey: "PURCHASING_REVIEWER", scope: "CONTRACTING_ENTITY", condition: { ">": [tv, 0] }, dueDays: 5 },
    { definitionId: std.id, key: "finance", name: "Finance review", stage: 2, roleKey: "FINANCE_REVIEWER", scope: "CONTRACTING_ENTITY", condition: { ">=": [tv, { var: "policy.financeReviewThreshold" }] }, dueDays: 5 },
    {
      definitionId: std.id,
      key: "security",
      name: "Information security review",
      stage: 2,
      roleKey: "SECURITY_REVIEWER",
      scope: "CONTRACTING_ENTITY",
      condition: { or: [{ in: [{ var: "contract.dataSensitivity" }, ["CONFIDENTIAL", "RESTRICTED"]] }, { var: "contract.isSubscription" }, { "!": { var: "vendor.securityApproved" } }] },
      dueDays: 7,
    },
    { definitionId: std.id, key: "legal", name: "Legal review", stage: 3, kind: "LEGAL_REVIEW", roleKey: "LEGAL_REVIEWER", scope: "LEGAL_AUTHORITY", condition: { var: "contract.legalRequired" }, dueDays: 10, reapproveOnMaterialChange: true },
    {
      definitionId: std.id,
      key: "final",
      name: "Final approval — administering organization",
      stage: 4,
      roleKey: "AGENCY_EXECUTIVE",
      scope: "ADMINISTERING_ORG",
      condition: { or: [{ ">=": [tv, { var: "policy.executiveApprovalThreshold" }] }, { var: "parties.administeredOnBehalf" }] },
      dueDays: 5,
      reapproveOnMaterialChange: true,
    },
  ]);
  const [legalOnly] = await db
    .insert(s.workflowDefinition)
    .values({ key: "legal-review-request", version: 1, name: "Legal review request", description: "Legal review of a document without a procurement decision.", requestTypes: ["LEGAL_REVIEW"], createdById: u.sam })
    .returning();
  await db.insert(s.workflowStepDefinition).values({ definitionId: legalOnly.id, key: "legal", name: "Legal review", stage: 1, kind: "LEGAL_REVIEW", roleKey: "LEGAL_REVIEWER", scope: "LEGAL_AUTHORITY", dueDays: 10, reapproveOnMaterialChange: true });

  // ───── Signing authority registry (SYNTHETIC references)
  await db.insert(s.signingAuthority).values([
    { userId: u.harold, legalEntityId: org.COUNTY, source: "DIRECT", effectiveFrom: d(-400), effectiveTo: d(330), authorizingReference: "DEMO-County-Board-Res-001", authorizingNote: "Synthetic demo record — not an actual resolution.", createdById: u.jonathan },
    { userId: u.victoria, legalEntityId: org.CITY, source: "DIRECT", effectiveFrom: d(-400), effectiveTo: d(600), authorizingReference: "DEMO-City-Ordinance-Ref-01", authorizingNote: "Synthetic demo record.", createdById: u.maria },
    { userId: u.elaine, legalEntityId: org.DOTCOMM, source: "DIRECT", maxAmount: "500000", effectiveFrom: d(-300), effectiveTo: d(430), authorizingReference: "DEMO-DOTComm-Board-Delegation-01", authorizingNote: "Synthetic demo record.", createdById: u.jonathan },
    {
      userId: u.elaine,
      legalEntityId: org.COUNTY,
      source: "DELEGATED",
      delegatedFromUserId: u.harold,
      maxAmount: "250000",
      contractTypeKeys: ["SAAS", "SOFTWARE_LICENSE", "SOFTWARE_MAINTENANCE"],
      effectiveFrom: d(-200),
      effectiveTo: d(70),
      authorizingReference: "DEMO-County-Delegation-Memo-07",
      authorizingNote: "Synthetic: delegation to DOTComm for County software agreements up to $250,000.",
      createdById: u.jonathan,
    },
    {
      userId: u.dana,
      legalEntityId: org.CITY,
      source: "DELEGATED",
      delegatedFromUserId: u.victoria,
      maxAmount: "100000",
      effectiveFrom: d(-395),
      effectiveTo: d(-30),
      authorizingReference: "DEMO-City-Delegation-2025-14",
      authorizingNote: "Synthetic: expired delegation (kept to demonstrate blocking).",
      createdById: u.maria,
    },
  ]);

  // ───── Clause library (SAMPLES written for the demo; not approved legal language)
  await db.insert(s.clauseTemplate).values([
    { key: "data-ownership", title: "Data ownership", category: "Data", body: "The public entity owns all data it provides to or generates through the Services. The vendor may use that data only to perform this Agreement.", guidance: "SAMPLE — replace with Legal-approved language." },
    { key: "data-return", title: "Data return and deletion", category: "Exit", body: "Within thirty days after termination, the vendor will return all customer data in a commonly used format and then securely delete remaining copies, certifying deletion in writing.", guidance: "SAMPLE — confirm periods with records retention requirements." },
    { key: "public-records", title: "Public records", category: "Compliance", body: "The vendor acknowledges that this Agreement and related records may be subject to disclosure under applicable public records law.", guidance: "SAMPLE." },
    { key: "non-appropriation", title: "Non-appropriation", category: "Financial", body: "Obligations in future fiscal years are subject to appropriation. If funds are not appropriated, the entity may terminate without penalty on written notice.", guidance: "SAMPLE — common in public-sector agreements; Legal to confirm wording." },
    { key: "security-incident", title: "Security incident notification", category: "Security", body: "The vendor will notify the entity without undue delay, and in any case within the period required by law, after discovering a security incident affecting customer data.", guidance: "SAMPLE — Information Security to set the notice window." },
    { key: "auto-renewal", title: "Auto-renewal (non-standard)", category: "Term", isStandard: false, body: "Vendor-paper auto-renewal clauses should require written notice before renewal and cap price increases.", guidance: "Flag vendor auto-renewal language for negotiation." },
  ]);

  // ───── Legacy executed contracts (imported records)
  const sam = await loadActor(u.sam);
  type Legacy = {
    t: string; vendor: string; type: string; entity: string; admin: string; dept: string; owner: string; svc?: string;
    total: number; annual?: number; start: number; end: number; auto?: boolean; notice?: number; term?: number;
    sens?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED"; benefit?: string[]; alloc?: [string, number][];
    sub?: [string, string, number, number, number]; parent?: string; key?: string; expired?: boolean; confidential?: boolean; desc: string;
  };
  const LEGACY: Legacy[] = [
    { key: "email", t: "Enterprise email & productivity suite", vendor: "northwind", type: "SAAS", entity: "DOTCOMM", admin: "DOT-INF", dept: "DOT-INF", owner: "greg", svc: "greg", total: 2400000, annual: 800000, start: -700, end: 35, auto: true, notice: 30, term: 12, benefit: ["CITY", "COUNTY"], alloc: [["CITY", 55], ["COUNTY", 45]], sub: ["Northwind 365 Government", "G3", 4200, 3880, 190], desc: "Email, calendar, file sharing and collaboration for City and County staff." },
    { t: "Enterprise GIS platform", vendor: "prairie", type: "SOFTWARE_LICENSE", entity: "CITY", admin: "CITY-PLN", dept: "CITY-PLN", owner: "sofia", total: 360000, annual: 120000, start: -800, end: 75, notice: 60, benefit: ["CITY-PLN", "CITY-PW"], sub: ["Prairie GIS Enterprise", "Enterprise agreement", 150, 131, 800], desc: "GIS server and desktop licensing for Planning and Public Works." },
    { t: "Computer-aided dispatch maintenance", vendor: "keystone", type: "SOFTWARE_MAINTENANCE", entity: "CITY", admin: "DOT-AA", dept: "CITY-OPD", owner: "nina", svc: "priya", total: 540000, annual: 180000, start: -400, end: 150, auto: true, notice: 90, term: 12, sens: "RESTRICTED", benefit: ["CITY-OPD", "CITY-OFD"], alloc: [["CITY-OPD", 70], ["CITY-OFD", 30]], desc: "Annual maintenance and support for the CAD system. DOTComm administers on behalf of the City." },
    { key: "tax", t: "Treasurer tax collection system", vendor: "heartland", type: "SAAS", entity: "COUNTY", admin: "DOT-AA", dept: "CTY-TRS", owner: "kevin", svc: "priya", total: 900000, annual: 300000, start: -365, end: 730, auto: true, notice: 90, term: 12, sens: "CONFIDENTIAL", benefit: ["CTY-TRS"], sub: ["Heartland Collect", "County tier", 85, 79, 3529.41], desc: "Property tax billing, collection and receipting." },
    { t: "Data center colocation", vendor: "bluestem", type: "MANAGED_SERVICES", entity: "DOTCOMM", admin: "DOT-INF", dept: "DOT-INF", owner: "greg", total: 1200000, annual: 400000, start: -300, end: 430, benefit: ["CITY", "COUNTY"], alloc: [["CITY", 50], ["COUNTY", 50]], desc: "Primary data center colocation space, power and remote hands." },
    { t: "Metro fiber & internet circuits", vendor: "riverbend", type: "TELECOM", entity: "DOTCOMM", admin: "DOT-INF", dept: "DOT-INF", owner: "greg", total: 720000, annual: 240000, start: -1000, end: 95, auto: true, notice: 90, term: 12, benefit: ["CITY", "COUNTY"], alloc: [["CITY", 50], ["COUNTY", 50]], desc: "Dark fiber, internet transit and inter-site circuits." },
    { key: "idp", t: "Identity & single sign-on platform", vendor: "summit", type: "SAAS", entity: "DOTCOMM", admin: "DOT-SEC", dept: "DOT-SEC", owner: "aisha", total: 330000, annual: 110000, start: -200, end: 165, auto: true, notice: 60, term: 12, sens: "CONFIDENTIAL", benefit: ["CITY", "COUNTY"], sub: ["Summit Workforce Identity", "Enterprise", 6500, 6100, 16.92], desc: "SSO and MFA for City, County and DOTComm users." },
    { t: "IT service management platform", vendor: "granite", type: "SAAS", entity: "DOTCOMM", admin: "DOT-AA", dept: "DOT-AA", owner: "priya", total: 150000, annual: 50000, start: -600, end: 130, auto: true, notice: 30, term: 12, sub: ["Granite ITSM", "Professional", 70, 58, 714.29], desc: "Service desk, change and asset management." },
    { key: "payroll", t: "Payroll & HR cloud", vendor: "meridian", type: "SAAS", entity: "COUNTY", admin: "DOT-AA", dept: "CTY-HR", owner: "monique", svc: "priya", total: 1050000, annual: 350000, start: -500, end: 595, notice: 120, sens: "RESTRICTED", benefit: ["CTY-HR", "CTY-FIN"], alloc: [["CTY-HR", 60], ["CTY-FIN", 40]], sub: ["Meridian HCM", "Public sector", 2900, 2850, 120.69], desc: "Payroll, benefits administration and HR records for County employees." },
    { t: "Records management system", vendor: "lakeside", type: "SOFTWARE_LICENSE", entity: "COUNTY", admin: "CTY-CLK", dept: "CTY-CLK", owner: "paul", total: 210000, annual: 70000, start: -900, end: 200, notice: 90, sub: ["Lakeside RM", "Perpetual + support", 120, 96, 583.33], desc: "Electronic records management for the County Clerk." },
    { key: "msa", t: "Analytics consulting master services agreement", vendor: "clearbrook", type: "MSA", entity: "DOTCOMM", admin: "DOT-AA", dept: "DOT-AA", owner: "priya", total: 500000, start: -150, end: 580, desc: "Not-to-exceed master agreement for data and analytics consulting; work is ordered by SOW." },
    { t: "Data platform modernization — SOW 1", vendor: "clearbrook", type: "SOW", entity: "DOTCOMM", admin: "DOT-AA", dept: "DOT-AA", owner: "priya", total: 185000, start: -60, end: 120, parent: "msa", desc: "Discovery, architecture and first data domain build-out under the analytics MSA." },
    { t: "End-user laptop & desktop refresh", vendor: "platte", type: "HARDWARE", entity: "COUNTY", admin: "DOT-INF", dept: "CTY-FIN", owner: "monique", svc: "greg", total: 640000, start: -100, end: 265, benefit: ["CTY-FIN", "CTY-HR", "CTY-TRS"], desc: "Hardware refresh for County finance and administrative staff." },
    { t: "Fire records management SaaS", vendor: "keystone", type: "SAAS", entity: "CITY", admin: "CITY-OFD", dept: "CITY-OFD", owner: "nina", total: 96000, annual: 32000, start: -330, end: 35, auto: true, notice: 30, term: 12, sens: "CONFIDENTIAL", sub: ["Keystone Fire RMS", "Department", 400, 210, 80], desc: "Incident reporting and fire records management." },
    { t: "Backup & disaster recovery service", vendor: "bluestem", type: "MANAGED_SERVICES", entity: "DOTCOMM", admin: "DOT-INF", dept: "DOT-INF", owner: "greg", total: 270000, annual: 90000, start: -700, end: 25, notice: 30, benefit: ["CITY", "COUNTY"], alloc: [["CITY", 50], ["COUNTY", 50]], desc: "Off-site backup replication and DR testing." },
    { t: "Assessor CAMA software maintenance", vendor: "heartland", type: "SOFTWARE_MAINTENANCE", entity: "COUNTY", admin: "DOT-AA", dept: "CTY-ASR", owner: "kevin", total: 165000, annual: 55000, start: -250, end: 115, auto: true, notice: 60, term: 12, desc: "Computer-assisted mass appraisal software support." },
    { t: "Mutual NDA — Summit Identity", vendor: "summit", type: "NDA", entity: "DOTCOMM", admin: "DOT-SEC", dept: "DOT-SEC", owner: "aisha", total: 0, start: -200, end: 530, desc: "Mutual non-disclosure for security architecture discussions." },
    { t: "Data processing agreement — payroll", vendor: "meridian", type: "DPA", entity: "COUNTY", admin: "DOT-AA", dept: "CTY-HR", owner: "monique", total: 0, start: -500, end: 595, parent: "payroll", sens: "RESTRICTED", desc: "Data protection terms for employee payroll data." },
    { t: "Security operations center (SOC) service", vendor: "sentinel", type: "MANAGED_SERVICES", entity: "DOTCOMM", admin: "DOT-SEC", dept: "DOT-SEC", owner: "aisha", total: 420000, annual: 140000, start: -380, end: 350, sens: "RESTRICTED", confidential: true, benefit: ["CITY", "COUNTY"], alloc: [["CITY", 50], ["COUNTY", 50]], desc: "24x7 monitoring, triage and incident response retainer." },
    { t: "City permitting portal", vendor: "civicflow", type: "SAAS", entity: "CITY", admin: "DOT-AA", dept: "CITY-PLN", owner: "sofia", svc: "priya", total: 255000, annual: 85000, start: -90, end: 275, auto: true, notice: 60, term: 12, sub: ["CivicFlow Permits", "Agency", 120, 118, 708.33], desc: "Online permit applications, plan review and payments." },
    { t: "Legacy document imaging maintenance", vendor: "lakeside", type: "SOFTWARE_MAINTENANCE", entity: "COUNTY", admin: "CTY-CLK", dept: "CTY-CLK", owner: "paul", total: 48000, annual: 16000, start: -1100, end: -40, expired: true, desc: "Support for the retired imaging system (expired)." },
  ];
  const legacyIds: Record<string, string> = {};
  const fiscalYear = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 7 ? 1 : 0);

  for (const L of LEGACY) {
    const start = d(L.start);
    const end = d(L.end);
    const contractId = await db.transaction(async (tx) => {
      const number = await nextNumber(tx, "CTR", Number(start.slice(0, 4)));
      const [c] = await tx
        .insert(s.contract)
        .values({
          number,
          title: L.t,
          description: L.desc,
          businessPurpose: L.desc,
          typeId: type[L.type],
          vendorId: v[L.vendor],
          status: L.expired ? "EXPIRED" : "ACTIVE",
          approvalStatus: "APPROVED",
          legalStatus: "CLEARED",
          signatureStatus: "EXECUTED_EXTERNALLY",
          contractingEntityId: org[L.entity],
          administeringOrgId: org[L.admin],
          requestingDeptId: org[L.dept],
          legalReviewOrgId: org[ORGS.find((o) => o.code === L.entity)!.legalAuthority!],
          ownerId: u[L.owner],
          serviceOwnerId: L.svc ? u[L.svc] : null,
          totalValue: String(L.total),
          annualValue: L.annual ? String(L.annual) : null,
          fundingSource: L.total ? (L.entity === "CITY" ? "City IT operating budget (demo)" : L.entity === "COUNTY" ? "County general fund (demo)" : "DOTComm operating budget (demo)") : null,
          dataSensitivity: L.sens ?? "INTERNAL",
          riskLevel: L.sens === "RESTRICTED" ? "HIGH" : "MODERATE",
          effectiveDate: start,
          expirationDate: end,
          autoRenew: Boolean(L.auto),
          renewalTermMonths: L.term ?? null,
          noticeDays: L.notice ?? null,
          priceEscalation: L.auto ? "Up to 5% annually per vendor terms (demo)" : null,
          parentContractId: L.parent ? legacyIds[L.parent] : null,
          confidential: Boolean(L.confidential),
          executedAt: new Date(`${start}T15:00:00Z`),
          customFieldValues: L.type === "SOW" ? { deliverables: "Current-state assessment; target architecture; first data domain in production", rates: "Blended $165/hr (demo)" } : {},
        })
        .returning();
      for (const b of L.benefit ?? []) await tx.insert(s.contractAgency).values({ contractId: c.id, orgId: org[b], role: "BENEFITING" });
      for (const [o, pct] of L.alloc ?? []) await tx.insert(s.contractAgency).values({ contractId: c.id, orgId: org[o], role: "FINANCIAL", allocationPct: String(pct) });
      if (L.sub) {
        await tx.insert(s.subscriptionLicense).values({
          contractId: c.id,
          product: L.sub[0],
          plan: L.sub[1],
          licensedQty: L.sub[2],
          assignedQty: L.sub[3],
          unitCost: String(L.sub[4]),
          billingFrequency: "ANNUAL",
          costCenter: `${L.dept}-IT`,
          usageAsOf: d(-14),
        });
      }
      if (L.annual) {
        await tx.insert(s.financialCommitment).values([
          { contractId: c.id, kind: "RECURRING", description: "Annual subscription / service fee", amount: String(L.annual), fiscalYear },
          { contractId: c.id, kind: "RECURRING", description: "Annual subscription / service fee", amount: String(Math.round(L.annual * 1.03)), fiscalYear: fiscalYear + 1 },
        ]);
      } else if (L.total) {
        await tx.insert(s.financialCommitment).values({ contractId: c.id, kind: L.type === "SOW" || L.type === "MSA" ? "RATE_CARD" : "ONE_TIME", description: L.type === "MSA" ? "Not-to-exceed amount (ordered by SOW)" : "Contract amount", amount: String(L.total), fiscalYear });
      }
      if (L.total > 100000) {
        await tx.insert(s.purchaseOrderRef).values({ contractId: c.id, poNumber: `PO-${start.slice(2, 4)}-${String(10000 + Math.round(L.total / 1000)).slice(-5)}`, erpSupplierId: null, amount: String(L.annual ?? L.total) });
      }
      if (L.parent) await tx.insert(s.contractRelationship).values({ fromId: c.id, toId: legacyIds[L.parent], type: L.type === "SOW" ? "SOW_UNDER" : "RELATED" });
      await writeAudit(tx, { actorId: u.sam, action: "LEGACY_RECORD_IMPORTED", entityType: "contract", entityId: c.id, contractId: c.id, data: { number, source: "Demo seed — represents a contract executed before the CLM" } });
      return c.id;
    });
    if (L.key) legacyIds[L.key] = contractId;
    await uploadDocument(sam, {
      contractId,
      kind: "EXECUTED",
      title: "Executed agreement (imported)",
      file: { name: `${L.t.replace(/[^A-Za-z0-9]+/g, "-")}-executed.pdf`, type: "application/pdf", bytes: makePdf([L.t, `Vendor: ${VENDORS.find((x) => x[0] === L.vendor)![1]}`, `Term: ${start} to ${end}`, "DEMO DOCUMENT — synthetic content for demonstration only."]) },
      system: true,
    });
    const [c] = await db.select().from(s.contract).where(eq(s.contract.id, contractId));
    if (c.status === "ACTIVE") await ensureRenewalCycle(db, c);
  }

  // Obligations on a few legacy contracts
  const byTitle = async (t: string) => (await db.select().from(s.contract).where(eq(s.contract.title, t)))[0];
  const soc = await byTitle("Security operations center (SOC) service");
  const payroll = await byTitle("Payroll & HR cloud");
  const email = await byTitle("Enterprise email & productivity suite");
  const tax = await byTitle("Treasurer tax collection system");
  await db.insert(s.obligation).values([
    { contractId: soc.id, title: "Annual SOC 2 Type II report from vendor", category: "Security certification", ownerId: u.aisha, dueDate: d(-12), status: "OVERDUE" },
    { contractId: soc.id, title: "Quarterly service review meeting", category: "Reporting", ownerId: u.aisha, dueDate: d(18) },
    { contractId: payroll.id, title: "Certificate of insurance renewal", category: "Insurance", ownerId: u.monique, dueDate: d(40) },
    { contractId: payroll.id, title: "Data return and deletion plan on exit", category: "Exit", ownerId: u.monique, dueDate: null },
    { contractId: email.id, title: "License true-up report", category: "Reporting", ownerId: u.greg, dueDate: d(-3), status: "OVERDUE" },
    { contractId: tax.id, title: "PCI compliance attestation", category: "Compliance", ownerId: u.kevin, dueDate: d(55) },
  ]);
  const [gisRenewal] = await db.select().from(s.renewal).innerJoin(s.contract, eq(s.contract.id, s.renewal.contractId)).where(eq(s.contract.title, "Enterprise GIS platform"));
  if (gisRenewal) await db.update(s.renewal).set({ decision: "RENEGOTIATE", decisionNote: "Consolidate with Public Works licensing at renewal.", decidedById: u.sofia, decidedAt: new Date() }).where(eq(s.renewal.id, gisRenewal.renewal.id));

  if (opts.inFlight !== false) await seedInFlight(u, org, v, legacyIds);

  // Generate renewal reminders as of today so the notification center and dashboard are populated
  await runRenewalReminders();
  return { org, user: u, vendor: v, type };
}

async function seedInFlight(u: Record<string, string>, org: Record<string, string>, v: Record<string, string>, legacy: Record<string, string>) {
  const A = (k: string) => loadActor(u[k]);
  const d = (n: number) => addDays(todayIn(), n);
  const docx = async (title: string, tracked: Parameters<typeof makeDocx>[2] = []) => ({
    name: `${title.replace(/[^A-Za-z0-9]+/g, "-")}.docx`,
    type: DOCX_MIME,
    bytes: await makeDocx(title, STANDARD_TERMS, tracked),
  });
  /** Approves every pending task whose step is listed, using the first listed user who is eligible. */
  const approveStage = async (contractId: string, who: Record<string, string | string[]>) => {
    const tasks = await db
      .select({ t: s.workflowTask })
      .from(s.workflowTask)
      .innerJoin(s.workflowInstance, eq(s.workflowInstance.id, s.workflowTask.instanceId))
      .where(and(eq(s.workflowInstance.contractId, contractId), eq(s.workflowInstance.status, "RUNNING"), eq(s.workflowTask.status, "PENDING")));
    for (const { t } of tasks) {
      const candidates = ([] as string[]).concat(who[t.stepKey] ?? []);
      let done = false;
      for (const key of candidates) {
        const actor = await A(key);
        try {
          if (t.kind === "LEGAL_REVIEW") {
            await legalAction(actor, t.id, "START");
            await legalAction(actor, t.id, "CLEAR", "Cleared on vendor's revised paper.");
          } else await decideTask(actor, t.id, "APPROVE", "Approved.");
          done = true;
          break;
        } catch (e) {
          if (!(e instanceof ForbiddenError)) throw e;
        }
      }
      if (candidates.length && !done) throw new Error(`Seed: nobody in [${candidates}] could act on ${t.name}`);
    }
  };

  // A — City Police, administered by DOTComm: awaiting department & agency approval
  {
    const nina = await A("nina");
    const r = await createRequest(nina, {
      title: "Body-worn camera evidence storage",
      typeKey: "SAAS",
      vendorId: v.keystone,
      requestingDeptId: org["CITY-OPD"],
      contractingEntityId: org.CITY,
      administeringOrgId: org["DOT-AA"],
      benefitingAgencyIds: [org["CITY-OPD"]],
      ownerId: u.nina,
      serviceOwnerId: u.priya,
      businessPurpose: "Cloud storage and chain-of-custody management for body-worn camera video, replacing on-premises storage nearing capacity.",
      description: "Five-year subscription for evidence storage, redaction tools and court sharing.",
      totalValue: 310000,
      annualValue: 62000,
      fundingSource: "Police technology fund (demo)",
      effectiveDate: d(30),
      expirationDate: d(30 + 365 * 5),
      autoRenew: false,
      noticeDays: 90,
      dataSensitivity: "RESTRICTED",
      riskLevel: "HIGH",
      subscription: { product: "Keystone Evidence Cloud", plan: "Unlimited storage", licensedQty: 450, unitCost: 137.78, billingFrequency: "ANNUAL" },
      customFieldValues: { hostingLocation: "US (government cloud region)", sso: "yes" },
    });
    await uploadDocument(nina, { contractId: r.contractId, kind: "AGREEMENT", title: "Vendor subscription agreement", file: await docx("Keystone Evidence Cloud Subscription Agreement") });
    await uploadDocument(nina, { contractId: r.contractId, kind: "QUOTE", title: "Vendor quote", file: { name: "keystone-quote.pdf", type: "application/pdf", bytes: makePdf(["Keystone quote Q-4471", "450 users, 5-year term", "DEMO"]) } });
    await submitRequest(nina, r.requestId);
  }

  // B — DOTComm EDR: department approved, now in parallel Purchasing / Finance / Security review
  {
    const priya = await A("priya");
    const r = await createRequest(priya, {
      title: "Endpoint detection & response",
      typeKey: "SAAS",
      vendorId: v.sentinel,
      requestingDeptId: org["DOT-AA"],
      administeringOrgId: org["DOT-SEC"],
      benefitingAgencyIds: [org.CITY, org.COUNTY],
      financialAllocations: [{ orgId: org.CITY, pct: 50 }, { orgId: org.COUNTY, pct: 50 }],
      businessPurpose: "Replace end-of-life antivirus with managed EDR on 7,800 City and County endpoints.",
      totalValue: 210000,
      annualValue: 70000,
      fundingSource: "DOTComm operating budget (demo)",
      effectiveDate: d(45),
      expirationDate: d(45 + 365 * 3),
      autoRenew: true,
      renewalTermMonths: 12,
      noticeDays: 60,
      dataSensitivity: "CONFIDENTIAL",
      subscription: { product: "Sentinel EDR", plan: "Managed", licensedQty: 7800, unitCost: 8.97, billingFrequency: "ANNUAL" },
    });
    await uploadDocument(priya, { contractId: r.contractId, kind: "AGREEMENT", title: "Master subscription agreement", file: await docx("Sentinel EDR Master Subscription Agreement") });
    await submitRequest(priya, r.requestId);
    await approveStage(r.contractId, { dept: "marcus", benefiting: ["victoria", "harold"] });
    // Purchasing has approved; Finance and Security are still pending.
    await approveStage(r.contractId, { purchasing: "raymond" });
  }

  // C — County Clerk digitization: in Legal review with an open issue and a redline that has tracked changes
  {
    const paul = await A("paul");
    const r = await createRequest(paul, {
      title: "Historical records digitization services",
      typeKey: "PROFESSIONAL_SERVICES",
      vendorId: v.lakeside,
      requestingDeptId: org["CTY-CLK"],
      administeringOrgId: org["CTY-CLK"],
      businessPurpose: "Digitize 1.2 million historical records pages to meet access and preservation goals.",
      totalValue: 95000,
      fundingSource: "Clerk preservation fund (demo)",
      effectiveDate: d(20),
      expirationDate: d(20 + 270),
      dataSensitivity: "CONFIDENTIAL",
      customFieldValues: { deliverables: "Scanning, indexing, QA; monthly batches; final certified index", rates: "$0.079 per page (demo)" },
    });
    const v1 = await uploadDocument(paul, { contractId: r.contractId, kind: "AGREEMENT", title: "Professional services agreement", file: await docx("Lakeside Digitization Services Agreement") });
    await submitRequest(paul, r.requestId);
    await approveStage(r.contractId, { dept: "ellen" });
    await approveStage(r.contractId, { purchasing: "raymond", finance: "grace", security: "aisha" });
    const jonathan = await A("jonathan");
    const [legalTask] = await db
      .select({ t: s.workflowTask })
      .from(s.workflowTask)
      .innerJoin(s.workflowInstance, eq(s.workflowInstance.id, s.workflowTask.instanceId))
      .where(and(eq(s.workflowInstance.contractId, r.contractId), eq(s.workflowTask.kind, "LEGAL_REVIEW"), eq(s.workflowTask.status, "PENDING")));
    await legalAction(jonathan, legalTask.t.id, "START", "Reviewing vendor paper.");
    await addLegalIssue(jonathan, r.contractId, { title: "Indemnification is one-sided", clauseRef: "§6", severity: "HIGH", detail: "Vendor paper limits indemnity to fees paid in the prior 3 months; propose mutual indemnity and a higher cap." });
    await addLegalIssue(jonathan, r.contractId, { title: "Add public records acknowledgment", clauseRef: "new §8", severity: "LOW" });
    await uploadDocument(jonathan, {
      contractId: r.contractId,
      documentId: v1.document.id,
      note: "County redline: data ownership and termination language",
      file: await docx("Lakeside Digitization Services Agreement", [
        { after: STANDARD_TERMS[2], insert: "Vendor will return all Customer Data in a commonly used format within thirty (30) days after termination and then delete remaining copies.", author: "Jonathan Pryce" },
        { after: STANDARD_TERMS[5], remove: "not cured within thirty (30) days", insert: "not cured within fifteen (15) days, or for convenience on sixty (60) days' notice", author: "Jonathan Pryce" },
      ]),
    });
    await legalAction(jonathan, legalTask.t.id, "NEGOTIATE", "Redline sent to vendor.");
  }

  // D — DOTComm network refresh: fully approved, pending signature by an authorized signatory
  {
    const greg = await A("greg");
    const r = await createRequest(greg, {
      title: "Core network switch refresh",
      typeKey: "HARDWARE",
      vendorId: v.platte,
      requestingDeptId: org["DOT-INF"],
      administeringOrgId: org["DOT-INF"],
      benefitingAgencyIds: [org.CITY, org.COUNTY],
      financialAllocations: [{ orgId: org.CITY, pct: 50 }, { orgId: org.COUNTY, pct: 50 }],
      businessPurpose: "Replace end-of-support core switches at both data centers.",
      totalValue: 385000,
      fundingSource: "Capital improvement plan (demo)",
      effectiveDate: d(14),
      expirationDate: d(14 + 365 * 5),
      dataSensitivity: "INTERNAL",
    });
    await uploadDocument(greg, { contractId: r.contractId, kind: "AGREEMENT", title: "Purchase agreement", file: await docx("Platte Valley Hardware Purchase Agreement") });
    await submitRequest(greg, r.requestId);
    await approveStage(r.contractId, { dept: "ken", benefiting: ["harold", "victoria"] });
    await approveStage(r.contractId, { purchasing: "raymond", finance: "grace", security: "aisha" });
    await approveStage(r.contractId, { legal: "jonathan" });
    await approveStage(r.contractId, { final: "elaine" });
  }

  // G — County Treasurer payment portal administered by DOTComm (Scenario 2): pending signature
  {
    const kevin = await A("kevin");
    const r = await createRequest(kevin, {
      title: "Online property-tax payment portal",
      typeKey: "SAAS",
      vendorId: v.heartland,
      requestingDeptId: org["CTY-TRS"],
      contractingEntityId: org.COUNTY,
      administeringOrgId: org["DOT-AA"],
      benefitingAgencyIds: [org["CTY-TRS"]],
      ownerId: u.kevin,
      serviceOwnerId: u.priya,
      businessPurpose: "Taxpayer self-service payments with card and ACH, integrated with the tax collection system.",
      totalValue: 140000,
      annualValue: 46667,
      fundingSource: "Treasurer technology fee (demo)",
      effectiveDate: d(21),
      expirationDate: d(21 + 365 * 3),
      autoRenew: true,
      renewalTermMonths: 12,
      noticeDays: 90,
      dataSensitivity: "CONFIDENTIAL",
      parentContractId: legacy.tax,
      subscription: { product: "Heartland Pay", plan: "Transaction + platform", licensedQty: 1, unitCost: 46667, billingFrequency: "ANNUAL" },
    });
    await uploadDocument(kevin, { contractId: r.contractId, kind: "AGREEMENT", title: "Payment portal subscription", file: await docx("Heartland Pay Subscription Agreement") });
    await submitRequest(kevin, r.requestId);
    await approveStage(r.contractId, { dept: "luis", benefiting: "beth" });
    await approveStage(r.contractId, { purchasing: "raymond", finance: "grace", security: "aisha" });
    await approveStage(r.contractId, { legal: "jonathan" });
    await approveStage(r.contractId, { final: "elaine" });
  }

  // E — Draft (not yet submitted)
  {
    const priya = await A("priya");
    await createRequest(priya, {
      title: "Low-code application platform",
      typeKey: "SAAS",
      requestingDeptId: org["DOT-AA"],
      businessPurpose: "Platform for citizen-developer apps across departments (draft).",
      totalValue: 120000,
    });
  }

  // F — Returned for changes
  {
    const sofia = await A("sofia");
    const r = await createRequest(sofia, {
      title: "Zoning analysis GIS extension",
      typeKey: "SOFTWARE_LICENSE",
      vendorId: v.prairie,
      requestingDeptId: org["CITY-PLN"],
      administeringOrgId: org["CITY-PLN"],
      businessPurpose: "Add-on module for zoning scenario analysis.",
      totalValue: 18000,
      fundingSource: "Planning operating budget (demo)",
      effectiveDate: d(30),
      expirationDate: d(30 + 365),
    });
    await submitRequest(sofia, r.requestId);
    const [t] = await db
      .select({ t: s.workflowTask })
      .from(s.workflowTask)
      .innerJoin(s.workflowInstance, eq(s.workflowInstance.id, s.workflowTask.instanceId))
      .where(and(eq(s.workflowInstance.contractId, r.contractId), eq(s.workflowTask.status, "PENDING")));
    await decideTask(await A("andre"), t.t.id, "RETURN", "Attach the vendor quote and confirm whether Public Works will share the license.");
  }
}

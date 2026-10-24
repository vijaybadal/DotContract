/** OpenAPI 3.1 description of the CLM REST API (v1). */
const err = { $ref: "#/components/responses/Error" };
const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", properties: { data: {} } } } } });
const idParam = (name = "id") => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } });

const spec = {
  openapi: "3.1.0",
  info: {
    title: "DOTComm Contract Lifecycle Management API",
    version: "1.0.0",
    description:
      "Session-authenticated JSON API. Every call is authorized server-side against the caller's roles and agency scope; contracts outside that scope return 404. State-changing calls must be same-origin (CSRF). Errors use { error: { code, message, details } }.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "clm_session" } },
    responses: {
      Error: {
        description: "Error",
        content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string", enum: ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "INVALID_STATE", "AUTHORITY_BLOCKED", "NOT_CONFIGURED", "CSRF", "INTERNAL"] }, message: { type: "string" }, details: {} } } } } } },
      },
    },
    schemas: {
      Intake: {
        type: "object",
        required: ["title"],
        properties: {
          requestType: { type: "string", enum: ["NEW_CONTRACT", "AMENDMENT", "RENEWAL", "EXTENSION", "ADDITIONAL_PURCHASE", "TERMINATION", "TRANSFER", "LEGAL_REVIEW"] },
          title: { type: "string" }, typeKey: { type: "string" }, vendorId: { type: "string" }, newVendorName: { type: "string" },
          businessPurpose: { type: "string" }, requestingDeptId: { type: "string" }, contractingEntityId: { type: "string" }, administeringOrgId: { type: "string" },
          benefitingAgencyIds: { type: "array", items: { type: "string" } },
          financialAllocations: { type: "array", items: { type: "object", properties: { orgId: { type: "string" }, pct: { type: "number" } } } },
          ownerId: { type: "string" }, serviceOwnerId: { type: "string" }, totalValue: { type: "number" }, annualValue: { type: "number" }, fundingSource: { type: "string" },
          effectiveDate: { type: "string", format: "date" }, expirationDate: { type: "string", format: "date" }, autoRenew: { type: "boolean" }, renewalTermMonths: { type: "integer" }, noticeDays: { type: "integer" },
          dataSensitivity: { type: "string", enum: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] }, riskLevel: { type: "string", enum: ["LOW", "MODERATE", "HIGH"] },
          legalRequired: { type: "boolean" }, confidential: { type: "boolean" }, parentContractId: { type: "string" }, customFieldValues: { type: "object" },
        },
      },
    },
  },
  security: [{ session: [] }],
  paths: {
    "/contracts": { get: { summary: "List contracts in the caller's scope", parameters: ["q", "status", "type", "org", "vendor", "expiring", "onbehalf", "autorenew", "sort", "limit", "offset"].map((n) => ({ name: n, in: "query", schema: { type: "string" } })), responses: { 200: ok("Contracts"), 401: err } } },
    "/contracts/export": { get: { summary: "Contract inventory as CSV (same filters)", responses: { 200: { description: "CSV", content: { "text/csv": {} } } } } },
    "/contracts/{id}": { get: { summary: "Contract detail with parties and permissions", parameters: [idParam()], responses: { 200: ok("Contract"), 404: err } } },
    "/contracts/{id}/documents": {
      get: { summary: "Documents and versions", parameters: [idParam()], responses: { 200: ok("Documents"), 404: err } },
      post: { summary: "Upload a document or new version (multipart)", parameters: [idParam()], requestBody: { content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" }, kind: { type: "string" }, documentId: { type: "string" }, title: { type: "string" }, note: { type: "string" }, confidential: { type: "string" }, material: { type: "string" } } } } } }, responses: { 200: ok("Version"), 403: err, 422: err } },
    },
    "/contracts/{id}/authority-check": { get: { summary: "Dry-run signing authority check, or list authorized signatories", parameters: [idParam(), { name: "signer", in: "query", schema: { type: "string" } }, { name: "on", in: "query", schema: { type: "string", format: "date" } }], responses: { 200: ok("Result") } } },
    "/contracts/{id}/signature": { post: { summary: "Verify authority and send for signature", parameters: [idParam()], requestBody: { content: { "application/json": { schema: { type: "object", required: ["signerUserId"], properties: { signerUserId: { type: "string" }, vendorSignerName: { type: "string" }, vendorSignerEmail: { type: "string" } } } } } }, responses: { 200: ok("Sent"), 409: err } } },
    "/documents/{versionId}": { get: { summary: "Download a document version (audited)", parameters: [idParam("versionId")], responses: { 200: { description: "File" }, 403: err, 409: err } } },
    "/requests": { get: { summary: "My requests (scope=all for all visible)", responses: { 200: ok("Requests") } }, post: { summary: "Create a draft request", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Intake" } } } }, responses: { 200: ok("Created"), 422: err } } },
    "/requests/{id}": { get: { summary: "Request detail", parameters: [idParam()], responses: { 200: ok("Request") } }, patch: { summary: "Update a draft or returned request", parameters: [idParam()], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Intake" } } } }, responses: { 200: ok("Updated"), 409: err } } },
    "/requests/{id}/submit": { post: { summary: "Submit for approval (starts the workflow)", parameters: [idParam()], responses: { 200: ok("Workflow started"), 422: err, 409: err } } },
    "/tasks": { get: { summary: "Approval and legal steps the caller may act on", responses: { 200: ok("Tasks") } } },
    "/tasks/{id}/decision": { post: { summary: "Approve / reject / return, or a legal action", parameters: [idParam()], requestBody: { content: { "application/json": { schema: { type: "object", properties: { decision: { type: "string", enum: ["APPROVE", "REJECT", "RETURN"] }, legalAction: { type: "string", enum: ["START", "NEGOTIATE", "REQUEST_CHANGES", "CLEAR"] }, comment: { type: "string" } } } } } }, responses: { 200: ok("Done"), 403: err, 409: err } } },
    "/renewals/{id}/decision": { post: { summary: "Record a renewal decision", parameters: [idParam()], requestBody: { content: { "application/json": { schema: { type: "object", properties: { decision: { type: "string", enum: ["RENEW", "RENEGOTIATE", "EXTEND", "REPLACE", "CONSOLIDATE", "TERMINATE"] }, note: { type: "string" } } } } } }, responses: { 200: ok("Recorded") } } },
    "/reports/{key}": { get: { summary: "Report as CSV", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string", enum: ["inventory", "expirations", "vendor-spend", "agency-allocation", "pending-approvals", "cycle-times", "saas", "obligations", "change-history"] } }], responses: { 200: { description: "CSV" } } } },
    "/jobs/run": { post: { summary: "Run scheduled jobs now (administrators)", responses: { 200: ok("Summary"), 403: err } } },
    "/esign/webhook": { post: { summary: "E-signature provider callback (HMAC-verified once configured)", security: [], responses: { 501: err } } },
  },
};

export function GET() {
  return Response.json(spec);
}

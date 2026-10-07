# @absolutejs/procore

A typed Procore adapter for Bun and AbsoluteJS applications. Authentication is supplied by the caller; use Citra's `procore` provider and Absolute Auth's encrypted grants/coordinated refresh for OAuth.

```ts
import { createProcoreClient } from "@absolutejs/procore";
const procore = createProcoreClient({
  environment: "sandbox",
  accessToken: async () => tokenFromYourCredentialResolver,
});
const projects = await procore.projects(selectedCompanyId);
const logs = await procore.deliveryLogs(
  selectedCompanyId,
  selectedProjectId,
  "2026-10-07",
);
```

Supports companies, projects, project users/vendors/locations, cost codes, purchase orders, commitment contracts, and delivery-log reads/creation. Catalog results deliberately contain only the fields required for explicit mapping. Imported users do not grant application permissions.

Requests use fixed Procore origins, company headers, explicit project IDs, bounded response bodies and pagination, and reject redirects. Provider-supplied pagination URLs are never followed with credentials. Incomplete, duplicate, or capped catalogs fail instead of silently returning partial results. Callers remain responsible for authorization and matching a selected project to its company.

`ProcoreError` exposes a sanitized code and `outcome`. An `unknown` write outcome means the request may have succeeded: **do not automatically retry it**. Persist intent before creating a delivery log, include a stable tracking number, and reconcile the receipt using an explicit log date. The adapter does not promise provider idempotency or automatically approve logs. It does not calculate business quantities, select mappings, upload attachments, or enforce a customer's approval policy.

The access-token callback must implement its own bounded execution. HTTP requests default to 15 seconds, 4 MiB, 20 pages, and 10,000 items. Sandbox and the default production API origin are supported; region-specific production routing needs separate configuration work before deployment to a regional tenant.

API contracts: [Procore REST reference](https://developers.procore.com/reference/rest), [OAuth endpoints](https://procore.github.io/documentation/oauth-endpoints), [daily logs](https://procore.github.io/documentation/daily-logs).

Run `bun run typecheck`, `bun test`, and `bun run build`.

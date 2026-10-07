export class ProcoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly outcome: "rejected" | "unknown" = "rejected",
    public readonly httpStatus?: number,
  ) {
    super(`Procore request failed: ${code}`);
    this.name = "ProcoreError";
  }
}
export type ProcoreEnvironment = "sandbox" | "production";
export type Reference = { id: string; name: string };
export type Project = Reference & {
  companyId: string;
  active: boolean | null;
  number: string | null;
  timeZone: string | null;
};
export type CostCode = Reference & { code: string | null };
export type Contract = {
  id: string;
  title: string | null;
  number: string | null;
  status: string | null;
  type: string | null;
};
export type DeliveryLogInput = {
  date: string;
  contents: string;
  comments: string;
  deliveryFrom: string;
  trackingNumber: string;
  vendorId?: string;
  locationId?: string;
};
export type DeliveryLog = DeliveryLogInput & {
  id: string;
  status: string | null;
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new ProcoreError("INVALID_RESPONSE");
  return v as Record<string, unknown>;
};
const id = (v: unknown): string => {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0)
    return String(v);
  if (typeof v === "string" && /^[1-9][0-9]{0,18}$/.test(v)) return v;
  throw new ProcoreError("INVALID_ID");
};
const text = (v: unknown): string => {
  if (typeof v !== "string" || v.length > 20000)
    throw new ProcoreError("INVALID_RESPONSE");
  return v;
};
const nullable = (v: unknown) => (v == null ? null : text(v));
const reference = (v: unknown): Reference => {
  const r = object(v);
  return { id: id(r.id), name: text(r.name) };
};
const project = (v: unknown): Project => {
  const r = object(v);
  if (r.active != null && typeof r.active !== "boolean")
    throw new ProcoreError("INVALID_RESPONSE");
  return {
    ...reference(v),
    companyId: id(object(r.company).id),
    active: r.active == null ? null : (r.active as boolean),
    number: nullable(r.project_number),
    timeZone: nullable(r.tz_name ?? r.time_zone),
  };
};
const costCode = (v: unknown): CostCode => {
  const r = object(v);
  return { ...reference(v), code: nullable(r.full_code ?? r.code) };
};
const contract = (v: unknown): Contract => {
  const r = object(v);
  return {
    id: id(r.id),
    title: nullable(r.title),
    number: nullable(r.number),
    status: nullable(r.status),
    type: nullable(r.type),
  };
};
const log = (v: unknown): DeliveryLog => {
  const r = object(v);
  return {
    id: id(r.id),
    date: text(r.date),
    contents: text(r.contents),
    comments: text(r.comments ?? ""),
    deliveryFrom: text(r.delivery_from ?? ""),
    trackingNumber: text(r.tracking_number ?? ""),
    status: nullable(r.status),
    ...(r.vendor ? { vendorId: id(object(r.vendor).id) } : {}),
    ...(r.location ? { locationId: id(object(r.location).id) } : {}),
  };
};
const date = (v: string) => {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new ProcoreError("INVALID_DATE");
  return v;
};
export function deliveryLogPayload(input: DeliveryLogInput) {
  for (const value of [
    input.contents,
    input.comments,
    input.deliveryFrom,
    input.trackingNumber,
  ]) {
    if (typeof value !== "string" || value.length > 10000)
      throw new ProcoreError("INVALID_INPUT");
  }
  if (!input.contents.trim() || !input.trackingNumber.trim())
    throw new ProcoreError("INVALID_INPUT");
  return {
    delivery_log: {
      date: date(input.date),
      contents: input.contents,
      comments: input.comments,
      delivery_from: input.deliveryFrom,
      tracking_number: input.trackingNumber,
      ...(input.vendorId ? { vendor_id: id(input.vendorId) } : {}),
      ...(input.locationId ? { location_id: id(input.locationId) } : {}),
    },
  };
}
export type ProcoreOptions = {
  environment: ProcoreEnvironment;
  accessToken: () => Promise<string>;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
  maxPages?: number;
  maxItems?: number;
};
export function createProcoreClient(options: ProcoreOptions) {
  if (!["sandbox", "production"].includes(options.environment))
    throw new ProcoreError("INVALID_ENVIRONMENT");
  const origin =
    options.environment === "sandbox"
      ? "https://sandbox.procore.com"
      : "https://api.procore.com";
  const timeout = options.timeoutMs ?? 15000,
    maxBytes = options.maxBytes ?? 4194304,
    maxPages = options.maxPages ?? 20,
    maxItems = options.maxItems ?? 10000;
  for (const n of [timeout, maxBytes, maxPages, maxItems])
    if (!Number.isSafeInteger(n) || n < 1)
      throw new ProcoreError("INVALID_LIMIT");
  async function request(
    path: string,
    companyId: string | undefined,
    body?: unknown,
  ) {
    const token = await options.accessToken();
    if (!token || /[\r\n]/.test(token)) throw new ProcoreError("INVALID_TOKEN");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeout);
    const write = body !== undefined;
    try {
      const r = await (options.fetch ?? globalThis.fetch)(origin + path, {
        method: write ? "POST" : "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json",
          ...(companyId ? { "Procore-Company-Id": id(companyId) } : {}),
          ...(write ? { "Content-Type": "application/json" } : {}),
        },
        ...(write ? { body: JSON.stringify(body) } : {}),
      });
      if (!r.ok) {
        await r.body?.cancel();
        throw new ProcoreError(
          "HTTP_" + r.status,
          write && ![400, 401, 403, 404, 405, 422, 429].includes(r.status)
            ? "unknown"
            : "rejected",
          r.status,
        );
      }
      if (!r.body) throw new ProcoreError("INVALID_RESPONSE");
      const reader = r.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > maxBytes) throw new ProcoreError("RESPONSE_TOO_LARGE");
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ProcoreError("INVALID_RESPONSE");
      }
      return { value, headers: r.headers };
    } catch (e) {
      if (e instanceof ProcoreError) {
        if (write && e.httpStatus === undefined)
          throw new ProcoreError(e.code, "unknown");
        throw e;
      }
      throw new ProcoreError("UNAVAILABLE", write ? "unknown" : "rejected");
    } finally {
      clearTimeout(timer);
    }
  }
  async function list<T extends { id: string }>(
    path: string,
    companyId: string | undefined,
    query: Record<string, string>,
    decode: (v: unknown) => T,
    envelope = false,
  ) {
    const rows: T[] = [],
      seen = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({
        ...query,
        page: String(page),
        per_page: "100",
      });
      const r = await request(path + "?" + params, companyId);
      const data = envelope ? object(r.value).data : r.value;
      if (!Array.isArray(data)) throw new ProcoreError("INVALID_RESPONSE");
      for (const value of data) {
        const row = decode(value);
        if (seen.has(row.id)) throw new ProcoreError("DUPLICATE_PAGE");
        seen.add(row.id);
        rows.push(row);
        if (rows.length > maxItems) throw new ProcoreError("ITEM_LIMIT");
      }
      // Never follow provider-supplied links with a bearer token; only advance the
      // documented page parameter on the original scoped endpoint.
      const link = r.headers.get("link");
      const next = !!link && /rel\s*=\s*"?next"?/i.test(link);
      const total = r.headers.get("total");
      if (
        total !== null &&
        (!/^\d+$/.test(total) || !Number.isSafeInteger(Number(total)))
      )
        throw new ProcoreError("INVALID_PAGINATION");
      if (total !== null && rows.length > Number(total))
        throw new ProcoreError("CHANGED_PAGINATION");
      if (!next && total !== null && rows.length === Number(total)) return rows;
      if (!next && total === null && data.length < 100) return rows;
      if (data.length === 0) throw new ProcoreError("INCOMPLETE_PAGINATION");
    }
    throw new ProcoreError("PAGE_LIMIT");
  }
  return {
    companies: () =>
      list("/rest/v1.0/companies", undefined, { view: "compact" }, reference),
    projects: (companyId: string) =>
      list(
        "/rest/v1.1/projects",
        id(companyId),
        {
          company_id: id(companyId),
          view: "normal",
          "filters[by_status]": "Active",
        },
        project,
      ),
    users: (companyId: string, projectId: string) =>
      list(
        `/rest/v1.0/projects/${id(projectId)}/users`,
        id(companyId),
        { view: "compact" },
        reference,
      ),
    vendors: (companyId: string, projectId: string) =>
      list(
        `/rest/v1.1/projects/${id(projectId)}/vendors`,
        id(companyId),
        { view: "name" },
        reference,
      ),
    locations: (companyId: string, projectId: string) =>
      list(
        `/rest/v1.0/projects/${id(projectId)}/locations`,
        id(companyId),
        {},
        reference,
      ),
    costCodes: (companyId: string, projectId: string) =>
      list(
        "/rest/v1.0/cost_codes",
        id(companyId),
        { project_id: id(projectId) },
        costCode,
      ),
    purchaseOrders: (companyId: string, projectId: string) =>
      list(
        "/rest/v1.0/purchase_order_contracts",
        id(companyId),
        { project_id: id(projectId), view: "compact" },
        contract,
      ),
    contracts: (companyId: string, projectId: string) =>
      list(
        `/rest/v2.0/companies/${id(companyId)}/projects/${id(projectId)}/commitment_contracts`,
        id(companyId),
        { view: "default" },
        contract,
        true,
      ),
    deliveryLogs: (companyId: string, projectId: string, logDate: string) =>
      list(
        `/rest/v1.0/projects/${id(projectId)}/delivery_logs`,
        id(companyId),
        { log_date: date(logDate), "filters[status]": "all" },
        log,
      ),
    deliveryLog: async (companyId: string, projectId: string, logId: string) =>
      log(
        (
          await request(
            `/rest/v1.0/projects/${id(projectId)}/delivery_logs/${id(logId)}`,
            id(companyId),
          )
        ).value,
      ),
    createDeliveryLog: async (
      companyId: string,
      projectId: string,
      input: DeliveryLogInput,
    ) => {
      const path = `/rest/v1.0/projects/${id(projectId)}/delivery_logs`,
        company = id(companyId),
        payload = deliveryLogPayload(input);
      const result = await request(path, company, payload);
      try {
        return log(result.value);
      } catch {
        throw new ProcoreError("INVALID_RECEIPT", "unknown");
      }
    },
  };
}
export type ProcoreClient = ReturnType<typeof createProcoreClient>;

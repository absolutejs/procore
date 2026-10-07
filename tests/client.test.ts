import { expect, test } from "bun:test";
import { createProcoreClient, ProcoreError, deliveryLogPayload } from "../src";
const input = {
  date: "2026-10-07",
  contents: "4.5 short tons of stone",
  comments: "Reviewed delivery",
  deliveryFrom: "Test supplier",
  trackingNumber: "DT-TEST-1",
};
const reply = (v: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { headers });
const client = (
  fetch: NonNullable<Parameters<typeof createProcoreClient>[0]["fetch"]>,
  extra = {},
) =>
  createProcoreClient({
    environment: "sandbox",
    accessToken: async () => "private-token",
    fetch,
    ...extra,
  });
test("scopes catalogs to the selected company and project, exposing only reference fields", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  const c = client(async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    return reply([{ id: 12, name: "Vendor", email: "private@example.test" }]);
  });
  expect(await c.vendors("42", "13")).toEqual([{ id: "12", name: "Vendor" }]);
  expect(calls[0]!.url).toBe(
    "https://sandbox.procore.com/rest/v1.1/projects/13/vendors?view=name&page=1&per_page=100",
  );
  expect(calls[0]!.headers.get("Procore-Company-Id")).toBe("42");
  expect(calls[0]!.headers.get("Authorization")).toBe("Bearer private-token");
  expect(() => c.vendors("42", "../other")).toThrow(ProcoreError);
  expect(calls).toHaveLength(1);
});
test("pagination never follows untrusted Link origins", async () => {
  const urls: string[] = [];
  const c = client(async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? reply([{ id: 1, name: "One" }], {
          Link: '<https://attacker.test/steal>; rel="next"',
          Total: "2",
        })
      : reply([{ id: 2, name: "Two" }], { Total: "2" });
  });
  expect(await c.companies()).toHaveLength(2);
  expect(
    urls.every((u) =>
      u.startsWith("https://sandbox.procore.com/rest/v1.0/companies?"),
    ),
  ).toBe(true);
  expect(urls[1]).toContain("page=2");
});
test("rejects duplicate, incomplete, or capped catalogs", async () => {
  await expect(
    client(async () =>
      reply([{ id: 1, name: "One" }], { Total: "2" }),
    ).companies(),
  ).rejects.toMatchObject({ code: "DUPLICATE_PAGE" });
  await expect(
    client(async () => reply([], { Total: "2" })).companies(),
  ).rejects.toMatchObject({ code: "INCOMPLETE_PAGINATION" });
  await expect(
    client(async () => reply([{ id: 1, name: "One" }], { Total: "2" }), {
      maxPages: 1,
    }).companies(),
  ).rejects.toMatchObject({ code: "PAGE_LIMIT" });
  await expect(
    client(
      async () =>
        reply([
          { id: 1, name: "One" },
          { id: 2, name: "Two" },
        ]),
      { maxItems: 1 },
    ).companies(),
  ).rejects.toMatchObject({ code: "ITEM_LIMIT" });
});
test("decodes v2 envelopes and preserves project company identity", async () => {
  expect(
    await client(async () =>
      reply({
        data: [
          {
            id: "77",
            title: "PO",
            number: "001",
            status: "Approved",
            type: "PurchaseOrderContract",
          },
        ],
      }),
    ).contracts("42", "13"),
  ).toEqual([
    {
      id: "77",
      title: "PO",
      number: "001",
      status: "Approved",
      type: "PurchaseOrderContract",
    },
  ]);
  expect(
    (
      await client(async () =>
        reply([
          {
            id: 13,
            name: "Site",
            company: { id: 42 },
            active: true,
            project_number: "A",
            tz_name: "America/New_York",
          },
        ]),
      ).projects("42")
    )[0]!.companyId,
  ).toBe("42");
});
test("delivery reconciliation requests the explicit date", async () => {
  let url = "";
  await client(async (u) => {
    url = String(u);
    return reply([]);
  }).deliveryLogs("42", "13", "2026-10-07");
  expect(url).toContain("log_date=2026-10-07");
  expect(url).toContain("filters%5Bstatus%5D=all");
  expect(() => deliveryLogPayload({ ...input, date: "2026-02-30" })).toThrow(
    ProcoreError,
  );
});
test("creates a delivery log with an explicit tracking reference", async () => {
  let body: unknown;
  const c = client(async (_, init) => {
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    body = JSON.parse(String(init?.body));
    return reply({
      id: 99,
      ...deliveryLogPayload(input).delivery_log,
      status: "pending",
    });
  });
  expect((await c.createDeliveryLog("42", "13", input)).id).toBe("99");
  expect(body).toEqual(deliveryLogPayload(input));
});
test("write uncertainty is explicit and never automatically retried", async () => {
  for (const status of [400, 401, 403, 422, 429, 500, 502]) {
    let calls = 0;
    const c = client(async () => {
      calls++;
      return new Response("sensitive provider body", { status });
    });
    await expect(c.createDeliveryLog("42", "13", input)).rejects.toMatchObject({
      code: "HTTP_" + status,
      outcome: status >= 500 ? "unknown" : "rejected",
    });
    expect(calls).toBe(1);
  }
  await expect(
    client(async () => {
      throw new Error("secret");
    }).createDeliveryLog("42", "13", input),
  ).rejects.toMatchObject({ code: "UNAVAILABLE", outcome: "unknown" });
  await expect(
    client(async () => reply({ id: 99 })).createDeliveryLog("42", "13", input),
  ).rejects.toMatchObject({ code: "INVALID_RECEIPT", outcome: "unknown" });
});
test("bounds response size and rejects malformed JSON without exposing content", async () => {
  await expect(
    client(async () => reply([{ id: 1, name: "large" }]), {
      maxBytes: 5,
    }).companies(),
  ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  await expect(
    client(async () => new Response("secret malformed data")).companies(),
  ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
});

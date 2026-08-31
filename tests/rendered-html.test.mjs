import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/", headers = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", ...headers } }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("developer starts without preloaded cases", async () => {
  const identityHeaders = {
    "oai-authenticated-user-id": "test-user",
    "oai-authenticated-user-email": "test@example.com",
  };
  const [pageResponse, unauthorizedResponse, casesResponse] = await Promise.all([
    render("/?view=developer"),
    render("/api/cases"),
    render("/api/cases", identityHeaders),
  ]);
  assert.equal(pageResponse.status, 200);
  assert.equal(unauthorizedResponse.status, 401);
  assert.equal(casesResponse.status, 200);

  const [page, payload] = await Promise.all([
    pageResponse.text(),
    casesResponse.json(),
  ]);
  assert.deepEqual(payload, { cases: [] });
  assert.match(page, /Verificando acceso/);
  assert.doesNotMatch(page, /D1305597|Antonia Renata|Casos recientes 12/);
});

test("server-renders RevisaTuCuenta", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>RevisaTuCuenta \| Entiende y revisa tu cuenta clínica<\/title>/i);
  assert.match(html, /RevisaTuCuenta/);
  assert.match(html, /Entiende lo que te cobraron/);
  assert.match(html, /Entrada paciente/);
  assert.match(html, /Entrada desarrolladores/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("keeps the production surface free of starter artifacts", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /DeveloperPortal, PatientPortal, PortalEntry/);
  assert.match(page, /searchParams/);
  assert.doesNotMatch(page, /evaluateEmblematicCase|demoDocument|Workbench/);
  assert.match(layout, /RevisaTuCuenta \| Entiende y revisa tu cuenta clínica/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
});

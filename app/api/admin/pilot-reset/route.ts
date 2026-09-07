export async function POST() {
  return Response.json(
    { error: "La limpieza masiva está deshabilitada para conservar los documentos de pacientes" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

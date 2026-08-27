import { DeveloperPortal, PatientPortal, PortalEntry } from "./operational-portal";

// Railway must evaluate the query string on every request so the public
// patient and developer portals remain separate entry points.
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = Array.isArray(params?.view) ? params.view[0] : params?.view;
  const caseId = Array.isArray(params?.case) ? params.case[0] : params?.case;

  if (view === "patient") return <PatientPortal initialCaseId={caseId} />;
  if (view === "developer") return <DeveloperPortal initialCaseId={caseId} />;
  return <PortalEntry />;
}

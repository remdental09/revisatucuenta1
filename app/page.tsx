import { DeveloperPortal, PatientPortal, PortalEntry } from "./operational-portal";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const view = Array.isArray(params?.view) ? params.view[0] : params?.view;

  if (view === "patient") return <PatientPortal />;
  if (view === "developer") return <DeveloperPortal />;
  return <PortalEntry />;
}

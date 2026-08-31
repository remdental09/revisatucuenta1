import PaymentDemoClient from "./payment-demo-client";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PaymentDemo({ searchParams }: PageProps) {
  const params = await searchParams;
  const caseId = Array.isArray(params?.case) ? params.case[0] : params?.case;
  return <PaymentDemoClient caseId={caseId || ""} />;
}

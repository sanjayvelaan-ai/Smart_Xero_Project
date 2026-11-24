import { PaymentPage } from "@/client/order-experience";
export default async function Checkout({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ shop?: string }>;
}) {
  const { reference } = await params,
    { shop } = await searchParams;
  return <PaymentPage shop={shop ?? "printflow-demo"} reference={reference} />;
}

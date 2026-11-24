import { TrackPage } from "@/client/customer";
export default async function TrackingPage({ params, searchParams }: {
  params: Promise<{ orderId: string }>; searchParams: Promise<{ shop?: string }>;
}) {
  const { orderId } = await params;
  const { shop } = await searchParams;
  return <TrackPage orderId={orderId} shopId={shop && /^[a-z0-9-]{2,40}$/.test(shop) ? shop : "printflow-demo"} />;
}

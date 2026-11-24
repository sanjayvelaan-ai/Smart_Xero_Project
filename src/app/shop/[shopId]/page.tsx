import { notFound } from "next/navigation";
import { CustomerPage } from "@/client/customer";
export default async function ShopPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  if (!/^[a-z0-9-]{2,40}$/.test(shopId)) notFound();
  return <CustomerPage shopId={shopId} />;
}

import { PersonalReplay } from "@/client/twin";
import "../../../../digital-twin/floor.css";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ shop?: string }>;
}) {
  const { orderId } = await params,
    { shop } = await searchParams;
  return <PersonalReplay id={orderId} shop={shop ?? "printflow-demo"} />;
}

import { headers } from "next/headers";
import { DEMO_SHOP, prototypeLoginAllowed } from "@/server/identity";
import { TwinPage } from "@/client/twin";
import "./floor.css";
export const metadata = { title: "Live 3D shop" };
export default async function DigitalTwin({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string; order?: string }>;
}) {
  const { shop, order } = await searchParams;
  const shopId = shop && /^[a-z0-9-]{2,40}$/.test(shop) ? shop : DEMO_SHOP;
  const prototypeLogin = prototypeLoginAllowed(shopId, (await headers()).get("host"));
  return (
    <TwinPage
      prototypeLogin={prototypeLogin}
      initialOrder={order}
      shop={shopId}
    />
  );
}

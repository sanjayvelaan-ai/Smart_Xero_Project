import { headers } from "next/headers";
import { DEMO_SHOP, prototypeLoginAllowed } from "@/server/identity";
import { notFound } from "next/navigation";
import { TwinPage } from "@/client/twin";
import "../../floor.css";

export const metadata = { title: "Shop replay" };

export default async function ReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ shop?: string; through?: string }>;
}) {
  const { sessionId } = await params;
  const { shop, through } = await searchParams;
  if (
    sessionId !== "all" &&
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionId)
  )
    notFound();
  if (
    through !== undefined &&
    (!/^\d+$/.test(through) || !Number.isSafeInteger(Number(through)))
  )
    notFound();
  const shopId = shop && /^[a-z0-9-]{2,40}$/.test(shop) ? shop : DEMO_SHOP;
  const prototypeLogin = prototypeLoginAllowed(shopId, (await headers()).get("host"));
  return (
    <TwinPage
      prototypeLogin={prototypeLogin}
      shop={shopId}
      initialReplay={{
        id: sessionId,
        through: through === undefined ? undefined : Number(through),
      }}
    />
  );
}

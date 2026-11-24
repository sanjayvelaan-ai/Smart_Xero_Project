import { headers } from "next/headers";
import type { ReactNode } from "react";
import { OwnerWorkspace } from "@/client/owner";
import { DEMO_SHOP, prototypeLoginAllowed } from "@/server/identity";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  const prototypeLogin = prototypeLoginAllowed(DEMO_SHOP, (await headers()).get("host"));
  return <><OwnerWorkspace prototypeLogin={prototypeLogin} />{children}</>;
}

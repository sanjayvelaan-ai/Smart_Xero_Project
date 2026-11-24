import { notFound } from "next/navigation";
import { parseOwnerSection } from "@/lib/owner-route";

export default async function OwnerRoute({ params }: {
  params: Promise<{ section?: string[] }>;
}) {
  const { section = [] } = await params;
  if (!parseOwnerSection(section)) notFound();
  return null;
}

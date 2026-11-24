const ownerSections = ["overview", "orders", "printers", "analytics", "settings"] as const;
export type Section = typeof ownerSections[number];

export function parseOwnerSection(segments: string[]): Section | undefined {
  if (segments.length > 1) return;
  return ownerSections.find(section => section === (segments[0] ?? "overview"));
}

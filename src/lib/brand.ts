export const brandName = "PrintEvo";
export const brandTagline = "Traditional Printing. Transformed.";
export const brandVision = "Transform every ordinary Xerox shop into a smart printing destination.";

export const defaultShopName = brandName + " Smart Xerox Center";

export function shopDisplayName(name: string) {
  return name === "PrintFlow Smart Xerox Center" ? defaultShopName : name;
}

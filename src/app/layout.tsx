import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./styles.css";
import "./studio.css";
import "@fontsource-variable/manrope";
import "./liquid.css";
import "./appearance.css";
import { Appearance } from "@/components/glass/appearance";
import { GlassInteractions } from "@/components/glass/interactions";
import { brandName, brandTagline, brandVision } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: brandName + " | " + brandTagline, template: "%s | " + brandName },
  description: brandVision,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth"><head><script dangerouslySetInnerHTML={{ __html:
    "try{var t=localStorage.getItem('printflow-appearance');document.documentElement.dataset.theme=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light'}catch{}"
  }} /></head><body><Appearance>{children}</Appearance><GlassInteractions /></body></html>;
}

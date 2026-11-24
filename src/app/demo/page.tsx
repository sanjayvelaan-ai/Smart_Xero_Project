import Link from "next/link";
import { FileText, LayoutDashboard, Printer } from "lucide-react";
import { Logo, WorkspaceSwitch } from "@/client/shared";
import { GuidedPrint } from "@/client/guided-print";
import { DemoActions } from "@/client/demo-actions";

export default function DemoPage() {
  return <div className="customer-shell">
    <header className="customer-nav"><div className="nav-inner"><Logo /><WorkspaceSwitch shop="printflow-demo" /><span className="pill purple">Demo mode</span></div></header>
    <main className="customer-wrap single-page">
      <div className="page-heading"><div><p className="eyebrow">DEMONSTRATION</p><h1>Run a print order end to end</h1>
        <p>Follow a sample job from checkout to pickup across all three workspaces.</p></div></div>
      <div className="feature-grid">
        <article className="panel"><span className="icon-block purple"><FileText /></span><h2>Place a sample order</h2>
          <p>Open the customer portal, use a sample PDF, choose Normal or Express, and complete the simulated payment.</p><Link className="button primary" href="/customer">Open customer portal</Link></article>
        <article className="panel"><span className="icon-block blue"><LayoutDashboard /></span><h2>Manage the print queue</h2>
          <p>Sign in as Ram, select the incoming order, assign a compatible printer, and start the simulation.</p><Link className="button outline" href="/owner">Open owner dashboard</Link></article>
        <article className="panel"><span className="icon-block green"><Printer /></span><h2>Verify pickup</h2>
          <p>Mark the print ready, then use the customer’s collection code to complete the order and check document cleanup.</p><Link className="button outline" href="/customer#my-orders">Find my orders</Link></article>
      </div>
      <section className="panel demo-generator"><h2>Watch a guided print</h2><p>Sign in to the local owner dashboard first. Start a sample here and open the shop floor in another tab to watch it.</p><GuidedPrint /><Link href="/digital-twin" className="text-button" target="_blank">Open the shop floor</Link></section>
      <DemoActions />
    </main>
  </div>;
}

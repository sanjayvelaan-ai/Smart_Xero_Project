"use client";
import { useState } from "react";
import { type Order } from "../domain";
import { apiPath } from "./shared";
import { PdfPreview } from "./pdf-preview";
export function StaffPreview({ order, shop }: { order: Order; shop: string }) {
  const [open, setOpen] = useState(false);
  const url = apiPath(shop, "staff/orders/" + order.id + "/preview");
  return (
    <section>
      <button
        className="button outline small"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Close document preview" : "Preview document"}
      </button>
      {open && (
        <div className="preview">
          {order.fileName?.toLowerCase().endsWith(".pdf") ? (
            <PdfPreview url={url} pages={order.originalPages} />
          ) : (
            <img src={url} alt="Print document preview" />
          )}
        </div>
      )}
    </section>
  );
}

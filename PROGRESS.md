# PrintFlow OS progress

## Implemented

| Area | Delivered |
| --- | --- |
| Customer ordering | Mobile upload, document preview, configuration, Normal or Express, checkout and tracking. Shared navigation preserves the shop and sessions. |
| Owner operations | Restyled dashboard, queues, printer controls, revenue, pickup and alerts. The order dialog links directly to the corresponding avatar, with a return link to manage that job. |
| Shop and characters | Three.js cutaway interior with a working order QR, payment-portal board, computer, queue monitor, three detailed copiers, supply shelves and collection desk. Ram and the worker use rigged models. Each active order has a stable avatar ID. |
| Physical workflow | Arrivals scan, sit on available benches or wait in spaced standing positions, and depart after collection. Output sheets emerge at the copier outlet. A worker approaches the tray, reaches for the stack, carries it to its counter slot and hands it to the verified customer. Online state, job, progress and paper availability use the shop projection. |
| Cameras and inspection | Fifteen presets, automatic event-directed shots, orbit controls, click selection, keyboard-accessible object lists, fullscreen, graphics quality and optional printer audio. |
| Synchronization | Staff-authorized snapshot, paginated event history, sequence-based deduplication, SSE reconnection and refresh restoration. Same-tab workspace switches briefly retain the WebGL room with its render loop suspended. |
| Replay | Staff can replay the shop or any order through a fixed event cutoff. Customers can replay their own order from their original session. Both use recorded events and support seeking, pausing and playback speed controls. |

## Batch orders and fulfillment

- Customers can combine PDFs and photos from files and folders, review local English OCR and print-quality suggestions, reorder files and accept adjustments before checkout. Confidential staff previews are blocked by the API.
- An order-specific QR confirms simulated payments, updates the owner dashboard and admits paid work to the queue. For home deliveries, staff verify the courier OTP and the customer confirms receipt.
- The shop floor includes seated and spaced standing customers and a separate uniformed rider. Customers can replay their own recorded order in 3D from tracking. Staff can replay individual orders from the dashboard.

## Scheduling and collection

Paid bookings enter the active queue at the planned print time. Staff can start the next compatible job from an idle prototype printer. The dashboard and 3D shop receive order events for collection reminders, delayed queues, waiting riders and successful pickups. The prototype animates customer or rider collection according to the fulfillment choice.

## Verification

- TypeScript and the optimized Next.js build passed.
- All 18 domain, integration and projection tests passed. They cover scheduling fairness, capabilities, payment confirmation, real-shop staff reporting, file cleanup, event replay and distinct waiting slots at loads up to 50 orders.
- The five-order Chrome scenario created orders in the customer portal, opened them in the dashboard, started printer 01, refreshed the 3D view, verified five stable avatar IDs, replayed without operational writes, and verified the worker carry and handoff. Pickup produced one completion and left four active orders.
- All seven Playwright scenarios passed in local Chrome, including a mixed-file folder checkout through QR payment, collection, home delivery and personal replay. They also covered independent customer and staff sessions, printer updates during a disconnect, reopening a bookmarked replay after refresh, QR ordering, mobile PDF preview, pricing and analytics. The guided demonstration reached verified pickup through its simulated gateway and printer.
- Local Chrome checks verified a pointer hit on the actual color copier, the owner-monitor camera, room retention between workspaces and the responsive layouts. The customer portal, owner dashboard and 3D shop were checked at 390 × 844, 844 × 390 and 1440 × 900 CSS pixels.
- Fixed transitions between customer tracking, the owner dialog and its selected avatar. Corrected restored printer assignments, hand targets, camera navigation and scene retention. The real-shop worker starts collection from the staff report.

## Operating limits

- The local models are stylized. The copier uses an original model and the humanoids use Quaternius CC0 assets. Replaceable asset paths, scale and anchors are in [the model notes](public/models/LICENSES.md).
- Animated sheets represent a print run. The counter and printer state come from the backend. Real-mode avatars represent remote orders. The shop has no customer location sensor or connected hardware telemetry.
- Replay can reconstruct status, payment, printer assignments and recorded progress. Historical wait estimates were never persisted. Device descriptions use the configured printer profiles.
- Physical device validation, shop-specific alignment and live Razorpay transactions require the shop's equipment and credentials. Local tests use isolated databases, demo equipment and simulated payments.

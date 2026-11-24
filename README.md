# PrintEvo

**Traditional Printing. Transformed.**

PrintEvo connects the customer portal, owner dashboard and live 3D shop for PrintEvo Smart Xerox Center in Velachery, Chennai. All three workspaces use the same persisted orders, printer assignments, payments and event history.

## Start locally

Requires Node.js 22.13 or later and npm. Docker is optional.

```powershell
npm ci
npm run dev
```

Open [Customer portal](http://localhost:3000/customer), [Owner dashboard](http://localhost:3000/owner), or [Live 3D shop](http://localhost:3000/digital-twin). The local shop simulates printer activity, QR payments and courier collection. Use **Enter demo as owner** for one-click access to the prototype dashboard and 3D shop on `localhost`. Staff can also sign in as **ram**, **meena** or **arun** with a password from `.printflow/staff-access.json`, generated when the local shop is first initialized. An optional `PRINTFLOW_LOCAL_OWNER_PASSWORD` overrides the local owner password. Customer uploads and tracking use a separate guest session. For a locally bound production build, set `PRINTFLOW_PROTOTYPE_LOGIN=true` to enable one-click sign-in on the prototype shop.

The app migrates and seeds the database automatically. Run `npm run db:seed` before starting the app if you want to initialize it separately. The default setup uses embedded PostgreSQL via PGlite in `.printflow/postgres`, with encrypted temporary files in `.printflow/documents`. Keep this directory between runs to retain orders. Stop the app before running a separate seed process against the embedded database.

### Walk through a print order

1. In the customer portal, choose files or a folder and review the assistant’s suggestions. Prepare the print packet, choose settings and select Normal or Express.
2. Place a prepaid order, scan its QR or open its payment link, then confirm the simulation. The order moves into the queue. Pickup customers may also choose to pay at the counter.
3. On the owner dashboard, open the order and assign an idle compatible printer. Start the simulated print and wait for it to move to Finishing.
4. Mark the order ready for pickup. Copy the six-digit code from customer tracking and enter it in the owner dashboard.
5. Check that tracking shows **Completed** and **Temporary file removed**. All three workspaces can stay open in separate tabs.

The demo guide can generate three example orders through the same upload, quote, checkout, and payment APIs used by customers.

### Scheduled collection and printer actions

At checkout, select **Schedule collection**, enter the collection time in India time and choose shop pickup or simulated delivery. Prepayment confirms the booking. Select a time within the encrypted upload’s 24-hour lifetime. The shop plans to start at least ten minutes before collection, allowing extra time for larger jobs. A busy or unavailable printer can delay the job.

On the Printers page each idle device offers the next compatible job, using the Normal and Express queue policy. In the prototype this action assigns and starts printing together. A booked job enters the queue automatically at its planned start. Real equipment still requires staff to confirm physical printing.

The dashboard notification bell and the live floor’s **Shop alerts** show collection reminders, long waits, rider arrivals and completions. Paid prototype shop pickups complete automatically after finishing and the collection grace period. Physical-shop pickups and simulated rider handoffs require the collection code. Delivery orders show only the simulated rider on the floor.

### Use the shop floor

Open **Live 3D shop** and sign in with a staff account. Select a person or a printer in the scene or the adjacent list. The ordering board, counter, queue display and owner computer also open contextual details. In the owner order dialog, **View order on shop floor** follows that order directly. **Manage this order** returns to its dashboard actions.

**Pause** in the camera strip freezes the visualization while the backend continues processing. Use **Timeline** for camera-independent playback speed, service filters and event markers. **Replay shop** or **Replay this order** opens a read-only historical view. **Open replay link** creates a staff-only URL for the selected order or shop through the recorded event cutoff. **Return to live** restores the current floor.

The scene uses bundled Three.js models, locally generated surface maps, baked character animation and procedural wrist targeting. Controls support drag to orbit, scroll or pinch to zoom, fifteen camera presets, low-power rendering and optional printer sound. Characters and paper paths illustrate committed events. Real-shop customers appear as virtual queue entries, and staff report printer progress. The accessible order list and timeline work when WebGL is unavailable. See [asset details and replacement anchors](public/models/LICENSES.md).

### Batch printing, privacy and delivery

Select individual files or a folder of PDFs, JPEGs and PNGs. Review the proposed order, rotate pages, or improve photo contrast before preparing a single print packet. The limit is 50 files, 500 pages and 20 MB per order. During configuration, page numbers are local to each file. Staff see the corresponding page ranges in the combined PDF and apply each file's settings when printing. Standard form values become static page content. Embedded attachments and annotation layers are removed from the print copy. The assistant shows upload alerts and checks photo quality, PDF orientation and color locally. English LSTM OCR runs on photos and image-based first pages of PDFs. Customers can mark any packet confidential. Staff then see a black placeholder and the server denies preview access. The real-shop owner retains audited download access during printing.

Prepaid orders in the local shop get a unique simulated payment QR. Scanning and confirming the amount updates the dashboard and queue. Choose simulated Blinkit home delivery to supply an address. The customer shares the collection OTP with the rider. Staff verify the code to release the prints and the customer confirms receipt at home. No Blinkit booking or payment transfer takes place. Customers can open a private 3D replay from their tracking page using their original browser session.

### Scan the shop QR from a phone

For testing on a trusted local network, run `npm run dev -- --hostname 0.0.0.0` and open the app using the Windows computer’s network address. Open **Shop QR code** in the owner dashboard from that address. The QR embeds the current origin and correct shop route. A QR using `localhost` only works on the computer running the app.

## PostgreSQL and a worker-assisted shop

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to a PostgreSQL instance. For a local development instance, run `docker compose up -d postgres` and use the development connection string in the example.
2. Set `PRINTFLOW_OWNER_PASSWORD` for Ram. Add `PRINTFLOW_WORKER_PASSWORD` and `PRINTFLOW_SECOND_WORKER_PASSWORD` if Meena and Arun need access. Each password must be at least 12 characters. Restart the server after changing them.
3. Generate a 32-byte encryption key and set `PRINTFLOW_DOCUMENT_KEY`. Keep this key stable while encrypted documents are outstanding.
4. For a public installation, set `PRINTFLOW_PUBLIC_ORIGIN` to the shop’s HTTPS origin, terminate TLS at your trusted reverse proxy, and keep the app and PostgreSQL on private interfaces. Disable proxy buffering for the event streams. Set `PRINTFLOW_TRUST_PROXY=true` only when the trusted proxy sanitizes forwarding headers and appends the actual client address.
5. Open `/shop/velachery`, `/owner?shop=velachery` and `/digital-twin?shop=velachery`. The real shop’s orders, printers, and sessions are separate from the demo’s.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm run build
npm start
```

In the worker-assisted shop, staff download assigned jobs for printing and confirm progress and completion after observing the physical printer. Confidential jobs can only be downloaded by an owner. PrintFlow records authorized document downloads. The optional Windows print agent is outside this phase.

### Optional Razorpay UPI

Enable this on a staging HTTPS domain with Razorpay test credentials first. Set the three Razorpay secrets in `.env.local`, configure the UPI checkout methods in Razorpay, and direct Razorpay webhooks to `/api/shops/velachery/webhook`. Subscribe to `payment.captured`, `payment.failed`, `order.paid`, and `refund.processed`. The application validates webhook signatures and checks the provider order, amount, currency and capture status. A checkout response prompts server-side reconciliation and never marks an order paid by itself.

Issue UPI refunds in Razorpay and use **Check gateway status** in the order detail if a webhook has not arrived. Counter refunds are recorded by the owner after the refund is issued. See [Razorpay checkout setup](https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/) and [Razorpay webhook validation](https://razorpay.com/docs/webhooks/validate-test/).

## Architecture

- Next.js App Router serves both React portals and the modular Node.js API. Zod validates commands and settings. SQL migrations and parameterized queries support embedded or external PostgreSQL.
- The backend serializes mutations per shop. An order command and its events commit in one database transaction. Unique order and print-job constraints prevent duplicate checkout requests and concurrent assignments to the same printer.
- Queue estimates use printer capability, workload, progress, and job size. Express admission is capacity-limited. The scheduler protects eligible Normal work through FIFO ordering, a maximum Express burst, and priority aging. Automatic assignment reserves more capable printers where possible. Workers initiate printing in either mode.
- Server-Sent Events announce committed changes. Clients re-fetch authoritative state, recover after a disconnect, and recheck state when returning to a tab. Staff event feeds require a valid shop session.
- The 3D client bootstraps from `GET /api/shops/{shopId}/staff/projection`, reads committed changes through `GET /api/shops/{shopId}/staff/events?after={sequence}`, and watches `GET /api/shops/{shopId}/staff/live`. Replay pages contain up to 200 events in sequence order. The projection uses stable order-linked avatar IDs and omits documents, instructions, and pickup codes.
- Uploads are limited to 20 MB. PDF parsing checks page counts and rejects interactive content. JPG and PNG input is decoded and re-encoded. Bytes live outside PostgreSQL under AES-256-GCM encryption and expire after 24 hours or on collection or cancellation. The worker records purge success or retry. Staff downloads, Windows spool files, and printer storage may persist outside PrintFlow.

The provided runtime is designed for a single long-running Node instance with persistent disk. Before exposing the real shop to customers, set up reverse-proxy and storage monitoring, backups, and dedicated malware scanning for incoming documents. Physical printers and live Razorpay transactions require acceptance testing with the shop’s devices and account.

## Verification

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright uses installed Chrome on Windows when available. On other systems, run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROME` to a compatible browser executable. The browser suite starts a build on port 3217 with a fresh demo database. It covers separate customer and staff sessions, Normal and Express checkout, QR routing, mobile PDF preview, reconnect, printing, pickup verification, temporary-file removal, owner pricing, demo analytics, a five-order workflow across the three workspaces, batch OCR, private previews, simulated QR payment, courier OTP, receipt and session-scoped replay.

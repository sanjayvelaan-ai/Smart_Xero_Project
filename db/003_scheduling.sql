ALTER TABLE orders ADD COLUMN collection_at timestamptz, ADD COLUMN print_at timestamptz, ADD COLUMN printed_at timestamptz;
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('AWAITING_PAYMENT','SCHEDULED','QUEUED','ASSIGNED','PRINTING','HELD','FINISHING','READY','COMPLETED','FAILED','CANCELLED'));
CREATE UNIQUE INDEX order_once_alert ON order_events(order_id,type) WHERE type IN ('COLLECTION_REMINDER','WAIT_ALERT','COURIER_ARRIVED');

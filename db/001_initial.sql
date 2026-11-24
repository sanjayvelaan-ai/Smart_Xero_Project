CREATE TABLE shops (
  id text PRIMARY KEY,
  demo boolean NOT NULL,
  settings jsonb NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  token_counter integer NOT NULL DEFAULT 1000
);
CREATE TABLE staff (
  id text PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops,
  name text NOT NULL,
  username text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER', 'WORKER')),
  password_hash text,
  UNIQUE(shop_id, username)
);
CREATE TABLE sessions (
  id text PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops,
  staff_id text REFERENCES staff,
  expires_at timestamptz NOT NULL
);
CREATE TABLE printers (
  shop_id text NOT NULL REFERENCES shops,
  id integer NOT NULL,
  config jsonb NOT NULL,
  online boolean NOT NULL DEFAULT true,
  error text,
  normal_passed integer NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, id)
);
CREATE TABLE documents (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops,
  customer_id text NOT NULL,
  file_name text NOT NULL,
  media_type text NOT NULL,
  bytes integer NOT NULL CHECK (bytes > 0),
  pages integer NOT NULL CHECK (pages > 0),
  privacy text NOT NULL DEFAULT 'AVAILABLE',
  expires_at timestamptz NOT NULL,
  purge_attempts integer NOT NULL DEFAULT 0,
  retry_at timestamptz,
  purged_at timestamptz
);
CREATE TABLE orders (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops,
  customer_id text NOT NULL,
  document_id uuid NOT NULL UNIQUE REFERENCES documents,
  token text NOT NULL,
  request_key uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('NORMAL','EXPRESS')),
  status text NOT NULL CHECK (status IN ('AWAITING_PAYMENT','QUEUED','ASSIGNED','PRINTING','HELD','FINISHING','READY','COMPLETED','FAILED','CANCELLED')),
  price jsonb NOT NULL,
  options jsonb NOT NULL,
  pickup_pin text NOT NULL,
  pickup_failures integer NOT NULL DEFAULT 0,
  pickup_retry_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  reason text,
  retries integer NOT NULL DEFAULT 0,
  UNIQUE (shop_id, token),
  UNIQUE (shop_id, customer_id, request_key)
);
CREATE INDEX orders_shop_state ON orders(shop_id, status, queued_at);
CREATE INDEX orders_customer ON orders(shop_id, customer_id, created_at DESC);
CREATE INDEX documents_cleanup ON documents(shop_id, expires_at) WHERE privacy <> 'PURGED';
CREATE TABLE payments (
  order_id uuid PRIMARY KEY REFERENCES orders,
  method text NOT NULL CHECK (method IN ('DEMO','COUNTER','UPI')),
  state text NOT NULL CHECK (state IN ('PENDING','COUNTER_DUE','PAID','REFUND_PENDING','REFUNDED','VOID')),
  amount integer NOT NULL CHECK (amount >= 0),
  provider_order text UNIQUE,
  provider_payment text UNIQUE,
  paid_at timestamptz,
  refunded_at timestamptz
);
CREATE TABLE print_jobs (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL,
  printer_id integer NOT NULL,
  order_id uuid NOT NULL REFERENCES orders,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  result text,
  simulated boolean NOT NULL,
  FOREIGN KEY (shop_id, printer_id) REFERENCES printers(shop_id, id)
);
CREATE TABLE payment_callbacks (
  id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX print_jobs_active_printer ON print_jobs(shop_id, printer_id) WHERE finished_at IS NULL;
CREATE UNIQUE INDEX print_jobs_active_order ON print_jobs(order_id) WHERE finished_at IS NULL;
CREATE TABLE order_events (
  id uuid PRIMARY KEY,
  shop_id text NOT NULL REFERENCES shops,
  sequence integer NOT NULL,
  order_id uuid REFERENCES orders,
  type text NOT NULL,
  actor_id text NOT NULL,
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, sequence)
);
CREATE INDEX order_events_by_order ON order_events(order_id, sequence);
CREATE TABLE commands (
  shop_id text NOT NULL REFERENCES shops,
  actor_id text NOT NULL,
  id uuid NOT NULL,
  PRIMARY KEY(shop_id, actor_id, id)
);
CREATE TABLE rate_limits (
  scope text PRIMARY KEY,
  hits integer NOT NULL,
  reset_at timestamptz NOT NULL
);

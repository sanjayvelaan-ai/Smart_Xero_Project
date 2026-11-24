ALTER TABLE orders ADD COLUMN delivery_address text, ADD COLUMN delivered_at timestamptz, ADD COLUMN payment_reference uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX orders_payment_reference ON orders(payment_reference);
DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE password_hash IS NULL);


-- Finance overhaul part 3: receipt → Google Drive linkage.
-- Adds two nullable columns to transactions for the Drive file pointer
-- the receipt-upload endpoint writes when the integration is configured.

alter table transactions
  add column if not exists receipt_drive_file_id text,
  add column if not exists receipt_drive_url text;

create index if not exists transactions_drive_file_idx
  on transactions(receipt_drive_file_id)
  where receipt_drive_file_id is not null;

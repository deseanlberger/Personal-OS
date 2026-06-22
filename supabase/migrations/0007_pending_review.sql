-- Adds needs_review to transactions so receipts captured via photo
-- (and later, gmail/sheet imports) land in a pending state. Desean
-- approves each one on /finance after picking account/category/business.

alter table transactions
  add column if not exists needs_review boolean not null default false;

create index if not exists transactions_pending_review_idx
  on transactions(user_id, created_at desc)
  where needs_review = true;

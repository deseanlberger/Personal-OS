-- Per-transaction subscription status: "cancelled" (already cancelled, no
-- more charges) or "could_cancel" (still active, candidate for cutting).
-- Rolls up into the Savings Tracker card on /finance.

alter table transactions
  add column if not exists subscription_status text
  check (subscription_status in ('cancelled', 'could_cancel'));

create index if not exists transactions_subscription_status_idx
  on transactions(user_id, subscription_status)
  where subscription_status is not null;

-- Per-category monthly budgets. /finance Budget section reads these and
-- shows over/under for each month.
create table if not exists category_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  category text not null,
  monthly_amount numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, category)
);
create index if not exists category_budgets_user_idx on category_budgets(user_id);
alter table category_budgets enable row level security;

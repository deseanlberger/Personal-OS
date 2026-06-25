-- Finance overhaul part 1: foundation schema for the bigger rebuild.
--
--   1. account_balances — timestamped balance snapshots per account, so we
--      can chart net worth over time (manual entry now, later auto via Plaid).
--   2. category_rules — vendor → category memorization. The dashboard adds
--      a rule automatically the second time you fix a vendor's category;
--      future imports auto-apply.
--   3. transactions.subscription_confirmed — distinct from the existing
--      subscription_status. confirmed=true means YOU explicitly said this
--      is a subscription (not just an algorithmic guess). Powers the
--      audit / pie chart features in later PRs.

create table if not exists account_balances (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  account_id uuid not null references accounts(id) on delete cascade,
  as_of_date date not null,
  balance numeric(14, 2) not null,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'plaid', 'import')),
  created_at timestamptz not null default now()
);
create index if not exists account_balances_account_date_idx
  on account_balances(account_id, as_of_date desc);
create index if not exists account_balances_user_date_idx
  on account_balances(user_id, as_of_date desc);
alter table account_balances enable row level security;
create policy "deny_all_account_balances" on account_balances for all using (false);

-- Vendor → category memorization. unique(user_id, vendor_normalized) so
-- repeated edits to the same vendor keep updating one row.
create table if not exists category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  vendor_normalized text not null,
  category text not null,
  is_business boolean,
  hit_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, vendor_normalized)
);
create index if not exists category_rules_user_idx on category_rules(user_id);
alter table category_rules enable row level security;
create policy "deny_all_category_rules" on category_rules for all using (false);

-- Explicit subscription confirmation. The existing subscription_status
-- column ('cancelled' / 'could_cancel' / null) is for the SAVINGS tracker;
-- this new column is the source of truth for "is this charge a recurring
-- subscription I want to see in the audit / pie chart". Three states:
--   true  — user said YES this is a subscription
--   false — user said NO this is one-off
--   null  — not yet reviewed; the audit page shows these as Pending
alter table transactions
  add column if not exists subscription_confirmed boolean;
create index if not exists transactions_subscription_confirmed_idx
  on transactions(user_id, subscription_confirmed)
  where subscription_confirmed = true;

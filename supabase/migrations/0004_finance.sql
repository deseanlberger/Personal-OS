-- Finance: accounts (cards/banks) + transactions (receipts).
-- Designed so Desean can later route Gmail receipt parsing or Google Sheet
-- exports into the same tables.

create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  name text not null,                -- "Chase Sapphire Reserve", "Amex Biz Platinum"
  short_name text,                   -- "CSR", "Amex Biz"
  last_4 text,                       -- "1234"
  type text not null check (type in ('credit', 'debit', 'cash', 'savings', 'checking', 'other')),
  category text not null default 'personal' check (category in ('personal', 'business')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index accounts_user_idx on accounts(user_id);
alter table accounts enable row level security;

create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  account_id uuid references accounts(id) on delete set null,
  txn_date date not null,
  amount numeric(12, 2) not null,    -- positive = expense; negative = refund/income
  vendor text,                       -- "Starbucks", "Vista Athletic Club"
  category text,                     -- "food", "gas", "athlete-fees", "supplements"
  memo text,                         -- free-text
  is_business boolean not null default false,
  source text not null default 'manual' check (source in ('manual', 'photo', 'gmail', 'sheet_import')),
  receipt_image_url text,            -- optional: where the receipt was uploaded
  raw_parse jsonb,                   -- raw output from GPT-4o vision for audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_user_date_idx on transactions(user_id, txn_date desc);
create index transactions_account_idx on transactions(account_id);
create index transactions_business_idx on transactions(is_business) where is_business = true;
alter table transactions enable row level security;

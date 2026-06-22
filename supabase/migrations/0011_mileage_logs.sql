-- Mileage tracking for the iOS Shortcut "Log Trip Mileage". Each row is a
-- single trip with origin/destination, distance, and a personal/business
-- flag (for tax deduction on business miles).

create table if not exists mileage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  trip_date date not null default current_date,
  from_address text,
  to_address text,
  miles numeric(8, 2) not null check (miles > 0),
  is_business boolean not null default false,
  purpose text,
  source text not null default 'shortcut',
  created_at timestamptz not null default now()
);

create index if not exists mileage_logs_user_date_idx
  on mileage_logs(user_id, trip_date desc);
create index if not exists mileage_logs_business_idx
  on mileage_logs(user_id, is_business)
  where is_business = true;

alter table mileage_logs enable row level security;
create policy "deny_all_mileage_logs" on mileage_logs for all using (false);

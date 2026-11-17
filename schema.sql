create table if not exists players (
  tg_id      bigint primary key,
  name       text,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists star_wallets (
  tg_id bigint primary key,
  balance integer not null default 0 check (balance >= 0),
  withdrawable integer not null default 0 check (withdrawable >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists star_orders (
  id uuid primary key,
  tg_id bigint not null,
  product_stars integer not null check (product_stars > 0),
  price_xtr integer not null check (price_xtr > 0),
  currency text not null default 'XTR' check (currency = 'XTR'),
  invoice_payload text not null unique,
  status text not null default 'pending' check (status in ('pending','paid','refunded','expired')),
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists star_transactions (
  id bigserial primary key,
  tg_id bigint not null,
  order_id uuid references star_orders(id),
  kind text not null check (kind in ('purchase','refund','withdrawal_request','withdrawal_rejected','adjustment')),
  amount integer not null,
  balance_after integer not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists star_withdrawal_requests (
  id uuid primary key,
  tg_id bigint not null,
  amount integer not null check (amount >= 50),
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid')),
  destination text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists star_orders_user_idx on star_orders(tg_id, created_at desc);
create index if not exists star_transactions_user_idx on star_transactions(tg_id, created_at desc);
create index if not exists star_withdrawals_user_idx on star_withdrawal_requests(tg_id, created_at desc);

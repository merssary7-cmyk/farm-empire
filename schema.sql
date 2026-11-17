create table if not exists players (
  tg_id      bigint primary key,
  name       text,
  state      jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('coach','client')),
  coach_id uuid references users(id) on delete set null,
  invite_code text unique,
  goal_kcal integer not null default 2000 check (goal_kcal between 800 and 6000),
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index users_email_lower on users (lower(email));
create index users_coach on users (coach_id);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

create table meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  name text not null,
  meal_type text check (meal_type in ('breakfast','lunch','dinner','snack')),
  note text not null default '',
  ai_confidence text,
  ai_note text not null default '',
  ai_items jsonb,
  corrected boolean not null default false,
  image bytea,
  image_type text,
  created_at timestamptz not null default now()
);
create index meals_user_time on meals (user_id, logged_at desc);

create table meal_items (
  id bigserial primary key,
  meal_id uuid not null references meals(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  portion_g double precision not null default 0,
  portion_text text not null default '',
  kcal double precision not null default 0,
  protein double precision not null default 0,
  carbs double precision not null default 0,
  fat double precision not null default 0
);
create index meal_items_meal on meal_items (meal_id);

create table replies (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references meals(id) on delete cascade,
  coach_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index replies_meal on replies (meal_id);

create table insights (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  audience text not null check (audience in ('client','coach')),
  body text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day, audience)
);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

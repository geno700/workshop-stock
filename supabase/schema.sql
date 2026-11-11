-- Workshop Stock: database schema for Supabase (version 2: many workshops in one database).
-- Run this whole file in the Supabase SQL Editor (Dashboard > SQL Editor > New query > Run).
-- It is safe to run again. On a version 1 database it upgrades in place: the existing stock
-- moves into a workshop called "My workshop" and everyone keeps their role.

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  join_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'pending' check (role in ('pending', 'viewer', 'member', 'admin')),
  created_at timestamptz not null default now(),
  primary key (workshop_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships (user_id);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.locations (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'done')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'raw' check (kind in ('raw', 'component', 'consumable', 'tool')),
  category text,
  unit text not null default 'pcs',
  quantity numeric not null default 0 check (quantity >= 0),
  min_quantity numeric not null default 0 check (min_quantity >= 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  location_id uuid references public.locations (id) on delete set null,
  supplier_id uuid references public.suppliers (id) on delete set null,
  specs jsonb not null default '{}'::jsonb,
  notes text,
  archived boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items (id) on delete cascade,
  type text not null check (type in ('in', 'out', 'adjust', 'checkout', 'return')),
  quantity numeric not null,
  delta numeric not null,
  balance_after numeric not null,
  reason text,
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Every stock table belongs to one workshop.
alter table public.locations add column if not exists workshop_id uuid references public.workshops (id) on delete cascade;
alter table public.suppliers add column if not exists workshop_id uuid references public.workshops (id) on delete cascade;
alter table public.projects add column if not exists workshop_id uuid references public.workshops (id) on delete cascade;
alter table public.items add column if not exists workshop_id uuid references public.workshops (id) on delete cascade;
alter table public.movements add column if not exists workshop_id uuid references public.workshops (id) on delete cascade;

-- ---------------------------------------------------------------- upgrade from version 1

-- Remove every existing access rule on these tables; they are created again at the end.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'workshops', 'memberships', 'locations', 'suppliers', 'projects', 'items', 'movements')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

drop function if exists public.my_role();

-- Version 1 kept one role per person. Move the existing stock and team into one workshop.
do $$
declare
  v_ws uuid;
  v_admin uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
  ) then
    execute 'select id from public.profiles where role = ''admin'' order by created_at limit 1' into v_admin;
    if v_admin is not null then
      insert into public.workshops (name, created_by) values ('My workshop', v_admin) returning id into v_ws;
      execute 'insert into public.memberships (workshop_id, user_id, role) select $1, id, role from public.profiles'
        using v_ws;
      update public.locations set workshop_id = v_ws where workshop_id is null;
      update public.suppliers set workshop_id = v_ws where workshop_id is null;
      update public.projects set workshop_id = v_ws where workshop_id is null;
      update public.items set workshop_id = v_ws where workshop_id is null;
      update public.movements set workshop_id = v_ws where workshop_id is null;
    end if;
    alter table public.profiles drop column role;
  end if;
end $$;

alter table public.locations alter column workshop_id set not null;
alter table public.suppliers alter column workshop_id set not null;
alter table public.projects alter column workshop_id set not null;
alter table public.items alter column workshop_id set not null;
alter table public.movements alter column workshop_id set not null;

-- Location names are unique inside a workshop, not across all of them.
alter table public.locations drop constraint if exists locations_name_key;
create unique index if not exists locations_workshop_name_key on public.locations (workshop_id, name);

create index if not exists movements_item_idx on public.movements (item_id, created_at desc);
drop index if exists public.movements_created_idx;
create index if not exists movements_workshop_idx on public.movements (workshop_id, created_at desc);
create index if not exists items_workshop_idx on public.items (workshop_id);

-- ---------------------------------------------------------------- helpers

-- Role of the signed-in user in one workshop ('none' if they are not in it).
create or replace function public.role_in(p_workshop uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.memberships where workshop_id = p_workshop and user_id = auth.uid()),
    'none'
  );
$$;

-- Create a profile for every new sign-up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Start a new workshop. The person who creates it becomes its admin.
create or replace function public.create_workshop(p_name text) returns public.workshops
language plpgsql security definer set search_path = public as $$
declare
  v_row public.workshops;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Give the workshop a name';
  end if;
  if (select count(*) from public.workshops where created_by = auth.uid()) >= 5 then
    raise exception 'You have already created 5 workshops, which is the limit';
  end if;
  insert into public.workshops (name, created_by) values (trim(p_name), auth.uid()) returning * into v_row;
  insert into public.memberships (workshop_id, user_id, role) values (v_row.id, auth.uid(), 'admin');
  return v_row;
end;
$$;

-- Ask to join a workshop with its join code. The request waits until an admin approves it.
create or replace function public.join_workshop(p_code text) returns public.workshops
language plpgsql security definer set search_path = public as $$
declare
  v_row public.workshops;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into v_row from public.workshops
  where join_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found then
    raise exception 'No workshop has this join code';
  end if;
  insert into public.memberships (workshop_id, user_id, role) values (v_row.id, auth.uid(), 'pending')
  on conflict do nothing;
  return v_row;
end;
$$;

-- Replace the join code, so the old code and invite link stop working. Admins only.
create or replace function public.new_join_code(p_workshop uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
begin
  if public.role_in(p_workshop) <> 'admin' then
    raise exception 'Only an admin can change the join code';
  end if;
  update public.workshops set join_code = upper(substr(md5(gen_random_uuid()::text), 1, 8))
  where id = p_workshop returning join_code into v_code;
  return v_code;
end;
$$;

-- Quantity can only change through record_movement(), so the history is always complete.
create or replace function public.guard_item_quantity() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_qty', true), '0') <> '1' then
    if tg_op = 'INSERT' then
      new.quantity := 0;
    elsif new.quantity is distinct from old.quantity then
      raise exception 'Change quantity by recording a stock movement';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists items_guard_quantity on public.items;
create trigger items_guard_quantity
  before insert or update on public.items
  for each row execute function public.guard_item_quantity();

-- The only way to change stock. Updates the item and writes the history row together.
create or replace function public.record_movement(
  p_item uuid,
  p_type text,
  p_quantity numeric,
  p_reason text default null,
  p_project uuid default null
) returns public.movements
language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_delta numeric;
  v_new numeric;
  v_row public.movements;
begin
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be zero or more';
  end if;

  select * into v_item from public.items where id = p_item for update;
  if not found or public.role_in(v_item.workshop_id) = 'none' then
    raise exception 'Item not found';
  end if;
  if public.role_in(v_item.workshop_id) not in ('member', 'admin') then
    raise exception 'You do not have permission to change stock';
  end if;
  if p_project is not null
     and not exists (select 1 from public.projects where id = p_project and workshop_id = v_item.workshop_id) then
    raise exception 'Project not found';
  end if;

  if p_type = 'adjust' then
    v_new := p_quantity;
    v_delta := v_new - v_item.quantity;
  elsif p_type in ('in', 'return') then
    if p_quantity = 0 then raise exception 'Quantity must be more than zero'; end if;
    v_delta := p_quantity;
    v_new := v_item.quantity + v_delta;
  elsif p_type in ('out', 'checkout') then
    if p_quantity = 0 then raise exception 'Quantity must be more than zero'; end if;
    v_delta := -p_quantity;
    v_new := v_item.quantity + v_delta;
  else
    raise exception 'Unknown movement type %', p_type;
  end if;

  if v_new < 0 then
    raise exception 'Not enough stock: only % % available', v_item.quantity, v_item.unit;
  end if;

  perform set_config('app.allow_qty', '1', true);
  update public.items set quantity = v_new where id = p_item;
  perform set_config('app.allow_qty', '0', true);

  insert into public.movements
    (workshop_id, item_id, type, quantity, delta, balance_after, reason, project_id, user_id)
  values
    (v_item.workshop_id, p_item, p_type, p_quantity, v_delta, v_new, nullif(trim(p_reason), ''), p_project, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_movement(uuid, text, numeric, text, uuid) from public, anon;
grant execute on function public.record_movement(uuid, text, numeric, text, uuid) to authenticated;
revoke execute on function public.create_workshop(text) from public, anon;
grant execute on function public.create_workshop(text) to authenticated;
revoke execute on function public.join_workshop(text) from public, anon;
grant execute on function public.join_workshop(text) to authenticated;
revoke execute on function public.new_join_code(uuid) from public, anon;
grant execute on function public.new_join_code(uuid) to authenticated;

-- ---------------------------------------------------------------- access rules
-- Everything is per workshop. viewer: read only. member: read, add/edit items, move stock.
-- admin: everything, including the team. pending: sees only the workshop's name while waiting.

alter table public.profiles enable row level security;
alter table public.workshops enable row level security;
alter table public.memberships enable row level security;
alter table public.locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.projects enable row level security;
alter table public.items enable row level security;
alter table public.movements enable row level security;

-- People: you see yourself, and the people in workshops where you have been approved.
create policy "read own profile or teammates" on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.memberships m
      where m.user_id = profiles.id and public.role_in(m.workshop_id) in ('viewer', 'member', 'admin')
    )
  );

-- Workshops are created with create_workshop() and joined with join_workshop().
create policy "members see their workshops" on public.workshops for select to authenticated
  using (public.role_in(id) <> 'none');
create policy "admin renames workshop" on public.workshops for update to authenticated
  using (public.role_in(id) = 'admin') with check (public.role_in(id) = 'admin');
create policy "admin deletes workshop" on public.workshops for delete to authenticated
  using (public.role_in(id) = 'admin');

create policy "see own membership or team" on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.role_in(workshop_id) in ('viewer', 'member', 'admin'));
-- An admin sets other people's roles, never their own, so a workshop always keeps an admin.
create policy "admin sets roles" on public.memberships for update to authenticated
  using (public.role_in(workshop_id) = 'admin' and user_id <> auth.uid())
  with check (public.role_in(workshop_id) = 'admin');
create policy "admin removes people, others can leave" on public.memberships for delete to authenticated
  using (
    (public.role_in(workshop_id) = 'admin' and user_id <> auth.uid())
    or (user_id = auth.uid() and role <> 'admin')
  );

create policy "team reads items" on public.items for select to authenticated
  using (public.role_in(workshop_id) in ('viewer', 'member', 'admin'));
create policy "members add items" on public.items for insert to authenticated
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "members edit items" on public.items for update to authenticated
  using (public.role_in(workshop_id) in ('member', 'admin'))
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "admin deletes items" on public.items for delete to authenticated
  using (public.role_in(workshop_id) = 'admin');

-- Movements are read-only for clients; rows are written only by record_movement().
create policy "team reads movements" on public.movements for select to authenticated
  using (public.role_in(workshop_id) in ('viewer', 'member', 'admin'));

create policy "team reads locations" on public.locations for select to authenticated
  using (public.role_in(workshop_id) in ('viewer', 'member', 'admin'));
create policy "members add locations" on public.locations for insert to authenticated
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "members edit locations" on public.locations for update to authenticated
  using (public.role_in(workshop_id) in ('member', 'admin'))
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "admin deletes locations" on public.locations for delete to authenticated
  using (public.role_in(workshop_id) = 'admin');

create policy "team reads suppliers" on public.suppliers for select to authenticated
  using (public.role_in(workshop_id) in ('viewer', 'member', 'admin'));
create policy "members add suppliers" on public.suppliers for insert to authenticated
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "members edit suppliers" on public.suppliers for update to authenticated
  using (public.role_in(workshop_id) in ('member', 'admin'))
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "admin deletes suppliers" on public.suppliers for delete to authenticated
  using (public.role_in(workshop_id) = 'admin');

create policy "team reads projects" on public.projects for select to authenticated
  using (public.role_in(workshop_id) in ('viewer', 'member', 'admin'));
create policy "members add projects" on public.projects for insert to authenticated
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "members edit projects" on public.projects for update to authenticated
  using (public.role_in(workshop_id) in ('member', 'admin'))
  with check (public.role_in(workshop_id) in ('member', 'admin'));
create policy "admin deletes projects" on public.projects for delete to authenticated
  using (public.role_in(workshop_id) = 'admin');

-- Workshop Stock: database schema for Supabase.
-- Run this whole file once in the Supabase SQL Editor (Dashboard > SQL Editor > New query > Run).

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending' check (role in ('pending', 'viewer', 'member', 'admin')),
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_id uuid references public.locations (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'done')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.items (
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

create table public.movements (
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

create index movements_item_idx on public.movements (item_id, created_at desc);
create index movements_created_idx on public.movements (created_at desc);

-- ---------------------------------------------------------------- helpers

-- Role of the signed-in user ('pending' if they have no profile yet).
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'pending');
$$;

-- Create a profile for every new sign-up. The very first user becomes admin;
-- everyone after that waits as 'pending' until an admin gives them a role.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'pending' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Quantity can only change through record_movement(), so the history is always complete.
create function public.guard_item_quantity() returns trigger
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

create trigger items_guard_quantity
  before insert or update on public.items
  for each row execute function public.guard_item_quantity();

-- The only way to change stock. Updates the item and writes the history row together.
create function public.record_movement(
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
  if public.my_role() not in ('member', 'admin') then
    raise exception 'You do not have permission to change stock';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Quantity must be zero or more';
  end if;

  select * into v_item from public.items where id = p_item for update;
  if not found then
    raise exception 'Item not found';
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

  insert into public.movements (item_id, type, quantity, delta, balance_after, reason, project_id, user_id)
  values (p_item, p_type, p_quantity, v_delta, v_new, nullif(trim(p_reason), ''), p_project, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.record_movement(uuid, text, numeric, text, uuid) from public, anon;
grant execute on function public.record_movement(uuid, text, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------- access rules
-- viewer: read only.  member: read, add/edit items, move stock.  admin: everything.

alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.suppliers enable row level security;
alter table public.projects enable row level security;
alter table public.items enable row level security;
alter table public.movements enable row level security;

create policy "read own profile or team" on public.profiles for select to authenticated
  using (id = auth.uid() or public.my_role() in ('viewer', 'member', 'admin'));
create policy "admin manages roles" on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy "team reads items" on public.items for select to authenticated
  using (public.my_role() in ('viewer', 'member', 'admin'));
create policy "members add items" on public.items for insert to authenticated
  with check (public.my_role() in ('member', 'admin'));
create policy "members edit items" on public.items for update to authenticated
  using (public.my_role() in ('member', 'admin')) with check (public.my_role() in ('member', 'admin'));
create policy "admin deletes items" on public.items for delete to authenticated
  using (public.my_role() = 'admin');

-- Movements are read-only for clients; rows are written only by record_movement().
create policy "team reads movements" on public.movements for select to authenticated
  using (public.my_role() in ('viewer', 'member', 'admin'));

create policy "team reads locations" on public.locations for select to authenticated
  using (public.my_role() in ('viewer', 'member', 'admin'));
create policy "members add locations" on public.locations for insert to authenticated
  with check (public.my_role() in ('member', 'admin'));
create policy "members edit locations" on public.locations for update to authenticated
  using (public.my_role() in ('member', 'admin')) with check (public.my_role() in ('member', 'admin'));
create policy "admin deletes locations" on public.locations for delete to authenticated
  using (public.my_role() = 'admin');

create policy "team reads suppliers" on public.suppliers for select to authenticated
  using (public.my_role() in ('viewer', 'member', 'admin'));
create policy "members add suppliers" on public.suppliers for insert to authenticated
  with check (public.my_role() in ('member', 'admin'));
create policy "members edit suppliers" on public.suppliers for update to authenticated
  using (public.my_role() in ('member', 'admin')) with check (public.my_role() in ('member', 'admin'));
create policy "admin deletes suppliers" on public.suppliers for delete to authenticated
  using (public.my_role() = 'admin');

create policy "team reads projects" on public.projects for select to authenticated
  using (public.my_role() in ('viewer', 'member', 'admin'));
create policy "members add projects" on public.projects for insert to authenticated
  with check (public.my_role() in ('member', 'admin'));
create policy "members edit projects" on public.projects for update to authenticated
  using (public.my_role() in ('member', 'admin')) with check (public.my_role() in ('member', 'admin'));
create policy "admin deletes projects" on public.projects for delete to authenticated
  using (public.my_role() = 'admin');

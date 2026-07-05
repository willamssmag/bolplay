-- Integração externa para geração de teste (Painel Slim ou outro provedor autorizado).
create table if not exists public.provider_trial_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  device text not null,
  phone_hash text not null,
  ip_hash text not null,
  status text not null default 'processing'
    check (status in ('processing','success','failed')),
  result_data jsonb,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists provider_trials_phone_created_idx
  on public.provider_trial_requests(phone_hash, created_at desc);
create index if not exists provider_trials_ip_created_idx
  on public.provider_trial_requests(ip_hash, created_at desc);
create index if not exists provider_trials_status_created_idx
  on public.provider_trial_requests(status, created_at desc);

alter table public.provider_trial_requests enable row level security;
drop policy if exists "provider_trials_admin_read" on public.provider_trial_requests;
create policy "provider_trials_admin_read"
  on public.provider_trial_requests for select
  to authenticated
  using (public.is_admin());

-- A função reserva o pedido antes de chamar o provedor e evita duas requisições
-- simultâneas para o mesmo WhatsApp.
create or replace function public.reserve_provider_trial(
  p_name text,
  p_phone text,
  p_email text,
  p_device text,
  p_phone_hash text,
  p_ip_hash text,
  p_cooldown_hours integer default 720,
  p_ip_cooldown_hours integer default 6
)
returns table(request_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone_hash, 0));

  if exists (
    select 1 from public.provider_trial_requests
    where phone_hash = p_phone_hash
      and status in ('processing','success')
      and created_at >= now() - make_interval(hours => greatest(p_cooldown_hours, 1))
  ) then
    raise exception 'trial_phone_cooldown';
  end if;

  if exists (
    select 1 from public.provider_trial_requests
    where ip_hash = p_ip_hash
      and status in ('processing','success')
      and created_at >= now() - make_interval(hours => greatest(p_ip_cooldown_hours, 1))
  ) then
    raise exception 'trial_ip_cooldown';
  end if;

  insert into public.provider_trial_requests(
    name, phone, email, device, phone_hash, ip_hash, status, created_at
  ) values (
    left(trim(p_name), 120),
    left(trim(p_phone), 20),
    nullif(left(trim(coalesce(p_email, '')), 180), ''),
    left(trim(p_device), 80),
    p_phone_hash,
    p_ip_hash,
    'processing',
    now()
  ) returning id into v_id;

  return query select v_id;
end;
$$;

revoke all on function public.reserve_provider_trial(text,text,text,text,text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_provider_trial(text,text,text,text,text,text,integer,integer)
  to service_role;

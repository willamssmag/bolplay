-- Correção para o erro:
-- ERROR 42703: column "paid_at" does not exist
--
-- Execute este arquivo uma vez no SQL Editor do Supabase e depois
-- execute novamente o arquivo supabase/schema.sql completo.

alter table public.payments
  add column if not exists paid_at timestamptz;

create index if not exists payments_status_paid_idx
  on public.payments(status, paid_at desc);

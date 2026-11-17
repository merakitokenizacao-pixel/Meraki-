-- Grade de atendimento por tenant e bloqueios pontuais.
create table public.horarios_padrao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  dia_semana integer not null,
  inicio time not null,
  fim time not null,
  criado_em timestamptz not null default now()
);

create table public.bloqueios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  dia date not null,
  inicio time not null,
  fim time not null,
  motivo text,
  criado_em timestamptz not null default now()
);

alter table public.horarios_padrao enable row level security;
create policy horarios_padrao_tenant on public.horarios_padrao for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.bloqueios enable row level security;
create policy bloqueios_tenant on public.bloqueios for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

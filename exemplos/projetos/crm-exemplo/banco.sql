-- Banco de exemplo do projeto crm-exemplo: CRM multi-tenant no estilo Supabase.
-- Tem dívida de propósito, para o motor ter o que achar:
--   execucoes sem RLS (U01), envios_inserir com check (true) (U02), policies sobrepostas em contatos (U03),
--   etiqueta_aplicar sem search_path (U04), limpar_execucoes executável por anon (U05),
--   contatos_exportar sem validar o tenant (U06), v_resumo_envios sem security_invoker (U07),
--   relatorio_envios com sobrecargas ambíguas (E09), tags_contato fora das migrations (E10),
--   contatos.etiquetas sempre vazia e ainda lida pelo painel (X02).
-- Fase 2 (agente de atendimento no WhatsApp, workflow crm-04): repasse_registrar grava e não tem p_ensaio (A10),
--   agendamento_cancelar pede p_motivo que a tool não passa (A04) e a tool Consultar_Servicos lê
--   servicos_ativos, que não existe (A03). Conversas sintéticas de 30 dias, sem dado pessoal de verdade.

-- Como no Supabase: extensões no schema extensions, fora da API.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;

-- Peças do Supabase que o coletor lê. No Supabase de verdade elas já existem.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now()
);

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[]
);

-- Tenancy
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

create table public.membros_tenant (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  usuario_id uuid not null,
  primary key (tenant_id, usuario_id)
);

create function public.tenant_do_contexto() returns uuid
language sql stable security definer
set search_path = ''
as $$ select m.tenant_id from public.membros_tenant m where m.usuario_id = auth.uid() limit 1 $$;

create function public.tenant_valido(p_tenant uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select exists (select 1 from public.membros_tenant m where m.tenant_id = p_tenant and m.usuario_id = auth.uid()) $$;

-- Domínio
create table public.contatos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  email text,
  telefone text,
  etiquetas text[],
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  cor text,
  criado_em timestamptz not null default now()
);

create table public.contato_etiquetas (
  contato_id uuid not null references public.contatos (id) on delete cascade,
  etiqueta_id uuid not null references public.etiquetas (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id),
  criado_em timestamptz not null default now(),
  primary key (contato_id, etiqueta_id)
);

create table public.envios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  contato_id uuid references public.contatos (id),
  canal text not null,
  conteudo text not null,
  status text not null default 'pendente',
  criado_em timestamptz not null default now()
);

create table public.campanhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  mensagem text not null,
  etiqueta_id uuid references public.etiquetas (id),
  agendada_para timestamptz,
  criado_em timestamptz not null default now()
);

create table public.execucoes (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  workflow text not null,
  status text not null,
  erro text,
  criado_em timestamptz not null default now()
);

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

-- Criada direto no banco, fora das migrations, repetindo a ideia de etiqueta.
create table public.tags_contato (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  cor text,
  criado_em timestamptz not null default now()
);

-- Atendimento por IA (fase 2): o que o agente do WhatsApp consulta e grava.
create table public.servicos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  nome text not null,
  duracao_min integer not null,
  preco numeric(10, 2) not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index servicos_tenant_idx on public.servicos (tenant_id);

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  contato_id uuid not null references public.contatos (id),
  servico_id uuid not null references public.servicos (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'confirmado' check (status in ('confirmado', 'cancelado', 'realizado')),
  motivo_cancelamento text,
  criado_em timestamptz not null default now()
);
create index agendamentos_tenant_idx on public.agendamentos (tenant_id, inicio);
create index agendamentos_contato_idx on public.agendamentos (contato_id, criado_em);
create index agendamentos_servico_idx on public.agendamentos (servico_id);

-- A conversa do WhatsApp: o que o cliente escreveu, o que a IA respondeu e o que a equipe respondeu.
create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  contato_id uuid not null references public.contatos (id),
  origem text not null check (origem in ('cliente', 'ia', 'humano')),
  conteudo text not null,
  criado_em timestamptz not null default now()
);
create index mensagens_tenant_idx on public.mensagens (tenant_id, criado_em);
create index mensagens_contato_idx on public.mensagens (contato_id, criado_em);

-- Repasse para a equipe: a IA para de responder aquele contato até alguém liberar.
create table public.pausas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  contato_id uuid not null references public.contatos (id),
  motivo text not null,
  liberada_em timestamptz,
  criado_em timestamptz not null default now()
);
create index pausas_tenant_idx on public.pausas (tenant_id, criado_em);
create index pausas_contato_idx on public.pausas (contato_id, criado_em);

-- Memória do agente (Postgres Chat Memory do n8n). Só o n8n acessa.
create table public.n8n_chat_historico (
  id integer generated always as identity primary key,
  session_id text not null,
  message jsonb not null
);
create index n8n_chat_historico_sessao_idx on public.n8n_chat_historico (session_id);

-- Funções
create function public.envio_registrar(p_tenant uuid, p_contato uuid, p_canal text, p_conteudo text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  insert into public.envios (tenant_id, contato_id, canal, conteudo)
  values (p_tenant, p_contato, p_canal, p_conteudo)
  returning id into v_id;
  return v_id;
end $$;

create function public.etiqueta_aplicar(p_tenant uuid, p_contato uuid, p_etiqueta uuid) returns void
language plpgsql security definer
as $$
begin
  if not tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  insert into contato_etiquetas (contato_id, etiqueta_id, tenant_id)
  values (p_contato, p_etiqueta, p_tenant)
  on conflict do nothing;
end $$;

create function public.etiqueta_remover(p_tenant uuid, p_contato uuid, p_etiqueta uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  delete from public.contato_etiquetas
   where contato_id = p_contato and etiqueta_id = p_etiqueta and tenant_id = p_tenant;
end $$;

create function public.contatos_exportar(p_tenant uuid) returns setof public.contatos
language sql stable security definer
set search_path = ''
as $$ select * from public.contatos c where c.tenant_id = p_tenant $$;

create function public.limpar_execucoes(p_dias integer) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  execute format('delete from public.execucoes where criado_em < now() - interval %L', p_dias || ' days');
  get diagnostics v_total = row_count;
  return v_total;
end $$;

create function public.relatorio_envios(p_tenant uuid, p_inicio date) returns bigint
language sql stable
set search_path = ''
as $$ select count(*) from public.envios e where e.tenant_id = p_tenant and e.criado_em >= p_inicio $$;

create function public.relatorio_envios(p_tenant uuid, p_inicio date, p_fim date default null) returns bigint
language sql stable
set search_path = ''
as $$
  select count(*) from public.envios e
   where e.tenant_id = p_tenant and e.criado_em >= p_inicio and (p_fim is null or e.criado_em < p_fim)
$$;

create function public.tocar_atualizado_em() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

create trigger trg_contatos_atualizado
  before update on public.contatos
  for each row execute function public.tocar_atualizado_em();

-- Atendimento por IA: as funções que as tools do agente chamam.
create function public.horarios_livres(p_tenant uuid, p_dia date)
returns table (inicio timestamptz, fim timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select s.inicio, s.inicio + interval '30 minutes'
    from public.horarios_padrao h
   cross join lateral generate_series(
           ((p_dia + h.inicio) at time zone 'America/Sao_Paulo'),
           ((p_dia + h.fim) at time zone 'America/Sao_Paulo') - interval '30 minutes',
           interval '30 minutes') as s (inicio)
   where public.tenant_valido(p_tenant)
     and h.tenant_id = p_tenant
     and h.dia_semana = extract(isodow from p_dia)::integer
     and not exists (
       select 1 from public.agendamentos a
        where a.tenant_id = p_tenant and a.status = 'confirmado'
          and a.inicio < s.inicio + interval '30 minutes' and a.fim > s.inicio)
     and not exists (
       select 1 from public.bloqueios b
        where b.tenant_id = p_tenant and b.dia = p_dia
          and ((p_dia + b.inicio) at time zone 'America/Sao_Paulo') < s.inicio + interval '30 minutes'
          and ((p_dia + b.fim) at time zone 'America/Sao_Paulo') > s.inicio)
   order by s.inicio
$$;

-- p_ensaio: com true, valida tudo e devolve o que faria, sem gravar (rodada de avaliação não agenda de verdade).
create function public.agendamento_criar(p_tenant uuid, p_contato uuid, p_servico text, p_inicio timestamptz, p_ensaio boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_servico uuid;
  v_nome text;
  v_duracao integer;
  v_id uuid;
begin
  if not public.tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  select s.id, s.nome, s.duracao_min into v_servico, v_nome, v_duracao
    from public.servicos s
   where s.tenant_id = p_tenant and s.ativo and lower(s.nome) = lower(btrim(p_servico));
  if not found then
    raise exception 'serviço % não encontrado', p_servico;
  end if;
  if exists (select 1 from public.agendamentos a
              where a.tenant_id = p_tenant and a.status = 'confirmado'
                and a.inicio < p_inicio + make_interval(mins => v_duracao) and a.fim > p_inicio) then
    raise exception 'horário ocupado';
  end if;
  if p_ensaio then
    return jsonb_build_object('ensaio', true, 'servico', v_nome, 'inicio', p_inicio, 'fim', p_inicio + make_interval(mins => v_duracao));
  end if;
  insert into public.agendamentos (tenant_id, contato_id, servico_id, inicio, fim)
  values (p_tenant, p_contato, v_servico, p_inicio, p_inicio + make_interval(mins => v_duracao))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'servico', v_nome, 'inicio', p_inicio);
end $$;

create function public.agendamento_cancelar(p_tenant uuid, p_agendamento uuid, p_motivo text, p_ensaio boolean default false)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inicio timestamptz;
begin
  if not public.tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  select a.inicio into v_inicio
    from public.agendamentos a
   where a.id = p_agendamento and a.tenant_id = p_tenant and a.status = 'confirmado';
  if not found then
    raise exception 'agendamento não encontrado';
  end if;
  if p_ensaio then
    return jsonb_build_object('ensaio', true, 'cancelaria', p_agendamento, 'inicio', v_inicio);
  end if;
  update public.agendamentos
     set status = 'cancelado', motivo_cancelamento = p_motivo
   where id = p_agendamento and tenant_id = p_tenant;
  return jsonb_build_object('id', p_agendamento, 'cancelado', true);
end $$;

-- Grava a pausa e não tem p_ensaio: na rodada de avaliação, a tool de repasse pausa contato de verdade (A10).
create function public.repasse_registrar(p_tenant uuid, p_contato uuid, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.tenant_valido(p_tenant) then
    raise exception 'tenant inválido';
  end if;
  insert into public.pausas (tenant_id, contato_id, motivo)
  values (p_tenant, p_contato, coalesce(nullif(btrim(p_motivo), ''), 'sem motivo'))
  returning id into v_id;
  return v_id;
end $$;

-- Quem executa o quê
revoke execute on function public.tenant_do_contexto(), public.tenant_valido(uuid) from public, anon;
grant execute on function public.tenant_do_contexto(), public.tenant_valido(uuid) to authenticated;
revoke execute on function public.envio_registrar(uuid, uuid, text, text) from public, anon;
grant execute on function public.envio_registrar(uuid, uuid, text, text) to authenticated;
revoke execute on function public.etiqueta_aplicar(uuid, uuid, uuid), public.etiqueta_remover(uuid, uuid, uuid) from public, anon;
grant execute on function public.etiqueta_aplicar(uuid, uuid, uuid), public.etiqueta_remover(uuid, uuid, uuid) to authenticated;
revoke execute on function public.contatos_exportar(uuid) from public, anon;
grant execute on function public.contatos_exportar(uuid) to authenticated;
revoke execute on function public.horarios_livres(uuid, date), public.agendamento_criar(uuid, uuid, text, timestamptz, boolean),
  public.agendamento_cancelar(uuid, uuid, text, boolean), public.repasse_registrar(uuid, uuid, text) from public, anon;
grant execute on function public.horarios_livres(uuid, date), public.agendamento_criar(uuid, uuid, text, timestamptz, boolean),
  public.agendamento_cancelar(uuid, uuid, text, boolean), public.repasse_registrar(uuid, uuid, text) to authenticated;

-- RLS
alter table public.tenants enable row level security;
create policy tenants_ler on public.tenants for select to authenticated using (id = public.tenant_do_contexto());

alter table public.membros_tenant enable row level security;
create policy membros_tenant_ler on public.membros_tenant for select to authenticated using (usuario_id = auth.uid());

alter table public.contatos enable row level security;
create policy contatos_ler on public.contatos for select to authenticated
  using (tenant_id = public.tenant_do_contexto());
create policy contatos_escrever on public.contatos for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.etiquetas enable row level security;
create policy etiquetas_tenant on public.etiquetas for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.contato_etiquetas enable row level security;
create policy contato_etiquetas_tenant on public.contato_etiquetas for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.envios enable row level security;
create policy envios_ler on public.envios for select to authenticated
  using (tenant_id = public.tenant_do_contexto());
create policy envios_inserir on public.envios for insert to authenticated
  with check (true);

alter table public.campanhas enable row level security;
create policy campanhas_tenant on public.campanhas for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.horarios_padrao enable row level security;
create policy horarios_padrao_tenant on public.horarios_padrao for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.bloqueios enable row level security;
create policy bloqueios_tenant on public.bloqueios for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.tags_contato enable row level security;
create policy tags_contato_tenant on public.tags_contato for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.servicos enable row level security;
create policy servicos_tenant on public.servicos for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.agendamentos enable row level security;
create policy agendamentos_tenant on public.agendamentos for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.mensagens enable row level security;
create policy mensagens_tenant on public.mensagens for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

alter table public.pausas enable row level security;
create policy pausas_tenant on public.pausas for all to authenticated
  using (tenant_id = public.tenant_do_contexto())
  with check (tenant_id = public.tenant_do_contexto());

-- Memória do agente: RLS ligada e nenhuma policy, só o n8n (bypassrls) lê e grava.
alter table public.n8n_chat_historico enable row level security;

-- Visões
create view public.v_resumo_envios as
  select e.tenant_id, e.canal, count(*) as total from public.envios e group by e.tenant_id, e.canal;

create view public.v_contatos_ativos with (security_invoker = true) as
  select c.id, c.tenant_id, c.nome from public.contatos c;

-- Storage
insert into storage.buckets (id, name, public) values ('anexos', 'anexos', false) on conflict do nothing;

-- Consumidores: painel e n8n, cada um com o próprio papel.
grant usage on schema public to app_painel, app_n8n;
grant select, insert, update on all tables in schema public to app_painel, app_n8n;
grant execute on function public.envio_registrar(uuid, uuid, text, text) to app_n8n;
grant execute on function public.horarios_livres(uuid, date), public.agendamento_criar(uuid, uuid, text, timestamptz, boolean),
  public.agendamento_cancelar(uuid, uuid, text, boolean), public.repasse_registrar(uuid, uuid, text) to app_n8n;
grant delete on public.n8n_chat_historico to app_n8n;

-- Leitor do Meraki: catálogo + agregados. Não lê nenhuma linha das tabelas; o null_frac das colunas
-- (E06/X02) vem desta função, que roda como dono do banco e devolve só o agregado.
create schema if not exists meraki;
create function meraki.colunas_vazias()
returns table (schema text, tabela text, coluna text, null_frac real)
language sql stable security definer
set search_path = ''
as $$
  select s.schemaname::text, s.tablename::text, s.attname::text, s.null_frac
    from pg_catalog.pg_stats s
   where s.schemaname not in ('pg_catalog', 'information_schema', 'meraki')
$$;
revoke all on function meraki.colunas_vazias() from public;
grant usage on schema meraki to meraki_leitor;
grant execute on function meraki.colunas_vazias() to meraki_leitor;

grant usage on schema public, storage, supabase_migrations, extensions to meraki_leitor;
grant select on storage.buckets, supabase_migrations.schema_migrations to meraki_leitor;

-- Fase 2: só as tabelas que o contrato mapeia para o agente (conversa, repasse e conversão). Os agregados de
-- produção são calculados aqui dentro (só contagens saem do banco) e a tela Conversa lê ao vivo, anonimiza e
-- não grava. Com RLS ligada, o leitor precisa da própria policy de leitura.
grant select on public.mensagens, public.pausas, public.agendamentos to meraki_leitor;
create policy mensagens_meraki_leitor on public.mensagens for select to meraki_leitor using (true);
create policy pausas_meraki_leitor on public.pausas for select to meraki_leitor using (true);
create policy agendamentos_meraki_leitor on public.agendamentos for select to meraki_leitor using (true);

-- Histórico de migrations (tags_contato e limpar_execucoes ficaram de fora).
insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20260301120000', 'tenancy', array[
    'create table public.tenants (id uuid primary key)',
    'create table public.membros_tenant (tenant_id uuid, usuario_id uuid)',
    'create function public.tenant_do_contexto() returns uuid language sql as $f$ select null::uuid $f$',
    'create function public.tenant_valido(p_tenant uuid) returns boolean language sql as $f$ select true $f$',
    'create policy tenants_ler on public.tenants for select using (true)',
    'create policy membros_tenant_ler on public.membros_tenant for select using (true)'
  ]),
  ('20260305090000', 'contatos_e_etiquetas', array[
    'create table public.contatos (id uuid primary key)',
    'create table public.etiquetas (id uuid primary key)',
    'create table public.contato_etiquetas (contato_id uuid, etiqueta_id uuid)',
    'create function public.etiqueta_aplicar(p_tenant uuid, p_contato uuid, p_etiqueta uuid) returns void language sql as $f$ select $f$',
    'create function public.etiqueta_remover(p_tenant uuid, p_contato uuid, p_etiqueta uuid) returns void language sql as $f$ select $f$',
    'create function public.contatos_exportar(p_tenant uuid) returns setof public.contatos language sql as $f$ select * from public.contatos $f$',
    'create function public.tocar_atualizado_em() returns trigger language plpgsql as $f$ begin return new; end $f$',
    'create trigger trg_contatos_atualizado before update on public.contatos for each row execute function public.tocar_atualizado_em()',
    'create policy contatos_ler on public.contatos for select using (true)',
    'create policy contatos_escrever on public.contatos for all using (true)',
    'create policy etiquetas_tenant on public.etiquetas for all using (true)',
    'create policy contato_etiquetas_tenant on public.contato_etiquetas for all using (true)',
    'create view public.v_contatos_ativos as select 1'
  ]),
  ('20260312150000', 'envios_e_campanhas', array[
    'create table public.envios (id uuid primary key)',
    'create table public.campanhas (id uuid primary key)',
    'create table public.execucoes (id bigint primary key)',
    'create function public.envio_registrar(p_tenant uuid, p_contato uuid, p_canal text, p_conteudo text) returns uuid language sql as $f$ select null::uuid $f$',
    'create function public.relatorio_envios(p_tenant uuid, p_inicio date) returns bigint language sql as $f$ select 0::bigint $f$',
    'create function public.relatorio_envios(p_tenant uuid, p_inicio date, p_fim date) returns bigint language sql as $f$ select 0::bigint $f$',
    'create policy envios_ler on public.envios for select using (true)',
    'create policy envios_inserir on public.envios for insert with check (true)',
    'create policy campanhas_tenant on public.campanhas for all using (true)',
    'create view public.v_resumo_envios as select 1'
  ]),
  ('20260320110000', 'agenda_de_atendimento', array[
    'create table public.horarios_padrao (id uuid primary key)',
    'create table public.bloqueios (id uuid primary key)',
    'create policy horarios_padrao_tenant on public.horarios_padrao for all using (true)',
    'create policy bloqueios_tenant on public.bloqueios for all using (true)'
  ]),
  ('20261020100000', 'atendimento_ia', array[
    'create table public.servicos (id uuid primary key)',
    'create table public.agendamentos (id uuid primary key)',
    'create table public.mensagens (id uuid primary key)',
    'create table public.pausas (id uuid primary key)',
    'create table public.n8n_chat_historico (id integer primary key)',
    'create function public.horarios_livres(p_tenant uuid, p_dia date) returns table (inicio timestamptz, fim timestamptz) language sql as $f$ select null::timestamptz, null::timestamptz $f$',
    'create function public.agendamento_criar(p_tenant uuid, p_contato uuid, p_servico text, p_inicio timestamptz, p_ensaio boolean default false) returns jsonb language sql as $f$ select null::jsonb $f$',
    'create function public.agendamento_cancelar(p_tenant uuid, p_agendamento uuid, p_motivo text, p_ensaio boolean default false) returns jsonb language sql as $f$ select null::jsonb $f$',
    'create function public.repasse_registrar(p_tenant uuid, p_contato uuid, p_motivo text) returns uuid language sql as $f$ select null::uuid $f$',
    'create policy servicos_tenant on public.servicos for all using (true)',
    'create policy agendamentos_tenant on public.agendamentos for all using (true)',
    'create policy mensagens_tenant on public.mensagens for all using (true)',
    'create policy pausas_tenant on public.pausas for all using (true)',
    'create policy mensagens_meraki_leitor on public.mensagens for select using (true)',
    'create policy pausas_meraki_leitor on public.pausas for select using (true)',
    'create policy agendamentos_meraki_leitor on public.agendamentos for select using (true)'
  ]);

-- Dados
insert into public.tenants (id, nome) values
  ('11111111-1111-4111-8111-111111111111', 'Clínica Horizonte'),
  ('22222222-2222-4222-8222-222222222222', 'Studio Aurora');

insert into public.contatos (tenant_id, nome, email, telefone)
select case when g % 3 = 0 then '22222222-2222-4222-8222-222222222222'::uuid else '11111111-1111-4111-8111-111111111111'::uuid end,
       'Contato ' || g, 'contato' || g || '@exemplo.test', '+55 11 9' || lpad(g::text, 8, '0')
  from generate_series(1, 80) g;

insert into public.etiquetas (tenant_id, nome, cor)
select '11111111-1111-4111-8111-111111111111', n, c
  from (values ('lead', 'azul'), ('cliente', 'verde'), ('inativo', 'cinza'), ('vip', 'ouro')) v (n, c);

insert into public.contato_etiquetas (contato_id, etiqueta_id, tenant_id)
select c.id, e.id, c.tenant_id
  from (select id, tenant_id from public.contatos where tenant_id = '11111111-1111-4111-8111-111111111111' limit 30) c
  cross join lateral (select id from public.etiquetas order by random() limit 1) e;

insert into public.envios (tenant_id, contato_id, canal, conteudo, status)
select c.tenant_id, c.id, case when g % 2 = 0 then 'whatsapp' else 'email' end, 'Mensagem ' || g, 'enviado'
  from generate_series(1, 3) g cross join public.contatos c;

insert into public.execucoes (tenant_id, workflow, status, erro)
select '11111111-1111-4111-8111-111111111111', 'Disparo de campanha', case when g % 10 = 0 then 'erro' else 'ok' end, null
  from generate_series(1, 40) g;

insert into public.horarios_padrao (tenant_id, dia_semana, inicio, fim)
select '11111111-1111-4111-8111-111111111111', d, '08:00', '18:00' from generate_series(1, 5) d;

insert into public.bloqueios (tenant_id, dia, inicio, fim, motivo) values
  ('11111111-1111-4111-8111-111111111111', '2026-12-24', '12:00', '18:00', 'Véspera de Natal');

-- Atendimento por IA: serviços e 30 dias de conversas sintéticas da Clínica Horizonte, relativas à hora da carga
-- e determinísticas (hashtext). Até 12 dias atrás, perto de 12% das conversas vão para a equipe; de lá para cá,
-- perto de 28% (a versão que está no ar repassa mais: P1). Cerca de 7% das respostas da IA fogem da política
-- (palavra proibida, texto longo, duas perguntas); links com "?" não contam como pergunta.
insert into public.servicos (tenant_id, nome, duracao_min, preco) values
  ('11111111-1111-4111-8111-111111111111', 'Limpeza de pele', 60, 180),
  ('11111111-1111-4111-8111-111111111111', 'Drenagem linfática', 50, 150),
  ('11111111-1111-4111-8111-111111111111', 'Massagem relaxante', 60, 160),
  ('11111111-1111-4111-8111-111111111111', 'Avaliação facial', 30, 0);

-- Quem chama no WhatsApp: um contato por conversa (nome genérico e telefone fictício), como numa clínica de verdade,
-- onde pouca gente volta a falar com o agente na mesma semana.
insert into public.contatos (tenant_id, nome, telefone)
select '11111111-1111-4111-8111-111111111111', 'Cliente WhatsApp ' || g, '+55 11 97' || lpad(g::text, 7, '0')
  from generate_series(1, 300) g;

-- Taxas exatas por bloco de conversas: repasse 3 em 25 (12%) antes da troca de versão e 7 em 25 (28%) depois;
-- conversão 3 em 10 (30%) nas duas. A hora, o assunto e as respostas fora da política variam por hashtext.
create temporary table conversas_sinteticas on commit drop as
with contatos as (
  select id, (row_number() over (order by nome) - 1)::integer as n
    from public.contatos
   where tenant_id = '11111111-1111-4111-8111-111111111111' and nome like 'Cliente WhatsApp %'
), base as (
  select d, i, d * 10 + i - 1 as k,
         date_trunc('day', now()) - make_interval(days => d)
           + make_interval(hours => 8 + abs(hashtext('h:' || d || ':' || i)) % 10, mins => abs(hashtext('m:' || d || ':' || i)) % 60) as inicio,
         abs(hashtext('r:' || d || ':' || i)) % 100 as sorte_repasse,
         abs(hashtext('c:' || d || ':' || i)) % 100 as sorte_conversao,
         abs(hashtext('v:' || d || ':' || i)) % 100 as sorte_violacao,
         abs(hashtext('t:' || d || ':' || i)) % 6 as assunto
    from generate_series(0, 29) d, generate_series(1, 10) i
)
select b.*, c.id as contato_id,
       (b.k * 7) % 25 < case when b.d >= 12 then 3 else 7 end as repasse,
       b.k % 10 < 3 as conversao
  from base b join contatos c on c.n = b.k % 300
 where b.inicio < now() - interval '20 minutes';

insert into public.mensagens (tenant_id, contato_id, origem, conteudo, criado_em)
select '11111111-1111-4111-8111-111111111111', m.contato_id, m.origem, m.conteudo, m.momento
  from (
    -- Cliente abre a conversa
    select c.contato_id, 'cliente' as origem, c.inicio as momento,
           (array['Oi, aqui é a Marina, tem horário amanhã?', 'Quanto custa a limpeza de pele?', 'Preciso remarcar minha consulta',
                  'Vocês atendem sábado?', 'Quero fazer drenagem, como funciona?', 'Me manda o link da agenda'])[c.assunto + 1] as conteudo
      from conversas_sinteticas c
    union all
    -- Primeira resposta da IA (cerca de 7% foge da política)
    select c.contato_id, 'ia', c.inicio + interval '40 seconds',
           case
             when c.sorte_violacao < 7 and c.sorte_violacao % 3 = 0 then 'Fechou! Já te passo os horários livres.'
             when c.sorte_violacao < 7 and c.sorte_violacao % 3 = 1 then
               'Olá! Na Clínica Horizonte trabalhamos com limpeza de pele, drenagem linfática, massagem relaxante e avaliação facial gratuita. '
               || 'A limpeza de pele dura 60 minutos e custa R$ 180; a drenagem linfática dura 50 minutos e custa R$ 150; a massagem relaxante '
               || 'dura 60 minutos e custa R$ 160. Atendemos de segunda a sexta, das 8h às 18h, na Rua das Acácias, 120, sala 4. Aceitamos pix, '
               || 'cartão e dinheiro, com 5% de desconto à vista nos pacotes. Para agendar, é só me dizer o tratamento, o dia e o horário '
               || 'que prefere, que eu confiro a agenda e já te respondo por aqui mesmo. Se for a sua primeira vez, recomendo começar '
               || 'pela avaliação facial, que é gratuita e leva só 30 minutos.'
             when c.sorte_violacao < 7 then 'Que bom que chamou! Prefere manhã ou tarde? E já é cliente da clínica?'
             else (array['Amanhã tenho 9h e 10h30 livres. Qual prefere?', 'A limpeza de pele custa R$ 180 e dura 60 minutos.',
                         'Claro! Tenho quinta às 14h ou sexta às 10h. Qual prefere?', 'No sábado não abrimos. De segunda a sexta atendemos das 8h às 18h.',
                         'A drenagem linfática dura 50 minutos e custa R$ 150. Quer agendar?',
                         'Aqui está: https://agenda.exemplo.test/horizonte?origem=whatsapp&canal=ia — é só escolher o horário. Precisa de mais alguma coisa?'])[c.assunto + 1]
           end
      from conversas_sinteticas c
    union all
    select c.contato_id, 'cliente', c.inicio + interval '3 minutes',
           case when c.sorte_repasse % 2 = 0 then 'Prefiro falar com uma pessoa, meu número é (11) 98888-7777' else 'Quero falar com alguém da clínica' end
      from conversas_sinteticas c where c.repasse
    union all
    select c.contato_id, 'ia', c.inicio + interval '3 minutes 30 seconds', 'Claro, vou chamar alguém da equipe para continuar com você.'
      from conversas_sinteticas c where c.repasse
    union all
    select c.contato_id, 'humano', c.inicio + interval '12 minutes', 'Oi! Sou da equipe da clínica, vou te ajudar por aqui.'
      from conversas_sinteticas c where c.repasse
    union all
    select c.contato_id, 'cliente', c.inicio + interval '5 minutes', 'Pode marcar então'
      from conversas_sinteticas c where c.conversao
    union all
    select c.contato_id, 'ia', c.inicio + interval '5 minutes 30 seconds', 'Agendado! Te espero na clínica.'
      from conversas_sinteticas c where c.conversao
  ) m
 where m.momento < now();

insert into public.pausas (tenant_id, contato_id, motivo, criado_em, liberada_em)
select '11111111-1111-4111-8111-111111111111', c.contato_id,
       case when c.sorte_repasse % 2 = 0 then 'cliente pediu atendimento humano' else 'cliente pediu para falar com alguém' end,
       c.inicio + interval '3 minutes 40 seconds',
       case when c.inicio + interval '40 minutes' < now() then c.inicio + interval '40 minutes' end
  from conversas_sinteticas c
 where c.repasse and c.inicio + interval '3 minutes 40 seconds' < now();

insert into public.agendamentos (tenant_id, contato_id, servico_id, inicio, fim, status, motivo_cancelamento, criado_em)
select '11111111-1111-4111-8111-111111111111', c.contato_id, s.id, x.inicio, x.inicio + make_interval(mins => s.duracao_min),
       case when c.sorte_conversao % 10 = 0 then 'cancelado' when x.inicio < now() then 'realizado' else 'confirmado' end,
       case when c.sorte_conversao % 10 = 0 then 'Cliente desmarcou' end,
       c.inicio + interval '5 minutes 40 seconds'
  from conversas_sinteticas c
  join public.servicos s on s.tenant_id = '11111111-1111-4111-8111-111111111111'
   and s.nome = (array['Avaliação facial', 'Limpeza de pele', 'Drenagem linfática', 'Massagem relaxante'])[c.assunto % 4 + 1]
 cross join lateral (select date_trunc('hour', c.inicio) + interval '1 day 2 hours' as inicio) x
 where c.conversao and c.inicio + interval '5 minutes 40 seconds' < now();

-- Memória do agente: as conversas do último dia, como o n8n guarda.
insert into public.n8n_chat_historico (session_id, message)
select m.contato_id::text,
       jsonb_build_object('type', case when m.origem = 'cliente' then 'human' else 'ai' end, 'data', jsonb_build_object('content', m.conteudo))
  from public.mensagens m
 where m.origem in ('cliente', 'ia') and m.criado_em > now() - interval '1 day'
 order by m.criado_em;

analyze;

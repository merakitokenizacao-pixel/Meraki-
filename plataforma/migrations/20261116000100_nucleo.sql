-- Meraki · Fase 1 · Núcleo: contas, membros, projetos, fontes e coletas.

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now()
);

create table public.membros (
  conta_id uuid not null references public.contas (id) on delete cascade,
  usuario_id uuid not null,
  nome text,
  papel text not null default 'dono' check (papel in ('dono')),
  criado_em timestamptz not null default now(),
  primary key (conta_id, usuario_id)
);

-- Contas do usuário da sessão. Base de todas as policies.
create function public.minhas_contas() returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select m.conta_id from public.membros m where m.usuario_id = (select auth.uid())
$$;
revoke execute on function public.minhas_contas() from public, anon;
grant execute on function public.minhas_contas() to authenticated;

create table public.projetos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  nome text not null,
  descricao text,
  cor text,
  criado_em timestamptz not null default now(),
  unique (conta_id, slug)
);

create table public.fontes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  tipo text not null check (tipo in ('postgres', 'supabase', 'n8n', 'repo')),
  nome text not null,
  -- Configuração sem segredo. O segredo fica no Vault e só o motor lê.
  config jsonb not null default '{}'
    check (
      jsonb_typeof(config) = 'object'
      and not (config ?| array['senha', 'password', 'token', 'api_key', 'apiKey', 'segredo', 'secret', 'connectionString', 'url_conexao'])
    ),
  segredo_id uuid,
  ativa boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (projeto_id, nome)
);
create index fontes_projeto_idx on public.fontes (projeto_id);

create table public.coletas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  fonte_id uuid not null references public.fontes (id) on delete cascade,
  inicio timestamptz not null default now(),
  fim timestamptz,
  status text not null default 'rodando' check (status in ('rodando', 'ok', 'erro')),
  erro text,
  versao_motor text not null,
  modo text,
  total integer not null default 0,
  novos integer not null default 0,
  alterados integer not null default 0,
  removidos integer not null default 0,
  avisos text[] not null default '{}'
);
create index coletas_fonte_idx on public.coletas (fonte_id, inicio desc);

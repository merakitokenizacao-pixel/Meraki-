-- Meraki · Fase 1 · Intenção: contrato versionado e imutável, e propostas de mudança.

create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  versao integer not null check (versao >= 0),
  conteudo jsonb not null,
  autor text not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  unique (projeto_id, versao)
);

-- Contrato não se edita: toda mudança é uma versão nova.
create function public.contratos_imutavel() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.projetos p where p.id = old.projeto_id) then
    return old; -- remoção em cascata do projeto
  end if;
  raise exception 'contratos são imutáveis: crie uma nova versão' using errcode = '55000';
end $$;

create trigger contratos_imutavel
  before update or delete on public.contratos
  for each row execute function public.contratos_imutavel();

create table public.propostas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  origem text not null check (origem in ('agente', 'voce')),
  sessao text,
  tipo text not null check (tipo in ('nova_tabela', 'nova_coluna', 'nova_funcao', 'alterar_objeto', 'remover_objeto', 'nova_primitiva', 'outro')),
  -- { sql, objetos: [ref], declaracao: { papel, primitiva }, regras: [codigo] }
  payload jsonb not null default '{}',
  justificativa text not null check (length(btrim(justificativa)) > 0),
  status text not null default 'aberta' check (status in ('aberta', 'aprovada', 'recusada')),
  decisao_motivo text,
  decidido_por text,
  decidido_em timestamptz,
  contrato_versao integer,
  criado_em timestamptz not null default now()
);
create index propostas_projeto_idx on public.propostas (projeto_id, criado_em desc);

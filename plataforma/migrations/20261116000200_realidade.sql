-- Meraki · Fase 1 · Realidade: o que existe, com hash por objeto e histórico só quando muda.

create table public.objetos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  fonte_id uuid not null references public.fontes (id) on delete cascade,
  tipo text not null,
  -- Chave natural e estável (nunca oid). Ex.: pg:tabela:public.contatos
  chave text not null,
  nome text not null,
  pai_chave text,
  atributos jsonb not null,
  -- sha256 do JSON canônico dos atributos, sem campos voláteis.
  hash text not null,
  visto_desde timestamptz not null default now(),
  -- Última vez que o hash mudou (null = igual desde que foi visto).
  alterado_em timestamptz,
  removido_em timestamptz,
  unique (fonte_id, chave)
);
create index objetos_chave_idx on public.objetos (chave);
create index objetos_tipo_idx on public.objetos (fonte_id, tipo) where removido_em is null;

create table public.objeto_versoes (
  id bigint generated always as identity primary key,
  conta_id uuid not null references public.contas (id) on delete cascade,
  objeto_id uuid not null references public.objetos (id) on delete cascade,
  coleta_id uuid not null references public.coletas (id) on delete cascade,
  hash text not null,
  atributos jsonb,
  mudanca text not null check (mudanca in ('novo', 'alterado', 'removido', 'recriado')),
  criado_em timestamptz not null default now()
);
create index objeto_versoes_objeto_idx on public.objeto_versoes (objeto_id, id desc);
create index objeto_versoes_coleta_idx on public.objeto_versoes (coleta_id);

create table public.relacoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  fonte_id uuid not null references public.fontes (id) on delete cascade,
  origem_chave text not null,
  destino_chave text not null,
  tipo text not null,
  evidencia jsonb not null default '{}',
  certeza text not null check (certeza in ('exata', 'inferida')),
  visto_desde timestamptz not null default now(),
  removido_em timestamptz,
  unique (fonte_id, origem_chave, destino_chave, tipo)
);
create index relacoes_origem_idx on public.relacoes (origem_chave);
create index relacoes_destino_idx on public.relacoes (destino_chave);

-- Contadores de uso por dia. Nunca entram no hash do objeto.
create table public.uso_diario (
  conta_id uuid not null references public.contas (id) on delete cascade,
  objeto_id uuid not null references public.objetos (id) on delete cascade,
  dia date not null,
  origem text not null,
  leituras bigint not null default 0,
  escritas bigint not null default 0,
  -- Observações do dia que não pertencem ao hash (estimativa de linhas, coluna vazia).
  linhas bigint,
  vazia boolean,
  -- Último valor bruto do contador: o delta do dia sai daqui (delta negativo = reset).
  base_leituras bigint,
  base_escritas bigint,
  atualizado_em timestamptz not null default now(),
  primary key (objeto_id, dia, origem)
);

-- Meraki · Fase 1 · Verificação: regras, achados, exceções, eventos do gate e métricas diárias.

create table public.regras (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  codigo text not null,
  pacote text not null,
  titulo text not null,
  descricao text,
  alvo text not null,
  severidade_padrao text not null check (severidade_padrao in ('critico', 'alto', 'medio', 'baixo')),
  bloqueia_no_gate boolean not null default false,
  versao integer not null default 1,
  unique (conta_id, codigo)
);

create table public.achados (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  regra text not null,
  objeto_chave text not null,
  par_chave text,
  -- regra + objeto (+ objeto pareado)
  chave_dedupe text not null,
  severidade text not null check (severidade in ('critico', 'alto', 'medio', 'baixo')),
  status text not null default 'aberto' check (status in ('aberto', 'excecao', 'resolvido')),
  -- Dívida herdada: visto na primeira coleta (linha de base).
  herdado boolean not null default false,
  titulo text not null,
  detalhe text,
  -- Toda afirmação tem evidência: coleta, objeto, node, linha ou query.
  evidencia jsonb not null default '{}',
  primeiro_visto timestamptz not null default now(),
  ultimo_visto timestamptz not null default now(),
  resolvido_em timestamptz,
  reaberturas integer not null default 0,
  coleta_id uuid references public.coletas (id) on delete set null,
  unique (projeto_id, chave_dedupe)
);
create index achados_projeto_status_idx on public.achados (projeto_id, status, severidade);

create table public.excecoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  regra text not null,
  objeto_chave text not null,
  motivo text not null check (length(btrim(motivo)) > 0),
  autor text not null,
  valida_ate date not null default (current_date + 90),
  criado_em timestamptz not null default now(),
  revogada_em timestamptz
);
create index excecoes_projeto_idx on public.excecoes (projeto_id, regra, objeto_chave);

create table public.gate_eventos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  criado_em timestamptz not null default now(),
  origem text not null,
  sessao text,
  ferramenta text not null,
  modo text check (modo in ('autonomo', 'pergunta')),
  resumo text not null,
  decisao text not null check (decisao in ('permitiu', 'perguntou', 'negou')),
  regras text[] not null default '{}',
  motivo text,
  proposta_id uuid references public.propostas (id) on delete set null,
  duracao_ms integer
);
create index gate_eventos_projeto_idx on public.gate_eventos (projeto_id, criado_em desc);

create table public.metricas_diarias (
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  dia date not null,
  objetos integer not null default 0,
  avaliados integer not null default 0,
  declarados integer not null default 0,
  cobertura numeric(5, 2),
  critico integer not null default 0,
  alto integer not null default 0,
  medio integer not null default 0,
  baixo integer not null default 0,
  novos_critico_alto integer not null default 0,
  herdados_abertos integer not null default 0,
  excecoes_ativas integer not null default 0,
  drift integer not null default 0,
  gate_permitiu integer not null default 0,
  gate_perguntou integer not null default 0,
  gate_negou integer not null default 0,
  coletas_ok integer not null default 0,
  coletas_erro integer not null default 0,
  saude numeric(5, 1),
  atualizado_em timestamptz not null default now(),
  primary key (projeto_id, dia)
);

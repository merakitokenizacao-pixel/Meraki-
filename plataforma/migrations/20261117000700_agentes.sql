-- Meraki · Fase 2 · Agentes previsíveis: publicações, casos de referência, rodadas de avaliação e produção.
-- O agente, o prompt e as tools ficam em objetos/objeto_versoes/relacoes (fase 1). Aqui fica o comportamento.
-- Nenhuma tabela guarda conversa: produção é agregado calculado no banco do cliente, e caso de referência
-- entra anonimizado (salvar_caso recusa entrada com e-mail, telefone ou documento).

-- Linha do tempo de publicação: cada período em que uma versão (hash) do agente esteve no ar.
create table public.agente_publicacoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  -- chave do objeto agente (n8n:agente:<workflow>/<node>)
  agente text not null,
  hash text not null,
  -- activeVersionId do n8n
  version_id text,
  inicio timestamptz not null,
  -- A publicação aconteceu entre inicio_minimo e inicio quando a hora veio da coleta (versão incerta).
  inicio_minimo timestamptz,
  fim timestamptz,
  origem_hora text not null check (origem_hora in ('hook', 'coleta')),
  criado_em timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create unique index agente_publicacoes_aberta_idx on public.agente_publicacoes (projeto_id, agente) where fim is null;
create index agente_publicacoes_agente_idx on public.agente_publicacoes (projeto_id, agente, inicio desc);

-- Caso de referência. O conteúdo vive em caso_versoes (imutável): editar é criar versão nova.
create table public.casos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  agente text not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  criticidade text not null check (criticidade in ('critico', 'normal')),
  origem text not null check (origem in ('conversa', 'achado', 'manual')),
  ativo boolean not null default true,
  hash_atual text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  arquivado_em timestamptz,
  arquivado_motivo text,
  unique (projeto_id, agente, slug)
);

create table public.caso_versoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  caso_id uuid not null references public.casos (id) on delete cascade,
  hash text not null,
  -- { mensagem, contexto: { data_hora, ficha }, historico: [{ autor, texto }] } — anonimizado
  entrada jsonb not null,
  -- { tools: [...], argumentos: { tool: {...} }, contem: [...], nao_contem: [...], repasse: bool }
  espera jsonb not null default '{}',
  rubrica text,
  autor text not null,
  motivo text not null check (length(btrim(motivo)) > 0),
  criado_em timestamptz not null default now(),
  unique (caso_id, hash)
);
create index caso_versoes_caso_idx on public.caso_versoes (caso_id, criado_em desc);

-- Versão de caso não se edita: a rodada guarda o hash que usou e continua verdadeira.
create function public.caso_versoes_imutavel() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.casos c where c.id = old.caso_id) then
    return old; -- remoção em cascata do caso
  end if;
  raise exception 'versões de caso são imutáveis: salve uma versão nova' using errcode = '55000';
end $$;

create trigger caso_versoes_imutavel
  before update or delete on public.caso_versoes
  for each row execute function public.caso_versoes_imutavel();

-- Rodada de avaliação: os casos ativos contra uma versão (hash) do agente, rodados no n8n.
create table public.rodadas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  agente text not null,
  hash text not null,
  -- id da rodada no n8n (test run)
  n8n_id text,
  motivo text not null check (motivo in ('gate', 'manual', 'publicacao')),
  status text not null default 'pedida' check (status in ('pedida', 'rodando', 'concluida', 'erro', 'cancelada')),
  aprovacao numeric(5, 4) check (aprovacao between 0 and 1),
  casos integer not null default 0,
  passaram integer not null default 0,
  criticos_falhos text[] not null default '{}',
  aprovada boolean,
  executor text,
  erro text,
  pedida_por text,
  criado_em timestamptz not null default now(),
  iniciada_em timestamptz,
  concluida_em timestamptz
);
create index rodadas_agente_idx on public.rodadas (projeto_id, agente, criado_em desc);
create index rodadas_pendentes_idx on public.rodadas (status, criado_em) where status in ('pedida', 'rodando');
-- Uma rodada pendente por versão: a tela, o gate e a coleta que pedem a mesma recebem a mesma.
create unique index rodadas_pendente_unica_idx on public.rodadas (projeto_id, agente, hash) where status in ('pedida', 'rodando');

create table public.rodada_casos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.contas (id) on delete cascade,
  rodada_id uuid not null references public.rodadas (id) on delete cascade,
  caso_id uuid references public.casos (id) on delete set null,
  slug text not null,
  criticidade text not null check (criticidade in ('critico', 'normal')),
  caso_hash text not null,
  passou boolean not null,
  -- [{ nome, passou, detalhe }]: checagens fixas (tools, argumentos, contém, não contém, política, repasse)
  checagens jsonb not null default '[]',
  -- [{ nome, argumentos }] na ordem em que o agente chamou
  tools_chamadas jsonb not null default '[]',
  -- resposta do agente ao caso (entrada anonimizada, rodada em ensaio: não é conversa de cliente)
  resposta text,
  repasse boolean,
  -- juiz (Correctness/Helpfulness): só informa, não reprova
  juiz jsonb,
  duracao_ms integer,
  unique (rodada_id, slug)
);
create index rodada_casos_caso_idx on public.rodada_casos (caso_id);

-- Produção por agente, versão e dia: só agregados calculados no banco do cliente e execuções do n8n.
create table public.agente_metricas_diarias (
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  agente text not null,
  hash text not null,
  dia date not null,
  conversas integer not null default 0,
  repasses integer not null default 0,
  conversoes integer not null default 0,
  violacoes integer not null default 0,
  -- até 20 ids de mensagem (nunca o texto): a tela busca a conversa ao vivo quando alguém abre
  violacoes_exemplos text[] not null default '{}',
  execucoes integer not null default 0,
  erros integer not null default 0,
  latencia_p50_ms integer,
  latencia_p95_ms integer,
  tokens bigint,
  -- o dia cruza o intervalo entre a publicação e a coleta que a viu: a atribuição à versão é incerta
  versao_incerta boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (projeto_id, agente, hash, dia)
);

-- Rascunho que já é outra versão: o pacote agente roda nele a cada coleta e o resultado fica para a tela.
-- Achados e produção continuam valendo para a versão publicada.
create table public.agente_rascunhos (
  conta_id uuid not null references public.contas (id) on delete cascade,
  projeto_id uuid not null references public.projetos (id) on delete cascade,
  agente text not null,
  hash text not null,
  -- [{ regra, severidade, titulo, detalhe, novo, bloqueia }]
  achados jsonb not null default '[]',
  avaliado_em timestamptz not null default now(),
  primary key (projeto_id, agente)
);

-- RLS: leitura restrita às contas do usuário; escrita só do motor e das funções abaixo.
do $$
declare
  t text;
begin
  foreach t in array array['agente_publicacoes', 'casos', 'caso_versoes', 'rodadas', 'rodada_casos', 'agente_metricas_diarias', 'agente_rascunhos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (conta_id in (select public.minhas_contas()))',
      t || '_ler', t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- Dado pessoal aparente (e-mail, telefone, CPF, CNPJ). O motor anonimiza antes; aqui é a última barreira.
create function public.dado_pessoal(p_texto text) returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_texto ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}' then 'e-mail'
    when p_texto ~ '\d{3}\.\d{3}\.\d{3}-\d{2}' then 'CPF'
    when p_texto ~ '\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}' then 'CNPJ'
    when p_texto ~ '\+55[[:space:]-]?\(?\d{2}\)?[[:space:]-]?9?\d{4}[[:space:]-]?\d{4}' then 'telefone'
    when p_texto ~ '\(?\d{2}\)?[[:space:]]?9?\d{4}[-[:space:]]\d{4}' then 'telefone'
    when p_texto ~ '(^|\D)[1-9]{2}9\d{8}(\D|$)' then 'telefone'
  end
$$;
revoke execute on function public.dado_pessoal(text) from public, anon, authenticated;

-- Salvar caso cria versão nova (nunca edita a anterior). Mesmo conteúdo = mesma versão.
create function public.salvar_caso(p_projeto uuid, p_agente text, p_slug text, p_conteudo jsonb, p_motivo text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_projeto public.projetos%rowtype;
  v_criticidade text := coalesce(nullif(p_conteudo ->> 'criticidade', ''), 'normal');
  v_origem text := coalesce(nullif(p_conteudo ->> 'origem', ''), 'manual');
  v_entrada jsonb := p_conteudo -> 'entrada';
  v_espera jsonb := coalesce(p_conteudo -> 'espera', '{}'::jsonb);
  v_rubrica text := nullif(btrim(coalesce(p_conteudo ->> 'rubrica', '')), '');
  v_pessoal text;
  v_hash text;
  v_caso public.casos%rowtype;
begin
  select * into v_projeto from public.projetos where id = p_projeto;
  if not found or v_projeto.conta_id not in (select public.minhas_contas()) then
    raise exception 'projeto não encontrado' using errcode = 'P0002';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'salvar um caso precisa de motivo' using errcode = '22023';
  end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,79}$' then
    raise exception 'id do caso: minúsculas, números e hífen, de 2 a 80 caracteres' using errcode = '22023';
  end if;
  if v_criticidade not in ('critico', 'normal') then
    raise exception 'criticidade é critico ou normal' using errcode = '22023';
  end if;
  if v_origem not in ('conversa', 'achado', 'manual') then
    raise exception 'origem é conversa, achado ou manual' using errcode = '22023';
  end if;
  if v_entrada is null or jsonb_typeof(v_entrada) <> 'object' or length(btrim(coalesce(v_entrada ->> 'mensagem', ''))) = 0 then
    raise exception 'o caso precisa da mensagem de entrada' using errcode = '22023';
  end if;
  if jsonb_typeof(v_espera) <> 'object' then
    raise exception 'o que se espera do agente precisa ser um objeto' using errcode = '22023';
  end if;
  -- O caso inteiro (entrada, o que se espera e a rubrica): nada dele pode identificar um cliente.
  v_pessoal := public.dado_pessoal(jsonb_build_object('entrada', v_entrada, 'espera', v_espera, 'rubrica', v_rubrica)::text);
  if v_pessoal is not null then
    raise exception 'o caso parece ter dado pessoal (%): anonimize antes de salvar', v_pessoal using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.objetos o join public.fontes f on f.id = o.fonte_id
     where f.projeto_id = p_projeto and o.chave = p_agente and o.tipo = 'agente' and o.removido_em is null
  ) then
    raise exception 'agente não encontrado' using errcode = 'P0002';
  end if;

  v_hash := left(encode(sha256(convert_to(
    jsonb_build_object('criticidade', v_criticidade, 'entrada', v_entrada, 'espera', v_espera, 'rubrica', v_rubrica)::text, 'UTF8')), 'hex'), 16);

  insert into public.casos (conta_id, projeto_id, agente, slug, criticidade, origem, hash_atual)
  values (v_projeto.conta_id, p_projeto, p_agente, p_slug, v_criticidade, v_origem, v_hash)
  on conflict (projeto_id, agente, slug) do update
     set criticidade = excluded.criticidade, hash_atual = excluded.hash_atual, ativo = true,
         arquivado_em = null, arquivado_motivo = null, atualizado_em = now()
  returning * into v_caso;

  insert into public.caso_versoes (conta_id, caso_id, hash, entrada, espera, rubrica, autor, motivo)
  values (v_projeto.conta_id, v_caso.id, v_hash, v_entrada, v_espera, v_rubrica, public.autor_da_sessao(), btrim(p_motivo))
  on conflict (caso_id, hash) do nothing;

  return v_caso.id;
end $$;

create function public.arquivar_caso(p_caso uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_caso public.casos%rowtype;
begin
  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'arquivar precisa de motivo' using errcode = '22023';
  end if;
  select * into v_caso from public.casos where id = p_caso for update;
  if not found or v_caso.conta_id not in (select public.minhas_contas()) then
    raise exception 'caso não encontrado' using errcode = 'P0002';
  end if;
  if not v_caso.ativo then
    raise exception 'caso já arquivado' using errcode = '55000';
  end if;
  update public.casos set ativo = false, arquivado_em = now(), arquivado_motivo = btrim(p_motivo), atualizado_em = now()
   where id = v_caso.id;
end $$;

-- Pede uma rodada da versão atual do agente (o rascunho, que é o que o n8n roda). O motor pega e roda.
create function public.pedir_rodada(p_projeto uuid, p_agente text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_projeto public.projetos%rowtype;
  v_atributos jsonb;
  v_hash text;
  v_id uuid;
begin
  select * into v_projeto from public.projetos where id = p_projeto;
  if not found or v_projeto.conta_id not in (select public.minhas_contas()) then
    raise exception 'projeto não encontrado' using errcode = 'P0002';
  end if;
  select o.atributos into v_atributos
    from public.objetos o join public.fontes f on f.id = o.fonte_id
   where f.projeto_id = p_projeto and o.chave = p_agente and o.tipo = 'agente' and o.removido_em is null
   limit 1;
  if v_atributos is null then
    raise exception 'agente não encontrado' using errcode = 'P0002';
  end if;
  v_hash := coalesce(v_atributos ->> 'rascunho_versao', v_atributos ->> 'versao');
  if v_hash is null then
    raise exception 'o agente ainda não tem versão coletada' using errcode = '22023';
  end if;
  if not exists (select 1 from public.casos c where c.projeto_id = p_projeto and c.agente = p_agente and c.ativo) then
    raise exception 'o agente não tem casos ativos: escreva ao menos um caso antes de rodar' using errcode = '22023';
  end if;
  -- O mesmo lock do motor (pedirRodada): quem pede ao mesmo tempo recebe a mesma rodada.
  perform pg_advisory_xact_lock(hashtext('rodada:' || p_projeto::text || ':' || p_agente || ':' || v_hash));
  select r.id into v_id from public.rodadas r
   where r.projeto_id = p_projeto and r.agente = p_agente and r.hash = v_hash and r.status in ('pedida', 'rodando')
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.rodadas (conta_id, projeto_id, agente, hash, motivo, status, pedida_por)
  values (v_projeto.conta_id, p_projeto, p_agente, v_hash, 'manual', 'pedida', public.autor_da_sessao())
  on conflict (projeto_id, agente, hash) where status in ('pedida', 'rodando') do nothing
  returning id into v_id;
  if v_id is null then
    -- A coleta pediu a mesma versão no mesmo instante: devolve a dela.
    select r.id into v_id from public.rodadas r
     where r.projeto_id = p_projeto and r.agente = p_agente and r.hash = v_hash and r.status in ('pedida', 'rodando')
     limit 1;
  end if;
  return v_id;
end $$;

revoke execute on function public.salvar_caso(uuid, text, text, jsonb, text) from public, anon;
revoke execute on function public.arquivar_caso(uuid, text) from public, anon;
revoke execute on function public.pedir_rodada(uuid, text) from public, anon;
grant execute on function public.salvar_caso(uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.arquivar_caso(uuid, text) to authenticated;
grant execute on function public.pedir_rodada(uuid, text) to authenticated;

-- Meraki · Fase 1 · RLS em todas as tabelas, leitura restrita às contas do usuário da sessão.
-- Escrita direta é só do motor (dono das tabelas). A tela decide por funções (próxima migration).

alter table public.contas enable row level security;
create policy contas_ler on public.contas
  for select to authenticated
  using (id in (select public.minhas_contas()));

alter table public.membros enable row level security;
create policy membros_ler on public.membros
  for select to authenticated
  using (usuario_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array[
    'projetos', 'fontes', 'coletas',
    'objetos', 'objeto_versoes', 'relacoes', 'uso_diario',
    'contratos', 'propostas',
    'regras', 'achados', 'excecoes', 'gate_eventos', 'metricas_diarias'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (conta_id in (select public.minhas_contas()))',
      t || '_ler', t
    );
  end loop;
end $$;

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- Papel de login da web: sem privilégio próprio e sem acesso ao Vault.
-- Cada leitura faz `set local role authenticated` com o usuário da sessão, então a RLS vale de verdade.
-- Defina a senha fora da migration: alter role meraki_web password '...';
do $$
begin
  if not exists (select from pg_roles where rolname = 'meraki_web') then
    create role meraki_web login noinherit;
  end if;
end $$;
grant authenticated to meraki_web;

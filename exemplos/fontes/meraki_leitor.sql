-- Papel de leitura do Meraki no banco de um projeto. Rode como dono do banco.
-- O motor nunca escreve na fonte: a coleta abre transação read only e lê pg_catalog.
-- Guarde a URL de conexão no Vault da plataforma (vault.create_secret) e grave o id em fontes.segredo_id.

-- Defina a senha depois, fora de arquivo versionado (no psql: \password meraki_leitor).
create role meraki_leitor login nosuperuser nocreatedb nocreaterole;
alter role meraki_leitor set default_transaction_read_only = on;
alter role meraki_leitor set statement_timeout = '15s';

-- Estatísticas de uso de todos os papéis (pg_stat_statements, pg_stat_user_*): quem usa o quê.
grant pg_read_all_stats to meraki_leitor;

-- Modo catálogo (padrão): estrutura completa, sem ler nenhuma linha de dado.
grant usage on schema public to meraki_leitor;

-- Modo agregados (recomendado): coluna sempre vazia (E06/X02) sem SELECT nem BYPASSRLS.
-- A função roda como dono do banco e devolve só null_frac; o leitor não vê nenhum valor.
-- (pg_stats sozinho esconde as tabelas com RLS ativa de quem não passa por cima dela.)
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

-- Supabase: histórico de migrations, buckets e o schema extensions (onde mora o pg_stat_statements).
-- grant usage on schema supabase_migrations, storage, extensions to meraki_leitor;
-- grant select on supabase_migrations.schema_migrations, storage.buckets to meraki_leitor;

-- Agentes de IA (fase 2, opcional): só as tabelas que o contrato mapeia para o agente (conversa e eventos de
-- repasse e conversão). O motor calcula lá dentro os agregados de produção (só contagens saem do banco) e a tela
-- Conversa lê ao vivo, anonimiza e não grava. Com RLS ligada, o leitor precisa de policy própria de leitura.
-- grant select on public.mensagens, public.pausas, public.agendamentos to meraki_leitor;
-- create policy mensagens_meraki_leitor on public.mensagens for select to meraki_leitor using (true);
-- create policy pausas_meraki_leitor on public.pausas for select to meraki_leitor using (true);
-- create policy agendamentos_meraki_leitor on public.agendamentos for select to meraki_leitor using (true);

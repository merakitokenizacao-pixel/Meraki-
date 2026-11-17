-- Seed do ambiente local: uma conta, o dono e dois projetos de tipos diferentes.
--   crm-exemplo     banco Supabase + n8n + painel (repositório). O n8n traz agentes de IA: as execuções vêm de
--                   um arquivo gerado pelo dev preparar e as rodadas usam o ensaio simulado (só desenvolvimento;
--                   com config.url + chave, a rodada roda no n8n pela API de avaliação).
--   agenda-exemplo  banco Postgres + n8n
-- Nenhuma linha aqui é específica do motor: projetos e fontes entram só por dado.
-- No Supabase, crie os segredos pelo Vault e grave o id em fontes.segredo_id.

insert into public.contas (id, nome)
values ('00000000-0000-4000-8000-000000000001', 'Meraki Labs')
on conflict (id) do nothing;

insert into public.membros (conta_id, usuario_id, nome)
values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Ana Ribeiro')
on conflict do nothing;

insert into public.projetos (id, conta_id, slug, nome, descricao, cor) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'crm-exemplo', 'CRM Exemplo',
   'CRM multi-tenant com painel, banco Supabase e automações no n8n', 's1'),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'agenda-exemplo', 'Agenda Exemplo',
   'Agendamentos com banco Postgres e lembretes no n8n', 's2')
on conflict (id) do nothing;

-- Segredos (Vault): conexões do papel meraki_leitor nos bancos de exemplo.
insert into public.fontes (id, conta_id, projeto_id, tipo, nome, config, segredo_id) values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
   'supabase', 'Banco', '{"schemas": ["public"]}',
   vault.create_secret(format('postgresql://meraki_leitor@localhost:%s/crm_exemplo', current_setting('port')), 'crm-exemplo/banco')),
  ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
   'n8n', 'n8n', '{"tag": "crm-exemplo", "exportacao": "exemplos/projetos/crm-exemplo/n8n", "execucoes": ".dev/n8n/crm-exemplo-execucoes.json", "ensaio": "exemplos/projetos/crm-exemplo/ensaio"}', null),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101',
   'repo', 'Painel', '{"caminho": "exemplos/projetos/crm-exemplo/painel"}', null),
  ('00000000-0000-4000-8000-000000000204', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102',
   'postgres', 'Banco', '{"schemas": ["public"]}',
   vault.create_secret(format('postgresql://meraki_leitor@localhost:%s/agenda_exemplo', current_setting('port')), 'agenda-exemplo/banco')),
  ('00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000102',
   'n8n', 'n8n', '{"tag": "agenda-exemplo", "exportacao": "exemplos/projetos/agenda-exemplo/n8n"}', null)
on conflict (id) do nothing;

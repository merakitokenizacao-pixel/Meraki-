-- Meraki · Fase 1 · Decisões feitas na tela: aprovar ou recusar proposta, abrir exceção.
-- Funções SECURITY DEFINER com search_path fixo, que conferem a conta do usuário da sessão.

create function public.autor_da_sessao() returns text
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select m.nome from public.membros m where m.usuario_id = (select auth.uid()) limit 1),
    (select auth.jwt()) ->> 'email',
    'dono'
  )
$$;
revoke execute on function public.autor_da_sessao() from public, anon, authenticated;

-- Aprovar cria uma versão nova do contrato declarando os objetos propostos.
create function public.aprovar_proposta(p_proposta uuid, p_motivo text default null)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prop public.propostas%rowtype;
  v_atual public.contratos%rowtype;
  v_conteudo jsonb;
  v_objetos jsonb;
  v_ref text;
  v_versao integer;
  v_autor text;
begin
  select * into v_prop from public.propostas where id = p_proposta for update;
  if not found or v_prop.conta_id not in (select public.minhas_contas()) then
    raise exception 'proposta não encontrada' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'aberta' then
    raise exception 'proposta já decidida (%)', v_prop.status using errcode = '55000';
  end if;

  v_autor := public.autor_da_sessao();
  select * into v_atual from public.contratos
    where projeto_id = v_prop.projeto_id order by versao desc limit 1;

  v_conteudo := coalesce(
    v_atual.conteudo,
    jsonb_build_object('projeto', (select p.slug from public.projetos p where p.id = v_prop.projeto_id))
  );
  v_objetos := coalesce(v_conteudo -> 'objetos', '{}'::jsonb);

  for v_ref in select jsonb_array_elements_text(coalesce(v_prop.payload -> 'objetos', '[]'::jsonb)) loop
    if v_prop.tipo = 'remover_objeto' then
      -- Remoção aprovada: o objeto sai do contrato (senão E02 acusaria "declarado e sumiu").
      v_objetos := v_objetos - v_ref;
    else
      v_objetos := v_objetos || jsonb_build_object(
        v_ref,
        (coalesce(v_objetos -> v_ref, '{}'::jsonb) - 'declarado')
          || coalesce(v_prop.payload -> 'declaracao', '{}'::jsonb)
          || jsonb_build_object('nota', v_prop.justificativa, 'proposta', v_prop.id::text)
      );
    end if;
  end loop;

  v_versao := coalesce(v_atual.versao, -1) + 1;
  v_conteudo := v_conteudo || jsonb_build_object('versao', v_versao, 'objetos', v_objetos);

  insert into public.contratos (conta_id, projeto_id, versao, conteudo, autor, motivo)
  values (v_prop.conta_id, v_prop.projeto_id, v_versao, v_conteudo, v_autor, 'Proposta aprovada: ' || v_prop.justificativa);

  update public.propostas
     set status = 'aprovada', decisao_motivo = nullif(btrim(p_motivo), ''), decidido_por = v_autor,
         decidido_em = now(), contrato_versao = v_versao
   where id = v_prop.id;

  return v_versao;
end $$;

-- Recusar exige motivo: o gate devolve esse motivo na próxima tentativa do agente.
create function public.recusar_proposta(p_proposta uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prop public.propostas%rowtype;
begin
  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'recusa precisa de motivo' using errcode = '22023';
  end if;
  select * into v_prop from public.propostas where id = p_proposta for update;
  if not found or v_prop.conta_id not in (select public.minhas_contas()) then
    raise exception 'proposta não encontrada' using errcode = 'P0002';
  end if;
  if v_prop.status <> 'aberta' then
    raise exception 'proposta já decidida (%)', v_prop.status using errcode = '55000';
  end if;
  update public.propostas
     set status = 'recusada', decisao_motivo = btrim(p_motivo), decidido_por = public.autor_da_sessao(), decidido_em = now()
   where id = v_prop.id;
end $$;

-- Exceção: motivo obrigatório e validade (padrão de 90 dias). Ao vencer, o achado reabre.
create function public.criar_excecao(p_achado uuid, p_motivo text, p_valida_ate date default null)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_achado public.achados%rowtype;
  v_ate date := coalesce(p_valida_ate, current_date + 90);
  v_id uuid;
begin
  if p_motivo is null or length(btrim(p_motivo)) = 0 then
    raise exception 'exceção precisa de motivo' using errcode = '22023';
  end if;
  if v_ate <= current_date then
    raise exception 'a validade precisa ser uma data futura' using errcode = '22023';
  end if;
  select * into v_achado from public.achados where id = p_achado for update;
  if not found or v_achado.conta_id not in (select public.minhas_contas()) then
    raise exception 'achado não encontrado' using errcode = 'P0002';
  end if;

  insert into public.excecoes (conta_id, projeto_id, regra, objeto_chave, motivo, autor, valida_ate)
  values (v_achado.conta_id, v_achado.projeto_id, v_achado.regra, v_achado.objeto_chave, btrim(p_motivo), public.autor_da_sessao(), v_ate)
  returning id into v_id;

  if v_achado.status = 'aberto' then
    update public.achados set status = 'excecao' where id = v_achado.id;
  end if;
  return v_id;
end $$;

revoke execute on function public.aprovar_proposta(uuid, text) from public, anon;
revoke execute on function public.recusar_proposta(uuid, text) from public, anon;
revoke execute on function public.criar_excecao(uuid, text, date) from public, anon;
grant execute on function public.aprovar_proposta(uuid, text) to authenticated;
grant execute on function public.recusar_proposta(uuid, text) to authenticated;
grant execute on function public.criar_excecao(uuid, text, date) to authenticated;

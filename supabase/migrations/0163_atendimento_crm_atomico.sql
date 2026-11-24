-- Uma conversa abre um único item do CRM, mesmo com duas solicitações simultâneas.
-- Item, vínculo e históricos são gravados na mesma transação; falha reverte tudo.
create or replace function public.fn_atendimento_abrir_crm(
  p_conversa uuid, p_autor uuid, p_pipeline uuid, p_titulo text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c atendimento_conversas%rowtype;
  a profiles%rowtype;
  p crm_pipelines%rowtype;
  e crm_etapas%rowtype;
  i crm_itens%rowtype;
  v_canal text;
  v_contato text;
  v_dados jsonb;
  v_responsavel uuid;
  v_diretoria boolean;
begin
  select * into a from profiles where user_id=p_autor and ativo;
  if not found or a.role not in ('admin_central','analista_arini') then
    raise exception 'Restrito à equipe.' using errcode='42501';
  end if;
  v_diretoria := a.role='admin_central' or 'diretoria'=any(coalesce(a.setores,'{}'));
  -- Serializa o duplo clique e a atuação simultânea de dois atendentes.
  select * into c from atendimento_conversas where id=p_conversa for update;
  if not found then raise exception 'Conversa não encontrada.' using errcode='P0002'; end if;
  if not (v_diretoria or coalesce(a.atendimento_recepcao,false)
    or coalesce(c.responsavel=p_autor,false) or coalesce(c.setor=any(coalesce(a.setores,'{}')),false)) then
    raise exception 'Esta conversa é de outra fila.' using errcode='42501';
  end if;
  if c.crm_item_id is not null then
    raise exception 'Esta conversa já está ligada a um item do CRM.' using errcode='23505';
  end if;
  select * into p from crm_pipelines where id=p_pipeline and ativo;
  if not found then raise exception 'Funil indisponível.' using errcode='P0002'; end if;
  if not (v_diretoria or p.setor=any(coalesce(a.setores,'{}'))) then
    raise exception 'Você não atua no setor deste funil.' using errcode='42501';
  end if;
  select * into e from crm_etapas where pipeline_id=p.id order by ordem,id limit 1;
  if not found then raise exception 'O funil não tem etapas.'; end if;
  v_canal := case when c.telefone like 'ig:%' then 'Instagram' when c.telefone like 'fb:%' then 'Messenger' else 'WhatsApp' end;
  v_contato := case when v_canal='WhatsApp' then '+'||c.telefone else 'Contato do '||v_canal end;
  v_dados := case when v_canal='WhatsApp' then jsonb_build_object('telefone','+'||c.telefone,'atendimento',c.codigo)
    else jsonb_build_object('contato',c.telefone,'canal',case when v_canal='Instagram' then 'instagram' else 'messenger' end,'atendimento',c.codigo) end;
  select user_id into v_responsavel from profiles where user_id=c.responsavel and ativo and role in ('admin_central','analista_arini');
  insert into crm_itens(pipeline_id,etapa_id,titulo,responsavel,criado_por,descricao,dados,prazo_etapa,opportunity_id)
    values(p.id,e.id,left(coalesce(nullif(btrim(p_titulo),''),v_canal||' · '||coalesce(c.nome,v_contato)),200),
      coalesce(v_responsavel,p_autor),p_autor,
      left('Aberto pelo Atendimento ('||c.codigo||'). Contato: '||v_contato||E'.\nÚltima mensagem: '||coalesce(c.ultimo_texto,''),5000),
      v_dados,case when e.sla_horas is not null and not e.final then now()+make_interval(hours=>e.sla_horas) else null end,c.opportunity_id)
    returning * into i;
  insert into crm_item_eventos(item_id,tipo,autor,texto)
    values(i.id,'criado',p_autor,'Criado em "'||e.nome||'" pelo Atendimento '||c.codigo);
  update atendimento_conversas set crm_item_id=i.id where id=c.id;
  insert into atendimento_eventos(conversa_id,acao,autor,texto)
    values(c.id,'crm',p_autor,'Item '||i.codigo||' aberto no funil "'||p.nome||'".');
  return jsonb_build_object('id',i.id,'codigo',i.codigo);
end $$;
revoke all on function public.fn_atendimento_abrir_crm(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.fn_atendimento_abrir_crm(uuid,uuid,uuid,text) to service_role;

-- Os quatro pacotes do catálogo são concedidos pela Diretoria a um leiloeiro verificado.
insert into public.plans(id,nome,descricao,recursos,cotas,preco_mensal,preco_anual_centavos,periodicidade,escopo,ordem)
select o.id,'Leiloeiro · '||o.nome,o.descricao,
  case when o.id='leilao_teste' then array_remove(base.recursos,'anunciar') else base.recursos end,
  jsonb_build_object('imoveis_ativos',v.lotes,'usuarios',v.usuarios,'creditos_ari_mes',v.creditos),
  o.preco_centavos/100.0,o.anual_centavos,case when o.id='leilao_teste' then 'gratis' else 'mensal' end,'conta',100
from public.ofertas_perfis o join (values ('leilao_teste',1,1,20),('leilao_essencial',10,1,100),
  ('leilao_profissional',30,3,500),('leilao_premium',100,8,1500)) v(id,lotes,usuarios,creditos) on v.id=o.id
cross join public.plans base where base.id='parceiro';

create table public.leilao_credenciais (
  partner_id uuid primary key references public.partners on delete cascade,
  plano text not null references public.plans, matricula text not null, empresa text not null, referencia text not null,
  validade timestamptz not null, ativo boolean not null, teste_em timestamptz, revisao int not null default 1
);
create table public.leilao_operacoes (
  imovel_id uuid primary key references public.properties on delete cascade, revisao int not null default 0,
  estado text not null default 'agendado' check(estado in ('agendado','arrematado','sem_arremate','concluido')),
  arrematante uuid references public.profiles(user_id) on delete set null, valor numeric(16,2), resultado_em timestamptz,
  referencia_resultado text, pos_leilao text
);
create table public.leilao_habilitacoes (
  id uuid primary key default gen_random_uuid(),imovel_id uuid not null references public.properties on delete cascade,
  candidato uuid not null references public.profiles(user_id) on delete cascade,
  estado text not null default 'solicitada' check(estado in ('solicitada','habilitada','recusada')),
  contato text not null, consentimento text not null, criado_em timestamptz not null default now(), revisao int not null default 1,
  referencia text, unique(imovel_id,candidato)
);
do $$ declare t text; begin foreach t in array array['leilao_credenciais','leilao_operacoes','leilao_habilitacoes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to service_role',t);
end loop; end $$;

-- Consultas públicas independem do contexto que o leiloeiro abriu hoje.
create function public.leilao_pacote(p_parceiro uuid) returns text language sql stable set search_path=public as $$
  select c.plano from leilao_credenciais c join partners pa on pa.id=c.partner_id
  join profiles p on p.user_id=pa.profile_id and p.ativo
  join plans pl on pl.id=c.plano and pl.ativo join ofertas_perfis o on o.id=c.plano and o.ativo
  where c.partner_id=p_parceiro and c.ativo and c.validade>now() and pa.tipo='leiloeiro' and pa.status in ('aprovado','ativo')
    and ((p.nicho='leiloeiro' and p.plan_id=c.plano and p.plan_valido_ate>now())
      or (p.nicho is distinct from 'leiloeiro' and exists(select from conta_contextos ctx where ctx.titular=p.user_id
        and ctx.nicho='leiloeiro' and ctx.plano=c.plano and ctx.validade>now())))
$$;
create function public.leilao_acesso(p_ator uuid) returns text language sql stable security definer set search_path=public as $$
  select leilao_pacote(pa.id) from partners pa join profiles p on p.user_id=pa.profile_id
  where p.user_id=p_ator and p.role='leiloeiro' and p.nicho='leiloeiro' and pa.tipo='leiloeiro'
$$;
create function public.leilao_credenciar(p_ator uuid,p_parceiro uuid,p_plano text,p_matricula text,p_empresa text,p_referencia text,
  p_validade timestamptz,p_ativo boolean,p_revisao int) returns void language plpgsql security definer set search_path=public as $$
declare pa partners; perfil profiles; c leilao_credenciais; ate timestamptz;
begin
  if not exists(select from profiles where user_id=p_ator and ativo and role='admin_central') then raise insufficient_privilege; end if;
  select * into strict pa from partners where id=p_parceiro and tipo='leiloeiro' for update;
  select * into strict perfil from profiles where user_id=pa.profile_id for update;
  select * into c from leilao_credenciais where partner_id=pa.id;
  if coalesce(c.revisao,0) is distinct from p_revisao then raise serialization_failure; end if;
  if not p_ativo then
    if c.partner_id is null then raise no_data_found; end if;
    update leilao_credenciais set ativo=false,revisao=revisao+1 where partner_id=pa.id;
    update profiles set plan_valido_ate=now() where user_id=pa.profile_id and nicho='leiloeiro' and plan_id=c.plano and plan_origem='manual';
    update conta_contextos set validade=now() where titular=pa.profile_id and nicho='leiloeiro' and plano=c.plano and origem='manual';
  else
    if pa.status not in ('aprovado','ativo') or not perfil.ativo or perfil.role<>'leiloeiro' or perfil.nicho is distinct from 'leiloeiro'
      or perfil.plan_origem='assinatura' or p_plano not in ('leilao_teste','leilao_essencial','leilao_profissional','leilao_premium')
      or not exists(select from ofertas_perfis where id=p_plano and ativo)
      or coalesce(length(trim(p_matricula)),0) not between 3 and 150 or coalesce(length(trim(p_empresa)),0) not between 3 and 200
      or coalesce(length(trim(p_referencia)),0) not between 3 and 360 then raise invalid_parameter_value; end if;
    if p_plano='leilao_teste' and c.teste_em is not null then raise exception 'O teste já foi concedido.'; end if;
    ate:=case when p_plano='leilao_teste' then now()+interval '3 days' else p_validade end;
    if ate is null or ate<=now() then raise invalid_parameter_value; end if;
    insert into leilao_credenciais(partner_id,plano,matricula,empresa,referencia,validade,ativo,teste_em)
      values(pa.id,p_plano,trim(p_matricula),trim(p_empresa),trim(p_referencia),ate,true,case when p_plano='leilao_teste' then now() end)
      on conflict(partner_id) do update set plano=excluded.plano,matricula=excluded.matricula,empresa=excluded.empresa,referencia=excluded.referencia,
        validade=excluded.validade,ativo=true,teste_em=coalesce(leilao_credenciais.teste_em,excluded.teste_em),revisao=leilao_credenciais.revisao+1;
    update profiles set plan_id=p_plano,plan_origem='manual',plan_valido_ate=ate where user_id=pa.profile_id;
  end if;
  insert into audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'leiloeiro_verificado','partners',pa.id,
    jsonb_build_object('ativo',p_ativo,'pacote',p_plano,'referencia',p_referencia));
end $$;

create function public.leilao_apto_publicar(p public.properties) returns boolean language sql stable set search_path=public as $$
  select p.modalidade='leilao' and p.regime_comercial='LEILAO' and coalesce(leilao_pacote(p.partner_id) in ('leilao_essencial','leilao_profissional','leilao_premium'),false)
    and exists(select from property_documents d where d.property_id in (p.id,p.parent_property_id)
      and (d.property_id=p.id or exists(select from properties pai where pai.id=p.parent_property_id and pai.partner_id=p.partner_id and pai.modalidade='leilao'))
      and d.tipo in ('edital','autorizacao') and d.verificado and d.substituido_por is null)
$$;
create function public.leilao_aceita_habilitacao(p_imovel uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select from properties p where p.id=p_imovel and p.status in ('publicado','em_negociacao')
    and leilao_pacote(p.partner_id) in ('leilao_profissional','leilao_premium') and leilao_apto_publicar(p)
    and not exists(select from leilao_operacoes op where op.imovel_id=p.id and op.estado<>'agendado'))
$$;
create function public.leilao_conferir_publicacao() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.modalidade='leilao' and new.status::text in ('aprovado','publicado','em_negociacao') and not leilao_apto_publicar(new) then
    raise exception using errcode='P6101',message='Vincule um leiloeiro credenciado com pacote vigente e confira a autorização deste leilão.';
  end if;
  return new;
end $$;
create trigger trg_leilao_publicar before insert or update of status,modalidade,partner_id,regime_comercial,parent_property_id on public.properties
  for each row execute function public.leilao_conferir_publicacao();

-- Uma única linha de lote serializa resultado, mudança de praça e decisões de habilitação.
create function public.leilao_operar(p_ator uuid,p_imovel uuid,p_acao text,p_dados jsonb,p_revisao int) returns void
language plpgsql security definer set search_path=public as $$
declare im properties; oper leilao_operacoes; h leilao_habilitacoes; pacote text; data1 timestamptz; data2 timestamptz;
  ref text:=nullif(trim(p_dados->>'referencia'),''); resultado text; valor_final numeric;
begin
  select * into strict im from properties where id=p_imovel and modalidade='leilao' and regime_comercial='LEILAO' for update;
  select * into oper from leilao_operacoes where imovel_id=im.id;
  if not exists(select from profiles where user_id=p_ator and ativo) then raise insufficient_privilege; end if;
  if p_acao='solicitar' then
    if not leilao_aceita_habilitacao(im.id) then raise insufficient_privilege; end if;
    if (p_dados->'aceite') is distinct from 'true'::jsonb or not (coalesce(trim(p_dados->>'contato'),'') ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
      or length(p_dados->>'contato')>200 then raise invalid_parameter_value; end if;
    insert into leilao_habilitacoes(imovel_id,candidato,contato,consentimento)
      values(im.id,p_ator,lower(trim(p_dados->>'contato')),'P6-v1 · Pedido de habilitação e compartilhamento do cadastro com o leiloeiro deste imóvel.')
      on conflict(imovel_id,candidato) do nothing;
    if not found then return; end if;
  else
    pacote:=leilao_acesso(p_ator);
    if pacote is null or pacote='leilao_teste' or not exists(select from partners where id=im.partner_id and profile_id=p_ator) then raise insufficient_privilege; end if;
    if p_acao in ('habilitar','recusar','arrematar','sem_arremate','concluir') and pacote='leilao_essencial' then raise insufficient_privilege; end if;
    if p_acao in ('habilitar','recusar') then
      select * into strict h from leilao_habilitacoes where id=(p_dados->>'candidatura')::uuid and imovel_id=im.id;
      if h.revisao is distinct from p_revisao then raise serialization_failure; end if;
      if h.estado<>'solicitada' or coalesce(oper.estado,'agendado')<>'agendado' or ref is null then raise invalid_parameter_value; end if;
      update leilao_habilitacoes set estado=case when p_acao='habilitar' then 'habilitada' else 'recusada' end,
        referencia=left(ref,500),revisao=revisao+1 where id=h.id;
    else
      if coalesce(oper.revisao,0) is distinct from p_revisao then raise serialization_failure; end if;
      insert into leilao_operacoes(imovel_id) values(im.id) on conflict do nothing;
      if p_acao='agenda' then
        data1:=(p_dados->>'primeira')::timestamptz; data2:=(p_dados->>'segunda')::timestamptz;
        if data1 is null or (data2 is not null and data2<=data1) or coalesce(oper.estado,'agendado')<>'agendado' then raise invalid_parameter_value; end if;
        update properties set leilao=leilao || jsonb_build_object('praca1_data',data1,'praca2_data',data2) where id=im.id;
        update leilao_operacoes set revisao=revisao+1 where imovel_id=im.id;
      elsif p_acao in ('arrematar','sem_arremate') then
        if coalesce(oper.estado,'agendado')<>'agendado' or im.status::text not in ('publicado','em_negociacao') or ref is null then raise invalid_parameter_value; end if;
        if p_acao='arrematar' then
          select * into strict h from leilao_habilitacoes where id=(p_dados->>'candidatura')::uuid and imovel_id=im.id and estado='habilitada';
          valor_final:=(p_dados->>'valor')::numeric;
          if valor_final is null or valor_final<=0 then raise invalid_parameter_value; end if;
        end if;
        resultado:=case when p_acao='arrematar' then 'arrematado' else 'sem_arremate' end;
        update leilao_operacoes set estado=resultado,arrematante=h.candidato,valor=valor_final,
          resultado_em=now(),referencia_resultado=left(ref,500),revisao=revisao+1 where imovel_id=im.id;
        if p_acao='arrematar' then update properties set status='vendido' where id=im.id;
        else update properties set status='inativo' where id=im.id; end if;
      elsif p_acao='concluir' then
        if oper.estado is null or oper.estado not in ('arrematado','sem_arremate') or ref is null then raise invalid_parameter_value; end if;
        update leilao_operacoes set estado='concluido',pos_leilao=left(ref,2000),revisao=revisao+1 where imovel_id=im.id;
      else raise invalid_parameter_value; end if;
    end if;
  end if;
  insert into audit_log(user_id,acao,entidade,entidade_id,property_id,dados_depois)
    values(p_ator,'leilao_'||p_acao,'properties',im.id,im.id,jsonb_build_object('candidatura',p_dados->>'candidatura','referencia',left(ref,500)));
end $$;
revoke all on function public.leilao_aceita_habilitacao(uuid),public.leilao_pacote(uuid),public.leilao_acesso(uuid),public.leilao_credenciar(uuid,uuid,text,text,text,text,timestamptz,boolean,int),
  public.leilao_apto_publicar(public.properties),public.leilao_conferir_publicacao(),public.leilao_operar(uuid,uuid,text,jsonb,int) from public,anon,authenticated;
grant execute on function public.leilao_aceita_habilitacao(uuid),public.leilao_acesso(uuid),public.leilao_credenciar(uuid,uuid,text,text,text,text,timestamptz,boolean,int),
  public.leilao_operar(uuid,uuid,text,jsonb,int) to service_role;

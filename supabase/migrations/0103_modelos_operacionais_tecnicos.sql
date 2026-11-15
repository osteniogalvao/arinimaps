-- Descritores reutilizáveis da Diretoria. O registro preserva os campos usados na abertura.
create table public.tecnico_modulos (
 id uuid primary key, profissao text not null check(length(trim(profissao)) between 3 and 100),
 nome text not null check(length(trim(nome)) between 3 and 120), premium boolean not null default false,
 campos jsonb not null, documentos text[] not null default '{}', ativo boolean not null default true,
 versao int not null default 1, unique(profissao,nome)
);
create table public.tecnico_pedidos (
 id uuid primary key,titular uuid not null references public.profiles(user_id),profissao text not null,
 descricao text not null,criado timestamptz not null default now(),previsao date not null,
 estado text not null default 'recebido' check(estado in ('recebido','em_analise','liberado','devolvido')),resposta text,modelo_profissao text,versao int not null default 1
);
create unique index tecnico_pedido_em_aberto on public.tecnico_pedidos(titular,lower(trim(profissao))) where estado in ('recebido','em_analise');
create table public.tecnico_registros (
 id uuid primary key,espaco text not null,autor uuid not null references public.profiles(user_id),modulo uuid not null references public.tecnico_modulos(id),
 modelo jsonb not null,titulo text not null,documento text,campos jsonb not null,atendimento uuid,
 etapa text not null check(etapa in ('aberto','em_andamento','aguardando','concluido')),versao int not null default 1,
 atualizado timestamptz not null default now(),alterado_por uuid not null references public.profiles(user_id)
);
create index tecnico_registros_espaco on public.tecnico_registros(espaco,atualizado desc,id);
alter table public.tecnico_modulos enable row level security;
alter table public.tecnico_pedidos enable row level security;
alter table public.tecnico_registros enable row level security;
revoke all on public.tecnico_modulos,public.tecnico_pedidos,public.tecnico_registros from public,anon,authenticated,service_role;
grant select on public.tecnico_modulos,public.tecnico_pedidos to service_role;
grant select on public.tecnico_modulos,public.tecnico_pedidos,public.tecnico_registros to authenticated;

create function public.tecnico_espaco() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('chave',case when o.id is null then 'conta/'||p.user_id else 'org/'||o.id end,
   'nome',coalesce(o.nome,p.nome),'premium',coalesce(o.plan_id,p.plan_id)='tecnico_premium')
 from public.profiles p left join lateral (
    select o1.id,o1.nome,o1.plan_id from public.organization_members m join public.organizations o1 on o1.id=m.org_id and o1.ativo
    join public.plans pl on pl.id=o1.plan_id and pl.ativo and pl.escopo='organizacao' and pl.recursos @> array['crm_privado','crm_setorial']
    where m.user_id=p.user_id and m.nicho_vinculo=p.nicho and m.status='ativo' and (o1.plan_valido_ate is null or o1.plan_valido_ate>now())
 ) o on p.plan_origem='padrao'
 where p.user_id=auth.uid() and p.ativo and p.nicho='engenheiro' and public.crm_setorial_liberado()
   and (select count(*)=2 from public.fn_niveis_itens_persona('engenheiro',coalesce(o.plan_id,p.plan_id),array[424,433]) d
      where d.liberado is distinct from false and d.nivel in ('O','P','M','G'))
$$;
create policy modelos_liberados on public.tecnico_modulos for select to authenticated using(ativo and (select public.tecnico_espaco()) is not null and (not premium or ((select public.tecnico_espaco())->>'premium')::boolean));
create policy pedido_proprio on public.tecnico_pedidos for select to authenticated using(titular=(select auth.uid()) and (select public.tecnico_espaco()) is not null);
create policy registro_do_espaco on public.tecnico_registros for select to authenticated using(espaco=((select public.tecnico_espaco())->>'chave') and (not (modelo->>'premium')::boolean or ((select public.tecnico_espaco())->>'premium')::boolean));

create function public.tecnico_modelo_salvar(p_ator uuid,p_id uuid,p_versao int,p_profissao text,p_nome text,p_premium boolean,p_campos jsonb,p_documentos text[],p_ativo boolean)
returns void language plpgsql security definer set search_path='' as $$
declare campo jsonb; chaves text[]:='{}';
begin
 if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then raise insufficient_privilege; end if;
 if p_campos is null or jsonb_typeof(p_campos)<>'array' or jsonb_array_length(p_campos) not between 1 and 24 or p_documentos is null
    or cardinality(p_documentos)>18 or exists(select from unnest(p_documentos)d where d is null or length(trim(d)) not between 2 and 140)
    or lower(trim(p_profissao))='corretagem' then raise invalid_parameter_value; end if;
 foreach campo in array array(select jsonb_array_elements(p_campos)) loop
    if coalesce(campo->>'id','')!~'^[a-z][a-z0-9_]{0,39}$' or (campo->>'id')=any(chaves) or length(trim(coalesce(campo->>'nome',''))) not between 2 and 100 or
       coalesce(campo->>'tipo','') not in ('texto','data','numero') or jsonb_typeof(campo->'obrigatorio') is distinct from 'boolean' then raise invalid_parameter_value; end if;
    chaves:=array_append(chaves,campo->>'id');
 end loop;
 if p_versao=0 then insert into public.tecnico_modulos(id,profissao,nome,premium,campos,documentos,ativo)
      values(p_id,trim(p_profissao),trim(p_nome),p_premium,p_campos,p_documentos,p_ativo);
 else
   update public.tecnico_modulos set profissao=trim(p_profissao),nome=trim(p_nome),campos=p_campos,documentos=p_documentos,premium=p_premium,ativo=p_ativo,versao=versao+1 where id=p_id and versao=p_versao;
   if not found then raise serialization_failure; end if;
 end if;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'tecnico.modelo','tecnico_modulos',p_id,jsonb_build_object('versao',p_versao+1,'ativo',p_ativo));
end $$;

create function public.tecnico_pedir_profissao(p_id uuid,p_profissao text,p_descricao text) returns uuid language plpgsql security definer set search_path='' as $$
declare existente public.tecnico_pedidos; prazo date;
begin
 if public.tecnico_espaco() is null then raise insufficient_privilege; end if;
 if length(trim(coalesce(p_profissao,''))) not between 3 and 100 or length(trim(coalesce(p_descricao,''))) not between 8 and 2000 or lower(trim(p_profissao))='corretagem' then raise invalid_parameter_value; end if;
 if exists(select from public.tecnico_modulos where lower(profissao)=lower(trim(p_profissao)) and ativo) then raise object_not_in_prerequisite_state; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||lower(trim(p_profissao)),0));
 select * into existente from public.tecnico_pedidos where titular=auth.uid() and (id=p_id or lower(profissao)=lower(trim(p_profissao)) and estado in ('recebido','em_analise')) limit 1;
 if found then
   if existente.id=p_id and row(existente.profissao,existente.descricao) is distinct from row(trim(p_profissao),trim(p_descricao)) then raise unique_violation; end if;
   return existente.id;
 end if;
 select d::date into prazo from generate_series((now() at time zone 'America/Sao_Paulo')::date+1,(now() at time zone 'America/Sao_Paulo')::date+12,interval '1 day')d
 where extract(isodow from d)<=5 order by d offset 4 limit 1;
 insert into public.tecnico_pedidos(id,titular,profissao,descricao,previsao) values(p_id,auth.uid(),trim(p_profissao),trim(p_descricao),prazo);
 return p_id;
end $$;
create function public.tecnico_responder_profissao(p_ator uuid,p_id uuid,p_versao int,p_estado text,p_resposta text,p_modelo text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then raise insufficient_privilege; end if;
 if p_estado is null or p_estado not in ('em_analise','liberado','devolvido') or length(trim(coalesce(p_resposta,''))) not between 4 and 1000 then raise invalid_parameter_value; end if;
 if p_estado='liberado' and not exists(select from public.tecnico_modulos where ativo and profissao=p_modelo) then raise object_not_in_prerequisite_state; end if;
 update public.tecnico_pedidos set versao=versao+1,estado=p_estado,resposta=trim(p_resposta),modelo_profissao=case when p_estado='liberado' then p_modelo end
   where id=p_id and versao=p_versao and estado in ('recebido','em_analise');
 if not found then raise serialization_failure; end if;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'tecnico.profissao','tecnico_pedidos',p_id,jsonb_build_object('estado',p_estado,'modelo',p_modelo));
end $$;

create function public.tecnico_salvar_registro(p_id uuid,p_versao int,p_modulo uuid,p_revisao int,p_titulo text,p_documento text,p_campos jsonb,p_etapa text,p_atendimento uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare esp jsonb:=public.tecnico_espaco(); r public.tecnico_registros; m public.tecnico_modulos; modelo jsonb; campo jsonb; valor text; validados jsonb:='{}'; papel text;
begin
 if esp is null then raise insufficient_privilege; end if;
 if length(trim(coalesce(p_titulo,''))) not between 2 and 180 or p_etapa is null or p_etapa not in ('aberto','em_andamento','aguardando','concluido')
   or jsonb_typeof(p_campos) is distinct from 'object' or length(p_campos::text)>30000 or p_versao is null then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into r from public.tecnico_registros where id=p_id;
 if found then
   if r.espaco<>esp->>'chave' or (r.modelo->>'premium')::boolean and not (esp->>'premium')::boolean then raise insufficient_privilege; end if;
   if p_versao<>r.versao and not (p_versao=0 and r.versao=1 and r.autor=auth.uid()) then raise serialization_failure; end if;
   if p_modulo is distinct from r.modulo or p_atendimento is distinct from r.atendimento then raise invalid_parameter_value; end if;
   modelo:=r.modelo;
 else
   if p_versao<>0 then raise no_data_found; end if;
   select * into strict m from public.tecnico_modulos where id=p_modulo and ativo for share;
   if m.versao is distinct from p_revisao then raise serialization_failure; end if;
   if m.premium and not (esp->>'premium')::boolean then raise insufficient_privilege; end if;
   if p_atendimento is not null and not exists(select from public.crm_privado_atendimentos a join public.crm_privado_contatos c on (c.titular_id,c.id)=(a.titular_id,a.contato_id)
     where a.titular_id=auth.uid() and a.id=p_atendimento and c.nicho='engenheiro') then raise insufficient_privilege; end if;
   modelo:=jsonb_build_object('nome',m.nome,'profissao',m.profissao,'premium',m.premium,'campos',m.campos,'documentos',m.documentos,'versao',m.versao);
 end if;
 if p_documento is not null and not (modelo->'documentos' ? p_documento) then raise invalid_parameter_value; end if;
 for campo in select jsonb_array_elements(modelo->'campos') loop
   papel:=campo->>'id';valor:=trim(coalesce(p_campos->>papel,''));
   if valor='' then if (campo->>'obrigatorio')::boolean then raise invalid_parameter_value; end if; continue; end if;
   if jsonb_typeof(p_campos->papel)<>'string' or length(valor)>2000 then raise invalid_parameter_value; end if;
   if campo->>'tipo'='numero' and valor!~'^-?[0-9]{1,12}([.][0-9]{1,6})?$' then raise invalid_parameter_value; end if;
   if campo->>'tipo'='data' then if valor!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise invalid_parameter_value; end if; perform valor::date; end if;
   validados:=jsonb_set(validados,array[papel],to_jsonb(valor));
 end loop;
 if exists(select from jsonb_object_keys(p_campos) k where not exists(select from jsonb_array_elements(modelo->'campos') d where d->>'id'=k)) then raise invalid_parameter_value; end if;
 if r.id is null then
   insert into public.tecnico_registros(id,espaco,autor,modulo,modelo,titulo,documento,campos,etapa,atendimento,alterado_por)
   values(p_id,esp->>'chave',auth.uid(),p_modulo,modelo,trim(p_titulo),p_documento,validados,p_etapa,p_atendimento,auth.uid());
 elsif p_versao=0 then
   if row(r.titulo,r.documento,r.campos,r.etapa) is distinct from row(trim(p_titulo),p_documento,validados,p_etapa) then raise unique_violation; end if;
 else update public.tecnico_registros set titulo=trim(p_titulo),etapa=p_etapa,campos=validados,documento=p_documento,versao=versao+1,atualizado=now(),alterado_por=auth.uid() where id=p_id;
 end if;
 return p_id;
end $$;
revoke all on function public.tecnico_espaco(),public.tecnico_pedir_profissao(uuid,text,text),public.tecnico_salvar_registro(uuid,int,uuid,int,text,text,jsonb,text,uuid),
 public.tecnico_modelo_salvar(uuid,uuid,int,text,text,boolean,jsonb,text[],boolean),public.tecnico_responder_profissao(uuid,uuid,int,text,text,text) from public,anon,authenticated;
grant execute on function public.tecnico_espaco(),public.tecnico_pedir_profissao(uuid,text,text),public.tecnico_salvar_registro(uuid,int,uuid,int,text,text,jsonb,text,uuid) to authenticated;
grant execute on function public.tecnico_modelo_salvar(uuid,uuid,int,text,text,boolean,jsonb,text[],boolean),public.tecnico_responder_profissao(uuid,uuid,int,text,text,text) to service_role;


insert into public.tecnico_modulos(id,profissao,nome,premium,campos,documentos)
select gen_random_uuid(),p,n,pr,c,d from (values
 ('Advocacia','Casos e processos',false,'[{"id":"campo_1","nome":"Referência do processo","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Partes","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Imóvel relacionado","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Andamento do caso","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Documentos e referências","tipo":"texto","obrigatorio":false}]'::jsonb,array['Parecer sobre o imóvel']::text[]),
 ('Advocacia','Prazos e audiências',false,'[{"id":"campo_1","nome":"Caso ou processo","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Data do prazo","tipo":"data","obrigatorio":true},{"id":"campo_3","nome":"Audiência e local","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Responsável","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Providência","tipo":"texto","obrigatorio":false}]'::jsonb,array['Agenda do processo']::text[]),
 ('Advocacia','Dossiê do imóvel',false,'[{"id":"campo_1","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Matrícula e cartório","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Sobreposições identificadas","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Situação ambiental e fundiária","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Fontes e data da consulta","tipo":"texto","obrigatorio":false}]'::jsonb,array['Dossiê do imóvel para o processo']::text[]),
 ('Advocacia','Peças e contratos',false,'[{"id":"campo_1","nome":"Partes","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Imóvel ou objeto","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Condições","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Cláusulas e observações","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Revisão profissional","tipo":"texto","obrigatorio":false}]'::jsonb,array['Minuta de compra e venda','Minuta de arrendamento rural','Minuta de parceria agrícola','Minuta de procuração']::text[]),
 ('Advocacia','Honorários e contratos',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Serviço contratado","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Honorários em reais","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Condições de pagamento","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Vencimento","tipo":"data","obrigatorio":false}]'::jsonb,array['Proposta de honorários']::text[]),
 ('Agrimensura e topografia','Ordens de serviço e levantamentos',false,'[{"id":"campo_1","nome":"Contratante","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Identificação da área","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Área em hectares","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Método e equipamentos","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Data da entrega","tipo":"data","obrigatorio":false},{"id":"campo_6","nome":"Resultado","tipo":"texto","obrigatorio":false}]'::jsonb,array['Ordem de serviço','Relatório de entrega']::text[]),
 ('Agrimensura e topografia','Memorial e planta',false,'[{"id":"campo_1","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Sistema de referência","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Vértices e confrontações","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Referência do desenho","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Observações técnicas","tipo":"texto","obrigatorio":false}]'::jsonb,array['Memorial descritivo preliminar','Ficha da planta do imóvel']::text[]),
 ('Agrimensura e topografia','Confrontantes e notificações',false,'[{"id":"campo_1","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Confrontante","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Trecho de divisa","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Data da notificação","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Resposta","tipo":"texto","obrigatorio":false}]'::jsonb,array['Controle de confrontantes']::text[]),
 ('Agrimensura e topografia','Controle de ART',false,'[{"id":"campo_1","nome":"Trabalho técnico","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Profissional e conselho","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Referência da ART já emitida","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Data de registro","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Comprovante","tipo":"texto","obrigatorio":false}]'::jsonb,array['Ficha de controle de ART']::text[]),
 ('Agrimensura e topografia','Equipe de campo e equipamentos',true,'[{"id":"campo_1","nome":"Ordem de serviço","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Responsável","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Integrantes","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Equipamentos","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Data de campo","tipo":"data","obrigatorio":false}]'::jsonb,array['Plano de campo']::text[]),
 ('Agrimensura e topografia','Orçamento de levantamento',false,'[{"id":"campo_1","nome":"Contratante","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Área em hectares","tipo":"numero","obrigatorio":false},{"id":"campo_3","nome":"Valor por hectare em reais","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Custos adicionais em reais","tipo":"numero","obrigatorio":false},{"id":"campo_5","nome":"Valor proposto em reais","tipo":"numero","obrigatorio":false},{"id":"campo_6","nome":"Escopo e prazo","tipo":"texto","obrigatorio":false}]'::jsonb,array['Orçamento de levantamento']::text[]),
 ('Contabilidade','Clientes e imóveis rurais',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Área em hectares","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Referência cadastral","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Situação e fontes","tipo":"texto","obrigatorio":false}]'::jsonb,array['Relatório de situação do imóvel']::text[]),
 ('Contabilidade','Obrigações e vencimentos',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Obrigação ou declaração","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Competência","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Vencimento","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Comprovante","tipo":"texto","obrigatorio":false},{"id":"campo_6","nome":"Pendências","tipo":"texto","obrigatorio":false}]'::jsonb,array['Checklist de obrigações']::text[]),
 ('Contabilidade','Tarefas por competência',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Competência","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Tarefa","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Responsável","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Prazo","tipo":"data","obrigatorio":false},{"id":"campo_6","nome":"Resultado","tipo":"texto","obrigatorio":false}]'::jsonb,array['Resumo da competência']::text[]),
 ('Contabilidade','Documentos fiscais',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Tipo de documento","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Período","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Referência do arquivo no Drive","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Data de recebimento","tipo":"data","obrigatorio":false}]'::jsonb,array['Relação de documentos fiscais']::text[]),
 ('Contabilidade','Honorários e cobrança',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Serviços","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Honorários propostos em reais","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Condições","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Vencimento","tipo":"data","obrigatorio":false}]'::jsonb,array['Proposta de honorários']::text[]),
 ('Contabilidade','Relatório ao cliente',false,'[{"id":"campo_1","nome":"Cliente","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Imóveis e áreas","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Resultado do período","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Obrigações cumpridas","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Pendências","tipo":"texto","obrigatorio":false}]'::jsonb,array['Relatório do cliente rural']::text[]),
 ('Engenharia ambiental','Licenças e condicionantes',false,'[{"id":"campo_1","nome":"Imóvel ou empreendimento","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Licença ou processo","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Condicionante","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Prazo","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Responsável","tipo":"texto","obrigatorio":false},{"id":"campo_6","nome":"Comprovantes","tipo":"texto","obrigatorio":false}]'::jsonb,array['Relatório de regularização']::text[]),
 ('Engenharia ambiental','APP, reserva legal e nascentes',false,'[{"id":"campo_1","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Área de APP em hectares","tipo":"numero","obrigatorio":false},{"id":"campo_3","nome":"Reserva legal em hectares","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Nascentes verificadas","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Fonte e limites da análise","tipo":"texto","obrigatorio":false}]'::jsonb,array['Ficha de diagnóstico ambiental']::text[]),
 ('Engenharia ambiental','Laudos e relatórios',false,'[{"id":"campo_1","nome":"Projeto","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Objeto","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Método e fontes","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Constatações","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Conclusão técnica","tipo":"texto","obrigatorio":false}]'::jsonb,array['Laudo ambiental']::text[]),
 ('Engenharia ambiental','Vistorias de campo',false,'[{"id":"campo_1","nome":"Imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Data da vistoria","tipo":"data","obrigatorio":true},{"id":"campo_3","nome":"Localização","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Fotos e referências","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Constatações","tipo":"texto","obrigatorio":false},{"id":"campo_6","nome":"Responsável","tipo":"texto","obrigatorio":false}]'::jsonb,array['Relatório de vistoria']::text[]),
 ('Engenharia ambiental','Monitoramento da área',false,'[{"id":"campo_1","nome":"Área ou imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Evento ambiental","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Data da verificação","tipo":"data","obrigatorio":false},{"id":"campo_4","nome":"Fonte e referência do alerta","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Providência","tipo":"texto","obrigatorio":false}]'::jsonb,array['Histórico de monitoramento']::text[]),
 ('Engenharia ambiental','Recuperação e controle de ART',false,'[{"id":"campo_1","nome":"Área a recuperar","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Diagnóstico","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Intervenções previstas","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Prazos e indicadores","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Referência de ART já emitida","tipo":"texto","obrigatorio":false}]'::jsonb,array['Plano de recuperação de área']::text[]),
 ('Engenharia civil','Obras, etapas e cronograma',false,'[{"id":"campo_1","nome":"Obra","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Cliente ou contratante","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Etapa","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Início","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Entrega prevista","tipo":"data","obrigatorio":false},{"id":"campo_6","nome":"Responsável","tipo":"texto","obrigatorio":false}]'::jsonb,array['Cronograma da obra']::text[]),
 ('Engenharia civil','Vistorias e laudos',false,'[{"id":"campo_1","nome":"Obra ou imóvel","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Data da vistoria","tipo":"data","obrigatorio":true},{"id":"campo_3","nome":"Local","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Fotos e documentos","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Constatações","tipo":"texto","obrigatorio":false},{"id":"campo_6","nome":"Conclusão","tipo":"texto","obrigatorio":false}]'::jsonb,array['Laudo de vistoria']::text[]),
 ('Engenharia civil','Orçamentos e medições',false,'[{"id":"campo_1","nome":"Obra","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Serviço executado","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Quantidade","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Unidade","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Valor unitário em reais","tipo":"numero","obrigatorio":false},{"id":"campo_6","nome":"Valor total em reais","tipo":"numero","obrigatorio":false}]'::jsonb,array['Orçamento de obra','Relatório de medição']::text[]),
 ('Engenharia civil','Estudo do terreno',false,'[{"id":"campo_1","nome":"Terreno","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Relevo","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Declividade em porcentagem","tipo":"numero","obrigatorio":false},{"id":"campo_4","nome":"Restrições identificadas","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Fontes","tipo":"texto","obrigatorio":false},{"id":"campo_6","nome":"Conclusão","tipo":"texto","obrigatorio":false}]'::jsonb,array['Estudo de viabilidade do terreno']::text[]),
 ('Engenharia civil','Fornecedores e equipe',false,'[{"id":"campo_1","nome":"Obra","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Empresa ou profissional","tipo":"texto","obrigatorio":true},{"id":"campo_3","nome":"Escopo","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Contato","tipo":"texto","obrigatorio":false},{"id":"campo_5","nome":"Responsável interno","tipo":"texto","obrigatorio":false}]'::jsonb,array['Relação de fornecedores e equipe']::text[]),
 ('Engenharia civil','Controle de ART',false,'[{"id":"campo_1","nome":"Obra ou serviço","tipo":"texto","obrigatorio":true},{"id":"campo_2","nome":"Profissional e conselho","tipo":"texto","obrigatorio":false},{"id":"campo_3","nome":"Referência de ART já emitida","tipo":"texto","obrigatorio":false},{"id":"campo_4","nome":"Data de registro","tipo":"data","obrigatorio":false},{"id":"campo_5","nome":"Comprovante","tipo":"texto","obrigatorio":false}]'::jsonb,array['Ficha de controle de ART']::text[])
) as v(p,n,pr,c,d);

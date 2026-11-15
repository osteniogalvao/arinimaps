-- Um arquivo opcional por envio. O arquivo e o andamento pertencem à mesma operação.
create table public.balcao_anexos (
 id uuid primary key, andamento bigint not null unique references public.balcao_andamentos(id) on delete cascade,
 autor uuid not null references public.profiles(user_id), chave uuid not null,
 nome text not null check(length(nome) between 1 and 200), tamanho integer not null check(tamanho between 1 and 26214400),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), campos jsonb not null,
 storage_path text not null unique check(storage_path ~ ('^balcao/'||id::text||'[.][a-z0-9]{1,6}$')),
 unique(autor,chave)
);
alter table public.balcao_anexos enable row level security;
revoke all on public.balcao_anexos from public,anon,authenticated,service_role;

-- Um reenvio confirmado devolve o número. Os demais precisam de um serviço aberto ou de uma pendência do titular.
create function public.balcao_preparar_anexo(p_autor uuid,p_chave uuid,p_campos jsonb,p_hash text,p_nome text)
returns bigint language plpgsql security definer set search_path='' as $$
declare an public.balcao_anexos; p public.balcao_protocolos;
begin
 if not exists(select from public.profiles where user_id=p_autor and ativo) then raise insufficient_privilege; end if;
 select * into an from public.balcao_anexos where autor=p_autor and chave=p_chave;
 if found then
   if an.campos is distinct from p_campos or an.sha256 is distinct from p_hash or an.nome is distinct from p_nome then raise serialization_failure; end if;
   return (select pr.numero from public.balcao_protocolos pr join public.balcao_andamentos a on a.protocolo=pr.id
     where a.id=an.andamento and pr.titular=p_autor);
 end if;
 if p_campos->>'acao'='protocolar' then
   if exists(select from public.balcao_protocolos where titular=p_autor and chave=p_chave) then raise serialization_failure; end if;
   if not exists(select from public.balcao_regras where id=(p_campos->>'regra')::uuid and ativa and public.fn_balcao_vigente(org)) then raise insufficient_privilege; end if;
 elsif p_campos->>'acao'='resposta' then
   select * into p from public.balcao_protocolos where id=(p_campos->>'id')::uuid and titular=p_autor and public.fn_balcao_vigente(org);
   if not found then raise insufficient_privilege; end if;
   if p.estado<>'pendencia' or p.revisao is distinct from (p_campos->>'revisao')::int then raise serialization_failure; end if;
 else raise invalid_parameter_value;
 end if;
 return null;
end $$;

create function public.balcao_gravar_anexo(p_autor uuid,p_chave uuid,p_campos jsonb,p_hash text,p_nome text,p_id uuid,p_ext text,p_tamanho int)
returns table(numero bigint,arquivo uuid) language plpgsql security definer set search_path='' as $$
declare anterior bigint; protocolo public.balcao_protocolos; mov bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_autor::text||p_chave::text,98));
 anterior:=public.balcao_preparar_anexo(p_autor,p_chave,p_campos,p_hash,p_nome);
 if anterior is not null then
   return query select anterior,an.id from public.balcao_anexos an where an.autor=p_autor and an.chave=p_chave; return;
 end if;
 if p_campos->>'acao'='protocolar' then
   perform public.fn_balcao_abrir(p_autor,p_chave,(p_campos->>'regra')::uuid,p_campos->'dados');
   select * into strict protocolo from public.balcao_protocolos where titular=p_autor and chave=p_chave;
 else
   perform public.fn_balcao_andar(p_autor,(p_campos->>'id')::uuid,(p_campos->>'revisao')::int,'resposta',p_campos->>'texto');
   select * into strict protocolo from public.balcao_protocolos where id=(p_campos->>'id')::uuid and titular=p_autor;
 end if;
 select a.id into strict mov from public.balcao_andamentos a where a.protocolo=protocolo.id and a.ator=p_autor
   and a.acao=case when p_campos->>'acao'='protocolar' then 'protocolado' else 'resposta' end order by a.id desc limit 1;
 insert into public.balcao_anexos(id,andamento,autor,chave,nome,tamanho,sha256,campos,storage_path)
   values(p_id,mov,p_autor,p_chave,p_nome,p_tamanho,p_hash,p_campos,'balcao/'||p_id::text||'.'||p_ext);
 return query select protocolo.numero,p_id;
end $$;

create function public.balcao_obter_arquivo(p_ator uuid,p_id uuid) returns table(nome text,storage_path text)
language sql stable security definer set search_path='' as $$
 select an.nome,an.storage_path from public.balcao_anexos an join public.balcao_andamentos a on a.id=an.andamento
 join public.balcao_protocolos p on p.id=a.protocolo join public.profiles u on u.user_id=p_ator and u.ativo
 where an.id=p_id and (p.titular=p_ator or p.org=public.org_modulo_atual(p_ator,'balcao'))
$$;
revoke all on function public.balcao_preparar_anexo(uuid,uuid,jsonb,text,text),public.balcao_gravar_anexo(uuid,uuid,jsonb,text,text,uuid,text,int),
 public.balcao_obter_arquivo(uuid,uuid) from public,anon,authenticated;
grant execute on function public.balcao_preparar_anexo(uuid,uuid,jsonb,text,text),public.balcao_gravar_anexo(uuid,uuid,jsonb,text,text,uuid,text,int),
 public.balcao_obter_arquivo(uuid,uuid) to service_role;

create or replace function public.fn_balcao_pedidos(p_titular uuid,p_interno boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'numero',p.numero,'estado',p.estado,'revisao',p.revisao,
   'proprio',p.titular=p_titular,'servico',r.nome,'versao',r.versao,'municipio',o.nome,'data',p.criado_em,'dados',p.dados,
   'andamentos',(select jsonb_agg(jsonb_build_object('acao',a.acao,'texto',a.texto,'data',a.criado_em,
     'arquivo',case when an.id is not null then jsonb_build_object('id',an.id,'nome',an.nome,'tamanho',an.tamanho) end) order by a.id)
     from public.balcao_andamentos a left join public.balcao_anexos an on an.andamento=a.id where a.protocolo=p.id)) order by p.numero desc),'[]'::jsonb)
 from (select b.* from public.balcao_protocolos b where exists(select from public.profiles where user_id=p_titular and ativo)
   and (case when p_interno then b.org=public.org_modulo_atual(p_titular,'balcao') else b.titular=p_titular end)
   order by b.numero desc limit 150) p join public.balcao_regras r on r.id=p.regra join public.organizations o on o.id=p.org
$$;

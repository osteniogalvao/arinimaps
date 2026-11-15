-- A ativação existe somente por consentimento do titular. O histórico sobrevive à perda do plano.
create table public.monitor_areas (
  id uuid primary key default gen_random_uuid(), titular uuid not null references public.profiles(user_id) on delete cascade,
  nicho text not null check (nicho in ('proprietario','produtor_rural')), nome text not null check (length(nome) between 1 and 160),
  chave text not null, cofre_id uuid, geom geometry(MultiPolygon,4326) not null,
  ativo boolean not null default true, whatsapp boolean not null default false, aceite_em timestamptz not null default now(), encerrado_em timestamptz,
  unique(titular,nicho,chave)
);
create table public.monitor_leituras (
  area_id uuid not null references public.monitor_areas on delete cascade, fonte text not null
    check (fonte in ('inpe_queimadas','ibama_embargos','prodes_cerrado','sigef')),
  ativa boolean not null default true, registros jsonb, tentativa_em timestamptz, lida_em timestamptz,
  proxima timestamptz not null default now(), falhou boolean not null default false, reserva uuid,
  primary key(area_id,fonte)
);
create index monitor_agenda on public.monitor_leituras(proxima) where ativa;
create table public.monitor_eventos (
  id bigint generated always as identity primary key, area_id uuid not null, fonte text not null,
  codigo text not null, titulo text not null, detalhes jsonb not null, anterior jsonb, local geometry(Point,4326) not null,
  detectado_em timestamptz not null default now(), foreign key(area_id,fonte) references public.monitor_leituras on delete cascade
);
create index monitor_eventos_por_area on public.monitor_eventos(area_id,id desc);
create table public.monitor_avisos (
 id uuid primary key default gen_random_uuid(),area_id uuid not null references public.monitor_areas on delete cascade,
 dia date not null default ((now() at time zone 'America/Sao_Paulo')::date), status text not null default 'pendente'
 check(status in ('pendente','enviando','enviado','cancelado','recusado','conferir')), reserva_em timestamptz, mensagem_id text,
 unique(area_id,dia)
);
alter table public.monitor_avisos enable row level security;
revoke all on public.monitor_avisos from public,anon,authenticated,service_role;
grant select,update on public.monitor_avisos to service_role;
alter table public.monitor_areas enable row level security;
alter table public.monitor_leituras enable row level security;
alter table public.monitor_eventos enable row level security;
revoke all on public.monitor_areas,public.monitor_leituras,public.monitor_eventos from public,anon,authenticated;
grant select on public.monitor_areas,public.monitor_leituras,public.monitor_eventos to service_role;

update public.plans set recursos=array_append(recursos,'monitoramento_territorial')
where id in ('proprietario_monitoramento','proprietario_inteligencia','proprietario_completo','produtor_profissional','produtor_premium')
and not ('monitoramento_territorial'=any(recursos));

-- A rotina agendada resolve a assinatura do nicho que autorizou a coleta, inclusive quando o titular usa outro perfil.
create function public.monitor_autorizado(p_titular uuid,p_nicho text)
returns boolean language sql stable set search_path=public,pg_temp as $$
 select exists(select from profiles p
   left join conta_contextos c on c.titular=p.user_id and c.nicho=p_nicho
   join plans pl on pl.id=case when p.nicho=p_nicho then p.plan_id else c.plano end and pl.ativo
   cross join lateral fn_niveis_itens_persona(p_nicho,pl.id,array[510]) d
   where p.user_id=p_titular and p.ativo and p_nicho in ('proprietario','produtor_rural')
     and coalesce(case when p.nicho=p_nicho then p.plan_valido_ate else c.validade end,'infinity'::timestamptz)>now()
     and d.nivel in ('O','P','G','M') and coalesce(d.liberado,'monitoramento_territorial'=any(pl.recursos)))
$$;

create function public.monitor_geom_cofre(p_titular uuid,p_cofre uuid)
returns geometry language sql stable set search_path=public,pg_temp as $$
 select coalesce((select g.geom from property_geometries g where g.property_id=cl.referencia_imovel
   and GeometryType(g.geom) in ('POLYGON','MULTIPOLYGON') limit 1),car.geom)
 from cofre_propriedades c join propriedade_claims cl on cl.cofre_id=c.id and cl.titular_id=c.titular_id and cl.estado='APROVADA'
 left join car_imoveis car on car.cod_imovel=upper(trim(c.car)) where c.id=p_cofre and c.titular_id=p_titular
$$;

create function public.monitor_cota(p_titular uuid,p_nicho text,p_chave text) returns bigint
language sql stable set search_path=public,pg_temp as $$
 select case when pl.cotas->>p_chave ~ '^[0-9]{1,9}$' then (pl.cotas->>p_chave)::bigint end
 from profiles p left join conta_contextos c on c.titular=p.user_id and c.nicho=p_nicho
 join plans pl on pl.id=case when p.nicho=p_nicho then p.plan_id else c.plano end where p.user_id=p_titular
$$;
create function public.monitor_area_habilitada(a public.monitor_areas) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select a.ativo and monitor_autorizado(a.titular,a.nicho)
   and ST_Area(a.geom::geography)/10000 <= coalesce(monitor_cota(a.titular,a.nicho,'monitoramento_hectares'),51010000000)
   and (select count(*) from monitor_areas m where m.titular=a.titular and m.nicho=a.nicho and m.ativo
       and (m.aceite_em,m.id)<=(a.aceite_em,a.id)) <= coalesce(monitor_cota(a.titular,a.nicho,'propriedades_cofre'),3)
       + coalesce((select sum(quantidade) from cofre_concessoes where titular_id=a.titular),0)
   and (a.cofre_id is null or coalesce(ST_Equals(a.geom,monitor_geom_cofre(a.titular,a.cofre_id)),false))
$$;

create function public.monitor_configurar(p_titular uuid,p_nicho text,p_nome text,p_cofre uuid,p_geo jsonb,p_fontes text[],p_wa boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare g geometry; k text; area uuid; limite int; a record;
begin
 select * into a from profiles where user_id=p_titular and ativo and nicho=p_nicho and entrada_ativa is distinct from 'anunciar' for update;
 if not found or not monitor_autorizado(p_titular,p_nicho) then raise insufficient_privilege; end if;
 if num_nonnulls(p_geo,p_cofre)<>1 or nullif(trim(p_nome),'') is null or length(p_nome)>160
    or p_fontes is null or cardinality(p_fontes) not between 1 and 4 or array_position(p_fontes,null) is not null
    or not p_fontes <@ array['inpe_queimadas','ibama_embargos','prodes_cerrado','sigef'] then raise invalid_parameter_value; end if;
 if p_cofre is not null then
   g:=monitor_geom_cofre(p_titular,p_cofre); k:='cofre:'||p_cofre;
 else
   g:=ST_SetSRID(ST_GeomFromGeoJSON(p_geo),4326);
   k:='area:'||md5(ST_AsEWKB(ST_Normalize(g)));
 end if;
 if g is null or GeometryType(g) not in ('POLYGON','MULTIPOLYGON') or not ST_IsValid(g) or ST_IsEmpty(g) then
   raise exception using errcode='P9501',message='É necessário um polígono válido da própria área ou um cofre aprovado com polígono.';
 end if;
 if ST_Area(g::geography)/10000 > monitor_cota(p_titular,p_nicho,'monitoramento_hectares') then
   raise exception using errcode='P9504',message='A área excede a cobertura em hectares do plano.';
 end if;
 select id into area from monitor_areas where titular=p_titular and nicho=p_nicho and chave=k and ativo;
 if exists(select from monitor_areas where id=area and not ST_Equals(geom,g)) then
   update monitor_leituras set registros=null,reserva=null,lida_em=null,proxima=now() where area_id=area;
 end if;
 if area is null then
   limite:=cofre_limite(p_titular);
   if (select count(*) from monitor_areas where titular=p_titular and nicho=p_nicho and ativo)>=limite then
     raise exception using errcode='P9502',message='Você atingiu o limite de áreas do seu plano.';
   end if;
 end if;
 if coalesce(p_wa,false) and not coalesce((select permitido from conta_consentimentos where titular=p_titular and finalidade='whatsapp' order by id desc limit 1),false) then
   raise exception using errcode='P9503',message='Ative WhatsApp nas preferências de privacidade.';
 end if;
 insert into monitor_areas(titular,nicho,nome,chave,cofre_id,geom,whatsapp) values(p_titular,p_nicho,trim(p_nome),k,p_cofre,ST_Multi(g),coalesce(p_wa,false))
 on conflict(titular,nicho,chave) do update set nome=excluded.nome,geom=excluded.geom,whatsapp=excluded.whatsapp,ativo=true,aceite_em=now(),encerrado_em=null returning id into area;
 update monitor_leituras set ativa=false,reserva=null,registros=null where area_id=area and ativa and not fonte=any(p_fontes);
 insert into monitor_leituras(area_id,fonte) select distinct area,f from unnest(p_fontes) f
 on conflict(area_id,fonte) do update set ativa=true,proxima=now(),falhou=false,lida_em=null where not monitor_leituras.ativa;
 return area;
end $$;

create function public.monitor_desativar(p_titular uuid,p_nicho text,p_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update monitor_areas set ativo=false,encerrado_em=now() where titular=p_titular and nicho=p_nicho and id=p_id
   and exists(select from profiles where user_id=p_titular and ativo and nicho=p_nicho and entrada_ativa is distinct from 'anunciar');
 if not found then raise insufficient_privilege; end if;
 update monitor_leituras set ativa=false,reserva=null,registros=null where area_id=p_id;
end $$;

create function public.monitor_reservar()
returns table(area uuid,fonte text,token uuid,bbox double precision[]) language sql security definer set search_path=public,pg_temp as $$
 with escolhido as (
   select l.area_id,l.fonte,a.geom from monitor_leituras l join monitor_areas a on a.id=l.area_id
   where l.ativa and l.proxima<=now() and monitor_area_habilitada(a)
   order by l.proxima for update of l skip locked limit 1
 ), u as (
   update monitor_leituras l set reserva=gen_random_uuid(),tentativa_em=now(),proxima=now()+interval '10 minutes'
   from escolhido e where (l.area_id,l.fonte)=(e.area_id,e.fonte)
   returning l.area_id,l.fonte,l.reserva,e.geom
 ) select u.area_id,u.fonte,u.reserva,array[st_xmin(u.geom),st_ymin(u.geom),st_xmax(u.geom),st_ymax(u.geom)] from u
$$;

-- Um lote incompleto (NULL) nunca altera o último retrato verificado. Cada fonte inicia com leitura de referência.
create function public.monitor_apurar(p_area uuid,p_fonte text,p_token uuid,p_itens jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare a monitor_areas; l monitor_leituras; x record; item jsonb; anteriores jsonb; total int:=0;
begin
 select * into a from monitor_areas where id=p_area for share;
 select * into l from monitor_leituras where area_id=p_area and fonte=p_fonte for update;
 if not found or not a.ativo or not l.ativa or p_token is null or l.reserva is distinct from p_token
   or not monitor_area_habilitada(a) then return 0; end if;
 if p_itens is null then
   update monitor_leituras set falhou=true,reserva=null,proxima=now()+interval '3 hours' where area_id=p_area and fonte=p_fonte;
   return 0;
 end if;
 if jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)>4000 then raise invalid_parameter_value; end if;
 anteriores:=coalesce(l.registros,'{}');
 for x in
   with dados as (
     select v->>'id' as id,v->>'titulo' as titulo,v->'dados' as dados,
       ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(v->'geometry'),4326)) as geom from jsonb_array_elements(p_itens) v
   ) select distinct on(id) * from dados where id<>'' and titulo<>'' and ST_Intersects(a.geom,geom)
 loop
   item:=jsonb_build_object('dados',x.dados,'geometria',md5(ST_AsEWKB(ST_Normalize(x.geom))));
   if l.registros is not null and anteriores->x.id is distinct from item then
     insert into monitor_eventos(area_id,fonte,codigo,titulo,detalhes,anterior,local)
     values(p_area,p_fonte,x.id,x.titulo,x.dados,anteriores->x.id->'dados',ST_PointOnSurface(ST_Intersection(a.geom,x.geom)));
     total:=total+1;
   end if;
   anteriores:=jsonb_set(anteriores,array[x.id],item,true);
 end loop;
 update monitor_leituras set registros=anteriores,reserva=null,lida_em=now(),falhou=false,
 proxima=now()+make_interval(hours=>greatest(1,least(8760,coalesce(monitor_cota(a.titular,a.nicho,'monitoramento_horas'),24)))::int)
 where area_id=p_area and fonte=p_fonte;
 if total>0 and a.whatsapp then insert into monitor_avisos(area_id) values(p_area) on conflict(area_id,dia) do nothing; end if;
 return total;
end $$;
revoke all on function public.monitor_autorizado(uuid,text),public.monitor_geom_cofre(uuid,uuid),public.monitor_cota(uuid,text,text),public.monitor_area_habilitada(public.monitor_areas),public.monitor_configurar(uuid,text,text,uuid,jsonb,text[],boolean),
 public.monitor_desativar(uuid,text,uuid),public.monitor_reservar(),public.monitor_apurar(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.monitor_autorizado(uuid,text),public.monitor_configurar(uuid,text,text,uuid,jsonb,text[],boolean),
 public.monitor_desativar(uuid,text,uuid),public.monitor_reservar(),public.monitor_apurar(uuid,text,uuid,jsonb) to service_role;

create function public.monitor_painel(p_titular uuid,p_nicho text,p_pagina int)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with contexto as (select from profiles where user_id=p_titular and ativo and nicho=p_nicho
   and entrada_ativa is distinct from 'anunciar' and p_nicho in ('proprietario','produtor_rural')),
 minhas as (select a.* from monitor_areas a,contexto where a.titular=p_titular and a.nicho=p_nicho),
 historico as (
   select e.id,m.nome,e.fonte,e.titulo,e.codigo,e.detectado_em,e.detalhes,e.anterior,ST_X(e.local) as lon,ST_Y(e.local) as lat
   from monitor_eventos e join minhas m on m.id=e.area_id order by e.id desc limit 21 offset (least(100000,greatest(1,p_pagina))-1)*20
 )
 select jsonb_build_object('liberado',exists(select from contexto) and monitor_autorizado(p_titular,p_nicho),
 'cofres',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'nome',c.nome) order by c.nome) from cofre_propriedades c, contexto
    where c.titular_id=p_titular and monitor_geom_cofre(p_titular,c.id) is not null),'[]'),
 'areas',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'nome',m.nome,'ativo',m.ativo,'hectares',round((ST_Area(m.geom::geography)/10000)::numeric,2),
   'vinculo',m.cofre_id is null or coalesce(ST_Equals(m.geom,monitor_geom_cofre(m.titular,m.cofre_id)),false),
   'habilitada',monitor_area_habilitada(m::monitor_areas),
   'leituras',coalesce((select jsonb_agg(jsonb_build_object('fonte',l.fonte,'falhou',l.falhou,'lida_em',l.lida_em,'tentativa_em',l.tentativa_em) order by l.fonte)
     from monitor_leituras l where l.area_id=m.id and l.ativa),'[]')) order by m.ativo desc,m.nome) from minhas m),'[]'),
 'eventos',coalesce((select jsonb_agg(to_jsonb(historico) order by id desc) from historico),'[]'))
$$;
revoke all on function public.monitor_painel(uuid,text,int) from public,anon,authenticated;
grant execute on function public.monitor_painel(uuid,text,int) to service_role;

create function public.monitor_reservar_aviso() returns table(aviso uuid,telefone text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare n monitor_avisos; destino text;
begin
 update monitor_avisos set status='conferir' where status='enviando' and reserva_em < now()-interval '15 minutes';
 for n in select * from monitor_avisos where status='pendente' order by dia,id limit 25 for update skip locked loop
   select p.telefone into destino from monitor_areas a join profiles p on p.user_id=a.titular and p.ativo
   where a.id=n.area_id and a.whatsapp and monitor_area_habilitada(a) and n.dia>=current_date-1
     and coalesce((select permitido from conta_consentimentos where titular=a.titular and finalidade='whatsapp' order by id desc limit 1),false);
   if nullif(trim(destino),'') is null then update monitor_avisos set status='cancelado' where id=n.id;
   else
     update monitor_avisos set status='enviando',reserva_em=now() where id=n.id;
     aviso:=n.id; telefone:=destino; return next; return;
   end if;
 end loop;
end $$;
revoke all on function public.monitor_reservar_aviso() from public,anon,authenticated;
grant execute on function public.monitor_reservar_aviso() to service_role;

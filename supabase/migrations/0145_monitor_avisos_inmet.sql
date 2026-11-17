-- Alerta automático do INMET nas áreas monitoradas (item 19 do PDF do Carlos, 17/11/2026).
-- Nova fonte "inmet_avisos": o worker lê os avisos ativos do INMET, monta a área de cada aviso
-- pela malha dos municípios listados (geocodes) e o cruzamento com a área segue no PostGIS.
-- Diferente das outras fontes: lê de hora em hora e já avisa na primeira leitura.

do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid='public.monitor_leituras'::regclass and contype='c' and pg_get_constraintdef(oid) like '%fonte%'
  loop execute format('alter table public.monitor_leituras drop constraint %I', c.conname); end loop;
end $$;
alter table public.monitor_leituras add constraint monitor_leituras_fonte_check
  check (fonte in ('inpe_queimadas','ibama_embargos','prodes_cerrado','sigef','inmet_avisos'));

create or replace function public.monitor_configurar(p_titular uuid,p_nicho text,p_nome text,p_cofre uuid,p_geo jsonb,p_fontes text[],p_wa boolean)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare g geometry; k text; area uuid; limite int; a record;
begin
 select * into a from profiles where user_id=p_titular and ativo and nicho=p_nicho and entrada_ativa is distinct from 'anunciar' for update;
 if not found or not monitor_autorizado(p_titular,p_nicho) then raise insufficient_privilege; end if;
 if num_nonnulls(p_geo,p_cofre)<>1 or nullif(trim(p_nome),'') is null or length(p_nome)>160
    or p_fontes is null or cardinality(p_fontes) not between 1 and 5 or array_position(p_fontes,null) is not null
    or not p_fontes <@ array['inpe_queimadas','ibama_embargos','prodes_cerrado','sigef','inmet_avisos'] then raise invalid_parameter_value; end if;
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

create or replace function public.monitor_apurar(p_area uuid,p_fonte text,p_token uuid,p_itens jsonb)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare a monitor_areas; l monitor_leituras; x record; item jsonb; anteriores jsonb; atuais jsonb:='{}'; total int:=0;
begin
 select * into a from monitor_areas where id=p_area for share;
 select * into l from monitor_leituras where area_id=p_area and fonte=p_fonte for update;
 if not found or not a.ativo or not l.ativa or p_token is null or l.reserva is distinct from p_token
   or not monitor_area_habilitada(a) then return 0; end if;
 if p_itens is null then
   update monitor_leituras set falhou=true,reserva=null,
   proxima=now()+case when p_fonte='inmet_avisos' then interval '30 minutes' else interval '3 hours' end where area_id=p_area and fonte=p_fonte;
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
   -- Aviso do INMET vale já na primeira leitura: um alerta ativo no dia da ativação interessa ao titular.
   if (l.registros is not null or p_fonte='inmet_avisos') and anteriores->x.id is distinct from item then
     insert into monitor_eventos(area_id,fonte,codigo,titulo,detalhes,anterior,local)
     values(p_area,p_fonte,x.id,x.titulo,x.dados,anteriores->x.id->'dados',ST_PointOnSurface(ST_Intersection(a.geom,x.geom)));
     total:=total+1;
   end if;
   anteriores:=jsonb_set(anteriores,array[x.id],item,true);
   atuais:=jsonb_set(atuais,array[x.id],item,true);
 end loop;
 -- Avisos do INMET expiram: o retrato guarda só os ativos, para não crescer sem fim.
 update monitor_leituras set registros=case when p_fonte='inmet_avisos' then atuais else anteriores end,reserva=null,lida_em=now(),falhou=false,
 proxima=now()+case when p_fonte='inmet_avisos' then interval '1 hour'
   else make_interval(hours=>greatest(1,least(8760,coalesce(monitor_cota(a.titular,a.nicho,'monitoramento_horas'),24)))::int) end
 where area_id=p_area and fonte=p_fonte;
 if total>0 and a.whatsapp then insert into monitor_avisos(area_id) values(p_area) on conflict(area_id,dia) do nothing; end if;
 return total;
end $$;

-- O worker monta a área de cada aviso pela malha municipal. Só leitura, só service_role.
create or replace function public.monitor_malha_municipios(p_codigos int[], p_bbox double precision[])
returns table(cod_ibge int, geojson text) language sql stable security definer set search_path=public,pg_temp as $$
 select m.cod_ibge, ST_AsGeoJSON(m.geom, 6)
 from ibge_municipios m
 where m.cod_ibge = any(p_codigos) and m.geom is not null
   and m.geom && ST_MakeEnvelope(p_bbox[1], p_bbox[2], p_bbox[3], p_bbox[4], 4326)
$$;
revoke all on function public.monitor_malha_municipios(int[], double precision[]) from public, anon, authenticated;
grant execute on function public.monitor_malha_municipios(int[], double precision[]) to service_role;

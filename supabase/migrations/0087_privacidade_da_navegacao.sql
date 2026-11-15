create table public.conta_consentimentos (
  id bigint generated always as identity primary key,
  titular uuid not null references public.profiles(user_id) on delete cascade,
  finalidade text not null check(finalidade in ('rastro','historico_ari','whatsapp')),
  permitido boolean not null,
  versao text not null, registrado_em timestamptz not null default now(),
  ip inet
);
create index conta_consentimentos_atual on public.conta_consentimentos(titular,finalidade,id desc);
alter table public.conta_consentimentos enable row level security;
revoke all on public.conta_consentimentos from public,anon,authenticated;
grant select,insert on public.conta_consentimentos to service_role;
grant usage,select on sequence public.conta_consentimentos_id_seq to service_role;
alter table public.ia_conversas add column nicho text;
update public.ia_conversas c set nicho=p.nicho from public.profiles p where p.user_id=c.user_id;

-- As consultas detalhadas da ficha são intermediadas pela aplicação, que confere o anúncio e a sessão.
revoke execute on function public.fn_property_public(text),public.fn_property_tour(text),public.fn_consulta_rural(uuid) from public,anon,authenticated;
grant execute on function public.fn_property_public(text),public.fn_property_tour(text),public.fn_consulta_rural(uuid) to service_role;

create or replace function public.fn_properties_geojson()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_build_object(
    'type','FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type','Feature',
        'geometry', st_asgeojson(g.geom, 6)::jsonb,
        'properties', jsonb_build_object(
          'id', p.id, 'codigo', p.codigo, 'titulo', p.titulo, 'tipo', p.tipo,
          'status', p.status, 'valor', p.valor, 'modalidade', p.modalidade,
          -- a cor no mapa: leilão tem cor própria enquanto está disponível
          'cor', case when p.modalidade = 'leilao' and p.status = 'publicado' then 'leilao' else p.status::text end,
          'area_m2', g.area_m2,
          'lng', st_x(g.centroid), 'lat', st_y(g.centroid),
          'municipio', (select m.nome from municipalities m where m.id = p.municipality_id),
          'capa', (select md.storage_path from property_media md
                   where md.property_id = p.id and md.tipo = 'foto'
                   order by md.capa desc, md.ordem limit 1)
        )
      )), '[]'::jsonb)
  ), '{"type":"FeatureCollection","features":[]}'::jsonb)
  from properties p
  join property_geometries g on g.property_id = p.id
  where p.status in ('publicado','em_negociacao')
$$;

alter table public.ia_conversas add column historico_visivel boolean not null default true;
alter table public.ia_conversas alter column historico_visivel set default false;
create function public.ia_filtrar_conteudo() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.ia_conversas c where c.id=new.conversa_id and c.historico_visivel)
    or not coalesce((select permitido from public.conta_consentimentos where titular=new.user_id and finalidade='historico_ari' order by id desc limit 1),false) then
    new.conteudo:=''; new.ferramentas:='[]'::jsonb;
  end if;
  return new;
end $$;
create trigger trg_ia_conteudo before insert on public.ia_mensagens for each row execute function public.ia_filtrar_conteudo();
revoke all on function public.ia_filtrar_conteudo() from public,anon,authenticated;
create function public.ia_apagar_historico(p_titular uuid,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.ia_conversas c set titulo=null,historico_visivel=false from public.profiles p where p.user_id=p_titular and p.ativo
    and c.user_id=p_titular and c.id=p_id and c.nicho is not distinct from p.nicho;
  if not found then return false; end if;
  update public.ia_mensagens set conteudo='',ferramentas='[]'::jsonb where conversa_id=p_id;
  return true;
end $$;
revoke all on function public.ia_apagar_historico(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ia_apagar_historico(uuid,uuid) to service_role;

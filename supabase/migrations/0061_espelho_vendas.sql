-- Arini Imóveis Brasil — migration 0061: espelho de vendas do loteamento (segunda etapa, item 10).
--
-- O empreendimento (0009/0053) é um imóvel "pai" com uma unidade por lote. O
-- espelho guarda a situação COMERCIAL de cada unidade — disponível, reservado
-- (com prazo) ou vendido —, separada do status do anúncio (properties.status),
-- que segue a máquina de estados da Matriz e não volta de "vendido". Sem linha
-- aqui = disponível.
--
-- Toda mudança vira um evento (quem mudou e quando). Reserva vencida volta a
-- disponível na leitura (src/lib/empreendimento/espelho.ts) e também por
-- fn_espelho_liberar_vencidas(), que o worker pode chamar se quiser.
-- Escrita só pelo servidor (/api/empreendimentos/[id]/espelho).
-- Aditiva: só cria o que ainda não existe.

create table if not exists property_espelho (
  property_id uuid primary key references properties(id) on delete cascade,
  empreendimento_id uuid not null references properties(id) on delete cascade,
  status text not null default 'disponivel' check (status in ('disponivel', 'reservado', 'vendido')),
  reserva_ate timestamptz,
  cliente_nome text check (cliente_nome is null or length(cliente_nome) <= 160),
  opportunity_id uuid references opportunities(id) on delete set null,
  valor_venda numeric(14,2) check (valor_venda is null or valor_venda >= 0),
  observacao text check (observacao is null or length(observacao) <= 1000),
  alterado_por uuid references profiles(user_id) on delete set null,
  alterado_em timestamptz not null default now(),
  constraint chk_espelho_reserva check (status <> 'reservado' or reserva_ate is not null)
);
create index if not exists idx_espelho_empreendimento on property_espelho (empreendimento_id, status);
create index if not exists idx_espelho_reserva on property_espelho (reserva_ate) where status = 'reservado';

create table if not exists property_espelho_eventos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  empreendimento_id uuid not null references properties(id) on delete cascade,
  de text,
  para text not null check (para in ('disponivel', 'reservado', 'vendido')),
  reserva_ate timestamptz,
  cliente_nome text,
  opportunity_id uuid references opportunities(id) on delete set null,
  motivo text,
  autor uuid references profiles(user_id) on delete set null,  -- null = sistema (reserva vencida)
  created_at timestamptz not null default now()
);
create index if not exists idx_espelho_eventos_unidade on property_espelho_eventos (property_id, created_at desc);
create index if not exists idx_espelho_eventos_emp on property_espelho_eventos (empreendimento_id, created_at desc);

alter table property_espelho enable row level security;
alter table property_espelho_eventos enable row level security;
-- leitura: dono/parceiro do imóvel e a equipe (mesma regra da edição do imóvel);
-- gravação só pelo servidor (service role). A versão pública não lê estas
-- tabelas: o servidor reduz a disponível/indisponível, sem nome de cliente.
drop policy if exists p_espelho_leitura on property_espelho;
create policy p_espelho_leitura on property_espelho for select using (fn_property_editable_id(property_id));
drop policy if exists p_espelho_eventos_leitura on property_espelho_eventos;
create policy p_espelho_eventos_leitura on property_espelho_eventos for select using (fn_property_editable_id(property_id));

/** Divisas das unidades de um empreendimento, numa FeatureCollection (só o servidor). */
create or replace function fn_espelho_geometrias(p_empreendimento_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
    'type', 'Feature',
    'geometry', st_asgeojson(g.geom, 7)::json,
    'properties', json_build_object('id', p.id)
  )), '[]'::json))
  from properties p join property_geometries g on g.property_id = p.id
  where p.parent_property_id = p_empreendimento_id
$$;
revoke execute on function fn_espelho_geometrias(uuid) from public, anon, authenticated;
grant execute on function fn_espelho_geometrias(uuid) to service_role;

/** Reservas vencidas voltam a disponível, com evento de sistema. Devolve quantas. */
create or replace function fn_espelho_liberar_vencidas(p_empreendimento_id uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with vencidas as (
    update property_espelho e set status = 'disponivel', reserva_ate = null, cliente_nome = null,
      opportunity_id = null, alterado_por = null, alterado_em = now()
    where e.status = 'reservado' and e.reserva_ate < now()
      and (p_empreendimento_id is null or e.empreendimento_id = p_empreendimento_id)
    returning e.property_id, e.empreendimento_id
  ), ev as (
    insert into property_espelho_eventos (property_id, empreendimento_id, de, para, motivo)
    select property_id, empreendimento_id, 'reservado', 'disponivel', 'Reserva vencida' from vencidas
    returning 1
  )
  select count(*) into n from ev;
  return n;
end $$;
revoke execute on function fn_espelho_liberar_vencidas(uuid) from public, anon, authenticated;
grant execute on function fn_espelho_liberar_vencidas(uuid) to service_role;

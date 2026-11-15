-- O pacote avulso tem preço na vitrine e composição configurável na Diretoria.
insert into public.settings (chave,valor) values
  ('ari_pacote_comprados','500'),('ari_pacote_cortesia','500'),('ari_validade_meses','12'),
  ('ari_custo_chat','1'),('ari_custo_imagem','1'),('ari_custo_matricula','10'),
  ('ari_custo_cadastro','10'),('ari_limite_creditos_dia','200')
on conflict (chave) do nothing;
update public.plans pl set cotas=pl.cotas||jsonb_build_object('creditos_ari_mes',q.creditos)
from (values ('produtor_essencial',100),('produtor_profissional',300),('produtor_premium',800),
  ('proprietario_inteligencia',300),('proprietario_completo',500),
  ('tecnico_essencial',100),('tecnico_profissional',300),('tecnico_premium',1000)) q(id,creditos)
where pl.id=q.id and not (pl.cotas ? 'creditos_ari_mes');

create table public.ari_compras (
  id uuid primary key default gen_random_uuid(),
  titular uuid not null references public.profiles(user_id) on delete cascade,
  nicho text not null,
  chave uuid not null,
  preco integer not null check(preco>0),
  comprados integer not null check(comprados>0),
  cortesia integer not null check(cortesia>=0),
  validade_meses integer not null check(validade_meses>0),
  status text not null default 'nova' check(status in ('nova','emitindo','aberta','paga','estornada','cancelada')),
  cliente text,
  pagamento text unique,
  link text,
  criado_em timestamptz not null default now(),
  unique(titular,chave)
);
create unique index ari_compra_em_aberto on public.ari_compras(titular,nicho) where status in ('nova','emitindo','aberta');
create table public.ari_lotes (
  id uuid primary key default gen_random_uuid(),
  titular uuid references public.profiles(user_id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  nicho text not null,
  carteira text not null check(carteira in ('plano','compra','cortesia')),
  origem text not null unique,
  compra uuid references public.ari_compras(id) on delete cascade,
  concedidos integer not null check(concedidos>=0),
  saldo integer not null check(saldo>=0 and saldo<=concedidos),
  validade timestamptz not null,
  bloqueado boolean not null default false,
  check(num_nonnulls(titular,org_id)=1)
);
create index ari_lotes_titular on public.ari_lotes(titular,nicho,validade) where saldo>0 and not bloqueado;
create index ari_lotes_org on public.ari_lotes(org_id,validade) where saldo>0 and not bloqueado;
create table public.ari_uso (
  id uuid primary key,
  titular uuid not null references public.profiles(user_id) on delete cascade,
  nicho text not null,
  operacao text not null,
  custo integer not null check(custo>0),
  modelo text not null,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz,
  estornado_em timestamptz
);
create index ari_uso_diario on public.ari_uso(titular,criado_em);
create table public.ari_movimentos (
  uso uuid not null references public.ari_uso(id) on delete cascade,
  lote uuid not null references public.ari_lotes(id) on delete cascade,
  quantidade integer not null check(quantidade>0),
  primary key(uso,lote)
);
alter table public.ari_compras enable row level security;
alter table public.ari_lotes enable row level security;
alter table public.ari_uso enable row level security;
alter table public.ari_movimentos enable row level security;
revoke all on public.ari_compras,public.ari_lotes,public.ari_uso,public.ari_movimentos from public,anon,authenticated;
grant select,update,insert on public.ari_compras to service_role;
grant select on public.ari_lotes,public.ari_uso,public.ari_movimentos to service_role;

create function public.fn_ari_param(ch text) returns integer language sql stable set search_path='' as $$
  select (valor #>> '{}')::integer from public.settings where chave=ch
$$;

-- Uma franquia por mês civil em São Paulo. Equipes compartilham o mesmo lote
-- da organização. A troca de plano não reinicia o consumo da competência.
create function public.fn_ari_saldo(p_titular uuid,p_nicho text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  conta public.profiles%rowtype; pid text; org uuid; franquia int:=0; alvo text;
  inicio timestamp:=date_trunc('month',now() at time zone 'America/Sao_Paulo');
  fim timestamptz:=(inicio+interval '1 month') at time zone 'America/Sao_Paulo';
  chave text; mensal int:=0; comprado bigint:=0; bonus bigint:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_titular::text,89));
  -- Recupera a reserva se o processo morreu antes de entregar a operação.
  perform public.fn_ari_estornar(p_titular,id) from public.ari_uso where titular=p_titular
    and concluido_em is null and estornado_em is null and criado_em < now()-interval '10 minutes';
  select * into strict conta from public.profiles where user_id=p_titular and ativo for share;
  if coalesce(conta.nicho,'')<>p_nicho then raise exception using errcode='42501',message='Perfil ativo mudou.'; end if;
  if coalesce(conta.plan_origem,'padrao')='padrao' then
    select o.id,pl.id into org,pid from public.organization_members m join public.organizations o on o.id=m.org_id and o.ativo
      join public.plans pl on pl.id=o.plan_id and pl.ativo and pl.escopo='organizacao'
      where m.user_id=p_titular and m.status='ativo' and m.nicho_vinculo is not distinct from p_nicho and (o.plan_valido_ate is null or o.plan_valido_ate>now());
  end if;
  if pid is null and (conta.plan_valido_ate is null or conta.plan_valido_ate>now()) then pid:=conta.plan_id; end if;
  select greatest(0,coalesce((cotas->>'creditos_ari_mes')::integer,case when preco_mensal>0 then (cotas->>'mensagens_ia_mes')::integer end,0)) into franquia from public.plans where id=pid and ativo;
  alvo:=case when org is null then 'conta:'||p_titular||':'||p_nicho else 'org:'||org end;
  chave:=alvo||':'||to_char(inicio,'YYYY-MM');
  if coalesce(franquia,0)>0 then
    insert into public.ari_lotes(titular,org_id,nicho,carteira,origem,concedidos,saldo,validade)
      values(case when org is null then p_titular end,org,case when org is null then p_nicho else '' end,'plano',chave,franquia,franquia,fim)
      on conflict(origem) do nothing;
    -- Atualiza o teto efetivo sem devolver o que já se gastou.
    update public.ari_lotes set saldo=saldo+(franquia-concedidos),concedidos=franquia where origem=chave and concedidos<franquia
      returning greatest(0,saldo) into mensal;
    if not found then select greatest(0,franquia-(concedidos-saldo)) into mensal from public.ari_lotes where origem=chave; end if;
  end if;
  select coalesce(sum(saldo) filter(where carteira='compra'),0),coalesce(sum(saldo) filter(where carteira='cortesia'),0)
    into comprado,bonus from public.ari_lotes where titular=p_titular and nicho=p_nicho and not bloqueado and validade>now();
  return jsonb_build_object('plano',mensal,'comprados',comprado,'cortesia',bonus,'total',mensal+comprado+bonus,'lotePlano',chave);
end $$;

-- Saldo e débito são transacionais. Uma compra é usada apenas após o lote da
-- franquia e, entre compradas/cortesias, na ordem de vencimento.
create function public.fn_ari_debitar(p_titular uuid,p_nicho text,p_id uuid,p_operacao text,p_modelo text) returns integer
language plpgsql security definer set search_path='' as $$
declare
  custo int; teto int; dia timestamptz:=date_trunc('day',now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  estado jsonb; falta int; parte int; l record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_titular::text,89));
  if exists(select from public.ari_uso where id=p_id) then raise exception using errcode='23505',message='Esta chamada já foi processada.'; end if;
  if p_operacao not in ('chat','imagem','matricula','cadastro') then raise exception using errcode='22023',message='Operação inválida.'; end if;
  custo:=public.fn_ari_param('ari_custo_'||p_operacao); teto:=public.fn_ari_param('ari_limite_creditos_dia');
  if custo is null or custo<1 or teto is null then raise exception using errcode='22023',message='Custo não configurado.'; end if;
  if (select coalesce(sum(custo_uso.custo),0) from public.ari_uso custo_uso where titular=p_titular and criado_em>=dia and estornado_em is null)+custo>teto then
    raise exception using errcode='P8902',message='Limite diário atingido.';
  end if;
  estado:=public.fn_ari_saldo(p_titular,p_nicho);
  -- Compartilhamento entre usuários: o lock do lote mensal precede a releitura do saldo.
  perform 1 from public.ari_lotes where origem=estado->>'lotePlano' for update;
  estado:=public.fn_ari_saldo(p_titular,p_nicho);
  if (estado->>'total')::bigint < custo then raise exception using errcode='P8901',message='Créditos insuficientes.'; end if;
  insert into public.ari_uso(id,titular,nicho,operacao,custo,modelo) values(p_id,p_titular,p_nicho,p_operacao,custo,p_modelo);
  falta:=custo;
  for l in select id,carteira,saldo from public.ari_lotes where not bloqueado and validade>now() and saldo>0 and
    (origem=estado->>'lotePlano' or (carteira<>'plano' and titular=p_titular and nicho=p_nicho))
    order by (carteira='plano') desc,validade,id for update loop
    parte:=least(falta, l.saldo, case when l.carteira='plano' then (estado->>'plano')::int else l.saldo end);
    if parte>0 then
      update public.ari_lotes set saldo=saldo-parte where id=l.id;
      insert into public.ari_movimentos values(p_id,l.id,parte);
      falta:=falta-parte;
    end if;
    exit when falta=0;
  end loop;
  if falta<>0 then raise exception using errcode='P8901',message='Créditos insuficientes.'; end if;
  return least(2147483647,(estado->>'total')::bigint-custo)::integer;
end $$;

create function public.fn_ari_estornar(p_titular uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_titular::text,89));
  update public.ari_uso set estornado_em=now() where titular=p_titular and id=p_id and estornado_em is null and concluido_em is null;
  if found then
    update public.ari_lotes l set saldo=l.saldo+m.quantidade from public.ari_movimentos m where m.uso=p_id and m.lote=l.id;
  end if;
end $$;

create function public.fn_ari_concluir(p_titular uuid,p_id uuid) returns void
language sql security definer set search_path='' as $$
  update public.ari_uso set concluido_em=now() where titular=p_titular and id=p_id and estornado_em is null and concluido_em is null
$$;

create function public.fn_ari_pedido(p_titular uuid,p_chave uuid,p_preco integer,p_comprados integer,p_cortesia integer,p_meses integer)
returns public.ari_compras language plpgsql security definer set search_path='' as $$
declare compra public.ari_compras; oferta public.ofertas_perfis; n text; qtd int; bonus int; meses int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_titular::text,89));
  select coalesce(nicho,'') into strict n from public.profiles where user_id=p_titular and ativo for share;
  if n<>'comprador_investidor' then raise exception using errcode='42501',message='Pacote para o perfil comprador.'; end if;
  select * into compra from public.ari_compras where titular=p_titular and chave=p_chave;
  if found then if compra.nicho<>n then raise exception using errcode='42501',message='Perfil da compra diferente.'; end if; return compra; end if;
  select * into strict oferta from public.ofertas_perfis where id='comprar_creditos' and ativo and preco_centavos>0;
  qtd:=public.fn_ari_param('ari_pacote_comprados'); bonus:=public.fn_ari_param('ari_pacote_cortesia'); meses:=public.fn_ari_param('ari_validade_meses');
  if row(p_preco,p_comprados,p_cortesia,p_meses) is distinct from row(oferta.preco_centavos,qtd,bonus,meses) then
    raise exception using errcode='40001',message='Oferta atualizada. Confira antes de comprar.';
  end if;
  select * into compra from public.ari_compras where titular=p_titular and nicho=n and status in ('nova','emitindo','aberta');
  if found then return compra; end if;
  insert into public.ari_compras(titular,nicho,chave,preco,comprados,cortesia,validade_meses)
    values(p_titular,n,p_chave,p_preco,qtd,bonus,meses) returning * into compra;
  return compra;
end $$;

create function public.fn_ari_pagamento(p_id uuid,p_evento text,p_pagamento text,p_cliente text,p_valor integer)
returns void language plpgsql security definer set search_path='' as $$
declare pedido public.ari_compras; l record;
begin
  select * into strict pedido from public.ari_compras where id=p_id;
  perform pg_advisory_xact_lock(hashtextextended(pedido.titular::text,89));
  select * into strict pedido from public.ari_compras where id=p_id for update;
  if pedido.cliente is null or pedido.cliente is distinct from p_cliente or pedido.preco is distinct from p_valor or
    (pedido.pagamento is not null and pedido.pagamento<>p_pagamento) then raise exception using errcode='22023',message='Pagamento divergente.'; end if;
  if p_evento in ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') and pedido.status in ('emitindo','aberta') then
    update public.ari_compras set status='paga',pagamento=p_pagamento where id=p_id;
    for l in select * from (values ('compra',pedido.comprados),('cortesia',pedido.cortesia)) v(carteira,quantidade) where quantidade>0 loop
      insert into public.ari_lotes(titular,nicho,carteira,origem,compra,concedidos,saldo,validade)
        values(pedido.titular,pedido.nicho,l.carteira,p_id::text||':'||l.carteira,p_id,l.quantidade,l.quantidade,now()+make_interval(months=>pedido.validade_meses));
    end loop;
  elsif p_evento in ('PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_RECEIVED_IN_CASH_UNDONE','PAYMENT_PARTIALLY_REFUNDED') then
    update public.ari_compras set status='estornada',pagamento=p_pagamento where id=p_id;
    update public.ari_lotes set bloqueado=true where compra=p_id;
  elsif p_evento='PAYMENT_DELETED' and pedido.status in ('aberta','emitindo') then
    update public.ari_compras set status='cancelada',pagamento=p_pagamento where id=p_id;
  end if;
end $$;

revoke all on function public.fn_ari_param(text), public.fn_ari_saldo(uuid,text),public.fn_ari_debitar(uuid,text,uuid,text,text),
  public.fn_ari_estornar(uuid,uuid),public.fn_ari_concluir(uuid,uuid),public.fn_ari_pedido(uuid,uuid,integer,integer,integer,integer),
  public.fn_ari_pagamento(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.fn_ari_saldo(uuid,text),public.fn_ari_debitar(uuid,text,uuid,text,text),
  public.fn_ari_estornar(uuid,uuid),public.fn_ari_concluir(uuid,uuid),public.fn_ari_pedido(uuid,uuid,integer,integer,integer,integer),
  public.fn_ari_pagamento(uuid,text,text,text,integer) to service_role;

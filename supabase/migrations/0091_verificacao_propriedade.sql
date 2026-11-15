create table public.propriedade_claims (
  id uuid primary key default gen_random_uuid(),
  titular_id uuid not null references public.profiles(user_id) on delete cascade,
  cofre_id uuid unique references public.cofre_propriedades(id) on delete cascade,
  anuncio_id uuid unique references public.properties(id) on delete cascade,
  referencia_imovel uuid references public.properties(id) on delete set null,
  chaves text[] not null,
  estado text not null default 'RASCUNHO' check (estado in ('RASCUNHO','EM_ANALISE','PENDENCIA','EM_DISPUTA','APROVADA','REPROVADA')),
  vinculo text not null default 'proprietario' check (vinculo in ('proprietario','coproprietario','herdeiro','procurador','arrendatario','representante')),
  motivo text, prova_path text, prova_nome text, prova_sha256 text,
  revisao integer not null default 1, atualizado_em timestamptz not null default now(),
  check (num_nonnulls(cofre_id,anuncio_id)=1)
);
create index prop_claim_chaves on public.propriedade_claims using gin(chaves);
create index prop_claim_titular on public.propriedade_claims(titular_id,estado);
alter table public.propriedade_claims enable row level security;
revoke all on public.propriedade_claims from public,anon,authenticated;
grant select,insert,update,delete on public.propriedade_claims to service_role;

create function public.claim_chaves(p_car text,p_matricula text,p_municipio text,p_anuncio uuid,p_lote uuid)
returns text[] language sql immutable set search_path=public,pg_temp as $$
  select array_remove(array[
    case when length(trim(p_car))>4 then 'car:'||regexp_replace(upper(p_car),'[^A-Z0-9]','','g') end,
    case when trim(p_matricula)<>'' and trim(p_municipio)<>'' then 'mat:'||regexp_replace(lower(trim(p_municipio)),'[^[:alnum:]]','','g')||':'||regexp_replace(upper(trim(p_matricula)),'[^[:alnum:]]','','g') end,
    'imovel:'||p_anuncio::text,'lote:'||p_lote::text],null)
$$;
create function public.claim_chaves_anuncio(p_id uuid) returns text[] language sql stable set search_path=public,pg_temp as $$
  select public.claim_chaves(p.car_codigo,m.numero,mu.nome||'/'||mu.uf,p.id,p.lote_id)
    || array_remove(array[case when g.geom is not null then 'geom:'||md5(ST_AsEWKB(ST_Normalize(ST_SnapToGrid(ST_Force2D(g.geom),0.000001)))::text) end],null)
  from public.properties p left join public.property_matriculas m on m.property_id=p.id left join public.municipalities mu on mu.id=p.municipality_id
    left join public.property_geometries g on g.property_id=p.id where p.id=p_id
$$;

-- O cadastro particular anterior não equivale a prova aprovada. O anúncio que já
-- atravessou a aprovação operacional preserva a decisão histórica da Central.
insert into public.propriedade_claims(titular_id,cofre_id,chaves)
select titular_id,id,public.claim_chaves(car,matricula,municipio,null,null) from public.cofre_propriedades;
insert into public.propriedade_claims(titular_id,anuncio_id,chaves,estado)
select o.profile_id,p.id,public.claim_chaves_anuncio(p.id),
 case when p.status in ('aprovado','publicado','em_negociacao','vendido','historico') then 'APROVADA' else 'EM_ANALISE' end
from public.properties p join public.owners o on o.id=p.owner_id where o.profile_id is not null and p.status not in ('rascunho','inativo','reprovado');

update public.propriedade_claims c set estado='EM_DISPUTA',revisao=revisao+1
where c.estado in ('EM_ANALISE','APROVADA') and exists(select from public.propriedade_claims outra
  where outra.titular_id<>c.titular_id and outra.chaves && c.chaves and outra.estado in ('EM_ANALISE','APROVADA'));

-- Apenas solicitações efetivamente protocoladas participam da disputa.
create function public.claim_conferir_concorrentes(p_id uuid) returns void language plpgsql set search_path=public,pg_temp as $$
declare c public.propriedade_claims%rowtype;
begin
  select * into strict c from public.propriedade_claims where id=p_id;
  if exists(select from public.propriedade_claims x where x.titular_id<>c.titular_id and x.chaves && c.chaves
            and x.estado in ('EM_ANALISE','APROVADA','PENDENCIA','EM_DISPUTA')) then
    update public.propriedade_claims set estado='EM_DISPUTA',motivo=null,revisao=revisao+1,atualizado_em=now()
      where chaves && c.chaves and estado in ('EM_ANALISE','APROVADA','PENDENCIA');
  end if;
end $$;

create function public.claim_preparar_cofre() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare ch text[];
begin
  ch:=public.claim_chaves(new.car,new.matricula,new.municipio,null,null);
  if tg_op='INSERT' then
    insert into public.propriedade_claims(titular_id,cofre_id,chaves) values(new.titular_id,new.id,ch);
  elsif (new.car,new.matricula,new.municipio) is distinct from (old.car,old.matricula,old.municipio) then
    perform pg_advisory_xact_lock(515401,91);
    update public.propriedade_claims set chaves=ch,referencia_imovel=null,estado='RASCUNHO',motivo=null,
      prova_path=null,prova_nome=null,prova_sha256=null,revisao=revisao+1,atualizado_em=now() where cofre_id=new.id;
  end if;
  return new;
end $$;
create trigger trg_cofre_claim after insert or update of car,matricula,municipio on public.cofre_propriedades for each row execute function public.claim_preparar_cofre();

create function public.claim_validar_anexo_cofre() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from public.propriedade_claims where cofre_id=new.propriedade_id and titular_id=new.titular_id and estado='APROVADA' for share;
  if not found then raise exception 'Vínculo não aprovado.'; end if;
  return new;
end $$;
create trigger trg_claim_anexo_cofre before insert on public.cofre_documentos for each row execute function public.claim_validar_anexo_cofre();

create function public.claim_submeter(p_cofre uuid,p_titular uuid,p_vinculo text,p_codigo text,p_path text,p_nome text,p_hash text)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare c public.propriedade_claims%rowtype; f public.cofre_propriedades%rowtype; im uuid; ch text[];
begin
  perform pg_advisory_xact_lock(515401,91);
  select * into strict c from public.propriedade_claims where cofre_id=p_cofre and titular_id=p_titular for update;
  if c.prova_path=p_path then return c.id; end if;
  if c.estado not in ('RASCUNHO','PENDENCIA','REPROVADA') then raise exception 'Esta solicitação já foi enviada.'; end if;
  if p_path is null or p_nome is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Comprovante inválido.'; end if;
  select * into strict f from public.cofre_propriedades where id=p_cofre;
  if p_codigo is not null then
    select id into im from public.properties where codigo=p_codigo and status in ('publicado','em_negociacao');
    if im is null then raise exception 'Anúncio não encontrado.'; end if;
  end if;
  ch:=public.claim_chaves(f.car,f.matricula,f.municipio,null,null)||coalesce(public.claim_chaves_anuncio(im),'{}'::text[]);
  update public.propriedade_claims set estado='EM_ANALISE',vinculo=p_vinculo,chaves=ch,referencia_imovel=im,prova_path=p_path,prova_nome=p_nome,
    prova_sha256=p_hash,motivo=null,atualizado_em=now(),revisao=revisao+1 where id=c.id;
  perform public.claim_conferir_concorrentes(c.id);
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_titular,'claim_criada','propriedade_claims',c.id,jsonb_build_object('sha256',p_hash));
  return c.id;
end $$;

create function public.claim_anuncio_transicao() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare titular uuid; c uuid;
begin
  if new.owner_id is null or new.status=old.status then return new; end if;
  if new.status='pendente' then
    perform pg_advisory_xact_lock(515401,91);
    select profile_id into titular from public.owners where id=new.owner_id;
    insert into public.propriedade_claims(titular_id,anuncio_id,chaves,estado)
      values(titular,new.id,public.claim_chaves_anuncio(new.id),'EM_ANALISE')
      on conflict(anuncio_id) do update set
        chaves=excluded.chaves,estado=case when propriedade_claims.estado='APROVADA' and propriedade_claims.chaves=excluded.chaves then 'APROVADA' else 'EM_ANALISE' end,
        revisao=propriedade_claims.revisao+1,atualizado_em=now() returning id into c;
    perform public.claim_conferir_concorrentes(c);
  elsif new.status in ('aprovado','publicado') and not exists(select from public.propriedade_claims where anuncio_id=new.id and estado='APROVADA') then
    raise exception 'A Central precisa aprovar a verificação de propriedade antes de liberar o anúncio.';
  end if;
  return new;
end $$;
create trigger trg_claim_anuncio before update of status on public.properties for each row execute function public.claim_anuncio_transicao();

create function public.claim_decidir(p_id uuid,p_revisao int,p_estado text,p_motivo text,p_ator uuid)
returns void language plpgsql set search_path=public,pg_temp as $$
declare c public.propriedade_claims%rowtype; x record;
begin
  perform pg_advisory_xact_lock(515401,91);
  select * into strict c from public.propriedade_claims where id=p_id for update;
  if c.revisao<>p_revisao or c.estado not in ('EM_ANALISE','PENDENCIA','EM_DISPUTA','APROVADA') or p_estado not in ('APROVADA','PENDENCIA','REPROVADA')
    or p_motivo is null or length(trim(p_motivo)) not between 3 and 600 then raise exception 'Atualize a fila e informe o motivo da decisão.'; end if;
  if p_estado='APROVADA' and c.anuncio_id is not null and not exists(select from public.property_documents d where d.property_id=c.anuncio_id) then
    raise exception 'Aguarde o envio do comprovante pelo anunciante.'; end if;
  if p_estado='APROVADA' then
    for x in update public.propriedade_claims set estado='REPROVADA',motivo='O vínculo informado não foi confirmado. A Central pode orientar sobre os comprovantes.',
      revisao=revisao+1,atualizado_em=now() where titular_id<>c.titular_id and chaves && c.chaves and estado in ('APROVADA','EM_ANALISE','PENDENCIA','EM_DISPUTA') returning * loop
      insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_depois) values(p_ator,'claim_decidida','propriedade_claims',x.id,jsonb_build_object('estado','REPROVADA','resolucao',p_id));
      perform public.fn_notificar(x.titular_id,'info','Verificação de propriedade atualizada',x.motivo,'/painel/cofre',null);
    end loop;
  end if;
  update public.propriedade_claims set estado=p_estado,motivo=trim(p_motivo),revisao=revisao+1,atualizado_em=now() where id=c.id;
  insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois) values(p_ator,'claim_decidida','propriedade_claims',c.id,
    jsonb_build_object('estado',c.estado),jsonb_build_object('estado',p_estado,'motivo',p_motivo));
  perform public.fn_notificar(c.titular_id,'info','Verificação de propriedade atualizada',p_motivo,case when c.anuncio_id is null then '/painel/cofre' else '/painel/imoveis/'||c.anuncio_id end,null);
end $$;

-- Cliente não consegue faturar uma aprovação escrevendo pelo PostgREST.
revoke all on function public.claim_decidir(uuid,int,text,text,uuid),public.claim_submeter(uuid,uuid,text,text,text,text,text),
 public.claim_conferir_concorrentes(uuid),public.claim_chaves_anuncio(uuid) from public,anon,authenticated;
grant execute on function public.claim_decidir(uuid,int,text,text,uuid),public.claim_submeter(uuid,uuid,text,text,text,text,text),
 public.claim_conferir_concorrentes(uuid),public.claim_chaves_anuncio(uuid) to service_role;
-- Testado também nas policies diretas que leem os desenhos e anexos privados do anúncio.
create function public.claim_d4_anuncio(p_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select from public.properties p where p.id=p_id and (
    p.owner_id is null or exists(select from public.propriedade_claims c where c.anuncio_id=p.id and c.estado='APROVADA' and c.titular_id=auth.uid())))
$$;
revoke all on function public.claim_d4_anuncio(uuid) from public,anon;
grant execute on function public.claim_d4_anuncio(uuid) to authenticated,service_role;
create policy claim_area_desenhos on public.property_area_desenhos as restrictive for select to authenticated
using(public.fn_is_arini() or public.claim_d4_anuncio(property_id));
create policy claim_area_arquivos on public.property_area_arquivos as restrictive for select to authenticated
using(public.fn_is_arini() or public.claim_d4_anuncio(property_id));


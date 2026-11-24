-- Reuniões compartilhadas por setor. Escrita somente pela RPC autenticada.
create table if not exists public.agenda_reunioes (
 id uuid primary key default gen_random_uuid(),
 setor text not null check(setor in ('diretoria','operacoes','comercial','financeiro','juridico','marketing','marketing_trafego','cartografia','suporte','seguranca')),
 titulo text not null check(length(titulo) between 3 and 180),
 responsavel uuid not null references public.profiles(user_id),
 inicio timestamptz not null, fim timestamptz not null check(fim>inicio and fim<=inicio+interval '7 days'),
 local text not null default '' check(length(local)<=500),
 tarefa_id uuid references public.tasks(id),
 lembrete_minutos integer not null default 60 check(lembrete_minutos between 0 and 10080),
 status text not null default 'agendada' check(status in ('agendada','concluida','cancelada')),
 created_by uuid not null references public.profiles(user_id),
 updated_by uuid not null references public.profiles(user_id),
 versao integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 lembrete_versao integer
);
create index if not exists agenda_reunioes_setor_inicio on public.agenda_reunioes(setor,inicio);
alter table public.agenda_reunioes enable row level security;
revoke all on public.agenda_reunioes from anon,authenticated;
grant select on public.agenda_reunioes to authenticated;
grant all on public.agenda_reunioes to service_role;
drop policy if exists agenda_setor on public.agenda_reunioes;
create policy agenda_setor on public.agenda_reunioes for select to authenticated using(public.fn_tem_setor(setor));
drop trigger if exists trg_equipe_leitura_guard on public.agenda_reunioes;
create trigger trg_equipe_leitura_guard before insert or update or delete on public.agenda_reunioes for each row execute function public.fn_equipe_leitura_guard();

create or replace function public.fn_agenda_reuniao_salvar(p_id uuid,p_versao integer,p_setor text,p_titulo text,p_responsavel uuid,p_inicio timestamptz,p_fim timestamptz,p_local text,p_lembrete integer,p_tarefa uuid,p_status text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); anterior public.agenda_reunioes%rowtype; nova public.agenda_reunioes%rowtype;
begin
 if uid is null or not public.fn_tem_setor(p_setor) or not public.fn_equipe_mfa_ok()
   or exists(select from public.profiles where user_id=uid and equipe_acesso='leitura') then
   raise exception 'Sem permissão para alterar esta agenda.' using errcode='42501';
 end if;
 if p_titulo is null or length(trim(p_titulo)) not between 3 and 180 or p_inicio is null or p_fim is null
   or p_inicio>now()+interval '5 years' or p_inicio<now()-interval '1 year'
   or p_fim<=p_inicio or p_fim>p_inicio+interval '7 days'
   or p_lembrete is null or p_lembrete not between 0 and 10080 or p_status is null or p_status not in ('agendada','concluida','cancelada')
   or length(coalesce(p_local,''))>500 then raise exception 'Confira título, período e lembrete.' using errcode='22023'; end if;
 if not exists(select from public.profiles where user_id=p_responsavel and coalesce(ativo,true)
   and equipe_acesso<>'leitura' and (role='admin_central' or (role='analista_arini' and p_setor=any(setores)))) then
   raise exception 'Responsável precisa ser operador ativo do setor.' using errcode='22023'; end if;
 if p_tarefa is not null and not exists(select from public.tasks where id=p_tarefa and setor=p_setor) then
   raise exception 'A tarefa precisa pertencer ao mesmo setor.' using errcode='22023'; end if;
 if p_id is not null then
   select * into anterior from public.agenda_reunioes where id=p_id for update;
   if not found or not public.fn_tem_setor(anterior.setor) then raise exception 'Reunião não encontrada.' using errcode='42501'; end if;
   if p_versao is distinct from anterior.versao then raise exception 'A reunião mudou. Recarregue antes de salvar.' using errcode='40001'; end if;
   update public.agenda_reunioes set setor=p_setor,titulo=trim(p_titulo),responsavel=p_responsavel,inicio=p_inicio,fim=p_fim,
    local=coalesce(p_local,''),lembrete_minutos=p_lembrete,tarefa_id=p_tarefa,status=p_status,versao=versao+1,updated_by=uid,updated_at=now()
    where id=p_id returning * into nova;
 else
   insert into public.agenda_reunioes(setor,titulo,responsavel,inicio,fim,local,lembrete_minutos,tarefa_id,status,created_by,updated_by)
   values(p_setor,trim(p_titulo),p_responsavel,p_inicio,p_fim,coalesce(p_local,''),p_lembrete,p_tarefa,p_status,uid,uid) returning * into nova;
 end if;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
 values(uid,'reuniao_'||case when p_id is null then 'criada' else 'alterada' end,'agenda_reunioes',nova.id,
   case when p_id is not null then to_jsonb(anterior) end,to_jsonb(nova));
 perform public.fn_notificar(nova.responsavel,'info',case when nova.status='cancelada' then 'Reunião cancelada: ' else 'Agenda: ' end||nova.titulo,
   to_char(nova.inicio at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' · '||nova.local,
   '/admin/agenda-setores?reuniao='||nova.id,'reuniao:'||nova.id||':'||nova.versao);
 return nova.id;
end $$;
revoke all on function public.fn_agenda_reuniao_salvar(uuid,integer,text,text,uuid,timestamptz,timestamptz,text,integer,uuid,text) from public,anon;
grant execute on function public.fn_agenda_reuniao_salvar(uuid,integer,text,text,uuid,timestamptz,timestamptz,text,integer,uuid,text) to authenticated;

create or replace function public.fn_agenda_lembretes() returns jsonb language plpgsql security definer set search_path='' as $$
declare r record; n integer:=0;
begin
 for r in select * from public.agenda_reunioes where status='agendada' and inicio>=now()
   and inicio<=now()+lembrete_minutos*interval '1 minute' and lembrete_versao is distinct from versao
   order by inicio limit 500 for update skip locked loop
   if exists(select from public.profiles where user_id=r.responsavel and coalesce(ativo,true) and (role='admin_central' or (role='analista_arini' and r.setor=any(setores)))) then
     perform public.fn_notificar(r.responsavel,'atencao','Lembrete: '||r.titulo,to_char(r.inicio at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' · '||r.local,
       '/admin/agenda-setores?reuniao='||r.id,'reuniao_lembrete:'||r.id||':'||r.versao);
     insert into public.audit_log(acao,entidade,entidade_id,dados_depois) values('reuniao_lembrete','agenda_reunioes',r.id,jsonb_build_object('versao',r.versao,'responsavel',r.responsavel));
     n:=n+1;
   end if;
   update public.agenda_reunioes set lembrete_versao=versao where id=r.id;
 end loop;
 return jsonb_build_object('lembretes_reuniao',n);
end $$;
revoke all on function public.fn_agenda_lembretes() from public,anon,authenticated;
grant execute on function public.fn_agenda_lembretes() to service_role;

-- Guarda a data efetivamente enviada ao gateway. Faturas antigas sem esta
-- informação continuam identificadas como previsão contratual na agenda.
alter table public.invoices add column if not exists vencimento date;

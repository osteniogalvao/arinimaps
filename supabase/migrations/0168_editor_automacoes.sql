-- Regras configuráveis: eventos reais de audit_log ou recorrência diária.
-- A única ação é criar tarefa. Não emite cobranças, mensagens nem apaga dados.
create table if not exists public.automacao_catalogo (
  evento text primary key, nome text not null, campos text[] not null default '{}'
);
insert into public.automacao_catalogo(evento,nome,campos) values
 ('cadastro_criado','Cadastro enviado',array['entidade','role','nicho']),
 ('lead_criado','Lead de avaliação criado',array['entidade']),
 ('documento_anexado','Documento do imóvel anexado',array['entidade','tipo']),
 ('documento_nova_versao','Nova versão de documento do imóvel',array['entidade','tipo']),
 ('atendimento_transferir','Atendimento transferido',array['entidade','para']),
 ('atendimento_resposta','Resposta enviada no atendimento',array['entidade'])
on conflict(evento) do nothing;

create table if not exists public.automacao_regras (
 id uuid primary key default gen_random_uuid(), nome text not null check(char_length(nome) between 3 and 100),
 gatilho text not null check(gatilho in ('evento','recorrente')),
 evento text references public.automacao_catalogo(evento),
 condicao_campo text, condicao_valor text,
 setor text not null check(setor in ('diretoria','operacoes','comercial','financeiro','juridico','marketing','marketing_trafego','cartografia','suporte','seguranca')),
 titulo text not null check(char_length(titulo) between 3 and 180),
 descricao text not null default '' check(char_length(descricao)<=2000),
 prazo_dias int not null check(prazo_dias between 0 and 365),
 prioridade text not null check(prioridade in ('baixa','normal','alta','urgente')),
 intervalo_dias int check(intervalo_dias between 1 and 365), proxima_data date,
 ativa boolean not null default true, versao int not null default 1,
 inicio_eventos timestamptz not null default now(), criado_por uuid not null references public.profiles(user_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((gatilho='evento' and evento is not null and intervalo_dias is null and proxima_data is null)
    or (gatilho='recorrente' and evento is null and intervalo_dias is not null and proxima_data is not null and condicao_campo is null)),
 check((condicao_campo is null and condicao_valor is null) or
       (condicao_campo is not null and char_length(condicao_valor) between 1 and 200))
);
create table if not exists public.automacao_execucoes (
 id bigint generated always as identity primary key,
 regra_id uuid not null references public.automacao_regras(id), versao int not null,
 chave text not null unique, evento_id uuid references public.audit_log(id),
 task_id uuid not null references public.tasks(id), created_at timestamptz not null default now()
);
create index if not exists idx_audit_automacao_evento on public.audit_log(acao,created_at,id)
 where acao in ('cadastro_criado','lead_criado','documento_anexado','documento_nova_versao','atendimento_transferir','atendimento_resposta');

alter table public.automacao_catalogo enable row level security;
alter table public.automacao_regras enable row level security;
alter table public.automacao_execucoes enable row level security;
revoke all on public.automacao_catalogo,public.automacao_regras,public.automacao_execucoes from public,anon,authenticated;
grant select on public.automacao_catalogo,public.automacao_regras,public.automacao_execucoes to authenticated;
grant all on public.automacao_catalogo,public.automacao_regras,public.automacao_execucoes to service_role;
grant usage,select on sequence public.automacao_execucoes_id_seq to service_role;
do $$declare t text;begin
 foreach t in array array['automacao_catalogo','automacao_regras','automacao_execucoes'] loop
  execute format('drop policy if exists automacao_diretoria on public.%I',t);
  execute format('create policy automacao_diretoria on public.%I for select to authenticated using (public.fn_role()=''admin_central'')',t);
  execute format('drop trigger if exists trg_equipe_leitura_guard on public.%I',t);
  execute format('create trigger trg_equipe_leitura_guard before insert or update or delete on public.%I for each row execute function public.fn_equipe_leitura_guard()',t);
 end loop;
end $$;

create or replace function public.fn_automacao_salvar(p_dados jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare autor uuid:=auth.uid(); antes public.automacao_regras; depois public.automacao_regras;
 ident uuid; v_campo text; v_valor text; v_evento text; v_gatilho text; recorrente boolean;
begin
 if autor is null or not exists(
  select 1 from public.profiles where user_id=autor and role='admin_central' and ativo
 ) then raise exception 'Só a Diretoria pode editar regras.' using errcode='42501';end if;
 if jsonb_typeof(p_dados) is distinct from 'object' then raise exception 'Regra inválida.' using errcode='22023';end if;
 v_gatilho:=p_dados->>'gatilho'; recorrente:=v_gatilho='recorrente';
 v_evento:=case when not recorrente then p_dados->>'evento' end;
 v_campo:=case when not recorrente then nullif(btrim(p_dados->>'condicao_campo'),'') end;
 v_valor:=case when v_campo is not null then nullif(btrim(p_dados->>'condicao_valor'),'') end;
 if not recorrente and not exists(select 1 from public.automacao_catalogo c where c.evento=v_evento and (v_campo is null or v_campo=any(c.campos)))
 then raise exception 'Evento ou condição não suportado.' using errcode='22023';end if;
 ident:=nullif(p_dados->>'id','')::uuid;
 if ident is not null then
  select * into antes from public.automacao_regras where id=ident for update;
  if not found then raise exception 'Regra não encontrada.' using errcode='P0002';end if;
  if (p_dados->>'versao')::int is distinct from antes.versao then raise exception 'A regra foi alterada. Recarregue antes de salvar.' using errcode='40001';end if;
 else ident:=gen_random_uuid();end if;
 insert into public.automacao_regras(id,nome,gatilho,evento,condicao_campo,condicao_valor,setor,titulo,descricao,prazo_dias,prioridade,intervalo_dias,proxima_data,ativa,criado_por)
 values(ident,btrim(p_dados->>'nome'),v_gatilho,v_evento,v_campo,v_valor,p_dados->>'setor',btrim(p_dados->>'titulo'),coalesce(btrim(p_dados->>'descricao'),''),
 (p_dados->>'prazo_dias')::int,p_dados->>'prioridade',case when recorrente then (p_dados->>'intervalo_dias')::int end,
 case when recorrente then (p_dados->>'proxima_data')::date end,(p_dados->>'ativa')::boolean,autor)
 on conflict(id) do update set nome=excluded.nome,gatilho=excluded.gatilho,evento=excluded.evento,
 condicao_campo=excluded.condicao_campo,condicao_valor=excluded.condicao_valor,setor=excluded.setor,titulo=excluded.titulo,
 descricao=excluded.descricao,prazo_dias=excluded.prazo_dias,prioridade=excluded.prioridade,intervalo_dias=excluded.intervalo_dias,
 proxima_data=excluded.proxima_data,ativa=excluded.ativa,versao=automacao_regras.versao+1,inicio_eventos=now(),updated_at=now()
 returning * into depois;
 insert into public.audit_log(user_id,acao,entidade,entidade_id,dados_antes,dados_depois)
 values(autor,case when antes.id is null then 'automacao_regra_criada' else 'automacao_regra_alterada' end,
 'automacao_regras',ident,case when antes.id is not null then to_jsonb(antes) end,to_jsonb(depois));
 return ident;
end $$;
revoke all on function public.fn_automacao_salvar(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.fn_automacao_salvar(jsonb) to authenticated;

create or replace function public.fn_automacoes_configuradas() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.automacao_regras; ev record; tarefa uuid; chave text; feitas int:=0; hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 for r in select * from public.automacao_regras where ativa order by created_at,id for update skip locked loop
  if r.gatilho='recorrente' then
   if r.proxima_data>hoje then continue;end if;
   chave:='config:'||r.id||':dia:'||hoje;
   tarefa:=public.fn_tarefa_automatica(chave,'regra_'||replace(r.id::text,'-',''),r.setor,r.titulo,
    r.descricao||E'\nRegra: '||r.nome||'. Recorrência de '||hoje||'.',null,hoje+r.prazo_dias,r.prioridade);
   if tarefa is not null then
    insert into public.automacao_execucoes(regra_id,versao,chave,task_id) values(r.id,r.versao,chave,tarefa);
    feitas:=feitas+1;
   end if;
   update public.automacao_regras set proxima_data=hoje+r.intervalo_dias where id=r.id;
  else
   for ev in select a.* from public.audit_log a where a.acao=r.evento and a.created_at>=r.inicio_eventos
    and (r.condicao_campo is null or (case when r.condicao_campo='entidade' then a.entidade else a.dados_depois->>r.condicao_campo end)=r.condicao_valor)
    and not exists(select 1 from public.automacao_execucoes x where x.chave='config:'||r.id||':evento:'||a.id)
    order by a.created_at,a.id limit 500 loop
    chave:='config:'||r.id||':evento:'||ev.id;
    tarefa:=public.fn_tarefa_automatica(chave,'regra_'||replace(r.id::text,'-',''),r.setor,r.titulo,
     r.descricao||E'\nRegra: '||r.nome||'. Evento: '||r.evento||'. Referência: '||ev.entidade||'/'||coalesce(ev.entidade_id::text,ev.id::text)||'.',
     null,hoje+r.prazo_dias,r.prioridade,ev.property_id,ev.opportunity_id);
    if tarefa is not null then
     insert into public.automacao_execucoes(regra_id,versao,chave,evento_id,task_id) values(r.id,r.versao,chave,ev.id,tarefa);
     feitas:=feitas+1;
    end if;
   end loop;
  end if;
 end loop;
 return jsonb_build_object('regras_configuradas_criadas',feitas);
end $$;
revoke all on function public.fn_automacoes_configuradas() from public,anon,authenticated;
grant execute on function public.fn_automacoes_configuradas() to service_role;

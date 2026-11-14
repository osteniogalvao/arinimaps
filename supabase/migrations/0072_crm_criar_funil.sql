-- Cria o funil e as três etapas iniciais em uma única transação.
create or replace function public.fn_crm_criar_funil(p_setor text, p_nome text, p_descricao text, p_ativo boolean)
returns uuid language plpgsql set search_path=public as $$
declare novo uuid;
begin
  insert into crm_pipelines (setor, nome, descricao, ativo)
    values (p_setor, p_nome, p_descricao, p_ativo) returning id into novo;
  insert into crm_etapas (pipeline_id, nome, ordem, sla_horas, final) values
    (novo, 'Entrada', 1, 48, false), (novo, 'Em andamento', 2, 120, false), (novo, 'Concluído', 3, null, true);
  return novo;
end $$;

revoke all on function public.fn_crm_criar_funil(text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.fn_crm_criar_funil(text,text,text,boolean) to service_role;

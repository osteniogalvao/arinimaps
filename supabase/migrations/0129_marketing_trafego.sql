-- As contas que operavam os dois painéis conservam suas atribuições atuais.
update public.profiles set setores=array_append(setores,'marketing_trafego')
where role='analista_arini' and 'marketing'=any(setores) and not 'marketing_trafego'=any(setores);
do $$ declare p uuid; begin
  insert into public.crm_pipelines(setor,nome,descricao) values
    ('marketing_trafego','Campanhas de tráfego','Planejamento, veiculação e medição de campanhas.') returning id into p;
  insert into public.crm_etapas(pipeline_id,nome,ordem,sla_horas,final) values
    (p,'Planejamento',1,48,false),(p,'Em veiculação',2,null,false),(p,'Análise de resultados',3,72,false),(p,'Encerrada',4,null,true);
end $$;
-- Ambos os painéis de marketing usam métricas agregadas; o contato do lead
-- e a lista de favoritos individual são informações do Comercial.
alter policy leads_setor_select on public.leads using (public.fn_tem_setor('comercial'));
alter policy favoritos_setor_select on public.favoritos using (public.fn_tem_setor('comercial'));

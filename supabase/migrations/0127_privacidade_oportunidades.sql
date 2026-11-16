-- A identidade do interessado é usada pela equipe responsável e pelo parceiro
-- designado. O acompanhamento do proprietário tem uma projeção própria.
create or replace function public.fn_opp_visible(o public.opportunities)
returns boolean language sql stable security definer set search_path='' as $$
  select public.fn_tem_setor('comercial') or public.fn_tem_setor('juridico') or public.fn_tem_setor('financeiro')
    or exists (
      select from public.partners pa join public.profiles p on p.user_id=pa.profile_id
      where p.user_id=auth.uid() and p.ativo and pa.tipo::text=p.role::text
        and pa.status in ('aprovado','ativo') and ((o.responsavel_tipo='parceiro' and pa.id=o.responsavel_partner_id) or pa.id=o.partner_comprador_id)
    );
$$;

-- As rotas do espelho projetam estoque e negociação conforme o papel.
-- Acesso direto às tabelas também exporia cliente_nome, anotações e autor.
drop policy if exists p_espelho_leitura on public.property_espelho;
drop policy if exists p_espelho_eventos_leitura on public.property_espelho_eventos;

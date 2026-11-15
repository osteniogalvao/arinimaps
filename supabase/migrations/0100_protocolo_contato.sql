-- O protocolo só existe se a primeira mensagem foi gravada na mesma transação.
create function public.abrir_chamado_com_mensagem(p_usuario uuid,p_nome text,p_email text,p_telefone text,
  p_categoria text,p_assunto text,p_mensagem text)
returns table(id uuid,codigo text) language plpgsql security definer set search_path=public as $$
declare chamado public.support_tickets;
begin
  insert into public.support_tickets(user_id,nome,email,telefone,categoria,assunto,prioridade)
    values(p_usuario,p_nome,p_email,p_telefone,p_categoria,left(p_assunto,160),case when p_categoria='problema' then 'alta' else 'normal' end)
    returning * into chamado;
  insert into public.support_messages(ticket_id,autor_id,autor_nome,corpo)
    values(chamado.id,p_usuario,p_nome,left(p_mensagem,6000));
  return query select chamado.id,chamado.codigo;
end $$;
revoke all on function public.abrir_chamado_com_mensagem(uuid,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.abrir_chamado_com_mensagem(uuid,text,text,text,text,text,text) to service_role;

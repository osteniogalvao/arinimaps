-- Reservar a nota antes de chamar o Asaas. A resposta pode se perder depois da emissão.
alter table public.notas_fiscais drop constraint if exists notas_fiscais_status_check;
alter table public.notas_fiscais add constraint notas_fiscais_status_check check (
  status in ('rascunho', 'emitindo', 'conferir', 'enviada', 'emitida', 'cancelada', 'erro')
);

-- Erros legados sem ID podem ser respostas perdidas. Conciliar antes de repetir.
update public.notas_fiscais set status = 'conferir'
where status = 'erro' and gateway_id is null;

-- Uma consulta ou webhook repetido não muda o mês da primeira emissão.
create or replace function public.fn_nf_data_emissao() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.emitida_em is not null then
    new.emitida_em := old.emitida_em;
  elsif new.status = 'emitida' then
    new.emitida_em := coalesce(new.emitida_em, now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_nf_data_emissao on public.notas_fiscais;
create trigger trg_nf_data_emissao before update on public.notas_fiscais
for each row execute function public.fn_nf_data_emissao();

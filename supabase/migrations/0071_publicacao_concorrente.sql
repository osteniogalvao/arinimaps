-- A reserva precede a chamada ao canal. Uma entrega incerta exige conferência.
alter table public.publicacoes drop constraint if exists publicacoes_status_check;
alter table public.publicacoes add constraint publicacoes_status_check check (
  status in ('rascunho', 'aprovacao', 'agendada', 'enviando', 'conferir', 'publicada', 'erro', 'cancelada')
);

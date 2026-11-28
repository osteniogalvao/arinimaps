-- 0179 — Macros do atendimento (porte do CRM da Arini Negócios).
-- Uma macro é uma sequência de passos aplicada a uma conversa com um clique:
-- mandar mensagem, nota interna, etiqueta, transferir para um setor, assumir,
-- aguardar cliente ou encerrar. Cada passo usa as mesmas ações (e as mesmas
-- travas) dos botões da conversa. Macro pública: a equipe toda vê; pessoal:
-- só quem criou. Só o servidor lê e grava (service_role).

create table if not exists public.atendimento_macros (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 2 and 80),
  passos jsonb not null default '[]'::jsonb check (jsonb_typeof(passos) = 'array'),
  publica boolean not null default true,
  criado_por uuid references public.profiles(user_id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_atendimento_macros_criador on public.atendimento_macros (criado_por);
alter table public.atendimento_macros enable row level security;
revoke all on public.atendimento_macros from anon, authenticated;

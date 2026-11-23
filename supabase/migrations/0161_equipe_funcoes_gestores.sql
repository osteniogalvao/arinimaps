-- 0161: funções da equipe e gestores por setor (áudios do Carlos, 23/11/2026
-- 17h58: "um CRM de controle, controle de funções" e "cada setor a gente tem
-- que organizar para liberar o acesso").
--
--  · cargo          — a função da pessoa (Corretor, Captador, Recepcionista,
--                     Gerente de Locação...). É rótulo: não muda permissão.
--  · setores_gestor — setores em que a pessoa é GESTORA. O gestor de um setor
--                     libera e retira o acesso daquele setor para a equipe,
--                     define a função de quem está no setor e cria login novo
--                     já preso aos setores que ele gere. Quem nomeia gestor é
--                     a Diretoria.
--
-- As duas colunas ficam de fora da lista do p_profiles_self_update (0036),
-- então ninguém as altera pela API pública: só o servidor grava.
alter table public.profiles add column if not exists cargo text;
alter table public.profiles add column if not exists setores_gestor text[] not null default '{}';

alter table public.profiles drop constraint if exists profiles_cargo_tamanho;
alter table public.profiles add constraint profiles_cargo_tamanho
  check (cargo is null or char_length(cargo) between 1 and 40);

-- gestor só de setor em que a pessoa atua (a diretoria fica de fora: ela já gere tudo)
create or replace function public.fn_profiles_gestor_coerente() returns trigger
language plpgsql as $$
begin
  if new.role <> 'analista_arini' then
    new.setores_gestor := '{}';
  else
    new.setores_gestor := coalesce(array(
      select distinct s from unnest(coalesce(new.setores_gestor, '{}')) s
       where s <> 'diretoria' and s = any(coalesce(new.setores, '{}'))
    ), '{}');
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_gestor_coerente on public.profiles;
create trigger trg_profiles_gestor_coerente before insert or update of role, setores, setores_gestor on public.profiles
  for each row execute function public.fn_profiles_gestor_coerente();

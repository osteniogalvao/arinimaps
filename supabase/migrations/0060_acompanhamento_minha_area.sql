-- Arini Imóveis Brasil — migration 0060: acompanhamento do proprietário (item 28)
-- e "Minha área" (item 29) da segunda etapa.
--
--  · visit_status ganha 'cancelada' (linha do tempo: agendada, realizada, cancelada)
--  · property_acompanhamento  — próximos passos que o intermediador escreve para o
--    proprietário; a data da última atualização alimenta a pendência
--    "proprietário sem atualização há 7 dias"
--  · property_lembretes       — lembrete simples (data + texto) do proprietário;
--    o worker (job lembretes_proprietario) envia o e-mail na data
--  · property_area_desenhos   — pontos, linhas e polígonos de trabalho sobre a
--    divisa (piquetes, plantio, benfeitorias, projetos), com nome, cor e medidas
--  · property_area_arquivos   — arquivos de projeto (PDF, imagem, DWG, KML) ligados
--    a um desenho ou ao imóvel; o arquivo fica no cofre privado `docs`
--
-- Tudo idempotente e aditivo. As telas usam o servidor (service_role) e
-- conferem o dono; as policies abaixo valem para quem acessar pela API pública:
-- dono/parceiro do imóvel (fn_property_editable_id) e a equipe Arini.
-- Pela API pública é SÓ LEITURA: toda escrita (lembretes, desenhos, arquivos)
-- passa pelas rotas do servidor. Se o dono pudesse inserir direto em
-- property_area_arquivos, gravaria um storage_path apontando para a
-- autorização de venda ou a selfie e depois o apagaria pela rota DELETE.

alter type visit_status add value if not exists 'cancelada';

-- ---------------------------------------------------------------------------
-- Acompanhamento: próximos passos
-- ---------------------------------------------------------------------------
create table if not exists property_acompanhamento (
  property_id uuid primary key references properties(id) on delete cascade,
  proximos_passos text not null default '' check (char_length(proximos_passos) <= 2000),
  atualizado_por uuid references profiles(user_id) on delete set null,
  atualizado_em timestamptz not null default now()
);
alter table property_acompanhamento enable row level security;
drop policy if exists p_acompanhamento_ler on property_acompanhamento;
create policy p_acompanhamento_ler on property_acompanhamento for select
  using (fn_property_editable_id(property_id));
-- escrita só pelo servidor (intermediador responsável, conferido na rota)

-- ---------------------------------------------------------------------------
-- Lembretes do proprietário
-- ---------------------------------------------------------------------------
create table if not exists property_lembretes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  data date not null,
  texto text not null check (char_length(texto) between 1 and 500),
  enviado_em timestamptz,
  erro text,
  -- o worker desiste depois de 5 tentativas com erro e marca falhou
  tentativas int not null default 0,
  falhou boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_lembretes_property on property_lembretes (property_id, data);
alter table property_lembretes add column if not exists tentativas int not null default 0;
alter table property_lembretes add column if not exists falhou boolean not null default false;
create index if not exists idx_lembretes_pendentes on property_lembretes (data) where enviado_em is null and not falhou;
alter table property_lembretes enable row level security;
drop policy if exists p_lembretes_proprios on property_lembretes;
create policy p_lembretes_proprios on property_lembretes for select
  using (user_id = auth.uid() and fn_property_editable_id(property_id));
drop policy if exists p_lembretes_equipe on property_lembretes;
create policy p_lembretes_equipe on property_lembretes for select using (fn_is_arini());

-- ---------------------------------------------------------------------------
-- Minha área: desenhos de trabalho
-- ---------------------------------------------------------------------------
create table if not exists property_area_desenhos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  categoria text not null default 'outro'
    check (categoria in ('piquete', 'plantio', 'benfeitoria', 'projeto', 'outro')),
  cor text not null default '#D9BD6F' check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  -- geometria em GeoJSON (Point, LineString ou Polygon, EPSG:4326)
  geojson jsonb not null,
  area_m2 numeric,
  comprimento_m numeric,
  notas text check (notas is null or char_length(notas) <= 2000),
  criado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_area_desenhos_property on property_area_desenhos (property_id);
drop trigger if exists trg_area_desenhos_touch on property_area_desenhos;
create trigger trg_area_desenhos_touch before update on property_area_desenhos
  for each row execute function fn_touch_updated_at();
alter table property_area_desenhos enable row level security;
drop policy if exists p_area_desenhos on property_area_desenhos;
create policy p_area_desenhos on property_area_desenhos for select
  using (fn_property_editable_id(property_id));

-- ---------------------------------------------------------------------------
-- Minha área: arquivos de projeto (cofre privado `docs`)
-- ---------------------------------------------------------------------------
create table if not exists property_area_arquivos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  -- sem desenho = arquivo do imóvel; apagar o desenho deixa o arquivo no imóvel
  desenho_id uuid references property_area_desenhos(id) on delete set null,
  -- só arquivos da pasta da Minha área deste imóvel (nunca documento, autorização ou selfie)
  storage_path text not null unique
    check (storage_path like 'imoveis/' || property_id::text || '/minha-area/%'),
  nome_arquivo text not null,
  tamanho_bytes bigint,
  enviado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_area_arquivos_property on property_area_arquivos (property_id);
alter table property_area_arquivos enable row level security;
drop policy if exists p_area_arquivos on property_area_arquivos;
create policy p_area_arquivos on property_area_arquivos for select
  using (fn_property_editable_id(property_id));

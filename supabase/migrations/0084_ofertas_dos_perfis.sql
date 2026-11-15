-- Vitrine pública dos seis novos caminhos. As ofertas de apresentação não
-- concedem direitos de conta nem abrem vaga de correspondente por si só.
alter table public.profiles drop constraint chk_profiles_nicho;
alter table public.profiles add constraint chk_profiles_nicho check (nicho is null or nicho in (
  'consulta','comprador_investidor','proprietario','produtor_rural','corretor_imobiliaria',
  'leiloeiro','engenheiro','empresa_holding','ente_publico','franqueado','correspondente_bancario'
));

create table public.ofertas_perfis (
  id text primary key,
  perfil text not null check (perfil in ('comprar','leiloeiro','instituicao','empresa','anunciar','correspondente')),
  nome text not null check (length(nome) between 1 and 100),
  descricao text not null,
  modalidade text not null check (modalidade in ('mapa','cadastro','anuncio','espera','proposta','complemento')),
  ciclo text not null check (ciclo in ('mensal','avulso','gratuito','proposta')),
  preco_centavos integer check (preco_centavos >= 0),
  anual_centavos integer check (anual_centavos >= 0),
  prazo_dias integer check (prazo_dias > 0),
  limites text[] not null default '{}',
  detalhes text[] not null default '{}',
  aplica_em text[] not null default '{}',
  ativo boolean not null default true,
  ordem integer not null,
  revisao integer not null default 1,
  check (ciclo <> 'gratuito' or preco_centavos = 0),
  check (modalidade not in ('mapa','cadastro','anuncio') or (ciclo='gratuito' and preco_centavos=0 and anual_centavos is null))
);
alter table public.ofertas_perfis enable row level security;
revoke all on public.ofertas_perfis from public,anon,authenticated;
grant select,update on public.ofertas_perfis to service_role;

create function public.fn_editar_oferta_perfil(p_ator uuid,p_id text,p_revisao integer,p_dados jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare antes public.ofertas_perfis%rowtype; depois public.ofertas_perfis%rowtype;
begin
  if not exists(select from public.profiles where user_id=p_ator and ativo and role='admin_central') then
    raise exception using errcode='42501', message='Diretoria necessária.';
  end if;
  select * into strict antes from public.ofertas_perfis where id=p_id for update;
  if antes.revisao <> p_revisao then raise exception using errcode='40001',message='Esta oferta foi editada em outra sessão.'; end if;
  update public.ofertas_perfis set nome=p_dados->>'nome', descricao=p_dados->>'descricao',
    preco_centavos=(p_dados->>'preco_centavos')::integer, anual_centavos=(p_dados->>'anual_centavos')::integer,
    prazo_dias=(p_dados->>'prazo_dias')::integer, limites=array(select jsonb_array_elements_text(p_dados->'limites')),
    detalhes=array(select jsonb_array_elements_text(p_dados->'detalhes')), ativo=(p_dados->>'ativo')::boolean,
    revisao=revisao+1 where id=p_id returning * into depois;
  insert into public.audit_log(user_id,acao,entidade,dados_antes,dados_depois)
    values(p_ator,'oferta_editada','ofertas_perfis',to_jsonb(antes),to_jsonb(depois));
  return depois.revisao;
end $$;
revoke all on function public.fn_editar_oferta_perfil(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.fn_editar_oferta_perfil(uuid,text,integer,jsonb) to service_role;

insert into public.ofertas_perfis(id,perfil,nome,descricao,modalidade,ciclo,preco_centavos,anual_centavos,prazo_dias,limites,detalhes,aplica_em,ordem) values
  ('comprar_explorar', 'comprar', 'Explorar', 'Conheça os imóveis à venda no mapa.', 'mapa', 'gratuito', 0, null, null, array['Sem cadastro'], array['Foto, tipo, município, área e preço anunciado','Localização e navegação no mapa'], '{}', 1),
  ('comprar_cadastro', 'comprar', 'Cadastro gratuito', 'Consulte os imóveis publicados e converse com a equipe ARINI.', 'cadastro', 'gratuito', 0, null, null, array['Sem mensalidade'], array['Favoritos e comparação de imóveis','Fotos, relatório e informações territoriais conforme a disponibilidade','Manifestações de interesse, pedidos de visita e acompanhamento'], '{}', 2),
  ('comprar_creditos', 'comprar', 'Pacote de IA', 'Use a Ari para entender o imóvel, comparar opções e ler o relatório.', 'espera', 'avulso', 2000, null, null, array['1.000 créditos avulsos','500 comprados + 500 promocionais','Validade de 12 meses'], array['Pacote sem mensalidade','O consumo depende do tipo de análise. A Central confirma a disponibilização.'], '{}', 3),
  ('leilao_teste', 'leiloeiro', 'Teste gratuito', 'Experimente o CRM de leilões e o recorte de uma área.', 'espera', 'gratuito', 0, null, 3, array['1 usuário','1 imóvel em prévia','20 créditos da Ari'], array['Desenho da área e consulta territorial','Cadastro de leiloeiro sujeito a verificação'], '{}', 4),
  ('leilao_essencial', 'leiloeiro', 'Essencial', 'Carteira de leilões, documentos e interessados.', 'espera', 'mensal', 24990, 249900, null, array['10 imóveis ativos','1 usuário','100 créditos da Ari/mês'], array['Painel de leilões e lotes, agenda de praças e documentos','Consulta territorial e recorte da área para KML e KMZ','Publicação sujeita à verificação do leiloeiro e da autorização'], '{}', 5),
  ('leilao_profissional', 'leiloeiro', 'Profissional', 'Gestão do leilão, dos comitentes e dos resultados.', 'espera', 'mensal', 54990, 549900, null, array['30 imóveis ativos','3 usuários','500 créditos da Ari/mês','2 destaques por mês'], array['Recursos do Essencial','Habilitação, arrematações, pós-leilão e prestação de contas','Valores da região, aproveitamento e relatórios'], '{}', 6),
  ('leilao_premium', 'leiloeiro', 'Premium', 'Organização de equipes e publicação em volume.', 'espera', 'mensal', 129990, 1299900, null, array['100 imóveis ativos','8 usuários','1.500 créditos da Ari/mês','8 destaques por mês'], array['Recursos do Profissional','Importação em lote por planilha','Permissões de equipe, histórico e painel por região e comitente'], '{}', 7),
  ('leilao_extra_imoveis', 'leiloeiro', 'Mais imóveis ativos', 'Pacote de 10 imóveis ativos.', 'complemento', 'mensal', 16990, null, null, '{}', '{}', array['leilao_essencial','leilao_profissional','leilao_premium'], 8),
  ('leilao_extra_usuario', 'leiloeiro', 'Mais usuários', 'Um login adicional na equipe de leilões.', 'complemento', 'mensal', 2500, null, null, '{}', '{}', array['leilao_essencial','leilao_profissional','leilao_premium'], 9),
  ('leilao_extra_ari', 'leiloeiro', 'Mais créditos da Ari', '1.000 créditos adicionais por mês.', 'complemento', 'mensal', 6900, null, null, '{}', '{}', array['leilao_essencial','leilao_profissional','leilao_premium'], 10),
  ('leilao_extra_crm', 'leiloeiro', 'CRM de atendimento', 'WhatsApp empresarial com setores e Ari.', 'complemento', 'mensal', 14700, null, null, '{}', '{}', array['leilao_essencial','leilao_profissional','leilao_premium'], 11),
  ('leilao_extra_destaque', 'leiloeiro', 'Destaque de imóvel', 'Destaque de um imóvel na busca e no mapa.', 'complemento', 'avulso', 2990, null, 15, '{}', '{}', array['leilao_essencial','leilao_profissional','leilao_premium'], 12),
  ('org_demo', 'instituicao', 'Demonstração', 'Acompanhamento de um setor com os dados do território.', 'proposta', 'proposta', null, null, 30, array['3 usuários'], array['Mapa do território e consultas','Reuniões de abertura e de resultado'], '{}', 13),
  ('org_essencial', 'instituicao', 'Essencial', 'Consulta e mapa para o território do órgão.', 'proposta', 'proposta', null, null, null, array['5 usuários','300 créditos da Ari/mês','2 atualizações de base por ano'], array['Base cartográfica urbana e rural','Zoneamento, parâmetros por lote e dados ambientais','Medições, KML, KMZ e relatórios'], '{}', 14),
  ('org_profissional', 'instituicao', 'Profissional', 'Gestão territorial, cadastro, projetos e serviços ao cidadão.', 'proposta', 'proposta', null, null, null, array['25 usuários','1.500 créditos da Ari/mês','6 atualizações de base por ano'], array['Recursos do Essencial','Projetos, desmembramentos e aprovações','Balcão digital, gestão de processos e arrecadação'], '{}', 15),
  ('org_premium', 'instituicao', 'Premium', 'Inteligência pública, integrações e atendimento dedicado.', 'proposta', 'proposta', null, null, null, array['100 usuários','5.000 créditos da Ari/mês','40 h/ano de implantação sob medida'], array['Recursos do Profissional','Integrações com IPTU, ITBI, dívida ativa e GIS','Portal do cidadão, dados abertos e painéis executivos'], '{}', 16),
  ('empresa_demo', 'empresa', 'Demonstração', 'Avaliação de viabilidade e documentação de uma área da empresa.', 'proposta', 'proposta', null, null, 15, array['3 usuários','1 área'], array['Análise documental e ambiental','Reuniões de abertura e de resultado'], '{}', 17),
  ('empresa_essencial', 'empresa', 'Essencial', 'Pesquisa, viabilidade e análise de áreas.', 'proposta', 'proposta', null, null, null, array['3 usuários','10 áreas no portfólio','300 créditos da Ari/mês'], array['Prospecção por região e tamanho','Referência de mercado, relevo, solo e aproveitamento','Due diligence documental e ambiental'], '{}', 18),
  ('empresa_profissional', 'empresa', 'Profissional', 'Operação e portfólio com acompanhamento dos empreendimentos.', 'proposta', 'proposta', null, null, null, array['15 usuários','100 áreas no portfólio','5 empreendimentos ativos','200 propriedades da cadeia','1.500 créditos da Ari/mês'], array['Recursos do Essencial','CRM comercial, reservas de lotes e portfólio monitorado','Aprovação com prefeituras e conformidade dos fornecedores'], '{}', 19),
  ('empresa_premium', 'empresa', 'Premium', 'Gestão corporativa para grupos, cooperativas e usinas.', 'proposta', 'proposta', null, null, null, array['50 usuários','5.000 créditos da Ari/mês','24 h/ano de implantação sob medida'], array['Recursos do Profissional','Multiempresa, filiais, ESG e integração com ERP','Painéis executivos e atendimento dedicado'], '{}', 20),
  ('instituicao_extra_usuarios', 'instituicao', 'Mais usuários', 'Contas adicionais para servidores e setores.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['org_essencial','org_profissional','org_premium'], 21),
  ('instituicao_extra_ari', 'instituicao', 'Créditos da Ari', 'Créditos para consultas e análises.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['org_essencial','org_profissional','org_premium'], 22),
  ('instituicao_extra_treinamento', 'instituicao', 'Treinamento de equipe', 'Turma adicional presencial ou online.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['org_essencial','org_profissional','org_premium'], 23),
  ('instituicao_extra_implantacao', 'instituicao', 'Implantação sob medida', 'Projeto com escopo e prazo próprios.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['org_essencial','org_profissional','org_premium'], 24),
  ('empresa_extra_usuarios', 'empresa', 'Mais usuários', 'Contas para corretores, parceiros e equipe.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['empresa_essencial','empresa_profissional','empresa_premium'], 25),
  ('empresa_extra_areas', 'empresa', 'Mais áreas e lotes', 'Volume adicional de áreas, empreendimentos e propriedades da cadeia.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['empresa_essencial','empresa_profissional','empresa_premium'], 26),
  ('empresa_extra_whatsapp', 'empresa', 'WhatsApp com a Ari', 'Um número com atendimento por setor.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['empresa_essencial','empresa_profissional','empresa_premium'], 27),
  ('empresa_extra_parecer', 'empresa', 'Parecer técnico', 'Serviço de advogado, agrimensor ou profissional ambiental.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['empresa_essencial','empresa_profissional','empresa_premium'], 28),
  ('proprietario_anunciar', 'anunciar', 'Anunciar meu imóvel', 'Cadastre seu imóvel, envie os documentos e acompanhe a análise da equipe.', 'anuncio', 'gratuito', 0, null, null, array['Sem mensalidade para anunciar'], array['Cadastro do proprietário e do imóvel','Publicação no mapa após aprovação','Acompanhamento de interessados, visitas e propostas no painel'], '{}', 29),
  ('banco_piloto', 'correspondente', 'Piloto', 'Conheça o fluxo de pré-simulação e atendimento na sua região.', 'espera', 'gratuito', 0, null, 60, array['15 atendimentos por mês','2 usuários'], array['Verificação do CNPJ, banco e contrato de correspondência','Vaga sujeita à disponibilidade regional'], '{}', 30),
  ('banco_reserva', 'correspondente', 'Reserva da vaga', 'Faixa de baixo movimento para manter a vaga da região após o piloto.', 'espera', 'mensal', 29000, null, null, array['Até 3 atendimentos no mês'], array['A faixa depende do movimento do mês','Reserva vinculada à vaga aprovada'], '{}', 31),
  ('banco_essencial', 'correspondente', 'Essencial', 'Primeiros meses de atendimento.', 'espera', 'mensal', 59000, null, null, array['15 atendimentos por mês','2 usuários'], array['Vaga por banco e região mediante aprovação','Atendimentos repassados com consentimento do comprador','A simulação oficial, a análise e o contrato são conduzidos pelo banco'], '{}', 32),
  ('banco_regional', 'correspondente', 'Regional', 'Para uma região com movimento regular.', 'espera', 'mensal', 99000, null, null, array['40 atendimentos por mês','5 usuários'], array['Vaga por banco e região mediante aprovação','Atendimentos repassados com consentimento do comprador','A simulação oficial, a análise e o contrato são conduzidos pelo banco'], '{}', 33),
  ('banco_ampliado', 'correspondente', 'Ampliado', 'Para regiões de maior movimento e equipe.', 'espera', 'mensal', 179000, null, null, array['100 atendimentos por mês','10 usuários'], array['Vaga por banco e região mediante aprovação','Atendimentos repassados com consentimento do comprador','A simulação oficial, a análise e o contrato são conduzidos pelo banco'], '{}', 34),
  ('banco_intensivo', 'correspondente', 'Intensivo', 'Atendimento de alto volume.', 'espera', 'mensal', 329000, null, null, array['250 atendimentos por mês','20 usuários'], array['Vaga por banco e região mediante aprovação','Atendimentos repassados com consentimento do comprador','A simulação oficial, a análise e o contrato são conduzidos pelo banco'], '{}', 35),
  ('banco_extra_whatsapp', 'correspondente', 'CRM de atendimento com WhatsApp', 'Número empresarial e distribuição de conversas com apoio da Ari.', 'complemento', 'proposta', null, null, null, '{}', '{}', array['banco_piloto','banco_reserva','banco_essencial','banco_regional','banco_ampliado','banco_intensivo'], 36);

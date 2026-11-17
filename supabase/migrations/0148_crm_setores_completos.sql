-- 0148 · CRMs dos setores completos (Central de CRMs, "CRMs incompletos,
-- divididos em setores", áudio do Carlos de 17/11/2026).
--
-- A 0069 criou o motor e funis só para Jurídico, Operações, Cartografia e
-- Marketing (a 0129 somou Tráfego). Financeiro, Suporte, Segurança, Diretoria
-- e o pós-venda do Comercial ficavam sem funil. Aqui entram os funis que faltam,
-- com etapas, prazos e campos, e um item de CRM pode apontar para a tarefa ou o
-- chamado que o originou. Idempotente: cada funil só entra se o setor ainda não
-- tem um funil com o mesmo nome.

alter table public.crm_itens
  add column if not exists prioridade text not null default 'normal',
  add column if not exists prazo_final date,
  add column if not exists etiquetas text[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_itens_prioridade_check') then
    alter table public.crm_itens add constraint crm_itens_prioridade_check check (prioridade in ('baixa', 'normal', 'alta', 'urgente'));
  end if;
end $$;
create index if not exists idx_crm_itens_prazo_final on public.crm_itens (prazo_final) where status = 'aberto';

-- cria um funil com etapas (nome|sla|final) e campos (chave|rótulo|tipo|opções separadas por ;)
create or replace function pg_temp.funil(p_setor text, p_nome text, p_desc text, p_etapas text[], p_campos text[])
returns void language plpgsql as $$
declare
  p uuid; e text; c text; partes text[]; i int := 0;
begin
  if exists (select 1 from public.crm_pipelines where setor = p_setor and nome = p_nome) then return; end if;
  insert into public.crm_pipelines (setor, nome, descricao) values (p_setor, p_nome, p_desc) returning id into p;
  foreach e in array p_etapas loop
    i := i + 1;
    partes := string_to_array(e, '|');
    insert into public.crm_etapas (pipeline_id, nome, ordem, sla_horas, final)
    values (p, partes[1], i, nullif(partes[2], '')::int, coalesce(partes[3], '') = 'final');
  end loop;
  i := 0;
  foreach c in array coalesce(p_campos, '{}') loop
    i := i + 1;
    partes := string_to_array(c, '|');
    insert into public.crm_campos (pipeline_id, chave, rotulo, tipo, opcoes, ordem)
    values (p, partes[1], partes[2], coalesce(nullif(partes[3], ''), 'texto'),
            case when coalesce(partes[4], '') = '' then '{}'::text[] else string_to_array(partes[4], ';') end, i);
  end loop;
end $$;

select pg_temp.funil('comercial', 'Pós-venda', 'Da assinatura do contrato à entrega do imóvel e à avaliação do cliente.',
  array['Contrato assinado|48|', 'Escritura|240|', 'Registro em cartório|480|', 'Entrega das chaves / posse|168|', 'Pesquisa de satisfação|72|', 'Concluído||final'],
  array['cliente|Cliente|texto', 'cartorio|Cartório|texto', 'valor|Valor da venda|dinheiro', 'nota|Nota do cliente (0 a 10)|numero', 'indicacao|Indicou alguém?|bool']);

select pg_temp.funil('comercial', 'Parcerias e corretores', 'Prospecção de imobiliárias, corretores e engenheiros parceiros.',
  array['Prospecção|72|', 'Primeira reunião|120|', 'Cadastro e documentos|168|', 'Treinamento|168|', 'Parceiro ativo||final'],
  array['empresa|Empresa ou nome|texto', 'creci|CRECI|texto', 'cidade|Cidade|texto', 'tipo|Tipo|select|Imobiliária;Corretor;Engenheiro;Topógrafo']);

select pg_temp.funil('financeiro', 'Cobrança e inadimplência', 'Faturas vencidas até o acordo ou o pagamento.',
  array['Fatura vencida|24|', 'Primeiro contato|48|', 'Negociação|120|', 'Acordo fechado|168|', 'Pago ou baixado||final'],
  array['cliente|Cliente|texto', 'valor|Valor em aberto|dinheiro', 'vencimento|Vencimento|data', 'forma|Forma do acordo|select|À vista;Parcelado;Desconto;Baixa como perda']);

select pg_temp.funil('financeiro', 'Comissões e repasses', 'Da venda fechada ao pagamento de comissões e repasses aos parceiros.',
  array['A apurar|48|', 'Conferência|72|', 'Aprovação da Diretoria|48|', 'Nota fiscal|72|', 'Pago||final'],
  array['venda|Oportunidade ou venda|texto', 'beneficiario|Beneficiário|texto', 'valor|Valor|dinheiro', 'nf|Número da nota|texto']);

select pg_temp.funil('juridico', 'Contratos e escrituras', 'Minutas, revisões e assinaturas de contratos de compra e venda, exclusividade e parceria.',
  array['Minuta|72|', 'Revisão jurídica|72|', 'Ajustes com as partes|120|', 'Assinatura|72|', 'Registrado e arquivado||final'],
  array['tipo|Tipo de contrato|select|Compra e venda;Exclusividade;Parceria;Locação/arrendamento;Outro', 'partes|Partes|textarea', 'prazo_legal|Prazo legal|data']);

select pg_temp.funil('suporte', 'Implantação de clientes', 'Novos assinantes: boas-vindas, configuração e primeiro uso.',
  array['Novo assinante|24|', 'Boas-vindas|48|', 'Configuração da conta|72|', 'Treinamento|120|', 'Usando sozinho||final'],
  array['cliente|Cliente|texto', 'plano|Plano|texto', 'telefone|Telefone|texto']);

select pg_temp.funil('suporte', 'Melhorias pedidas', 'Sugestões e problemas recorrentes dos clientes até a entrega.',
  array['Recebida|72|', 'Em avaliação|168|', 'Aprovada||', 'Em desenvolvimento||', 'Entregue||final'],
  array['origem|Quem pediu|texto', 'impacto|Impacto|select|Baixo;Médio;Alto']);

select pg_temp.funil('seguranca', 'Incidentes de segurança', 'Do relato à correção e às lições aprendidas (LGPD: comunicar à ANPD em até 3 dias úteis quando houver risco).',
  array['Reportado|4|', 'Em análise|24|', 'Contido|48|', 'Corrigido|72|', 'Encerrado com relatório||final'],
  array['gravidade|Gravidade|select|Baixa;Média;Alta;Crítica', 'dados_pessoais|Envolve dados pessoais?|bool', 'anpd|Comunicado à ANPD em|data', 'acoes|Ações tomadas|textarea']);

select pg_temp.funil('seguranca', 'Pedidos de acesso', 'Novo acesso, troca de setor ou desligamento de membro da equipe.',
  array['Pedido|24|', 'Aprovação|24|', 'Executado|24|', 'Conferido||final'],
  array['pessoa|Pessoa|texto', 'tipo|Tipo|select|Novo acesso;Troca de setor;Desligamento', 'setores|Setores|texto']);

select pg_temp.funil('diretoria', 'Projetos e decisões', 'Iniciativas da empresa, da ideia à execução.',
  array['Ideia|168|', 'Em avaliação|168|', 'Aprovado|72|', 'Em execução||', 'Concluído||final'],
  array['patrocinador|Responsável na Diretoria|texto', 'investimento|Investimento previsto|dinheiro', 'prazo|Prazo|data']);

select pg_temp.funil('operacoes', 'Revisão de anúncios', 'Anúncios que voltaram para correção ou precisam de atualização.',
  array['Pedido de revisão|24|', 'Com o anunciante|120|', 'Conferência|24|', 'Revisado||final'],
  array['imovel|Código do imóvel|texto', 'motivo|O que corrigir|textarea']);

select pg_temp.funil('cartografia', 'Plantas e georreferenciamento', 'Plantas urbanas e glebas a calibrar, conferir e publicar no mapa.',
  array['Recebida|48|', 'Calibração|120|', 'Conferência|48|', 'Publicada no mapa||final'],
  array['municipio|Município|texto', 'arquivo|Arquivo (DWG/DXF/PDF)|texto']);

select pg_temp.funil('marketing', 'Campanhas de lançamento', 'Lançamento de imóveis e empreendimentos: material, aprovação e publicação.',
  array['Briefing|48|', 'Criação|120|', 'Aprovação|48|', 'Publicação|24|', 'Publicado||final'],
  array['imovel|Imóvel ou empreendimento|texto', 'canais|Canais|texto']);

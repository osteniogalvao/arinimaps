/**
 * Textos jurídicos da plataforma.
 *
 * Cada documento tem um `id` e uma `versao`. O aceite grava `id@versao`
 * (ex.: "autorizacao@1.0") junto com data, hora, usuário e IP — é o que a
 * especificação exige no item 8: "guardar a versão do termo/contrato aceito,
 * data, hora e usuário". Mudou o texto de forma relevante? Suba a versão:
 * aceites antigos continuam apontando para o texto que a pessoa leu.
 *
 * Os dados da empresa (razão social, CNPJ, CRECI, foro) e as regras
 * comerciais (percentual, mensalidade, prazos) vêm de Admin › Configurações,
 * então o texto nunca sai de sincronia com o que o sistema cobra.
 *
 * ATENÇÃO: minuta. A própria especificação (itens 8 e 24.2) exige validação
 * pelo jurídico antes do uso — ver PENDENCIAS.md.
 */
import { numero, texto } from "@/lib/settings";

export type Secao = { titulo: string; itens: string[] };

export type Documento = {
  id: DocId;
  titulo: string;
  resumo: string;
  versao: string;
  vigencia: string;
  paraQuem: string;
  secoes: Secao[];
};

export type DocId = "termos-de-uso" | "privacidade" | "autorizacao" | "exclusividade" | "remuneracao" | "parceiros";

/** Versão vigente de cada documento. É isso que vai para o banco no aceite. */
export const VERSOES: Record<DocId, string> = {
  "termos-de-uso": "1.0",
  privacidade: "1.1",
  autorizacao: "1.0",
  exclusividade: "1.1",
  remuneracao: "1.0",
  parceiros: "1.1",
};
const VIGENCIA = "23/09/2026";

export const assinatura = (...ids: DocId[]) => ids.map((id) => `${id}@${VERSOES[id]}`).join(",");

/** Campo não preenchido aparece marcado, para ninguém publicar sem perceber. */
const falta = (o: string) => `〔${o} — preencher em Admin › Configurações〕`;

function dados(cfg: Record<string, unknown>) {
  const pct = numero(cfg, "comissao_percentual_padrao", 1.9);
  const mensal = numero(cfg, "mensalidade_valor_padrao", 0);
  const empresa = texto(cfg, "juridico_razao_social", "Arini Negócios Imobiliários");
  return {
    sistema: texto(cfg, "nome_sistema", "Arini Imóveis Brasil"),
    empresa,
    qualificacao:
      `${empresa}, inscrita no CNPJ sob o nº ${texto(cfg, "juridico_cnpj", falta("CNPJ"))}, ` +
      `registrada no CRECI sob o nº ${texto(cfg, "juridico_creci", falta("CRECI-J"))}, ` +
      `com sede em ${texto(cfg, "juridico_endereco", falta("endereço da sede"))}`,
    pct: `${pct.toLocaleString("pt-BR")}% (${extenso(pct)})`,
    mensalidade: mensal > 0
      ? `R$ ${mensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} por imóvel publicado, por mês`
      : "isenta enquanto o valor estiver fixado em zero pela Arini; qualquer cobrança futura será avisada com pelo menos 30 (trinta) dias de antecedência e só valerá a partir do aviso",
    cobraMensalidade: mensal > 0,
    tolerancia: numero(cfg, "suspensao_dias", 15),
    prazoAut: numero(cfg, "juridico_prazo_autorizacao_dias", 180),
    protecao: numero(cfg, "juridico_protecao_meses", 12),
    foro: texto(cfg, "juridico_foro", falta("comarca do foro")),
    encarregado: texto(cfg, "juridico_encarregado_email", texto(cfg, "email_contato", falta("e-mail do encarregado de dados"))),
    site: process.env.NEXT_PUBLIC_SITE_URL ?? "",
  };
}

function extenso(n: number) {
  const t: Record<number, string> = { 0.5: "meio por cento", 1: "um por cento", 1.5: "um e meio por cento", 1.9: "um vírgula nove por cento", 2: "dois por cento", 3: "três por cento", 4: "quatro por cento", 5: "cinco por cento", 6: "seis por cento" };
  return t[n] ?? `${n.toLocaleString("pt-BR")} por cento`;
}

export function documentos(cfg: Record<string, unknown>): Documento[] {
  const d = dados(cfg);
  const base = { vigencia: VIGENCIA };

  const termos: Documento = {
    ...base,
    id: "termos-de-uso",
    versao: VERSOES["termos-de-uso"],
    titulo: "Termos de Uso",
    paraQuem: "Todos que usam a plataforma",
    resumo: "Regras de uso do mapa, das consultas e dos anúncios, e o que a Arini garante e não garante.",
    secoes: [
      {
        titulo: "Quem somos e o que é a plataforma",
        itens: [
          `A plataforma ${d.sistema} é operada por ${d.qualificacao} ("Arini").`,
          "A plataforma reúne, sobre um mapa, anúncios de imóveis rurais e urbanos, a cartografia das cidades atendidas e consultas a fontes públicas oficiais, e encaminha à Arini os interesses de compra para intermediação.",
          "Ao criar uma conta ou usar a plataforma, você declara ter lido e aceitado estes Termos e a Política de Privacidade. Se não concordar, não use a plataforma.",
        ],
      },
      {
        titulo: "Contas e cadastro",
        itens: [
          "A conta é pessoal e vinculada a um CPF (ou CNPJ, no caso de imobiliária). Cada documento só pode ter uma conta.",
          "Você se compromete a informar dados verdadeiros e atualizados e responde pelas informações que cadastra. Cadastro com dado falso ou de terceiro pode ser recusado ou encerrado a qualquer momento.",
          "Você é responsável pela guarda da sua senha e por tudo que for feito com a sua conta. Suspeitou de uso indevido, avise a Arini imediatamente.",
          "Cadastros de proprietário e de parceiro (imobiliária, corretor, engenheiro ou outro profissional) passam por análise da Arini, que pode pedir documentos e recusar o cadastro sem obrigação de justificar, para proteger a plataforma contra fraudes.",
        ],
      },
      {
        titulo: "Anúncios e aprovação",
        itens: [
          "Nenhum imóvel é publicado sem aprovação manual da Arini. Para anunciar, é obrigatório enviar, no cadastro do imóvel, documento que comprove a propriedade (matrícula atualizada, escritura ou contrato registrado) e, no caso de parceiro, a autorização de venda assinada pelo proprietário. A Arini confere esses documentos antes de aprovar, pode pedir correções e outros documentos, e pode recusar, suspender ou retirar anúncios, inclusive já publicados.",
          "A plataforma exibe a malha pública do Cadastro Ambiental Rural (CAR/SICAR) para facilitar a localização da área. O CAR é autodeclarado e não comprova propriedade: a divisa trazida dele é um ponto de partida, e a prova de propriedade é sempre o documento conferido pela Arini.",
          "Quem anuncia declara ser proprietário do imóvel ou estar autorizado por escrito pelo proprietário, e aceita o Termo de Autorização de Venda (ou o Termo de Exclusividade, ou o Termo de Parceria, conforme o caso) e a Regra de Remuneração.",
          "A aprovação da Arini é uma verificação de consistência do anúncio, não uma auditoria jurídica do imóvel. Ela não substitui certidões, análise de matrícula, due diligence nem a assessoria de advogado ou profissional habilitado na compra.",
          "É proibido anunciar imóvel sem autorização, com preço, área ou localização falsos, com fotos de outro imóvel, ou usar a plataforma para qualquer finalidade ilícita.",
        ],
      },
      {
        titulo: "Mapa, cartografia e relatórios territoriais",
        itens: [
          "A divisa desenhada ou importada (KML/KMZ) é informada pelo anunciante. A área e o perímetro calculados pela plataforma são estimativas a partir dessa geometria e não substituem o georreferenciamento certificado (INCRA/SIGEF), a matrícula nem o levantamento topográfico.",
          "As plantas urbanas são cartografia de referência, ajustadas visualmente sobre imagem de satélite. Podem ter diferenças de alguns metros e não servem para demarcação de lote.",
          "Os relatórios territoriais cruzam a geometria do imóvel com bases públicas de terceiros (como ANM, FUNAI, INPE, ANA, ANEEL e IBGE), na data indicada em cada consulta. A Arini não produz esses dados e não responde por erro, atraso ou indisponibilidade dos órgãos de origem.",
          "Fonte que não respondeu aparece no relatório como \"fonte indisponível\", e isso não significa ausência de restrição. Resultado \"nada encontrado\" em uma fonte não equivale a certidão negativa. Bases que dependem de arquivo oficial (como CAR, SIGEF, embargos do IBAMA, territórios quilombolas e IPHAN) só são consideradas quando indicadas como consultadas.",
          "Relatório territorial é informativo e não é laudo, parecer técnico nem certidão. Decisão de compra deve ser tomada com as certidões e documentos oficiais do imóvel.",
        ],
      },
      {
        titulo: "Interesse, intermediação e não desintermediação",
        itens: [
          "O botão \"Tenho interesse\" envia seus dados à Arini, que faz o primeiro contato e conduz a intermediação, diretamente ou por parceiro indicado por ela. O contato do proprietário não é exibido publicamente.",
          "Quem recebe, pela plataforma, informação de um imóvel que não estava disponível publicamente (contato do proprietário, localização exata, documentos, condições) compromete-se a não usá-la para negociar por fora da intermediação, e responde por perdas e danos se o fizer.",
          "As regras de remuneração da Arini estão na Regra de Remuneração. Comprador não paga nada à Arini para usar a plataforma nem para demonstrar interesse, salvo contrato escrito específico.",
        ],
      },
      {
        titulo: "Conteúdo e propriedade intelectual",
        itens: [
          "Ao enviar fotos, vídeos, textos e geometrias, você declara ter o direito de usá-los e autoriza a Arini, sem custo e enquanto o anúncio existir, a publicá-los, adaptá-los e usá-los para gerar tour 3D, vídeo, imagem de compartilhamento e material de divulgação do imóvel, inclusive em redes sociais e portais parceiros.",
          "A marca, o software, o layout e as bases organizadas pela Arini são protegidos. É proibido copiar, raspar (scraping) ou reproduzir em massa o conteúdo da plataforma sem autorização escrita.",
          "Imagens de satélite, mapas-base e dados públicos pertencem aos respectivos fornecedores e seguem suas próprias licenças, indicadas no mapa.",
        ],
      },
      {
        titulo: "Disponibilidade e responsabilidade",
        itens: [
          "A Arini se esforça para manter a plataforma no ar, mas não garante funcionamento ininterrupto. Manutenções, falhas de terceiros (hospedagem, provedores de mapa, órgãos públicos) e casos fortuitos podem interromper o serviço.",
          "A Arini não é parte na compra e venda: o negócio é celebrado entre vendedor e comprador. A Arini responde pelos serviços de intermediação que presta, nos termos da lei e dos contratos assinados, e não pelas obrigações do vendedor ou do comprador entre si.",
          "Nada nestes Termos afasta direitos garantidos ao consumidor pelo Código de Defesa do Consumidor (Lei nº 8.078/1990).",
        ],
      },
      {
        titulo: "Suspensão, alterações e foro",
        itens: [
          "A Arini pode suspender ou encerrar contas que violem estes Termos, a lei ou que ofereçam risco de fraude a outros usuários, preservando os registros exigidos por lei.",
          "Estes Termos podem ser atualizados. A versão vigente fica sempre publicada com a data de vigência. Mudança relevante será avisada na plataforma e, quando exigir novo aceite, ele será pedido no próximo acesso.",
          "Aplicam-se as leis brasileiras. Fica eleito o foro da comarca de " + d.foro + ", ressalvado ao consumidor o direito de propor ação no foro do seu domicílio.",
        ],
      },
    ],
  };

  const privacidade: Documento = {
    ...base,
    id: "privacidade",
    versao: VERSOES.privacidade,
    titulo: "Política de Privacidade",
    paraQuem: "Todos que usam a plataforma",
    resumo: "Quais dados pessoais coletamos, para quê, com quem compartilhamos e como exercer seus direitos (LGPD).",
    secoes: [
      {
        titulo: "Controlador e encarregado",
        itens: [
          `O controlador dos dados pessoais tratados na plataforma ${d.sistema} é ${d.qualificacao}.`,
          `O encarregado pelo tratamento de dados pessoais (art. 41 da Lei nº 13.709/2018, LGPD) pode ser contatado pelo e-mail ${d.encarregado}.`,
        ],
      },
      {
        titulo: "Dados que coletamos",
        itens: [
          "Cadastro: nome, CPF ou CNPJ, e-mail, telefone, perfil de uso e, para parceiros, razão social e registro profissional (CRECI/CREA).",
          "Imóvel: dados do anúncio, geometria (desenhada, importada ou trazida do CAR público), fotos, vídeos e os documentos de comprovação enviados para análise (como matrícula, CCIR, ITR, IPTU e autorizações), guardados em área privada, acessível só ao anunciante e à equipe da Arini.",
          "Interesse em imóvel: nome, telefone, e-mail e mensagem informados no formulário, e o imóvel de interesse.",
          "Negociação: visitas, propostas, contratos e valores registrados pela Arini e pelos parceiros no curso da intermediação.",
          "Aceite da exclusividade: uma foto do rosto (selfie) de quem aceita o termo, usada só para conferência visual de identidade pela equipe da Arini. Não fazemos reconhecimento facial nem extraímos dado biométrico da imagem.",
          "Segurança da conta: registros de entrada, tentativas de acesso, troca de senha e uso do segundo fator, com data, hora, endereço IP e navegador.",
          "Suporte e pedidos de titulares: o que você escreve nos chamados e nos pedidos sobre seus dados pessoais.",
          "Navegação: endereço IP, data e hora de acesso, navegador e páginas acessadas, e cookies estritamente necessários para manter a sessão. A preferência de tema claro ou escuro fica guardada só no seu navegador.",
        ],
      },
      {
        titulo: "Para que usamos e com que base legal",
        itens: [
          "Criar e manter sua conta, publicar anúncios e conduzir a intermediação: execução de contrato e de procedimentos preliminares (art. 7º, V, da LGPD).",
          "Responder ao seu interesse em um imóvel e encaminhá-lo ao proprietário ou ao parceiro responsável: consentimento dado no formulário (art. 7º, I) e execução de procedimentos preliminares a contrato (art. 7º, V).",
          "Verificar identidade, titularidade e autorização, e prevenir fraudes: legítimo interesse da Arini e dos usuários (art. 7º, IX) e proteção ao crédito quando aplicável.",
          "Cumprir obrigações legais e regulatórias, como a guarda de registros de acesso (Lei nº 12.965/2014, art. 15), obrigações fiscais e as de prevenção à lavagem de dinheiro aplicáveis ao setor imobiliário (Lei nº 9.613/1998): art. 7º, II.",
          "Exercer direitos em processo judicial ou administrativo, como a cobrança de remuneração: art. 7º, VI.",
          "Não vendemos dados pessoais e não os usamos para publicidade de terceiros.",
        ],
      },
      {
        titulo: "Com quem compartilhamos",
        itens: [
          "Com o proprietário ou o parceiro responsável pelo imóvel, apenas quando necessário para a negociação que você iniciou.",
          "Com fornecedores que operam a plataforma em nosso nome, limitados ao necessário: hospedagem e banco de dados, envio de e-mail, processamento de pagamentos, armazenamento de arquivos e provedores de mapa (que recebem o IP do navegador ao carregar as imagens). Alguns desses fornecedores podem armazenar dados fora do Brasil, com as garantias do art. 33 da LGPD.",
          "Com autoridades, quando exigido por lei ou por ordem judicial.",
          "Os anúncios publicados (título, descrição, preço, fotos, geometria e município) são públicos por natureza. Dados pessoais do anunciante não são exibidos no anúncio.",
        ],
      },
      {
        titulo: "Por quanto tempo guardamos",
        itens: [
          "Dados de conta: enquanto a conta existir e, depois do encerramento, pelo prazo necessário para cumprir obrigações legais e exercer direitos, em regra até 5 (cinco) anos.",
          "Registros de acesso: no mínimo 6 (seis) meses, como exige o Marco Civil da Internet.",
          "Registros de negociação, venda, comissão e pagamento: no mínimo 5 (cinco) anos, por exigências fiscais e de prevenção à lavagem de dinheiro.",
          "Interesses que não viraram negociação: até 24 (vinte e quatro) meses, salvo pedido de exclusão antes disso.",
          "A trilha de auditoria da plataforma é imutável por desenho: registra quem fez cada ação e quando, para proteger os próprios usuários contra fraude.",
        ],
      },
      {
        titulo: "Seus direitos",
        itens: [
          "Você pode pedir, a qualquer momento e sem custo: confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação do que for desnecessário, portabilidade, informação sobre compartilhamento e revogação do consentimento (art. 18 da LGPD).",
          `Os pedidos são feitos pelo e-mail ${d.encarregado}. Podemos pedir confirmação de identidade antes de atender, para proteger seus próprios dados.`,
          "A eliminação não alcança os dados que a lei nos obriga a guardar nem os necessários para exercer direitos, que ficam bloqueados para outros usos até o fim do prazo.",
          "Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).",
        ],
      },
      {
        titulo: "Segurança",
        itens: [
          "Usamos conexão criptografada, controle de acesso por perfil no banco de dados (cada usuário só enxerga o que lhe cabe), documentos em armazenamento privado e trilha de auditoria.",
          "Nenhum sistema é totalmente imune a incidentes. Se ocorrer incidente com risco relevante a você, avisaremos você e a ANPD nos termos da lei.",
        ],
      },
    ],
  };

  const autorizacao: Documento = {
    ...base,
    id: "autorizacao",
    versao: VERSOES.autorizacao,
    titulo: "Termo de Autorização de Venda e Intermediação",
    paraQuem: "Proprietário que anuncia o próprio imóvel",
    resumo: `Autoriza a Arini a anunciar e intermediar a venda do imóvel, sem exclusividade, por ${d.prazoAut} dias renováveis.`,
    secoes: [
      {
        titulo: "Partes e objeto",
        itens: [
          `Este termo é celebrado entre o anunciante identificado no cadastro da plataforma ("Proprietário") e ${d.qualificacao} ("Arini"), e vale para o imóvel identificado pelo código ARINI-MAP gerado no cadastro, com a descrição, o preço e as condições informados no anúncio.`,
          "O Proprietário autoriza a Arini, sem exclusividade, a anunciar o imóvel na plataforma e nos canais de divulgação da Arini, apresentá-lo a interessados, agendar e acompanhar visitas, receber e transmitir propostas e intermediar a negociação até a venda, nos termos dos arts. 722 a 729 do Código Civil e da Lei nº 6.530/1978.",
          "A Arini pode acionar imobiliária ou corretor parceiro devidamente registrado para atender interessados, permanecendo responsável pela intermediação perante o Proprietário.",
        ],
      },
      {
        titulo: "Declarações do Proprietário",
        itens: [
          "O Proprietário declara que é titular do imóvel ou que tem poderes para vendê-lo (procuração, inventário, cônjuge anuente quando exigido etc.), e que as informações do anúncio são verdadeiras.",
          "Declara também que informou à Arini todo ônus, gravame, ação judicial, posse de terceiro, pendência ambiental ou fiscal que conheça sobre o imóvel.",
          "Entrega, no cadastro do anúncio, a matrícula atualizada do imóvel (ou escritura/contrato registrado), sem a qual o anúncio não é publicado, e se compromete a entregar os demais documentos que a Arini pedir para a análise e a venda (como CCIR, ITR e CAR para imóvel rural; IPTU e certidões para imóvel urbano), além de permitir visitas agendadas.",
        ],
      },
      {
        titulo: "Prazo e revogação",
        itens: [
          `A autorização vale por ${d.prazoAut} dias contados do aceite e se renova automaticamente por períodos iguais enquanto o anúncio estiver ativo.`,
          "O Proprietário pode revogá-la a qualquer tempo, pela plataforma ou por escrito à Arini. A revogação retira o anúncio do ar, mas não afasta a remuneração devida pelos interessados já apresentados pela Arini, conforme a Regra de Remuneração.",
          "Venda, promessa de venda ou retirada do imóvel do mercado devem ser comunicadas à Arini em até 5 (cinco) dias úteis.",
        ],
      },
      {
        titulo: "Remuneração",
        itens: [
          `Concluída a venda com interessado apresentado pela Arini, o Proprietário paga à Arini a remuneração de ${d.pct} sobre o valor total da operação, nas condições da Regra de Remuneração, que integra este termo.`,
          `Mensalidade de permanência do anúncio: ${d.mensalidade}.`,
          "Sem exclusividade, a venda feita diretamente pelo Proprietário a comprador que não foi apresentado pela Arini nem por seus parceiros não gera remuneração (art. 726 do Código Civil).",
        ],
      },
      {
        titulo: "Aceite eletrônico",
        itens: [
          "O aceite deste termo na plataforma, com login pessoal vinculado ao CPF ou CNPJ, tem validade de assinatura eletrônica entre as partes (art. 10, § 2º, da MP nº 2.200-2/2001). A plataforma registra a versão do termo, a data, a hora, o usuário e o IP do aceite.",
          "A Arini pode pedir, a seu critério, a assinatura de contrato de intermediação em papel ou com certificado digital, que prevalecerá sobre este termo no que dispuser de forma diferente.",
          "Foro da comarca de " + d.foro + ".",
        ],
      },
    ],
  };

  const exclusividade: Documento = {
    ...base,
    id: "exclusividade",
    versao: VERSOES.exclusividade,
    titulo: "Termo de Exclusividade",
    paraQuem: "Proprietário que escolhe a exclusividade Arini",
    resumo: "Complementa a autorização: durante o prazo, só a Arini (e parceiros indicados por ela) intermedia a venda.",
    secoes: [
      {
        titulo: "Objeto",
        itens: [
          "Este termo complementa o Termo de Autorização de Venda e Intermediação, que continua valendo em tudo que não for alterado aqui.",
          `Durante o prazo deste termo, o Proprietário confere à ${d.empresa} ("Arini") a exclusividade na intermediação da venda do imóvel identificado pelo código ARINI-MAP gerado no cadastro. Imobiliárias e corretores só atuam na venda por indicação da Arini.`,
        ],
      },
      {
        titulo: "Prazo",
        itens: [
          `A exclusividade vale por ${d.prazoAut} dias contados do aceite. Ao fim do prazo, o imóvel continua anunciado com autorização sem exclusividade, salvo nova escolha do Proprietário.`,
          "Antes do fim do prazo, o Proprietário pode encerrar a exclusividade se a Arini deixar de cumprir as obrigações do item seguinte, avisando por escrito e dando 10 (dez) dias para correção.",
        ],
      },
      {
        titulo: "Obrigações da Arini na exclusividade",
        itens: [
          "Analisar e, estando em ordem, publicar o anúncio em até 10 (dez) dias úteis do envio completo.",
          "Responder a todo interessado em até 2 (dois) dias úteis e manter o Proprietário informado sobre visitas e propostas.",
          "Divulgar o imóvel ativamente, com geometria, fotos e, quando possível, tour 3D e vídeo.",
        ],
      },
      {
        titulo: "Obrigações do Proprietário e remuneração",
        itens: [
          "Durante o prazo, o Proprietário não anuncia o imóvel com outra imobiliária ou corretor e encaminha à Arini qualquer interessado que o procure diretamente.",
          "No aceite eletrônico deste termo, o Proprietário envia uma foto do próprio rosto (selfie). A foto serve apenas para a equipe da Arini conferir, visualmente, que quem aceitou é a pessoa do documento apresentado; fica guardada em área privada junto do registro do aceite, pelo prazo de guarda dos registros de negociação, e não é usada para reconhecimento facial nem para qualquer tratamento automatizado.",
          `Se o imóvel for vendido durante o prazo, a remuneração de ${d.pct} sobre o valor total da operação é devida à Arini ainda que a venda tenha ocorrido sem a sua mediação, salvo se comprovada a sua inércia ou ociosidade (art. 726 do Código Civil).`,
          "Considera-se inércia, entre outros casos, o descumprimento reiterado das obrigações do item anterior, desde que o Proprietário tenha avisado por escrito.",
        ],
      },
    ],
  };

  const remuneracao: Documento = {
    ...base,
    id: "remuneracao",
    versao: VERSOES.remuneracao,
    titulo: "Regra de Remuneração",
    paraQuem: "Proprietários e parceiros que anunciam",
    resumo: `Quando e como a Arini é remunerada: ${d.pct} sobre a venda e a mensalidade de permanência do anúncio.`,
    secoes: [
      {
        titulo: "Remuneração pela venda",
        itens: [
          `A Arini é remunerada com ${d.pct} sobre o valor total da operação de venda do imóvel anunciado, quando a venda resultar de interessado apresentado pela Arini ou por parceiro por ela acionado.`,
          "Valor total da operação é o preço ajustado no instrumento de compra e venda, somando entrada, parcelas e o valor atribuído a bens recebidos em permuta ou dação.",
          "A remuneração é devida quando obtido o resultado útil, ou seja, quando vendedor e comprador assinam o compromisso, contrato ou escritura de compra e venda (o que ocorrer primeiro), ainda que o negócio não se concretize depois por arrependimento das partes (art. 725 do Código Civil).",
          "O pagamento vence em até 5 (cinco) dias úteis da assinatura, por boleto, PIX ou outro meio indicado pela Arini. Em venda parcelada, as partes podem ajustar por escrito o pagamento proporcional às parcelas recebidas.",
        ],
      },
      {
        titulo: "Quem paga",
        itens: [
          "Imóvel anunciado pelo proprietário: a remuneração é paga pelo proprietário vendedor.",
          "Imóvel anunciado por parceiro (imobiliária ou corretor): a remuneração da Arini é paga pelo parceiro responsável pelo anúncio, conforme o Termo de Parceria, independentemente da comissão que ele contratou com o proprietário.",
          "Quando mais de um parceiro participar da mesma venda, a divisão entre eles é a registrada por escrito na oportunidade. A plataforma registra os participantes e os eventos, mas não presume divisão que não tenha sido acordada.",
          "O comprador não paga remuneração à Arini, salvo contrato escrito específico.",
        ],
      },
      {
        titulo: "Proteção contra desintermediação",
        itens: [
          "Considera-se apresentado pela Arini todo interessado registrado na plataforma para o imóvel (formulário de interesse, contato encaminhado, visita ou proposta), com data e hora na trilha de auditoria.",
          `A remuneração continua devida se a venda a esse interessado, ao seu cônjuge, parente ou empresa de que participe, ocorrer diretamente entre as partes durante a autorização ou em até ${d.protecao} meses depois do seu término, por efeito do trabalho de apresentação da Arini (art. 727 do Código Civil).`,
          "Omitir da Arini negociação com interessado apresentado por ela sujeita o responsável ao pagamento da remuneração integral, corrigida, e a perdas e danos.",
        ],
      },
      {
        titulo: "Mensalidade de permanência do anúncio",
        itens: [
          `Mensalidade: ${d.mensalidade}.`,
          ...(d.cobraMensalidade
            ? [
                "A mensalidade é cobrada por competência mensal enquanto o anúncio estiver publicado, a partir da publicação.",
                `Após ${d.tolerancia} dias de atraso, a fatura é marcada como vencida e o anúncio pode ser suspenso até a regularização. A suspensão não apaga o anúncio nem o histórico.`,
                "A mensalidade não é abatida da remuneração pela venda, e a remuneração pela venda não depende da mensalidade estar em dia.",
              ]
            : []),
        ],
      },
      {
        titulo: "Atraso e reajuste",
        itens: [
          "Valores em atraso sofrem correção pelo IPCA, juros de 1% (um por cento) ao mês e multa de 2% (dois por cento).",
          "Alteração do percentual ou da mensalidade só vale para autorizações aceitas depois da mudança. Quem já anuncia é avisado com pelo menos 30 (trinta) dias de antecedência e pode retirar o anúncio sem custo antes da nova regra valer.",
        ],
      },
    ],
  };

  const parceiros: Documento = {
    ...base,
    id: "parceiros",
    versao: VERSOES.parceiros,
    titulo: "Termo de Parceria",
    paraQuem: "Imobiliárias, corretores e profissionais parceiros",
    resumo: "Regras para parceiros: registro profissional, autorização escrita do proprietário, leads pela Arini e remuneração.",
    secoes: [
      {
        titulo: "Objeto e habilitação",
        itens: [
          `Este termo regula a atuação de imobiliárias, corretores autônomos, engenheiros e outros profissionais ("Parceiro") na plataforma ${d.sistema}, operada por ${d.qualificacao} ("Arini").`,
          "O Parceiro que intermedia imóveis declara ter inscrição regular no CRECI (Lei nº 6.530/1978); o leiloeiro, matrícula regular na Junta Comercial (Decreto nº 21.981/1932); e o profissional técnico, registro regular no conselho da sua profissão. A inscrição deve ser mantida válida durante toda a parceria, e a Arini pode pedir comprovação a qualquer tempo.",
          "O cadastro do Parceiro só é ativado após aprovação da Arini.",
        ],
      },
      {
        titulo: "Anúncios de Parceiro",
        itens: [
          "O Parceiro só anuncia imóvel para o qual tenha autorização escrita do proprietário, válida e compatível com o anúncio (preço, prazo e condições), e a envia à Arini no cadastro do anúncio, junto com a matrícula do imóvel. É vedado anunciar imóvel sem essa autorização.",
          "O leiloeiro oficial anuncia imóveis de leilão com base no edital publicado, que envia no cadastro do anúncio e que substitui a autorização do proprietário. Os lances são recebidos pelo leiloeiro, nas condições do edital; a plataforma apenas divulga o leilão e encaminha interessados.",
          "O franqueado representa a Arini numa região definida pela Matriz e atua como parceiro nessa região. A análise, a aprovação e a publicação dos anúncios permanecem com a Matriz.",
          "O Parceiro responde pela veracidade do anúncio perante a Arini, os compradores e o proprietário.",
          "Terminada ou revogada a autorização do proprietário, o Parceiro deve retirar o anúncio da plataforma imediatamente.",
        ],
      },
      {
        titulo: "Interessados e atendimento",
        itens: [
          "Todo interesse gerado pela plataforma chega primeiro à Arini, que o qualifica e aciona o Parceiro responsável. O Parceiro atende o interessado, registra visitas e propostas na plataforma e mantém a Arini informada até o fechamento ou a perda da oportunidade.",
          "É vedado ao Parceiro desviar para fora da plataforma negociação com interessado recebido por ela, ou oferecer a esse interessado imóvel semelhante sem registrar na oportunidade.",
          "O Parceiro trata os dados pessoais recebidos apenas para a negociação que originou o contato, com a mesma proteção exigida pela LGPD, e responde como controlador pelo uso que fizer deles.",
        ],
      },
      {
        titulo: "Remuneração",
        itens: [
          `Sobre a venda de imóvel anunciado pelo Parceiro e concluída com interessado recebido pela plataforma, o Parceiro paga à Arini ${d.pct} do valor total da operação, nas condições da Regra de Remuneração.`,
          "A comissão contratada entre o Parceiro e o proprietário é do Parceiro e não é alterada por este termo.",
          "Quando um Parceiro apresenta o imóvel e outro apresenta o comprador, a divisão entre eles é a registrada por escrito na oportunidade, antes da proposta. Sem registro, cada Parceiro só tem direito ao que contratou diretamente com a sua parte.",
        ],
      },
      {
        titulo: "Conduta, suspensão e encerramento",
        itens: [
          "O Parceiro atua com ética profissional, sem publicidade enganosa e sem prometer ao comprador o que não pode cumprir.",
          "A Arini pode suspender ou descredenciar o Parceiro que descumprir este termo, com aviso e oportunidade de manifestação, salvo em caso de fraude, quando a suspensão é imediata.",
          "Qualquer das partes pode encerrar a parceria com aviso de 30 (trinta) dias. As remunerações por vendas de interessados apresentados antes do encerramento continuam devidas.",
          "Foro da comarca de " + d.foro + ".",
        ],
      },
    ],
  };

  return [termos, privacidade, autorizacao, exclusividade, remuneracao, parceiros];
}

export function documento(cfg: Record<string, unknown>, id: string) {
  return documentos(cfg).find((doc) => doc.id === id) ?? null;
}

/** IP de origem do aceite (atrás do proxy do Dokploy vem no x-forwarded-for). */
export function ipDe(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  );
}

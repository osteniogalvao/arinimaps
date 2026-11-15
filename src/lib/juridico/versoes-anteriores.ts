import { dados, type Documento } from "./legado";

const base = { vigencia: "23/09/2026" };

export function modeloAnterior(cfg: Record<string, unknown>, id: string, versao: string): Documento | null {
  const d = dados(cfg);
  if (id === "privacidade" && versao === "1.0") return {
    ...base,
    id: "privacidade",
    versao: versao,
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
  if (id === "privacidade" && versao === "1.1") return {
    ...base,
    id: "privacidade",
    versao: versao,
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
  if (id === "exclusividade" && versao === "1.0") return {
    ...base,
    id: "exclusividade",
    versao: versao,
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
          `Se o imóvel for vendido durante o prazo, a remuneração de ${d.pct} sobre o valor total da operação é devida à Arini ainda que a venda tenha ocorrido sem a sua mediação, salvo se comprovada a sua inércia ou ociosidade (art. 726 do Código Civil).`,
          "Considera-se inércia, entre outros casos, o descumprimento reiterado das obrigações do item anterior, desde que o Proprietário tenha avisado por escrito.",
        ],
      },
    ],
  };
  if (id === "exclusividade" && versao === "1.1") return {
    ...base,
    id: "exclusividade",
    versao: versao,
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
  if (id === "parceiros" && versao === "1.0") return {
    ...base,
    id: "parceiros",
    versao: versao,
    titulo: "Termo de Parceria",
    paraQuem: "Imobiliárias, corretores e profissionais parceiros",
    resumo: "Regras para parceiros: registro profissional, autorização escrita do proprietário, leads pela Arini e remuneração.",
    secoes: [
      {
        titulo: "Objeto e habilitação",
        itens: [
          `Este termo regula a atuação de imobiliárias, corretores autônomos, engenheiros e outros profissionais ("Parceiro") na plataforma ${d.sistema}, operada por ${d.qualificacao} ("Arini").`,
          "O Parceiro que intermedia imóveis declara ter inscrição regular no CRECI (Lei nº 6.530/1978), e o profissional técnico declara registro regular no conselho da sua profissão. A inscrição deve ser mantida válida durante toda a parceria, e a Arini pode pedir comprovação a qualquer tempo.",
          "O cadastro do Parceiro só é ativado após aprovação da Arini.",
        ],
      },
      {
        titulo: "Anúncios de Parceiro",
        itens: [
          "O Parceiro só anuncia imóvel para o qual tenha autorização escrita do proprietário, válida e compatível com o anúncio (preço, prazo e condições), e se compromete a apresentá-la à Arini quando pedida. É vedado anunciar imóvel sem essa autorização.",
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
  return null;
}

import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

type Fluxo = {
  titulo: string;
  descricao: string;
  acao: [texto: string, destino: string];
  imagem?: [nome: string, legenda: string, largura: number, altura: number];
  legenda?: [nome: string, cor: string][];
  etapas?: [titulo: string, descricao: string][];
};

const FLUXOS: Record<string, Fluxo> = {
  vender: {
    titulo: "O mapa é seu, e os imóveis à venda estão nele",
    descricao: "Veja os imóveis urbanos e rurais à venda no mapa. Selecione uma área para abrir o anúncio e consultar as informações publicadas.",
    acao: ["Explorar o mapa", "/mapa"],
    imagem: ["propriedade", "Exemplo de uma propriedade demarcada e imóveis à venda na região.", 480, 280],
    legenda: [["Seu imóvel", "#124431"], ["Imóveis à venda", "#D9BD6F"]],
  },
  corretor: {
    titulo: "Duas formas de usar a ARINI",
    descricao: "O CRM do escritório e a participação na rede são escolhas independentes. Você pode combinar os dois.",
    acao: ["Consultar o termo da rede", "/termos/parceiros"],
    etapas: [
      ["CRM e dados", "Organize sua carteira, os atendimentos e os retornos no espaço do escritório."],
      ["Rede ARINI", "Consulte as condições de captação e parceria antes de incluir um imóvel na rede."],
    ],
  },
  produtor: {
    titulo: "CRM do produtor rural",
    descricao: "Escolha os recursos para a rotina da fazenda. O escopo e a disponibilidade de cada ferramenta aparecem nas condições do pacote.",
    acao: ["Ver ferramentas do mapa", "/ferramentas"],
    etapas: [
      ["Cartografia e planejamento", "Meça as áreas e organize suas referências de piquetes e talhões."],
      ["Serviços de campo", "Peça orçamento para levantamento com drone ou agronomia de precisão nos complementos do plano."],
    ],
  },
  tecnico: {
    titulo: "Um CRM para a sua profissão",
    descricao: "O trabalho do agrimensor, do advogado e do engenheiro pede fichas diferentes. Configure sua profissão para consultar as atividades previstas.",
    acao: ["Escolher plano profissional", "#planos"],
    etapas: [
      ["Consulta territorial", "Consulte fontes, documentos e medições da área em análise."],
      ["CRM e atendimento", "Escolha um pacote com CRM e configure usuários, créditos de IA e atendimento."],
    ],
  },
  comprar: {
    titulo: "Não achou o que procura?",
    descricao: "Salve uma busca para acompanhar imóveis compatíveis com o seu interesse.",
    acao: ["Criar filtro de interesse", "/conta/filtros"],
    etapas: [
      ["Explore o mapa", "Veja o anúncio, as fotos e as informações disponíveis de cada imóvel."],
      ["Demonstre interesse", "Quando encontrar uma área, solicite atendimento na ficha do imóvel."],
    ],
  },
  leiloeiro: {
    titulo: "Só parte da gleba vai a leilão?",
    descricao: "O recorte identifica a parte do imóvel presente no edital. Consulte a ficha do leilão e confira os limites antes de divulgar a área.",
    acao: ["Consultar imóveis de leilão", "/mapa"],
    imagem: ["recorte", "Exemplo de área de leilão destacada dentro de uma gleba maior.", 400, 220],
  },
  instituicao: {
    titulo: "Balcão digital para incorporadoras e profissionais",
    descricao: "Receba pedidos do território em um só lugar e acompanhe o andamento pelo protocolo.",
    acao: ["Abrir o balcão municipal", "/balcao"],
    etapas: [
      ["Protocole", "Informe o serviço e identifique o imóvel ou projeto relacionado."],
      ["Acompanhe", "Consulte a situação do pedido e os retornos no balcão."],
    ],
  },
  empresa: {
    titulo: "Cada lote, no mapa",
    descricao: "Acompanhe as unidades do empreendimento e identifique a disponibilidade de cada lote. Consulte as condições para implantar o projeto com a equipe.",
    acao: ["Abrir meus empreendimentos", "/painel/empreendimentos"],
    imagem: ["lotes", "Exemplo de implantação por quadra com lotes disponíveis, reservados e vendidos.", 560, 330],
    legenda: [["Disponível", "#3E7A60"], ["Reservado", "#D9BD6F"], ["Vendido", "#998C54"]],
  },
  anunciar: {
    titulo: "Do primeiro toque, sem se perder",
    descricao: "Cadastre o imóvel e acompanhe a análise, as visitas e as propostas pelo seu painel.",
    acao: ["Anunciar meu imóvel", "/painel/novo"],
    etapas: [
      ["Identifique o imóvel", "Selecione a área e confira sua localização no mapa."],
      ["Envie o anúncio", "Inclua a descrição, as fotos e os documentos para análise da equipe."],
      ["Acompanhe a venda", "Veja os retornos sobre o imóvel no painel do proprietário."],
    ],
  },
  correspondente: {
    titulo: "Do primeiro contato ao contrato",
    descricao: "O atendimento parte do imóvel escolhido pelo cliente. A correspondente acompanha as simulações e dá sequência à análise junto ao banco.",
    acao: ["Abrir painel de financiamento", "/painel/financiamento"],
    etapas: [
      ["Interesse", "Receba o contexto do imóvel e os dados fornecidos na simulação."],
      ["Atendimento", "Registre o andamento e acompanhe os próximos passos com o cliente."],
    ],
  },
};

export default function FluxoDoPerfil({ perfil }: { perfil: string }) {
  const fluxo = FLUXOS[perfil];
  if (!fluxo) return null;
  return <section className="vitrine-fluxo" aria-labelledby="titulo-fluxo">
    <div>
      <h2 id="titulo-fluxo">{fluxo.titulo}</h2>
      <p>{fluxo.descricao}</p>
      <Link href={fluxo.acao[1]} className="vitrine-link">{fluxo.acao[0]} <ArrowRight aria-hidden size={17} /></Link>
    </div>
    {fluxo.imagem && <figure>
      <Image src={"/img/planos/" + fluxo.imagem[0] + ".svg"} alt={fluxo.imagem[1]} width={fluxo.imagem[2]} height={fluxo.imagem[3]} />
      <figcaption>
        Exemplo ilustrativo
        {fluxo.legenda && <ul className="vitrine-legenda">{fluxo.legenda.map(([nome, cor]) =>
          <li key={nome}><span style={{ backgroundColor: cor }} aria-hidden />{nome}</li>)}</ul>}
      </figcaption>
    </figure>}
    {fluxo.etapas && <dl>{fluxo.etapas.map(([titulo, descricao]) => <div key={titulo}><dt>{titulo}</dt><dd>{descricao}</dd></div>)}</dl>}
  </section>;
}

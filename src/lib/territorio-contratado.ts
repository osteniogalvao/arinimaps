export type ServicoMunicipal = {id:string; nome:string; municipio:string; territorio:string; versao:number; orientacao:string; requisitos:string[]};
export type PedidoMunicipal = {id:string; numero:number; proprio:boolean; estado:string; revisao:number; servico:string; versao:number;
  municipio:string; data:string; dados:Record<string,string>; andamentos:{acao:string; texto:string; data:string;
    arquivo?:{id:string;nome:string;tamanho:number}|null}[]};
export type Safra = {id:string; talhao:string; ano:number; cultura:string; toneladas:number; custo:number; receita:number; produtividade:number; revisao:number};
export type PainelSafras = {fornecedores:{id:string;nome:string}[]; areas:{id:string;nome:string;fornecedor:string;hectares:number;safras:number;resultado:number|null}[];
  talhoes:{id:string;nome:string;area:string;hectares:number}[]; safras:Safra[]};
export const estadoProtocolo: Record<string,string> = {protocolado:"Protocolado",em_analise:"Em análise",pendencia:"Pendência",resposta:"Resposta do solicitante",deferido:"Deferido",indeferido:"Indeferido"};

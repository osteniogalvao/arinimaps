export type CampoTecnico={id:string;nome:string;tipo:"texto"|"data"|"numero";obrigatorio:boolean};
export type ModeloTecnico={id:string;nome:string;profissao:string;campos:CampoTecnico[];documentos:string[];versao:number;premium:boolean;ativo:boolean};
export type RegistroTecnico={id:string;autor:string;titulo:string;versao:number;etapa:string;modulo:string;atendimento:string|null;documento:string|null;campos:Record<string,string>;modelo:ModeloTecnico;atualizado:string};
export type PedidoTecnico={id:string;profissao:string;descricao:string;estado:string;resposta:string|null;previsao:string;modelo_profissao:string|null;versao:number};
export const etapasTecnicas:Record<string,string>={aberto:"Aberto",em_andamento:"Em andamento",aguardando:"Aguardando retorno",concluido:"Concluído"};
export const estadosProfissao:Record<string,string>={recebido:"Recebido",em_analise:"Em análise",devolvido:"Devolvido",liberado:"Modelo liberado"};
export const inputTecnico="block w-full rounded-lg border border-linha bg-white px-3 py-2 text-texto";
export const botaoTecnico="inline-block rounded-lg border border-linha px-4 py-2 font-semibold hover:border-verde";
export const formatarDataTecnica=(d:string)=>d.slice(0,10).split("-").reverse().join("/");
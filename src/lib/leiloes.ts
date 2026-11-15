export const pacotesLeilao = { leilao_teste:"Teste", leilao_essencial:"Essencial", leilao_profissional:"Profissional", leilao_premium:"Premium" } as const;
export type PacoteLeilao = keyof typeof pacotesLeilao;
export type Credencial = {partner_id:string; plano:PacoteLeilao; matricula:string; empresa:string; referencia:string; validade:string; ativo:boolean; revisao:number};
export type Candidatura = {id:string; nome:string; contato:string; estado:string; revisao:number; referencia:string|null};
export type OperacaoLeilao = {estado:string; revisao:number; valor:number|null; referencia_resultado:string|null; pos_leilao:string|null};
export type LoteLeilao = {id:string; codigo:string; titulo:string; status:string; praca1:string|null; praca2:string|null;
  comitente:string|null; documentos:{tipo:string;versao:number;nome:string|null;verificado:boolean}[]; candidaturas:Candidatura[]; operacao:OperacaoLeilao|null; interessados:number};

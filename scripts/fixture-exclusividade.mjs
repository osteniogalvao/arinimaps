// Dados sintéticos para os testes de anúncio, preenchidos como no formulário de assinatura.
export function quadroDeTeste(municipio) {
  return {
    municipality_id: municipio, matricula_numero: "QA-01", matricula_cartorio: "Cartório de teste",
    valor: 100000, sem_interessados_anteriores: true, publicacao_antecipada: false,
    clausulas_exclusividade: ["3.2","5.3","6","7","10"],
    quadro_exclusividade: {
      documento:"52998224725", titular:"Proprietário de teste, endereço de teste",titularidade:"Titular único",
      anuentes:"Titular único",direito:"Propriedade plena, áreas declaradas no cadastro",
      cadastro:"Inscrição de teste",ocupacao:"Sem ocupação, ônus ou ações",
      entrada:"À vista",vencimento:"Na assinatura",adicionais:"Nenhum",
    },
  };
}

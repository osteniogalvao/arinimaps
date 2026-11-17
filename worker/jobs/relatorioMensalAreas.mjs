// Relatório mensal da área monitorada (17/11/2026, o "FarmScan" do Dados Fazenda).
//
// No dia 1º de cada mês, a partir das 8h de Brasília, cada titular com área
// monitorada ativa recebe no sino o aviso com o link do PDF do mês
// (/api/conta/monitoramento/{id}/relatorio). A chave por área e mês impede
// aviso repetido, então rodar de hora em hora é seguro. Sem a migration 0144,
// a função não existe e o job só registra isso no log.

export async function avisarRelatoriosMensais(db, agora = new Date()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(agora).map((p) => [p.type, p.value]));
  if (partes.day !== "01" || Number(partes.hour) < 8) return 0;
  const mes = `${partes.year}-${partes.month}`;
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" }).format(agora);
  let rows;
  try {
    ({ rows } = await db.query("select titular, area, nome from monitor_areas_relatorio_mensal()"));
  } catch (e) {
    if (e.code === "42883") { console.log("[relatório mensal] migration 0144 ainda não aplicada"); return 0; }
    throw e;
  }
  for (const r of rows) {
    await db.query("select fn_notificar($1, 'atencao', $2, $3, $4, $5)", [
      r.titular,
      `Relatório de ${nomeMes}: ${r.nome}`.slice(0, 200),
      "O retrato mensal da sua área monitorada está pronto: fontes acompanhadas, ocorrências do mês, uso do solo e chuva.",
      `/api/conta/monitoramento/${r.area}/relatorio`,
      `monitor-mensal-${r.area}-${mes}`,
    ]);
  }
  if (rows.length) console.log(`[relatório mensal] ${rows.length} aviso(s) de ${mes}`);
  return rows.length;
}

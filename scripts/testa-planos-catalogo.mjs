// node --test scripts/testa-planos-catalogo.mjs (Node 22+, sem banco e sem rede).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPLEMENTOS_CATALOGO, PLANOS_CATALOGO, RECURSOS_CATALOGO,
  SelecaoPlanoInvalida, cotarPlano, economiaAnualCentavos,
} from "../src/lib/planos-catalogo.ts";

test("os 17 planos e seus complementos referenciam ofertas e recursos válidos", () => {
  const porId = new Map(PLANOS_CATALOGO.map((plano) => [plano.id, plano]));
  assert.equal(PLANOS_CATALOGO.length, 17);
  assert.equal(porId.size, PLANOS_CATALOGO.length);
  for (const plano of PLANOS_CATALOGO) {
    const visitados = new Set();
    let atual = plano;
    while (atual) {
      assert.ok(!visitados.has(atual.id));
      visitados.add(atual.id);
      assert.equal(atual.personaId, plano.personaId);
      for (const recurso of atual.recursos) assert.ok(RECURSOS_CATALOGO[recurso]);
      if (!atual.incluiPlanoId) break;
      atual = porId.get(atual.incluiPlanoId);
      assert.ok(atual);
    }
  }
  for (const c of COMPLEMENTOS_CATALOGO) {
    for (const plano of c.planos) {
      assert.ok(porId.has(plano));
      if (c.mensalCentavosPorPlano) assert.ok(Number.isSafeInteger(c.mensalCentavosPorPlano[plano]));
    }
  }
});

test("promoção do proprietário se aplica ao primeiro mês e mantém o anual confirmado", () => {
  for (const [id, primeira, recorrente, anual, economia] of [
    ["proprietario_monitoramento", 2990, 2990, 29900, 5980],
    ["proprietario_inteligencia", 4990, 5990, 49900, 20980],
    ["proprietario_completo", 6990, 9990, 69900, 46980],
  ]) {
    const mensal = cotarPlano({ planoId: id, ciclo: "mensal" });
    assert.equal(mensal.primeiraMensalidadeCentavos, primeira);
    assert.equal(mensal.mensalRecorrenteCentavos, recorrente);
    assert.equal(cotarPlano({ planoId: id, ciclo: "anual" }).totalCentavos, anual);
    assert.equal(economiaAnualCentavos(PLANOS_CATALOGO.find((p) => p.id === id)), economia);
  }
});

test("cotação anual separa preço do pacote dos adicionais mensais", () => {
  const cotacao = cotarPlano({ planoId: "corretor_profissional", ciclo: "anual", adicionais: [
    { id: "usuario_adicional", quantidade: 2 }, { id: "crm_atendimento", quantidade: 1 },
  ] });
  assert.equal(cotacao.baseCicloCentavos, 247000);
  assert.equal(cotacao.adicionaisMensaisCentavos, 19700);
  assert.equal(cotacao.totalCentavos, 247000 + 12 * 19700);
  assert.equal(cotacao.primeiraMensalidadeCentavos, null);
});

test("conferência de compatibilidade, quantidade e dependências dos complementos", () => {
  const corretor = { planoId: "corretor_essencial", ciclo: "mensal" };
  for (const adicionais of [
    [{ id: "creditos_ia", quantidade: 1 }], [{ id: "atendente_adicional", quantidade: 1 }],
    [{ id: "hectares_ndvi", quantidade: 1 }], [{ id: "crm_atendimento", quantidade: 2 }],
    [{ id: "usuario_adicional", quantidade: -1 }], [{ id: "usuario_adicional", quantidade: 1.25 }],
    [{ id: "usuario_adicional", quantidade: 1 }, { id: "usuario_adicional", quantidade: 1 }],
  ]) assert.throws(() => cotarPlano({ ...corretor, adicionais }), SelecaoPlanoInvalida);
  const valido = cotarPlano({ ...corretor, adicionais: [{ id: "ia_imobiliaria", quantidade: 1 }, { id: "creditos_ia", quantidade: 2 }] });
  assert.equal(valido.totalCentavos, 9700 + 9700 + 2 * 6900);
  assert.equal(valido.itens[1].quantidadePorUnidade, 1000);
});

test("áreas, número de propriedades e serviço de drone podem exigir orçamento", () => {
  const base = { planoId: "proprietario_completo", ciclo: "mensal" };
  assert.equal(cotarPlano({ ...base, areaTotalHa: 1000 }).sobOrcamento, false);
  assert.equal(cotarPlano({ ...base, areaTotalHa: 1000.01 }).totalCentavos, null);
  assert.equal(cotarPlano({ ...base, adicionais: [{ id: "propriedade_adicional", quantidade: 7 }] }).totalCentavos, 6990 + 7 * 1500);
  assert.equal(cotarPlano({ ...base, adicionais: [{ id: "propriedade_adicional", quantidade: 8 }] }).totalCentavos, null);
  assert.equal(cotarPlano({ planoId: "produtor_premium", ciclo: "mensal", adicionais: [{ id: "drone", quantidade: 1 }] }).totalCentavos, null);
});

test("Consulta dispensa profissão e os CRMs técnicos aceitam setores por solicitação", () => {
  assert.equal(cotarPlano({ planoId: "tecnico_consulta", ciclo: "mensal" }).profissao, null);
  const tecnico = { planoId: "tecnico_profissional", ciclo: "mensal" };
  assert.throws(() => cotarPlano(tecnico), SelecaoPlanoInvalida);
  assert.equal(cotarPlano({ ...tecnico, profissao: "Consultoria rural" }).profissao, "Consultoria rural");
  assert.throws(() => cotarPlano({ planoId: "tecnico_teste", ciclo: "anual" }), SelecaoPlanoInvalida);
});

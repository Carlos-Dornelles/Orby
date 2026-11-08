import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calcularPrecoVendaRapidaOrbs,
  calcularPrecoProximoCanteiro,
  FARM_PRECO_ADUBO,
  FARM_ITENS_INVENTARIO,
  FARM_PRECOS,
} from "../FarmPreços.js";

test("fazenda configura oito culturas com preços e ciclos de cultivo equilibrados", () => {
  assert.deepEqual(Object.keys(FARM_PRECOS), [
    "trigo", "cenoura", "tomate", "beterraba", "alface", "milho", "beringela", "abobora"
  ]);

  const valoresEsperados = {
    trigo: { semente: 4, colheita: 2, vendaRapida: 1, tempo: 900 },
    alface: { semente: 3, colheita: 1, vendaRapida: 0.7, tempo: 600 },
    cenoura: { semente: 6, colheita: 3, vendaRapida: 1.4, tempo: 1200 },
    beterraba: { semente: 7, colheita: 3, vendaRapida: 1.5, tempo: 1320 },
    tomate: { semente: 8, colheita: 4, vendaRapida: 1.7, tempo: 1500 },
    milho: { semente: 10, colheita: 5, vendaRapida: 2.1, tempo: 1800 },
    beringela: { semente: 12, colheita: 6, vendaRapida: 2.5, tempo: 2100 },
    abobora: { semente: 14, colheita: 7, vendaRapida: 3, tempo: 2400 }
  };

  for (const [nome, cultura] of Object.entries(FARM_PRECOS)) {
    assert.equal(cultura.precoSementeOrbs, valoresEsperados[nome].semente);
    assert.equal(cultura.precoColheitaOrbs, valoresEsperados[nome].colheita);
    assert.equal(cultura.precoVendaRapidaOrbs, valoresEsperados[nome].vendaRapida);
    assert.equal(cultura.tempoCrescimentoSegundos, valoresEsperados[nome].tempo);
    assert.equal(cultura.quantidadeColheita, 5);
    assert.equal(cultura.chanceSementeColheita, 0.6);
    assert.ok(FARM_ITENS_INVENTARIO.includes(cultura.itemSemente));
    assert.ok(FARM_ITENS_INVENTARIO.includes(cultura.itemColheita));
  }

  assert.equal(FARM_PRECOS.trigo.sementesIniciais, 3);
  for (const cultura of Object.values(FARM_PRECOS).filter(cultura => cultura.itemSemente !== "sementesTrigo")) {
    assert.equal(cultura.sementesIniciais, 0);
  }
});

test("preços de venda rápida compensam o tempo de crescimento sem ignorar o custo das sementes", () => {
  for (const cultura of Object.values(FARM_PRECOS)) {
    const lucroEsperado = cultura.quantidadeColheita * calcularPrecoVendaRapidaOrbs(cultura) -
      cultura.precoSementeOrbs * (1 - cultura.chanceSementeColheita);
    const lucroPorHora = lucroEsperado * 3600 / cultura.tempoCrescimentoSegundos;
    assert.ok(lucroPorHora >= 10 && lucroPorHora <= 16, `${cultura.nome}: ${lucroPorHora} Orbs/h`);
  }
});

test("expansão da horta encarece progressivamente e adubo custa mais que sementes iniciais", () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => calcularPrecoProximoCanteiro(index + 3)),
    [30, 60, 120, 240, 480, 960]
  );
  assert.equal(calcularPrecoProximoCanteiro(9), null);
  assert.equal(FARM_PRECO_ADUBO, 15);
});

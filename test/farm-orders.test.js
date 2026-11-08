import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dataPedidosFazenda,
  FARM_PEDIDOS,
  FARM_PEDIDOS_DIARIOS_MAX,
  gerarPedidosDiarios
} from "../farmpedidos.js";
import {
  calcularPrecoVendaRapidaOrbs,
  FARM_PRECOS
} from "../FarmPreços.js";

test("catálogo adiciona pelo menos vinte pedidos e paga abaixo do preço de referência", () => {
  assert.equal(FARM_PEDIDOS.length, 28);
  assert.equal(new Set(FARM_PEDIDOS.map(pedido => pedido.id)).size, FARM_PEDIDOS.length);
  for (const item of Object.values(FARM_PRECOS).map(cultura => cultura.itemColheita)) {
    assert.ok(FARM_PEDIDOS.some(pedido => pedido.item === item));
  }

  for (const pedido of FARM_PEDIDOS) {
    assert.match(pedido.id, /^[a-z0-9-]+$/);
    const cultura = Object.values(FARM_PRECOS).find(item => item.itemColheita === pedido.item);
    assert.ok(cultura);
    assert.ok(Number.isSafeInteger(pedido.quantidade) && pedido.quantidade > 0);
    assert.ok(Number.isSafeInteger(pedido.recompensaOrbs) && pedido.recompensaOrbs >= 0);
    assert.ok(pedido.recompensaOrbs < pedido.quantidade * cultura.precoColheitaOrbs);
  }
});

test("recompensas de pedidos acompanham o tempo de cultivo e dão bônus moderado", () => {
  for (const cultura of Object.values(FARM_PRECOS)) {
    const pedido = FARM_PEDIDOS.find(item =>
      item.item === cultura.itemColheita && item.quantidade === cultura.quantidadeColheita
    );
    const sementesEsperadas = 1 - cultura.chanceSementeColheita;
    const lucroEsperado = pedido.recompensaOrbs -
      cultura.precoSementeOrbs * sementesEsperadas;
    const tempoDoLote = cultura.tempoCrescimentoSegundos;
    const lucroPorHora = lucroEsperado * 3600 / tempoDoLote;
    assert.ok(lucroPorHora >= 15 && lucroPorHora <= 18, `${cultura.nome}: ${lucroPorHora} Orbs/h`);
    assert.ok(pedido.recompensaOrbs <= Math.round(
      pedido.quantidade * calcularPrecoVendaRapidaOrbs(cultura) * 1.15
    ));
  }
});

test("cada dia oferece no máximo dez pedidos aleatórios e cobre todas as culturas", () => {
  const primeiroDia = gerarPedidosDiarios("2026-11-01", () => 0.37);
  const segundoDia = gerarPedidosDiarios("2026-11-02", () => 0.37);
  const outraDistribuicao = gerarPedidosDiarios("2026-11-01", () => 0.91);
  assert.equal(FARM_PEDIDOS_DIARIOS_MAX, 10);
  assert.equal(primeiroDia.length, FARM_PEDIDOS_DIARIOS_MAX);
  assert.equal(new Set(primeiroDia.map(pedido => pedido.id)).size, primeiroDia.length);
  assert.equal(new Set(primeiroDia.map(pedido => pedido.item)).size, 8);
  assert.ok(primeiroDia.every(pedido => pedido.id.startsWith("2026-11-01-")));
  assert.notDeepEqual(primeiroDia.map(pedido => pedido.id), segundoDia.map(pedido => pedido.id));
  assert.notDeepEqual(
    primeiroDia.map(pedido => pedido.id.replace("2026-11-01-", "")),
    outraDistribuicao.map(pedido => pedido.id.replace("2026-11-01-", ""))
  );
});

test("os pedidos renovam à meia-noite no fuso de São Paulo", () => {
  assert.equal(dataPedidosFazenda(new Date("2026-11-02T02:59:59.000Z")), "2026-11-01");
  assert.equal(dataPedidosFazenda(new Date("2026-11-02T03:00:00.000Z")), "2026-11-02");
});

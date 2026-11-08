import {
  calcularPrecoVendaRapidaOrbs,
  FARM_PRECOS
} from "./FarmPreços.js";

function criarPedido(id, culturaId, quantidade) {
  const cultura = FARM_PRECOS[culturaId];
  return Object.freeze({
    id,
    item: cultura.itemColheita,
    quantidade,
    recompensaOrbs: Math.round(
      quantidade * calcularPrecoVendaRapidaOrbs(cultura) * 1.15
    )
  });
}

export const FARM_PEDIDOS = Object.freeze([
  criarPedido("trigo-5", "trigo", 5),
  criarPedido("trigo-10", "trigo", 10),
  criarPedido("trigo-20", "trigo", 20),
  criarPedido("alface-5", "alface", 5),
  criarPedido("alface-10", "alface", 10),
  criarPedido("alface-15", "alface", 15),
  criarPedido("cenoura-5", "cenoura", 5),
  criarPedido("cenoura-10", "cenoura", 10),
  criarPedido("cenoura-15", "cenoura", 15),
  criarPedido("beterraba-5", "beterraba", 5),
  criarPedido("beterraba-10", "beterraba", 10),
  criarPedido("beterraba-15", "beterraba", 15),
  criarPedido("tomate-5", "tomate", 5),
  criarPedido("tomate-10", "tomate", 10),
  criarPedido("tomate-15", "tomate", 15),
  criarPedido("tomate-20", "tomate", 20),
  criarPedido("milho-5", "milho", 5),
  criarPedido("milho-10", "milho", 10),
  criarPedido("milho-15", "milho", 15),
  criarPedido("milho-20", "milho", 20),
  criarPedido("beringela-5", "beringela", 5),
  criarPedido("beringela-10", "beringela", 10),
  criarPedido("beringela-15", "beringela", 15),
  criarPedido("beringela-20", "beringela", 20),
  criarPedido("abobora-5", "abobora", 5),
  criarPedido("abobora-10", "abobora", 10),
  criarPedido("abobora-15", "abobora", 15),
  criarPedido("abobora-20", "abobora", 20)
]);

export const FARM_PEDIDOS_DIARIOS_MAX = 10;
export const FARM_PEDIDOS_FUSO_HORARIO = "America/Sao_Paulo";

export function dataPedidosFazenda(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FARM_PEDIDOS_FUSO_HORARIO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(agora);
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

export function gerarPedidosDiarios(data, aleatorio = Math.random) {
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new TypeError("Informe uma data válida para gerar os pedidos diários.");
  }
  const embaralhados = [...FARM_PEDIDOS];
  for (let indice = embaralhados.length - 1; indice > 0; indice -= 1) {
    const destino = Math.floor(aleatorio() * (indice + 1));
    [embaralhados[indice], embaralhados[destino]] =
      [embaralhados[destino], embaralhados[indice]];
  }

  const selecionados = [];
  const culturasIncluidas = new Set();
  for (const pedido of embaralhados) {
    if (culturasIncluidas.has(pedido.item)) continue;
    selecionados.push(pedido);
    culturasIncluidas.add(pedido.item);
  }
  const idsSelecionados = new Set(selecionados.map(pedido => pedido.id));
  for (const pedido of embaralhados) {
    if (selecionados.length >= FARM_PEDIDOS_DIARIOS_MAX) break;
    if (idsSelecionados.has(pedido.id)) continue;
    selecionados.push(pedido);
    idsSelecionados.add(pedido.id);
  }

  return selecionados.map(pedido => Object.freeze({
    ...pedido,
    id: `${data}-${pedido.id}`
  }));
}

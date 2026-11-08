export const FARM_PRECOS = Object.freeze({
  trigo: Object.freeze({
    nome: "Trigo",
    itemSemente: "sementesTrigo",
    itemColheita: "trigo",
    precoSementeOrbs: 4,
    precoColheitaOrbs: 2,
    precoVendaRapidaOrbs: 1,
    tempoCrescimentoSegundos: 900,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 3
  }),
  cenoura: Object.freeze({
    nome: "Cenoura",
    itemSemente: "sementesCenoura",
    itemColheita: "cenoura",
    precoSementeOrbs: 6,
    precoColheitaOrbs: 3,
    precoVendaRapidaOrbs: 1.4,
    tempoCrescimentoSegundos: 1200,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  tomate: Object.freeze({
    nome: "Tomate",
    itemSemente: "sementesTomate",
    itemColheita: "tomate",
    precoSementeOrbs: 8,
    precoColheitaOrbs: 4,
    precoVendaRapidaOrbs: 1.7,
    tempoCrescimentoSegundos: 1500,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  beterraba: Object.freeze({
    nome: "Beterraba",
    itemSemente: "sementesBeterraba",
    itemColheita: "beterraba",
    precoSementeOrbs: 7,
    precoColheitaOrbs: 3,
    precoVendaRapidaOrbs: 1.5,
    tempoCrescimentoSegundos: 1320,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  alface: Object.freeze({
    nome: "Alface",
    itemSemente: "sementesAlface",
    itemColheita: "alface",
    precoSementeOrbs: 3,
    precoColheitaOrbs: 1,
    precoVendaRapidaOrbs: 0.7,
    tempoCrescimentoSegundos: 600,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  milho: Object.freeze({
    nome: "Milho",
    itemSemente: "sementesMilho",
    itemColheita: "milho",
    precoSementeOrbs: 10,
    precoColheitaOrbs: 5,
    precoVendaRapidaOrbs: 2.1,
    tempoCrescimentoSegundos: 1800,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  beringela: Object.freeze({
    nome: "Beringela",
    itemSemente: "sementesBeringela",
    itemColheita: "beringela",
    precoSementeOrbs: 12,
    precoColheitaOrbs: 6,
    precoVendaRapidaOrbs: 2.5,
    tempoCrescimentoSegundos: 2100,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  }),
  abobora: Object.freeze({
    nome: "Abóbora",
    itemSemente: "sementesAbobora",
    itemColheita: "abobora",
    precoSementeOrbs: 14,
    precoColheitaOrbs: 7,
    precoVendaRapidaOrbs: 3,
    tempoCrescimentoSegundos: 2400,
    quantidadeColheita: 5,
    chanceSementeColheita: 0.6,
    sementesIniciais: 0
  })
});

export function calcularPrecoVendaRapidaOrbs(cultura) {
  return cultura.precoVendaRapidaOrbs;
}

export const FARM_PRECO_ADUBO = 15;
export const FARM_CANTEIRO_PRECO_INICIAL = 30;
export const FARM_CANTEIRO_MULTIPLICADOR_PRECO = 2;

export function calcularPrecoProximoCanteiro(quantidadeCanteiros, canteirosMaximos = 9) {
  if (!Number.isSafeInteger(quantidadeCanteiros) ||
      !Number.isSafeInteger(canteirosMaximos) ||
      quantidadeCanteiros < 3 ||
      quantidadeCanteiros >= canteirosMaximos) return null;
  return FARM_CANTEIRO_PRECO_INICIAL *
    FARM_CANTEIRO_MULTIPLICADOR_PRECO ** (quantidadeCanteiros - 3);
}

export const FARM_ITENS_INVENTARIO = Object.freeze(
  Object.values(FARM_PRECOS).flatMap(({ itemSemente, itemColheita }) => [itemSemente, itemColheita])
);

import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../server.js";

const chaveMestraAnterior = process.env.ORBY_AI_MASTER_KEY;
const chaveMestraTeste = Buffer.alloc(32, 23).toString("base64");

after(() => {
  if (chaveMestraAnterior === undefined) delete process.env.ORBY_AI_MASTER_KEY;
  else process.env.ORBY_AI_MASTER_KEY = chaveMestraAnterior;
});

test("rotas da fazenda exigem uma sessão assinada", async t => {
  process.env.ORBY_AI_MASTER_KEY = chaveMestraTeste;
  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const headers = { "Content-Type": "application/json", Connection: "close" };
  const estado = await fetch(`${origem}/api/fazenda`, { headers });
  assert.equal(estado.status, 401);
  assert.match((await estado.json()).erro, /sessão expirou/);

  const vendaRapida = await fetch(`${origem}/api/fazenda/venda-rapida`, {
    method: "POST",
    headers,
    body: JSON.stringify({ item: "abobora" })
  });
  assert.equal(vendaRapida.status, 401);
  assert.match((await vendaRapida.json()).erro, /sessão expirou/);

  const ranking = await fetch(`${origem}/api/fazenda/ranking`, { headers });
  assert.equal(ranking.status, 401);
  assert.match((await ranking.json()).erro, /sessão expirou/);

  const plantio = await fetch(`${origem}/api/fazenda/plantar`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId: "507f1f77bcf86cd799439011" })
  });
  assert.equal(plantio.status, 401);
  assert.match((await plantio.json()).erro, /sessão expirou/);

  const configuracaoNotificacoes = await fetch(`${origem}/api/fazenda/notificacoes`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ habilitadas: false })
  });
  assert.equal(configuracaoNotificacoes.status, 401);
  assert.match((await configuracaoNotificacoes.json()).erro, /sessão expirou/);

  const notificacaoColheita = await fetch(`${origem}/api/fazenda/colheita/notificar`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(notificacaoColheita.status, 401);
  assert.match((await notificacaoColheita.json()).erro, /sessão expirou/);

  const entrega = await fetch(`${origem}/api/fazenda/pedido/entregar`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId: "507f1f77bcf86cd799439011", quantidade: 10, recompensa: 500 })
  });
  assert.equal(entrega.status, 401);
  assert.match((await entrega.json()).erro, /sessão expirou/);

  const loja = await fetch(`${origem}/api/fazenda/mercado`, { headers });
  assert.equal(loja.status, 401);
  assert.match((await loja.json()).erro, /sessão expirou/);

  for (const [rota, body] of [
    ["/api/fazenda/mercado/anunciar", { quantidade: 1, precoTotal: 5 }],
    ["/api/fazenda/mercado/cancelar", { anuncioId: "507f1f77bcf86cd799439011" }],
    ["/api/fazenda/mercado/comprar", {
      anuncioId: "507f1f77bcf86cd799439011",
      quantidade: 1,
      operationId: "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
    }],
    ["/api/fazenda/mercado/comprar-sementes", {
      cultura: "trigo",
      quantidade: 1,
      operationId: "6ba7b810-9dad-41d1-80b4-00c04fd430c9"
    }],
    ["/api/fazenda/canteiro/expandir", {}],
    ["/api/fazenda/adubo/comprar", { quantidade: 1 }],
    ["/api/fazenda/adubo/aplicar", { canteiro: 0 }]
  ]) {
    const resposta = await fetch(`${origem}${rota}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    assert.equal(resposta.status, 401);
    assert.match((await resposta.json()).erro, /sessão expirou/);
  }
});

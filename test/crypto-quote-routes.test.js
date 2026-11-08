import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../server.js";

const fetchOriginal = globalThis.fetch;

after(() => {
  globalThis.fetch = fetchOriginal;
});

test("cotação cripto usa cache e coalesce chamadas simultâneas", async t => {
  let requisicoesCoinGecko = 0;
  const periodosSolicitados = [];
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith("https://api.coingecko.com/")) {
      requisicoesCoinGecko += 1;
      const periodo = new URL(String(input)).searchParams.get("days");
      periodosSolicitados.push(periodo);
      await new Promise(resolve => setTimeout(resolve, 20));
      return new Response(JSON.stringify({ prices: [[1, periodo === "1" ? 111 : 123]] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return fetchOriginal(input, init);
  };

  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const [resposta1, resposta2] = await Promise.all([
    fetch(`${origem}/cotacoes/criptomoedas/XRP?dias=7`),
    fetch(`${origem}/cotacoes/criptomoedas/XRP?dias=30`)
  ]);
  assert.equal(resposta1.status, 200);
  assert.equal(resposta2.status, 200);
  assert.deepEqual(await resposta1.json(), { prices: [[1, 123]] });
  assert.deepEqual(await resposta2.json(), { prices: [[1, 123]] });
  assert.equal(resposta1.headers.get("cache-control"), "public, max-age=300");
  assert.equal(requisicoesCoinGecko, 1);
  assert.deepEqual(periodosSolicitados, ["90"]);

  const mesmoHistorico = await fetch(`${origem}/cotacoes/criptomoedas/XRP?dias=7`);
  assert.equal(mesmoHistorico.status, 200);
  assert.deepEqual(await mesmoHistorico.json(), { prices: [[1, 123]] });
  assert.equal(requisicoesCoinGecko, 1);

  const intradia = await fetch(`${origem}/cotacoes/criptomoedas/XRP?dias=1`);
  assert.equal(intradia.status, 200);
  assert.deepEqual(await intradia.json(), { prices: [[1, 111]] });
  assert.equal(intradia.headers.get("cache-control"), "public, max-age=30");
  assert.equal(requisicoesCoinGecko, 2);
  assert.deepEqual(periodosSolicitados, ["90", "1"]);

  const invalida = await fetch(`${origem}/cotacoes/criptomoedas/INVALIDA?dias=1`);
  assert.equal(invalida.status, 400);
  const periodoInvalido = await fetch(`${origem}/cotacoes/criptomoedas/XRP?dias=90`);
  assert.equal(periodoInvalido.status, 400);
  assert.equal(requisicoesCoinGecko, 2);
});

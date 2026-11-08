import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../server.js";

const fetchOriginal = globalThis.fetch;

after(() => {
  globalThis.fetch = fetchOriginal;
});

test("cotação intradiária de moeda usa cache e fallback diário", async t => {
  let requisicoesYahooUsd = 0;
  let requisicoesAwesome = 0;
  const timestampAtual = Math.floor(Date.now() / 1000);
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.startsWith("https://query1.finance.yahoo.com/")) {
      if (url.includes("USDBRL%3DX")) {
        requisicoesYahooUsd += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return new Response(JSON.stringify({
          chart: {
            result: [{
              timestamp: [timestampAtual - 300, timestampAtual],
              indicators: { quote: [{ close: [5.4, 5.5] }] }
            }],
            error: null
          }
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        chart: { result: [{ indicators: { quote: [{}] } }], error: null }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://economia.awesomeapi.com.br/")) {
      requisicoesAwesome += 1;
      return new Response(JSON.stringify([{
        timestamp: String(timestampAtual - 3600),
        bid: "5.9"
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return fetchOriginal(input);
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
    fetch(`${origem}/cotacoes/moedas/USD?dias=1`),
    fetch(`${origem}/cotacoes/moedas/USD?dias=1`)
  ]);
  assert.equal(resposta1.status, 200);
  assert.equal(resposta2.status, 200);
  assert.deepEqual(await resposta1.json(), {
    prices: [[(timestampAtual - 300) * 1000, 5.4], [timestampAtual * 1000, 5.5]]
  });
  assert.equal(resposta2.headers.get("cache-control"), "public, max-age=30");
  assert.equal(requisicoesYahooUsd, 1);

  const fallback = await fetch(`${origem}/cotacoes/moedas/EUR?dias=1`);
  assert.equal(fallback.status, 200);
  assert.deepEqual(await fallback.json(), {
    prices: [[(timestampAtual - 3600) * 1000, 5.9]]
  });
  assert.equal(requisicoesAwesome, 1);

  const moedaInvalida = await fetch(`${origem}/cotacoes/moedas/INVALIDA?dias=1`);
  const periodoInvalido = await fetch(`${origem}/cotacoes/moedas/USD?dias=30`);
  assert.equal(moedaInvalida.status, 400);
  assert.equal(periodoInvalido.status, 400);
});

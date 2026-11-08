import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../server.js";

const chaveMestraAnterior = process.env.ORBY_AI_MASTER_KEY;
const chaveMestraTeste = Buffer.alloc(32, 11).toString("base64");

after(() => {
  if (chaveMestraAnterior === undefined) delete process.env.ORBY_AI_MASTER_KEY;
  else process.env.ORBY_AI_MASTER_KEY = chaveMestraAnterior;
});

test("rotas Orb.IA exigem sessão assinada e informam quando falta a chave mestra", async t => {
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
  const cabecalhos = {
    "Content-Type": "application/json",
    Cookie: "orbyUserId=507f1f77bcf86cd799439011",
    Connection: "close"
  };
  const resposta = await fetch(`${origem}/orb-ia/chave`, {
    method: "PUT",
    headers: cabecalhos,
    body: JSON.stringify({ chaveApi: "AIzaSy-test-key-do-usuario-123456" })
  });

  assert.equal(resposta.status, 401);
  assert.match((await resposta.json()).erro, /sessão expirou/);

  delete process.env.ORBY_AI_MASTER_KEY;
  const respostaSemChaveMestra = await fetch(`${origem}/orb-ia/config`, {
    headers: { Connection: "close" }
  });

  assert.equal(respostaSemChaveMestra.status, 503);
  assert.match((await respostaSemChaveMestra.json()).erro, /não foi configurada/);
});

import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../server.js";

const chaveMestraAnterior = process.env.ORBY_AI_MASTER_KEY;
const chaveMestraTeste = Buffer.alloc(32, 17).toString("base64");

after(() => {
  if (chaveMestraAnterior === undefined) delete process.env.ORBY_AI_MASTER_KEY;
  else process.env.ORBY_AI_MASTER_KEY = chaveMestraAnterior;
});

test("registro FCM valida o token e exige a sessão assinada da conta", async t => {
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
  const url = `${origem}/notificacoes/507f1f77bcf86cd799439011/fcm`;
  const headers = { "Content-Type": "application/json", Connection: "close" };

  const tokenInvalido = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token: "token com espaços" })
  });
  assert.equal(tokenInvalido.status, 400);

  const semSessao = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ token: "fcm-registration-token" })
  });
  assert.equal(semSessao.status, 401);
  assert.match((await semSessao.json()).erro, /sessão expirou/);
});

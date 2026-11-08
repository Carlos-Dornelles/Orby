import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../server.js";

test("histórico de xadrez rejeita partidas incompletas e identificadores inválidos", async t => {
  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const cabecalhos = { "Content-Type": "application/json", Connection: "close" };
  const respostaIdInvalido = await fetch(`${origem}/xadrez/usuarios/invalido/historico`, {
    headers: { Connection: "close" }
  });
  assert.equal(respostaIdInvalido.status, 400);

  const respostaPartidaIncompleta = await fetch(
    `${origem}/xadrez/usuarios/507f1f77bcf86cd799439011/historico-local`,
    {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        gameId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        mode: "stockfish",
        playerColor: "w",
        opponent: "Stockfish",
        pgn: ""
      })
    }
  );
  assert.equal(respostaPartidaIncompleta.status, 400);
  assert.match((await respostaPartidaIncompleta.json()).erro, /finalizadas/);
});

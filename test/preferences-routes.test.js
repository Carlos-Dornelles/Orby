import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../server.js";

test("preferências aceitam dimensões do widget da fazenda", async t => {
  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const resposta = await fetch(`${origem}/preferencias/invalid-user-id`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Connection: "close" },
    body: JSON.stringify({
      preferencias: {
        layoutWidgets: { farm: { x: 0, y: 1080, z: 1, width: 280, height: 420 } },
        visibilidadeWidgets: {},
        postitsWidgets: [],
        estiloRelogio: "digital",
        habitoWidget: "",
        modoArrasteWidgets: false,
        tamanhoPainelTarefas: null,
        cronometro: { tempoMs: 0, rodando: false, iniciadoEm: null },
        pomodoro: { fase: "foco", tempoRestanteMs: 1500000, rodando: false, iniciadoEm: null }
      }
    })
  });

  assert.equal(resposta.status, 400);
  assert.equal((await resposta.json()).erro, "Identificador de usuário inválido");
});

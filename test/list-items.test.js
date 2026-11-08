import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../server.js";

test("mover item rejeita listas de destino inválidas ou iguais à origem", async t => {
  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const userId = "507f1f77bcf86cd799439011";
  const listaId = "507f1f77bcf86cd799439012";
  const itemId = "507f1f77bcf86cd799439013";
  for (const destinoListaId of [listaId, "lista-invalida"]) {
    const resposta = await fetch(`${origem}/listas/${userId}/${listaId}/itens/${itemId}/mover`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ destinoListaId })
    });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "Origem ou destino do item inválido");
  }
});

test("reordenar itens rejeita identificadores inválidos e duplicados", async t => {
  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const userId = "507f1f77bcf86cd799439011";
  const listaId = "507f1f77bcf86cd799439012";
  const itemId = "507f1f77bcf86cd799439013";
  for (const itemIds of [["id-invalido"], [itemId, itemId]]) {
    const resposta = await fetch(`${origem}/listas/${userId}/${listaId}/itens/ordem`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({ itemIds })
    });
    assert.equal(resposta.status, 400);
    assert.equal((await resposta.json()).erro, "Ordem dos itens inválida");
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import app from "../server.js";

test("painel admin exige credenciais e mantém APIs protegidas por sessão", async t => {
  const loginAnterior = process.env.ADMIN_LOGIN;
  const senhaAnterior = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_LOGIN = "admin-teste";
  process.env.ADMIN_PASSWORD = "senha-teste-segura";

  const servidor = app.listen(0, "127.0.0.1");
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise((resolve, reject) => {
      servidor.close(error => error ? reject(error) : resolve());
    });
    if (loginAnterior === undefined) delete process.env.ADMIN_LOGIN;
    else process.env.ADMIN_LOGIN = loginAnterior;
    if (senhaAnterior === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = senhaAnterior;
  });
  await new Promise(resolve => servidor.once("listening", resolve));

  const origem = `http://127.0.0.1:${servidor.address().port}`;
  const pagina = await fetch(`${origem}/admin`);
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Acessar painel/);

  const semSessao = await fetch(`${origem}/admin/api/announcements`);
  assert.equal(semSessao.status, 401);

  const feedbackAdminSemSessao = await fetch(`${origem}/admin/api/feedback`);
  assert.equal(feedbackAdminSemSessao.status, 401);

  const feedbackSemLogin = await fetch(`${origem}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo: "sugestao", mensagem: "Uma ideia." })
  });
  assert.equal(feedbackSemLogin.status, 401);

  const feedbackCookieInvalido = await fetch(`${origem}/api/feedback`, {
    method: "POST",
    headers: {
      Cookie: "orbyUserId=%E0%A4%A",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ tipo: "sugestao", mensagem: "Uma ideia." })
  });
  assert.equal(feedbackCookieInvalido.status, 401);

  const imagemFeedbackInvalida = await fetch(`${origem}/api/feedback`, {
    method: "POST",
    headers: {
      Cookie: "orbyUserId=507f1f77bcf86cd799439011",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tipo: "sugestao",
      mensagem: "Uma ideia válida.",
      imagemPublicId: "orby/507f1f77bcf86cd799439011/feedback/../../arquivo"
    })
  });
  assert.equal(imagemFeedbackInvalida.status, 400);

  const imagemFeedbackSemLogin = await fetch(`${origem}/cloudinary/feedback-signature`, {
    method: "POST"
  });
  assert.equal(imagemFeedbackSemLogin.status, 401);

  const loginInvalido = await fetch(`${origem}/admin/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "admin-teste", senha: "senha-errada" })
  });
  assert.equal(loginInvalido.status, 401);

  const login = await fetch(`${origem}/admin/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: "admin-teste", senha: "senha-teste-segura" })
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  assert.match(login.headers.get("set-cookie"), /Path=\/admin/);
  assert.match(login.headers.get("set-cookie"), /Max-Age=43200/);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const sessao = await fetch(`${origem}/admin/api/session`, {
    headers: { Cookie: cookie }
  });
  assert.equal(sessao.status, 200);
  assert.deepEqual(await sessao.json(), { autenticado: true });

  const avisoInvalido = await fetch(`${origem}/admin/api/announcements`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ titulo: "", mensagem: "" })
  });
  assert.equal(avisoInvalido.status, 400);

  const videoInvalido = await fetch(`${origem}/admin/api/announcements`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      titulo: "Aviso",
      mensagem: "Texto do aviso",
      videoUrl: "https://example.com/watch?v=dQw4w9WgXcQ"
    })
  });
  assert.equal(videoInvalido.status, 400);
  assert.match((await videoInvalido.json()).erro, /YouTube/);

  const logout = await fetch(`${origem}/admin/api/logout`, {
    method: "POST",
    headers: { Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  const sessaoEncerrada = await fetch(`${origem}/admin/api/session`, {
    headers: { Cookie: cookie }
  });
  assert.equal(sessaoEncerrada.status, 401);
});

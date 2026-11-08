import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  criarSessaoOrb,
  descriptografarChaveGemini,
  criptografarChaveGemini,
  gerarRespostaGemini,
  OrbAiError,
  validarSessaoOrb,
  verificarConfiguracaoOrb
} from "../orb-ia.js";
import { criarInstrucaoOrbIA } from "../ensinoRobo.js";

const chaveMestraAnterior = process.env.ORBY_AI_MASTER_KEY;
process.env.ORBY_AI_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

after(() => {
  if (chaveMestraAnterior === undefined) delete process.env.ORBY_AI_MASTER_KEY;
  else process.env.ORBY_AI_MASTER_KEY = chaveMestraAnterior;
});

test("criptografa e descriptografa a chave Gemini sem armazenar o texto original", () => {
  const chave = "AIzaSy-test-key-do-usuario-123456";
  const criptografada = criptografarChaveGemini(chave);

  assert.notEqual(criptografada, chave);
  assert.equal(criptografada.includes(chave), false);
  assert.equal(descriptografarChaveGemini(criptografada), chave);
});

test("rejeita chave Gemini criptografada que foi alterada", () => {
  const criptografada = criptografarChaveGemini("AIzaSy-test-key-do-usuario-123456");
  const partes = criptografada.split(".");
  partes[2] = `${partes[2].startsWith("A") ? "B" : "A"}${partes[2].slice(1)}`;

  assert.throws(
    () => descriptografarChaveGemini(partes.join(".")),
    error => error instanceof OrbAiError && /descriptografar/.test(error.message)
  );
});

test("assina a sessão Orb e rejeita assinatura adulterada", () => {
  const userId = "507f1f77bcf86cd799439011";
  const sessao = criarSessaoOrb(userId);
  const [payload, assinatura] = sessao.split(".");

  assert.equal(validarSessaoOrb(sessao), userId);
  const assinaturaAdulterada = `${assinatura.startsWith("A") ? "B" : "A"}${assinatura.slice(1)}`;
  assert.equal(validarSessaoOrb(`${payload}.${assinaturaAdulterada}`), null);
});

test("instrui a Orb com o perfil e os dados pessoais sem fingir que pode alterá-los", () => {
  const instrucao = criarInstrucaoOrbIA({
    nomeUsuario: "Ana",
    tarefas: [{ status: "pendente", tipo: "Importante", data: "10/10/2026", texto: "Estudar" }],
    habitos: [{ nome: "Ler", horarios: ["08:00"], diasConcluidos: ["2026-10-10"] }],
    postits: [{ titulo: "Ideia", descricao: "Revisar o projeto" }],
    folhasCaderno: [{ titulo: "Anotações", conteudo: "Preparar apresentação" }],
    listas: [{ nome: "Compras", itens: [{ texto: "Café", concluido: false }] }],
    clima: {
      widgetAtivo: true,
      disponivel: true,
      cidade: "Porto Alegre",
      condicao: "céu limpo",
      temperatura: 22,
      previsao: [{
        data: "2026-10-11",
        condicao: "chuva fraca",
        maxima: 20,
        minima: 12,
        chanceChuva: 40
      }]
    }
  });

  assert.match(instrucao, /integrado ao sistema Orby/);
  assert.match(instrucao, /Estudar/);
  assert.match(instrucao, /Nome cadastrado do usuário: Ana/);
  assert.match(instrucao, /Ler \| horários: 08:00 \| dias concluídos recentes: 2026-10-10/);
  assert.match(instrucao, /Ideia: Revisar o projeto/);
  assert.match(instrucao, /Anotações: Preparar apresentação/);
  assert.match(instrucao, /Compras: \[pendente\] Café/);
  assert.match(instrucao, /Porto Alegre/);
  assert.match(instrucao, /22 °C/);
  assert.match(instrucao, /2026-10-11: chuva fraca, máxima 20 °C, mínima 12 °C, chance de chuva 40%/);
  assert.match(instrucao, /não tem ferramentas para criar, editar, concluir ou excluir tarefas/);
});

test("envia chave e histórico para o Gemini e retorna o texto", async () => {
  const fetchAnterior = globalThis.fetch;
  let requisicao;
  globalThis.fetch = async (url, options) => {
    requisicao = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        steps: [{
          type: "model_output",
          content: [{ type: "text", text: "Resposta de teste." }]
        }]
      })
    };
  };

  try {
    const resposta = await gerarRespostaGemini({
      chaveApi: "AIzaSy-chave-teste",
      instrucao: "Ajude com tarefas.",
      mensagens: [
        { role: "user", text: "Tenho uma tarefa?" },
        { role: "model", text: "Sim, estudar." },
        { role: "user", text: "O que devo fazer?" }
      ]
    });
    const corpo = JSON.parse(requisicao.options.body);

    assert.equal(resposta, "Resposta de teste.");
    assert.equal(requisicao.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    assert.equal(requisicao.options.headers["x-goog-api-key"], "AIzaSy-chave-teste");
    assert.equal(corpo.model, "gemini-3.5-flash-lite");
    assert.equal(
      corpo.input,
      "Usuário: Tenho uma tarefa?\n\nOrb.IA: Sim, estudar.\n\nUsuário: O que devo fazer?"
    );
    assert.equal(corpo.system_instruction, "Ajude com tarefas.");
    assert.equal(corpo.generation_config.thinking_level, "minimal");
    assert.equal(corpo.store, false);
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("repete automaticamente uma indisponibilidade temporária do Gemini", async () => {
  const fetchAnterior = globalThis.fetch;
  let tentativas = 0;
  globalThis.fetch = async () => {
    tentativas += 1;
    if (tentativas === 1) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => null },
        json: async () => ({
          error: {
            status: "UNAVAILABLE",
            message: "The model is currently experiencing high demand."
          }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        steps: [{ type: "model_output", content: [{ type: "text", text: "Resposta após retentativa." }] }]
      })
    };
  };

  try {
    const resposta = await gerarRespostaGemini({
      chaveApi: "AIzaSy-chave-teste",
      instrucao: "Ajude com tarefas.",
      mensagens: [{ role: "user", text: "Olá" }]
    });
    assert.equal(resposta, "Resposta após retentativa.");
    assert.equal(tentativas, 2);
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("troca de modelo quando o Gemini excede o tempo de resposta", async () => {
  const fetchAnterior = globalThis.fetch;
  const modelosTentados = [];
  globalThis.fetch = async (_url, options) => {
    modelosTentados.push(JSON.parse(options.body).model);
    if (modelosTentados.length === 1) {
      const erro = new Error("tempo limite");
      erro.name = "TimeoutError";
      throw erro;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        steps: [{ type: "model_output", content: [{ type: "text", text: "Resposta do modelo alternativo." }] }]
      })
    };
  };

  try {
    const resposta = await gerarRespostaGemini({
      chaveApi: "AIzaSy-chave-teste",
      instrucao: "Ajude com tarefas.",
      mensagens: [{ role: "user", text: "Olá" }]
    });

    assert.equal(resposta, "Resposta do modelo alternativo.");
    assert.deepEqual(modelosTentados, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("alterna para modelos Gemini gratuitos quando a cota do modelo atual acaba", async () => {
  const fetchAnterior = globalThis.fetch;
  const modelosTentados = [];
  globalThis.fetch = async (_url, options) => {
    const corpo = JSON.parse(options.body);
    modelosTentados.push(corpo.model);
    if (modelosTentados.length === 1) {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            status: "RESOURCE_EXHAUSTED",
            message: "model quota exceeded"
          }
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        steps: [{ type: "model_output", content: [{ type: "text", text: "Resposta do modelo alternativo." }] }]
      })
    };
  };

  try {
    const resposta = await gerarRespostaGemini({
      chaveApi: "AIzaSy-chave-teste",
      instrucao: "Ajude com tarefas.",
      mensagens: [{ role: "user", text: "Olá" }]
    });

    assert.equal(resposta, "Resposta do modelo alternativo.");
    assert.deepEqual(modelosTentados, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("transforma limite do Gemini em erro visível e acionável", async () => {
  const fetchAnterior = globalThis.fetch;
  let tentativas = 0;
  globalThis.fetch = async () => {
    tentativas += 1;
    return {
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "quota exceeded" } })
    };
  };

  try {
    await assert.rejects(
      gerarRespostaGemini({
        chaveApi: "AIzaSy-chave-teste",
        instrucao: "Ajude com tarefas.",
        mensagens: [{ role: "user", text: "Olá" }]
      }),
      error => error instanceof OrbAiError && error.status === 429 && /limite de uso ou cota/.test(error.message)
    );
    assert.equal(tentativas, 5);
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("mostra erro detalhado do Google sem revelar a chave API", async () => {
  const fetchAnterior = globalThis.fetch;
  const chaveApi = "AIzaSy-chave-privada-teste-123456789";
  globalThis.fetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      error: {
        status: "PERMISSION_DENIED",
        message: `API Gemini sem permissão para ${chaveApi}`
      }
    })
  });

  try {
    await assert.rejects(
      gerarRespostaGemini({
        chaveApi,
        instrucao: "Ajude com tarefas.",
        mensagens: [{ role: "user", text: "Olá" }]
      }),
      error => error instanceof OrbAiError &&
        error.status === 400 &&
        /API Generativa está habilitada/.test(error.message) &&
        !error.message.includes(chaveApi) &&
        error.message.includes("[chave omitida]")
    );
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("identifica modelo indisponível em vez de ocultar o erro como indisponibilidade genérica", async () => {
  const fetchAnterior = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({
      error: {
        status: "NOT_FOUND",
        message: "models/example not found"
      }
    })
  });

  try {
    await assert.rejects(
      gerarRespostaGemini({
        chaveApi: "AIzaSy-chave-teste",
        instrucao: "Ajude com tarefas.",
        mensagens: [{ role: "user", text: "Olá" }]
      }),
      error => error instanceof OrbAiError &&
        error.status === 502 &&
        /modelos Gemini gratuitos testados está disponível/.test(error.message)
    );
  } finally {
    globalThis.fetch = fetchAnterior;
  }
});

test("exige uma chave mestra válida para criptografia e assinatura", () => {
  const chave = process.env.ORBY_AI_MASTER_KEY;
  delete process.env.ORBY_AI_MASTER_KEY;
  try {
    assert.throws(
      verificarConfiguracaoOrb,
      error => error instanceof OrbAiError && error.status === 503
    );
  } finally {
    process.env.ORBY_AI_MASTER_KEY = chave;
  }
});

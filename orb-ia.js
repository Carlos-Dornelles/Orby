import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;
const GEMINI_MODELS_GRATUITOS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash"
];
const GEMINI_REQUEST_TIMEOUT_MS = 12000;
const GEMINI_PROCESS_TIMEOUT_MS = 38000;

function atrasoRetentativaGemini(resposta) {
  const retryAfter = resposta?.headers?.get?.("retry-after");
  if (retryAfter) {
    const segundos = Number(retryAfter);
    const instante = Number.isFinite(segundos)
      ? Date.now() + segundos * 1000
      : Date.parse(retryAfter);
    if (Number.isFinite(instante)) {
      const atraso = Math.max(0, instante - Date.now());
      return atraso <= 1500 ? atraso : null;
    }
  }
  return 250 + Math.random() * 200;
}

export class OrbAiError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "OrbAiError";
    this.status = status;
  }
}

function chaveMestra() {
  const valor = process.env.ORBY_AI_MASTER_KEY?.trim();
  if (!valor) {
    throw new OrbAiError("A Orb.IA ainda não foi configurada pelo administrador do servidor.", 503);
  }

  const chave = Buffer.from(valor, "base64");
  if (chave.length !== 32 || chave.toString("base64") !== valor) {
    throw new OrbAiError("A configuração de segurança da Orb.IA é inválida.", 503);
  }
  return chave;
}

export function verificarConfiguracaoOrb() {
  chaveMestra();
}

function derivarChave(finalidade) {
  return createHmac("sha256", chaveMestra())
    .update(`orby-orb-ia:${finalidade}`)
    .digest();
}

export function criarSessaoOrb(userId) {
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    expiraEm: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS
  })).toString("base64url");
  const assinatura = createHmac("sha256", derivarChave("sessao"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${assinatura}`;
}

export function validarSessaoOrb(token) {
  if (typeof token !== "string") return null;
  const partes = token.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return null;

  const assinaturaRecebida = Buffer.from(partes[1], "base64url");
  const assinaturaEsperada = createHmac("sha256", derivarChave("sessao"))
    .update(partes[0])
    .digest();
  if (assinaturaRecebida.length !== assinaturaEsperada.length ||
      !timingSafeEqual(assinaturaRecebida, assinaturaEsperada)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(partes[0], "base64url").toString("utf8"));
    if (
      typeof payload.userId !== "string" ||
      !/^[\da-f]{24}$/i.test(payload.userId) ||
      !Number.isInteger(payload.expiraEm) ||
      payload.expiraEm <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload.userId;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function criptografarChaveGemini(chaveApi) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivarChave("gemini-api-key"), nonce);
  const conteudo = Buffer.concat([cipher.update(chaveApi, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    conteudo.toString("base64url")
  ].join(".");
}

export function descriptografarChaveGemini(valorCriptografado) {
  const partes = typeof valorCriptografado === "string" ? valorCriptografado.split(".") : [];
  if (partes.length !== 4 || partes[0] !== "v1") {
    throw new OrbAiError("A chave Gemini salva está inválida.", 500);
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      derivarChave("gemini-api-key"),
      Buffer.from(partes[1], "base64url")
    );
    decipher.setAuthTag(Buffer.from(partes[2], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(partes[3], "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof OrbAiError) throw error;
    throw new OrbAiError("Não foi possível descriptografar a chave Gemini salva.", 500);
  }
}

function ordenarModelosParaTentativa(modeloPreferencial) {
  if (modeloPreferencial && GEMINI_MODELS_GRATUITOS.includes(modeloPreferencial)) {
    return [
      modeloPreferencial,
      ...GEMINI_MODELS_GRATUITOS.filter(m => m !== modeloPreferencial)
    ];
  }
  return [...GEMINI_MODELS_GRATUITOS];
}

export async function gerarRespostaGemini({ chaveApi, instrucao, mensagens, modeloPreferencial }) {
  const input = mensagens.map(mensagem =>
    `${mensagem.role === "user" ? "Usuário" : "Orb.IA"}: ${mensagem.text}`
  ).join("\n\n");
  const filaModelos = ordenarModelosParaTentativa(modeloPreferencial);
  const inicioProcesso = Date.now();

  let resposta = null;
  let dados = null;
  let modeloUsadoComSucesso = null;
  let ultimoErroFatal = null;

  let indiceModelo = 0;
  while (Date.now() - inicioProcesso < GEMINI_PROCESS_TIMEOUT_MS) {
    const modelo = filaModelos[indiceModelo % filaModelos.length];
    const tempoRestante = GEMINI_PROCESS_TIMEOUT_MS - (Date.now() - inicioProcesso);
    if (tempoRestante < 1500) break;

    const timeoutRequisicao = Math.min(GEMINI_REQUEST_TIMEOUT_MS, tempoRestante);

    try {
      const contentsPayload = mensagens.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.text }]
      }));

      resposta = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": chaveApi
          },
          body: JSON.stringify({
            systemInstruction: instrucao ? { parts: [{ text: instrucao }] } : undefined,
            contents: contentsPayload,
            generationConfig: {
              temperature: 0.7
            }
          }),
          signal: AbortSignal.timeout(timeoutRequisicao)
        }
      );
    } catch (error) {
      console.warn(`Orb.IA tempo limite ou erro de rede no modelo ${modelo}. Continuando para o próximo...`);
      indiceModelo += 1;
      continue;
    }

    try {
      dados = await resposta.json();
    } catch {
      dados = null;
    }

    if (resposta && resposta.ok) {
      modeloUsadoComSucesso = modelo;
      break;
    }

    const codigoApi = typeof dados?.error?.status === "string" ? dados.error.status : "";
    const detalheApi = typeof dados?.error?.message === "string" ? dados.error.message : "";

    // Se for chave inválida ou problema na requisição do usuário (400, 401, 403), não adianta tentar outros modelos
    if (resposta.status === 401 || resposta.status === 403) {
      ultimoErroFatal = { resposta, dados };
      break;
    }

    console.warn(`Orb.IA modelo ${modelo} indisponível (HTTP ${resposta.status}${codigoApi ? ` - ${codigoApi}` : ""}: ${detalheApi}). Continuando para o próximo modelo...`);

    const atraso = atrasoRetentativaGemini(resposta);
    if (atraso && Date.now() - inicioProcesso + atraso < GEMINI_PROCESS_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, atraso));
    }

    indiceModelo += 1;
  }

  if (ultimoErroFatal) {
    resposta = ultimoErroFatal.resposta;
    dados = ultimoErroFatal.dados;
  }

  if (!resposta || !resposta.ok) {
    if (!resposta) {
      throw new OrbAiError(
        "O Gemini demorou demais para responder ou está temporariamente sobrecarregado em todos os modelos. Tente novamente em alguns instantes.",
        502
      );
    }

    const codigoApi = typeof dados?.error?.status === "string" ? dados.error.status : "";
    const detalheApi = typeof dados?.error?.message === "string"
      ? dados.error.message
        .replaceAll(chaveApi, "[chave omitida]")
        .replace(/AIza[\w-]{20,}/g, "[chave omitida]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300)
      : "";
    const detalhe = detalheApi ? ` Detalhe do Google: ${detalheApi}` : "";

    if (resposta.status === 400) {
      throw new OrbAiError(
        `O Gemini rejeitou a solicitação. Confira as restrições da chave, o acesso à API Gemini e o conteúdo enviado.${detalhe}`,
        400
      );
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new OrbAiError(
        `O Gemini recusou o acesso. Verifique se a chave API está correta, se a API Generativa está habilitada e se as restrições da chave permitem esta aplicação.${detalhe}`,
        400
      );
    }
    if (resposta.status === 404) {
      throw new OrbAiError(
        `Nenhum dos modelos Gemini gratuitos testados está disponível para esta chave ou projeto.${detalhe}`,
        502
      );
    }
    if (resposta.status === 429 || codigoApi === "RESOURCE_EXHAUSTED") {
      throw new OrbAiError(
        `Os modelos Gemini gratuitos tentados atingiram um limite de uso ou cota. Aguarde a renovação dos limites e confira o projeto no Google AI Studio.${detalhe}`,
        429
      );
    }
    if (resposta.status === 402) {
      throw new OrbAiError(
        `O Google informou que o saldo pré-pago acabou. A Orb.IA não tentou usar modelos pagos.${detalhe}`,
        402
      );
    }
    if (resposta.status === 503 || resposta.status === 504) {
      throw new OrbAiError(
        `O Gemini está temporariamente sobrecarregado ou indisponível. Foram feitas tentativas automáticas; aguarde alguns instantes e tente novamente.${detalhe}`,
        502
      );
    }
    console.error("A API Gemini retornou erro.", {
      httpStatus: resposta.status,
      apiStatus: codigoApi || "desconhecido",
      mensagem: detalheApi || "Sem detalhes."
    });
    throw new OrbAiError(
      `A API Gemini retornou um erro inesperado (HTTP ${resposta.status}).${detalhe}`,
      502
    );
  }

  const textoCandidates = dados?.candidates?.[0]?.content?.parts
    ?.map(parte => (typeof parte?.text === "string" ? parte.text : ""))
    .join("")
    .trim();

  const textoSteps = dados?.steps
    ?.filter(etapa => etapa.type === "model_output")
    .flatMap(etapa => Array.isArray(etapa.content) ? etapa.content : [])
    .map(parte => parte.type === "text" && typeof parte.text === "string" ? parte.text : "")
    .join("")
    .trim();

  const texto = textoCandidates || textoSteps;
  if (!texto) {
    throw new OrbAiError("O Gemini não conseguiu gerar uma resposta para essa mensagem.", 502);
  }
  return { texto, modeloUtilizado: modeloUsadoComSucesso };
}

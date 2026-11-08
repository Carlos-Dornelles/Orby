const loginSection = document.getElementById("adminLoginSection");
const panelSection = document.getElementById("adminPanelSection");
const loginForm = document.getElementById("adminLoginForm");
const loginStatus = document.getElementById("adminLoginStatus");
const announcementForm = document.getElementById("announcementForm");
const announcementStatus = document.getElementById("announcementStatus");
const announcementList = document.getElementById("announcementList");
const feedbackAdminStatus = document.getElementById("feedbackAdminStatus");
const feedbackAdminList = document.getElementById("feedbackAdminList");

async function adminRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("O servidor retornou uma resposta inválida.");
  }
  if (!response.ok) throw new Error(result.erro || "Não foi possível concluir a operação.");
  return result;
}

function mostrarStatus(elemento, mensagem, tipo = "") {
  elemento.textContent = mensagem;
  elemento.classList.toggle("error", tipo === "error");
  elemento.classList.toggle("success", tipo === "success");
}

function formatarData(data) {
  const dataValida = new Date(data);
  return Number.isNaN(dataValida.getTime())
    ? ""
    : dataValida.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

async function carregarAvisosAdmin() {
  const { avisos } = await adminRequest("/admin/api/announcements");
  announcementList.replaceChildren();
  document.getElementById("announcementCount").textContent = String(avisos.length);
  if (!avisos.length) {
    const vazio = document.createElement("p");
    vazio.className = "announcement-empty";
    vazio.textContent = "Nenhum aviso publicado ainda.";
    announcementList.appendChild(vazio);
    return;
  }

  avisos.forEach(aviso => {
    const item = document.createElement("article");
    item.className = "announcement-item";
    const conteudo = document.createElement("div");
    const titulo = document.createElement("h3");
    titulo.textContent = aviso.titulo;
    const mensagem = document.createElement("p");
    mensagem.textContent = aviso.mensagem;
    const data = document.createElement("time");
    data.textContent = formatarData(aviso.criadoEm);
    conteudo.append(titulo, mensagem, data);
    if (aviso.videoUrl) {
      const videoLink = document.createElement("a");
      videoLink.href = aviso.videoUrl;
      videoLink.target = "_blank";
      videoLink.rel = "noopener noreferrer";
      videoLink.textContent = "Abrir vídeo do YouTube";
      conteudo.appendChild(videoLink);
    }

    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "announcement-delete";
    excluir.textContent = "Excluir";
    excluir.addEventListener("click", async () => {
      if (!window.confirm(`Excluir o aviso "${aviso.titulo}"?`)) return;
      excluir.disabled = true;
      try {
        await adminRequest(`/admin/api/announcements/${encodeURIComponent(aviso._id)}`, {
          method: "DELETE"
        });
        await carregarAvisosAdmin();
        mostrarStatus(announcementStatus, "Aviso excluído.", "success");
      } catch (error) {
        excluir.disabled = false;
        mostrarStatus(announcementStatus, error.message, "error");
      }
    });
    item.append(conteudo, excluir);
    announcementList.appendChild(item);
  });
}

async function carregarFeedbackAdmin() {
  const { sugestoes } = await adminRequest("/admin/api/feedback");
  feedbackAdminList.replaceChildren();
  document.getElementById("feedbackAdminCount").textContent = String(sugestoes.length);
  if (!sugestoes.length) {
    const vazio = document.createElement("p");
    vazio.className = "announcement-empty";
    vazio.textContent = "Nenhuma sugestão recebida ainda.";
    feedbackAdminList.appendChild(vazio);
    return;
  }

  const tipos = { sugestao: "Sugestão", melhoria: "Melhoria", bug: "Bug" };
  sugestoes.forEach(sugestao => {
    const item = document.createElement("article");
    item.className = "feedback-admin-item";
    const conteudo = document.createElement("div");
    const cabecalho = document.createElement("div");
    cabecalho.className = "feedback-admin-item-heading";
    const tipoFeedback = Object.hasOwn(tipos, sugestao.tipo) ? sugestao.tipo : "";
    const tipo = document.createElement("span");
    tipo.className = `feedback-admin-type${tipoFeedback ? ` feedback-admin-type-${tipoFeedback}` : ""}`;
    tipo.textContent = tipos[tipoFeedback] || "Feedback";
    const data = document.createElement("time");
    data.textContent = formatarData(sugestao.criadoEm);
    cabecalho.append(tipo, data);

    const mensagem = document.createElement("p");
    mensagem.textContent = sugestao.mensagem;
    const autor = document.createElement("small");
    autor.className = "feedback-admin-author";
    autor.textContent = [sugestao.usuarioNome, sugestao.usuarioEmail].filter(Boolean).join(" · ") || "Usuário";
    conteudo.append(cabecalho, mensagem, autor);

    if (sugestao.imagemUrl) {
      const linkImagem = document.createElement("a");
      linkImagem.className = "feedback-admin-image-link";
      linkImagem.href = sugestao.imagemUrl;
      linkImagem.target = "_blank";
      linkImagem.rel = "noopener noreferrer";
      linkImagem.textContent = "Ver imagem anexada";
      const imagem = document.createElement("img");
      imagem.src = sugestao.imagemUrl;
      imagem.alt = "Imagem anexada à sugestão";
      imagem.loading = "lazy";
      linkImagem.prepend(imagem);
      conteudo.appendChild(linkImagem);
    }

    item.appendChild(conteudo);
    feedbackAdminList.appendChild(item);
  });
}

async function abrirPainelAdmin() {
  loginSection.hidden = true;
  panelSection.hidden = false;
  try {
    await carregarAvisosAdmin();
  } catch (error) {
    mostrarStatus(announcementStatus, error.message, "error");
  }
  try {
    await carregarFeedbackAdmin();
  } catch (error) {
    mostrarStatus(feedbackAdminStatus, error.message, "error");
  }
}

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type=submit]");
  button.disabled = true;
  mostrarStatus(loginStatus, "Verificando acesso...");
  try {
    await adminRequest("/admin/api/login", {
      method: "POST",
      body: JSON.stringify({
        login: document.getElementById("adminLogin").value,
        senha: document.getElementById("adminPassword").value
      })
    });
    await abrirPainelAdmin();
  } catch (error) {
    mostrarStatus(loginStatus, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

announcementForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = announcementForm.querySelector("button[type=submit]");
  button.disabled = true;
  mostrarStatus(announcementStatus, "Publicando aviso...");
  try {
    await adminRequest("/admin/api/announcements", {
      method: "POST",
      body: JSON.stringify({
        titulo: document.getElementById("announcementTitle").value,
        mensagem: document.getElementById("announcementMessage").value,
        videoUrl: document.getElementById("announcementVideoUrl").value
      })
    });
    announcementForm.reset();
    await carregarAvisosAdmin();
    mostrarStatus(announcementStatus, "Aviso publicado com sucesso.", "success");
  } catch (error) {
    mostrarStatus(announcementStatus, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("refreshFeedback").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  mostrarStatus(feedbackAdminStatus, "Carregando feedback...");
  try {
    await carregarFeedbackAdmin();
    mostrarStatus(feedbackAdminStatus, "Lista atualizada.", "success");
  } catch (error) {
    mostrarStatus(feedbackAdminStatus, error.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("adminLogout").addEventListener("click", async () => {
  try {
    await adminRequest("/admin/api/logout", { method: "POST" });
    panelSection.hidden = true;
    loginSection.hidden = false;
    loginForm.reset();
    mostrarStatus(loginStatus, "Sessão encerrada.", "success");
  } catch (error) {
    mostrarStatus(announcementStatus, error.message, "error");
  }
});

adminRequest("/admin/api/session")
  .then(abrirPainelAdmin)
  .catch(error => {
    if (!/Faça login como administrador/.test(error.message)) {
      mostrarStatus(loginStatus, error.message, "error");
    }
  });

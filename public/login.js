let modoCadastro = false;
const EMAIL_LEMBRADO_KEY = "orbyEmailLembrado";
const campoEmail = document.getElementById("email");
const lembrarAcesso = document.getElementById("lembrarAcesso");

try {
  const emailLembrado = localStorage.getItem(EMAIL_LEMBRADO_KEY);
  if (emailLembrado) {
    campoEmail.value = emailLembrado;
    lembrarAcesso.checked = true;
  }
} catch (erro) {
  console.error("Não foi possível recuperar o e-mail lembrado:", erro);
}

lembrarAcesso.addEventListener("change", () => {
  if (lembrarAcesso.checked) return;
  try {
    localStorage.removeItem(EMAIL_LEMBRADO_KEY);
  } catch (erro) {
    console.error("Não foi possível remover o e-mail lembrado:", erro);
  }
});

function atualizarTelaAcesso() {
  const senha = document.getElementById("senha");
  document.getElementById("tituloAcesso").lastChild.textContent = modoCadastro
    ? "Criar conta"
    : "Entrar no Orby";
  document.getElementById("botaoAcesso").textContent = modoCadastro ? "Cadastrar" : "Entrar";
  document.getElementById("textoAlternarAcesso").textContent = modoCadastro
    ? "Já tem uma conta?"
    : "Ainda não tem conta?";
  document.getElementById("alternarAcesso").textContent = modoCadastro ? "Entrar" : "Criar conta";
  document.getElementById("dicaSenhaCadastro").hidden = !modoCadastro;
  document.getElementById("statusAcesso").textContent = "";
  senha.autocomplete = modoCadastro ? "new-password" : "current-password";
  senha.minLength = modoCadastro ? 6 : 0;
}

document.getElementById("alternarAcesso").addEventListener("click", () => {
  modoCadastro = !modoCadastro;
  atualizarTelaAcesso();
  document.getElementById("email").focus();
});

async function login(event) {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;
  const button = document.getElementById("botaoAcesso");
  const status = document.getElementById("statusAcesso");
  button.disabled = true;
  status.textContent = modoCadastro ? "Criando sua conta..." : "Entrando...";
  status.classList.remove("erro");

  try {
    const resposta = await fetch(modoCadastro ? "/cadastro" : "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha })
    });
    const dados = await resposta.json();

    if (!resposta.ok) {
      status.classList.add("erro");
      status.textContent = dados.erro || (modoCadastro
        ? "Não foi possível criar a conta."
        : "Erro ao fazer login.");
      return;
    }

    try {
      if (lembrarAcesso.checked) {
        localStorage.setItem(EMAIL_LEMBRADO_KEY, email);
      } else {
        localStorage.removeItem(EMAIL_LEMBRADO_KEY);
      }
    } catch (erro) {
      console.error("Não foi possível salvar a preferência de acesso:", erro);
    }
    window.location.href = "/index.html";
  } catch (erro) {
    console.error(erro);
    status.classList.add("erro");
    status.textContent = "Erro ao conectar com o servidor.";
  } finally {
    button.disabled = false;
  }
}

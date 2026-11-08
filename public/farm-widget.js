const card = document.querySelector(".farm-widget-card");
const widget = card?.closest(".workspace-widget");
const workspace = document.getElementById("widgetsWorkspace");
const plot = document.getElementById("farmWidgetPlot");
const feedback = document.getElementById("farmWidgetFeedback");
const expandPlotButton = document.getElementById("farmWidgetExpandPlot");
const plotUpgradeInfo = document.getElementById("farmWidgetPlotUpgradeInfo");
const fertilizerCount = document.getElementById("farmWidgetFertilizerCount");
const fertilizeButton = document.getElementById("farmWidgetFertilize");
const buyFertilizerButton = document.getElementById("farmWidgetBuyFertilizer");
const shopOrbs = document.getElementById("farmWidgetShopOrbs");
const shopSeeds = document.getElementById("farmWidgetShopSeeds");
const shopFertilizer = document.getElementById("farmWidgetShopFertilizer");
const shopPlots = document.getElementById("farmWidgetShopPlots");
const mainView = document.getElementById("farmWidgetMain");
const inventoryPanel = document.getElementById("farmWidgetInventoryPanel");
const inventoryToggle = document.getElementById("farmWidgetInventoryToggle");
const inventoryClose = document.getElementById("farmWidgetInventoryClose");
const inventoryFilters = document.querySelectorAll("[data-farm-inventory-filter]");
const quickSaleItem = document.getElementById("farmWidgetQuickSaleItem");
const quickSaleQuantity = document.getElementById("farmWidgetQuickSaleQuantity");
const quickSalePrice = document.getElementById("farmWidgetQuickSalePrice");
const quickSaleButton = document.getElementById("farmWidgetQuickSaleButton");
const quickSaleStatus = document.getElementById("farmWidgetQuickSaleStatus");
const tasksToggle = document.getElementById("farmWidgetTasksToggle");
const tasksPanel = document.getElementById("farmWidgetTasksPanel");
const tasksClose = document.getElementById("farmWidgetTasksClose");
const taskStatus = document.getElementById("farmWidgetTaskStatus");
const taskDailySummary = document.getElementById("farmWidgetTaskDailySummary");
const taskFilters = document.querySelectorAll("[data-farm-task-filter]");
const taskList = document.getElementById("farmWidgetTaskList");
const settingsToggle = document.getElementById("farmWidgetSettingsToggle");
const settingsPanel = document.getElementById("farmWidgetSettingsPanel");
const settingsClose = document.getElementById("farmWidgetSettingsClose");
const notificationsEnabled = document.getElementById("farmWidgetNotificationsEnabled");
const settingsStatus = document.getElementById("farmWidgetSettingsStatus");
const rankingList = document.getElementById("farmWidgetRankingList");
const rankingRefresh = document.getElementById("farmWidgetRankingRefresh");
const orbsCount = document.getElementById("farmWidgetOrbs");
const shopToggle = document.getElementById("farmWidgetShopToggle");
const shopPanel = document.getElementById("farmWidgetShopPanel");
const shopClose = document.getElementById("farmWidgetShopClose");
const systemSeedsToggle = document.getElementById("farmWidgetSystemSeedsToggle");
const systemSeedsPanel = document.getElementById("farmWidgetSystemSeedsPanel");
const systemSeedListings = document.getElementById("farmWidgetSystemSeedListings");
const marketContent = document.getElementById("farmWidgetMarketContent");
const sellToggle = document.getElementById("farmWidgetSellToggle");
const sellForm = document.getElementById("farmWidgetSellForm");
const sellItem = document.getElementById("farmWidgetSellItem");
const sellQuantity = document.getElementById("farmWidgetSellQuantity");
const sellPrice = document.getElementById("farmWidgetSellPrice");
const sellAvailable = document.getElementById("farmWidgetSellAvailable");
const sellSubmitButton = sellForm?.querySelector('button[type="submit"]');
const inventoryCountElements = document.querySelectorAll("[data-farm-inventory-item]");
const shopStatus = document.getElementById("farmWidgetShopStatus");
const marketRefresh = document.getElementById("farmWidgetMarketRefresh");
const marketListings = document.getElementById("farmWidgetMarketListings");
const farmModal = document.getElementById("farmWidgetModal");
const farmModalContent = document.getElementById("farmWidgetModalContent");
const plantPanel = document.getElementById("farmWidgetPlantPanel");
const plantCancel = document.getElementById("farmWidgetPlantCancel");
const plantPlotNumber = document.getElementById("farmWidgetPlantPlotNumber");
const seedChoices = document.getElementById("farmWidgetSeedChoices");
const plantStatus = document.getElementById("farmWidgetPlantStatus");
const modalShortcuts = document.querySelectorAll("[data-farm-modal-panel]");
const resizeButton = document.getElementById("farmWidgetResize");
const minimumWidth = 240;
const maximumWidth = 420;
const minimumHeight = 190;
const maximumHeight = 680;
let farm = null;
let busy = false;
let settingsBusy = false;
let resizePointer = null;
let feedbackTimeout = 0;
let taskStatusOverride = "";
const requestedReadyNotifications = new Set();
let activeTaskFilter = "open";
let lastTaskViewKey = "";
let orderRefreshPending = false;
let nextDailyOrderRefreshAt = 0;
let sellPriceInitialized = false;
let activeInventoryFilter = "all";
let selectedPlotIndex = 0;
const cropIcons = {
  trigo: "🌾",
  cenoura: "🥕",
  tomate: "🍅",
  beterraba: "🫜",
  alface: "🥬",
  milho: "🌽",
  beringela: "🍆",
  abobora: "🎃"
};

if (card && widget && workspace && plot && feedback && expandPlotButton &&
    plotUpgradeInfo && fertilizerCount && fertilizeButton &&
    buyFertilizerButton && shopOrbs && shopSeeds && shopFertilizer && shopPlots &&
    mainView && inventoryPanel && inventoryToggle && inventoryClose &&
    quickSaleItem && quickSaleQuantity && quickSalePrice && quickSaleButton && quickSaleStatus &&
    tasksToggle && tasksPanel && tasksClose && taskStatus && taskDailySummary && taskList &&
    settingsToggle && settingsPanel && settingsClose && notificationsEnabled && settingsStatus &&
    rankingList && rankingRefresh && orbsCount &&
    shopToggle && shopPanel && shopClose &&
    systemSeedsToggle && systemSeedsPanel && systemSeedListings && marketContent && sellForm &&
    sellToggle && sellItem && sellQuantity && sellPrice && sellAvailable && sellSubmitButton && shopStatus &&
    marketRefresh && marketListings && farmModal && farmModalContent && plantPanel && plantCancel &&
    plantPlotNumber && seedChoices && plantStatus && resizeButton) {
let activePanel = "farm";
farmModalContent.append(inventoryPanel, tasksPanel, settingsPanel, shopPanel);

function growthView(plantacao) {
    if (!plantacao || plantacao.estado === "vazio") {
      return { stage: "empty", ready: false, secondsLeft: 0, progress: 0 };
    }
    const plantedAt = Date.parse(plantacao.plantadoEm);
    const readyAt = Date.parse(plantacao.amadureceEm);
    const now = Date.now();
    const secondsLeft = Math.max(0, Math.ceil((readyAt - now) / 1000));
    if (secondsLeft === 0 || plantacao.estado === "pronta") {
      return { stage: "ripe", ready: true, secondsLeft: 0, progress: 1 };
    }
    const duration = Math.max(1, readyAt - plantedAt);
    const progress = Math.max(0, Math.min(1, (now - plantedAt) / duration));
    return {
      stage: progress < 0.4 ? "seed" : progress < 0.8 ? "sprout" : "ripe",
      ready: false,
      secondsLeft,
      progress
    };
  }

  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return [hours, minutes, remainingSeconds]
      .map(value => String(value).padStart(2, "0"))
      .join(":");
  }

  function precoVendaRapida(cultura) {
    return cultura.precoVendaRapidaOrbs;
  }

  function renderQuickSale() {
    const culturasDisponiveis = Object.entries(farm.configuracao.culturas)
      .filter(([, cultura]) => (farm.inventario[cultura.itemColheita] ?? 0) > 0);
    const itemSelecionado = quickSaleItem.value;
    const optionsKey = culturasDisponiveis
      .map(([id, cultura]) => `${id}:${farm.inventario[cultura.itemColheita] ?? 0}`)
      .join("|");
    if (quickSaleItem.dataset.optionsKey !== optionsKey) {
      quickSaleItem.replaceChildren(...culturasDisponiveis.map(([id, cultura]) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = `${cultura.nome} · ${farm.inventario[cultura.itemColheita]} disponível`;
        return option;
      }));
      quickSaleItem.dataset.optionsKey = optionsKey;
    }
    if (culturasDisponiveis.some(([id]) => id === itemSelecionado)) quickSaleItem.value = itemSelecionado;

    const culturaSelecionada = farm.configuracao.culturas[quickSaleItem.value];
    const quantidadeAnterior = Number(quickSaleQuantity.value) || 1;
    const quantidadeDisponivel = culturaSelecionada
      ? farm.inventario[culturaSelecionada.itemColheita] ?? 0
      : 0;
    quickSaleQuantity.max = String(quantidadeDisponivel);
    if (quantidadeDisponivel > 0) {
      quickSaleQuantity.value = String(Math.max(1, Math.min(quantidadeAnterior, quantidadeDisponivel)));
    } else {
      quickSaleQuantity.value = "";
    }
    const quantidadeSelecionada = Number(quickSaleQuantity.value) || 0;
    quickSaleItem.disabled = culturasDisponiveis.length === 0 || busy;
    quickSaleQuantity.disabled = quantidadeDisponivel === 0 || busy;
    if (!culturaSelecionada) {
      quickSalePrice.textContent = "Tenha vegetais colhidos para vender.";
      quickSaleButton.disabled = true;
    } else {
      const precoUnitario = precoVendaRapida(culturaSelecionada);
      const valorTotal = Math.round(precoUnitario * 100) * quantidadeSelecionada / 100;
      const resumoValor = quantidadeSelecionada
        ? `Cada vegetal: ${precoUnitario.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Orbs · Total: ${valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Orbs`
        : "Sem unidades disponíveis para vender.";
      quickSalePrice.textContent = resumoValor;
      quickSaleButton.disabled = busy || quantidadeSelecionada === 0;
      quickSaleButton.textContent = quantidadeSelecionada ? `Vender ${quantidadeSelecionada}` : "Vender";
    }
  }

  function render() {
    if (!farm) return;
    syncCropOptions();
    const canteiros = farm.canteiros?.length ? farm.canteiros : [farm.plantacao];
    if (selectedPlotIndex >= canteiros.length) selectedPlotIndex = 0;
    const plantacao = canteiros[selectedPlotIndex];
    canteiros.forEach((canteiro, indice) => {
      const crescimento = growthView(canteiro);
      if (crescimento.ready) requestReadyCropNotification(indice, canteiro);
    });
    while (plot.children.length < canteiros.length) {
      plot.appendChild(createPlotTile(plot.children.length));
    }
    while (plot.children.length > canteiros.length) plot.lastElementChild.remove();
    canteiros.forEach((canteiro, indice) =>
      updatePlotTile(plot.children[indice], canteiro, indice, indice === selectedPlotIndex)
    );
    plot.setAttribute("aria-label", `Horta com ${canteiros.length} canteiros`);
    inventoryCountElements.forEach(element => {
      const quantity = farm.inventario[element.dataset.farmInventoryItem] ?? 0;
      element.querySelector("b").textContent = String(quantity);
      element.hidden = quantity < 1 ||
        (activeInventoryFilter !== "all" && element.dataset.farmInventoryCategory !== activeInventoryFilter);
    });
    updateSellQuantity();
    orbsCount.textContent = Number(farm.orbs).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    shopOrbs.textContent = Number(farm.orbs).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    shopSeeds.textContent = String(Object.values(farm.configuracao.culturas)
      .reduce((total, cultura) => total + (farm.inventario[cultura.itemSemente] ?? 0), 0));
    shopFertilizer.textContent = String(farm.adubos ?? 0);
    shopPlots.textContent = `${canteiros.length}/${farm.canteirosMaximos || 9}`;
    renderQuickSale();

    const precoCanteiro = farm.precoProximoCanteiro;
    expandPlotButton.disabled = busy || precoCanteiro === null || precoCanteiro === undefined ||
      Number(farm.orbs) < precoCanteiro;
    expandPlotButton.querySelector("span").textContent = precoCanteiro === null || precoCanteiro === undefined
      ? "Horta completa"
      : `Expandir · ${precoCanteiro} Orbs`;
    plotUpgradeInfo.textContent = precoCanteiro === null || precoCanteiro === undefined
      ? "Sua horta já tem todos os canteiros."
      : `O próximo canteiro custa ${precoCanteiro} Orbs.`;
    fertilizerCount.textContent = `Adubo ×${farm.adubos ?? 0}`;
    fertilizeButton.disabled = busy || !plantacao || plantacao.estado !== "crescendo" ||
      plantacao.adubada === true || (farm.adubos ?? 0) < 1;
    buyFertilizerButton.disabled = busy || Number(farm.orbs) < (farm.precoAdubo ?? 2);
    buyFertilizerButton.querySelector("span").textContent =
      `Comprar adubo · ${farm.precoAdubo ?? 2} Orbs`;

    if (activePanel === "plant") {
      plantPlotNumber.textContent = String(selectedPlotIndex + 1);
      renderSeedChoices();
    }
    renderTaskList();
  }

  function renderSeedChoices() {
    if (!farm) return;
    seedChoices.replaceChildren(...Object.entries(farm.configuracao.culturas).map(([id, cultura]) => {
      const quantidade = farm.inventario[cultura.itemSemente] ?? 0;
      const tempoMinutos = Math.ceil(cultura.tempoCrescimentoSegundos / 60);
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "farm-widget-seed-choice";
      choice.disabled = busy;
      if (quantidade < 1) choice.classList.add("is-unavailable");
      const icon = document.createElement("span");
      icon.className = "farm-widget-seed-choice-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = cropIcons[id] || "🌱";
      const name = document.createElement("strong");
      name.textContent = cultura.nome;
      const detail = document.createElement("small");
      detail.textContent = `${tempoMinutos} min · colheita ×${cultura.quantidadeColheita}`;
      const stock = document.createElement("span");
      stock.className = "farm-widget-seed-choice-stock";
      stock.textContent = quantidade > 0 ? `Sementes ×${quantidade}` : "Ver sementes na loja →";
      choice.append(icon, name, detail, stock);
      choice.addEventListener("click", () => {
        if (quantidade > 0) void plantCrop(id);
        else {
          setFarmPanel("shop");
          toggleSystemSeedPanel(true);
          void loadMarket();
        }
      });
      return choice;
    }));
  }

  function createPlotTile(indice) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "farm-widget-plot";
    const art = document.createElement("span");
    art.className = "farm-widget-crop-art";
    art.setAttribute("aria-hidden", "true");
    const label = document.createElement("strong");
    const timerLabel = document.createElement("small");
    const progress = document.createElement("span");
    progress.className = "farm-widget-plot-progress";
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("span");
    progress.appendChild(fill);
    const fertilizerBadge = document.createElement("span");
    fertilizerBadge.className = "farm-widget-plot-fertilized";
    fertilizerBadge.setAttribute("aria-label", "Adubada");
    fertilizerBadge.textContent = "✦";
    tile.append(art, label, timerLabel, progress, fertilizerBadge);
    tile.addEventListener("click", () => {
      if (busy) return;
      selectedPlotIndex = indice;
      render();
      const canteiro = farm.canteiros?.[indice] || farm.plantacao;
      const growth = growthView(canteiro);
      if (growth.stage === "empty") openPlantPanel();
      else if (growth.ready) void harvestCrop(indice);
    });
    return tile;
  }

  function updatePlotTile(tile, plantacao, indice, selecionado) {
    const crescimento = growthView(plantacao);
    const cultura = farm.configuracao.culturas[plantacao?.cultura] || null;
    const nomeCultura = cultura?.nome || "Cultura desconhecida";
    tile.dataset.stage = crescimento.stage;
    tile.setAttribute("aria-pressed", String(selecionado));
    tile.setAttribute("aria-label", crescimento.stage === "empty"
      ? `Canteiro ${indice + 1}, vazio, toque para plantar`
      : `Canteiro ${indice + 1}, ${nomeCultura}, ${crescimento.ready ? "pronto para colher, toque para colher" : `crescendo, faltam ${formatDuration(crescimento.secondsLeft)}`}${plantacao.adubada ? ", adubado" : ""}`);
    tile.classList.toggle("is-selected", selecionado);
    tile.querySelector(".farm-widget-crop-art").textContent =
      cultura ? cropIcons[plantacao.cultura] || "🌱" : "＋";
    const label = tile.querySelector("strong");
    label.textContent = plantacao?.cultura && !cultura
      ? nomeCultura
      : cultura?.nome || `Canteiro ${indice + 1}`;
    const timerLabel = tile.querySelector("small");
    timerLabel.textContent = crescimento.stage === "empty"
      ? "Plantar"
      : crescimento.ready ? "Colher" : formatDuration(crescimento.secondsLeft);
    const progress = tile.querySelector(".farm-widget-plot-progress");
    const progressPercent = Math.round(crescimento.progress * 100);
    progress.hidden = crescimento.stage === "empty";
    progress.setAttribute("aria-label", cultura ? `Crescimento de ${cultura.nome}` : "Crescimento da cultura");
    progress.setAttribute("aria-valuenow", String(progressPercent));
    progress.firstElementChild.style.width = `${progressPercent}%`;
    tile.querySelector(".farm-widget-plot-fertilized").hidden = plantacao?.adubada !== true;
  }

  function setTaskFilter(filter) {
    activeTaskFilter = filter;
    taskFilters.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.farmTaskFilter === filter));
    });
    lastTaskViewKey = "";
    renderTaskList();
  }

  function renderTaskList() {
    if (!farm) return;
    const pedidos = farm.pedidos || [];
    const pedidosRestantes = pedidos.filter(pedido => !pedido.concluido).length;
    taskDailySummary.textContent =
      `${pedidosRestantes} de ${farm.pedidosLimiteDiario || 10} pedidos disponíveis hoje · renova à meia-noite (Brasília).`;
    const viewKey = JSON.stringify([
      activeTaskFilter,
      taskStatusOverride,
      busy,
      pedidos,
      pedidos.map(pedido => farm.inventario[pedido.item] ?? 0)
    ]);
    if (viewKey === lastTaskViewKey) return;
    lastTaskViewKey = viewKey;
    taskStatus.textContent = taskStatusOverride;
    taskList.replaceChildren();

    const pedidosVisiveis = pedidos.filter(pedido =>
      activeTaskFilter === "closed" ? pedido.concluido : !pedido.concluido
    );
    if (!pedidosVisiveis.length) {
      const vazio = document.createElement("li");
      vazio.className = "farm-widget-task-empty";
      vazio.textContent = activeTaskFilter === "closed"
        ? "Você ainda não entregou pedidos hoje."
        : "Todos os pedidos de hoje foram concluídos.";
      taskList.appendChild(vazio);
      return;
    }

    for (const pedido of pedidosVisiveis) {
      const linha = document.createElement("li");
      linha.className = "farm-widget-task-item";
      const produto = document.createElement("span");
      produto.className = "farm-widget-task-product";
      const nome = document.createElement("strong");
      const iconeVegetal = createCropIcon(pedido.item, "farm-widget-crop-icon");
      if (iconeVegetal) nome.appendChild(iconeVegetal);
      nome.append(pedido.nome);
      const quantidade = document.createElement("small");
      quantidade.textContent = `Quantidade: ${pedido.quantidade}`;
      produto.append(nome, quantidade);

      const recompensa = document.createElement("strong");
      recompensa.className = "farm-widget-task-reward";
      const iconeMoeda = document.createElement("i");
      iconeMoeda.className = "bi bi-coin";
      iconeMoeda.setAttribute("aria-hidden", "true");
      recompensa.appendChild(iconeMoeda);
      recompensa.append(` ${pedido.recompensaOrbs} Orbs`);
      linha.append(produto, recompensa);

      if (pedido.concluido) {
        const fechado = document.createElement("span");
        fechado.className = "farm-widget-task-closed";
        fechado.textContent = "Entregue hoje";
        linha.appendChild(fechado);
      } else {
        const entregar = document.createElement("button");
        entregar.type = "button";
        entregar.className = "farm-widget-action farm-widget-task-deliver";
        entregar.textContent = "Entregar";
        entregar.disabled = busy || (farm.inventario[pedido.item] ?? 0) < pedido.quantidade;
        entregar.addEventListener("click", () => void deliverOrder(pedido.id));
        linha.appendChild(entregar);
      }
      taskList.appendChild(linha);
    }
  }

  taskFilters.forEach(filter => {
    filter.addEventListener("click", () => setTaskFilter(filter.dataset.farmTaskFilter));
  });

  function syncCropOptions() {
    const culturas = farm.configuracao.culturas;
    const opcoesVenda = Object.values(culturas).flatMap(dados => [
      [dados.itemColheita, dados.nome],
      [dados.itemSemente, `Sementes de ${dados.nome.toLowerCase()}`]
    ]);
    const opcoesAtuais = [...sellItem.options].map(option => `${option.value}:${option.textContent}`).join("|");
    const opcoesEsperadas = opcoesVenda.map(([item, nome]) => `${item}:${nome}`).join("|");
    if (opcoesAtuais !== opcoesEsperadas) {
      sellItem.replaceChildren(...opcoesVenda.map(([item, nome]) => {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = nome;
        return option;
      }));
    }
    if (!sellPriceInitialized) {
      const culturaVenda = cropForItem(sellItem.value);
      if (culturaVenda) {
        sellPrice.value = String(sellItem.value === culturaVenda.itemSemente
          ? culturaVenda.precoSementeOrbs
          : culturaVenda.precoColheitaOrbs);
        sellPriceInitialized = true;
      }
    }
  }

  function cropForItem(item) {
    if (!farm?.configuracao?.culturas) return null;
    return Object.values(farm.configuracao.culturas).find(cultura =>
      cultura.itemSemente === item || cultura.itemColheita === item
    );
  }

  function createCropIcon(item, className) {
    const cultura = farm?.configuracao?.culturas
      ? Object.entries(farm.configuracao.culturas).find(([, value]) =>
        value.itemSemente === item || value.itemColheita === item
      )
      : null;
    if (!cultura) return null;
    const icon = document.createElement("span");
    icon.className = className;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = cropIcons[cultura[0]] || "🌱";
    return icon;
  }

  function itemDisplayName(item, quantidade = 1) {
    const cultura = cropForItem(item);
    if (!cultura) return item;
    if (item === cultura.itemSemente) return `sementes de ${cultura.nome.toLowerCase()}`;
    const nome = cultura.nome.toLowerCase();
    if (quantidade === 1) return nome;
    if (nome === "trigo") return "trigos";
    return `${nome}s`;
  }

  function selectedSellInventory() {
    return farm?.inventario[sellItem.value] ?? 0;
  }

  function updateSellQuantity() {
    const available = selectedSellInventory();
    sellAvailable.textContent = String(available);
    sellQuantity.max = String(available);
    if (Number(sellQuantity.value) > available) sellQuantity.value = String(available || 1);
    sellSubmitButton.disabled = busy || available < 1;
  }

  async function requestFarm(url, method = "GET", body) {
    const response = await fetch(url, {
      method,
      headers: {
        "Accept": "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.fazenda) farm = result.fazenda;
      throw new Error(result.erro || "Não foi possível atualizar a fazenda.");
    }
    return result;
  }

  async function loadFarm() {
    try {
      const result = await requestFarm("/api/fazenda");
      farm = result;
      notificationsEnabled.checked = farm.notificacoesHabilitadas !== false;
      hideFarmFeedback();
      render();
    } catch (error) {
      console.error("Não foi possível carregar a fazenda.", error);
      showFarmFeedback(error.message);
    }
  }

  function showFarmFeedback(message) {
    window.clearTimeout(feedbackTimeout);
    feedback.textContent = message;
    feedback.hidden = false;
    feedbackTimeout = window.setTimeout(hideFarmFeedback, 3500);
  }

  function hideFarmFeedback() {
    window.clearTimeout(feedbackTimeout);
    feedbackTimeout = 0;
    feedback.textContent = "";
    feedback.hidden = true;
  }

  function requestReadyCropNotification(indiceCanteiro, plantacao) {
    if (farm?.notificacoesHabilitadas === false || plantacao.notificacaoProntaEnviadaEm) return;
    const maturityKey = `${indiceCanteiro}:${plantacao.cultura}:${plantacao.amadureceEm}`;
    if (requestedReadyNotifications.has(maturityKey)) return;
    requestedReadyNotifications.add(maturityKey);
    void requestFarm("/api/fazenda/colheita/notificar", "POST", { canteiro: indiceCanteiro }).catch(error => {
      console.error("Não foi possível registrar a notificação de colheita pronta.", error);
    });
  }

  async function plantCrop(culturaId) {
    if (!farm || busy) return;
    const cultura = farm.configuracao.culturas[culturaId];
    const canteiro = farm.canteiros?.[selectedPlotIndex] || farm.plantacao;
    if (!cultura || growthView(canteiro).stage !== "empty") return;
    if ((farm.inventario[cultura.itemSemente] ?? 0) < 1) {
      plantStatus.textContent = `Você não tem sementes de ${cultura.nome.toLowerCase()}.`;
      return;
    }

    busy = true;
    plantStatus.textContent = "Plantando...";
    render();
    try {
      const result = await requestFarm("/api/fazenda/plantar", "POST", {
        cultura: culturaId,
        canteiro: selectedPlotIndex
      });
      farm = result.fazenda;
      showFarmFeedback(`Semente de ${cultura.nome.toLowerCase()} plantada no canteiro ${selectedPlotIndex + 1}!`);
      if (farmModal.open) farmModal.close();
    } catch (error) {
      console.error("Não foi possível plantar a cultura.", error);
      plantStatus.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  }

  function openPlantPanel() {
    if (!farm || busy) return;
    const canteiro = farm.canteiros?.[selectedPlotIndex] || farm.plantacao;
    if (growthView(canteiro).stage !== "empty") return;
    plantStatus.textContent = "";
    setFarmPanel("plant");
  }

  async function harvestCrop(plotIndex) {
    if (!farm || busy) return;
    const canteiro = farm.canteiros?.[plotIndex] || farm.plantacao;
    if (!growthView(canteiro).ready) return;
    const culturaColheita = canteiro.cultura;
    busy = true;
    render();
    try {
      const result = await requestFarm(
        "/api/fazenda/colher",
        "POST",
        { canteiro: plotIndex }
      );
      farm = result.fazenda;
      const cultura = farm.configuracao.culturas[culturaColheita];
      showFarmFeedback(
        `Colheita concluída: +${result.colheita[cultura.itemColheita]} ${cultura.nome.toLowerCase()}${result.colheita[cultura.itemSemente] ? ` e +1 semente de ${cultura.nome.toLowerCase()}` : ""}.`
      );
    } catch (error) {
      console.error("Não foi possível colher a plantação.", error);
      showFarmFeedback(error.message);
    } finally {
      busy = false;
      render();
    }
  }

  expandPlotButton.addEventListener("click", async () => {
    if (!farm || busy || expandPlotButton.disabled) return;
    busy = true;
    shopStatus.textContent = "";
    render();
    try {
      const result = await requestFarm("/api/fazenda/canteiro/expandir", "POST", {});
      farm = result.fazenda;
      selectedPlotIndex = farm.canteiros.length - 1;
      shopStatus.textContent = `Novo canteiro aberto por ${result.preco} Orbs.`;
    } catch (error) {
      console.error("Não foi possível expandir a horta.", error);
      shopStatus.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  });

  fertilizeButton.addEventListener("click", async () => {
    if (!farm || busy || fertilizeButton.disabled) return;
    busy = true;
    render();
    try {
      const result = await requestFarm("/api/fazenda/adubo/aplicar", "POST", {
        canteiro: selectedPlotIndex
      });
      farm = result.fazenda;
      showFarmFeedback("Adubo aplicado! A colheita chega mais rápido e rende em dobro.");
    } catch (error) {
      console.error("Não foi possível adubar o canteiro.", error);
      showFarmFeedback(error.message);
    } finally {
      busy = false;
      render();
    }
  });

  buyFertilizerButton.addEventListener("click", async () => {
    if (!farm || busy || buyFertilizerButton.disabled) return;
    busy = true;
    shopStatus.textContent = "";
    render();
    try {
      const result = await requestFarm("/api/fazenda/adubo/comprar", "POST", { quantidade: 1 });
      farm = result.fazenda;
      shopStatus.textContent = `Saco de adubo comprado por ${result.compra.orbs} Orbs.`;
    } catch (error) {
      console.error("Não foi possível comprar adubo.", error);
      shopStatus.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  });

  const farmPanels = {
    inventory: inventoryPanel,
    tasks: tasksPanel,
    settings: settingsPanel,
    shop: shopPanel,
    plant: plantPanel
  };
  const farmPanelTitles = {
    inventory: "farmWidgetInventoryTitle",
    tasks: "farmWidgetTasksTitle",
    settings: "farmWidgetSettingsTitle",
    shop: "farmWidgetShopTitle",
    plant: "farmWidgetPlantTitle"
  };

  function updateFarmPanelButtons(panel) {
    const buttonStates = [
      [inventoryToggle, "inventory", "Abrir inventário", "Inventário", "Fechar inventário"],
      [tasksToggle, "tasks", "Abrir pedidos", "Pedidos de entrega", "Fechar pedidos"],
      [settingsToggle, "settings", "Configurações da Orby Farm", "Configurações", "Fechar configurações"],
      [shopToggle, "shop", "Abrir loja", "Loja de jogadores", "Fechar loja"]
    ];
    for (const [button, name, closedLabel, closedTitle, openLabel] of buttonStates) {
      const isOpen = panel === name;
      button.setAttribute("aria-expanded", String(isOpen));
      button.setAttribute("aria-label", isOpen ? openLabel : closedLabel);
      button.title = isOpen ? "Fechar" : closedTitle;
    }
    modalShortcuts.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.farmModalPanel === panel));
    });
  }

  function setFarmPanel(panel) {
    activePanel = panel;
    mainView.hidden = false;
    for (const [name, element] of Object.entries(farmPanels)) {
      element.hidden = name !== panel;
    }
    updateFarmPanelButtons(panel);

    if (panel === "farm") {
      if (farmModal.open) farmModal.close();
      return;
    }

    toggleSellForm(false);
    toggleSystemSeedPanel(false);
    farmModal.setAttribute("aria-labelledby", farmPanelTitles[panel]);
    if (!farmModal.open) farmModal.showModal();
    if (panel === "plant") {
      plantPlotNumber.textContent = String(selectedPlotIndex + 1);
      renderSeedChoices();
    }
  }

  modalShortcuts.forEach(button => {
    button.addEventListener("click", () => {
      const panel = button.dataset.farmModalPanel;
      if (!Object.hasOwn(farmPanels, panel)) return;
      setFarmPanel(panel);
      if (panel === "shop") void loadMarket();
      if (panel === "settings") void loadFarmRanking();
    });
  });
  plantCancel.addEventListener("click", () => setFarmPanel("farm"));

  farmModal.addEventListener("click", event => {
    if (event.target === farmModal) farmModal.close();
  });
  farmModal.addEventListener("close", () => {
    activePanel = "farm";
    mainView.hidden = false;
    for (const element of Object.values(farmPanels)) element.hidden = true;
    updateFarmPanelButtons("farm");
    toggleSellForm(false);
    toggleSystemSeedPanel(false);
    plantStatus.textContent = "";
  });

  function toggleInventory(open) {
    toggleSystemSeedPanel(false);
    setFarmPanel(open ? "inventory" : "farm");
  }

  inventoryToggle.addEventListener("click", () => toggleInventory(inventoryPanel.hidden));
  inventoryClose.addEventListener("click", () => toggleInventory(false));

  inventoryFilters.forEach(filter => {
    filter.addEventListener("click", () => {
      const category = filter.dataset.farmInventoryFilter;
      inventoryFilters.forEach(option => {
        option.setAttribute("aria-pressed", String(option === filter));
      });
      activeInventoryFilter = category;
      if (farm) render();
    });
  });

  quickSaleItem.addEventListener("change", render);
  quickSaleQuantity.addEventListener("input", render);
  quickSaleQuantity.addEventListener("change", render);
  quickSaleButton.addEventListener("click", async () => {
    if (!farm || busy || quickSaleButton.disabled) return;
    const cultura = farm.configuracao.culturas[quickSaleItem.value];
    if (!cultura) return;
    const quantidade = Number(quickSaleQuantity.value);
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 ||
        quantidade > (farm.inventario[cultura.itemColheita] ?? 0)) return;

    busy = true;
    quickSaleStatus.textContent = "";
    render();
    try {
      const result = await requestFarm("/api/fazenda/venda-rapida", "POST", {
        item: cultura.itemColheita,
        quantidade
      });
      farm = result.fazenda;
      quickSaleStatus.textContent =
        `Vendidos ${result.venda.quantidade} ${itemDisplayName(cultura.itemColheita, result.venda.quantidade)} por ${result.venda.orbs.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })} Orbs.`;
    } catch (error) {
      console.error("Não foi possível concluir a venda rápida.", error);
      quickSaleStatus.textContent = error.message;
    } finally {
      busy = false;
      render();
    }
  });

  function toggleTasks(open) {
    toggleSystemSeedPanel(false);
    setFarmPanel(open ? "tasks" : "farm");
  }

  tasksToggle.addEventListener("click", () => toggleTasks(activePanel !== "tasks"));
  tasksClose.addEventListener("click", () => toggleTasks(false));

  function toggleSettings(open) {
    setFarmPanel(open ? "settings" : "farm");
    if (open) void loadFarmRanking();
  }

  settingsToggle.addEventListener("click", () => toggleSettings(activePanel !== "settings"));
  settingsClose.addEventListener("click", () => toggleSettings(false));
  rankingRefresh.addEventListener("click", () => void loadFarmRanking());

  async function loadFarmRanking() {
    rankingRefresh.disabled = true;
    rankingList.replaceChildren();
    const loading = document.createElement("li");
    loading.className = "farm-widget-ranking-empty";
    loading.textContent = "Carregando ranking...";
    rankingList.appendChild(loading);
    try {
      const response = await fetch("/api/fazenda/ranking", {
        headers: { "Accept": "application/json" }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || "Não foi possível carregar o ranking.");
      rankingList.replaceChildren();
      if (!result.jogadores.length) {
        const empty = document.createElement("li");
        empty.className = "farm-widget-ranking-empty";
        empty.textContent = "Ainda não há jogadores com Orbs no ranking.";
        rankingList.appendChild(empty);
        return;
      }

      result.jogadores.forEach(jogador => {
        const row = document.createElement("li");
        row.className = "farm-widget-ranking-item";
        const position = document.createElement("strong");
        position.className = "farm-widget-ranking-position";
        position.textContent = String(jogador.posicao);
        const profile = document.createElement("span");
        profile.className = "farm-widget-ranking-profile";
        const name = document.createElement("strong");
        name.className = "farm-widget-ranking-name";
        name.textContent = jogador.nome;
        if (jogador.fotoPerfilUrl) {
          const avatar = document.createElement("img");
          avatar.className = "farm-widget-ranking-avatar";
          avatar.src = jogador.fotoPerfilUrl;
          avatar.alt = "";
          avatar.loading = "lazy";
          avatar.addEventListener("error", () => {
            avatar.replaceWith(createRankingAvatarFallback());
          }, { once: true });
          profile.appendChild(avatar);
        } else {
          profile.appendChild(createRankingAvatarFallback());
        }
        profile.appendChild(name);
        const wealth = document.createElement("strong");
        wealth.className = "farm-widget-ranking-wealth";
        wealth.textContent = `${Number(jogador.orbs).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} Orbs`;
        row.append(position, profile, wealth);
        rankingList.appendChild(row);
      });
    } catch (error) {
      console.error("Não foi possível carregar o ranking de riqueza.", error);
      rankingList.replaceChildren();
      const message = document.createElement("li");
      message.className = "farm-widget-ranking-empty";
      message.textContent = error.message;
      rankingList.appendChild(message);
    } finally {
      rankingRefresh.disabled = false;
    }
  }

  function createRankingAvatarFallback() {
    const fallback = document.createElement("span");
    fallback.className = "farm-widget-ranking-avatar-fallback";
    fallback.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
    icon.className = "bi bi-person-fill";
    fallback.appendChild(icon);
    return fallback;
  }

  notificationsEnabled.addEventListener("change", async () => {
    if (settingsBusy || !farm) return;
    const habilitadas = notificationsEnabled.checked;
    settingsBusy = true;
    notificationsEnabled.disabled = true;
    settingsStatus.textContent = "Salvando configuração...";
    try {
      const result = await requestFarm("/api/fazenda/notificacoes", "PUT", { habilitadas });
      farm = result.fazenda;
      notificationsEnabled.checked = farm.notificacoesHabilitadas;
      settingsStatus.textContent = habilitadas
        ? "Notificações ativadas."
        : "Notificações desativadas.";
      render();
    } catch (error) {
      console.error("Não foi possível salvar as notificações da Orby Farm.", error);
      notificationsEnabled.checked = farm.notificacoesHabilitadas !== false;
      settingsStatus.textContent = error.message;
    } finally {
      settingsBusy = false;
      notificationsEnabled.disabled = false;
    }
  });

  function toggleSystemSeedPanel(open) {
    systemSeedsPanel.hidden = !open;
    marketContent.hidden = open;
    sellForm.hidden = true;
    sellToggle.setAttribute("aria-expanded", "false");
    sellToggle.setAttribute("aria-label", "Anunciar produto");
    sellToggle.title = "Anunciar produto";
    systemSeedsToggle.setAttribute("aria-expanded", String(open));
    systemSeedsToggle.setAttribute("aria-label", open ? "Fechar sementes do sistema" : "Comprar sementes do sistema");
    systemSeedsToggle.title = open ? "Fechar sementes do sistema" : "Comprar sementes do sistema";
  }

  systemSeedsToggle.addEventListener("click", () => toggleSystemSeedPanel(systemSeedsPanel.hidden));

  async function loadMarket() {
    marketListings.replaceChildren();
    const loading = document.createElement("li");
    loading.className = "farm-widget-market-empty";
    loading.textContent = "Carregando anúncios...";
    marketListings.appendChild(loading);
    try {
      const response = await fetch("/api/fazenda/mercado", { headers: { "Accept": "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.erro || "Não foi possível carregar a loja.");
      renderMarket(result.anuncios);
      renderSystemSeedOffers(result.ofertasSementes);
    } catch (error) {
      console.error("Não foi possível carregar os anúncios da loja.", error);
      marketListings.replaceChildren();
      const message = document.createElement("li");
      message.className = "farm-widget-market-empty";
      message.textContent = error.message;
      marketListings.appendChild(message);
      systemSeedListings.replaceChildren();
    }
  }

  function renderMarket(anuncios) {
    marketListings.replaceChildren();
    if (!anuncios.length) {
      const empty = document.createElement("li");
      empty.className = "farm-widget-market-empty";
      empty.textContent = "Ainda não há produtos anunciados.";
      marketListings.appendChild(empty);
      return;
    }

    for (const anuncio of anuncios) {
      const item = document.createElement("li");
      item.className = "farm-widget-market-item";
      const details = document.createElement("div");
      details.className = "farm-widget-market-details";
      const title = document.createElement("strong");
      const itemName = itemDisplayName(anuncio.item, anuncio.quantidade);
      const cropIcon = createCropIcon(anuncio.item, "farm-widget-market-crop-icon");
      if (cropIcon) title.appendChild(cropIcon);
      title.append(`${anuncio.quantidade} ${itemName}`);
      const seller = document.createElement("div");
      seller.className = "farm-widget-market-seller";
      const sellerName = document.createElement("small");
      sellerName.textContent = `Por ${anuncio.vendedor}`;
      const createAvatarFallback = () => {
        const fallback = document.createElement("span");
        fallback.className = "farm-widget-market-avatar-fallback";
        fallback.setAttribute("aria-hidden", "true");
        const icon = document.createElement("i");
        icon.className = "bi bi-person-fill";
        fallback.appendChild(icon);
        return fallback;
      };
      if (anuncio.fotoPerfilUrl) {
        const avatar = document.createElement("img");
        avatar.className = "farm-widget-market-avatar";
        avatar.src = anuncio.fotoPerfilUrl;
        avatar.alt = "";
        avatar.loading = "lazy";
        avatar.addEventListener("error", () => {
          avatar.replaceWith(createAvatarFallback());
        }, { once: true });
        seller.appendChild(avatar);
      } else {
        seller.appendChild(createAvatarFallback());
      }
      seller.appendChild(sellerName);
      const price = document.createElement("b");
      price.textContent = `${anuncio.precoTotal} Orbs pelo lote`;
      details.append(title, seller, price);
      item.appendChild(details);

      if (anuncio.isMine) {
        const own = document.createElement("span");
        own.className = "farm-widget-market-own";
        own.textContent = "Seu anúncio";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "farm-widget-market-secondary";
        cancel.textContent = "Cancelar";
        cancel.addEventListener("click", () => void cancelListing(anuncio._id, cancel));
        item.append(own, cancel);
      } else {
        const controls = document.createElement("div");
        controls.className = "farm-widget-market-buy";
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = "farm-widget-action";
        buy.textContent = "Comprar lote";
        buy.addEventListener("click", () => void buyListing(anuncio, buy));
        controls.append(buy);
        item.appendChild(controls);
      }
      marketListings.appendChild(item);
    }
  }

  function renderSystemSeedOffers(ofertasSementes) {
    systemSeedListings.replaceChildren();
    const ofertasOrdenadas = [...(ofertasSementes || [])].sort((a, b) =>
      a.precoUnitario - b.precoUnitario || a.nome.localeCompare(b.nome, "pt-BR")
    );
    for (const oferta of ofertasOrdenadas) {
      const item = document.createElement("li");
      item.className = "farm-widget-market-item farm-widget-market-system";
      const details = document.createElement("div");
      details.className = "farm-widget-market-details";
      const title = document.createElement("strong");
      const cropIcon = createCropIcon(oferta.item, "farm-widget-market-crop-icon");
      if (cropIcon) title.appendChild(cropIcon);
      title.append(`Sementes de ${oferta.nome.toLowerCase()}`);
      const seller = document.createElement("small");
      seller.textContent = "Loja do sistema · sempre disponível";
      const price = document.createElement("b");
      price.textContent = `${oferta.precoUnitario} Orb por semente`;
      details.append(title, seller, price);
      item.appendChild(details);

      const controls = document.createElement("div");
      controls.className = "farm-widget-market-buy";
      const quantity = document.createElement("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = String(oferta.quantidadeMaximaCompra);
      quantity.value = "1";
      quantity.setAttribute("aria-label", `Quantidade de sementes de ${oferta.nome.toLowerCase()} para comprar`);
      const buy = document.createElement("button");
      buy.type = "button";
      buy.className = "farm-widget-action";
      buy.textContent = "Comprar";
      buy.addEventListener("click", () => void buySystemSeeds(
        oferta.cultura,
        quantity,
        buy,
        oferta.quantidadeMaximaCompra
      ));
      controls.append(quantity, buy);
      item.appendChild(controls);
      systemSeedListings.appendChild(item);
    }
  }

  async function submitMarket(url, data) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "A loja não conseguiu concluir a operação.");
    return result;
  }

  async function cancelListing(anuncioId, button) {
    button.disabled = true;
    shopStatus.textContent = "Cancelando anúncio...";
    try {
      const result = await submitMarket("/api/fazenda/mercado/cancelar", { anuncioId });
      const itemName = itemDisplayName(result.item, result.devolvido);
      shopStatus.textContent = `Anúncio cancelado. ${result.devolvido} ${itemName} voltaram ao inventário.`;
      await Promise.all([loadFarm(), loadMarket()]);
    } catch (error) {
      console.error("Não foi possível cancelar o anúncio.", error);
      shopStatus.textContent = error.message;
      button.disabled = false;
    }
  }

  async function buySystemSeeds(cultura, quantityInput, button, maxQuantity) {
    const quantidade = Number(quantityInput.value);
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > maxQuantity) {
      shopStatus.textContent = `Informe uma quantidade entre 1 e ${maxQuantity} sementes.`;
      return;
    }
    button.disabled = true;
    shopStatus.textContent = "Comprando sementes...";
    try {
      const result = await submitMarket("/api/fazenda/mercado/comprar-sementes", {
        cultura,
        quantidade,
        operationId: crypto.randomUUID()
      });
      shopStatus.textContent = `Compra concluída: ${result.quantidade} ${itemDisplayName(result.item, result.quantidade)} por ${result.orbs} Orbs.`;
      await Promise.all([loadFarm(), loadMarket()]);
    } catch (error) {
      console.error("Não foi possível comprar sementes da loja do sistema.", error);
      shopStatus.textContent = error.message;
      button.disabled = false;
    }
  }

  async function buyListing(anuncio, button) {
    button.disabled = true;
    shopStatus.textContent = "Processando compra...";
    try {
      const result = await submitMarket("/api/fazenda/mercado/comprar", {
        anuncioId: anuncio._id,
        quantidade: anuncio.quantidade,
        operationId: crypto.randomUUID()
      });
      const quantidadeComprada = result.quantidade ?? result.trigo;
      const itemName = itemDisplayName(result.item, quantidadeComprada);
      shopStatus.textContent = `Compra concluída: ${quantidadeComprada} ${itemName} por ${result.orbs} Orbs.`;
      await Promise.all([loadFarm(), loadMarket()]);
    } catch (error) {
      console.error("Não foi possível comprar o anúncio.", error);
      shopStatus.textContent = error.message;
      button.disabled = false;
    }
  }

  sellForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!farm || busy) return;
    const item = sellItem.value;
    const quantidade = Number(sellQuantity.value);
    const precoTotal = Number(sellPrice.value);
    if (!Number.isSafeInteger(quantidade) || quantidade < 1 ||
        quantidade > selectedSellInventory() ||
        !Number.isSafeInteger(precoTotal) || precoTotal < 1 || precoTotal > 1_000_000) {
      shopStatus.textContent = "Confira o produto, a quantidade disponível e o preço total do lote.";
      return;
    }
    busy = true;
    shopStatus.textContent = "Publicando anúncio...";
    sellSubmitButton.disabled = true;
    try {
      await submitMarket("/api/fazenda/mercado/anunciar", { item, quantidade, precoTotal });
      shopStatus.textContent = "Seu produto foi colocado à venda!";
      await Promise.all([loadFarm(), loadMarket()]);
    } catch (error) {
      console.error("Não foi possível anunciar o trigo.", error);
      shopStatus.textContent = error.message;
    } finally {
      busy = false;
      sellSubmitButton.disabled = false;
      render();
    }
  });

  sellItem.addEventListener("change", () => {
    const cultura = cropForItem(sellItem.value);
    if (!cultura) return;
    sellPrice.value = String(sellItem.value === cultura.itemSemente
      ? cultura.precoSementeOrbs
      : cultura.precoColheitaOrbs);
    updateSellQuantity();
  });

  function toggleSellForm(open) {
    sellForm.hidden = !open;
    systemSeedsPanel.hidden = true;
    marketContent.hidden = open;
    systemSeedsToggle.setAttribute("aria-expanded", "false");
    systemSeedsToggle.setAttribute("aria-label", "Comprar sementes do sistema");
    systemSeedsToggle.title = "Comprar sementes do sistema";
    sellToggle.setAttribute("aria-expanded", String(open));
    sellToggle.setAttribute("aria-label", open ? "Fechar formulário de venda" : "Anunciar produto");
    sellToggle.title = open ? "Fechar formulário de venda" : "Anunciar produto";
    if (open) sellItem.focus();
  }

  sellToggle.addEventListener("click", () => toggleSellForm(sellForm.hidden));

  function toggleShop(open) {
    setFarmPanel(open ? "shop" : "farm");
    if (open) void loadMarket();
  }

  shopToggle.addEventListener("click", () => toggleShop(activePanel !== "shop"));
  shopClose.addEventListener("click", () => toggleShop(false));
  marketRefresh.addEventListener("click", () => void loadMarket());

  async function deliverOrder(pedidoId) {
    if (!farm || busy) return;
    busy = true;
    taskStatusOverride = "Processando entrega...";
    lastTaskViewKey = "";
    renderTaskList();
    try {
      const result = await requestFarm("/api/fazenda/pedido/entregar", "POST", { pedidoId });
      farm = result.fazenda;
      taskStatusOverride = `Pedido entregue! Você recebeu ${result.entrega.orbs} Orbs.`;
      setTaskFilter("closed");
      window.setTimeout(() => {
        taskStatusOverride = "";
        render();
      }, 3000);
    } catch (error) {
      console.error("Não foi possível concluir o pedido de entrega.", error);
      taskStatusOverride = error.message;
    } finally {
      busy = false;
      render();
    }
  }

  function clampSize(width, height) {
    const availableWidth = Math.max(1, Math.min(
      workspace.clientWidth - widget.offsetLeft - 8,
      window.innerWidth - 24
    ));
    const availableHeight = Math.max(1, window.innerHeight - 32);
    const minWidth = Math.min(minimumWidth, availableWidth);
    const minHeight = Math.min(minimumHeight, availableHeight);
    return {
      width: Math.round(Math.max(minWidth, Math.min(maximumWidth, availableWidth, width))),
      height: Math.round(Math.max(minHeight, Math.min(maximumHeight, availableHeight, height)))
    };
  }

  function setSize(width, height) {
    const size = clampSize(width, height);
    card.style.width = `${size.width}px`;
    card.style.height = `${size.height}px`;
    return size;
  }

  function announceResize() {
    const bounds = card.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent("farm-widget-resized", {
      detail: { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    }));
  }

  function finishResize(event) {
    if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
    resizePointer = null;
    announceResize();
    if (resizeButton.hasPointerCapture(event.pointerId)) resizeButton.releasePointerCapture(event.pointerId);
  }

  resizeButton.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    resizePointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: card.getBoundingClientRect().width,
      startHeight: card.getBoundingClientRect().height
    };
    resizeButton.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  resizeButton.addEventListener("pointermove", event => {
    if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
    setSize(
      resizePointer.startWidth + event.clientX - resizePointer.startX,
      resizePointer.startHeight + event.clientY - resizePointer.startY
    );
    event.preventDefault();
  });

  resizeButton.addEventListener("pointerup", finishResize);
  resizeButton.addEventListener("pointercancel", finishResize);
  resizeButton.addEventListener("keydown", event => {
    const horizontalSteps = { ArrowLeft: -24, ArrowRight: 24 };
    const verticalSteps = { ArrowDown: 24, ArrowUp: -24 };
    if (!(event.key in horizontalSteps) && !(event.key in verticalSteps)) return;
    event.preventDefault();
    const bounds = card.getBoundingClientRect();
    setSize(
      bounds.width + (horizontalSteps[event.key] || 0),
      bounds.height + (verticalSteps[event.key] || 0)
    );
    announceResize();
  });

  window.addEventListener("resize", () => {
    const bounds = card.getBoundingClientRect();
    const size = clampSize(bounds.width, bounds.height);
    card.style.width = `${size.width}px`;
    if (card.style.height) card.style.height = `${size.height}px`;
  });
  window.setInterval(() => {
    if (!farm) return;
    render();
    const agora = Date.now();
    const partesData = new Intl.DateTimeFormat("en", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(agora));
    const valoresData = Object.fromEntries(partesData.map(parte => [parte.type, parte.value]));
    const dataHoje = `${valoresData.year}-${valoresData.month}-${valoresData.day}`;
    if (farm.dataPedidos !== dataHoje && !orderRefreshPending && agora >= nextDailyOrderRefreshAt) {
      orderRefreshPending = true;
      nextDailyOrderRefreshAt = agora + 30_000;
      void loadFarm().finally(() => {
        orderRefreshPending = false;
      });
    }
  }, 500);
  void loadFarm();
}

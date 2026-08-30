(function(){
  "use strict";

  var STORAGE_KEY = "kanban.board.v1";

  var DEFAULT_STATE = {
    columns: [
      { id: uid(), title: "A FAZER", cards: [] },
      { id: uid(), title: "EM ANDAMENTO", cards: [] },
      { id: uid(), title: "AGUARDANDO CLIENTE", cards: [] },
      { id: uid(), title: "CONCLUÍDO", cards: [] }
    ]
  };

  function uid(){
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return clone(DEFAULT_STATE);
      var parsed = JSON.parse(raw);
      if(!parsed || !Array.isArray(parsed.columns)) return clone(DEFAULT_STATE);
      return parsed;
    }catch(e){
      console.error("Falha ao carregar dados salvos", e);
      return clone(DEFAULT_STATE);
    }
  }

  function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

  function saveState(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  var state = loadState();
  var editingCardId = null; // null = novo cartão
  var pendingDelete = null; // { type: 'column', id } callback info

  // ---------- DOM refs ----------
  var boardEl = document.getElementById("board");
  var searchInput = document.getElementById("search-input");

  var cardModalOverlay = document.getElementById("card-modal-overlay");
  var cardModalTitle = document.getElementById("card-modal-title");
  var cardForm = document.getElementById("card-form");
  var fieldTitle = document.getElementById("field-title");
  var fieldDesc = document.getElementById("field-desc");
  var fieldClient = document.getElementById("field-client");
  var fieldValue = document.getElementById("field-value");
  var fieldDate = document.getElementById("field-date");
  var fieldPriority = document.getElementById("field-priority");
  var fieldColumn = document.getElementById("field-column");
  var cardDeleteBtn = document.getElementById("card-delete-btn");

  var confirmOverlay = document.getElementById("confirm-modal-overlay");
  var confirmText = document.getElementById("confirm-text");
  var confirmOkBtn = document.getElementById("confirm-ok-btn");

  // ---------- Rendering ----------
  function render(){
    var query = (searchInput.value || "").trim().toLowerCase();
    boardEl.innerHTML = "";

    state.columns.forEach(function(col){
      boardEl.appendChild(renderColumn(col, query));
    });

    var addColCard = document.createElement("div");
    addColCard.className = "add-column-card";
    addColCard.textContent = "+ Nova coluna";
    addColCard.addEventListener("click", addColumn);
    boardEl.appendChild(addColCard);

    populateColumnSelect();
  }

  function renderColumn(col, query){
    var visibleCards = col.cards.filter(function(c){
      if(!query) return true;
      var hay = (c.title + " " + (c.desc||"") + " " + (c.client||"")).toLowerCase();
      return hay.indexOf(query) !== -1;
    });

    var colEl = document.createElement("div");
    colEl.className = "column";
    colEl.dataset.columnId = col.id;

    // Head
    var head = document.createElement("div");
    head.className = "column-head";

    var titleWrap = document.createElement("div");
    titleWrap.className = "column-title-wrap";

    var titleInput = document.createElement("input");
    titleInput.className = "column-title";
    titleInput.value = col.title;
    titleInput.addEventListener("change", function(){
      col.title = titleInput.value.trim().toUpperCase() || "SEM NOME";
      titleInput.value = col.title;
      saveState();
      populateColumnSelect();
    });
    titleInput.addEventListener("keydown", function(e){
      if(e.key === "Enter"){ titleInput.blur(); }
    });

    var countBadge = document.createElement("span");
    countBadge.className = "column-count";
    countBadge.textContent = col.cards.length;

    titleWrap.appendChild(titleInput);
    titleWrap.appendChild(countBadge);

    var menuBtn = document.createElement("button");
    menuBtn.className = "column-menu-btn";
    menuBtn.title = "Excluir coluna";
    menuBtn.textContent = "✕";
    menuBtn.addEventListener("click", function(){
      askDeleteColumn(col.id);
    });

    head.appendChild(titleWrap);
    head.appendChild(menuBtn);
    colEl.appendChild(head);

    // Body
    var body = document.createElement("div");
    body.className = "column-body";
    body.dataset.columnId = col.id;

    if(visibleCards.length === 0){
      var hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = query ? "Nenhum resultado" : "Sem serviços aqui";
      body.appendChild(hint);
    }else{
      visibleCards.forEach(function(card){
        body.appendChild(renderCard(card, col.id));
      });
    }

    attachDropHandlers(body, col.id);
    colEl.appendChild(body);

    // Add card button
    var addBtn = document.createElement("button");
    addBtn.className = "column-add";
    addBtn.textContent = "+ Adicionar serviço";
    addBtn.addEventListener("click", function(){
      openCardModal(null, col.id);
    });
    colEl.appendChild(addBtn);

    return colEl;
  }

  function renderCard(card, columnId){
    var el = document.createElement("div");
    el.className = "card priority-" + (card.priority || "media");
    el.draggable = true;
    el.dataset.cardId = card.id;
    el.dataset.columnId = columnId;

    var title = document.createElement("p");
    title.className = "card-title";
    title.textContent = card.title;
    el.appendChild(title);

    if(card.desc){
      var desc = document.createElement("p");
      desc.className = "card-desc";
      desc.textContent = card.desc;
      el.appendChild(desc);
    }

    var meta = document.createElement("div");
    meta.className = "card-meta";
    var metaParts = [];
    if(card.client) metaParts.push({ label: "Cliente", value: card.client });
    if(card.value) metaParts.push({ label: "R$", value: card.value });
    if(card.date) metaParts.push({ label: "Prazo", value: formatDate(card.date) });
    metaParts.forEach(function(p){
      var span = document.createElement("span");
      span.innerHTML = "";
      var vEl = document.createElement("span");
      vEl.className = "meta-value";
      vEl.textContent = p.label === "R$" ? ("R$ " + p.value) : p.value;
      if(p.label !== "R$"){
        span.appendChild(document.createTextNode(p.label + ": "));
      }
      span.appendChild(vEl);
      meta.appendChild(span);
    });
    if(metaParts.length){ el.appendChild(meta); }

    var tag = document.createElement("span");
    tag.className = "card-tag priority-" + (card.priority || "media");
    tag.textContent = priorityLabel(card.priority);
    el.appendChild(tag);

    el.addEventListener("click", function(){
      openCardModal(card.id, columnId);
    });

    el.addEventListener("dragstart", function(e){
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.id);
    });
    el.addEventListener("dragend", function(){
      el.classList.remove("dragging");
    });

    return el;
  }

  function priorityLabel(p){
    if(p === "alta") return "Prioridade alta";
    if(p === "baixa") return "Prioridade baixa";
    return "Prioridade média";
  }

  function formatDate(iso){
    if(!iso) return "";
    var parts = iso.split("-");
    if(parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  // ---------- Drag & drop ----------
  function attachDropHandlers(body, columnId){
    body.addEventListener("dragover", function(e){
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      body.classList.add("drag-over-slot");

      var dragging = document.querySelector(".card.dragging");
      if(!dragging) return;
      var afterEl = getDragAfterElement(body, e.clientY);
      if(afterEl == null){
        body.appendChild(dragging);
      }else{
        body.insertBefore(dragging, afterEl);
      }
    });

    body.addEventListener("dragleave", function(e){
      if(e.target === body) body.classList.remove("drag-over-slot");
    });

    body.addEventListener("drop", function(e){
      e.preventDefault();
      body.classList.remove("drag-over-slot");
      var cardId = e.dataTransfer.getData("text/plain");
      if(!cardId) return;
      commitCardOrder(body, columnId);
    });
  }

  function getDragAfterElement(container, y){
    var elements = Array.prototype.slice.call(container.querySelectorAll(".card:not(.dragging)"));
    return elements.reduce(function(closest, child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if(offset < 0 && offset > closest.offset){
        return { offset: offset, element: child };
      }else{
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function commitCardOrder(body, newColumnId){
    var orderedIds = Array.prototype.slice.call(body.querySelectorAll(".card")).map(function(el){
      return el.dataset.cardId;
    });

    var targetCol = state.columns.find(function(c){ return c.id === newColumnId; });
    if(!targetCol) return;

    // Find the card object across all columns matching each ordered id, remove from old locations
    var cardsById = {};
    state.columns.forEach(function(col){
      col.cards.forEach(function(c){ cardsById[c.id] = c; });
    });

    // Remove all these cards from every column
    state.columns.forEach(function(col){
      col.cards = col.cards.filter(function(c){ return orderedIds.indexOf(c.id) === -1; });
    });

    // Rebuild target column's card list in DOM order
    var newCardList = orderedIds.map(function(id){ return cardsById[id]; }).filter(Boolean);
    targetCol.cards = newCardList.concat(targetCol.cards);

    saveState();
    render();
  }

  // ---------- Columns ----------
  function addColumn(){
    state.columns.push({ id: uid(), title: "NOVA COLUNA", cards: [] });
    saveState();
    render();
  }

  function askDeleteColumn(columnId){
    var col = state.columns.find(function(c){ return c.id === columnId; });
    if(!col) return;
    var count = col.cards.length;
    confirmText.textContent = count > 0
      ? "Excluir a coluna \"" + col.title + "\" também vai excluir " + count + " serviço(s) dentro dela. Essa ação não pode ser desfeita."
      : "Excluir a coluna \"" + col.title + "\"?";
    pendingDelete = { type: "column", id: columnId };
    confirmOverlay.classList.add("open");
  }

  function deleteColumn(columnId){
    state.columns = state.columns.filter(function(c){ return c.id !== columnId; });
    saveState();
    render();
  }

  // ---------- Card modal ----------
  function populateColumnSelect(){
    var current = fieldColumn.value;
    fieldColumn.innerHTML = "";
    state.columns.forEach(function(col){
      var opt = document.createElement("option");
      opt.value = col.id;
      opt.textContent = col.title;
      fieldColumn.appendChild(opt);
    });
    if(current && state.columns.some(function(c){ return c.id === current; })){
      fieldColumn.value = current;
    }
  }

  function openCardModal(cardId, defaultColumnId){
    editingCardId = cardId;
    cardForm.reset();
    populateColumnSelect();

    if(cardId){
      var found = findCard(cardId);
      if(!found) return;
      cardModalTitle.textContent = "EDITAR SERVIÇO";
      fieldTitle.value = found.card.title || "";
      fieldDesc.value = found.card.desc || "";
      fieldClient.value = found.card.client || "";
      fieldValue.value = found.card.value || "";
      fieldDate.value = found.card.date || "";
      fieldPriority.value = found.card.priority || "media";
      fieldColumn.value = found.columnId;
      cardDeleteBtn.style.display = "";
    }else{
      cardModalTitle.textContent = "NOVO SERVIÇO";
      fieldPriority.value = "media";
      if(defaultColumnId){ fieldColumn.value = defaultColumnId; }
      cardDeleteBtn.style.display = "none";
    }

    cardModalOverlay.classList.add("open");
    setTimeout(function(){ fieldTitle.focus(); }, 30);
  }

  function closeCardModal(){
    cardModalOverlay.classList.remove("open");
    editingCardId = null;
  }

  function findCard(cardId){
    for(var i=0;i<state.columns.length;i++){
      var col = state.columns[i];
      for(var j=0;j<col.cards.length;j++){
        if(col.cards[j].id === cardId){
          return { card: col.cards[j], columnId: col.id, columnIndex: i, cardIndex: j };
        }
      }
    }
    return null;
  }

  cardForm.addEventListener("submit", function(e){
    e.preventDefault();
    var title = fieldTitle.value.trim();
    if(!title) return;

    var payload = {
      title: title,
      desc: fieldDesc.value.trim(),
      client: fieldClient.value.trim(),
      value: fieldValue.value.trim(),
      date: fieldDate.value,
      priority: fieldPriority.value
    };
    var destColumnId = fieldColumn.value;

    if(editingCardId){
      var found = findCard(editingCardId);
      if(found){
        Object.assign(found.card, payload);
        if(found.columnId !== destColumnId){
          found.columnIndex >= 0 && state.columns[found.columnIndex].cards.splice(found.cardIndex, 1);
          var destCol = state.columns.find(function(c){ return c.id === destColumnId; });
          if(destCol) destCol.cards.unshift(found.card);
        }
      }
    }else{
      var newCard = Object.assign({ id: uid() }, payload);
      var destCol2 = state.columns.find(function(c){ return c.id === destColumnId; }) || state.columns[0];
      destCol2.cards.unshift(newCard);
    }

    saveState();
    closeCardModal();
    render();
  });

  cardDeleteBtn.addEventListener("click", function(){
    if(!editingCardId) return;
    pendingDelete = { type: "card", id: editingCardId };
    confirmText.textContent = "Excluir este serviço? Essa ação não pode ser desfeita.";
    confirmOverlay.classList.add("open");
  });

  function deleteCard(cardId){
    var found = findCard(cardId);
    if(!found) return;
    state.columns[found.columnIndex].cards.splice(found.cardIndex, 1);
    saveState();
    closeCardModal();
    render();
  }

  document.getElementById("card-modal-close").addEventListener("click", closeCardModal);
  document.getElementById("card-cancel-btn").addEventListener("click", closeCardModal);
  cardModalOverlay.addEventListener("click", function(e){
    if(e.target === cardModalOverlay) closeCardModal();
  });

  // ---------- Confirm modal ----------
  function closeConfirmModal(){
    confirmOverlay.classList.remove("open");
    pendingDelete = null;
  }
  document.getElementById("confirm-modal-close").addEventListener("click", closeConfirmModal);
  document.getElementById("confirm-cancel-btn").addEventListener("click", closeConfirmModal);
  confirmOverlay.addEventListener("click", function(e){
    if(e.target === confirmOverlay) closeConfirmModal();
  });
  confirmOkBtn.addEventListener("click", function(){
    if(!pendingDelete) return closeConfirmModal();
    if(pendingDelete.type === "column"){
      deleteColumn(pendingDelete.id);
      closeConfirmModal();
    }else if(pendingDelete.type === "card"){
      var id = pendingDelete.id;
      closeConfirmModal();
      deleteCard(id);
    }
  });

  // ---------- Toolbar ----------
  document.getElementById("add-card-btn").addEventListener("click", function(){
    openCardModal(null, state.columns[0] ? state.columns[0].id : null);
  });
  document.getElementById("add-column-btn").addEventListener("click", addColumn);
  searchInput.addEventListener("input", render);

  document.getElementById("export-btn").addEventListener("click", function(){
    var dataStr = JSON.stringify(state, null, 2);
    var blob = new Blob([dataStr], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var date = new Date().toISOString().slice(0,10);
    a.href = url;
    a.download = "backup-kanban-" + date + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  var importInput = document.getElementById("import-file");
  document.getElementById("import-btn").addEventListener("click", function(){
    importInput.value = "";
    importInput.click();
  });
  importInput.addEventListener("change", function(){
    var file = importInput.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        if(!parsed || !Array.isArray(parsed.columns)) throw new Error("formato inválido");
        state = parsed;
        saveState();
        render();
      }catch(err){
        alert("Não foi possível importar este arquivo. Verifique se é um backup válido exportado por este painel.");
      }
    };
    reader.readAsText(file);
  });

  // ---------- Keyboard ----------
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){
      if(confirmOverlay.classList.contains("open")) closeConfirmModal();
      else if(cardModalOverlay.classList.contains("open")) closeCardModal();
    }
  });

  // ---------- Header date ----------
  (function setTodayLabel(){
    var el = document.getElementById("today-label");
    var d = new Date();
    var months = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
    el.textContent = "— " + d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  })();

  render();
})();

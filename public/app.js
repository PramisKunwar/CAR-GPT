const API_URL = "/api/chat";

const CarGPTClient = {
  async reply(history) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: history.map(({ role, content }) => ({ role, content }))
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    if (typeof data.reply !== "string") throw new Error("bad_response");
    return data.reply;
  }
};

const STORE_KEY = "cargpt.v1";
const state = { chats: [], activeId: null };

const uid = () => Math.random().toString(36).slice(2, 10);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && Array.isArray(raw.chats)) {
      state.chats = raw.chats.map(c => ({
        id: c.id,
        title: c.title || "",
        messages: Array.isArray(c.messages) ? c.messages : [],
        pending: false
      }));
      state.activeId = raw.activeId;
    }
  } catch (_) {}
  if (!state.chats.some(c => c.id === state.activeId)) state.activeId = null;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      chats: state.chats.map(c => ({ id: c.id, title: c.title, messages: c.messages })),
      activeId: state.activeId
    }));
  } catch (_) {}
}

const activeChat = () => state.chats.find(c => c.id === state.activeId) || null;
const isEmptyChat = c => !c.messages.length;

const $ = id => document.getElementById(id);

const els = {
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  menuBtn: $("menuBtn"),
  history: $("history"),
  newChat: $("newChat"),
  topTitle: $("topTitle"),
  scroll: $("scroll"),
  stage: $("stage"),
  form: $("form"),
  input: $("input"),
  send: $("send")
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  });
  children.forEach(c => node.append(c));
  return node;
}

function inline(text, parent) {
  text.split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      parent.append(el("strong", { text: part.slice(2, -2) }));
    } else {
      parent.append(document.createTextNode(part));
    }
  });
  return parent;
}

function renderRich(text) {
  const frag = document.createDocumentFragment();
  text.trim().split(/\n{2,}/).forEach(block => {
    const lines = block.split("\n");

    if (lines.length && lines.every(l => l.startsWith("- "))) {
      const ul = el("ul");
      lines.forEach(l => ul.append(inline(l.slice(2), el("li"))));
      frag.append(ul);
      return;
    }

    if (lines.length && lines.every(l => l.startsWith("> "))) {
      frag.append(inline(lines.map(l => l.slice(2)).join(" "), el("p", { class: "note" })));
      return;
    }

    const split = lines.findIndex(l => l.startsWith("- "));
    if (split > 0) {
      frag.append(inline(lines.slice(0, split).join(" "), el("p")));
      const ul = el("ul");
      lines.slice(split).forEach(l => ul.append(inline(l.replace(/^- /, ""), el("li"))));
      frag.append(ul);
      return;
    }

    frag.append(inline(lines.join(" "), el("p")));
  });
  return frag;
}

const PROMPTS = [
  ["What does a flashing check engine light mean?", "Warning lights and urgency"],
  ["How often should I service my car?", "Oil, filters, fluids and plugs"],
  ["How do I look after an EV battery?", "Charging habits and winter range"],
  ["What should I check on a used car?", "Inspection checklist before buying"]
];

function renderHero() {
  const hero = el("section", { class: "hero" }, [
    el("p", { class: "eyebrow", text: "CARGPT / AUTOMOTIVE ASSISTANT" }),
    el("h1", { text: "Ask anything about your car." }),
    el("p", { text: "Diagnostics, maintenance, tyres, brakes, EVs and buying advice. Clear answers, no guesswork." })
  ]);

  const grid = el("div", { class: "prompts" });

  PROMPTS.forEach(([title, sub], i) => {
    const b = el("button", { class: "prompt", type: "button" }, [
      el("span", { class: "prompt-num", text: String(i + 1).padStart(2, "0") }),
      el("span", {}, [
        el("span", { class: "prompt-title", text: title }),
        el("span", { class: "prompt-sub", text: sub })
      ])
    ]);
    b.addEventListener("click", () => submit(title));
    grid.append(b);
  });

  hero.append(grid);
  return hero;
}

function messageNode(m) {
  const body = el("div", { class: "msg-body" });
  if (m.role === "user") body.textContent = m.content;
  else body.append(renderRich(m.content));

  return el("article", { class: "msg " + m.role }, [
    el("div", { class: "msg-role", text: m.role === "user" ? "You" : "CarGPT" }),
    body
  ]);
}

function typingNode() {
  const dots = el("div", {
    class: "typing",
    role: "status",
    "aria-label": "CarGPT is typing"
  }, [el("span"), el("span"), el("span")]);

  return el("article", { class: "msg assistant" }, [
    el("div", { class: "msg-role", text: "CarGPT" }),
    el("div", { class: "msg-body" }, [dots])
  ]);
}

function renderStage() {
  const chat = activeChat();
  els.stage.replaceChildren();

  if (!chat || (isEmptyChat(chat) && !chat.pending)) {
    els.stage.append(renderHero());
  } else {
    const thread = el("div", { class: "thread", "aria-live": "polite" });
    chat.messages.forEach(m => thread.append(messageNode(m)));
    if (chat.pending) thread.append(typingNode());
    els.stage.append(thread);
  }

  els.topTitle.textContent = chat && chat.title ? chat.title : "New conversation";
  els.scroll.scrollTop = els.scroll.scrollHeight;
}

function renderHistory() {
  els.history.replaceChildren();

  const chats = state.chats.filter(c => !isEmptyChat(c));

  if (!chats.length) {
    els.history.append(el("li", { class: "history-empty", text: "No conversations yet." }));
    return;
  }

  [...chats].reverse().forEach(c => {
    const open = el("button", { class: "history-item", type: "button", text: c.title });
    if (c.id === state.activeId) open.setAttribute("aria-current", "true");
    open.addEventListener("click", () => {
      state.activeId = c.id;
      save();
      render();
      closeMenu();
    });

    const del = el("button", {
      class: "history-delete",
      type: "button",
      "aria-label": "Delete conversation",
      text: "×"
    });
    del.addEventListener("click", () => removeChat(c.id));

    els.history.append(el("li", {}, [open, del]));
  });
}

function render() {
  renderHistory();
  renderStage();
}

function findOrCreateEmptyChat() {
  let chat = state.chats.find(isEmptyChat);
  if (!chat) {
    chat = { id: uid(), title: "", messages: [], pending: false };
    state.chats.push(chat);
  }
  return chat;
}

function newChat() {
  const chat = findOrCreateEmptyChat();
  state.activeId = chat.id;
  save();
  render();
  closeMenu();
  els.input.focus();
}

function removeChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.activeId === id) state.activeId = null;
  save();
  render();
  updateSend();
}

async function submit(text) {
  text = text.trim().slice(0, 2000);
  if (!text) return;

  let chat = activeChat();
  if (!chat) {
    chat = findOrCreateEmptyChat();
    state.activeId = chat.id;
  }
  if (chat.pending) return;

  if (!chat.title) {
    const title = text.replace(/\s+/g, " ").trim();
    chat.title = title.length > 48 ? title.slice(0, 47) + "…" : title;
  }

  chat.messages.push({ role: "user", content: text });
  chat.pending = true;
  save();
  render();
  updateSend();

  let answer;
  try {
    answer = await CarGPTClient.reply(chat.messages);
  } catch (_) {
    answer = "Something went wrong reaching the assistant. Please try again.";
  }

  if (state.chats.some(c => c.id === chat.id)) {
    chat.messages.push({ role: "assistant", content: answer });
    chat.pending = false;
    save();
  }

  render();
  updateSend();
  els.input.focus();
}

function updateSend() {
  const chat = activeChat();
  els.send.disabled = Boolean(chat && chat.pending) || !els.input.value.trim();
}

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 160) + "px";
}

function openMenu() {
  els.sidebar.classList.add("open");
  els.scrim.classList.add("open");
}

function closeMenu() {
  els.sidebar.classList.remove("open");
  els.scrim.classList.remove("open");
}

els.input.addEventListener("input", () => {
  autosize();
  updateSend();
});

els.input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    els.form.requestSubmit();
  }
});

els.form.addEventListener("submit", e => {
  e.preventDefault();
  const v = els.input.value;
  if (!v.trim()) return;
  els.input.value = "";
  autosize();
  updateSend();
  submit(v);
});

els.newChat.addEventListener("click", newChat);

document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    newChat();
    return;
  }
  if (e.key === "Escape") {
    if (els.sidebar.classList.contains("open")) closeMenu();
    else if (document.activeElement === els.input) els.input.blur();
  }
});

els.menuBtn.addEventListener("click", openMenu);
els.scrim.addEventListener("click", closeMenu);

load();
render();
updateSend();
els.input.focus();
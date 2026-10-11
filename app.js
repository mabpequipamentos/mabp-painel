// Painel MABP Posts — aprova, reprova e agenda os posts do Instagram.
// Lê e grava no repositório privado instagram-autopost pela API do GitHub, com o token do dono
// (guardado só neste aparelho). Modo demonstração usa dados locais da pasta demo/.
"use strict";

const ARMAZ = { token: "mabp_token", repo: "mabp_repo", demo: "mabp_demo" };
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOME_STATUS = { rascunho: "Para aprovar", agendado: "Aprovado", publicado: "Publicado", ajuste: "Refazendo",
  descartado: "Descartado", erro: "Erro" };
const NOME_MODELO = { A: "Post com foto", B: "Chamada", C: "Dica", E: "Contato", F: "Frase", R: "Reel" };

const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

const estado = { aba: "inicio", filtro: "aprovar", posts: [], config: null, fotos: null, runs: [], sha: {}, carregando: false };
const midiaCache = new Map();

// ---------- elementos ----------
function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // só para ícones fixos do próprio app
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : String(f));
  return el;
}
const $ = (s) => document.querySelector(s);
const ICONE = {
  ok: '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  desfazer: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
};

function aviso(msg, ms = 3500) {
  const a = $("#aviso");
  a.textContent = msg;
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (a.hidden = true), ms);
}

function fmtQuando(dh) {
  if (!dh) return "Sem horário";
  const [d, hora] = dh.split(" ");
  const [a, m, dia] = d.split("-").map(Number);
  const sem = DIAS[new Date(Date.UTC(a, m - 1, dia)).getUTCDay()];
  return `${sem} ${String(dia).padStart(2, "0")}/${String(m).padStart(2, "0")} · ${hora}`;
}
const fmtData = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}`; };

// ---------- fonte de dados: GitHub ou demonstração ----------
const modoDemo = () => ler(ARMAZ.demo) === "1";

const GitHub = {
  get repo() { return ler(ARMAZ.repo); },
  async api(caminho, opts = {}) {
    const r = await fetch(`https://api.github.com${caminho}`, {
      ...opts,
      headers: { Authorization: `Bearer ${ler(ARMAZ.token)}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
    });
    if (r.status === 401) throw new Error("Token inválido ou vencido. Gere outro em Ajustes.");
    return r;
  },
  async lerJSON(caminho) {
    const r = await this.api(`/repos/${this.repo}/contents/${caminho}`);
    if (r.status === 404) return { dados: null, sha: null };
    if (!r.ok) throw new Error(`Erro ${r.status} ao ler ${caminho}`);
    const j = await r.json();
    const bytes = Uint8Array.from(atob(j.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
    return { dados: JSON.parse(new TextDecoder().decode(bytes)), sha: j.sha };
  },
  async gravarJSON(caminho, alterar, mensagem) {
    // lê, aplica a alteração e grava; se o robô salvou ao mesmo tempo, tenta de novo com a versão nova
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const { dados, sha } = await this.lerJSON(caminho);
      const novo = alterar(dados);
      const texto = JSON.stringify(novo, null, 1);
      const r = await this.api(`/repos/${this.repo}/contents/${caminho}`, {
        method: "PUT",
        body: JSON.stringify({ message: mensagem, content: base64Utf8(texto), sha }),
      });
      if (r.ok) return novo;
      if (r.status !== 409 && r.status !== 422) throw new Error(`Erro ${r.status} ao salvar`);
      await new Promise((ok) => setTimeout(ok, 800 * (tentativa + 1)));
    }
    throw new Error("Não consegui salvar (o robô estava gravando). Tente de novo.");
  },
  async midia(caminho) {
    const r = await this.api(`/repos/${this.repo}/contents/${encodeURI(caminho)}`,
      { headers: { Accept: "application/vnd.github.raw" } });
    if (!r.ok) throw new Error("mídia não encontrada");
    return URL.createObjectURL(await r.blob());
  },
  async disparar(workflow, inputs = {}) {
    const repo = await (await this.api(`/repos/${this.repo}`)).json();
    const r = await this.api(`/repos/${this.repo}/actions/workflows/${workflow}/dispatches`, {
      method: "POST", body: JSON.stringify({ ref: repo.default_branch || "main", inputs }),
    });
    if (!r.ok) throw new Error(`Não consegui acionar o robô (${r.status})`);
  },
  async execucoes() {
    const r = await this.api(`/repos/${this.repo}/actions/runs?per_page=30`);
    if (!r.ok) return [];
    return (await r.json()).workflow_runs || [];
  },
};

function base64Utf8(texto) {
  const bytes = new TextEncoder().encode(texto);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const Demo = {
  dados: null,
  async carregar() {
    if (this.dados) return;
    const [posts, config, fotos] = await Promise.all(["posts.json", "config.json", "fotos.json"]
      .map((f) => fetch(`demo/${f}`).then((r) => r.json())));
    // demonstração: do fim da semana em diante, mostra a semana seguinte (para ter vagas livres)
    const diaSemana = new Date().getDay();
    const seg = diaSemana === 0 || diaSemana >= 5 ? Agenda.somaDias(segundaAtual(), 7) : segundaAtual();
    posts.forEach((p) => { p.semana = seg; p.data_hora = null; p.status = "rascunho"; });
    this.dados = { "fila/posts.json": posts, "config.json": config, "estado/fotos.json": fotos };
  },
  async lerJSON(c) { await this.carregar(); return { dados: structuredClone(this.dados[c]), sha: "demo" }; },
  async gravarJSON(c, alterar) { await this.carregar(); this.dados[c] = alterar(structuredClone(this.dados[c])); return this.dados[c]; },
  async midia(caminho) { return `demo/${caminho.split("/").pop()}`; },
  async disparar(workflow, inputs) {
    if (workflow !== "regerar.yml") return;
    setTimeout(async () => {
      await this.gravarJSON("fila/posts.json", (ps) => ps.map((p) => p.id === inputs.id && p.status === "ajuste"
        ? { ...p, status: "rascunho", versao: (p.versao || 1) + 1, feedback: "",
            historico: [...(p.historico || []), { evento: "demo: na versão real, o Claude reescreve o post conforme o pedido" }] }
        : p));
      if (!modoDemo()) return;
      await carregarTudo(false);
      aviso("Demonstração: o post voltou refeito para aprovação.");
    }, 4000);
  },
  async execucoes() {
    const agora = new Date().toISOString();
    return [{ name: "Gerar posts da semana", conclusion: "success", status: "completed", created_at: agora },
            { name: "Publicar no Instagram", conclusion: "success", status: "completed", created_at: agora }];
  },
};
const fonte = () => (modoDemo() ? Demo : GitHub);

function segundaAtual() {
  const agora = Agenda.agoraBrasilia().slice(0, 10);
  const [a, m, d] = agora.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  return Agenda.somaDias(agora, -((dia + 6) % 7));
}

// ---------- carregar ----------
async function carregarTudo(mostrar = true) {
  if (estado.carregando) return;
  estado.carregando = true;
  $("#btn-atualizar").classList.add("girando");
  try {
    const f = fonte();
    const [posts, config, fotos, runs] = await Promise.all([
      f.lerJSON("fila/posts.json"), f.lerJSON("config.json"), f.lerJSON("estado/fotos.json"), f.execucoes()]);
    estado.posts = posts.dados || [];
    estado.config = config.dados || {};
    estado.fotos = fotos.dados;
    estado.runs = runs;
  } catch (e) {
    aviso(e.message, 6000);
  } finally {
    estado.carregando = false;
    $("#btn-atualizar").classList.remove("girando");
  }
  if (mostrar !== null) desenhar();
}

function semanaAtiva() {
  const semanas = [...new Set(estado.posts.map((p) => p.semana))].sort();
  return semanas[semanas.length - 1] || segundaAtual();
}
const postsDaSemana = () => estado.posts.filter((p) => p.semana === semanaAtiva()).sort((a, b) => a.ordem - b.ordem);

// ---------- ações ----------
function redistribuir(posts) {
  const semana = semanaAtiva();
  const horarios = Agenda.distribuir(posts, semana, estado.config.vagas || {}, Agenda.agoraBrasilia());
  return posts.map((p) => {
    if (p.semana !== semana) return p;
    if (p.status === "agendado") return { ...p, data_hora: horarios[p.id] };
    if (p.status !== "publicado" && p.status !== "erro") return { ...p, data_hora: null };
    return p;
  });
}

async function mudarPost(id, mudanca, mensagem, msgOk) {
  try {
    const novos = await fonte().gravarJSON("fila/posts.json", (posts) =>
      redistribuir(posts.map((p) => (p.id === id ? { ...p, ...mudanca(p) } : p))), mensagem);
    estado.posts = novos;
    desenhar();
    if (msgOk) aviso(typeof msgOk === "function" ? msgOk(novos.find((p) => p.id === id)) : msgOk);
    return true;
  } catch (e) {
    aviso(e.message, 6000);
    return false;
  }
}

const aprovar = (p) => mudarPost(p.id, () => ({ status: "agendado" }), `Aprova ${p.id}`,
  (n) => `Aprovado! Sai ${fmtQuando(n.data_hora)}.`);
const desaprovar = (p) => mudarPost(p.id, () => ({ status: "rascunho" }), `Volta ${p.id} para aprovação`, "Voltou para aprovação.");
const descartar = (p) => mudarPost(p.id, (x) => ({ status: "descartado", historico: [...(x.historico || []), { evento: "descartado pelo dono" }] }),
  `Descarta ${p.id}`, "Post descartado. A semana foi reorganizada com os aprovados.");
const tentarDeNovo = (p) => mudarPost(p.id, () => ({ status: "agendado", erro: "" }), `Tenta de novo ${p.id}`,
  (n) => `Vai tentar de novo ${fmtQuando(n.data_hora)}.`);

async function pedirAjuste(p, texto) {
  const ok = await mudarPost(p.id, () => ({ status: "ajuste", feedback: texto }), `Pede ajuste em ${p.id}`);
  if (!ok) return;
  try {
    await fonte().disparar("regerar.yml", { id: p.id });
    aviso("Pedido enviado. O post volta refeito em alguns minutos.");
    vigiarAjustes();
  } catch (e) {
    aviso(`${e.message}. O ajuste será feito na próxima geração.`, 6000);
  }
}

async function alternarRobo() {
  const novo = !estado.config.ativo;
  try {
    estado.config = await fonte().gravarJSON("config.json", (c) => ({ ...c, ativo: novo }),
      novo ? "Liga o robô" : "Desliga o robô");
    desenhar();
    aviso(novo ? "Robô ligado: gera na segunda e publica os aprovados." : "Robô desligado: nada será gerado nem publicado.");
  } catch (e) { aviso(e.message, 6000); }
}

let vigia = null;
function vigiarAjustes() {
  clearInterval(vigia);
  vigia = setInterval(async () => {
    if (!estado.posts.some((p) => p.status === "ajuste")) return clearInterval(vigia);
    if (document.visibilityState === "visible") await carregarTudo(estado.aba === "semana" ? undefined : null);
  }, modoDemo() ? 5000 : 30000);
}

// ---------- telas ----------
function desenhar() {
  const t = $("#tela");
  t.replaceChildren();
  const logado = modoDemo() || ler(ARMAZ.token);
  $("#abas").hidden = !logado;
  $("#btn-atualizar").hidden = !logado;
  $("#faixa-demo").hidden = !modoDemo();
  if (!logado) return t.append(telaEntrada());
  document.querySelectorAll("#abas button").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === estado.aba));
  const pend = postsDaSemana().filter((p) => p.status === "rascunho").length;
  const c = $("#contador");
  c.hidden = !pend;
  c.textContent = pend;
  t.append({ inicio: telaInicio, semana: telaSemana, fotos: telaFotos, ajustes: telaAjustes }[estado.aba]());
  window.scrollTo(0, 0);
}

function telaEntrada() {
  const repo = h("input", { value: ler(ARMAZ.repo) || "", placeholder: "usuario/instagram-autopost", autocapitalize: "off", autocomplete: "off" });
  const token = h("input", { type: "password", placeholder: "github_pat_...", autocomplete: "off" });
  const entrar = async () => {
    gravar(ARMAZ.repo, repo.value.trim());
    gravar(ARMAZ.token, token.value.trim());
    gravar(ARMAZ.demo, null);
    try {
      const r = await GitHub.api(`/repos/${repo.value.trim()}`);
      if (!r.ok) throw new Error("Não encontrei o repositório com esse token.");
      await carregarTudo();
    } catch (e) {
      gravar(ARMAZ.token, null);
      aviso(e.message, 6000);
    }
  };
  return h("div", { class: "entrada" },
    h("img", { class: "logo", src: "icones/icone-512.png", alt: "MABP Locações" }),
    h("div", { class: "cartao" },
      h("h1", {}, "Entrar"),
      h("p", { class: "sub" }, "Use o repositório e o token criados na configuração. O token fica guardado só neste aparelho."),
      h("label", { class: "campo" }, h("span", {}, "Repositório"), repo),
      h("label", { class: "campo" }, h("span", {}, "Token do GitHub"), token),
      h("button", { class: "btn primario largo", style: "margin-top:18px", onclick: entrar }, "Entrar")),
    h("button", { class: "btn neutro largo", style: "margin-top:12px", onclick: () => { gravar(ARMAZ.demo, "1"); carregarTudo(); } },
      "Ver demonstração"));
}

function telaInicio() {
  const posts = postsDaSemana();
  const n = (s) => posts.filter((p) => p.status === s).length;
  const ligado = !!estado.config.ativo;
  const proximo = posts.filter((p) => p.status === "agendado" && p.data_hora).sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1))[0];
  const ultimo = (nome) => estado.runs.find((r) => r.name === nome);
  const linhaRun = (rotulo, nome) => {
    const r = ultimo(nome);
    let st = h("span", { class: "sub" }, "ainda não rodou");
    if (r) {
      const quando = new Date(r.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      st = r.status !== "completed" ? h("span", { class: "sub" }, `rodando agora…`)
        : h("span", { class: r.conclusion === "success" ? "ok" : "falha" }, `${r.conclusion === "success" ? "OK" : "Falhou"} · ${quando}`);
    }
    return h("div", { class: "linha-status" }, h("span", {}, rotulo), st);
  };

  return h("div", {},
    h("div", { class: `cartao robo ${ligado ? "ligado" : "desligado"}` },
      h("div", { class: "txt" },
        h("div", { class: "sub" }, "Postador automático"),
        h("div", { class: "estado" }, ligado ? "Ligado" : "Desligado"),
        h("div", { class: "sub" }, ligado ? "Gera toda segunda e publica só o que você aprovar." : "Não gera nem publica nada até você ligar.")),
      h("button", { class: "chave", role: "switch", "aria-checked": String(ligado), "aria-label": "Ligar ou desligar o robô", onclick: alternarRobo })),
    h("div", { class: "numeros" },
      h("button", { class: "numero destaque", onclick: () => irPara("semana", "aprovar") }, h("b", {}, n("rascunho")), h("span", {}, "Para aprovar")),
      h("button", { class: "numero", onclick: () => irPara("semana", "agendado") }, h("b", {}, n("agendado")), h("span", {}, "Agendados")),
      h("button", { class: "numero", onclick: () => irPara("semana", "publicado") }, h("b", {}, n("publicado")), h("span", {}, "Publicados"))),
    h("h2", {}, "Próxima publicação"),
    h("div", { class: "cartao" }, proximo
      ? [h("div", { class: "quando" }, fmtQuando(proximo.data_hora)), h("div", { class: "sub" }, `${NOME_MODELO[proximo.modelo]} · ${proximo.tema}`)]
      : h("div", { class: "sub" }, n("rascunho") ? "Nada agendado ainda. Aprove os posts da semana." : "Nada agendado.")),
    h("h2", {}, "Robô"),
    h("div", { class: "cartao" },
      linhaRun("Geração da semana", "Gerar posts da semana"),
      linhaRun("Publicação", "Publicar no Instagram"),
      linhaRun("Ajustes", "Refazer post com ajuste")),
    !posts.length && h("button", { class: "btn primario largo", style: "margin-top:16px", onclick: gerarAgora }, "Gerar posts desta semana agora"));
}

async function gerarAgora() {
  try {
    await fonte().disparar("gerar-semana.yml", {});
    aviso("Gerando os posts. Leva uns 15 minutos; puxe para atualizar depois.", 6000);
  } catch (e) { aviso(e.message, 6000); }
}

function irPara(aba, filtro) {
  estado.aba = aba;
  if (filtro) estado.filtro = filtro;
  desenhar();
}

function telaSemana() {
  const posts = postsDaSemana();
  const filtros = [
    ["aprovar", "Para aprovar", (p) => p.status === "rascunho" || p.status === "ajuste"],
    ["agendado", "Agendados", (p) => p.status === "agendado" || p.status === "erro"],
    ["publicado", "Publicados", (p) => p.status === "publicado"],
    ["descartado", "Descartados", (p) => p.status === "descartado"],
    ["todos", "Todos", () => true],
  ];
  const [, , filtroFn] = filtros.find((f) => f[0] === estado.filtro) || filtros[0];
  const lista = posts.filter(filtroFn);
  if (estado.filtro === "agendado") lista.sort((a, b) => ((a.data_hora || "") < (b.data_hora || "") ? -1 : 1));
  const aprov = posts.filter((p) => p.status === "agendado");
  const resumo = aprov.length
    ? `${aprov.length} aprovado${aprov.length > 1 ? "s" : ""}: ${aprov.slice().sort((a, b) => (a.data_hora < b.data_hora ? -1 : 1)).map((p) => fmtQuando(p.data_hora).split(" · ")[0]).join(", ")}`
    : "Nenhum aprovado ainda. Os horários se ajustam sozinhos conforme você aprova.";
  return h("div", {},
    h("h1", {}, `Semana de ${fmtData(semanaAtiva())}`),
    h("p", { class: "sub" }, resumo),
    h("div", { class: "filtros" }, filtros.map(([id, nome, fn]) =>
      h("button", { class: estado.filtro === id ? "ativo" : "", onclick: () => { estado.filtro = id; desenhar(); } },
        `${nome} (${posts.filter(fn).length})`))),
    lista.length ? lista.map(cartaoPost) : h("div", { class: "vazio" }, posts.length ? "Nada aqui." : "Os posts da semana aparecem aqui na segunda-feira."));
}

function cartaoPost(p) {
  const reel = p.tipo === "reel";
  const caminho = `${p.status === "publicado" ? "publicados" : "fila"}/${p.arquivo}`;
  const midia = h("div", { class: `midia${reel ? " reel" : ""}` }, h("div", { class: "carregando" }, "Carregando…"));
  carregarMidia(midia, caminho, reel ? `${p.status === "publicado" ? "publicados" : "fila"}/${p.capa}` : null, reel);

  const legenda = h("div", { class: "legenda fechada" }, p.legenda);
  const verMais = h("button", { class: "ver-mais", onclick: () => {
    legenda.classList.toggle("fechada");
    verMais.textContent = legenda.classList.contains("fechada") ? "ver legenda completa" : "fechar";
  } }, "ver legenda completa");

  let acoes = null;
  if (p.status === "rascunho") {
    acoes = h("div", { class: "acoes" },
      h("button", { class: "btn reprovar", onclick: () => abrirReprovar(p), html: `${ICONE.x}Reprovar` }),
      h("button", { class: "btn aprovar", onclick: (e) => { e.currentTarget.disabled = true; aprovar(p); }, html: `${ICONE.ok}Aprovar` }));
  } else if (p.status === "agendado") {
    acoes = h("div", { class: "acoes", style: "grid-template-columns:1fr" },
      h("button", { class: "btn neutro", onclick: () => desaprovar(p), html: `${ICONE.desfazer}Desfazer aprovação` }));
  } else if (p.status === "erro") {
    acoes = h("div", { class: "acoes" },
      h("button", { class: "btn neutro", onclick: () => descartar(p) }, "Descartar"),
      h("button", { class: "btn primario", onclick: () => tentarDeNovo(p) }, "Tentar de novo"));
  } else if (p.status === "publicado" && p.link) {
    acoes = h("div", { class: "acoes", style: "grid-template-columns:1fr" },
      h("a", { class: "btn neutro", href: p.link, target: "_blank", rel: "noopener", html: `${ICONE.link}Ver no Instagram` }));
  }

  const notas = [];
  if (p.status === "ajuste") notas.push(h("div", { class: "nota" }, h("b", {}, "Refazendo com o seu pedido: "), p.feedback, h("br"), h("span", { class: "sub" }, "Volta para aprovação em alguns minutos.")));
  if (p.status === "erro") notas.push(h("div", { class: "nota" }, h("b", {}, "Não publicou: "), p.erro || "erro desconhecido"));
  else if (p.status === "rascunho" && p.erro) notas.push(h("div", { class: "nota" }, h("b", {}, "Ajuste não feito: "), p.erro));
  if ((p.midias || []).some((m) => ["pexels", "pixabay"].includes(m.origem) || m.ilustrativa)) notas.push(h("div", { class: "nota sub" }, "Imagem ilustrativa (banco de imagens livre), não é foto da frota."));

  return h("article", { class: "cartao post" }, midia,
    h("div", { class: "corpo" },
      h("div", { class: "meta" },
        h("span", { class: `selo s-${p.status}` }, NOME_STATUS[p.status] || p.status),
        h("span", { class: "quando" }, p.status === "publicado" ? `Publicado ${fmtQuando(p.publicado_em || p.data_hora)}` : fmtQuando(p.data_hora)),
        h("span", {}, `${NOME_MODELO[p.modelo] || ""} · ${p.tema}`),
        p.versao > 1 && h("span", {}, `versão ${p.versao}`)),
      legenda, verMais, notas, acoes));
}

async function carregarMidia(caixa, caminho, capa, reel) {
  const chave = caminho;
  try {
    if (!midiaCache.has(chave)) midiaCache.set(chave, fonte().midia(caminho));
    const url = await midiaCache.get(chave);
    let el;
    if (reel) {
      el = h("video", { src: url, controls: true, playsinline: true, loop: true, preload: "metadata" });
      if (capa) fonte().midia(capa).then((u) => (el.poster = u)).catch(() => {});
    } else {
      el = h("img", { src: url, alt: "Arte do post", loading: "lazy" });
    }
    caixa.replaceChildren(el);
  } catch {
    midiaCache.delete(chave);
    caixa.replaceChildren(h("div", { class: "carregando" }, "Imagem indisponível"));
  }
}

function abrirReprovar(p) {
  const folha = $("#folha");
  const texto = h("textarea", { placeholder: "Ex.: troque o título, use outra foto, fale mais do leva e busca…" });
  const fechar = () => { folha.hidden = true; folha.replaceChildren(); };
  const sugestoes = ["Trocar a foto", "Título mais direto", "Legenda mais curta", "Falar de com ou sem operador", "Falar do leva e busca"];
  folha.replaceChildren(h("div", { class: "painel", onclick: (e) => e.stopPropagation() },
    h("h1", {}, "Reprovar post"),
    h("p", { class: "sub" }, "Peça um ajuste e o post volta refeito para você aprovar. Ou descarte: a semana se reorganiza só com os aprovados."),
    texto,
    h("div", { class: "sugestoes" }, sugestoes.map((s) => h("button", { onclick: () => { texto.value = texto.value ? `${texto.value}. ${s}` : s; texto.focus(); } }, s))),
    h("button", { class: "btn primario largo", style: "margin-top:14px", onclick: () => {
      const v = texto.value.trim();
      if (!v) { texto.focus(); return aviso("Escreva o que quer mudar."); }
      fechar();
      pedirAjuste(p, v);
    } }, "Pedir ajuste"),
    h("div", { class: "ou" }, "ou"),
    h("button", { class: "btn reprovar largo", onclick: () => { fechar(); descartar(p); } }, "Descartar de vez"),
    h("button", { class: "btn neutro largo", style: "margin-top:10px", onclick: fechar }, "Cancelar")));
  folha.onclick = fechar;
  folha.hidden = false;
}

function telaFotos() {
  const f = estado.fotos;
  const url = estado.config.drive_pasta_url;
  const cats = f ? Object.entries(f.categorias || {}) : [];
  return h("div", {},
    h("h1", {}, "Fotos e vídeos"),
    h("p", { class: "sub" }, "Metade dos posts da semana usa foto. O robô prefere as suas fotos e espaça o uso de cada uma; quando acabam as novas, usa imagens ilustrativas de banco livre."),
    url ? h("a", { class: "btn primario largo", style: "margin-top:16px", href: url, target: "_blank", rel: "noopener" }, "Abrir pasta no Google Drive")
        : h("div", { class: "nota" }, "A pasta do Drive ainda não foi ligada (config.json → drive_pasta_url)."),
    h("h2", {}, "Fotos novas disponíveis"),
    h("div", { class: "cartao" }, cats.length ? cats.map(([nome, c]) =>
      h("div", { class: "categoria" },
        h("div", { style: "flex:1" }, h("b", {}, nome), h("div", { class: "barra" }, h("div", { style: `width:${c.total ? Math.round((100 * c.disponiveis) / c.total) : 0}%` }))),
        h("div", { style: "text-align:right;min-width:90px" }, h("b", {}, `${c.disponiveis}`), h("span", { class: "sub" }, ` de ${c.total}`))))
      : h("div", { class: "sub" }, "Sem informações ainda. Aparecem depois da primeira geração."),
      f && h("div", { class: "categoria" }, h("b", {}, "Vídeos (para o reel)"), h("span", {}, `${f.videos?.total || 0} na pasta`)),
      f && h("div", { class: "categoria" }, h("b", {}, "Trilhas instrumentais"), h("span", { class: f.trilhas?.total ? "" : "falha" }, f.trilhas?.total ? `${f.trilhas.total} na pasta` : "pasta vazia: reel sai sem som"))),
    h("h2", {}, "Dicas para as fotos"),
    h("div", { class: "cartao" }, h("ul", { class: "passos" },
      h("li", {}, "Coloque cada foto na subpasta do equipamento (ou em \"Obras e serviços\")."),
      h("li", {}, "Pode ter pessoas e a marca do fabricante; evite placas legíveis e nome de outras empresas."),
      h("li", {}, "Máquina inteira ou braço/caçamba em ação, de dia, sem filtro."),
      h("li", {}, "Vídeos curtos (5 a 20 s, celular em pé) vão na pasta \"Vídeos\" e viram reels."),
      h("li", {}, "Músicas instrumentais livres de direitos (Pixabay Music, Biblioteca de Áudio do YouTube) vão na pasta \"Trilhas\": o robô alterna entre elas no fundo do reel."))),
    f && h("p", { class: "sub", style: "margin-top:10px" }, `Atualizado em ${f.atualizado}`));
}

function telaAjustes() {
  return h("div", {},
    h("h1", {}, "Ajustes"),
    h("h2", {}, "Conta"),
    h("div", { class: "cartao" },
      h("div", { class: "linha-status" }, h("span", {}, "Repositório"), h("b", {}, modoDemo() ? "demonstração" : GitHub.repo)),
      h("div", { class: "linha-status" }, h("span", {}, "Horários das vagas"), h("span", { class: "sub" }, "Ter–Sex 10h e 18h · Sáb 10h e 14h")),
      h("button", { class: "btn neutro largo", style: "margin-top:12px", onclick: () => {
        gravar(ARMAZ.token, null); gravar(ARMAZ.demo, null); midiaCache.clear(); estado.aba = "inicio"; desenhar();
      } }, modoDemo() ? "Sair da demonstração" : "Sair deste aparelho")),
    h("h2", {}, "Colocar na tela de início do iPhone"),
    h("div", { class: "cartao" }, h("ol", { class: "passos" },
      h("li", {}, "Abra este endereço no Safari."),
      h("li", {}, "Toque em Compartilhar (quadrado com seta para cima)."),
      h("li", {}, "Escolha \"Adicionar à Tela de Início\" e toque em Adicionar."),
      h("li", {}, "Abra pelo ícone MABP Posts e entre com o token uma vez."))),
    h("h2", {}, "Como funciona"),
    h("div", { class: "cartao" }, h("ol", { class: "passos" },
      h("li", {}, "Segunda de manhã o robô cria 10 itens: 9 posts (metade com foto) e 1 reel."),
      h("li", {}, "Você aprova ou reprova. Reprovado pode ser refeito com o seu pedido ou descartado."),
      h("li", {}, "Os aprovados se espalham pela semana, um por dia antes de dobrar."),
      h("li", {}, "No horário marcado, o robô publica sozinho no Instagram."))));
}

// ---------- início ----------
document.querySelectorAll("#abas button").forEach((b) => b.addEventListener("click", () => irPara(b.dataset.aba)));
$("#btn-atualizar").addEventListener("click", () => { midiaCache.clear(); carregarTudo(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (modoDemo() || ler(ARMAZ.token))) carregarTudo();
});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

if (modoDemo() || ler(ARMAZ.token)) carregarTudo().then(() => { if (estado.posts.some((p) => p.status === "ajuste")) vigiarAjustes(); });
else desenhar();

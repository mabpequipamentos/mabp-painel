// Distribuição dos posts aprovados nas vagas da semana.
// Espelho exato de instagram-autopost/gerador/agenda.py — mudou aqui, mude lá
// (testes/casos_agenda.json garante que os dois dão o mesmo resultado).
// Datas são texto no horário de Brasília "AAAA-MM-DD HH:MM"; comparar texto = comparar datas.
(function (raiz) {
  const DIAS = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];

  function somaDias(iso, n) {
    const [a, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  }

  function vagasDaSemana(semana, vagasCfg) {
    const dias = [];
    DIAS.forEach((nome, i) => {
      const horas = (vagasCfg[nome] || []).slice().sort();
      if (horas.length) {
        const d = somaDias(semana, i);
        dias.push([d, horas.map((h) => `${d} ${h}`)]);
      }
    });
    return dias;
  }

  function espalhar(n, k) {
    if (k <= 0) return [];
    if (k >= n) return [...Array(n).keys()];
    if (k === 1) return [0];
    return [...Array(k).keys()].map((i) => Math.floor((i * (n - 1)) / (k - 1) + 0.5));
  }

  function extras(semana, quantidade) {
    const seg = somaDias(semana, 7);
    const out = [];
    for (const h of ["10:00", "18:00"]) for (let d = 0; d < 7; d++) out.push(`${somaDias(seg, d)} ${h}`);
    return out.slice(0, quantidade).sort();
  }

  function distribuir(posts, semana, vagasCfg, agora) {
    const daSemana = posts.filter((p) => p.semana === semana);
    const ocupadas = new Set(daSemana.filter((p) => p.status === "publicado").map((p) => p.data_hora));
    const aprovados = daSemana
      .filter((p) => p.status === "agendado")
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const k = aprovados.length;
    if (!k) return {};

    const primarias = [], secundarias = [];
    for (const [, slots] of vagasDaSemana(semana, vagasCfg)) {
      const livres = slots.filter((s) => s > agora && !ocupadas.has(s));
      if (livres.length) {
        primarias.push(livres[0]);
        secundarias.push(...livres.slice(1));
      }
    }
    let escolhidas = espalhar(primarias.length, k).map((i) => primarias[i]);
    let falta = k - escolhidas.length;
    if (falta > 0) escolhidas = escolhidas.concat(espalhar(secundarias.length, falta).map((i) => secundarias[i]));
    falta = k - escolhidas.length;
    if (falta > 0) escolhidas = escolhidas.concat(extras(semana, falta));
    escolhidas.sort();
    const out = {};
    aprovados.forEach((p, i) => (out[p.id] = escolhidas[i]));
    return out;
  }

  // Agora em Brasília no formato "AAAA-MM-DD HH:MM"
  function agoraBrasilia(d = new Date()) {
    const f = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    return f.format(d).replace("T", " ");
  }

  const api = { distribuir, vagasDaSemana, agoraBrasilia, somaDias };
  if (typeof module !== "undefined") module.exports = api;
  else raiz.Agenda = api;
})(typeof window !== "undefined" ? window : globalThis);

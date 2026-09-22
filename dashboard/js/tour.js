/* Tour guiado pelos pontos críticos da triagem.
 *
 * Não calcula estado nem folga: lê `estado` e `margem_percentual` como vieram
 * em DADOS_TRIAGEM e só escolhe e ordena as paradas. O desenho (câmera,
 * painéis) fica com quem cria o tour, pelos callbacks.
 */

var TOUR = (function () {
  "use strict";

  // Mesma severidade que ordena a tabela; "dentro do limite" não é parada.
  var SEVERIDADE = { acima_do_limite: 0, banda_de_incerteza: 1 };

  var INTERVALO_MS = 5000;

  /* Paradas do tour: acima do limite antes de banda de incerteza e, dentro de
     cada grupo, o maior excesso relativo sobre o limite primeiro — menor
     `margem_percentual`. Empate cai na folga em °C e depois no nome, para a
     ordem não depender da ordem de chegada. */
  function paradas(dados) {
    return (dados && dados.pontos || [])
      .filter(function (p) { return !p.is_monitor_only && SEVERIDADE.hasOwnProperty(p.estado); })
      .slice()
      .sort(function (a, b) {
        return SEVERIDADE[a.estado] - SEVERIDADE[b.estado] ||
          a.margem_percentual - b.margem_percentual ||
          a.margem_c - b.margem_c ||
          (a.TC_Name < b.TC_Name ? -1 : a.TC_Name > b.TC_Name ? 1 : 0);
      });
  }

  /* Controle do tour. `op.aoParar(ponto, i, total)` roda a cada parada,
     `op.aoMudar(estado)` a cada troca de estado e `op.aoEncerrar()` no fim.
     `op.relogio` troca setTimeout/clearTimeout nos testes. */
  function criar(lista, op) {
    op = op || {};
    var relogio = op.relogio || { depois: function (f, ms) { return setTimeout(f, ms); }, cancelar: function (t) { clearTimeout(t); } };
    var intervalo = op.intervalo || INTERVALO_MS;
    var s = { ativo: false, tocando: false, i: -1, total: lista.length, fim: false };
    var timer = null;

    function avisar() { if (op.aoMudar) op.aoMudar(estado()); }
    function estado() { return { ativo: s.ativo, tocando: s.tocando, i: s.i, total: s.total, fim: s.fim, ponto: lista[s.i] || null }; }

    function agendar() {
      relogio.cancelar(timer);
      timer = null;
      if (s.tocando) timer = relogio.depois(function () { ir(s.i + 1); }, intervalo);
    }

    // Na última parada o tour para nela: não dá a volta nem encerra sozinho.
    function ir(i) {
      if (!s.ativo) return;
      s.i = Math.max(0, Math.min(s.total - 1, i));
      s.fim = s.i === s.total - 1;
      if (s.fim) s.tocando = false;
      if (op.aoParar) op.aoParar(lista[s.i], s.i, s.total);
      agendar();
      avisar();
    }

    // Sem parada, não começa: quem chamou mostra a mensagem de vazio.
    function iniciar() {
      if (!s.total) return false;
      s.ativo = true;
      s.tocando = true;
      ir(0);
      return true;
    }

    function pausar() {
      if (!s.ativo || !s.tocando) return;
      s.tocando = false;
      agendar();
      avisar();
    }

    // Retomar na última parada recomeça do início, em vez de não fazer nada.
    function retomar() {
      if (!s.ativo || s.tocando) return;
      s.tocando = true;
      if (s.fim) ir(0);
      else { agendar(); avisar(); }
    }

    function encerrar() {
      if (!s.ativo) return;
      relogio.cancelar(timer);
      timer = null;
      s.ativo = s.tocando = s.fim = false;
      s.i = -1;
      avisar();
      if (op.aoEncerrar) op.aoEncerrar();
    }

    return {
      iniciar: iniciar,
      pausar: pausar,
      retomar: retomar,
      alternar: function () { if (s.tocando) pausar(); else retomar(); },
      // Navegar à mão reinicia a contagem da parada, sem mudar play/pausa.
      proximo: function () { if (s.ativo && s.i < s.total - 1) ir(s.i + 1); },
      anterior: function () { if (s.ativo && s.i > 0) ir(s.i - 1); },
      encerrar: encerrar,
      estado: estado
    };
  }

  return { paradas: paradas, criar: criar, INTERVALO_MS: INTERVALO_MS };
})();

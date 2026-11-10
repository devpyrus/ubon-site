/*
 * Site do Ubon: o ano do rodapé, a compra (planos), a página "obrigado" e a
 * demonstração do card na página inicial.
 *
 * As contas e as cores da demonstração são as mesmas do app (RideOffer e
 * OverlayCard): R$/km = valor ÷ km, R$/hora = valor ÷ (minutos ÷ 60), e a
 * borda pisca na cor da PIOR das duas. Os limites são os de fábrica.
 */
(function () {
  "use strict";

  var anoAgora = String(new Date().getFullYear());
  document.querySelectorAll("[data-ano]").forEach(function (el) {
    el.textContent = anoAgora;
  });

  iniciarCompra();
  iniciarObrigado();
  iniciarDemonstracao();

  // ------------------------------------------------------------ a compra

  /*
   * Rodada 131: a página de planos pede o link de pagamento pro programa do
   * site (/api/comprar), com o código da conta e o plano, e leva a pessoa
   * pro pagamento da InfinitePay. Sem JavaScript, o formulário funciona do
   * mesmo jeito (o programa responde levando direto pro pagamento).
   */
  function iniciarCompra() {
    var form = document.getElementById("comprar");
    if (!form) return;
    var aviso = document.getElementById("aviso-da-compra");
    var campoCodigo = document.getElementById("codigo");
    var campoEmail = document.getElementById("email");
    var botoes = Array.prototype.slice.call(form.querySelectorAll("button[name=plano]"));
    var parametros = new URLSearchParams(window.location.search);
    var ultimoBotao = null;

    var MENSAGENS = {
      codigo: "Esse código não parece certo. No Ubon, vá em Conta → Ubon Pro e toque no botão de copiar ao lado de Código da conta.",
      email: "Confira o e-mail, ou deixe em branco.",
      plano: "Escolha um dos planos.",
      vitalicio: "Essa conta já tem o Ubon Pro sem data pra acabar.",
      pagamento: "Não deu pra abrir o pagamento agora. Tente de novo em alguns minutos ou fale com a gente em suporte.ubon@gmail.com.",
      config: "Não deu pra abrir o pagamento agora. Tente de novo em alguns minutos ou fale com a gente em suporte.ubon@gmail.com."
    };

    // O plano de teste (R$ 1,00) só aparece com ?teste=1 no endereço.
    if (parametros.get("teste") === "1") {
      var teste = form.querySelector(".plano-de-teste");
      if (teste) teste.hidden = false;
    }

    function mostrar(erro) {
      aviso.textContent = MENSAGENS[erro] || MENSAGENS.pagamento;
      aviso.hidden = false;
      if (erro === "codigo") campoCodigo.focus();
      else if (erro === "email") campoEmail.focus();
    }

    function esconderAviso() {
      aviso.hidden = true;
    }

    if (parametros.get("erro")) mostrar(parametros.get("erro"));

    campoCodigo.addEventListener("input", esconderAviso);
    campoEmail.addEventListener("input", esconderAviso);
    botoes.forEach(function (botao) {
      botao.addEventListener("click", function () {
        ultimoBotao = botao;
      });
    });

    form.addEventListener("submit", function (evento) {
      evento.preventDefault();
      var botao = evento.submitter || ultimoBotao;
      if (!botao) return;
      // O código às vezes vem colado com espaço ou quebra de linha.
      var codigo = campoCodigo.value.replace(/\s+/g, "");
      campoCodigo.value = codigo;
      var email = campoEmail.value.trim();
      if (!/^[A-Za-z0-9]{20,40}$/.test(codigo)) return mostrar("codigo");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return mostrar("email");

      var textoOriginal = botao.textContent;
      botoes.forEach(function (b) {
        b.disabled = true;
      });
      botao.textContent = "Abrindo o pagamento…";

      fetch("/api/comprar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: botao.value, codigo: codigo, email: email })
      })
        .then(function (resposta) {
          return resposta.json().then(function (dados) {
            if (resposta.ok && dados.url) {
              window.location.href = dados.url;
              return;
            }
            throw new Error(dados.erro || "pagamento");
          });
        })
        .catch(function (erro) {
          var codigoDoErro = erro && MENSAGENS[erro.message] ? erro.message : "pagamento";
          mostrar(codigoDoErro);
          botoes.forEach(function (b) {
            b.disabled = false;
          });
          botao.textContent = textoOriginal;
        });
    });
  }

  // ------------------------------------------------------------ obrigado

  /*
   * A InfinitePay manda a pessoa pra cá depois do pagamento, com o número do
   * pedido, da transação e da fatura no endereço. A página pergunta ao
   * programa do site se o Pro já foi liberado (ele confere com a InfinitePay
   * e libera, se ainda não tinha liberado).
   */
  function iniciarObrigado() {
    var caixa = document.getElementById("situacao-da-compra");
    if (!caixa) return;
    var p = new URLSearchParams(window.location.search);
    var pedido = p.get("order_nsu");
    var transacao = p.get("transaction_nsu");
    var fatura = p.get("slug");

    // O comprovante só aparece se o link for mesmo da InfinitePay.
    var comprovante = p.get("receipt_url");
    try {
      var enderecoDoComprovante = comprovante ? new URL(comprovante) : null;
      if (
        enderecoDoComprovante &&
        enderecoDoComprovante.protocol === "https:" &&
        /(^|\.)infinitepay\.io$/.test(enderecoDoComprovante.hostname)
      ) {
        caixa.querySelector("[data-campo=comprovante]").href = enderecoDoComprovante.href;
        caixa.querySelector(".comprovante").hidden = false;
      }
    } catch (e) {
      // endereço estranho: só não mostra o comprovante
    }

    function mostrarEstado(nome) {
      caixa.querySelectorAll("[data-estado]").forEach(function (el) {
        el.hidden = el.getAttribute("data-estado") !== nome;
      });
    }

    if (!pedido || !transacao || !fatura) return mostrarEstado("sem-dados");

    var tentativas = 0;
    var MAXIMO = 12;

    function perguntar() {
      tentativas++;
      var endereco =
        "/api/confirmar?order_nsu=" + encodeURIComponent(pedido) +
        "&transaction_nsu=" + encodeURIComponent(transacao) +
        "&slug=" + encodeURIComponent(fatura);
      fetch(endereco, { cache: "no-store" })
        .then(function (resposta) {
          return resposta.json();
        })
        .then(function (dados) {
          if (dados.status === "liberado") {
            var partes = String(dados.ate || "").split("-");
            caixa.querySelector("[data-campo=ate]").textContent =
              partes.length === 3 ? partes[2] + "/" + partes[1] + "/" + partes[0] : "o fim do plano";
            mostrarEstado("liberado");
          } else if (dados.status === "invalido") {
            mostrarEstado("problema");
          } else if (tentativas < MAXIMO) {
            setTimeout(perguntar, 5000);
          } else {
            mostrarEstado("demorando");
          }
        })
        .catch(function () {
          if (tentativas < MAXIMO) setTimeout(perguntar, 5000);
          else mostrarEstado("demorando");
        });
    }

    perguntar();
  }

  // ------------------------------------------------------------ a demonstração

  function iniciarDemonstracao() {
    var card = document.getElementById("card-ubon");
    if (!card) return;

    var LIMITES = {
      km: { ruim: 1.0, bom: 1.5 },
      hora: { ruim: 20, bom: 30 },
      nota: { ruim: 4.7, bom: 4.9 }
    };

    var COR_DA_BORDA = { boa: "#00E676", media: "#FFD54F", ruim: "#FF2827" };

    var EXEMPLOS = [
      { plataforma: "99", valor: 23.4, km: 12.3, min: 21, nota: 4.95, corridas: 381, nome: "Paga bem" },
      { plataforma: "Uber", valor: 14.8, km: 11.2, min: 32, nota: 4.85, corridas: 127, nome: "No limite" },
      { plataforma: "Uber", valor: 12.5, km: 9.4, min: 41, nota: 4.91, corridas: 64, nome: "Abaixo do seu mínimo" }
    ];

    var TEMPO_DE_CADA_EXEMPLO = 3600;

    function classificar(valor, faixa) {
      if (valor <= faixa.ruim) return "ruim";
      if (valor >= faixa.bom) return "boa";
      return "media";
    }

    function pior(a, b) {
      var ordem = ["ruim", "media", "boa"];
      return ordem[Math.min(ordem.indexOf(a), ordem.indexOf(b))];
    }

    // No card os números saem com ponto, igual ao app.
    function doCard(v) {
      return v.toFixed(2);
    }

    // Pro leitor de tela, no jeito brasileiro.
    function emReais(v) {
      return v.toFixed(2).replace(".", ",");
    }

    var demo = document.querySelector(".demo");
    var celular = document.querySelector(".celular");
    var botoes = Array.prototype.slice.call(document.querySelectorAll(".legenda button"));
    var rotas = Array.prototype.slice.call(document.querySelectorAll(".rota"));
    var pontos = Array.prototype.slice.call(document.querySelectorAll(".ponto-da-rota"));

    function campo(nome) {
      return card.querySelector('[data-campo="' + nome + '"]');
    }

    function pintar(el, classe) {
      el.classList.remove("boa", "media", "ruim");
      el.classList.add(classe);
    }

    function desenharRota(i) {
      rotas.forEach(function (rota, n) {
        rota.classList.remove("ativa");
        if (n !== i) return;
        var comprimento = rota.getTotalLength();
        rota.style.strokeDasharray = comprimento;
        rota.style.setProperty("--comprimento", comprimento);
        void rota.getBoundingClientRect(); // recomeça a animação
        rota.classList.add("ativa");
      });
      pontos.forEach(function (ponto) {
        ponto.classList.toggle("ativo", Number(ponto.getAttribute("data-exemplo")) === i);
      });
    }

    function preencher(i) {
      var ex = EXEMPLOS[i];
      var porKm = ex.valor / ex.km;
      var porHora = ex.valor / (ex.min / 60);
      var corKm = classificar(porKm, LIMITES.km);
      var corHora = classificar(porHora, LIMITES.hora);
      var corNota = classificar(ex.nota, LIMITES.nota);
      var corDaBorda = pior(corKm, corHora);

      var selo = campo("selo");
      selo.textContent = ex.plataforma.toUpperCase();
      selo.classList.toggle("da-99", ex.plataforma === "99");

      campo("valor").textContent = "R$ " + doCard(ex.valor);
      campo("km").textContent = doCard(ex.km) + " km";
      campo("min").textContent = ex.min + " min";
      campo("porKm").textContent = doCard(porKm);
      campo("porHora").textContent = doCard(porHora);
      campo("nota").textContent = doCard(ex.nota);
      campo("corridas").textContent = "(" + ex.corridas + ")";
      pintar(campo("porKm").parentNode, corKm);
      pintar(campo("porHora").parentNode, corHora);
      pintar(campo("nota").parentNode, corNota);

      card.style.setProperty("--cor", COR_DA_BORDA[corDaBorda]);

      celular.setAttribute(
        "aria-label",
        "Exemplo: oferta da " + ex.plataforma + " de R$ " + emReais(ex.valor) + ", " +
          String(ex.km).replace(".", ",") + " km e " + ex.min + " minutos. O card mostra R$ " +
          emReais(porKm) + " por km e R$ " + emReais(porHora) + " por hora, com a borda " +
          { boa: "verde", media: "amarela", ruim: "vermelha" }[corDaBorda] + ": " + ex.nome.toLowerCase() + "."
      );

      botoes.forEach(function (botao, n) {
        botao.setAttribute("aria-pressed", n === i ? "true" : "false");
      });
    }

    var atual = 0;
    var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var troca = null;

    function mostrar(i) {
      atual = i;
      clearTimeout(troca);
      if (reduzir) {
        preencher(i);
        desenharRota(i);
        return;
      }
      card.classList.add("trocando");
      desenharRota(i);
      troca = setTimeout(function () {
        preencher(i);
        card.classList.remove("trocando");
      }, 250);
    }

    // Passa os exemplos sozinho, menos quando: a pessoa prefere menos
    // movimento, tocou num exemplo, trocou de aba ou rolou a página pra longe.
    var relogio = null;
    var parouPelaPessoa = false;
    var naTela = true;

    function agendar() {
      clearTimeout(relogio);
      if (reduzir || parouPelaPessoa || document.hidden || !naTela) return;
      relogio = setTimeout(function () {
        mostrar((atual + 1) % EXEMPLOS.length);
        agendar();
      }, TEMPO_DE_CADA_EXEMPLO);
    }

    botoes.forEach(function (botao, n) {
      botao.addEventListener("click", function () {
        parouPelaPessoa = true;
        clearTimeout(relogio);
        if (n !== atual) mostrar(n);
      });
    });

    document.addEventListener("visibilitychange", agendar);

    if ("IntersectionObserver" in window && demo) {
      new IntersectionObserver(function (entradas) {
        naTela = entradas[0].isIntersecting;
        agendar();
      }).observe(demo);
    }

    preencher(0);
    desenharRota(0);
    agendar();
  }
})();

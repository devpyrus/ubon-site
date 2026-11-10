/*
 * A COMPRA AUTOMÁTICA DO UBON PRO (rodada 131).
 *
 * Roda no Cloudflare Pages (Functions), junto com o site. Três endereços:
 *   POST /api/comprar      a página de planos pede um link de pagamento;
 *   POST /api/infinitepay  a InfinitePay avisa que um pagamento foi feito;
 *   GET  /api/confirmar    a página "obrigado" pergunta se o Pro já foi liberado.
 *
 * O caminho de uma compra:
 *   1. a pessoa cola o código da conta (o uid do Firebase, que o app mostra em
 *      Conta → Ubon Pro) e escolhe o plano;
 *   2. este programa calcula até quando o Pro vai valer, monta o número do
 *      pedido com um selo e pede o link à InfinitePay;
 *   3. a pessoa paga no Pix ou no cartão;
 *   4. a InfinitePay avisa (webhook) e a página "obrigado" também pergunta:
 *      os dois caminhos conferem o pagamento com a InfinitePay e liberam o Pro
 *      no RevenueCat. Quem chegar primeiro libera; o outro não muda nada.
 *
 * Variáveis do projeto no Cloudflare (Settings → Variables and Secrets):
 *   INFINITEPAY_HANDLE     a InfiniteTag, sem o $ (texto comum)
 *   INFINITEPAY_API_KEY    a chave do Checkout Integrado (SECRETA; opcional,
 *                          mas com ela o link vale uma vez só e por 2 horas)
 *   REVENUECAT_SECRET_KEY  a chave secreta do RevenueCat, sk_... (SECRETA)
 *   PLANO_DE_TESTE         "sim" liga o plano escondido de R$ 1,00 (1 dia).
 *                          Apague depois de testar.
 *
 * Segurança:
 *   - o aviso da InfinitePay não tem assinatura, então NADA é liberado sem
 *     confirmar o pagamento direto com ela (payment_check);
 *   - o número do pedido (order_nsu) leva um selo (HMAC-SHA256) que só este
 *     programa sabe fazer: ninguém inventa um pedido nem troca o plano ou a
 *     conta dele;
 *   - o valor pago tem que ser pelo menos o preço do plano;
 *   - a data final do Pro vai dentro do pedido. Liberar o mesmo pedido duas
 *     vezes manda a mesma data, e o RevenueCat ignora a repetida (até 2 horas
 *     de diferença conta como a mesma): nada de Pro em dobro.
 */

export const PLANOS = {
  anual: { letra: "a", centavos: 9999, meses: 12, dias: 0, descricao: "Ubon Pro - 12 meses" },
  semestral: { letra: "s", centavos: 5799, meses: 6, dias: 0, descricao: "Ubon Pro - 6 meses" },
  teste: { letra: "t", centavos: 100, meses: 0, dias: 1, descricao: "Ubon Pro - teste de 1 dia" },
};

const INFINITEPAY = "https://api.checkout.infinitepay.io";
const REVENUECAT = "https://api.revenuecat.com/v1";
const DIREITO = "pro"; // o mesmo DIREITO_PRO do app
const SITE = "https://ubon.pro";
const VALIDADE_DO_LINK_MS = 2 * 60 * 60 * 1000;
const VERSAO_DO_PEDIDO = "u1";

/** O código da conta é o uid do Firebase: letras e números, uns 28. */
export function codigoValido(codigo) {
  return typeof codigo === "string" && /^[A-Za-z0-9]{20,40}$/.test(codigo);
}

export function emailValido(email) {
  return typeof email === "string" && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function planoPelaLetra(letra) {
  return Object.entries(PLANOS).find(([, p]) => p.letra === letra) || null;
}

/** Soma o período do plano a um instante (meses de calendário ou dias). */
export function somarPeriodo(base, plano) {
  const data = new Date(base);
  if (plano.meses) data.setUTCMonth(data.getUTCMonth() + plano.meses);
  if (plano.dias) data.setTime(data.getTime() + plano.dias * 24 * 60 * 60 * 1000);
  return data.getTime();
}

// ---------------------------------------------------------------- o selo

async function chaveDoSelo(env) {
  const segredo = env.SEGREDO_DO_PEDIDO || env.REVENUECAT_SECRET_KEY;
  if (!segredo) throw new ErroDeConfiguracao("falta a REVENUECAT_SECRET_KEY");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("ubon-pedido:" + segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function selo(env, texto) {
  const assinatura = await crypto.subtle.sign("HMAC", await chaveDoSelo(env), new TextEncoder().encode(texto));
  return [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

function iguaisSemPressa(a, b) {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

function aleatorio() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

/** u1-<letra do plano>-<código da conta>-<fim em base 36>-<aleatório>-<selo> */
export async function montarPedido(env, nomeDoPlano, codigo, fimMs) {
  const plano = PLANOS[nomeDoPlano];
  const corpo = [VERSAO_DO_PEDIDO, plano.letra, codigo, fimMs.toString(36), aleatorio()].join("-");
  return corpo + "-" + (await selo(env, corpo));
}

/** Lê e confere um número de pedido. Devolve null se não é nosso ou se o selo não bate. */
export async function lerPedido(env, pedido) {
  if (typeof pedido !== "string" || pedido.length > 128) return null;
  const partes = pedido.split("-");
  if (partes.length !== 6 || partes[0] !== VERSAO_DO_PEDIDO) return null;
  const [, letra, codigo, fim36, , seloRecebido] = partes;
  const achado = planoPelaLetra(letra);
  if (!achado || !codigoValido(codigo) || !/^[0-9a-z]{1,12}$/.test(fim36)) return null;
  const esperado = await selo(env, partes.slice(0, 5).join("-"));
  if (!iguaisSemPressa(esperado, seloRecebido)) return null;
  return { nomeDoPlano: achado[0], plano: achado[1], codigo, fimMs: parseInt(fim36, 36) };
}

// ---------------------------------------------------------------- RevenueCat

class ErroDeConfiguracao extends Error {}
class ErroDeFora extends Error {}

function cabecalhosDoRevenueCat(env) {
  if (!env.REVENUECAT_SECRET_KEY) throw new ErroDeConfiguracao("falta a REVENUECAT_SECRET_KEY");
  return { Authorization: "Bearer " + env.REVENUECAT_SECRET_KEY, "Content-Type": "application/json" };
}

/** Até quando o Pro da conta vale agora: ms, null (não tem) ou Infinity (sem fim). */
export async function validadeAtual(env, codigo) {
  const resposta = await fetch(`${REVENUECAT}/subscribers/${encodeURIComponent(codigo)}`, {
    headers: cabecalhosDoRevenueCat(env),
  });
  if (!resposta.ok) throw new ErroDeFora("RevenueCat respondeu " + resposta.status);
  const dados = await resposta.json();
  const direito = dados?.subscriber?.entitlements?.[DIREITO];
  if (!direito) return null;
  if (direito.expires_date === null || direito.expires_date === undefined) return Infinity;
  const ms = Date.parse(direito.expires_date);
  return Number.isFinite(ms) ? ms : null;
}

async function liberarPro(env, codigo, fimMs) {
  const resposta = await fetch(
    `${REVENUECAT}/subscribers/${encodeURIComponent(codigo)}/entitlements/${DIREITO}/promotional`,
    { method: "POST", headers: cabecalhosDoRevenueCat(env), body: JSON.stringify({ end_time_ms: fimMs }) }
  );
  if (!resposta.ok) throw new ErroDeFora("RevenueCat não liberou: " + resposta.status);
}

// ---------------------------------------------------------------- InfinitePay

function handleDaInfinitePay(env) {
  const handle = (env.INFINITEPAY_HANDLE || "").replace(/^\$/, "").trim();
  if (!handle) throw new ErroDeConfiguracao("falta a INFINITEPAY_HANDLE");
  return handle;
}

async function criarLink(env, nomeDoPlano, pedido, email, agora) {
  const plano = PLANOS[nomeDoPlano];
  const corpo = {
    handle: handleDaInfinitePay(env),
    items: [{ quantity: 1, price: plano.centavos, description: plano.descricao }],
    order_nsu: pedido,
    redirect_url: SITE + "/obrigado/",
    webhook_url: SITE + "/api/infinitepay",
  };
  if (email) corpo.customer = { email };
  const cabecalhos = { "Content-Type": "application/json" };
  if (env.INFINITEPAY_API_KEY) {
    cabecalhos["X-Api-Key"] = env.INFINITEPAY_API_KEY;
    corpo.options = {
      single_payment: true,
      valid_until: new Date(agora + VALIDADE_DO_LINK_MS).toISOString(),
      payment_methods_enabled: ["credit_card", "pix"],
    };
  }
  const resposta = await fetch(INFINITEPAY + "/links", {
    method: "POST",
    headers: cabecalhos,
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) throw new ErroDeFora("InfinitePay respondeu " + resposta.status + ": " + (await resposta.text()).slice(0, 300));
  const dados = await resposta.json();
  const url = [dados?.url, dados?.link, dados?.checkout_url, dados?.payment_url, dados?.data?.url].find(
    (u) => typeof u === "string" && u.startsWith("https://")
  );
  if (!url) throw new ErroDeFora("InfinitePay não devolveu o link: " + JSON.stringify(dados).slice(0, 300));
  return url;
}

async function pagamentoConfirmado(env, pedido, transacao, fatura) {
  const resposta = await fetch(INFINITEPAY + "/payment_check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      handle: handleDaInfinitePay(env),
      order_nsu: pedido,
      transaction_nsu: transacao,
      slug: fatura,
    }),
  });
  if (!resposta.ok) throw new ErroDeFora("payment_check respondeu " + resposta.status);
  return resposta.json();
}

// ---------------------------------------------------------------- as três rotas

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function voltarPraPlanos(erro) {
  return new Response(null, { status: 303, headers: { Location: `/planos/?erro=${erro}#comprar` } });
}

async function lerPedidoDeCompra(request) {
  const tipo = request.headers.get("Content-Type") || "";
  if (tipo.includes("application/json")) return { dados: await request.json(), formulario: false };
  const formulario = await request.formData();
  return { dados: Object.fromEntries(formulario.entries()), formulario: true };
}

/** POST /api/comprar — { plano, codigo, email? } → { url } (ou 303 pro link, vindo de formulário). */
export async function comprar(request, env, agora = Date.now()) {
  let formulario = false;
  const erro = (codigo, status) => (formulario ? voltarPraPlanos(codigo) : json({ erro: codigo }, status));
  try {
    const lido = await lerPedidoDeCompra(request);
    formulario = lido.formulario;
    const nomeDoPlano = String(lido.dados.plano || "");
    const codigo = String(lido.dados.codigo || "").trim();
    const email = String(lido.dados.email || "").trim();

    if (!PLANOS[nomeDoPlano] || (nomeDoPlano === "teste" && env.PLANO_DE_TESTE !== "sim")) return erro("plano", 400);
    if (!codigoValido(codigo)) return erro("codigo", 400);
    if (email && !emailValido(email)) return erro("email", 400);

    const validade = await validadeAtual(env, codigo);
    if (validade === Infinity) return erro("vitalicio", 409);
    const fimMs = somarPeriodo(Math.max(agora, validade || 0), PLANOS[nomeDoPlano]);
    const pedido = await montarPedido(env, nomeDoPlano, codigo, fimMs);
    const url = await criarLink(env, nomeDoPlano, pedido, email, agora);
    console.log(`link criado: plano=${nomeDoPlano} pedido=${pedido}`);
    return formulario ? Response.redirect(url, 303) : json({ url });
  } catch (e) {
    console.error("comprar:", e && e.message);
    return erro(e instanceof ErroDeConfiguracao ? "config" : "pagamento", 502);
  }
}

/**
 * Confere e libera. Usado pelo aviso da InfinitePay e pela página "obrigado".
 * Devolve { status: "liberado", ate } | { status: "aguardando" } | { status: "invalido", motivo }.
 */
export async function conferirELiberar(env, pedido, transacao, fatura) {
  const lido = await lerPedido(env, pedido);
  if (!lido) return { status: "invalido", motivo: "pedido" };
  if (!transacao || !fatura) return { status: "invalido", motivo: "faltam dados" };
  const pagamento = await pagamentoConfirmado(env, pedido, String(transacao), String(fatura));
  if (!pagamento || pagamento.success !== true || pagamento.paid !== true) return { status: "aguardando" };
  const pago = Math.max(Number(pagamento.amount) || 0, Number(pagamento.paid_amount) || 0);
  if (pago < lido.plano.centavos) {
    console.error(`valor menor que o plano: pedido=${pedido} pago=${pago}`);
    return { status: "invalido", motivo: "valor" };
  }
  await liberarPro(env, lido.codigo, lido.fimMs);
  console.log(`Pro liberado: conta=${lido.codigo} plano=${lido.nomeDoPlano} ate=${new Date(lido.fimMs).toISOString()}`);
  return { status: "liberado", ate: new Date(lido.fimMs).toISOString().slice(0, 10) };
}

/** POST /api/infinitepay — o aviso (webhook) da InfinitePay. */
export async function avisoDaInfinitePay(request, env) {
  try {
    const aviso = await request.json();
    const resultado = await conferirELiberar(env, aviso.order_nsu, aviso.transaction_nsu, aviso.invoice_slug || aviso.slug);
    // "aguardando": responde 400 pra InfinitePay mandar o aviso de novo.
    if (resultado.status === "aguardando") return json(resultado, 400);
    // Pedido que não é nosso (outra venda da conta) ou valor errado: 200, sem repetir.
    return json(resultado, 200);
  } catch (e) {
    console.error("aviso da InfinitePay:", e && e.message);
    // Falha nossa ou do RevenueCat: 400 pra InfinitePay tentar de novo.
    return json({ status: "erro" }, 400);
  }
}

/** GET /api/confirmar?order_nsu=&transaction_nsu=&slug= — a página "obrigado" pergunta. */
export async function confirmar(request, env) {
  try {
    const p = new URL(request.url).searchParams;
    return json(await conferirELiberar(env, p.get("order_nsu"), p.get("transaction_nsu"), p.get("slug")));
  } catch (e) {
    console.error("confirmar:", e && e.message);
    return json({ status: "erro" }, 502);
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const rota = Array.isArray(params.rota) ? params.rota.join("/") : String(params.rota || "");
  if (rota === "comprar" && request.method === "POST") return comprar(request, env);
  if (rota === "infinitepay" && request.method === "POST") return avisoDaInfinitePay(request, env);
  if (rota === "confirmar" && request.method === "GET") return confirmar(request, env);
  return json({ erro: "nao encontrado" }, 404);
}

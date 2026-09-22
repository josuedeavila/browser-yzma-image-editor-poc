// rules.js holds the Mercado Livre image rules this PoC checks against, and
// the single combined prompt sent to the vision model. Sourced from public
// Mercado Livre documentation (not invented) — see README "Regras do
// Mercado Livre usadas de base" for the exact citations.

// Technical constraints, enforced deterministically in JS (editor.js) — no
// AI involved. Source: developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens
// (official API docs).
const TECHNICAL_RULES = {
  minSide: 500, // below this the image is not upscaled by Mercado Livre
  maxSide: 1920, // above this Mercado Livre downscales it ("version F")
  recommendedSide: 1200,
  maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
};

// The maximum side (px) of the image actually sent to the vision model. A
// larger image only costs more memory/time for the projector, not quality —
// same value yzma's own wasm/vlm.html demo uses. This is independent of
// TECHNICAL_RULES: the editor's *export* follows Mercado Livre's resolution
// rules, this only controls what goes into the (much slower) AI check.
const AI_CHECK_MAX_SIDE = 896;

// The single combined question sent to the vision model. One call, not one
// per rule — the projector/image-encode step (tens of seconds to over a
// minute on CPU, see README "Performance sem GPU") is paid once per
// describe() call, so asking 3 separate questions would 3x the wait for no
// benefit. This model is small (256M) — README and the UI both label this as
// a best-effort hint, not a certified compliance check.
//
// This exact phrasing was chosen after testing two alternatives against this
// model with wasm/node/vlm.js (see README "Modelo de visão"): a numbered
// list ("1) ... 2) ... 3) ...") made the model just echo the questions back
// instead of answering; this single flowing sentence got it to actually
// answer the first point and only trail into echoing the rest — still
// imperfect, but a real improvement, not a random choice.
const AI_CHECK_PROMPT =
  "Observe esta foto de produto para anúncio. Em uma frase curta, diga se o fundo é branco e liso, " +
  "se há texto ou marca d'água visível, e se o produto está centralizado.";

// Composition rules, checked informally by the prompt above (not enforced in
// code) — shown in the UI as reference text. Source: Central de Vendedores
// oficial do Mercado Livre (vendedores.mercadolivre.com.br), ver README.
const COMPOSITION_RULES = [
  "Proporção quadrada (largura = altura) é fortemente recomendada.",
  "Fundo branco criado digitalmente — obrigatório em Tecnologia, Beleza, Saúde e Supermercado; " +
    "fundo liso branco/cinza/creme aceito em Moda; fundo contextual permitido só na capa de Casa e Móveis.",
  "Produto centralizado, ocupando ~95% da imagem, sem cortes nas bordas, sem sombras duras, sem margens.",
  "Produtos muito finos (ex: lápis) precisam de no mínimo 250px no lado menor.",
  "Proibido na foto principal: marca d'água, logotipo, contato, QR code, texto/preço/frete/especificação " +
    "sobreposta, borda colorida ou moldura, selos de venda (\"Mais Vendido\", \"MercadoLíder\", \"Full\", " +
    "\"Oferta Relâmpago\"), múltiplos produtos ou variações numa imagem só, cabides aparentes.",
];

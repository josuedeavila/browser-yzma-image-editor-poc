# browser-yzma-image-editor-poc

PoC: editor de imagens de produto pra anúncios do Mercado Livre, rodando
**inteiramente no navegador** — sem servidor. Duas peças independentes:

1. **Editor de canvas** (Canvas2D puro, sem biblioteca de imagem): recorta/
   preenche pra proporção quadrada, redimensiona pra faixa recomendada pelo
   Mercado Livre, achata transparência em fundo branco, deixa reposicionar/dar
   zoom manual, exporta em JPEG/PNG. Funciona sem nenhum modelo de IA.
2. **Checagem visual opcional por IA**: um modelo de visão-linguagem pequeno
   rodando via [`hybridgroup/yzma`](https://github.com/hybridgroup/yzma)
   (`llama.cpp` compilado pra WebAssembly) aponta prováveis violações de fundo/
   marca d'água/enquadramento — **best-effort, não é uma checagem oficial**.

Projeto irmão de [`browser-yzma-translate-poc`](https://github.com/josuedeavila/browser-yzma-translate-poc)
(mesmo padrão de vendorização/build/serve do yzma), mas independente — não tem
nenhuma dependência dele.

## Regras do Mercado Livre usadas de base

Pesquisadas na documentação pública (não inventadas):

**Técnicas** ([developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens](https://developers.mercadolivre.com.br/pt_br/trabalhar-com-imagens),
docs oficiais da API — checadas em `web/rules.js`, `TECHNICAL_RULES`):
- Mínimo 500×500px (abaixo disso a imagem não é ampliada pelo Mercado Livre).
- Máximo 1920×1920px (acima disso é redimensionada pra baixo).
- Recomendado: 1200×1200px.
- Até 10MB por arquivo.

**Composição** ([vendedores.mercadolivre.com.br/nota/requisitos-de-fotos-para-vender-acessorios](https://vendedores.mercadolivre.com.br/nota/requisitos-de-fotos-para-vender-acessorios),
Central de Vendedores oficial, agregado por [1001clicks.com.br](https://1001clicks.com.br/blog/post/mudancas-regras-fotos-mercado-livre/)
— referenciadas em `web/rules.js`, `COMPOSITION_RULES`, e no prompt da IA):
- Proporção quadrada fortemente recomendada.
- Fundo branco criado digitalmente — obrigatório em Tecnologia/Beleza/Saúde/
  Supermercado; liso branco/cinza/creme aceito em Moda; contextual permitido
  só na capa de Casa e Móveis.
- Produto centralizado, ~95% da imagem, sem cortes nas bordas, sem sombras
  duras, sem margens.
- Proibido na foto principal: marca d'água, logotipo, contato, QR code, texto/
  preço/frete/especificação sobreposta, borda/moldura colorida, selos de venda
  ("Mais Vendido", "MercadoLíder", "Full", "Oferta Relâmpago"), múltiplos
  produtos/variações numa imagem só, cabides aparentes.

**Fora do escopo**: remoção automática de fundo fotografado (produto
recortado de um ambiente real). Isso precisa de um modelo de segmentação de
imagem (ex: U2Net/RMBG/BiRefNet) — domínio bem diferente do yzma, que só faz
LLM/visão-texto. O editor resolve fundo só pra imagens que já vêm com
transparência (PNG recortado), achatando em branco.

## Como funciona

O editor (§1) é só JS + Canvas2D — abra a página e já funciona, sem baixar
nada. A checagem por IA (§2) é opcional e usa o mesmo mecanismo da PoC de
tradução:

```
page (index.html)
      │ postMessage
Web Worker (web/vendor/yzma/worker.js, ?program=yzma-vlm.wasm)
   │                    \
Go program               llama.cpp + mtmd module
(wasm/main.go,      -->  (build pré-compilado, baixado
 GOOS=js GOARCH=wasm)     via `make vendor-yzma` — já inclui
                          suporte multimodal, sem flag extra)
```

`wasm/main.go` é baseado no exemplo `examples/wasm/vlm` do yzma: carrega um
modelo GGUF + seu projetor (mmproj) e expõe `describe(prompt, width, height,
rgba, maxTokens)` pro JS. O prompt (pergunta única cobrindo as 3 regras que um
modelo pequeno consegue avaliar) fica em `web/rules.js`, não no Go.

## Setup

### 1. Dependências

Só precisa do Go. **TinyGo não é necessário** — o build usa o toolchain
padrão (`GOOS=js GOARCH=wasm go build`).

### 2. Baixar os artefatos do yzma

```bash
make deps          # go mod tidy (host + GOOS=js GOARCH=wasm)
make vendor-yzma    # clona yzma na MESMA tag do go.mod, copia yzma-loader.js/
                     # worker.js/wasm_exec.js e baixa o build pré-compilado do
                     # llama.cpp para WASM (web/vendor/yzma/, gitignored) —
                     # já vem com suporte a multimodal (mtmd)
make build-wasm      # compila wasm/main.go -> web/vendor/yzma/yzma-vlm.wasm
```

**Importante:** `make vendor-yzma` clona a tag `YZMA_VERSION` do Makefile, que
deve bater com a versão em `go.mod`. Se divergirem, o Go program (via
`pkg/llamawasm`) e o módulo `llama.cpp` pré-compilado falam ABIs diferentes e
o programa trava/aborta ao tentar gerar texto (`panic: JavaScript error:
unreachable` / menção a "ABI") — mesmo problema documentado na PoC de
tradução, mesma solução: usar a mesma tag nos dois lados.

### 3. Servir

```bash
make serve   # devserver em :8090
```

Abra `http://localhost:8090`.

## Usando

1. **Escolha uma foto** (seção 1).
2. **Edite** (seção 2): arraste a imagem no canvas pra reposicionar, use o
   slider de zoom, escolha "preencher com branco" (não corta o produto,
   padrão) ou "cortar pra preencher", ajuste a resolução de exportação
   (padrão 1200px) e exporte — o checklist técnico abaixo do canvas confere
   proporção/resolução/tamanho de arquivo ao vivo.
3. **(Opcional) Checagem por IA** (seção 3): clique em "Carregar modelo de
   visão" (baixa ~280MB — modelo + projetor), espere carregar, clique em
   "Verificar imagem com IA". **Isso é lento sem GPU** — ver seção abaixo.

## Modelo de visão

Padrão: **`ggml-org/SmolVLM-256M-Instruct-GGUF`** (`Q8_0`, modelo ~175MB +
projetor `mmproj-SmolVLM-256M-Instruct-Q8_0.gguf` ~104MB). É exatamente o
modelo que os próprios testes/benchmarks do yzma usam pro caminho VLM no
browser — combinação conhecidamente funcional, não uma escolha arbitrária.
256M parâmetros é pequeno: a checagem por IA é um **palpite**, não uma
verificação confiável — o checklist técnico determinístico (§ editor) é a
única parte com garantia real.

**Achado real testando o prompt** (`wasm/node/vlm.js`, antes de ir pro
browser): uma versão do prompt com lista numerada ("1) ... 2) ... 3) ...")
fazia o modelo simplesmente ecoar as perguntas de volta, sem responder nada.
Uma frase só, corrida, fez o modelo responder de verdade a primeira parte
("O fundo é branco e liso" — correto pra imagem de teste) antes de também
degradar pra eco no resto. `web/rules.js` usa essa segunda versão (melhor,
mas ainda imperfeita) — é o tipo de limitação que um modelo de 256M tem
mesmo, não um bug do PoC.

## Performance sem GPU

O próprio [`wasm/README.md` do yzma](https://github.com/hybridgroup/yzma/blob/main/wasm/README.md#images)
e a página de demo oficial (`wasm/vlm.html`) avisam: **"On the CPU the image
itself takes half a minute or more: the projector is the slow part, not the
answer. With WebGPU it takes a second or two."** — isso é o custo de rodar o
projetor multimodal (converter a imagem em tokens) uma vez por chamada; a
geração de texto depois disso é rápida em comparação. Sem GPU real disponível
(ver "Troubleshooting" abaixo), espere isso demorar bem mais de um minuto —
na PoC de tradução irmã, este mesmo host mediu throughput de texto bem abaixo
do benchmark oficial do yzma, então o mesmo desvio vale aqui.

Por isso `web/rules.js` manda **uma única pergunta combinada** cobrindo as 3
regras, em vez de uma chamada por regra — cada chamada de `describe()` paga o
custo do projetor do zero, então perguntar 3 coisas separadas triplicaria a
espera pra nenhum ganho.

A imagem mandada pro modelo é reduzida pra no máximo 896px no lado maior
(`AI_CHECK_MAX_SIDE` em `web/rules.js`) antes de ir pro worker — mesmo valor
que a própria demo oficial do yzma usa, já que uma imagem maior só custa mais
memória/tempo pro projetor, não mais qualidade. Isso é independente da
resolução de **exportação** do editor (que segue as regras do Mercado Livre,
500–1920px).

Pra comparar single-thread vs. multi-thread neste host:
```bash
make serve                  # :8090, multi-thread (padrão)
make serve-single-thread    # :8091, força single-thread (sem COOP/COEP)
```

## Troubleshooting

- **Saída sem sentido e lenta ao mesmo tempo**, com status mostrando `backend:
  webgpu (WebGPU)`: no Linux o Chrome mantém o Vulkan desativado por padrão, e
  o WebGPU cai pra um modo de compatibilidade que em várias placas calcula
  valores errados sem que o self-test do yzma detecte — mesmo bug documentado
  na PoC de tradução irmã (`wasm/README.md` do yzma, seção "Vulkan in Chrome
  on Linux", issue [#341](https://github.com/hybridgroup/yzma/issues/341)).
  Acesse `?mode=cpu` na URL da página e recarregue o modelo pra confirmar
  (deve ficar coerente, mesmo que lento).
- **`panic: JavaScript error: unreachable` / menção a "ABI"**: versão do yzma
  clonada em `make vendor-yzma` não bate com a do `go.mod` — ver §Setup.
- **`SharedArrayBuffer is not defined`**: headers COOP/COEP não chegaram —
  confirme que está acessando via `devserver` (`make serve`), não abrindo
  `web/index.html` direto do disco.
- **Erro de rede/CORS ao baixar o modelo**: baixe o `.gguf` e o `mmproj` uma
  vez com `curl` pra `web/vendor/models/` (gitignored) e troque as URLs dos
  campos "Modelo"/"Projetor" pelos caminhos locais.
- Console do navegador mostra qual backend o `yzma-loader.js` escolheu.
  Detalhes completos em [`wasm/README.md` do yzma](https://github.com/hybridgroup/yzma/blob/main/wasm/README.md).

## Fora do escopo

- Remoção automática de fundo fotografado (precisaria de um modelo de
  segmentação de imagem separado, fora do domínio do yzma) — ver acima.
- Qualquer garantia de compliance "oficial" — a checagem por IA é best-effort
  e claramente rotulada como tal na UI.

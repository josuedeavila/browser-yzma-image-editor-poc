// app.js wires the file input, the Canvas2D editor (editor.js), and the
// optional AI check (a Web Worker running yzma/WASM's vision-language
// example). The editor works with zero dependency on the AI half — the
// worker/model is only needed for section 3.

const fileInput = document.getElementById("file");
const modeButtons = { pad: document.getElementById("modePad"), crop: document.getElementById("modeCrop") };
const zoomInput = document.getElementById("zoom");
const targetSideInput = document.getElementById("targetSide");
const formatSelect = document.getElementById("format");
const qualityField = document.getElementById("qualityField");
const qualityInput = document.getElementById("quality");
const exportBtn = document.getElementById("exportBtn");
const techChecklist = document.getElementById("techChecklist");
const downloadLink = document.getElementById("downloadLink");

const modelUrlInput = document.getElementById("modelUrl");
const projectorUrlInput = document.getElementById("projectorUrl");
const loadModelBtn = document.getElementById("loadModelBtn");
const checkBtn = document.getElementById("checkBtn");
const modelStatus = document.getElementById("modelStatus");
const aiOutput = document.getElementById("aiOutput");
const aiTiming = document.getElementById("aiTiming");

let lastExportBytes = null;
let modelReady = false;
let checking = false;
let checkStart = 0;
let aiRawText = "";

// --- reference composition rules (informational, not auto-checked) ---
COMPOSITION_RULES.forEach((rule) => {
  const li = document.createElement("li");
  li.textContent = rule;
  document.getElementById("compositionRules").appendChild(li);
});

// --- 1. image loading ---
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  await Editor.loadFile(file);
  lastExportBytes = null;
  renderChecklist();
});

// --- 2. editor controls ---
function setMode(mode) {
  Editor.setMode(mode);
  modeButtons.pad.classList.toggle("active", mode === "pad");
  modeButtons.crop.classList.toggle("active", mode === "crop");
}
modeButtons.pad.addEventListener("click", () => setMode("pad"));
modeButtons.crop.addEventListener("click", () => setMode("crop"));

zoomInput.addEventListener("input", () => {
  Editor.setZoom(Number(zoomInput.value));
});

targetSideInput.addEventListener("change", () => {
  const clamped = Editor.setTargetSide(Number(targetSideInput.value));
  targetSideInput.value = clamped;
  lastExportBytes = null;
  renderChecklist();
});

formatSelect.addEventListener("change", () => {
  qualityField.style.display = formatSelect.value === "image/jpeg" ? "" : "none";
});

exportBtn.addEventListener("click", async () => {
  if (!Editor.hasImage()) {
    alert("Escolha uma imagem primeiro.");
    return;
  }

  const quality = formatSelect.value === "image/jpeg" ? Number(qualityInput.value) : undefined;
  const blob = await Editor.exportBlob(formatSelect.value, quality);
  lastExportBytes = blob.size;

  const url = URL.createObjectURL(blob);
  downloadLink.href = url;
  downloadLink.download = formatSelect.value === "image/jpeg" ? "anuncio.jpg" : "anuncio.png";
  downloadLink.style.display = "inline-block";
  downloadLink.textContent = "Baixar imagem exportada (" + formatBytes(blob.size) + ")";

  renderChecklist();
});

function renderChecklist() {
  const side = Number(targetSideInput.value);
  const items = [
    {
      ok: true,
      text: "Proporção quadrada (o canvas de exportação sempre é quadrado)",
    },
    {
      ok: side >= TECHNICAL_RULES.minSide && side <= TECHNICAL_RULES.maxSide,
      text:
        "Resolução " +
        side +
        "×" +
        side +
        "px dentro da faixa " +
        TECHNICAL_RULES.minSide +
        "–" +
        TECHNICAL_RULES.maxSide +
        "px" +
        (side !== TECHNICAL_RULES.recommendedSide
          ? " (recomendado: " + TECHNICAL_RULES.recommendedSide + "px)"
          : ""),
    },
    {
      ok: lastExportBytes !== null && lastExportBytes <= TECHNICAL_RULES.maxFileSizeBytes,
      text:
        lastExportBytes === null
          ? "Tamanho do arquivo — exporte pra checar (limite: " + formatBytes(TECHNICAL_RULES.maxFileSizeBytes) + ")"
          : "Tamanho do arquivo: " +
            formatBytes(lastExportBytes) +
            " (limite: " +
            formatBytes(TECHNICAL_RULES.maxFileSizeBytes) +
            ")",
    },
  ];

  techChecklist.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item.text;
    li.className = item.ok ? "ok" : "fail";
    techChecklist.appendChild(li);
  });
}
renderChecklist();

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

// --- 3. AI check: Web Worker running yzma/WASM's vision-language example ---
// ?mode=cpu / ?mode=webgpu on this page's URL is forwarded to the worker,
// same as the sibling browser-yzma-translate-poc project, to force the CPU
// build if WebGPU is computing wrong values (see README Troubleshooting).
const workerMode = new URLSearchParams(location.search).get("mode");
const worker = new Worker(
  "vendor/yzma/worker.js?program=yzma-vlm.wasm" + (workerMode ? "&mode=" + encodeURIComponent(workerMode) : ""),
);

worker.onmessage = (event) => {
  const { kind, text } = event.data || {};
  switch (kind) {
    case "ready":
      modelStatus.textContent = "worker pronto (" + text + ") — clique em \"Carregar modelo de visão\"";
      break;
    case "status":
      modelStatus.textContent = text;
      break;
    case "progress":
      modelStatus.textContent = "baixando: " + text;
      break;
    case "loaded":
      modelReady = true;
      modelStatus.textContent = "modelo carregado: " + text;
      loadModelBtn.disabled = false;
      loadModelBtn.textContent = "Recarregar modelo de visão";
      checkBtn.disabled = !Editor.hasImage();
      break;
    case "token":
      if (checking) {
        aiRawText += text;
        aiOutput.textContent = aiRawText;
      }
      break;
    case "done":
      checking = false;
      checkBtn.disabled = !modelReady || !Editor.hasImage();
      aiTiming.textContent =
        "latência: " + Math.round(performance.now() - checkStart) + " ms — " + text;
      modelStatus.textContent = "concluído";
      break;
    case "error":
      loadModelBtn.disabled = false;
      checking = false;
      checkBtn.disabled = !modelReady || !Editor.hasImage();
      modelStatus.textContent = "erro: " + text;
      modelStatus.classList.add("error");
      break;
    default:
      modelStatus.textContent = kind + ": " + text;
  }
};

loadModelBtn.addEventListener("click", () => {
  modelReady = false;
  checkBtn.disabled = true;
  loadModelBtn.disabled = true;
  modelStatus.classList.remove("error");
  modelStatus.textContent = "iniciando download do modelo (imagem + projetor, ~280 MB no total)…";
  worker.postMessage({ kind: "load", url: modelUrlInput.value, projector: projectorUrlInput.value });
});

checkBtn.addEventListener("click", () => {
  if (!Editor.hasImage()) {
    alert("Escolha uma imagem primeiro.");
    return;
  }
  if (!modelReady) {
    modelStatus.textContent = "carregue o modelo de visão primeiro";
    return;
  }

  const picture = Editor.pixelsForAI(AI_CHECK_MAX_SIDE);
  if (!picture) return;

  // Disabled for the whole check, not just while a "done"/"error" is
  // pending: describe() runs in a Go goroutine, and a second click before it
  // finishes would race the first call on the shared llama.cpp context.
  checking = true;
  checkBtn.disabled = true;
  aiRawText = "";
  aiOutput.textContent = "";
  aiTiming.textContent = "";
  modelStatus.classList.remove("error");
  modelStatus.textContent = "analisando a imagem (isso é a parte lenta, pode levar bem mais de um minuto sem GPU)…";
  checkStart = performance.now();

  const rgbaBuffer = picture.rgba.buffer;
  worker.postMessage(
    {
      kind: "describe",
      prompt: AI_CHECK_PROMPT,
      width: picture.width,
      height: picture.height,
      rgba: rgbaBuffer,
      maxTokens: 120,
    },
    [rgbaBuffer],
  );
});


(() => {
  "use strict";

  const EMOJI = {
    sadness: "😢",
    joy: "😄",
    love: "❤️",
    anger: "😠",
    fear: "😨",
    surprise: "😲"
  };

  const DESCRIPTIONS = {
    sadness: "A signal of sadness or low mood",
    joy: "A signal of happiness or excitement",
    love: "A signal of warmth or affection",
    anger: "A signal of frustration or anger",
    fear: "A signal of worry or apprehension",
    surprise: "A signal of surprise or amazement"
  };

  const BAR_COLORS = {
    sadness: "#7aa2f7",
    joy: "#f6c85f",
    love: "#ff7892",
    anger: "#ff8066",
    fear: "#b69cff",
    surprise: "#5ee0d0"
  };

  const el = {
    statusDot: document.getElementById("statusDot"),
    footerStatusDot: document.getElementById("footerStatusDot"),
    statusPillText: document.getElementById("statusPillText"),
    serverStatusText: document.getElementById("serverStatusText"),

    textInput: document.getElementById("textInput"),
    charCount: document.getElementById("charCount"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    errorMsg: document.getElementById("errorMsg"),

    resultSection: document.getElementById("resultSection"),
    emotionWord: document.getElementById("emotionWord"),
    emotionEmoji: document.getElementById("emotionEmoji"),
    emotionSubtitle: document.getElementById("emotionSubtitle"),
    confidenceText: document.getElementById("confidenceText"),
    confidenceFill: document.getElementById("confidenceFill"),
    echoedText: document.getElementById("echoedText"),
    barsContainer: document.getElementById("barsContainer")
  };

  let modelReady = false;
  let isAnalyzing = false;
  let healthTimer = null;

  /* =========================================
     SERVER STATUS
     ========================================= */

  function setStatus(kind, message) {
    [el.statusDot, el.footerStatusDot].forEach(dot => {
      dot.className = `status-dot ${kind}`;
    });

    el.statusPillText.textContent =
      kind === "live"
        ? "Model online"
        : kind === "warming"
          ? "Model starting"
          : "Server offline";

    el.serverStatusText.textContent = message;
  }

  async function checkHealth() {
    try {
      const response = await fetch("/health", {
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Health check failed (${response.status})`);
      }

      const data = await response.json();

      modelReady = Boolean(data.model_loaded);

      if (modelReady) {
        setStatus("live", "Model ready · ready for analysis");
      } else {
        setStatus("warming", "Model is loading · checking again shortly");
        scheduleHealthCheck(3000);
      }
    } catch (error) {
      modelReady = false;

      setStatus("down", "Unable to reach the server · retrying");
      scheduleHealthCheck(5000);
    }

    syncButtonState();
  }

  function scheduleHealthCheck(delay) {
    if (healthTimer) {
      window.clearTimeout(healthTimer);
    }

    healthTimer = window.setTimeout(checkHealth, delay);
  }

  /* =========================================
     INPUT VALIDATION
     ========================================= */

  function syncButtonState() {
    const hasText = el.textInput.value.trim().length > 0;

    el.analyzeBtn.disabled =
      !hasText || !modelReady || isAnalyzing;
  }

  function showError(message) {
    el.errorMsg.textContent = message;
    el.errorMsg.hidden = false;
  }

  function hideError() {
    el.errorMsg.hidden = true;
    el.errorMsg.textContent = "";
  }

  /* =========================================
     LOADING STATE
     ========================================= */

  function setLoading(loading) {
    isAnalyzing = loading;

    el.analyzeBtn.classList.toggle("loading", loading);

    el.analyzeBtn.querySelector(".btn-label").textContent =
      loading ? "Analyzing…" : "Analyze emotion";

    el.analyzeBtn.querySelector(".btn-icon").textContent =
      loading ? "…" : "↗";

    syncButtonState();
  }

  /* =========================================
     TEXTAREA EVENTS
     ========================================= */

  el.textInput.addEventListener("input", () => {
    el.charCount.textContent =
      el.textInput.value.length.toLocaleString();

    hideError();
    syncButtonState();
  });

  el.textInput.addEventListener("keydown", event => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key === "Enter"
    ) {
      event.preventDefault();
      runAnalysis();
    }
  });

  /* =========================================
     EXAMPLE SENTENCES
     ========================================= */

  document.querySelectorAll("[data-example]").forEach(button => {
    button.addEventListener("click", () => {
      el.textInput.value = button.dataset.example || "";

      el.charCount.textContent =
        el.textInput.value.length.toLocaleString();

      hideError();
      syncButtonState();

      el.textInput.focus();
    });
  });

  /* =========================================
     ANALYZE BUTTON
     ========================================= */

  el.analyzeBtn.addEventListener("click", runAnalysis);

  /* =========================================
     CALL FASTAPI PREDICTION ENDPOINT
     ========================================= */

  async function runAnalysis() {
    const text = el.textInput.value.trim();

    if (!text || !modelReady || isAnalyzing) {
      return;
    }

    hideError();
    setLoading(true);

    // Hide the previous result while processing.
    el.resultSection.hidden = true;

    try {
      const response = await fetch("/predict", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },

        body: JSON.stringify({ text })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : `The request failed (${response.status}). Please try again.`;

        throw new Error(detail);
      }

      const emotion = String(
        data.predicted_emotion || ""
      ).toLowerCase();

      const rawConfidence = Number(data.confidence);

      // Support the original spelling and common alternatives.
      const probabilities =
        data.all_probabilites ||
        data.all_probabilities ||
        data.probabilities;

      if (!emotion) {
        throw new Error(
          "The server response did not include a predicted emotion."
        );
      }

      if (
        !probabilities ||
        typeof probabilities !== "object" ||
        Array.isArray(probabilities)
      ) {
        throw new Error(
          "The server response did not include the emotion probability breakdown."
        );
      }

      renderResult(
        {
          emotion,
          confidence: rawConfidence,
          probabilities
        },
        text
      );
    } catch (error) {
      showError(
        error.message || "Something went wrong. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  /* =========================================
     DISPLAY PREDICTION RESULTS
     ========================================= */

  function renderResult(data, originalText) {
    const {
      emotion,
      confidence,
      probabilities
    } = data;

    const emoji = EMOJI[emotion] || "🙂";

    const safeConfidence = Number.isFinite(confidence)
      ? clamp(confidence, 0, 1)
      : 0;

    // Update emotion-specific accent colors.
    document.body.dataset.emotion = emotion;

    el.emotionWord.textContent = capitalize(emotion);
    el.emotionEmoji.textContent = emoji;

    el.emotionSubtitle.textContent =
      DESCRIPTIONS[emotion] ||
      "The strongest signal in your text";

    el.confidenceText.textContent =
      `${(safeConfidence * 100).toFixed(1)}%`;

    el.confidenceFill.style.width =
      `${safeConfidence * 100}%`;

    // Use textContent to safely display user-provided text.
    el.echoedText.textContent = originalText;

    renderBars(probabilities);

    el.resultSection.hidden = false;

    // Restart the entrance animation.
    el.resultSection.classList.remove("result-section");
    void el.resultSection.offsetWidth;
    el.resultSection.classList.add("result-section");

    el.resultSection.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  /* =========================================
     PROBABILITY BREAKDOWN
     ========================================= */

  function renderBars(probabilities) {
    const entries = Object.entries(probabilities)
      .map(([label, value]) => [
        String(label).toLowerCase(),
        Number(value)
      ])
      .filter(([, value]) => Number.isFinite(value))
      .sort((a, b) => b[1] - a[1]);

    el.barsContainer.replaceChildren();

    entries.forEach(([label, rawValue], index) => {
      // Accept values in either [0, 1] or [0, 100].
      const value = clamp(
        rawValue > 1 ? rawValue / 100 : rawValue,
        0,
        1
      );

      const percentage = value * 100;

      const row = document.createElement("div");
      row.className = "bar-row";

      // Emotion label.
      const labelEl = document.createElement("span");
      labelEl.className = "bar-label";

      const emojiEl = document.createElement("span");
      emojiEl.className = "bar-emoji";
      emojiEl.textContent = EMOJI[label] || "•";

      const nameEl = document.createElement("span");
      nameEl.textContent = label;

      labelEl.append(emojiEl, nameEl);

      // Progress bar.
      const track = document.createElement("span");
      track.className = "bar-track";

      track.setAttribute("role", "progressbar");
      track.setAttribute(
        "aria-label",
        `${capitalize(label)} probability`
      );
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute(
        "aria-valuenow",
        percentage.toFixed(1)
      );

      const fill = document.createElement("span");
      fill.className = "bar-fill";

      fill.style.backgroundColor =
        BAR_COLORS[label] || "var(--accent)";

      track.appendChild(fill);

      // Percentage label.
      const pct = document.createElement("span");
      pct.className = "bar-pct";
      pct.textContent = `${percentage.toFixed(1)}%`;

      row.append(labelEl, track, pct);
      el.barsContainer.appendChild(row);

      // Animate the bar after it has entered the document.
      window.setTimeout(() => {
        fill.style.width = `${percentage}%`;
      }, 70 + index * 65);
    });
  }

  /* =========================================
     HELPERS
     ========================================= */

  function capitalize(value) {
    return value
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : "";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* =========================================
     CLEANUP AND INITIALIZATION
     ========================================= */

  window.addEventListener("beforeunload", () => {
    if (healthTimer) {
      window.clearTimeout(healthTimer);
    }
  });

  checkHealth();
})();

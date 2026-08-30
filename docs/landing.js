(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isEnglish = document.documentElement.lang.toLowerCase().indexOf("en") === 0;

  function syncSoundButton(button, muted) {
    if (!button) return;
    var label = isEnglish
      ? (muted ? "Turn sound on" : "Turn sound off")
      : (muted ? "开启声音" : "关闭声音");
    button.setAttribute("aria-pressed", String(!muted));
    button.setAttribute("aria-label", label);
    var screenReaderLabel = button.querySelector(".sr-only");
    if (screenReaderLabel) screenReaderLabel.textContent = label;
  }

  document.querySelectorAll(".ph video").forEach(function (video) {
    var tryPlay = function () {
      var playRequest = video.play();
      if (playRequest && playRequest.catch) playRequest.catch(function () {});
    };
    if (video.readyState >= 2) tryPlay();
    else video.addEventListener("loadeddata", tryPlay, { once: true });
    document.addEventListener("pointerdown", tryPlay, { once: true });
  });

  document.querySelectorAll(".ph").forEach(function (frame) {
    var video = frame.querySelector("video");
    var button = frame.querySelector(".snd");
    if (!video || !button) return;

    syncSoundButton(button, video.muted);
    button.addEventListener("click", function () {
      document.querySelectorAll(".ph").forEach(function (otherFrame) {
        var otherVideo = otherFrame.querySelector("video");
        var otherButton = otherFrame.querySelector(".snd");
        if (!otherVideo || otherVideo === video) return;
        otherVideo.muted = true;
        syncSoundButton(otherButton, true);
      });

      video.muted = !video.muted;
      syncSoundButton(button, video.muted);
      if (!video.muted) video.play().catch(function () {});
    });
  });

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var targetId = link.getAttribute("href");
      if (!targetId || targetId === "#") return;
      var target = document.querySelector(targetId);
      if (!target) return;
      event.preventDefault();
      var targetTop = target.getBoundingClientRect().top + window.scrollY - 72;
      window.scrollTo({ top: targetTop, behavior: reduceMotion ? "auto" : "smooth" });
      history.replaceState(null, "", targetId);
    });
  });

  function initializeHeroHeadline() {
    var headline = document.querySelector(".hero h1");
    if (!headline || headline.querySelector(".hero-char")) return;

    var characterIndex = 0;

    function controlledRandom(index, salt) {
      var value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
      return value - Math.floor(value);
    }

    function wrapTextNode(node, lineIndex) {
      var fragment = document.createDocumentFragment();
      Array.from(node.nodeValue).forEach(function (character) {
        var span = document.createElement("span");
        var isSpace = /\s/.test(character);
        span.className = isSpace ? "hero-char hero-char-space" : "hero-char";
        span.textContent = isSpace ? "\u00a0" : character;

        if (!isSpace && !reduceMotion) {
          var horizontal = (controlledRandom(characterIndex, 1) * 2 - 1) * 1.35;
          var vertical = -75 - controlledRandom(characterIndex, 2) * 105;
          var rotation = (controlledRandom(characterIndex, 3) * 2 - 1) * 18;
          var delay = Math.round(controlledRandom(characterIndex, 4) * 220 + lineIndex * 100);
          span.style.setProperty("--char-x", horizontal.toFixed(2) + "em");
          span.style.setProperty("--char-y", vertical.toFixed(0) + "%");
          span.style.setProperty("--char-rotate", rotation.toFixed(1) + "deg");
          span.style.setProperty("--char-delay", delay + "ms");
        }

        fragment.appendChild(span);
        characterIndex += 1;
      });
      node.replaceWith(fragment);
    }

    function wrapElementText(element, lineIndex) {
      Array.prototype.slice.call(element.childNodes).forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.nodeValue) wrapTextNode(node, lineIndex);
          return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) wrapElementText(node, lineIndex);
      });
    }

    headline.querySelectorAll(".line > span").forEach(function (line, lineIndex) {
      wrapElementText(line, lineIndex);
    });
  }

  initializeHeroHeadline();

  function initializeHeroStatus() {
    var root = document.querySelector("[data-hero-status]");
    var value = document.querySelector("[data-hero-status-value]");
    if (!root || !value) return;

    var stateKeys = ["generating", "editing", "compositing", "complete"];
    var configuredStates = (root.dataset.statusStates || "生成中|剪辑中|合成中|已完成")
      .split("|")
      .map(function (label) { return label.trim(); })
      .filter(Boolean)
      .slice(0, stateKeys.length);
    var states = configuredStates.map(function (label, stateIndex) {
      return { key: stateKeys[stateIndex], label: label };
    });
    if (!states.length) return;
    var index = 0;
    var timer = 0;
    var visible = true;

    function clearTimer() {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = 0;
    }

    function schedule() {
      clearTimer();
      if (reduceMotion || document.hidden || !visible) return;
      timer = window.setTimeout(advance, 1900);
    }

    function advance() {
      root.classList.add("is-updating");
      value.classList.add("is-leaving");

      window.setTimeout(function () {
        index = (index + 1) % states.length;
        root.dataset.state = states[index].key;
        value.textContent = states[index].label;
        value.classList.remove("is-leaving");
        value.classList.add("is-entering");

        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            value.classList.remove("is-entering");
            root.classList.remove("is-updating");
          });
        });
        schedule();
      }, 180);
    }

    document.addEventListener("visibilitychange", schedule);
    if ("IntersectionObserver" in window) {
      var statusObserver = new IntersectionObserver(function (entries) {
        visible = entries[0] ? entries[0].isIntersecting : true;
        schedule();
      }, { threshold: 0.2 });
      statusObserver.observe(root);
    }
    schedule();
  }

  initializeHeroStatus();

  function initializeFeatureDeck() {
    var deck = document.querySelector("[data-feature-deck]");
    if (!deck) return;

    var counter = document.querySelector("[data-deck-counter]");
    var kicker = document.querySelector("[data-deck-kicker]");
    var title = document.querySelector("[data-deck-title]");
    var summary = document.querySelector("[data-deck-summary]");
    var tags = document.querySelector("[data-deck-tags]");
    var status = document.querySelector("[data-deck-status]");
    var drag = null;
    var isAnimating = false;

    function getCards() {
      return Array.prototype.slice.call(deck.querySelectorAll(".feature-deck-card"));
    }

    getCards().forEach(function (card, index) {
      card.dataset.cardIndex = String(index + 1);
      card.querySelectorAll("img").forEach(function (image) { image.draggable = false; });
    });

    function stackTransform(depth) {
      var clampedDepth = Math.min(Math.max(depth, 0), 4);
      var lower = Math.floor(clampedDepth);
      var upper = Math.ceil(clampedDepth);
      var mix = clampedDepth - lower;
      var spread = Math.min(1, deck.clientWidth / 440);
      var xStops = [0, 36, -32, 50, -44];
      var yStops = [0, 10, 21, 33, 45];
      var zStops = [0, -46, -92, -138, -184];
      var scaleStops = [1, 0.96, 0.92, 0.88, 0.84];
      var rotationStops = [0, 4.4, -5.2, 7, -8];

      function between(stops) {
        return stops[lower] + (stops[upper] - stops[lower]) * mix;
      }

      return "translate3d(" + (between(xStops) * spread).toFixed(2) + "px, " + between(yStops).toFixed(2) + "px, " + between(zStops).toFixed(2) + "px) scale(" + between(scaleStops).toFixed(4) + ") rotateZ(" + between(rotationStops).toFixed(2) + "deg)";
    }

    function renderStack(progress, keepFrontTransform) {
      var cards = getCards();
      cards.forEach(function (card, index) {
        var effectiveDepth = Math.max(0, index - progress);
        card.style.zIndex = String(cards.length - index);
        card.style.pointerEvents = index === 0 ? "auto" : "none";
        card.setAttribute("aria-hidden", index === 0 ? "false" : "true");
        card.tabIndex = index === 0 ? 0 : -1;

        if (!(keepFrontTransform && index === 0)) {
          card.style.transform = stackTransform(effectiveDepth);
        }
        card.style.opacity = effectiveDepth < 4.15 ? String(Math.max(0.64, 1 - effectiveDepth * 0.09)) : "0";
      });
    }

    function animateInfo(elements) {
      if (reduceMotion) return;
      elements.forEach(function (element) {
        if (!element || !element.animate) return;
        element.animate(
          [
            { opacity: 0.35, transform: "translateY(6px)" },
            { opacity: 1, transform: "translateY(0)" }
          ],
          { duration: 220, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
        );
      });
    }

    function updateInfo() {
      var front = getCards()[0];
      if (!front) return;
      var number = String(front.dataset.cardIndex || "1").padStart(2, "0");
      var total = String(getCards().length).padStart(2, "0");
      if (counter) counter.textContent = number + " / " + total;
      if (kicker) kicker.textContent = front.dataset.kicker || (isEnglish ? "Capability" : "功能");
      if (title) title.textContent = front.dataset.title || "";
      if (summary) summary.textContent = front.dataset.summary || "";
      if (tags) {
        tags.replaceChildren();
        (front.dataset.tags || "").split("|").filter(Boolean).forEach(function (tag) {
          var chip = document.createElement("span");
          chip.textContent = tag;
          tags.appendChild(chip);
        });
      }
      if (status) {
        status.textContent = isEnglish
          ? "Showing capability " + Number(number) + ": " + (front.dataset.title || "")
          : "当前展示第 " + Number(number) + " 项能力：" + (front.dataset.title || "");
      }
      animateInfo([kicker, title, summary, tags]);
    }

    function cleanupFront(front) {
      if (!front) return;
      front.classList.remove("is-dragging");
      front.style.transform = "";
      front.style.opacity = "";
    }

    function completeDismiss(front) {
      cleanupFront(front);
      deck.appendChild(front);
      renderStack(0, false);
      updateInfo();
      isAnimating = false;
      drag = null;
    }

    function dismiss(direction, state) {
      if (isAnimating) return;
      var front = getCards()[0];
      if (!front) return;
      isAnimating = true;
      deck.classList.remove("is-dragging");
      front.classList.remove("is-dragging");

      if (reduceMotion || !front.animate) {
        completeDismiss(front);
        return;
      }

      var startX = state && state.x ? state.x : 0;
      var startY = state && state.y ? state.y : 0;
      var startRotation = state && state.rotation ? state.rotation : 0;
      var targetX = direction * (deck.clientWidth * 1.55 + 90);
      var targetY = startY + Math.min(Math.abs(startX) * 0.18, 72);
      var targetRotation = direction * 18;
      renderStack(1, true);

      var flight = front.animate(
        [
          { transform: "translate3d(" + startX + "px, " + startY + "px, 0) rotateZ(" + startRotation + "deg)", opacity: 1 },
          { transform: "translate3d(" + targetX + "px, " + targetY + "px, 0) rotateZ(" + targetRotation + "deg) rotateY(" + (-direction * 7) + "deg)", opacity: 0.18 }
        ],
        { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
      );

      flight.finished.then(function () {
        flight.cancel();
        completeDismiss(front);
      }).catch(function () {
        completeDismiss(front);
      });
    }

    function springBack(front, state) {
      if (!front) return;
      isAnimating = true;
      deck.classList.remove("is-dragging");
      front.classList.add("is-dragging");

      if (reduceMotion) {
        cleanupFront(front);
        renderStack(0, false);
        isAnimating = false;
        drag = null;
        return;
      }

      var positionX = state.x;
      var positionY = state.y;
      var velocityX = state.velocityX * 1000;
      var velocityY = state.velocityY * 1000;
      var stiffness = 100;
      var damping = 10;
      var lastTime = performance.now();

      function step(now) {
        var delta = Math.min((now - lastTime) / 1000, 0.032);
        lastTime = now;
        var accelerationX = -stiffness * positionX - damping * velocityX;
        var accelerationY = -stiffness * positionY - damping * velocityY;
        velocityX += accelerationX * delta;
        velocityY += accelerationY * delta;
        positionX += velocityX * delta;
        positionY += velocityY * delta;
        var rotation = Math.max(-12, Math.min(12, positionX / 18));
        var tilt = Math.max(-7, Math.min(7, -positionX / 45));
        front.style.transform = "translate3d(" + positionX.toFixed(2) + "px, " + positionY.toFixed(2) + "px, 0) rotateZ(" + rotation.toFixed(2) + "deg) rotateY(" + tilt.toFixed(2) + "deg)";
        renderStack(Math.min(Math.abs(positionX) / Math.max(deck.clientWidth * 0.24, 96), 1), true);

        if (Math.abs(positionX) < 0.45 && Math.abs(positionY) < 0.45 && Math.abs(velocityX) < 5 && Math.abs(velocityY) < 5) {
          cleanupFront(front);
          renderStack(0, false);
          isAnimating = false;
          drag = null;
          return;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    function finishDrag(event, cancelled) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      var state = drag;
      var front = state.front;
      var threshold = Math.max(deck.clientWidth * 0.24, 96);
      var shouldDismiss = !cancelled && state.horizontal && (
        Math.abs(state.x) >= threshold ||
        (Math.abs(state.velocityX) > 0.11 && Math.abs(state.x) > 32)
      );

      try { front.releasePointerCapture(event.pointerId); } catch {}
      if (shouldDismiss) dismiss(state.x >= 0 ? 1 : -1, state);
      else springBack(front, state);
    }

    deck.addEventListener("pointerdown", function (event) {
      if (isAnimating || drag || (event.button !== undefined && event.button !== 0)) return;
      var front = getCards()[0];
      if (!front || !front.contains(event.target)) return;
      drag = {
        pointerId: event.pointerId,
        front: front,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        x: 0,
        y: 0,
        velocityX: 0,
        velocityY: 0,
        rotation: 0,
        horizontal: null
      };
      try { front.setPointerCapture(event.pointerId); } catch {}
    });

    deck.addEventListener("pointermove", function (event) {
      if (!drag || event.pointerId !== drag.pointerId || isAnimating) return;
      var rawX = event.clientX - drag.startX;
      var rawY = event.clientY - drag.startY;
      if (drag.horizontal === null && Math.hypot(rawX, rawY) > 7) {
        drag.horizontal = Math.abs(rawX) > Math.abs(rawY);
      }
      if (drag.horizontal !== true) return;
      event.preventDefault();

      var elapsed = Math.max(event.timeStamp - drag.lastTime, 1);
      drag.velocityX = (event.clientX - drag.lastX) / elapsed;
      drag.velocityY = (event.clientY - drag.lastY) / elapsed;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.lastTime = event.timeStamp;
      drag.x = rawX;
      drag.y = rawY * 0.45;
      drag.rotation = Math.max(-12, Math.min(12, rawX / 18));
      var tilt = Math.max(-7, Math.min(7, -rawX / 45));
      var threshold = Math.max(deck.clientWidth * 0.24, 96);
      var progress = Math.min(Math.abs(rawX) / threshold, 1);

      deck.classList.add("is-dragging");
      drag.front.classList.add("is-dragging");
      drag.front.style.transform = "translate3d(" + drag.x.toFixed(2) + "px, " + drag.y.toFixed(2) + "px, 0) rotateZ(" + drag.rotation.toFixed(2) + "deg) rotateY(" + tilt.toFixed(2) + "deg)";
      renderStack(progress, true);
    });

    deck.addEventListener("pointerup", function (event) { finishDrag(event, false); });
    deck.addEventListener("pointercancel", function (event) { finishDrag(event, true); });

    deck.addEventListener("keydown", function (event) {
      if (isAnimating) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        dismiss(event.key === "ArrowLeft" ? -1 : 1, { x: 0, y: 0, rotation: 0 });
      }
    });

    renderStack(0, false);
    updateInfo();
  }

  initializeFeatureDeck();

  function initializeProductDemo() {
    var demo = document.querySelector("[data-product-demo]");
    var rail = document.querySelector(".product-proof-rail[role='tablist']");
    if (!demo || !rail) return;

    var stage = demo.closest("[data-product-tour]");
    var productWindow = demo.closest("[data-product-window]");
    var panels = Array.prototype.slice.call(demo.querySelectorAll("[data-product-panel]"));
    var tabs = Array.prototype.slice.call(rail.querySelectorAll("[data-product-scene]"));
    var hotspots = Array.prototype.slice.call(demo.querySelectorAll("[data-product-target]"));
    var bar = document.querySelector("[data-product-bar]");
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    var desktopQuery = window.matchMedia("(min-width: 961px)");
    var scenes = tabs.map(function (tab) { return tab.dataset.productScene; });
    var currentIndex = Math.max(0, scenes.indexOf("edit"));
    var enabled = false;
    var frameRequested = false;
    var targetProgress = 0;
    var renderedProgress = 0;
    var switchTimer = 0;
    var lockedSceneIndex = -1;
    var lockTimer = 0;

    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
    }

    function mix(start, end, progress) {
      return start + (end - start) * progress;
    }

    function easeOut(progress) {
      return 1 - Math.pow(1 - clamp(progress, 0, 1), 3);
    }

    function playSceneTransition(previousPanel, nextPanel, direction) {
      if (!enabled || motionQuery.matches || !previousPanel || previousPanel === nextPanel || !("animate" in nextPanel)) return;
      panels.forEach(function (panel) {
        panel.getAnimations().forEach(function (animation) { animation.cancel(); });
      });

      var travel = direction >= 0 ? 1 : -1;
      previousPanel.animate([
        { opacity: 1, transform: "translate3d(0,0,0)" },
        { opacity: 0, transform: "translate3d(" + (-travel * 26) + "px,0,0)" }
      ], { duration: 260, easing: "cubic-bezier(.4,0,1,1)", fill: "both" });

      var incoming = nextPanel.animate([
        { opacity: 0, transform: "translate3d(" + (travel * 34) + "px,0,0)" },
        { opacity: 1, transform: "translate3d(0,0,0)" }
      ], { duration: 420, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" });

      incoming.finished.then(function () {
        panels.forEach(function (panel) {
          panel.getAnimations().forEach(function (animation) { animation.cancel(); });
        });
      }).catch(function () {});

      if (productWindow) {
        productWindow.classList.add("is-switching");
        window.clearTimeout(switchTimer);
        switchTimer = window.setTimeout(function () { productWindow.classList.remove("is-switching"); }, 440);
      }
    }

    function activate(scene, shouldFocus, direction) {
      var nextTab = tabs.find(function (tab) { return tab.dataset.productScene === scene; });
      var nextPanel = panels.find(function (panel) { return panel.dataset.productPanel === scene; });
      if (!nextTab || !nextPanel) return;
      var nextIndex = scenes.indexOf(scene);
      var previousPanel = panels[currentIndex];
      if (nextIndex === currentIndex) {
        if (shouldFocus) nextTab.focus({ preventScroll: true });
        return;
      }

      panels.forEach(function (panel) {
        var isActive = panel === nextPanel;
        panel.classList.toggle("is-active", isActive);
        panel.setAttribute("aria-hidden", String(!isActive));
        panel.toggleAttribute("inert", !isActive);
      });

      tabs.forEach(function (tab) {
        var isActive = tab === nextTab;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      });

      if (bar) bar.textContent = nextTab.dataset.productLabel || "Mora Studio";
      playSceneTransition(previousPanel, nextPanel, direction || nextIndex - currentIndex);
      currentIndex = nextIndex;
      if (shouldFocus) nextTab.focus({ preventScroll: true });
    }

    function sceneForProgress(progress) {
      return Math.min(scenes.length - 1, Math.floor(clamp(progress, 0, .9999) * scenes.length));
    }

    function measureProgress() {
      if (!enabled || !stage) return;
      var rect = stage.getBoundingClientRect();
      var stickyTop = 78;
      var travel = Math.max(rect.height - window.innerHeight + stickyTop, 1);
      targetProgress = clamp((stickyTop - rect.top) / travel, 0, 1);
    }

    function render() {
      frameRequested = false;
      if (!enabled || !stage || !productWindow) return;
      renderedProgress += (targetProgress - renderedProgress) * .16;
      if (Math.abs(targetProgress - renderedProgress) < .0008) renderedProgress = targetProgress;

      var entry = easeOut(renderedProgress / .16);
      var exit = easeOut((renderedProgress - .9) / .1);
      var translateY = mix(42, 0, entry) + mix(0, -16, exit);
      var rotateX = mix(7, 0, entry);
      if (entry > .999 && exit < .001) productWindow.style.transform = "";
      else productWindow.style.transform = "translate3d(0," + translateY.toFixed(2) + "px,0) rotateX(" + rotateX.toFixed(2) + "deg)";
      rail.style.setProperty("--product-progress", (renderedProgress * 100).toFixed(2) + "%");

      var nextIndex = lockedSceneIndex >= 0 ? lockedSceneIndex : sceneForProgress(renderedProgress);
      if (nextIndex !== currentIndex) activate(scenes[nextIndex], false, nextIndex - currentIndex);
      if (renderedProgress !== targetProgress) requestRender();
    }

    function requestRender() {
      if (!enabled || frameRequested) return;
      frameRequested = true;
      window.requestAnimationFrame(render);
    }

    function handleScroll() {
      if (!enabled) return;
      measureProgress();
      requestRender();
    }

    function progressForScene(index) {
      if (scenes.length <= 1) return .5;
      return .18 + index * (.72 / (scenes.length - 1));
    }

    function navigateToScene(scene, shouldFocus) {
      var index = scenes.indexOf(scene);
      if (index < 0) return;
      lockedSceneIndex = index;
      window.clearTimeout(lockTimer);
      lockTimer = window.setTimeout(function () {
        lockedSceneIndex = -1;
        handleScroll();
      }, 1050);
      activate(scene, shouldFocus, index - currentIndex);
      if (!enabled || !stage) return;
      var stageTop = window.scrollY + stage.getBoundingClientRect().top;
      var stickyTop = 78;
      var travel = Math.max(stage.offsetHeight - window.innerHeight + stickyTop, 1);
      window.scrollTo({
        top: stageTop - stickyTop + progressForScene(index) * travel,
        behavior: motionQuery.matches ? "auto" : "smooth"
      });
    }

    function syncMode() {
      var nextEnabled = Boolean(stage) && desktopQuery.matches && !motionQuery.matches && CSS.supports("transform-style", "preserve-3d");
      enabled = nextEnabled;
      if (stage) stage.classList.toggle("is-enhanced", enabled);
      if (enabled) {
        measureProgress();
        renderedProgress = targetProgress;
        requestRender();
      }
      else {
        if (productWindow) productWindow.style.transform = "";
        rail.style.removeProperty("--product-progress");
      }
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { navigateToScene(tab.dataset.productScene, false); });
    });

    hotspots.forEach(function (hotspot) {
      hotspot.addEventListener("click", function () { navigateToScene(hotspot.dataset.productTarget, true); });
    });

    rail.addEventListener("keydown", function (event) {
      var activeIndex = tabs.findIndex(function (tab) { return tab.getAttribute("aria-selected") === "true"; });
      var nextIndex = activeIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (activeIndex + 1) % tabs.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      navigateToScene(tabs[nextIndex].dataset.productScene, true);
    });

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncMode, { passive: true });
    if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", syncMode);
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncMode);
    syncMode();
  }

  initializeProductDemo();

  function initializeWorkflowStack() {
    var section = document.querySelector("[data-workflow-stack]");
    if (!section) return;

    var cardsWrap = section.querySelector("[data-workflow-cards]");
    var semanticCards = cardsWrap ? Array.prototype.slice.call(cardsWrap.querySelectorAll(".workflow-card")) : [];
    if (!semanticCards.length) return;

    var intro = section.querySelector("[data-workflow-intro]");
    var copy = section.querySelector(".workflow-stack-copy");
    var counter = section.querySelector("[data-workflow-counter]");
    var kicker = section.querySelector("[data-workflow-kicker]");
    var title = section.querySelector("[data-workflow-title]");
    var summary = section.querySelector("[data-workflow-summary]");
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    var desktopQuery = window.matchMedia("(min-width: 961px)");
    var activeIndex = -1;
    var enabled = false;
    var frameRequested = false;
    var targetProgress = 0;
    var renderedProgress = 0;
    var visualCards = semanticCards.slice();
    var commerceVisuals = [
      "194",
      "264",
      "313",
      "358",
      "368",
      "373",
      "424",
      "438",
      "459",
      "462",
      "475",
      "519"
    ];

    function clamp(value, minimum, maximum) {
      return Math.max(minimum, Math.min(maximum, value));
    }

    function mix(start, end, progress) {
      return start + (end - start) * progress;
    }

    function ensureVisualStack() {
      if (cardsWrap.querySelector("[data-workflow-clone]")) {
        visualCards = Array.prototype.slice.call(cardsWrap.querySelectorAll(".workflow-card"));
        return;
      }

      var fragment = document.createDocumentFragment();
      for (var cycle = 0; cycle < 2; cycle += 1) {
        semanticCards.forEach(function (card, semanticIndex) {
          var clone = card.cloneNode(true);
          var visualIndex = cycle * semanticCards.length + semanticIndex;
          var visualCase = commerceVisuals[visualIndex];
          var image = clone.querySelector("img");
          clone.dataset.workflowClone = "true";
          clone.dataset.sourceCase = visualCase;
          clone.setAttribute("aria-hidden", "true");
          clone.removeAttribute("data-kicker");
          clone.removeAttribute("data-title");
          clone.removeAttribute("data-summary");
          if (image) {
            image.src = "assets/gpt-image2/case" + visualCase + ".jpg";
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
          }
          fragment.appendChild(clone);
        });
      }
      cardsWrap.appendChild(fragment);
      visualCards = Array.prototype.slice.call(cardsWrap.querySelectorAll(".workflow-card"));
    }

    function removeVisualClones() {
      Array.prototype.slice.call(cardsWrap.querySelectorAll("[data-workflow-clone]")).forEach(function (clone) {
        clone.remove();
      });
      visualCards = semanticCards.slice();
    }

    function updateCopy(index) {
      if (index === activeIndex) return;
      activeIndex = index;
      var card = semanticCards[index];
      var number = String(index + 1).padStart(2, "0");
      var total = String(semanticCards.length).padStart(2, "0");
      if (counter) counter.textContent = number + " / " + total;
      if (kicker) kicker.textContent = card.dataset.kicker || (isEnglish ? "Workflow" : "工作流");
      if (title) title.textContent = card.dataset.title || "";
      if (summary) summary.textContent = card.dataset.summary || "";

      semanticCards.forEach(function (item, cardIndex) {
        item.classList.toggle("is-active", cardIndex === index);
      });

      if (motionQuery.matches) return;
      [kicker, title, summary].forEach(function (element) {
        if (!element || !element.animate) return;
        element.animate(
          [
            { opacity: 0.38, transform: "translateY(7px)" },
            { opacity: 1, transform: "translateY(0)" }
          ],
          { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }
        );
      });
    }

    function clearTransforms() {
      visualCards.forEach(function (card) {
        card.style.removeProperty("transform");
        card.style.removeProperty("opacity");
        card.style.removeProperty("z-index");
        card.classList.remove("is-active");
      });
      cardsWrap.style.removeProperty("opacity");
      if (intro) {
        intro.style.removeProperty("opacity");
        intro.style.removeProperty("transform");
        intro.style.removeProperty("pointer-events");
      }
      if (copy) {
        copy.style.removeProperty("opacity");
        copy.style.removeProperty("transform");
      }
      removeVisualClones();
      activeIndex = -1;
      updateCopy(0);
    }

    function measureProgress() {
      var rect = section.getBoundingClientRect();
      var stickyOffset = 66;
      var travel = Math.max(rect.height - (window.innerHeight - stickyOffset), 1);
      targetProgress = clamp((stickyOffset - rect.top) / travel, 0, 1);
    }

    function renderAt(progress) {
      var introProgress = clamp((progress - 0.1) / 0.1, 0, 1);
      var motionProgress = clamp((progress - 0.18) / 0.78, 0, 1);
      var entranceOpacity = clamp(motionProgress / 0.06, 0, 1);
      var exitOpacity = clamp((1 - motionProgress) / 0.08, 0, 1);
      var stackOpacity = entranceOpacity * exitOpacity;
      var copyProgress = clamp((motionProgress - 0.1) / 0.08, 0, 1);
      var activePosition = motionProgress * (semanticCards.length - 1);
      var nearestIndex = clamp(Math.round(activePosition), 0, semanticCards.length - 1);
      var width = Math.max(window.innerWidth, 960);
      var height = Math.max(window.innerHeight - 66, 620);
      var total = visualCards.length;
      var stagger = 0.38 / Math.max(total - 1, 1);
      var cardTravel = 0.62;

      if (intro) {
        intro.style.opacity = (1 - introProgress).toFixed(3);
        intro.style.transform = "translate3d(-50%, calc(-50% - " + (introProgress * 28).toFixed(2) + "px), 0) scale(" + (1 - introProgress * 0.025).toFixed(4) + ")";
        intro.style.pointerEvents = introProgress < 0.8 ? "auto" : "none";
      }
      if (copy) {
        copy.style.opacity = (copyProgress * exitOpacity).toFixed(3);
        copy.style.transform = "translate3d(0, " + ((1 - copyProgress) * 18).toFixed(2) + "px, 0)";
      }

      visualCards.forEach(function (card, index) {
        var rawCardProgress = (motionProgress - index * stagger) / cardTravel;
        var cardProgress = clamp(rawCardProgress, 0, 1);
        var arc = Math.sin(cardProgress * Math.PI);
        var x = mix(-0.56 * width, 0.6 * width, cardProgress);
        var y = mix(0.15 * height, 0.12 * height, cardProgress) - arc * 0.3 * height;
        var z = -780 + arc * 820;
        var rotateZ = mix(-68, 34, cardProgress);
        var rotateY = mix(32, -22, cardProgress);
        var cardEntrance = clamp(rawCardProgress / 0.06, 0, 1);
        var cardExit = clamp((1 - rawCardProgress) / 0.08, 0, 1);
        var opacity = cardEntrance * cardExit * stackOpacity;

        card.style.transform = "translate3d(calc(-50% + " + x.toFixed(2) + "px), calc(-50% + " + y.toFixed(2) + "px), " + z.toFixed(2) + "px) rotateY(" + rotateY.toFixed(2) + "deg) rotateZ(" + rotateZ.toFixed(2) + "deg)";
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = String(Math.round(arc * 1000) + index);
      });

      cardsWrap.style.opacity = stackOpacity.toFixed(3);
      updateCopy(nearestIndex);
    }

    function render() {
      frameRequested = false;
      if (!enabled) return;

      renderedProgress += (targetProgress - renderedProgress) * 0.2;
      if (Math.abs(targetProgress - renderedProgress) < 0.0005) {
        renderedProgress = targetProgress;
      }
      renderAt(renderedProgress);

      if (renderedProgress !== targetProgress) requestRender();
    }

    function requestRender() {
      if (!enabled || frameRequested) return;
      frameRequested = true;
      window.requestAnimationFrame(render);
    }

    function handleScroll() {
      if (!enabled) return;
      measureProgress();
      requestRender();
    }

    function syncMode() {
      var nextEnabled = desktopQuery.matches && !motionQuery.matches && CSS.supports("transform-style", "preserve-3d");
      if (nextEnabled === enabled) {
        if (enabled) {
          measureProgress();
          requestRender();
        }
        return;
      }

      enabled = nextEnabled;
      section.classList.toggle("is-enhanced", enabled);
      if (enabled) {
        ensureVisualStack();
        measureProgress();
        renderedProgress = targetProgress;
        requestRender();
      }
      else clearTransforms();
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncMode, { passive: true });
    if (desktopQuery.addEventListener) desktopQuery.addEventListener("change", syncMode);
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", syncMode);
    syncMode();
  }

  initializeWorkflowStack();

  if (reduceMotion || !("IntersectionObserver" in window)) return;

  document.documentElement.classList.add("motion-ready");
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });

  document.querySelectorAll(".reveal, .stagger, .compare-motion").forEach(function (element) {
    observer.observe(element);
  });
})();

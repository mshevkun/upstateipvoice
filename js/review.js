(function () {
  const API = "https://book.upstateipvoice.com";
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const MAX_DAYS = 60;
  const SLOTS = [];
  for (let minutes = 360; minutes <= 1290; minutes += 30) {
    SLOTS.push(
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
    );
  }

  const form = document.querySelector(".pr-book-card");
  const contactBlocks = document.querySelectorAll(".pr-book-contact");
  const prefill = document.querySelector(".pr-prefill");
  const calMonth = document.querySelector(".pr-cal__month");
  const calGrid = document.querySelector("[data-cal-grid]");
  const prevBtn = document.querySelector('[aria-label="Previous month"]');
  const nextBtn = document.querySelector('[aria-label="Next month"]');
  const timeWrap = document.querySelector(".pr-time");
  const timeTrigger = document.querySelector(".pr-time__trigger");
  const timeValue = document.querySelector(".pr-time__value");
  const timePop = document.querySelector(".pr-time__pop");
  const timeMeta = document.querySelector(".pr-time__meta");
  const timeList = document.querySelector(".pr-time__list");
  const whenEl = document.querySelector(".pr-summary__when");
  const confirmBtn = document.querySelector(".pr-confirm__btn");
  const errorEl = document.querySelector(".public-review__error");
  const doneCard = document.querySelector(".public-review__done-card");
  const doneText = document.querySelector(".public-review__done-text");
  const doneSub = document.querySelector(".public-review__done-sub");
  const doneMeet = document.querySelector(".public-review__done-meet");
  const loadingEl = document.querySelector(".public-review__loading");
  const page = document.querySelector(".public-review");

  const fields = {
    business_name: form.querySelector('[name="business_name"]'),
    contact_name: form.querySelector('[name="contact_name"]'),
    email: form.querySelector('[name="email"]'),
    phone: form.querySelector('[name="phone"]'),
  };

  const state = {
    token: readToken(),
    lead: null,
    meetingDate: "",
    meetingTime: "11:00",
    busySlots: [],
    loadingTimes: false,
    submitting: false,
    showNeeded: false,
    view: { y: 0, m: 0 },
  };

  const minDate = startOfDay(addDays(new Date(), 1));
  const maxDate = startOfDay(addDays(new Date(), MAX_DAYS));
  state.view = { y: minDate.getFullYear(), m: minDate.getMonth() };

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(date) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    return next;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function toKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatTime(value) {
    const [hours, minutes] = value.split(":").map(Number);
    const am = hours < 12;
    return `${hours % 12 || 12}:${pad(minutes)} ${am ? "AM" : "PM"}`;
  }

  function formatDate(value) {
    if (!value) return "";
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  function readToken() {
    const params = new URLSearchParams(location.search);
    if (params.get("token")) return params.get("token");
    const parts = location.pathname.replace(/\/+$/, "").split("/");
    const last = parts[parts.length - 1];
    if (last && last !== "review" && last !== "index.html") return last;
    return "";
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.json !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
    const data = await res.json().catch(() => (res.ok ? {} : { message: res.statusText }));
    if (!res.ok) {
      const err = new Error(data.message || "Request failed");
      if (Array.isArray(data.errors)) err.errors = data.errors;
      throw err;
    }
    return data;
  }

  function contactValid() {
    if (state.lead) return true;
    return (
      fields.business_name.value.trim() !== "" &&
      fields.contact_name.value.trim() !== "" &&
      EMAIL_RE.test(fields.email.value.trim())
    );
  }

  function slotValid() {
    return Boolean(state.meetingDate && state.meetingTime) && !state.busySlots.includes(state.meetingTime);
  }

  function canConfirm() {
    return contactValid() && slotValid() && !state.submitting;
  }

  function setError(message) {
    if (!message) {
      errorEl.classList.add("is-hidden");
      errorEl.textContent = "";
      return;
    }
    errorEl.textContent = message;
    errorEl.classList.remove("is-hidden");
  }

  function markNeeded() {
    ["business_name", "contact_name", "email"].forEach((key) => {
      const wrap = fields[key].closest(".pr-field");
      const invalid = key === "email" ? !EMAIL_RE.test(fields[key].value.trim()) : fields[key].value.trim() === "";
      wrap.classList.toggle("is-needed", state.showNeeded && invalid);
    });
  }

  function renderCalendar() {
    calMonth.textContent = `${MONTHS[state.view.m]} ${state.view.y}`;
    const first = new Date(state.view.y, state.view.m, 1);
    const last = new Date(state.view.y, state.view.m + 1, 0);
    prevBtn.disabled = first.getTime() <= minDate.getTime();
    nextBtn.disabled = last.getTime() >= maxDate.getTime();

    const cells = [];
    for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
    for (let day = 1; day <= last.getDate(); day += 1) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);

    calGrid.replaceChildren(
      ...cells.map((day, index) => {
        if (day === null) {
          const empty = document.createElement("span");
          empty.className = "pr-cal__cell is-empty";
          empty.dataset.empty = String(index);
          return empty;
        }
        const date = new Date(state.view.y, state.view.m, day);
        const key = toKey(date);
        const blocked =
          date.getDay() === 0 ||
          date.getDay() === 6 ||
          date.getTime() < minDate.getTime() ||
          date.getTime() > maxDate.getTime();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `pr-cal__cell${key === state.meetingDate ? " is-selected" : ""}`;
        btn.disabled = blocked;
        btn.setAttribute("aria-pressed", key === state.meetingDate ? "true" : "false");
        btn.textContent = String(day);
        btn.addEventListener("click", () => selectDate(key));
        return btn;
      })
    );
  }

  function renderTime() {
    const disabled = !state.meetingDate;
    timeWrap.classList.toggle("is-disabled", disabled);
    timeWrap.classList.toggle("has-value", Boolean(state.meetingDate && state.meetingTime));
    timeTrigger.disabled = disabled;
    timeValue.textContent = disabled
      ? "Time (Pick date first)"
      : state.meetingTime
        ? `${formatTime(state.meetingTime)} ET`
        : "Select a time";

    const open = timeCount();
    timeMeta.textContent = state.loadingTimes
      ? "Checking live availability…"
      : open
        ? `${open} time${open === 1 ? "" : "s"} available`
        : "No times available — try another day";

    timeList.replaceChildren(
      ...SLOTS.map((slot) => {
        const busy = state.busySlots.includes(slot);
        const selected = state.meetingTime === slot;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.role = "option";
        btn.setAttribute("aria-selected", selected ? "true" : "false");
        btn.className = `pr-time__opt${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}`;
        btn.disabled = busy;
        const label = document.createElement("span");
        label.textContent = formatTime(slot);
        btn.append(label);
        if (busy) {
          const tag = document.createElement("span");
          tag.className = "pr-time__tag";
          tag.textContent = "Booked";
          btn.append(tag);
        } else if (selected) {
          const tick = document.createElement("span");
          tick.className = "pr-time__tick";
          tick.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
          btn.append(tick);
        }
        btn.addEventListener("click", () => {
          state.meetingTime = slot;
          closeTime();
          render();
        });
        return btn;
      })
    );
  }

  function timeCount() {
    return SLOTS.filter((slot) => !state.busySlots.includes(slot)).length;
  }

  function renderSummary() {
    if (state.meetingDate) {
      whenEl.textContent = `${formatDate(state.meetingDate)} · ${formatTime(state.meetingTime)} ET`;
      whenEl.classList.remove("is-hidden");
    } else {
      whenEl.classList.add("is-hidden");
    }
  }

  function render() {
    markNeeded();
    renderCalendar();
    renderTime();
    renderSummary();
    confirmBtn.disabled = !canConfirm();
    confirmBtn.textContent = state.submitting ? "Scheduling…" : "Confirm meeting";
  }

  function shiftMonth(delta) {
    const next = new Date(state.view.y, state.view.m + delta, 1);
    state.view = { y: next.getFullYear(), m: next.getMonth() };
    renderCalendar();
  }

  async function selectDate(key) {
    state.meetingDate = key;
    closeTime();
    render();
    await loadAvailability();
  }

  async function loadAvailability() {
    if (!state.meetingDate) {
      state.busySlots = [];
      render();
      return;
    }
    state.loadingTimes = true;
    renderTime();
    try {
      const data = await api(`/api/public/review/availability?date=${state.meetingDate}`);
      state.busySlots = data.busySlots || [];
    } catch {
      state.busySlots = [];
    } finally {
      state.loadingTimes = false;
      if (state.busySlots.includes(state.meetingTime)) {
        const next = SLOTS.find((slot) => !state.busySlots.includes(slot));
        if (next) state.meetingTime = next;
      }
      render();
    }
  }

  function openTime() {
    if (!state.meetingDate) return;
    timeTrigger.classList.add("is-open");
    timeTrigger.setAttribute("aria-expanded", "true");
    timePop.classList.remove("is-hidden");
  }

  function closeTime() {
    timeTrigger.classList.remove("is-open");
    timeTrigger.setAttribute("aria-expanded", "false");
    timePop.classList.add("is-hidden");
  }

  function showDone({ meetingSlotLabel, googleMeetLink, email }) {
    form.classList.add("is-hidden");
    doneCard.classList.remove("is-hidden");
    doneText.innerHTML = meetingSlotLabel
      ? `Your call is scheduled for<br><strong>${meetingSlotLabel}</strong>.`
      : "Your meeting request has been received.";
    if (email) {
      doneSub.innerHTML = `A calendar invite with the meeting link is on its way to<br><strong>${email}</strong>.`;
      doneSub.classList.remove("is-hidden");
    } else {
      doneSub.classList.add("is-hidden");
    }
    if (googleMeetLink) {
      doneMeet.href = googleMeetLink;
      doneMeet.classList.remove("is-hidden");
    } else {
      doneMeet.classList.add("is-hidden");
    }
  }

  function syncFieldLabels() {
    Object.values(fields).forEach((input) => {
      const wrap = input.closest(".pr-field");
      if (!wrap) return;
      wrap.classList.toggle("has-value", input.value.trim() !== "");
    });
  }

  function applyLead(lead) {
    state.lead = lead;
    contactBlocks.forEach((block) => block.classList.add("is-hidden"));
    prefill.classList.remove("is-hidden");
    prefill.querySelector("strong").textContent = lead.businessName || "";
    prefill.querySelector("[data-prefill-meta]").textContent = [lead.contactName, lead.email].filter(Boolean).join(" · ");
  }

  async function boot() {
    if (!state.token) {
      loadingEl.classList.add("is-hidden");
      page.classList.remove("is-hidden");
      render();
      return;
    }
    try {
      const data = await api(`/api/public/review/${state.token}`);
      if (data.submitted) {
        loadingEl.classList.add("is-hidden");
        page.classList.remove("is-hidden");
        showDone({
          meetingSlotLabel: data.meetingSlotLabel || "",
          googleMeetLink: data.googleMeetLink || "",
          email: data.email || "",
        });
        return;
      }
      if (data.businessName || data.contactName || data.email) {
        applyLead({
          businessName: data.businessName,
          contactName: data.contactName,
          email: data.email,
        });
      }
      if (data.token) state.token = data.token;
    } catch (err) {
      setError(err.message || "Link not found");
    } finally {
      loadingEl.classList.add("is-hidden");
      page.classList.remove("is-hidden");
      render();
    }
  }

  prevBtn.addEventListener("click", () => shiftMonth(-1));
  nextBtn.addEventListener("click", () => shiftMonth(1));
  timeTrigger.addEventListener("click", () => {
    if (timeTrigger.disabled) return;
    if (timePop.classList.contains("is-hidden")) openTime();
    else closeTime();
  });
  document.addEventListener("mousedown", (event) => {
    if (!timeWrap.contains(event.target)) closeTime();
  });
  Object.values(fields).forEach((input) => {
    input.addEventListener("input", () => {
      setError("");
      syncFieldLabels();
      render();
    });
    input.addEventListener("change", syncFieldLabels);
    input.addEventListener("blur", syncFieldLabels);
    input.addEventListener("animationstart", (event) => {
      if (event.animationName === "pr-autofill-start") syncFieldLabels();
    });
  });

  // Browser autofill can fill sibling fields without firing input.
  let autofillWatch = null;
  form.addEventListener("focusin", (event) => {
    if (!event.target.classList.contains("pr-input")) return;
    syncFieldLabels();
    let ticks = 0;
    clearInterval(autofillWatch);
    autofillWatch = setInterval(() => {
      syncFieldLabels();
      ticks += 1;
      if (ticks >= 20) clearInterval(autofillWatch);
    }, 100);
  });
  syncFieldLabels();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.submitting) return;
    if (!slotValid()) return;
    if (!contactValid()) {
      state.showNeeded = true;
      render();
      return;
    }
    state.submitting = true;
    setError("");
    render();
    try {
      const payload = {
        meeting_date: state.meetingDate,
        meeting_time: state.meetingTime,
      };
      if (!state.lead) {
        payload.business_name = fields.business_name.value;
        payload.contact_name = fields.contact_name.value;
        payload.email = fields.email.value;
        payload.phone = fields.phone.value;
      }
      const path = state.token
        ? `/api/public/review/${state.token}/submit`
        : "/api/public/review/submit";
      const result = await api(path, { method: "POST", json: payload });
      showDone({
        meetingSlotLabel: result.meetingSlotLabel || "",
        googleMeetLink: result.googleMeetLink || "",
        email: result.email || (state.lead && state.lead.email) || fields.email.value,
      });
    } catch (err) {
      if (Array.isArray(err.errors) && err.errors.length) {
        err.errors.forEach((item) => {
          const field = fields[item.field];
          if (!field) return;
          const wrap = field.closest(".pr-field");
          wrap.classList.add("is-needed");
          let msg = wrap.querySelector(".pr-field__err");
          if (!msg) {
            msg = document.createElement("span");
            msg.className = "pr-field__err";
            wrap.append(msg);
          }
          msg.textContent = item.message;
        });
        if (err.errors.some((item) => ["business_name", "contact_name", "email"].includes(item.field))) {
          state.showNeeded = true;
        }
      }
      setError(err.message || "Submission failed");
    } finally {
      state.submitting = false;
      render();
    }
  });

  boot();
})();

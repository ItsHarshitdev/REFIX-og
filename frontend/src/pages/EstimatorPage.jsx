import { useEffect, useMemo, useState } from "react";
import * as api from "../api/api";
import TopBar from "../components/TopBar";
import NavBar from "../components/NavBar";
import Toast from "../components/Toast";
import DeviceStep from "../components/DeviceStep";
import ProblemsStep from "../components/ProblemsStep";
import QuestionsStep from "../components/QuestionsStep";
import ResultStep from "../components/ResultStep";

const STEP_INDEX = { device: 1, problems: 2, questions: 3, result: 4 };

function initialState() {
  return {
    step: "device",
    search: "",
    brandFilter: "",
    selectedDevice: null,
    selectedProblems: [],
    problemIndex: 0,
    answers: {},
    region: "",
  };
}

export default function EstimatorPage() {
  // --- catalog data (devices + repairs), loaded once ---
  const [devices, setDevices] = useState([]);
  const [brands, setBrands] = useState([]);
  const [repairsCatalog, setRepairsCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);

  // --- flow state ---
  const [state, setState] = useState(initialState);

  // --- result step state ---
  const [estimate, setEstimate] = useState(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState(null);
  const [deviceValueInput, setDeviceValueInput] = useState("");
  const [debouncedDeviceValue, setDebouncedDeviceValue] = useState("");

  // --- toast ---
  const [toast, setToast] = useState({ show: false, message: "" });

  function showToast(message) {
    setToast({ show: true, message });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast({ show: false, message: "" }), 1800);
  }

  async function loadCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const [deviceList, brandList, repairList] = await Promise.all([
        api.getDevices(),
        api.getBrands(),
        api.getRepairs(),
      ]);
      setDevices(deviceList);
      setBrands(brandList);
      setRepairsCatalog(repairList);
    } catch (err) {
      setCatalogError(err.message || "We couldn't load the estimator right now. Please try again.");
    } finally {
      setCatalogLoading(false);
    }
  }

  useEffect(() => {
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce the device-value input so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedDeviceValue(deviceValueInput), 500);
    return () => window.clearTimeout(t);
  }, [deviceValueInput]);

  async function fetchEstimate() {
    if (!state.selectedDevice || state.selectedProblems.length === 0) return;
    setResultLoading(true);
    setResultError(null);
    try {
      const payload = {
        device_id: state.selectedDevice.id,
        repair_ids: state.selectedProblems,
        answers: state.answers,
        region: state.region,
      };
      const parsedValue = parseInt(debouncedDeviceValue, 10);
      if (!Number.isNaN(parsedValue) && debouncedDeviceValue !== "") {
        payload.device_value_override = parsedValue;
      }
      const response = await api.calculateEstimate(payload);
      setEstimate(response);
      if (deviceValueInput === "" && response.device_value_estimate) {
        setDeviceValueInput(String(response.device_value_estimate));
      }
    } catch (err) {
      setResultError(err.message || "We couldn't calculate your estimate right now. Please try again.");
    } finally {
      setResultLoading(false);
    }
  }

  // Fetch (or re-fetch) the estimate whenever we're on the result step and
  // the region or device value override changes.
  useEffect(() => {
    if (state.step !== "result") return;
    fetchEstimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.region, debouncedDeviceValue]);

  function resetAll() {
    setState(initialState());
    setEstimate(null);
    setResultError(null);
    setDeviceValueInput("");
    setDebouncedDeviceValue("");
    window.scrollTo(0, 0);
  }

  function goTo(step) {
    setState((s) => ({ ...s, step }));
    window.scrollTo(0, 0);
  }

  // ---- Step 1: device ----
  function handleSelectDevice(device) {
    setState((s) => ({ ...s, selectedDevice: device }));
  }

  // ---- Step 2: problems ----
  function handleToggleProblem(repairId) {
    setState((s) => {
      const has = s.selectedProblems.includes(repairId);
      return {
        ...s,
        selectedProblems: has ? s.selectedProblems.filter((k) => k !== repairId) : [...s.selectedProblems, repairId],
      };
    });
  }

  // ---- Step 3: dynamic questions ----
  const currentRepair = useMemo(() => {
    const key = state.selectedProblems[state.problemIndex];
    return repairsCatalog.find((r) => r.id === key) || null;
  }, [repairsCatalog, state.selectedProblems, state.problemIndex]);

  function handleAnswer(repairId, questionKey, value) {
    setState((s) => ({
      ...s,
      answers: {
        ...s.answers,
        [repairId]: { ...(s.answers[repairId] || {}), [questionKey]: value },
      },
    }));
  }

  const currentQuestionsAnswered = useMemo(() => {
    if (!currentRepair) return false;
    const answered = state.answers[currentRepair.id] || {};
    return currentRepair.questions.every((q) => answered[q.key] !== undefined);
  }, [currentRepair, state.answers]);

  // ---- Result actions ----
  function handleShare() {
    if (!estimate) return;
    const summary = `${estimate.device} — ${estimate.repairs.join(", ")}\nEstimated repair cost: ₹${estimate.minimum.toLocaleString(
      "en-IN"
    )}–₹${estimate.maximum.toLocaleString("en-IN")}\nEstimated time: ${estimate.repair_time}\n(via ReFix — estimate only, not a guaranteed quote)`;

    if (navigator.share) {
      navigator.share({ title: "Repair cost estimate", text: summary }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(summary).then(() => showToast("Copied to clipboard"));
    } else {
      showToast("Copy not supported on this browser");
    }
  }

  // ---- Nav bar wiring per step ----
  let navBar = null;
  if (!catalogError && !catalogLoading) {
    if (state.step === "device") {
      navBar = (
        <NavBar
          canContinue={!!state.selectedDevice}
          continueLabel="Continue"
          onContinue={() => goTo("problems")}
        />
      );
    } else if (state.step === "problems") {
      navBar = (
        <NavBar
          showBack
          onBack={() => goTo("device")}
          canContinue={state.selectedProblems.length > 0}
          continueLabel="Continue"
          onContinue={() => {
            setState((s) => ({ ...s, problemIndex: 0 }));
            goTo("questions");
          }}
        />
      );
    } else if (state.step === "questions") {
      const isLast = state.problemIndex === state.selectedProblems.length - 1;
      navBar = (
        <NavBar
          showBack
          onBack={() => {
            if (state.problemIndex > 0) {
              setState((s) => ({ ...s, problemIndex: s.problemIndex - 1 }));
              window.scrollTo(0, 0);
            } else {
              goTo("problems");
            }
          }}
          canContinue={currentQuestionsAnswered}
          continueLabel={isLast ? "See estimate" : "Next issue"}
          onContinue={() => {
            if (!currentQuestionsAnswered) return;
            if (isLast) {
              goTo("result");
            } else {
              setState((s) => ({ ...s, problemIndex: s.problemIndex + 1 }));
              window.scrollTo(0, 0);
            }
          }}
        />
      );
    }
  }

  return (
    <div className="app">
      <TopBar stepNumber={STEP_INDEX[state.step]} onReset={resetAll} />

      {catalogLoading && (
        <main className="step-main">
          <div className="state-banner loading">
            <span className="spinner" />
            Loading devices...
          </div>
        </main>
      )}

      {!catalogLoading && catalogError && (
        <main className="step-main">
          <div className="state-banner error">{catalogError}</div>
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={loadCatalog}>
            Try again
          </button>
        </main>
      )}

      {!catalogLoading && !catalogError && (
        <>
          {state.step === "device" && (
            <DeviceStep
              devices={devices}
              brands={brands}
              search={state.search}
              setSearch={(v) => setState((s) => ({ ...s, search: v }))}
              brandFilter={state.brandFilter}
              setBrandFilter={(v) => setState((s) => ({ ...s, brandFilter: v }))}
              selectedDeviceId={state.selectedDevice?.id}
              onSelectDevice={handleSelectDevice}
            />
          )}

          {state.step === "problems" && state.selectedDevice && (
            <ProblemsStep
              repairs={repairsCatalog}
              device={state.selectedDevice}
              selectedProblems={state.selectedProblems}
              onToggleProblem={handleToggleProblem}
            />
          )}

          {state.step === "questions" && currentRepair && state.selectedDevice && (
            <QuestionsStep
              repair={currentRepair}
              device={state.selectedDevice}
              answers={state.answers}
              onAnswer={handleAnswer}
              problemIndex={state.problemIndex}
              totalProblems={state.selectedProblems.length}
            />
          )}

          {state.step === "result" && (
            <ResultStep
              loading={resultLoading}
              error={resultError}
              estimate={estimate}
              region={state.region}
              setRegion={(v) => setState((s) => ({ ...s, region: v }))}
              deviceValueInput={deviceValueInput}
              setDeviceValueInput={setDeviceValueInput}
              onRetry={fetchEstimate}
              onModify={() => goTo("problems")}
              onStartNew={resetAll}
              onShare={handleShare}
            />
          )}
        </>
      )}

      {navBar}
      <Toast show={toast.show} message={toast.message} />
    </div>
  );
}

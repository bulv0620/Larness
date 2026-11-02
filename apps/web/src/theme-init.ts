try {
  const stored = localStorage.getItem("larness.theme");
  const dark =
    stored === "dark" ||
    (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.dataset.theme = "dark";
} catch {}

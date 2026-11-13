try {
  const stored = localStorage.getItem("larness.theme");
  const dark =
    stored === "dark" ||
    (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.dataset.theme = "dark";
} catch {}

void import("./main").catch(() => {
  const status = document.getElementById("startup-status");
  const error = document.getElementById("startup-error");
  if (status) status.hidden = true;
  if (error) error.hidden = false;
});

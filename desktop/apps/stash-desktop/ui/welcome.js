const status = document.querySelector("#account-status");

document.querySelectorAll("[data-account-action]").forEach((action) => {
  action.addEventListener("click", () => {
    const label = action.dataset.accountAction === "sign-in" ? "Sign in" : "Create account";
    status.textContent = `${label} is coming next. No account connection has been made.`;
  });
});

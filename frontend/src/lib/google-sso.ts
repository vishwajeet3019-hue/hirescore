type GoogleCredentialResponse = {
  credential?: string;
};

type GooglePromptMomentNotification = {
  isDisplayMoment: () => boolean;
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  getNotDisplayedReason: () => string;
  getSkippedReason: () => string;
};

type GoogleButtonOptions = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: string;
};

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
  prompt: (listener?: (notification: GooglePromptMomentNotification) => void) => void;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      id?: GoogleAccountsId;
    };
  };
};

let googleScriptPromise: Promise<void> | null = null;

const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

const injectGoogleFallbackButton = (container: HTMLElement, onClick: () => void) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Continue with Google");
  button.textContent = "Continue with Google";
  button.style.width = "min(320px, 100%)";
  button.style.minHeight = "42px";
  button.style.borderRadius = "999px";
  button.style.border = "1px solid rgba(186, 230, 253, 0.55)";
  button.style.background = "rgba(8, 35, 63, 0.88)";
  button.style.color = "#e6f6ff";
  button.style.fontSize = "14px";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.transition = "background-color 160ms ease";
  button.addEventListener("mouseover", () => {
    button.style.background = "rgba(14, 58, 96, 0.92)";
  });
  button.addEventListener("mouseout", () => {
    button.style.background = "rgba(8, 35, 63, 0.88)";
  });
  button.addEventListener("click", onClick);
  container.appendChild(button);
};

const loadGoogleIdentityScript = async () => {
  const globalWindow = window as GoogleWindow;
  if (globalWindow.google?.accounts?.id) return;
  if (googleScriptPromise) {
    await googleScriptPromise;
    return;
  }

  googleScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-google-identity='true']");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Google Identity script.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Google Identity script."));
    document.head.appendChild(script);
  });

  await googleScriptPromise;
};

type RenderGoogleSignInButtonOptions = {
  container: HTMLElement;
  clientId: string;
  onCredential: (credential: string) => void | Promise<void>;
  onError?: (message: string) => void;
  width?: number;
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
};

export const renderGoogleSignInButton = async ({
  container,
  clientId,
  onCredential,
  onError,
  width,
  text = "continue_with",
}: RenderGoogleSignInButtonOptions) => {
  const normalizedClientId = clientId.trim();
  container.innerHTML = "";
  if (!normalizedClientId) {
    onError?.("Google sign-in is not configured.");
    return;
  }

  try {
    await loadGoogleIdentityScript();
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Unable to load Google sign-in right now.");
    return;
  }

  const globalWindow = window as GoogleWindow;
  const googleId = globalWindow.google?.accounts?.id;
  if (!googleId) {
    onError?.("Google sign-in is unavailable right now.");
    return;
  }

  googleId.initialize({
    client_id: normalizedClientId,
    callback: (response) => {
      const credential = (response.credential || "").trim();
      if (!credential) {
        onError?.("Google sign-in was cancelled. Please try again.");
        return;
      }
      void onCredential(credential);
    },
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: false,
  });

  const buttonOptions: GoogleButtonOptions = {
    type: "standard",
    theme: "outline",
    size: "large",
    text,
    shape: "pill",
    logo_alignment: "left",
  };
  if (width && Number.isFinite(width)) {
    buttonOptions.width = String(Math.max(220, Math.round(width)));
  }
  let hasRenderedButton = false;
  try {
    googleId.renderButton(container, buttonOptions);
    hasRenderedButton = container.childElementCount > 0;
  } catch {
    hasRenderedButton = false;
  }

  if (!hasRenderedButton) {
    injectGoogleFallbackButton(container, () => {
      googleId.prompt();
    });
  }

  googleId.prompt((notification) => {
    if (notification.isNotDisplayed()) {
      const reason = notification.getNotDisplayedReason();
      if (reason && reason !== "suppressed_by_user" && reason !== "browser_not_supported") {
        onError?.("Google sign-in prompt was blocked. Please use the button again.");
      }
    }
  });
};

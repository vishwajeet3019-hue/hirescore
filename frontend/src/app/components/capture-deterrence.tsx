"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "https://api.hirescore.in";
const apiUrl = (path: string) => `${API_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;

type GuardAction =
  | "right_click_blocked"
  | "copy_shortcut_blocked"
  | "save_shortcut_blocked"
  | "print_shortcut_blocked"
  | "view_source_shortcut_blocked"
  | "devtools_shortcut_blocked"
  | "print_attempt_blocked";

const ACTION_MESSAGE: Record<GuardAction, string> = {
  right_click_blocked: "Right-click is disabled on protected content.",
  copy_shortcut_blocked: "Copy shortcut is disabled on protected content.",
  save_shortcut_blocked: "Save shortcut is disabled on protected content.",
  print_shortcut_blocked: "Print shortcut is disabled on protected content.",
  view_source_shortcut_blocked: "Source view shortcut is disabled on protected content.",
  devtools_shortcut_blocked: "Inspection shortcut is disabled on protected content.",
  print_attempt_blocked: "Printing is disabled for protected content.",
};

export default function CaptureDeterrence() {
  const pathname = usePathname() || "/";
  const [flashMessage, setFlashMessage] = useState("");
  const dismissRef = useRef<number | null>(null);
  const isAdminRoute = useMemo(() => pathname === "/admin" || pathname.startsWith("/admin/"), [pathname]);

  useEffect(() => {
    if (isAdminRoute) {
      document.body.classList.remove("capture-deterrence-active");
      return;
    }

    document.body.classList.add("capture-deterrence-active");
    const showWarning = (action: GuardAction) => {
      setFlashMessage(ACTION_MESSAGE[action]);
      if (dismissRef.current) {
        window.clearTimeout(dismissRef.current);
      }
      dismissRef.current = window.setTimeout(() => {
        setFlashMessage("");
      }, 1900);
    };

    const reportAction = (action: GuardAction, detail = "") => {
      const payload = {
        action,
        detail,
        path: window.location.pathname + window.location.search,
        source: "frontend_capture_deterrence",
        user_agent: navigator.userAgent,
        auth_token: window.localStorage.getItem("hirescore_auth_token") || "",
      };
      void fetch(apiUrl("/security/leak-trace"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(payload),
      }).catch(() => undefined);
    };

    const block = (event: Event, action: GuardAction, detail = "") => {
      event.preventDefault();
      event.stopPropagation();
      showWarning(action);
      reportAction(action, detail);
    };

    const handleContextMenu = (event: MouseEvent) => {
      block(event, "right_click_blocked");
    };

    const handleBeforePrint = (event: Event) => {
      block(event, "print_attempt_blocked");
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = (event.key || "").toLowerCase();
      const hasMeta = event.metaKey || event.ctrlKey;
      if (key === "f12") {
        block(event, "devtools_shortcut_blocked", "f12");
        return;
      }
      if (!hasMeta) return;
      if (event.shiftKey && ["i", "j", "c"].includes(key)) {
        block(event, "devtools_shortcut_blocked", `meta+shift+${key}`);
        return;
      }
      if (key === "s") {
        block(event, "save_shortcut_blocked", "meta+s");
      } else if (key === "p") {
        block(event, "print_shortcut_blocked", "meta+p");
      } else if (key === "c" || key === "x") {
        block(event, "copy_shortcut_blocked", `meta+${key}`);
      } else if (key === "u") {
        block(event, "view_source_shortcut_blocked", "meta+u");
      }
    };

    document.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      if (dismissRef.current) {
        window.clearTimeout(dismissRef.current);
      }
      document.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.body.classList.remove("capture-deterrence-active");
    };
  }, [isAdminRoute]);

  if (isAdminRoute) return null;

  return (
    <>
      {flashMessage && (
        <div className="pointer-events-none fixed top-4 left-1/2 z-[240] w-[min(92vw,620px)] -translate-x-1/2 rounded-xl border border-rose-200/30 bg-[#3f121a]/88 px-4 py-2 text-center text-xs font-semibold text-rose-100 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur">
          {flashMessage}
        </div>
      )}
    </>
  );
}

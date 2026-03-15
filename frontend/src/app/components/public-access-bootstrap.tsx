"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { ensurePublicAccessSession, getStoredAuthToken } from "@/lib/public-access";

export default function PublicAccessBootstrap() {
  const pathname = usePathname() || "/";
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  useEffect(() => {
    if (isAdminRoute) return;
    if (getStoredAuthToken()) return;
    void ensurePublicAccessSession();
  }, [isAdminRoute, pathname]);

  return null;
}

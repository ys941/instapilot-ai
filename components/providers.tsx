"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "react-hot-toast";
import { useState } from "react";
import { BrandProvider } from "@/components/BrandContext";
import { THEME_IDS, DEFAULT_THEME } from "@/lib/themes";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,                 // 30 s  -  data goes stale quickly so polls fire
            gcTime:    10 * 60 * 1000,            // 10 min  -  keep in cache between navigations
            retry: 1,
            refetchOnWindowFocus: true,           // refresh when user focuses the browser window
            refetchOnMount: true,                 // always load fresh data when visiting a page
            refetchIntervalInBackground: true,    // keep polling even when tab is unfocused
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="data-theme"
        defaultTheme={DEFAULT_THEME}
        themes={THEME_IDS}
        enableSystem={false}
        disableTransitionOnChange
      >
        <BrandProvider>
          {children}
        </BrandProvider>
        <Toaster
          position="bottom-right"
          gutter={8}
          toastOptions={{
            duration: 4000,
            style: {
              background: "rgba(17, 17, 24, 0.95)",
              color: "white",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderRadius: "12px",
              fontSize: "14px",
              padding: "12px 16px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
              maxWidth: "380px",
            },
            success: {
              iconTheme: { primary: "#E53E3E", secondary: "white" },
              style: { borderColor: "rgba(229, 62, 62, 0.3)" },
            },
            error: {
              iconTheme: { primary: "#FC8181", secondary: "white" },
              style: { borderColor: "rgba(252, 129, 129, 0.3)" },
            },
            loading: {
              iconTheme: { primary: "#E53E3E", secondary: "transparent" },
            },
          }}
        />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? process.env.BRAND_NAME ?? "InstaPilot AI";

/** Slim, theme-aware credit footer shown at the bottom of every dashboard page. */
export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/[0.06] px-4 sm:px-6 lg:px-8 py-5">
      <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 text-xs text-white/45">
        <span className="whitespace-nowrap">Powered by</span>
        <span className="whitespace-nowrap font-semibold bg-gradient-to-r from-brand to-brand-light bg-clip-text text-transparent">
          {APP_NAME}
        </span>
      </div>
    </footer>
  );
}

export function StatusBar() {
  return (
    <footer className="flex h-[34px] shrink-0 items-center justify-between border-t border-border bg-tile px-6 text-caption text-muted-fg">
      <div className="flex items-center gap-4">
        <span>rama main · ghosttester-ai</span>
        <span>Playwright 1.49 · API :4000</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-pill bg-success" aria-hidden />
        <span className="font-button text-success-fg">Entorno listo</span>
      </div>
    </footer>
  );
}

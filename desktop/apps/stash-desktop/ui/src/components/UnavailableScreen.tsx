type Props = { title: string; message: string; notice?: string; onRetry?: () => void };

export function UnavailableScreen({ title, message, notice, onRetry }: Props) {
  return <main className="workspace" aria-labelledby="unavailable-heading">
    <section className="panel unavailable-panel">
      <p className="eyebrow">STASH capability notice</p>
      <h1 id="unavailable-heading">{title}</h1>
      <p>{message}</p>
      {notice && <p className="status" role="status">{notice}</p>}
      {onRetry && <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>}
    </section>
  </main>;
}

import { RACE_DAY, daysUntil } from './lib/race'

function App() {
  const days = daysUntil(RACE_DAY)

  return (
    <main>
      <header style={{ marginBottom: 24 }}>
        <p style={{ color: 'var(--muted)', margin: 0 }}>富士山マラソン 2026</p>
        <h1 style={{ margin: '4px 0 0', fontSize: 28 }}>訓練課表</h1>
      </header>

      <section
        style={{
          background: 'var(--card)',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <p style={{ margin: 0, color: 'var(--muted)' }}>距離比賽日</p>
        <p style={{ margin: '4px 0 0', fontSize: 40, fontWeight: 700, color: 'var(--accent)' }}>
          {days} <span style={{ fontSize: 18, color: 'var(--text)' }}>天</span>
        </p>
        <p style={{ margin: '8px 0 0', color: 'var(--muted)' }}>{RACE_DAY}（JST）</p>
      </section>
    </main>
  )
}

export default App
